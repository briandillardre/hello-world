import { NextRequest, NextResponse } from 'next/server'
import { rangeWindow, DEFAULT_TZ, type TimeRangeKey } from '@/lib/dates'
import { segmentStops } from '@/lib/poi'
import { classifyStops } from '@/lib/poi-server'
import { pointInPolygon } from '@/lib/alerts-engine'

export const dynamic = 'force-dynamic'
// Tool stops stitch carrier history per pairing episode — allow the same
// budget as /api/history rather than the 10s default (review, Jul 21).
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Classified stop log for one asset + range: where it stopped, for how long,
 * and WHAT KIND of place that was. Stops inside company zones are labeled as
 * the zone (no geocoding); off-site stops reverse-geocode through Photon and
 * classify by OSM category — supplier vs DMV vs lunch, automatically.
 */

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

  // Tools have no rows of their own — their day is stitched from the trucks
  // that carried them (pairing episodes), so a tag gets the same stop log.
  const { data: assetRow } = await supabase.from('assets').select('type').eq('id', assetId).single()

  let rows: { lat: number; lng: number; speed: number | null; timestamp: string }[] = []
  if (assetRow?.type === 'tool') {
    const { getToolWindowRows } = await import('@/lib/db/tools')
    rows = await getToolWindowRows(assetId, new Date(w.from).toISOString(), new Date(w.to).toISOString())
  } else {
    // Window-scoped rows, paged past the API max-rows cap (newest-first,
    // restored to chronological below).
    const PAGE = 1000
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
    rows.reverse() // chronological
  }

  const raw = segmentStops(rows)

  // Company zones win over geocoding — a stop at Riverfront IS Riverfront.
  const { data: fences } = await supabase.from('geofences_json').select('*')
  const rings = (fences ?? [])
    .filter((g) => g.kind !== 'boundary')
    .map((g) => ({ name: g.name as string, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))

  const stops = await classifyStops(raw, rings, pointInPolygon)

  return NextResponse.json(
    { stops, tz },
    { headers: { 'Cache-Control': 'private, max-age=120' } }
  )
}
