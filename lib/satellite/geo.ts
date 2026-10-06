/**
 * Satellite site imagery — the geometry, pure (harness: scripts/satellite-test.mjs).
 *
 * Both feeds deliver pictures cut in UTM metres: Sentinel-2 tiles are WGS84 /
 * UTM (EPSG 326xx north, 327xx south) and PlanetScope ortho clips are too. A
 * site's picture is an axis-aligned pixel window in that grid; its four
 * corners, converted to lng/lat, are what `zone_imagery.bounds` stores and
 * what the map's image source draws (TL, TR, BR, BL — the 053 order). Over a
 * site's few hundred metres the UTM-to-lng/lat warp is far below one pixel,
 * so the quad is exact enough.
 *
 * The projection is lib/dirt/tm.ts (Krüger series on GRS80). WGS84 and GRS80
 * differ in flattening by 1.6e-11 — sub-millimetre here.
 */
import { scaleAt, tmForward, tmInverse, utmParams, utmZone, type TmParams } from '../dirt/tm'

export type LngLat = [number, number]
export type Ring = LngLat[]
export type Corners = [LngLat, LngLat, LngLat, LngLat]
export interface LngLatBox { minLng: number; minLat: number; maxLng: number; maxLat: number }

export const ACRE_M2 = 4046.8564224

/** Zone outline from a GeoJSON polygon: closing point dropped, every vertex finite. Null when unusable. */
export function cleanRing(coords: unknown): Ring | null {
  if (!Array.isArray(coords) || coords.length < 4 || coords.length > 6000) return null
  const pts: Ring = []
  for (const p of coords) {
    if (!Array.isArray(p) || p.length < 2) return null
    const lng = Number(p[0]), lat = Number(p[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85) return null
    pts.push([lng, lat])
  }
  const [a, b] = [pts[0], pts[pts.length - 1]]
  if (a[0] === b[0] && a[1] === b[1]) pts.pop()
  return pts.length >= 3 ? pts : null
}

export function ringBox(ring: Ring): LngLatBox {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }
  return { minLng, minLat, maxLng, maxLat }
}

/** The UTM grid a site falls in naturally (centre longitude). */
export function siteTm(ring: Ring): TmParams {
  const b = ringBox(ring)
  const lat = (b.minLat + b.maxLat) / 2
  return utmParams(utmZone((b.minLng + b.maxLng) / 2), lat < 0)
}

export function projectRing(tm: TmParams, ring: Ring): [number, number][] {
  return ring.map(([lng, lat]) => tmForward(tm, lng, lat))
}

/** Shoelace area of a planar ring. */
export function planarArea(pts: [number, number][]): number {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1])
  return Math.abs(s) / 2
}

/** True ground area of a zone in m² (UTM area ÷ k², k from the series at the centre). */
export function ringAreaM2(ring: Ring): number {
  const tm = siteTm(ring)
  const pts = projectRing(tm, ring)
  const b = ringBox(ring)
  const k = scaleAt(tm, (b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2)
  return planarArea(pts) / (k * k)
}

/** The UTM grid an EPSG code names (WGS84 326xx / 327xx, NAD83 269xx). Null for anything else. */
export function utmFromEpsg(epsg: number): { zone: number; south: boolean; tm: TmParams } | null {
  if (!Number.isInteger(epsg)) return null
  let zone = 0, south = false
  if (epsg >= 32601 && epsg <= 32660) zone = epsg - 32600
  else if (epsg >= 32701 && epsg <= 32760) { zone = epsg - 32700; south = true }
  else if (epsg >= 26901 && epsg <= 26923) zone = epsg - 26900
  else return null
  return { zone, south, tm: utmParams(zone, south) }
}

/** "EPSG:32617" or 32617 → 32617. */
export function epsgOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string') {
    const m = v.match(/^EPSG:(\d{4,5})$/i)
    if (m) return Number(m[1])
  }
  return null
}

/** Context around the site in the picture: a quarter of its longer side, 60–400 m. */
export function marginFor(widthM: number, heightM: number): number {
  const m = 0.25 * Math.max(widthM, heightM)
  return Math.min(400, Math.max(60, Math.round(m)))
}

export interface Raster {
  /** Upper-left corner of pixel (0, 0), metres. */
  originX: number
  originY: number
  /** Pixel size, metres; resY is negative for north-up images. */
  resX: number
  resY: number
  width: number
  height: number
}

/** A pixel window, end-exclusive: columns c0..c1-1, rows r0..r1-1. */
export interface PixelWindow { c0: number; r0: number; c1: number; r1: number; clipped: boolean }

/**
 * The pixel window covering a site (plus `marginM` all round) in a raster cut
 * in grid `tm`. Clamped to the raster; `clipped` says the site + margin ran
 * off its edge. Null when they don't overlap at all (or the raster isn't
 * north-up).
 */
export function windowFor(tm: TmParams, ring: Ring, r: Raster, marginM: number): PixelWindow | null {
  if (!(r.resX > 0) || !(r.resY < 0) || !(r.width > 0) || !(r.height > 0)) return null
  const pts = projectRing(tm, ring)
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity
  for (const [e, n] of pts) {
    minE = Math.min(minE, e); maxE = Math.max(maxE, e)
    minN = Math.min(minN, n); maxN = Math.max(maxN, n)
  }
  minE -= marginM; maxE += marginM; minN -= marginM; maxN += marginM
  const fc0 = Math.floor((minE - r.originX) / r.resX)
  const fc1 = Math.ceil((maxE - r.originX) / r.resX)
  const fr0 = Math.floor((r.originY - maxN) / -r.resY)
  const fr1 = Math.ceil((r.originY - minN) / -r.resY)
  const c0 = Math.max(0, fc0), c1 = Math.min(r.width, fc1)
  const r0 = Math.max(0, fr0), r1 = Math.min(r.height, fr1)
  if (c1 <= c0 || r1 <= r0) return null
  return { c0, r0, c1, r1, clipped: c0 !== fc0 || c1 !== fc1 || r0 !== fr0 || r1 !== fr1 }
}

/** Ground corners of a pixel window, [lng, lat] in TL, TR, BR, BL order. */
export function windowCorners(tm: TmParams, r: Raster, w: PixelWindow): Corners {
  const x0 = r.originX + w.c0 * r.resX, x1 = r.originX + w.c1 * r.resX
  const y0 = r.originY + w.r0 * r.resY, y1 = r.originY + w.r1 * r.resY
  const ll = (x: number, y: number): LngLat => {
    const [lng, lat] = tmInverse(tm, x, y)
    return [round7(lng), round7(lat)]
  }
  return [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)]
}

function round7(v: number): number {
  return Math.round(v * 1e7) / 1e7
}

export function pointInRing(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Sentinel-2 scene classes (SCL) that hide the ground: 3 cloud shadow,
 * 8 cloud (medium), 9 cloud (high), 10 thin cirrus. 0 is no data and 1 is
 * saturated/defective — counted apart, so a site at a swath edge reads as
 * "no picture" rather than "cloudy".
 */
const SCL_CLOUDY = new Set([3, 8, 9, 10])
const SCL_NODATA = new Set([0, 1])

export interface ZoneCover {
  /** Pixels whose centre is inside the site (or every window pixel, for a site smaller than a few pixels). */
  pixels: number
  cloudyPct: number
  nodataPct: number
}

/**
 * How much of the SITE (not the tile) the clouds cover, from an SCL window.
 * A site smaller than four classification pixels is judged on the whole
 * window — one 20 m pixel can't speak for it alone.
 */
export function sclZoneCover(tm: TmParams, ring: Ring, r: Raster, w: PixelWindow, scl: ArrayLike<number>): ZoneCover {
  const pts = projectRing(tm, ring)
  const ww = w.c1 - w.c0, wh = w.r1 - w.r0
  let inside = 0, cloudy = 0, nodata = 0
  let all = 0, allCloudy = 0, allNodata = 0
  for (let j = 0; j < wh; j++) {
    const y = r.originY + (w.r0 + j + 0.5) * r.resY
    for (let i = 0; i < ww; i++) {
      const v = scl[j * ww + i]
      const bad = SCL_CLOUDY.has(v), none = SCL_NODATA.has(v)
      all++
      if (bad) allCloudy++
      if (none) allNodata++
      const x = r.originX + (w.c0 + i + 0.5) * r.resX
      if (!pointInRing(x, y, pts)) continue
      inside++
      if (bad) cloudy++
      if (none) nodata++
    }
  }
  if (inside >= 4) return { pixels: inside, cloudyPct: (100 * cloudy) / inside, nodataPct: (100 * nodata) / inside }
  return { pixels: all, cloudyPct: all ? (100 * allCloudy) / all : 100, nodataPct: all ? (100 * allNodata) / all : 100 }
}

/**
 * The picture's pixels as RGBA: transparent where the satellite had no data
 * (all three bands 0 — the TCI / ortho_visual nodata), or where a 4th band
 * (alpha mask) says so. Returns the share of the window that was empty.
 */
export function toRgba(raw: ArrayLike<number>, pixels: number, samples: number): { rgba: Uint8Array; emptyPct: number } {
  const rgba = new Uint8Array(pixels * 4)
  let empty = 0
  for (let p = 0; p < pixels; p++) {
    const s = p * samples
    const r = raw[s], g = raw[s + 1], b = raw[s + 2]
    const masked = samples >= 4 ? raw[s + 3] === 0 : r === 0 && g === 0 && b === 0
    rgba[p * 4] = r
    rgba[p * 4 + 1] = g
    rgba[p * 4 + 2] = b
    rgba[p * 4 + 3] = masked ? 0 : 255
    if (masked) empty++
  }
  return { rgba, emptyPct: pixels ? (100 * empty) / pixels : 100 }
}

/**
 * The calendar day a scene shows, at the site: acquisition time shifted by
 * the site's solar offset (longitude ÷ 15 h). Both constellations image
 * mid-morning local time, so this is the date the crew on site lived — UTC's
 * date is a day off for a morning pass anywhere east of ~150°E.
 */
export function localSolarDate(iso: string, lng: number): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t) || !Number.isFinite(lng)) return null
  return new Date(t + (lng / 15) * 3_600_000).toISOString().slice(0, 10)
}

/** A lng/lat rectangle around the site plus `marginM` — the area a Planet order clips to. */
export function siteBoxWithMargin(ring: Ring, marginM: number): LngLatBox {
  const b = ringBox(ring)
  const lat = (b.minLat + b.maxLat) / 2
  const dLat = marginM / 110_574
  const dLng = marginM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return { minLng: b.minLng - dLng, minLat: b.minLat - dLat, maxLng: b.maxLng + dLng, maxLat: b.maxLat + dLat }
}

/** A site's ground extent in metres, measured in grid `tm`. */
export function siteExtentM(tm: TmParams, ring: Ring): { widthM: number; heightM: number } {
  const pts = projectRing(tm, ring)
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity
  for (const [e, n] of pts) {
    minE = Math.min(minE, e); maxE = Math.max(maxE, e)
    minN = Math.min(minN, n); maxN = Math.max(maxN, n)
  }
  return { widthM: maxE - minE, heightM: maxN - minN }
}

/** The box a site's picture covers: its outline's extent plus marginFor() of context all round. */
export function siteAoiBox(ring: Ring): LngLatBox {
  const { widthM, heightM } = siteExtentM(siteTm(ring), ring)
  return siteBoxWithMargin(ring, marginFor(widthM, heightM))
}

/** A closed GeoJSON polygon for a box. */
export function boxPolygon(b: LngLatBox): { type: 'Polygon'; coordinates: number[][][] } {
  return {
    type: 'Polygon',
    coordinates: [[[b.minLng, b.minLat], [b.maxLng, b.minLat], [b.maxLng, b.maxLat], [b.minLng, b.maxLat], [b.minLng, b.minLat]]],
  }
}

/** Ground size of a lng/lat box: width and height in metres, area in km². */
export function boxSize(b: LngLatBox): { widthM: number; heightM: number; km2: number } {
  const lat = (b.minLat + b.maxLat) / 2
  const widthM = (b.maxLng - b.minLng) * 111_320 * Math.cos((lat * Math.PI) / 180)
  const heightM = (b.maxLat - b.minLat) * 110_574
  return { widthM, heightM, km2: (widthM * heightM) / 1e6 }
}
