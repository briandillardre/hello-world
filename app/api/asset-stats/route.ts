import { NextRequest, NextResponse } from 'next/server'
import { rangeWindow, DEFAULT_TZ, type TimeRangeKey } from '@/lib/dates'
import { computeRangeStats, estMpgForSpecs } from '@/lib/asset-stats'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// One fetch covers every range (they nest), computed once server-side.
const FETCH_CAP = 40_000

const RANGES: { key: TimeRangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All time' },
]

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

  // Fuel-burn rate from the vehicle's own VIN-decoded specs (SUV != dump truck).
  const { data: assetRow } = await supabase.from('assets').select('name, type, metadata').eq('id', assetId).single()
  const md = (assetRow?.metadata ?? {}) as Record<string, unknown>
  const estMpg = estMpgForSpecs((md.specs as Record<string, unknown> | undefined) ?? md, assetRow?.name ?? '')

  let fetched: { lat: number; lng: number; speed: number | null; timestamp: string; ignition?: boolean | null }[] = []
  if (assetRow?.type === 'tool') {
    // Tools: miles/time = the carrier's movement while the tag was aboard
    // (pairing episodes) — same numbers a truck would get for those rides.
    const { getToolWindowRows } = await import('@/lib/db/tools')
    fetched = (await getToolWindowRows(assetId, new Date(0).toISOString(), new Date().toISOString(), FETCH_CAP)).reverse()
  } else {
    // Page past Supabase's API Max-Rows cap (a bare .limit(40000) can silently
    // return 1000). Newest-first so an over-cap asset keeps its recent history.
    const PAGE = 1000
    while (fetched.length < FETCH_CAP) {
      const { data, error } = await supabase
        .from('asset_locations')
        .select('lat, lng, speed, timestamp, ignition')
        .eq('asset_id', assetId)
        .order('timestamp', { ascending: false })
        .range(fetched.length, fetched.length + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      fetched.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
  }

  const pts = fetched
    .reverse()
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed as number | null, ms: Date.parse(r.timestamp), ign: r.ignition ?? null }))
    .filter((p) => Number.isFinite(p.ms))

  const earliestMs = pts.length ? pts[0].ms : null
  const nowMs = Date.now()
  const ranges = RANGES.map(({ key, label }) => {
    const w = rangeWindow(tz, key, { earliestMs })
    return { key, label, ...computeRangeStats(pts, w.from, w.to, earliestMs, nowMs, estMpg) }
  })

  // "Parked since": the newest fix that was actually moving. Global, not
  // range-scoped — the panel shows it under the activity grid.
  let lastMovedMs: number | null = null
  for (let i = pts.length - 1; i >= 0; i--) {
    if ((pts[i].speed ?? 0) >= 2) { lastMovedMs = pts[i].ms; break }
  }
  const movingNow = pts.length > 0 && (pts[pts.length - 1].speed ?? 0) >= 2

  return NextResponse.json(
    { ranges, mpg: estMpg, lastMovedIso: lastMovedMs ? new Date(lastMovedMs).toISOString() : null, movingNow, truncated: pts.length >= FETCH_CAP },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
