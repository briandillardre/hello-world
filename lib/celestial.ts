/**
 * Sun + moon ephemeris and star-catalog projection — feeds the 3D sky
 * rendering in lib/sat-3d.ts (drawn with the Satellites layer).
 *
 * Accuracy targets are visual, not navigational: the low-precision
 * Astronomical Almanac series used here place the sun within ~0.01° and the
 * moon within ~0.3° — far tighter than a pixel at any zoom we render.
 *
 * Positions are returned as sub-points (the lat/lon on Earth directly
 * beneath the body) plus true distance, so the map layer can place each
 * body with the same transform used for satellites. A star at RA α is
 * overhead at longitude α − GMST; declination is its latitude.
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Julian date from a JS Date. */
export function julian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5
}

function norm360(x: number): number {
  return ((x % 360) + 360) % 360
}

/** Normalize longitude to [-180, 180]. */
export function norm180(x: number): number {
  const n = norm360(x)
  return n > 180 ? n - 360 : n
}

export interface Equatorial {
  raDeg: number
  decDeg: number
}

/** Sun geocentric RA/Dec + distance (AU). Low-precision Almanac series. */
export function sunEquatorial(date: Date): Equatorial & { distAU: number } {
  const d = julian(date) - 2451545.0
  const L = norm360(280.460 + 0.9856474 * d)
  const g = norm360(357.528 + 0.9856003 * d) * DEG
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG
  const eps = (23.439 - 0.0000004 * d) * DEG
  const raDeg = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD
  const decDeg = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD
  const distAU = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)
  return { raDeg: norm360(raDeg), decDeg, distAU }
}

/** Moon geocentric RA/Dec + distance (km). Low-precision Almanac series. */
export function moonEquatorial(date: Date): Equatorial & { distKm: number } {
  const T = (julian(date) - 2451545.0) / 36525
  const s = (x: number) => Math.sin(x * DEG)
  const c = (x: number) => Math.cos(x * DEG)
  // Ecliptic longitude (deg)
  const lambda =
    218.32 + 481267.881 * T +
    6.29 * s(135.0 + 477198.87 * T) -
    1.27 * s(259.3 - 413335.36 * T) +
    0.66 * s(235.7 + 890534.22 * T) +
    0.21 * s(269.9 + 954397.74 * T) -
    0.19 * s(357.5 + 35999.05 * T) -
    0.11 * s(186.5 + 966404.03 * T)
  // Ecliptic latitude (deg)
  const beta =
    5.13 * s(93.3 + 483202.02 * T) +
    0.28 * s(228.2 + 960400.9 * T) -
    0.28 * s(318.3 + 6003.15 * T) -
    0.17 * s(217.6 - 407332.21 * T)
  // Horizontal parallax (deg) → distance
  const par =
    0.9508 +
    0.0518 * c(135.0 + 477198.87 * T) +
    0.0095 * c(259.3 - 413335.36 * T) +
    0.0078 * c(235.7 + 890534.22 * T) +
    0.0028 * c(269.9 + 954397.74 * T)
  const distKm = 6378.14 / Math.sin(par * DEG)
  // Ecliptic → equatorial
  const eps = 23.4393 * DEG
  const l = norm360(lambda) * DEG
  const b = beta * DEG
  const x = Math.cos(b) * Math.cos(l)
  const y = Math.cos(eps) * Math.cos(b) * Math.sin(l) - Math.sin(eps) * Math.sin(b)
  const z = Math.sin(eps) * Math.cos(b) * Math.sin(l) + Math.cos(eps) * Math.sin(b)
  const raDeg = norm360(Math.atan2(y, x) * RAD)
  const decDeg = Math.asin(z) * RAD
  return { raDeg, decDeg, distKm }
}

/** Sub-point (lat/lon beneath the body) from RA/Dec + GMST in radians. */
export function subPoint(eq: Equatorial, gmstRad: number): { lat: number; lon: number } {
  return { lat: eq.decDeg, lon: norm180(eq.raDeg - gmstRad * RAD) }
}

/**
 * Illuminated fraction of the moon (0 = new, 1 = full) from the geocentric
 * unit direction vectors of sun and moon: frac = (1 − ŝ·m̂) / 2.
 */
export function moonIllumination(sunDir: [number, number, number], moonDir: [number, number, number]): number {
  const dot = sunDir[0] * moonDir[0] + sunDir[1] * moonDir[1] + sunDir[2] * moonDir[2]
  return Math.min(1, Math.max(0, (1 - dot) / 2))
}

export const SUN_RADIUS_KM = 696000
export const MOON_RADIUS_KM = 1737.4
export const AU_KM = 149597870.7
export const EARTH_RADIUS_M = 6371008.8
