import { NextRequest, NextResponse } from 'next/server'
import { rangeWindow, type TimeRangeKey, safeTz } from '@/lib/dates'
import { segmentStops } from '@/lib/poi'
import { classifyStops, streetAt } from '@/lib/poi-server'
import { pointInPolygon } from '@/lib/alerts-engine'
import { computeRangeStats } from '@/lib/asset-stats'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// Streets are sampled from fast-moving fixes only — parked/creeping points
// geocode to parking lots, not the roads the truck actually drove.
const ROAD_SAMPLE_MPH = 12
const MAX_ROAD_GEOCODES = 10

/**
 * The day, as a sentence: how far it drove and for how long, which roads it
 * took, and where it stopped. Deterministic (no LLM) — same pings, same
 * stop segmentation, same geocoder as the Stops card, composed server-side
 * in the viewer's timezone.
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ text: null })

  const assetId = req.nextUrl.searchParams.get('asset')
  const range = (req.nextUrl.searchParams.get('range') ?? 'today') as TimeRangeKey
  if (!assetId) return NextResponse.json({ error: 'asset required' }, { status: 400 })

  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const tz = safeTz(req.cookies.get('ht_tz')?.value)
  const w = rangeWindow(tz, ['today', 'yesterday', '7d'].includes(range) ? range : 'today', {})

  // Tools: the recap narrates the carrying truck's movement while the tag was
  // aboard (pairing episodes) — same pipeline as /api/stops.
  const { data: assetRow } = await supabase.from('assets').select('type').eq('id', assetId).single()

  let rows: { lat: number; lng: number; speed: number | null; timestamp: string; ignition?: boolean | null }[] = []
  if (assetRow?.type === 'tool') {
    const { getToolWindowRows } = await import('@/lib/db/tools')
    rows = await getToolWindowRows(assetId, new Date(w.from).toISOString(), new Date(w.to).toISOString())
  } else {
    const PAGE = 1000
    while (rows.length < 20_000) {
      const { data, error } = await supabase
        .from('asset_locations')
        .select('lat, lng, speed, timestamp, ignition')
        .eq('asset_id', assetId)
        .gte('timestamp', new Date(w.from).toISOString())
        .lt('timestamp', new Date(w.to).toISOString())
        .order('timestamp', { ascending: false })
        .range(rows.length, rows.length + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
    rows.reverse() // chronological
  }

  const pts = rows
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, ms: Date.parse(r.timestamp), ign: r.ignition ?? null }))
    .filter((p) => Number.isFinite(p.ms))

  if (!pts.length) {
    return NextResponse.json(
      { text: 'No activity recorded in this range.', tz },
      { headers: { 'Cache-Control': 'private, max-age=120' } }
    )
  }

  const stats = computeRangeStats(pts, w.from, w.to, pts[0].ms)

  // ── Roads driven: evenly sample the fast fixes, geocode to street names,
  //    keep first-appearance order.
  const fast = pts.filter((p) => (p.speed ?? 0) >= ROAD_SAMPLE_MPH)
  const roads: string[] = []
  if (fast.length) {
    const n = Math.min(MAX_ROAD_GEOCODES, fast.length)
    const samples = Array.from({ length: n }, (_, i) => fast[Math.floor((i * (fast.length - 1)) / Math.max(1, n - 1))])
    for (const s of samples) {
      const street = await streetAt(s.lat, s.lng)
      if (street && !roads.includes(street)) roads.push(street)
    }
  }

  // ── Stops (same pipeline as the Stops card, zone names win).
  const raw = segmentStops(rows)
  const { data: fences } = await supabase.from('geofences_json').select('*')
  const rings = (fences ?? [])
    .filter((g) => g.kind !== 'boundary')
    .map((g) => ({ name: g.name as string, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))
  const stops = (await classifyStops(raw, rings, pointInPolygon)).reverse() // chronological

  // ── Compose.
  const fmtT = (ms: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
  const fmtDur = (min: number) =>
    min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`

  const firstMove = pts.find((p) => (p.speed ?? 0) >= 5)
  const lastMove = [...pts].reverse().find((p) => (p.speed ?? 0) >= 5)

  const parts: string[] = []
  if (stats.miles < 0.5) {
    parts.push("Hasn't driven in this range.")
  } else {
    let s = `Drove ~${stats.miles} mi over ${fmtDur(stats.movingMin)}`
    if (firstMove && lastMove && lastMove.ms > firstMove.ms) s += ` (first rolled at ${fmtT(firstMove.ms)}, last moved ${fmtT(lastMove.ms)})`
    if (stats.maxMph >= 25) s += ` · top speed ${stats.maxMph} mph`
    parts.push(s + '.')
  }
  if (roads.length) parts.push(`Roads: ${roads.join(' → ')}.`)
  if (stops.length) {
    const list = stops
      .map((st) => `${st.name} ${fmtT(st.fromMs)} (${fmtDur(st.minutes)})`)
      .join(' · ')
    parts.push(`Stops: ${list}.`)
  } else if (stats.miles >= 0.5) {
    parts.push('No stops of 5+ minutes.')
  }
  if (stats.idleMin >= 20) parts.push(`Idled ${fmtDur(stats.idleMin)}.`)

  return NextResponse.json(
    { text: parts.join(' '), miles: stats.miles, driveMin: stats.movingMin, roads, tz },
    { headers: { 'Cache-Control': 'private, max-age=120' } }
  )
}
