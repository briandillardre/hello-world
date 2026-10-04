/**
 * Transverse Mercator (Krüger n-series, 4th order — Karney 2011) on GRS80.
 *
 * The dirt takeoff works in UTM metres: the USGS 1-metre lidar tiles are cut
 * in UTM (NAD83), so the existing-ground grid stays axis-aligned and is never
 * resampled. UTM is not true scale — at Greenville the grid is ~0.02% short —
 * so every area and volume is divided by k² at the site (`scaleAt`); over a
 * site's few hundred metres k varies by less than 1e-7.
 *
 * Accuracy of the series is ~1 mm anywhere inside a UTM zone, far beyond what
 * a takeoff needs. Pure and framework-free (harness: scripts/dirt-test.mjs).
 */

const A_AX = 6378137.0                 // GRS80 semi-major axis, metres
const F = 1 / 298.257222101            // GRS80 flattening
const N = F / (2 - F)                  // third flattening
const E = Math.sqrt(F * (2 - F))       // first eccentricity
const N2 = N * N, N3 = N2 * N, N4 = N3 * N
const AR = (A_AX / (1 + N)) * (1 + N2 / 4 + N4 / 64)   // rectifying radius

const ALPHA = [
  N / 2 - (2 * N2) / 3 + (5 * N3) / 16 + (41 * N4) / 180,
  (13 * N2) / 48 - (3 * N3) / 5 + (557 * N4) / 1440,
  (61 * N3) / 240 - (103 * N4) / 140,
  (49561 * N4) / 161280,
]
const BETA = [
  N / 2 - (2 * N2) / 3 + (37 * N3) / 96 - N4 / 360,
  N2 / 48 + N3 / 15 - (437 * N4) / 1440,
  (17 * N3) / 480 - (37 * N4) / 840,
  (4397 * N4) / 161280,
]
const DELTA = [
  2 * N - (2 * N2) / 3 - 2 * N3 + (116 * N4) / 45,
  (7 * N2) / 3 - (8 * N3) / 5 - (227 * N4) / 45,
  (56 * N3) / 15 - (136 * N4) / 35,
  (4279 * N4) / 630,
]

const RAD = Math.PI / 180

export interface TmParams {
  /** Central meridian, degrees. */
  lon0: number
  /** Scale on the central meridian (UTM 0.9996). */
  k0: number
  /** False easting / northing, metres. */
  fe: number
  fn: number
}

/** UTM zone (1–60) for a longitude. Norway/Svalbard exceptions don't apply to US sites. */
export function utmZone(lng: number): number {
  return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1))
}

export function utmParams(zone: number, south = false): TmParams {
  return { lon0: (zone - 1) * 6 - 180 + 3, k0: 0.9996, fe: 500000, fn: south ? 10000000 : 0 }
}

/** NAD83 / UTM north EPSG code for a zone (26901–26923 cover the US). */
export function nad83UtmEpsg(zone: number): number {
  return 26900 + zone
}

/** lng/lat (degrees) → [easting, northing] metres. */
export function tmForward(p: TmParams, lng: number, lat: number): [number, number] {
  const phi = lat * RAD
  const dl = (lng - p.lon0) * RAD
  const s = Math.sin(phi)
  const t = Math.sinh(Math.atanh(s) - E * Math.atanh(E * s))
  const xi = Math.atan2(t, Math.cos(dl))
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t))
  let x = eta, y = xi
  for (let j = 1; j <= 4; j++) {
    const a = ALPHA[j - 1]
    x += a * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta)
    y += a * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta)
  }
  return [p.fe + p.k0 * AR * x, p.fn + p.k0 * AR * y]
}

/** [easting, northing] metres → [lng, lat] degrees. */
export function tmInverse(p: TmParams, e: number, n: number): [number, number] {
  const xi = (n - p.fn) / (p.k0 * AR)
  const eta = (e - p.fe) / (p.k0 * AR)
  let xp = xi, ep = eta
  for (let j = 1; j <= 4; j++) {
    const b = BETA[j - 1]
    xp -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta)
    ep -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta)
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep))
  let phi = chi
  for (let j = 1; j <= 4; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi)
  const lng = p.lon0 + Math.atan2(Math.sinh(ep), Math.cos(xp)) / RAD
  return [lng, phi / RAD]
}

/**
 * Point scale factor k at a location: projected distance ÷ true distance.
 * Measured numerically over ±5 m on the ellipsoid (meridian and prime-vertical
 * radii of curvature are exact at that span), averaged over both directions —
 * TM is conformal, so the two agree to ~1e-10.
 */
export function scaleAt(p: TmParams, lng: number, lat: number): number {
  const phi = lat * RAD
  const e2 = F * (2 - F)
  const w = Math.sqrt(1 - e2 * Math.sin(phi) ** 2)
  const M = (A_AX * (1 - e2)) / (w * w * w)      // meridional radius
  const Nr = A_AX / w                           // prime-vertical radius
  const step = 5                                // metres on the ground
  const dPhi = step / M / RAD
  const dLam = step / (Nr * Math.cos(phi)) / RAD
  const [ax, ay] = tmForward(p, lng, lat - dPhi)
  const [bx, by] = tmForward(p, lng, lat + dPhi)
  const [cx, cy] = tmForward(p, lng - dLam, lat)
  const [dx, dy] = tmForward(p, lng + dLam, lat)
  const kNS = Math.hypot(bx - ax, by - ay) / (2 * step)
  const kEW = Math.hypot(dx - cx, dy - cy) / (2 * step)
  return (kNS + kEW) / 2
}

/**
 * The takeoff's working frame: UTM metres shifted to a whole-metre origin near
 * the site so coordinates stay small (triangulation is happiest near zero).
 * `k` is the UTM scale at the site; true area = frame area ÷ k².
 */
export interface Frame {
  zone: number
  epsg: number
  tm: TmParams
  /** UTM coordinates of the frame origin (whole metres). */
  e0: number
  n0: number
  k: number
}

export function makeFrame(lng: number, lat: number, zone = utmZone(lng)): Frame {
  const tm = utmParams(zone)
  const [e, n] = tmForward(tm, lng, lat)
  return { zone, epsg: nad83UtmEpsg(zone), tm, e0: Math.round(e), n0: Math.round(n), k: scaleAt(tm, lng, lat) }
}

/** lng/lat → frame metres. */
export function toFrame(f: Frame, lng: number, lat: number): [number, number] {
  const [e, n] = tmForward(f.tm, lng, lat)
  return [e - f.e0, n - f.n0]
}

/** Frame metres → lng/lat. */
export function fromFrame(f: Frame, x: number, y: number): [number, number] {
  return tmInverse(f.tm, x + f.e0, y + f.n0)
}
