/**
 * A placed picture's pixels ↔ lng/lat — pure. A zone_imagery shot is pinned
 * by four corners (TL, TR, BR, BL; migration 053) and MapLibre draws it as
 * two triangles (TL·TR·BL and BL·TR·BR) interpolated in Web Mercator, so this
 * maps exactly the way the picture sits on the map the estimator sees.
 */
export type LngLat = [number, number]

const D2R = Math.PI / 180
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))
const latOf = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R

export interface Quad {
  /** Corners in (lng, mercY): TL, TR, BR, BL. */
  c: [number, number][]
}

export function makeQuad(corners: LngLat[]): Quad | null {
  if (!Array.isArray(corners) || corners.length !== 4) return null
  const c = corners.map(p => [Number(p[0]), mercY(Number(p[1]))] as [number, number])
  return c.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? { c } : null
}

/** u, v in [0, 1] (u right, v down) → lng/lat. */
export function uvToLngLat(q: Quad, u: number, v: number): LngLat {
  const [TL, TR, BR, BL] = q.c
  let x: number, y: number
  if (u + v <= 1) {
    x = TL[0] + u * (TR[0] - TL[0]) + v * (BL[0] - TL[0])
    y = TL[1] + u * (TR[1] - TL[1]) + v * (BL[1] - TL[1])
  } else {
    x = BR[0] + (1 - u) * (BL[0] - BR[0]) + (1 - v) * (TR[0] - BR[0])
    y = BR[1] + (1 - u) * (BL[1] - BR[1]) + (1 - v) * (TR[1] - BR[1])
  }
  return [x, latOf(y)]
}

function solve(o: [number, number], a: [number, number], b: [number, number], p: [number, number]): [number, number] | null {
  // p = o + s·a + t·b
  const det = a[0] * b[1] - a[1] * b[0]
  if (Math.abs(det) < 1e-18) return null
  const dx = p[0] - o[0], dy = p[1] - o[1]
  return [(dx * b[1] - dy * b[0]) / det, (a[0] * dy - a[1] * dx) / det]
}

/** lng/lat → u, v (may fall outside [0, 1] when the point is off the picture). */
export function lngLatToUv(q: Quad, lng: number, lat: number): [number, number] | null {
  const [TL, TR, BR, BL] = q.c
  const p: [number, number] = [lng, mercY(lat)]
  const s1 = solve(TL, [TR[0] - TL[0], TR[1] - TL[1]], [BL[0] - TL[0], BL[1] - TL[1]], p)
  if (s1 && s1[0] + s1[1] <= 1) return s1
  const s2 = solve(BR, [BL[0] - BR[0], BL[1] - BR[1]], [TR[0] - BR[0], TR[1] - BR[1]], p)
  if (s2) return [1 - s2[0], 1 - s2[1]]
  return s1
}

/** Pixel-ring (in a W×H raster of the picture) → lng/lat ring. */
export function pixelRingToLngLat(q: Quad, ring: [number, number][], W: number, H: number): LngLat[] {
  return ring.map(([x, y]) => uvToLngLat(q, x / W, y / H))
}
