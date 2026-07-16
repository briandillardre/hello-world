/**
 * Survey + takeoff math for the map measure tool. Pure and framework-free so
 * it can be unit-checked in isolation — these numbers turn into asphalt orders,
 * so they're anchored to published constants, not eyeballed.
 *
 * Coordinates: SC State Plane NAD83, EPSG:2273 (US survey feet) via a
 * Lambert Conformal Conic 2SP forward projection. Length/area are geodesic on
 * the GRS80 ellipsoid. Elevation comes from the map's DEM (queryTerrainElevation),
 * not from here.
 */

// ── GRS80 ellipsoid ────────────────────────────────────────────────────────
const A = 6378137.0            // semi-major axis, metres
const F = 1 / 298.257222101    // flattening
const E2 = F * (2 - F)         // eccentricity²
const E = Math.sqrt(E2)
const M_TO_USFT = 3937 / 1200  // 1 metre = 3937/1200 US survey feet
const M_TO_FT = 3.280839895    // international foot (for lengths — 2ppm off USft, immaterial here)

const rad = (d: number) => (d * Math.PI) / 180

// ── SC State Plane (EPSG:2273) LCC-2SP constants ─────────────────────────────
const SC = {
  lat1: rad(34 + 50 / 60),          // 34°50′ N — first standard parallel
  lat2: rad(32 + 30 / 60),          // 32°30′ N — second standard parallel
  lat0: rad(31 + 50 / 60),          // 31°50′ N — latitude of false origin
  lon0: rad(-81),                   // 81°00′ W — central meridian
  Ef: 2000000.0,                    // false easting, US ft
  Nf: 0.0,                          // false northing, US ft
}

const lccM = (lat: number) => Math.cos(lat) / Math.sqrt(1 - E2 * Math.sin(lat) ** 2)
const lccT = (lat: number) =>
  Math.tan(Math.PI / 4 - lat / 2) / Math.pow((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat)), E / 2)

// Precompute the cone constants once.
const m1 = lccM(SC.lat1), m2 = lccM(SC.lat2)
const t1 = lccT(SC.lat1), t2 = lccT(SC.lat2), t0 = lccT(SC.lat0)
const N_CONE = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2))
const BIG_F = m1 / (N_CONE * Math.pow(t1, N_CONE))
const R0 = A * BIG_F * Math.pow(t0, N_CONE)   // radius at the false origin (metres)

export interface StatePlane { northing: number; easting: number }

/** lng/lat (WGS84 ≈ NAD83) → SC State Plane northing/easting, US survey feet. */
export function toStatePlaneSC(lng: number, lat: number): StatePlane {
  const φ = rad(lat)
  const r = A * BIG_F * Math.pow(lccT(φ), N_CONE)   // metres
  const θ = N_CONE * (rad(lng) - SC.lon0)
  const eastM = r * Math.sin(θ)
  const northM = R0 - r * Math.cos(θ)
  return {
    easting: SC.Ef + eastM * M_TO_USFT,
    northing: SC.Nf + northM * M_TO_USFT,
  }
}

// ── Geodesic length ──────────────────────────────────────────────────────────
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8 // mean Earth radius, metres
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Total length of a polyline (lng/lat vertices), in FEET. */
export function polylineLengthFt(coords: [number, number][]): number {
  let m = 0
  for (let i = 1; i < coords.length; i++) m += haversineM(coords[i - 1], coords[i])
  return m * M_TO_FT
}

// ── Geodesic polygon area ────────────────────────────────────────────────────
/** Spherical polygon area (ring of lng/lat), in SQUARE FEET. Ring may be open
 *  or closed; sign is dropped. */
export function polygonAreaSqFt(ring: [number, number][]): number {
  if (ring.length < 3) return 0
  const R = 6371008.8
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % ring.length]
    sum += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  const areaM2 = Math.abs((sum * R * R) / 2)
  return areaM2 * M_TO_FT * M_TO_FT
}

// ── Unit conversions ─────────────────────────────────────────────────────────
export type LengthUnit = 'ft' | 'yd' | 'mi'
export type AreaUnit = 'sf' | 'sy' | 'acre'

export const LENGTH_LABEL: Record<LengthUnit, string> = { ft: 'ft', yd: 'yd', mi: 'mi' }
export const AREA_LABEL: Record<AreaUnit, string> = { sf: 'SF', sy: 'SY', acre: 'acre' }

export function lengthIn(ft: number, u: LengthUnit): number {
  return u === 'yd' ? ft / 3 : u === 'mi' ? ft / 5280 : ft
}
export function areaIn(sf: number, u: AreaUnit): number {
  return u === 'sy' ? sf / 9 : u === 'acre' ? sf / 43560 : sf
}

// ── Takeoffs ─────────────────────────────────────────────────────────────────
/** Compacted in-place densities, lb per cubic foot. Rough industry figures —
 *  a takeoff estimate, not a mix design. Verify against your supplier's ticket. */
export const MATERIALS: { key: string; label: string; lbPerFt3: number }[] = [
  { key: 'asphalt', label: 'Asphalt (HMA)', lbPerFt3: 145 },
  { key: 'concrete', label: 'Concrete', lbPerFt3: 150 },
  { key: 'gab', label: 'Aggregate base (GAB)', lbPerFt3: 135 },
  { key: 'stone', label: 'Crushed stone', lbPerFt3: 100 },
  { key: 'gravel', label: 'Gravel', lbPerFt3: 105 },
  { key: 'sand', label: 'Sand', lbPerFt3: 100 },
  { key: 'topsoil', label: 'Topsoil', lbPerFt3: 90 },
  { key: 'dirt', label: 'Compacted fill', lbPerFt3: 115 },
]

export interface Takeoff { cubicFt: number; cubicYd: number; tons: number; material: string; depthIn: number }

/** area (SF) × depth (inches) → volume (CY) + tonnage for a material. */
export function takeoff(areaSqFt: number, depthIn: number, materialKey: string): Takeoff {
  const mat = MATERIALS.find((m) => m.key === materialKey) ?? MATERIALS[0]
  const cubicFt = areaSqFt * (depthIn / 12)
  return {
    cubicFt,
    cubicYd: cubicFt / 27,
    tons: (cubicFt * mat.lbPerFt3) / 2000,
    material: mat.label,
    depthIn,
  }
}

export function fmt(n: number, dp = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
