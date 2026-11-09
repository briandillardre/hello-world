/**
 * What is on the ground around a site, as corners a plan sheet can be
 * matched to (lib/plans/match.ts) — server only.
 *
 *  - Building footprints from OpenStreetMap (most of SC's footprints were
 *    imported from Microsoft's imagery-traced set — a metre or two off,
 *    which is why a building match is called "check it" past 3 ft).
 *  - Property lines from the county parcel layer when one is configured
 *    (NEXT_PUBLIC_PARCEL_SERVICE_URL, lib/parcels.ts).
 *
 * OSM's map call is a public good with a usage policy: one small box per
 * line-up, our own User-Agent, cached per site for 15 minutes.
 */

import { cornersOf, toLocal, type Corner, type LngLat, type Seg } from './match'
import { PARCEL_SERVICE_URL, fetchParcels } from '../parcels'

export interface Ground { corners: Corner[]; buildings: number; parcels: number }

const cache = new Map<string, { at: number; g: Ground }>()
const TTL = 15 * 60_000

function bboxOf(ring: LngLat[], padM: number) {
  const lat = ring.reduce((t, p) => t + p[1], 0) / ring.length
  const dLat = padM / 110_574, dLng = padM / (111_320 * Math.cos((lat * Math.PI) / 180))
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y) }
  return { west: w - dLng, south: s - dLat, east: e + dLng, north: n + dLat }
}

async function osmBuildings(b: { west: number; south: number; east: number; north: number }): Promise<LngLat[][] | null> {
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${[b.west, b.south, b.east, b.north].map((v) => v.toFixed(6)).join(',')}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15_000)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'HammerTrack/1 (hammertrack.ai; plan line-up)' }, signal: ctl.signal })
    if (!r.ok) return null
    const j = await r.json() as { elements?: { type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string> }[] }
    const nodes = new Map<number, LngLat>()
    for (const el of j.elements ?? []) if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') nodes.set(el.id, [el.lon, el.lat])
    const out: LngLat[][] = []
    for (const el of j.elements ?? []) {
      if (el.type !== 'way' || !el.tags?.building || !el.nodes) continue
      const ring = el.nodes.map((id) => nodes.get(id)).filter((p): p is LngLat => !!p)
      if (ring.length >= 4) out.push(ring)
    }
    return out
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function groundAround(siteKey: string, ring: LngLat[], origin: LngLat): Promise<Ground | null> {
  const hit = cache.get(siteKey)
  if (hit && Date.now() - hit.at < TTL) return hit.g
  if (ring.length < 3) return null
  // A big box can pass OSM's node cap; the site's own box then.
  let blds = await osmBuildings(bboxOf(ring, 250))
  if (!blds) blds = await osmBuildings(bboxOf(ring, 0))
  const segs: Seg[] = []
  const push = (pts: LngLat[], role: 1 | 2) => {
    const loc = pts.map((p) => toLocal(origin, p))
    for (let i = 0; i + 1 < loc.length; i++) segs.push({ x0: loc[i][0], y0: loc[i][1], x1: loc[i + 1][0], y1: loc[i + 1][1], role })
  }
  for (const b of blds ?? []) push(b, 1)
  let parcels = 0
  if (PARCEL_SERVICE_URL) {
    const fc = await fetchParcels(PARCEL_SERVICE_URL, bboxOf(ring, 150)).catch(() => null)
    for (const f of fc?.features ?? []) {
      const g = f.geometry
      const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []
      for (const poly of polys) for (const r of poly) { push(r as LngLat[], 2); parcels++ }
    }
  }
  if (!blds && !parcels) return null
  const g: Ground = { corners: cornersOf(segs, 0.3, 1.5, 800), buildings: blds?.length ?? 0, parcels }
  cache.set(siteKey, { at: Date.now(), g })
  if (cache.size > 200) cache.delete(cache.keys().next().value as string)
  return g
}
