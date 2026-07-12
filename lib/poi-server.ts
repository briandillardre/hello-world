/**
 * Server-side POI classification shared by the /api/stops route and the AI
 * assistant's asset_stops tool — one geocode cache, one behavior, so the
 * panel and the assistant never disagree about where the truck stopped.
 */
import { classifyOsm, type PoiKind, type RawStop } from './poi'

export interface ClassifiedStop extends RawStop {
  name: string
  kind: PoiKind
}

// ~11 m buckets; trucks revisit the same places constantly, so this stays
// warm and keeps us polite to the free community geocoder.
const geoCache = new Map<string, { name: string; kind: PoiKind }>()
const CACHE_CAP = 2000

export async function classifyPoint(lat: number, lng: number): Promise<{ name: string; kind: PoiKind }> {
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

/** Company zones win over geocoding; off-site stops classify via OSM,
 *  bounded by a geocode budget per call. */
export async function classifyStops(
  raw: RawStop[],
  rings: { name: string; ring: [number, number][] }[],
  pointInPolygon: (pt: [number, number], ring: [number, number][]) => boolean,
  maxGeocodes = 20
): Promise<ClassifiedStop[]> {
  const stops: ClassifiedStop[] = []
  let geocodes = 0
  for (const s of raw) {
    const zone = rings.find((z) => z.ring.length >= 3 && pointInPolygon([s.lng, s.lat], z.ring))
    if (zone) stops.push({ ...s, name: zone.name, kind: 'site' })
    else if (geocodes < maxGeocodes) {
      geocodes++
      stops.push({ ...s, ...(await classifyPoint(s.lat, s.lng)) })
    } else {
      stops.push({ ...s, name: 'Stop', kind: 'other' })
    }
  }
  return stops
}
