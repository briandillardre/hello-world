/**
 * Drone survey surfaces (DSM GeoTIFFs) — server-only reads.
 *
 * The file sits in the private `dirt` bucket; it is opened through a short
 * signed URL with HTTP range requests (geotiff.js), so only the pile's window
 * is read, never the whole survey. Coordinate system and units come from the
 * file's own GeoKeys (lib/dirt/stockpile.ts → dsmCrs).
 */
import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff'
import { dsmCrs, planPileGrid, sampleToFrame, sourceWindow, srcResM, type DsmCrs, type RasterGeo, type ZUnits } from './stockpile'
import type { Frame } from './tm'
import type { Poly } from './geom'
import type { GridSurface } from './surface'

/** Most pixels one measurement reads from the file (an overview is used past this). */
const MAX_WINDOW_PX = 9_000_000

export interface DsmInfo {
  crs: DsmCrs
  zScaleM: number
  words: string
  geo: RasterGeo
  /** lng/lat corners box of the survey. */
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null
  resM: number
}

function geoOf(img: GeoTIFFImage): RasterGeo {
  const [ox, oy] = img.getOrigin()
  const [rx, ry] = img.getResolution()
  return { originX: ox, originY: oy, resX: rx, resY: ry, width: img.getWidth(), height: img.getHeight() }
}

export async function openDsm(url: string, signal: AbortSignal): Promise<GeoTIFF> {
  return fromUrl(url, { allowFullFile: false }, signal)
}

/** Validate a survey file and describe it. */
export async function describeDsm(tiff: GeoTIFF, zUnits: ZUnits): Promise<{ ok: true; info: DsmInfo } | { ok: false; error: string }> {
  const img = await tiff.getImage(0)
  if (img.getSamplesPerPixel() !== 1) return { ok: false, error: 'This GeoTIFF has colour bands — upload the elevation (DSM / DEM) export, not the orthophoto.' }
  const c = dsmCrs(img.getGeoKeys() as Record<string, unknown>, zUnits)
  if (!c.ok) return c
  const geo = geoOf(img)
  if (!(geo.resX > 0) || !(geo.resY < 0)) return { ok: false, error: 'This GeoTIFF is rotated or flipped — export it north-up.' }
  let bounds: DsmInfo['bounds'] = null
  if (c.crs.kind === 'geo') {
    bounds = { minLng: geo.originX, maxLng: geo.originX + geo.width * geo.resX, maxLat: geo.originY, minLat: geo.originY + geo.height * geo.resY }
  } else {
    const { tmInverse, utmParams } = await import('./tm')
    const p = utmParams(c.crs.zone, c.crs.south)
    const u = c.crs.unitM
    const xs = [geo.originX, geo.originX + geo.width * geo.resX].map(v => v * u)
    const ys = [geo.originY, geo.originY + geo.height * geo.resY].map(v => v * u)
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    for (const x of xs) for (const y of ys) {
      const [lng, lat] = tmInverse(p, x, y)
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
    }
    bounds = { minLng, minLat, maxLng, maxLat }
  }
  if (![bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat].every(Number.isFinite) || Math.abs(bounds.minLat) > 85) {
    return { ok: false, error: 'This survey’s location doesn’t read as a place on Earth — check the export’s coordinate system.' }
  }
  const resM = srcResM(c.crs, geo, (bounds.minLat + bounds.maxLat) / 2)
  return { ok: true, info: { crs: c.crs, zScaleM: c.zScaleM, words: c.words, geo, bounds, resM } }
}

/** Read the survey under a toe (frame metres) as a GridSurface in the same frame. */
export async function dsmSurface(tiff: GeoTIFF, info: DsmInfo, frame: Frame, ring: Poly, signal: AbortSignal): Promise<{ surface: GridSurface; resM: number; filled: number; nodes: number }> {
  const count = await tiff.getImageCount()
  const img0 = await tiff.getImage(0)
  // Pick the finest level whose window fits the budget (overviews share image 0's placement).
  let level = 0
  let geo = info.geo
  let plan = planPileGrid(ring, info.resM)
  let win = sourceWindow(frame, plan, info.crs, geo)
  if (!win) throw new Error('outside')
  while ((win[2] - win[0]) * (win[3] - win[1]) > MAX_WINDOW_PX && level + 1 < count) {
    level++
    const img = await tiff.getImage(level)
    const [rx, ry] = img.getResolution(img0)
    geo = { originX: info.geo.originX, originY: info.geo.originY, resX: rx, resY: ry, width: img.getWidth(), height: img.getHeight() }
    plan = planPileGrid(ring, info.resM * (rx / info.geo.resX))
    win = sourceWindow(frame, plan, info.crs, geo)
    if (!win) throw new Error('outside')
  }
  if ((win[2] - win[0]) * (win[3] - win[1]) > MAX_WINDOW_PX * 1.5) throw new Error('too-big')
  const img = level === 0 ? img0 : await tiff.getImage(level)
  const data = (await img.readRasters({ window: win, interleave: true, signal })) as unknown as ArrayLike<number>
  const { surface, filled } = sampleToFrame(frame, plan, info.crs, geo, {
    c0: win[0], r0: win[1], w: win[2] - win[0], h: win[3] - win[1], data, nodata: img0.getGDALNoData(),
  }, info.zScaleM)
  return { surface, resM: plan.dx, filled, nodes: plan.nx * plan.ny }
}
