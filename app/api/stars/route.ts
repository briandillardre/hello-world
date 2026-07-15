import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Bright-star catalog for the map's sky rendering (Satellites layer).
 *
 * Proxies the d3-celestial distribution of the Yale Bright Star Catalog and
 * trims it to naked-eye stars (mag ≤ 5.0, ~1,600 of them). Each entry is
 * {ra, dec, mag, bv} — right ascension/declination in degrees plus the B−V
 * color index so the client can tint hot stars blue and cool ones amber.
 * Star positions are effectively eternal: cached a week.
 */

interface Star { ra: number; dec: number; mag: number; bv: number }

let cache: { at: number; stars: Star[] } | null = null
const TTL_MS = 7 * 24 * 3_600_000
const SRC = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.6.json'
const MAG_LIMIT = 5.0

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ stars: cache.stars }, { headers: { 'Cache-Control': 'public, s-maxage=604800' } })
  }
  try {
    const r = await fetch(SRC, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    if (!r.ok) throw new Error(`catalog ${r.status}`)
    const j: { features?: { properties?: { mag?: number; bv?: string }; geometry?: { coordinates?: [number, number] } }[] } = await r.json()
    const stars: Star[] = []
    for (const f of j.features ?? []) {
      const mag = f.properties?.mag
      const c = f.geometry?.coordinates
      if (typeof mag !== 'number' || mag > MAG_LIMIT || !c) continue
      stars.push({
        ra: Math.round(c[0] * 100) / 100,
        dec: Math.round(c[1] * 100) / 100,
        mag: Math.round(mag * 100) / 100,
        bv: Math.round((parseFloat(f.properties?.bv ?? '0') || 0) * 100) / 100,
      })
    }
    if (!stars.length) throw new Error('catalog empty')
    cache = { at: Date.now(), stars }
    return NextResponse.json({ stars }, { headers: { 'Cache-Control': 'public, s-maxage=604800' } })
  } catch (e) {
    if (cache) return NextResponse.json({ stars: cache.stars })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'star catalog unreachable' }, { status: 503 })
  }
}
