import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Active SPC watch boxes (tornado / severe t-storm) as GeoJSON — proxied
 * server-side because two IEM endpoint guesses returned HTML error pages
 * from the browser (/diag Jul 13-14) and SPC's own site has no CORS.
 *
 * Source order:
 *   1. SPC ActiveWW.kml — the authority's own active-watch outlines
 *   2. NWS alerts API watch events (geometry present on some watches only)
 * Always answers 200 with a FeatureCollection — an empty one on total
 * failure, so the map layer degrades to "no dashed boxes", never an error.
 */

interface WatchFeature {
  type: 'Feature'
  geometry: { type: 'Polygon'; coordinates: number[][][] } | Record<string, unknown>
  properties: { wt: 'TOR' | 'SVR' }
}

let cache: { at: number; features: WatchFeature[] } | null = null
const TTL_MS = 5 * 60_000

const UA = { 'user-agent': 'HammerTrack weather layers (briandillardre@gmail.com)' }

/** SPC's KML: <Placemark> per watch; name/description says TORNADO or SEVERE. */
async function fromSpcKml(): Promise<WatchFeature[] | null> {
  const r = await fetch('https://www.spc.noaa.gov/products/watch/ActiveWW.kml', {
    signal: AbortSignal.timeout(10_000), headers: UA, cache: 'no-store',
  })
  if (!r.ok) return null
  const kml = await r.text()
  if (!/<kml[\s>]/i.test(kml)) return null
  const out: WatchFeature[] = []
  for (const pm of kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) ?? []) {
    const coordsM = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/)
    if (!coordsM) continue
    const ring = coordsM[1].trim().split(/\s+/).map((triple) => {
      const [lng, lat] = triple.split(',').map(Number)
      return [lng, lat]
    }).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (ring.length < 3) continue
    const label = (pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '') + ' ' + (pm.match(/<description>[\s\S]{0,300}/)?.[0] ?? '')
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { wt: /TOR/i.test(label) ? 'TOR' : 'SVR' },
    })
  }
  return out
}

/** NWS alerts API — watches with polygon geometry (many are zone-based/null). */
async function fromNwsAlerts(): Promise<WatchFeature[] | null> {
  const r = await fetch(
    'https://api.weather.gov/alerts/active?status=actual&event=Tornado%20Watch,Severe%20Thunderstorm%20Watch',
    { signal: AbortSignal.timeout(10_000), headers: { ...UA, accept: 'application/geo+json' }, cache: 'no-store' }
  )
  if (!r.ok) return null
  const j = await r.json() as { features?: Array<{ geometry: unknown; properties?: { event?: string } }> }
  if (!Array.isArray(j?.features)) return null
  return j.features
    .filter((f) => f.geometry)
    .map((f) => ({
      type: 'Feature' as const,
      geometry: f.geometry as Record<string, unknown>,
      properties: { wt: /tornado/i.test(f.properties?.event ?? '') ? 'TOR' as const : 'SVR' as const },
    }))
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ type: 'FeatureCollection', features: cache.features, source: 'cache' })
  }
  let features: WatchFeature[] = []
  let source = 'none'
  try {
    const spc = await fromSpcKml().catch(() => null)
    if (spc) { features = spc; source = 'spc-kml' }
    else {
      const nws = await fromNwsAlerts().catch(() => null)
      if (nws) { features = nws; source = 'nws-alerts' }
    }
  } catch { /* both down — empty layer */ }
  cache = { at: Date.now(), features }
  return NextResponse.json(
    { type: 'FeatureCollection', features, source },
    { headers: { 'Cache-Control': 'public, s-maxage=300' } }
  )
}
