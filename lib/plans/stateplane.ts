/**
 * South Carolina State Plane — NAD83, EPSG:2273, INTERNATIONAL feet — pure.
 *
 * Civil sets in SC are drawn on this grid, so a sheet's coordinate ticks
 * ("N 1,100,000", "E 1,580,000") or its control-point table say exactly where
 * it sits. The zone is a Lambert conformal cone (standard parallels 32°30′ and
 * 34°50′, origin 31°50′ N 81° W, false easting 609,600 m = 2,000,000 ft), and
 * SC's legal foot is the international foot (0.3048 m), not the US survey
 * foot — the difference is 2 ppm, about 4 ft at 2,000,000 ft of easting.
 * Formulas: Snyder, Map Projections — A Working Manual, §15.
 */

const A = 6378137 // GRS80
const F = 1 / 298.257222101
const E2 = 2 * F - F * F
const E = Math.sqrt(E2)
const FT = 0.3048
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

const PHI1 = rad(34 + 50 / 60)
const PHI2 = rad(32.5)
const PHI0 = rad(31 + 50 / 60)
const LAM0 = rad(-81)
const FE = 609600 // metres
const FN = 0

const m = (p: number) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2)
const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - E * Math.sin(p)) / (1 + E * Math.sin(p)), E / 2)
const N = (Math.log(m(PHI1)) - Math.log(m(PHI2))) / (Math.log(t(PHI1)) - Math.log(t(PHI2)))
const BIG_F = m(PHI1) / (N * Math.pow(t(PHI1), N))
const RHO0 = A * BIG_F * Math.pow(t(PHI0), N)

/** lng/lat (degrees) → SC State Plane easting, northing (international feet). */
export function toStatePlane(lng: number, lat: number): [number, number] {
  const rho = A * BIG_F * Math.pow(t(rad(lat)), N)
  const theta = N * (rad(lng) - LAM0)
  const x = FE + rho * Math.sin(theta)
  const y = FN + RHO0 - rho * Math.cos(theta)
  return [x / FT, y / FT]
}

/** SC State Plane easting, northing (international feet) → lng/lat (degrees). */
export function fromStatePlane(eFt: number, nFt: number): [number, number] {
  const x = eFt * FT - FE
  const y = RHO0 - (nFt * FT - FN)
  const rho = Math.sign(N) * Math.hypot(x, y)
  const tt = Math.pow(rho / (A * BIG_F), 1 / N)
  const theta = Math.atan2(x, y)
  const lam = theta / N + LAM0
  let phi = Math.PI / 2 - 2 * Math.atan(tt)
  for (let i = 0; i < 12; i++) {
    const next = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2))
    if (Math.abs(next - phi) < 1e-13) { phi = next; break }
    phi = next
  }
  return [deg(lam), deg(phi)]
}

/** A coordinate pair that can be on SC's grid at all (an assumed grid —
 *  N 5000 · E 5000 — cannot). */
export function plausibleSC(e: number, n: number): boolean {
  return e >= 1_250_000 && e <= 2_800_000 && n >= 0 && n <= 1_300_000
}
