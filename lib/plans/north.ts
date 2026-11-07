/**
 * Which way is north on a placed sheet — pure.
 *
 * A placed sheet's picture is pinned to the ground by four corners (TL, TR,
 * BR, BL as [lng, lat], MapLibre's image order). The direction the page's
 * "up" points on the ground is its bearing; turning the page by that bearing
 * puts north straight up, the way Bluebeam's rotate-to-north does. The plan's
 * own arrow may point at GRID north instead — South Carolina's State Plane
 * grid (EPSG:2273, a Lambert conformal cone around 81° W) leans off true north
 * by n·(λ − λ0), about 0.8° in Greenville and 0.6° in Charleston.
 */

export type LngLat = [number, number]
export type Corners4 = [LngLat, LngLat, LngLat, LngLat]

const M_PER_DEG_LAT = 110_574
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

/** Bearing (degrees clockwise from true north, -180..180) the page's up
 *  edge points at on the ground. */
export function pageUpBearing(c: Corners4): number {
  const [tl, , , bl] = c
  const lat = (tl[1] + bl[1]) / 2
  const east = (tl[0] - bl[0]) * mPerDegLng(lat)
  const north = (tl[1] - bl[1]) * M_PER_DEG_LAT
  return (Math.atan2(east, north) * 180) / Math.PI
}

/** Ground metres per page point along the page's width (TL → TR). */
export function metresPerUnit(c: Corners4, pageWidth: number): number {
  const [tl, tr] = c
  const lat = (tl[1] + tr[1]) / 2
  const w = Math.hypot((tr[0] - tl[0]) * mPerDegLng(lat), (tr[1] - tl[1]) * M_PER_DEG_LAT)
  return pageWidth > 0 ? w / pageWidth : 0
}

const merc = ([lng, lat]: LngLat): [number, number] => [
  (lng + 180) / 360,
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2,
]

/** Where a ground point falls on the placed picture, as u, v in [0, 1] (left
 *  to right, top to bottom) — the inverse of MapLibre's two triangles
 *  (TL·TR·BL and BL·TR·BR, in Web Mercator), the same way plan-geo.ts does. */
export function uvOf(c: Corners4, p: LngLat): [number, number] {
  const [tl, tr, br, bl] = c.map(merc)
  const [x, y] = merc(p)
  const solve = (o: number[], a: number[], b: number[]): [number, number] => {
    const ax = a[0] - o[0], ay = a[1] - o[1], bx = b[0] - o[0], by = b[1] - o[1]
    const d = ax * by - ay * bx
    const rx = x - o[0], ry = y - o[1]
    return [(rx * by - ry * bx) / d, (ax * ry - ay * rx) / d]
  }
  const [u, v] = solve(tl, tr, bl)
  if (u + v <= 1) return [u, v]
  const [s, t] = solve(br, bl, tr)
  return [1 - s, 1 - t]
}

// ── South Carolina State Plane (NAD83, EPSG:2273) ──────────────────────────

const GRS80_E = Math.sqrt(0.00669438002290)
const rad = (d: number) => (d * Math.PI) / 180
function lccN(phi1: number, phi2: number): number {
  const e = GRS80_E
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2)
  const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2)
  return (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)))
}
/** The cone constant of the SC zone (standard parallels 32°30′ and 34°50′). */
export const SC_N = lccN(rad(34 + 50 / 60), rad(32.5))
const SC_LON0 = -81

/** Inside (roughly) South Carolina, where the SC State Plane grid applies. */
export function inSouthCarolina(lng: number, lat: number): boolean {
  return lng >= -83.5 && lng <= -78.4 && lat >= 31.9 && lat <= 35.3
}

/** Grid north on the SC State Plane grid, in degrees clockwise from true
 *  north (negative = grid north lies west of true north). null outside SC. */
export function scGridConvergence(lng: number, lat: number): number | null {
  if (!inSouthCarolina(lng, lat)) return null
  return SC_N * (lng - SC_LON0)
}

/** "0.8° west of true north" — how a convergence reads. */
export function convergenceWords(deg: number): string {
  const a = Math.abs(deg)
  if (a < 0.05) return 'the same as true north'
  return `${a.toFixed(1)}° ${deg < 0 ? 'west' : 'east'} of true north`
}

/** A first guess at where an unplaced sheet goes: centred on the site, north
 *  up, sized by its scale — page width in inches × feet per inch. The person
 *  slides and turns it from there (TL, TR, BR, BL as [lng, lat]). */
export function roughBounds(center: LngLat, pageWpt: number, pageHpt: number, feetPerInch: number): Corners4 | null {
  if (!(pageWpt > 0 && pageHpt > 0 && feetPerInch > 0)) return null
  const wM = (pageWpt / 72) * feetPerInch * 0.3048
  const hM = wM * (pageHpt / pageWpt)
  if (!(wM > 5 && wM < 20000)) return null
  const kx = mPerDegLng(center[1]), ky = M_PER_DEG_LAT
  const dx = wM / 2 / kx, dy = hM / 2 / ky
  return [[center[0] - dx, center[1] + dy], [center[0] + dx, center[1] + dy], [center[0] + dx, center[1] - dy], [center[0] - dx, center[1] - dy]]
}
