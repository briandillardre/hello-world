import { NextRequest, NextResponse } from 'next/server'
import { rangeWindow, DEFAULT_TZ, type TimeRangeKey } from '@/lib/dates'
import { segmentStops, classifyOsm, type PoiKind } from '@/lib/poi'
import { pointInPolygon } from '@/lib/alerts-engine'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Classified stop log for one asset + range: where it stopped, for how long,
 * and WHAT KIND of place that was. Stops inside company zones are labeled as
 * the zone (no geocoding); off-site stops reverse-geocode through Photon and
 * classify by OSM category — supplier vs DMV vs lunch, automatically.
 */

// Geocode cache — ~11 m buckets. Trucks revisit the same places constantly,
// so this stays warm and keeps us polite to the free community geocoder.
const geoCache = new Map<string, { name: string; kind: PoiKind }>()
const CACHE_CAP = 2000

async function classifyPoint(lat: number, lng: number): Promise<{ name: string; kind: PoiKind }> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  const hit = geoCache.get(key)
  if (hit) return hit
  let out: { name: string; kind: PoiKind } = { name: 'Stop', kind: 'other' }
  try {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`, {
      headers: { 'user-agent': 'HammerTrack stops (briandillardre@gmail.com)' },
      signal: AbortSignal.timeout(5000),
    })
    if (r.ok) {
      const j = await r.json()
      const p = j?.features?.[0]?.properties
      if (p) {
        const kind = classifyOsm(p.osm_key, p.osm_value)
        const name = p.name || [p.street, p.city].filter(Boolean).join(', ') || 'Stop'
        out = { name, kind }
      }
    }
  } catch { /* geocoder down — 'Stop · other' is honest */ }
  if (geoCache.size >= CACHE_CAP) geoCache.clear()
  geoCache.set(key, out)
  return out
}

export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ stops: [] })

  const assetId = req.nextUrl.searchParams.get('asset')
  const range = (req.nextUrl.searchParams.get('range') ?? 'today') as TimeRangeKey
  if (!assetId) return NextResponse.json({ error: 'asset required' }, { status: 400 })

  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const tz = decodeURIComponent(req.cookies.get('ht_tz')?.value ?? DEFAULT_TZ)
  const w = rangeWindow(tz, ['today', 'yesterday', '7d'].includes(range) ? range : 'today', {})

  // Window-scoped rows, paged past the API max-rows cap.
  const PAGE = 1000
  const rows: { lat: number; lng: number; speed: number | null; timestamp: string }[] = []
  while (rows.length < 20_000) {
    const { data, error } = await supabase
      .from('asset_locations')
      .select('lat, lng, speed, timestamp')
      .eq('asset_id', assetId)
      .gte('timestamp', new Date(w.from).toISOString())
      .lt('timestamp', new Date(w.to).toISOString())
      .order('timestamp', { ascending: false })
      .range(rows.length, rows.length + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  const raw = segmentStops(rows.reverse())

  // Company zones win over geocoding — a stop at Riverfront IS Riverfront.
  const { data: fences } = await supabase.from('geofences_json').select('*')
  const rings = (fences ?? [])
    .filter((g) => g.kind !== 'boundary')
    .map((g) => ({ name: g.name as string, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))

  const stops = []
  let geocodes = 0
  for (const s of raw) {
    const zone = rings.find((z) => z.ring.length >= 3 && pointInPolygon([s.lng, s.lat], z.ring))
    if (zone) {
      stops.push({ ...s, name: zone.name, kind: 'site' as PoiKind })
    } else if (geocodes < 20) {
      geocodes++
      stops.push({ ...s, ...(await classifyPoint(s.lat, s.lng)) })
    } else {
      stops.push({ ...s, name: 'Stop', kind: 'other' as PoiKind })
    }
  }

  return NextResponse.json(
    { stops, tz },
    { headers: { 'Cache-Control': 'private, max-age=120' } }
  )
}
