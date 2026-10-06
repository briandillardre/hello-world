/**
 * Sentinel-2 over a site — server-only (the cron). Free and open Copernicus
 * data, 10 m, a pass every few days (81 over Greenville in the year to Sep
 * 2026, 30 of them under 20 % cloud).
 *
 * 1. Earth Search (Element 84's public STAC catalog on AWS) lists the L2A
 *    scenes over the site — pre-filtered on the whole tile's cloud.
 * 2. The SITE's own cloud is read from the scene classification (SCL, 20 m)
 *    under its outline: a tile that is 40 % cloud can be clear over the site,
 *    and a "clear" tile can have the one cloud that matters.
 * 3. The true-colour picture (TCI, the `visual` asset) is read for the site
 *    plus a margin of context — a window of a cloud-optimised GeoTIFF over
 *    HTTP range requests (the lib/dirt/ground.ts approach), a few hundred KB
 *    for a typical site — and comes back as a PNG with its four lng/lat
 *    corners for the map.
 */
import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff'
import { encodePng } from '../dirt/png'
import {
  marginFor, sclZoneCover, siteExtentM, toRgba, utmFromEpsg, windowCorners, windowFor,
  type Corners, type LngLatBox, type Raster, type Ring, type ZoneCover,
} from './geo'
import { parseStacSearch, type SceneCandidate } from './scenes'

export const EARTH_SEARCH = 'https://earth-search.aws.element84.com/v1/search'
/** Collection 1: the consistently reprocessed L2A archive (the older `sentinel-2-l2a` is frozen in time). */
export const S2_COLLECTION = 'sentinel-2-c1-l2a'
/** Catalog pre-filter on the whole 110 km tile; the site is judged on its own pixels. */
export const S2_TILE_CLOUD_MAX = 60
/** A site counts as clear with at most this share of it under cloud, shadow or cirrus… */
export const S2_SITE_CLOUD_MAX = 5
/** …and at most this share of it outside the picture (swath edge). */
export const S2_SITE_NODATA_MAX = 5
/** Largest picture read, pixels (≈ 15 km² at 10 m) — the subscribe action caps sites well below this. */
const MAX_PIXELS = 400 * 400

export interface SitePicture {
  png: Uint8Array
  width: number
  height: number
  /** [lng, lat] TL, TR, BR, BL — the `zone_imagery.bounds` order. */
  corners: Corners
  /** Share of the picture with no data, 0–100. */
  emptyPct: number
  gsdM: number
}

export async function searchSentinel2(box: LngLatBox, fromIso: string, toIso: string, signal: AbortSignal): Promise<SceneCandidate[]> {
  const body = {
    collections: [S2_COLLECTION],
    bbox: [box.minLng, box.minLat, box.maxLng, box.maxLat],
    datetime: `${fromIso}/${toIso}`,
    query: { 'eo:cloud_cover': { lte: S2_TILE_CLOUD_MAX } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    limit: 100,
  }
  const r = await fetch(EARTH_SEARCH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/geo+json, application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok) throw new Error(`Earth Search answered ${r.status}`)
  return parseStacSearch(await r.json())
}

// One cron run reads the same tile for several sites — keep a few open. The
// header read gets its own timeout: a cached tiff must not carry the abort
// signal of whichever site opened it.
const cogs = new Map<string, Promise<GeoTIFF>>()
function openCog(href: string): Promise<GeoTIFF> {
  let p = cogs.get(href)
  if (!p) {
    p = fromUrl(href, { allowFullFile: false }, AbortSignal.timeout(20_000))
    p.catch(() => cogs.delete(href))
    cogs.set(href, p)
    while (cogs.size > 12) cogs.delete(cogs.keys().next().value as string)
  }
  return p
}

function rasterOf(img: GeoTIFFImage): Raster {
  const [originX, originY] = img.getOrigin()
  const [resX, resY] = img.getResolution()
  return { originX, originY, resX, resY, width: img.getWidth(), height: img.getHeight() }
}

function siteGrid(c: SceneCandidate) {
  const utm = c.epsg ? utmFromEpsg(c.epsg) : null
  if (!utm) throw new Error(`scene ${c.id} is not on a UTM grid`)
  return utm
}

/**
 * How much of the site this scene's clouds cover, from the scene
 * classification under the outline. A site this tile cuts off at its edge
 * reads as 100 % no data — the neighbouring tile of the same pass has it whole.
 */
export async function siteCover(c: SceneCandidate, ring: Ring, signal: AbortSignal): Promise<ZoneCover> {
  if (!c.sclHref) throw new Error('no scene classification')
  const { tm } = siteGrid(c)
  const img = await (await openCog(c.sclHref)).getImage(0)
  const r = rasterOf(img)
  const w = windowFor(tm, ring, r, 0)
  if (!w || w.clipped) return { pixels: 0, cloudyPct: 0, nodataPct: 100 }
  const raw = (await img.readRasters({ window: [w.c0, w.r0, w.c1, w.r1], interleave: true, signal })) as unknown as ArrayLike<number>
  return sclZoneCover(tm, ring, r, w, raw)
}

/** The site plus its margin of context as a PNG, with the four corners the map draws it at. */
export async function readSitePicture(c: SceneCandidate, ring: Ring, signal: AbortSignal): Promise<SitePicture> {
  if (!c.visualHref) throw new Error('no true-colour picture')
  const { tm } = siteGrid(c)
  const img = await (await openCog(c.visualHref)).getImage(0)
  const r = rasterOf(img)
  const { widthM, heightM } = siteExtentM(tm, ring)
  const w = windowFor(tm, ring, r, marginFor(widthM, heightM))
  if (!w) throw new Error('the site is outside this scene')
  const width = w.c1 - w.c0, height = w.r1 - w.r0
  if (width * height > MAX_PIXELS) throw new Error('the site is too big for one picture')
  const raw = (await img.readRasters({ window: [w.c0, w.r0, w.c1, w.r1], interleave: true, signal })) as unknown as ArrayLike<number>
  const { rgba, emptyPct } = toRgba(raw, width * height, img.getSamplesPerPixel())
  return {
    png: encodePng(width, height, rgba),
    width,
    height,
    corners: windowCorners(tm, r, w),
    emptyPct,
    gsdM: Math.abs(r.resX),
  }
}
