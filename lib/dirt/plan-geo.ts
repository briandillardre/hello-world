/**
 * A placed plan sheet's PDF page ↔ the map — pure.
 *
 * A sheet goes on the map as a raster of its page (ZonePlans renders the page
 * with pdf.js at `scale`, long edge ≤ 3000 px) pinned by four corners (TL, TR,
 * BR, BL). MapLibre draws that image as two triangles (TL·TR·BL and
 * BL·TR·BR) interpolated in Web Mercator, so this maps exactly the way the
 * sheet looks on screen — which is where the estimator lined it up with the
 * satellite:
 *
 *   PDF user space  →(pdf.js viewport transform)→  raster pixels
 *                   →(÷ image size)→  u, v in [0, 1]
 *                   →(MapLibre's triangles, Mercator)→  lng, lat
 */

export type LngLat = [number, number]

export interface SheetGeo {
  /** pdf.js viewport.transform at the raster scale: page point → pixel. */
  vp: [number, number, number, number, number, number]
  /** The placed image's pixel size. */
  imgW: number
  imgH: number
  /** TL, TR, BR, BL as placed. */
  corners: [LngLat, LngLat, LngLat, LngLat]
}

const merc = ([lng, lat]: LngLat): [number, number] => [
  (lng + 180) / 360,
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2,
]
const unmerc = (x: number, y: number): LngLat => [
  x * 360 - 180,
  (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90,
]

/**
 * The scale ZonePlans rasterised a page at: long edge 3000 px, never past 6×.
 * `baseW/baseH` are the page's viewport size at scale 1.
 */
export function rasterScale(baseW: number, baseH: number, longEdgePx = 3000): number {
  return Math.min(6, longEdgePx / Math.max(baseW, baseH))
}

export interface SheetMap {
  /** PDF user space → lng/lat. */
  toLngLat(x: number, y: number): LngLat
  /** lng/lat → PDF user space. */
  toPage(lng: number, lat: number): [number, number]
  /** Points per foot on the ground (the sheet's drawn scale, as placed). */
  ptPerFt: number
}

export function sheetMap(g: SheetGeo): SheetMap {
  const [a, b, c, d, e, f] = g.vp
  const det = a * d - b * c
  const [tl, tr, br, bl] = g.corners.map(merc)
  const toUV = (x: number, y: number): [number, number] => [(a * x + c * y + e) / g.imgW, (b * x + d * y + f) / g.imgH]
  const fromUV = (u: number, v: number): [number, number] => {
    const px = u * g.imgW, py = v * g.imgH
    // Inverse of the viewport transform.
    return [(d * (px - e) - c * (py - f)) / det, (-b * (px - e) + a * (py - f)) / det]
  }
  const uvToMerc = (u: number, v: number): [number, number] => {
    if (u + v <= 1) return [tl[0] + u * (tr[0] - tl[0]) + v * (bl[0] - tl[0]), tl[1] + u * (tr[1] - tl[1]) + v * (bl[1] - tl[1])]
    const s = 1 - u, t = 1 - v
    return [br[0] + s * (bl[0] - br[0]) + t * (tr[0] - br[0]), br[1] + s * (bl[1] - br[1]) + t * (tr[1] - br[1])]
  }
  const solve = (o: number[], p: number[], q: number[], x: number, y: number): [number, number] => {
    // x,y = o + s·(p − o) + t·(q − o)
    const ax = p[0] - o[0], ay = p[1] - o[1], bx = q[0] - o[0], by = q[1] - o[1]
    const dd = ax * by - ay * bx
    const rx = x - o[0], ry = y - o[1]
    return [(rx * by - ry * bx) / dd, (ax * ry - ay * rx) / dd]
  }
  const mercToUV = (x: number, y: number): [number, number] => {
    const [u, v] = solve(tl, tr, bl, x, y)
    if (u + v <= 1) return [u, v]
    const [s, t] = solve(br, bl, tr, x, y)
    return [1 - s, 1 - t]
  }
  // Ground size of the sheet: TL→TR in metres over the page's width in points.
  const lat0 = (g.corners[0][1] + g.corners[2][1]) / 2
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const wM = Math.hypot((g.corners[1][0] - g.corners[0][0]) * mPerDegLng, (g.corners[1][1] - g.corners[0][1]) * 110_574)
  const p0 = fromUV(0, 0), p1 = fromUV(1, 0)
  const wPt = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  return {
    toLngLat(x, y) { const [u, v] = toUV(x, y); const [mx, my] = uvToMerc(u, v); return unmerc(mx, my) },
    toPage(lng, lat) { const [mx, my] = merc([lng, lat]); const [u, v] = mercToUV(mx, my); return fromUV(u, v) },
    ptPerFt: wM > 0 ? wPt / (wM / 0.3048) : 1,
  }
}
