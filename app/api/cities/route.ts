import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * World city points for the realistic day/night layer — each city glows on
 * the night side of the terminator, ramping up through dusk.
 *
 * Proxies Natural Earth's 1:50m populated places (~1,200 cities) and trims
 * to {lat, lon, pop}. Cities don't move: cached a week.
 */

interface City { lat: number; lon: number; pop: number }

let cache: { at: number; cities: City[] } | null = null
const TTL_MS = 7 * 24 * 3_600_000
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson'

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ cities: cache.cities }, { headers: { 'Cache-Control': 'public, s-maxage=604800' } })
  }
  try {
    const r = await fetch(SRC, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
    if (!r.ok) throw new Error(`source ${r.status}`)
    const j: { features?: { properties?: { latitude?: number; longitude?: number; pop_max?: number } }[] } = await r.json()
    const cities: City[] = []
    for (const f of j.features ?? []) {
      const p = f.properties
      if (typeof p?.latitude !== 'number' || typeof p?.longitude !== 'number') continue
      cities.push({
        lat: Math.round(p.latitude * 100) / 100,
        lon: Math.round(p.longitude * 100) / 100,
        pop: p.pop_max ?? 0,
      })
    }
    if (!cities.length) throw new Error('source empty')
    cities.sort((a, b) => b.pop - a.pop)
    const trimmed = cities.slice(0, 1800)
    cache = { at: Date.now(), cities: trimmed }
    return NextResponse.json({ cities: trimmed }, { headers: { 'Cache-Control': 'public, s-maxage=604800' } })
  } catch (e) {
    if (cache) return NextResponse.json({ cities: cache.cities })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'cities source unreachable' }, { status: 503 })
  }
}
