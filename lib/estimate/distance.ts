/**
 * Road distance and drive time from a site to its sources — server only.
 *
 * One OSRM table request per site (the public demo server: free, keyless,
 * OSM roads, free-flow speeds — so every minute here is a NO-TRAFFIC minute
 * and the estimate says so). Cached in site_distances; the fleet's own round
 * trips replace these where trucks have made the run (a later step).
 */

export interface RoadLeg { miles: number; minutes: number }

/** Great-circle km. */
export function kmBetween(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Sources this far away are not haul sources (and would make the table request heavy). */
export const MAX_SOURCE_KM = 250
export const MAX_SOURCES = 60

/**
 * Road miles and minutes from `origin` to each destination (null where OSRM
 * found no road or the place is out of reach). Throws only when the routing
 * service itself fails — the caller keeps the cached numbers then.
 */
export async function roadTable(origin: [number, number], dests: [number, number][]): Promise<(RoadLeg | null)[]> {
  // The nearest MAX_SOURCES within reach (straight line) — a far quarry, never a near one, is the one left out.
  const km = dests.map((d) => kmBetween(origin, d))
  const idx = dests.map((_, i) => i).filter((i) => km[i] <= MAX_SOURCE_KM).sort((a, b) => km[a] - km[b]).slice(0, MAX_SOURCES)
  const out: (RoadLeg | null)[] = dests.map(() => null)
  if (!idx.length) return out
  const coords = [origin, ...idx.map((i) => dests[i])].map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=distance,duration`
  const r = await fetch(url, {
    headers: { 'user-agent': 'HammerTrack estimating (hello@hammertrack.ai)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`router ${r.status}`)
  const j = await r.json() as { code?: string; distances?: (number | null)[][]; durations?: (number | null)[][] }
  if (j.code !== 'Ok' || !j.distances?.[0] || !j.durations?.[0]) throw new Error(`router ${j.code ?? 'bad answer'}`)
  idx.forEach((di, k) => {
    const m = j.distances![0][k + 1], s = j.durations![0][k + 1]
    if (typeof m === 'number' && typeof s === 'number' && Number.isFinite(m) && Number.isFinite(s) && m >= 0 && s >= 0) {
      out[di] = { miles: Math.round((m / 1609.344) * 100) / 100, minutes: Math.round((s / 60) * 10) / 10 }
    }
  })
  return out
}
