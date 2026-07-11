import { NextRequest, NextResponse } from 'next/server'
import { rangeWindow, DEFAULT_TZ, type TimeRangeKey } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// One fetch covers every range (they nest), computed once server-side.
const FETCH_CAP = 40_000
// Ignore distance across silence — the truck was towed/parked, not driving.
const MAX_SEG_GAP_MS = 15 * 60_000
// Speed at/above this = moving; awake below it = idling (engine on, parked
// trackers sleep and check in ~hourly, so tight ping cadence means running).
const MOVE_MPH = 2
// A new moving run after this much non-movement counts as a fresh start.
const START_GAP_MS = 5 * 60_000
// Fuel estimate: distance at a work-truck 15 mpg + idle burn ~0.6 gal/h.
const EST_MPG = 15
const IDLE_GAL_PER_H = 0.6

const RANGES: { key: TimeRangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All time' },
]

const haversineMi = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Per-asset mileage + top speed for the asset panel's range table
 * (Today / Yesterday / 7d / 30d / YTD / All time). Auth: RLS via the
 * caller's session — an asset outside their company returns zero rows.
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ ranges: [] })

  const assetId = req.nextUrl.searchParams.get('asset')
  if (!assetId) return NextResponse.json({ error: 'asset required' }, { status: 400 })

  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const tz = decodeURIComponent(req.cookies.get('ht_tz')?.value ?? DEFAULT_TZ)

  const { data, error } = await supabase
    .from('asset_locations')
    .select('lat, lng, speed, timestamp')
    .eq('asset_id', assetId)
    .order('timestamp', { ascending: true })
    .limit(FETCH_CAP)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pts = (data ?? [])
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed as number | null, ms: Date.parse(r.timestamp) }))
    .filter((p) => Number.isFinite(p.ms))

  const earliestMs = pts.length ? pts[0].ms : null
  const nowMs = Date.now()
  const ranges = RANGES.map(({ key, label }) => {
    const w = rangeWindow(tz, key, { earliestMs })
    let miles = 0
    let maxMph = 0
    let movingMs = 0
    let idleMs = 0
    let starts = 0
    let lastMovingMs: number | null = null
    let prev: { lat: number; lng: number; ms: number; speed: number | null } | null = null
    for (const p of pts) {
      if (p.ms < w.from || p.ms >= w.to) { prev = null; continue }
      const mph = p.speed ?? 0
      if (mph > maxMph) maxMph = mph
      if (prev && p.ms - prev.ms <= MAX_SEG_GAP_MS) {
        miles += haversineMi(prev.lat, prev.lng, p.lat, p.lng)
        // Awake time splits into moving vs idling; sleep gaps (>15 min
        // between pings, engine off) fall through to "parked".
        const dt = p.ms - prev.ms
        if ((prev.speed ?? 0) >= MOVE_MPH || mph >= MOVE_MPH) movingMs += dt
        else idleMs += dt
      }
      if (mph >= MOVE_MPH) {
        if (lastMovingMs === null || p.ms - lastMovingMs > START_GAP_MS) starts++
        lastMovingMs = p.ms
      }
      prev = p
    }
    // Stationary = the part of the window the asset existed but wasn't
    // moving or idling (device asleep, engine off).
    const spanFrom = earliestMs === null ? null : Math.max(w.from, earliestMs)
    const spanTo = Math.min(w.to, nowMs)
    const spanMs = spanFrom !== null && spanTo > spanFrom ? spanTo - spanFrom : 0
    const parkedMs = Math.max(0, spanMs - movingMs - idleMs)
    const fuelGal = miles / EST_MPG + (idleMs / 3_600_000) * IDLE_GAL_PER_H
    return {
      key, label,
      miles: Math.round(miles * 10) / 10,
      maxMph: Math.round(maxMph),
      movingMin: Math.round(movingMs / 60_000),
      idleMin: Math.round(idleMs / 60_000),
      parkedMin: Math.round(parkedMs / 60_000),
      starts,
      fuelGalEst: Math.round(fuelGal * 10) / 10,
    }
  })

  return NextResponse.json(
    { ranges, truncated: pts.length >= FETCH_CAP },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
