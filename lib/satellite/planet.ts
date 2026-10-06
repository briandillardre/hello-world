/**
 * PlanetScope over a site — server-only, and DEAD without `PL_API_KEY`.
 *
 * Daily 3 m pictures, ordered one site-sized clip at a time:
 *   1. Data API quick-search lists the PSScene items over the site's box
 *      (standard quality, downloadable visual product, mostly clear scenes).
 *   2. The item coverage endpoint estimates how clear the SITE is in each
 *      (`mode=estimate`, synchronous) — scene-wide clear % can hide the one
 *      cloud over the job.
 *   3. Orders API: one order per day, the `visual` bundle clipped to the
 *      site's box. Orders take minutes, so the cron places them and collects
 *      them later in the same run or the next one.
 *   4. The clipped GeoTIFF (8-bit RGB, UTM) becomes the same PNG + corners
 *      shape Sentinel-2 produces.
 *
 * LICENCE — read docs/SATELLITE.md before setting the key. Planet's standard
 * terms (self-serve Terms of Use and the Master Content License Agreement)
 * do not let us show Planet pictures to our customers; that takes an order
 * schedule that grants it (the "Powered by Planet" partner route). Pictures
 * are stored in the PRIVATE `satellite` bucket and shown through a signed-in
 * route, never a public link, and carry "© Planet Labs PBC".
 */
import { fromArrayBuffer } from 'geotiff'
import { encodePng } from '../dirt/png'
import { toRgba, utmFromEpsg, windowCorners, type Raster } from './geo'
import { parsePlanetSearch, type SceneCandidate } from './scenes'
import type { SitePicture } from './sentinel2'

const API = 'https://api.planet.com'
/** Scene-wide clear share a candidate needs before we ask about the site itself. */
export const PLANET_SCENE_CLEAR_MIN = 60
/** Site clear share an order needs. */
export const PLANET_SITE_CLEAR_MIN = 90
/** Largest clip we decode, bytes / pixels. */
const MAX_BYTES = 40 * 1024 * 1024
const MAX_PIXELS = 2000 * 2000
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Polygon = { type: 'Polygon'; coordinates: number[][][] }

export function planetKey(): string | null {
  const k = process.env.PL_API_KEY?.trim()
  return k ? k : null
}

/** Is the Planet path alive at all? (No key, no calls, and the UI says so.) */
export function planetReady(): boolean {
  return planetKey() !== null
}

function headers(): Record<string, string> {
  const key = planetKey()
  if (!key) throw new Error('Planet is not set up (PL_API_KEY)')
  return { authorization: `api-key ${key}`, 'content-type': 'application/json', accept: 'application/json' }
}

async function planetJson(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) }, signal })
  if (!r.ok) throw new Error(`Planet answered ${r.status} on ${path.split('?')[0]}`)
  return r.json()
}

export async function searchPlanet(aoi: Polygon, fromIso: string, toIso: string, signal: AbortSignal): Promise<SceneCandidate[]> {
  const body = {
    item_types: ['PSScene'],
    filter: {
      type: 'AndFilter',
      config: [
        { type: 'GeometryFilter', field_name: 'geometry', config: aoi },
        { type: 'DateRangeFilter', field_name: 'acquired', config: { gte: fromIso, lte: toIso } },
        { type: 'RangeFilter', field_name: 'clear_percent', config: { gte: PLANET_SCENE_CLEAR_MIN } },
        { type: 'StringInFilter', field_name: 'quality_category', config: ['standard'] },
        { type: 'PermissionFilter', config: ['assets:download'] },
        { type: 'AssetFilter', config: ['ortho_visual'] },
      ],
    },
  }
  const json = await planetJson('/data/v1/quick-search?_sort=acquired%20desc&_page_size=50', { method: 'POST', body: JSON.stringify(body) }, signal)
  return parsePlanetSearch(json)
}

/** Clear share of the SITE in one scene (Planet's quick estimate). Null when Planet can't say. */
export async function siteClearPct(itemId: string, aoi: Polygon, signal: AbortSignal): Promise<number | null> {
  try {
    const json = await planetJson(
      `/data/v1/item-types/PSScene/items/${encodeURIComponent(itemId)}/coverage?mode=estimate&band=clear`,
      { method: 'POST', body: JSON.stringify({ geometry: aoi }) },
      signal,
    ) as { clear_percent?: unknown }
    const v = Number(json?.clear_percent)
    return Number.isFinite(v) ? v : null
  } catch (e) {
    if (signal.aborted) throw e
    return null
  }
}

/** One order: the scene's visual product clipped to the site box. Returns the order id. */
export async function placeOrder(itemId: string, aoi: Polygon, name: string, signal: AbortSignal): Promise<string> {
  const body = {
    name: name.slice(0, 120),
    source_type: 'scenes',
    products: [{ item_ids: [itemId], item_type: 'PSScene', product_bundle: 'visual' }],
    tools: [{ clip: { aoi } }],
  }
  const json = await planetJson('/compute/ops/orders/v2', { method: 'POST', body: JSON.stringify(body) }, signal) as { id?: unknown }
  const id = typeof json?.id === 'string' ? json.id : ''
  if (!ORDER_ID.test(id)) throw new Error('Planet did not return an order id')
  return id
}

export type OrderState = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled'

/** Where an order stands, and the link to its clipped visual GeoTIFF once it is done. */
export async function orderStatus(orderId: string, signal: AbortSignal): Promise<{ state: OrderState; location: string | null }> {
  if (!ORDER_ID.test(orderId)) throw new Error('bad order id')
  const json = await planetJson(`/compute/ops/orders/v2/${orderId}`, { method: 'GET' }, signal) as {
    state?: unknown; _links?: { results?: { name?: unknown; location?: unknown }[] | null }
  }
  const state = (['queued', 'running', 'success', 'partial', 'failed', 'cancelled'] as const).find((s) => s === json?.state) ?? 'running'
  let location: string | null = null
  for (const r of json?._links?.results ?? []) {
    if (typeof r?.name === 'string' && /_Visual(?:_clip)?\.tif$/i.test(r.name) && typeof r.location === 'string' && planetHost(r.location)) {
      location = r.location
      break
    }
  }
  return { state, location }
}

/** Download links must stay on Planet's own hosts — the cron never follows a link a response invented. */
export function planetHost(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'api.planet.com' || u.hostname.endsWith('.planet.com'))
  } catch {
    return false
  }
}

/** The clipped visual GeoTIFF → PNG + corners (same shape as a Sentinel-2 picture). */
export async function downloadPicture(location: string, signal: AbortSignal): Promise<SitePicture> {
  if (!planetHost(location)) throw new Error('download link is not on planet.com')
  const r = await fetch(location, { headers: { authorization: headers().authorization }, signal })
  if (!r.ok) throw new Error(`Planet download answered ${r.status}`)
  const len = Number(r.headers.get('content-length'))
  if (Number.isFinite(len) && len > MAX_BYTES) throw new Error('Planet picture too large')
  const buf = await r.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error('Planet picture too large')
  const tiff = await fromArrayBuffer(buf, signal)
  const img = await tiff.getImage(0)
  const epsg = Number(img.getGeoKeys()?.ProjectedCSTypeGeoKey)
  const utm = utmFromEpsg(epsg)
  if (!utm) throw new Error(`Planet picture is not on a UTM grid (${epsg})`)
  const [originX, originY] = img.getOrigin()
  const [resX, resY] = img.getResolution()
  const width = img.getWidth(), height = img.getHeight()
  if (width * height > MAX_PIXELS) throw new Error('Planet picture too large')
  const raster: Raster = { originX, originY, resX, resY, width, height }
  const raw = (await img.readRasters({ interleave: true, signal })) as unknown as ArrayLike<number>
  const { rgba, emptyPct } = toRgba(raw, width * height, img.getSamplesPerPixel())
  return {
    png: encodePng(width, height, rgba),
    width,
    height,
    corners: windowCorners(utm.tm, raster, { c0: 0, r0: 0, c1: width, r1: height, clipped: false }),
    emptyPct,
    gsdM: Math.abs(resX),
  }
}
