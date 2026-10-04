/**
 * Existing ground for a takeoff, straight from USGS — server-only.
 *
 * 1. The National Map products API lists the 1-metre lidar DEM tiles under
 *    the site (bare earth, NAVD88 metres, cut in NAD83 / UTM). Each tile is a
 *    cloud-optimised GeoTIFF on S3, so we read ONLY the site's window over
 *    HTTP range requests (~2.5 s for a 300 m site; verified against
 *    downtown Greenville's 2019 Savannah–Pee Dee flight, Oct 4 2026).
 * 2. Newest tile wins where tiles overlap; nodes no 1 m tile covers are
 *    filled from the 3DEP ImageServer's best-available mosaic (often 10 m —
 *    the header says so, and the takeoff warns).
 * 3. Results are cached: in memory per instance and in the private `dirt`
 *    bucket, keyed by company + the snapped UTM grid, so the editor's preview
 *    and the server's authoritative run read the same numbers. Per company on
 *    purpose: a shared cache would let one customer tell (by speed) that
 *    another had already pulled a site. A read that partly failed is never
 *    stored — USGS blinked, and the next read should try again.
 */
import { fromArrayBuffer, fromUrl, type GeoTIFFImage } from 'geotiff'
import { decodeGround, encodeGround, type GroundHeader } from './ground-format'
import { planGrid, type GridPlan, type LngLatBox } from './ground-box'
import { tmInverse, utmParams } from './tm'
import type { GroundGrid } from './takeoff'

const TNM = 'https://tnmaccess.nationalmap.gov/api/v1/products'
/** The only place 1 m tiles are read from (TNM's own S3 bucket). */
const TILE_URL = /^https:\/\/prd-tnm\.s3\.amazonaws\.com\/StagedProducts\/Elevation\/1m\/[A-Za-z0-9_./-]+\.tif$/i
const IMAGESERVER = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
interface TnmItem { title: string; downloadURL: string; publicationDate?: string }

async function listTiles(b: LngLatBox, signal: AbortSignal): Promise<TnmItem[]> {
  const q = new URLSearchParams({
    datasets: 'Digital Elevation Model (DEM) 1 meter',
    bbox: `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`,
    max: '12',
    outputFormat: 'JSON',
  })
  const r = await fetch(`${TNM}?${q}`, { signal, headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`tnm ${r.status}`)
  const j = (await r.json()) as { items?: TnmItem[] }
  return (j.items ?? [])
    .filter(i => typeof i.downloadURL === 'string' && TILE_URL.test(i.downloadURL) && !i.downloadURL.includes('..'))
    .sort((a, c) => (c.publicationDate ?? '').localeCompare(a.publicationDate ?? '') || projectYear(c.title) - projectYear(a.title))
}

function projectYear(title: string): number {
  const m = title.match(/_(19|20)(\d{2})(?:_|$)/)
  return m ? Number(m[1] + m[2]) : 0
}

/** Plain words for the source line: "USGS 1 m lidar · SC_SavannahPeeDee_2019". */
function projectName(title: string): string {
  const m = title.match(/(?:USGS 1 Meter \d+ x\d+y\d+ |USGS one meter x\d+y\d+ )(.+)$/i)
  return (m?.[1] ?? title).replace(/_[A-Z]\d{2}$/, '').trim()
}

const NODATA = (v: number) => !Number.isFinite(v) || v < -1000 || v > 10000

/** The grid's own extent in lng/lat — what the tile list is asked for, so the tiles depend only on the cache key. */
function planLngLatBox(p: GridPlan): LngLatBox {
  const tm = utmParams(p.zone)
  const xs = [p.x0 - p.dx / 2, p.x0 + (p.nx - 1) * p.dx / 2, p.x0 + (p.nx - 0.5) * p.dx]
  const ys = [p.y0 - p.dx / 2, p.y0 + (p.ny - 1) * p.dx / 2, p.y0 + (p.ny - 0.5) * p.dx]
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const x of xs) for (const y of ys) {
    const [lng, lat] = tmInverse(tm, x, y)
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }
  return { minLng, minLat, maxLng, maxLat }
}

/**
 * Fill NaN nodes of `z` from one GeoTIFF image (any alignment — bilinear when
 * off-grid). Origin and pixel size come from the caller: a COG's overview
 * levels carry no georeferencing of their own (they share image 0's).
 */
async function fillFromImage(img: GeoTIFFImage, origin: number[], res: number[], p: GridPlan, z: Float32Array, signal: AbortSignal): Promise<number> {
  const [ox, oy] = origin
  const [rx, ry] = res
  const w = img.getWidth(), h = img.getHeight()
  // Pixel-centre coordinates: x = ox + (c + .5)·rx, y = oy + (r + .5)·ry (ry < 0).
  const colOf = (x: number) => (x - ox) / rx - 0.5
  const rowOf = (y: number) => (y - oy) / ry - 0.5
  const xMin = p.x0, xMax = p.x0 + (p.nx - 1) * p.dx
  const yMin = p.y0, yMax = p.y0 + (p.ny - 1) * p.dx
  const c0 = Math.max(0, Math.floor(colOf(xMin)) - 1), c1 = Math.min(w - 1, Math.ceil(colOf(xMax)) + 1)
  const r0 = Math.max(0, Math.floor(rowOf(yMax)) - 1), r1 = Math.min(h - 1, Math.ceil(rowOf(yMin)) + 1)
  if (c1 < c0 || r1 < r0) return 0
  const ww = c1 - c0 + 1
  const raw: ArrayLike<number> = await img.readRasters({ window: [c0, r0, c1 + 1, r1 + 1], interleave: true, signal })
  const nd = img.getGDALNoData()
  const val = (c: number, r: number) => {
    if (c < c0 || c > c1 || r < r0 || r > r1) return NaN
    const v = raw[(r - r0) * ww + (c - c0)]
    return v === nd || NODATA(v) ? NaN : v
  }
  let filled = 0
  for (let j = 0; j < p.ny; j++) {
    const y = p.y0 + j * p.dx
    const fr = rowOf(y)
    for (let i = 0; i < p.nx; i++) {
      const k = j * p.nx + i
      if (!Number.isNaN(z[k])) continue
      const fc = colOf(p.x0 + i * p.dx)
      const rc = Math.round(fc), rr = Math.round(fr)
      let v: number
      if (Math.abs(fc - rc) < 1e-3 && Math.abs(fr - rr) < 1e-3) v = val(rc, rr)
      else {
        const ci = Math.floor(fc), ri = Math.floor(fr), u = fc - ci, t = fr - ri
        const a = val(ci, ri), b = val(ci + 1, ri), c = val(ci, ri + 1), d = val(ci + 1, ri + 1)
        v = a * (1 - u) * (1 - t) + b * u * (1 - t) + c * (1 - u) * t + d * u * t
      }
      if (Number.isFinite(v)) { z[k] = v; filled++ }
    }
  }
  return filled
}

/** Fetch the grid from USGS (no cache). */
export async function fetchGround(b: LngLatBox, signal: AbortSignal): Promise<{ header: GroundHeader; z: Float32Array }> {
  const p = planGrid(b)
  const z = new Float32Array(p.nx * p.ny).fill(NaN)
  const used: string[] = []
  let filled = 0
  let tilesErr = false
  try {
    const tiles = await listTiles(planLngLatBox(p), signal)
    for (const t of tiles.slice(0, 6)) {
      if (filled >= z.length) break
      try {
        const tiff = await fromUrl(t.downloadURL, { allowFullFile: false }, signal)
        const img0 = await tiff.getImage(0)
        const epsg = Number(img0.getGeoKeys()?.ProjectedCSTypeGeoKey)
        if (epsg !== p.epsg) continue // a tile cut in another UTM zone
        // A coarser grid (big sites step to 2/4/8 m) reads the matching overview.
        const level = Math.min(Math.max(0, Math.round(Math.log2(p.dx))), (await tiff.getImageCount()) - 1)
        const img = level === 0 ? img0 : await tiff.getImage(level)
        const n = await fillFromImage(img, img0.getOrigin(), level === 0 ? img0.getResolution() : img.getResolution(img0), p, z, signal)
        if (n > 0) { filled += n; used.push(t.title) }
      } catch (e) {
        if (signal.aborted) throw e
        tilesErr = true
      }
    }
  } catch (e) {
    if (signal.aborted) throw e
    tilesErr = true
  }
  const lidarNodes = filled
  // Fill what the 1 m tiles didn't cover from the best-available mosaic.
  let mosaic = false
  let mosaicErr = false
  if (filled < z.length) {
    try {
      const half = p.dx / 2
      const q = new URLSearchParams({
        bbox: [p.x0 - half, p.y0 - half, p.x0 + (p.nx - 1) * p.dx + half, p.y0 + (p.ny - 1) * p.dx + half].join(','),
        bboxSR: String(p.epsg), imageSR: String(p.epsg),
        size: `${p.nx},${p.ny}`, format: 'tiff', pixelType: 'F32',
        noDataInterpretation: 'esriNoDataMatchAny', interpolation: 'RSP_BilinearInterpolation', f: 'image',
      })
      if (p.nx <= 8000 && p.ny <= 8000) {
        const r = await fetch(`${IMAGESERVER}?${q}`, { signal })
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('tiff')) mosaicErr = true
        else {
          const tiff = await fromArrayBuffer(await r.arrayBuffer(), signal)
          const img = await tiff.getImage()
          const raw: ArrayLike<number> = await img.readRasters({ interleave: true, signal })
          const nd = img.getGDALNoData()
          for (let j = 0; j < p.ny; j++) {
            const src = (p.ny - 1 - j) * p.nx // image row 0 = north
            for (let i = 0; i < p.nx; i++) {
              const k = j * p.nx + i
              if (!Number.isNaN(z[k])) continue
              const v = raw[src + i]
              if (v !== nd && !NODATA(v)) { z[k] = v; filled++; mosaic = true }
            }
          }
        }
      }
    } catch (e) {
      if (signal.aborted) throw e
      mosaicErr = true
    }
  }
  const lidarShare = z.length ? lidarNodes / z.length : 0
  const names = Array.from(new Set(used.map(projectName)))
  const source = lidarShare >= 0.98
    ? `USGS 1 m lidar · ${names.join(', ')}`
    : lidarShare > 0
      ? `USGS 1 m lidar · ${names.join(', ')} + coarser 3DEP fill (${Math.round((1 - lidarShare) * 100)}%)`
      : mosaic
        ? 'USGS 3DEP elevation (coarser than 1 m here — about 10 m)'
        : tilesErr ? 'USGS elevation did not answer' : 'No USGS elevation here'
  const header: GroundHeader = {
    zone: p.zone, epsg: p.epsg, x0: p.x0, y0: p.y0, dx: p.dx, dy: p.dx, nx: p.nx, ny: p.ny,
    source,
    resolutionM: lidarShare >= 0.98 ? p.dx : 10,
    coverage: z.length ? filled / z.length : 0,
    tiles: used,
    ...(tilesErr || mosaicErr ? { partial: true } : {}),
  }
  return { header, z }
}

// ── Caching ──────────────────────────────────────────────────────────────

interface MemEntry { bytes: Uint8Array; partial: boolean; at: number; stored: string | null }
const mem = new Map<string, MemEntry>()
const MEM_CAP = 6
const PARTIAL_TTL_MS = 5 * 60_000

function remember(key: string, e: MemEntry) {
  mem.delete(key)
  mem.set(key, e)
  while (mem.size > MEM_CAP) mem.delete(mem.keys().next().value as string)
}

/** New USGS reads (cache misses) per person: 10 per 10 minutes — the route and Save share it. */
const MISS_LIMIT = 10
const MISS_WINDOW_MS = 10 * 60_000
const misses = new Map<string, number[]>()

export class GroundBusy extends Error {
  constructor() {
    super('Too many new lidar reads in a few minutes — try again shortly.')
    this.name = 'GroundBusy'
  }
}

function spendMiss(who: string): boolean {
  const now = Date.now()
  const hits = (misses.get(who) ?? []).filter(t => now - t < MISS_WINDOW_MS)
  if (hits.length >= MISS_LIMIT) { misses.set(who, hits); return false }
  hits.push(now)
  misses.set(who, hits)
  if (misses.size > 5000) misses.clear()
  return true
}

type Svc = { storage: { from(b: string): {
  download(p: string): Promise<{ data: Blob | null; error: unknown }>
  upload(p: string, body: Uint8Array, o: { contentType: string; upsert: boolean }): Promise<{ error: unknown }>
} } }

/** Storage path of a company's cached grid (flat, so the health cron can age it out with one listing). */
export function groundPath(companyId: string, key: string): string {
  return `ground/${companyId}_${key.replace(/\//g, '_')}.bin`
}

/**
 * The grid for a box, cached per company. Returns the encoded bytes, the
 * decoded grid (what the server-side run uses), and — when the grid sits in
 * the bucket — its storage path, so the route can hand the browser a signed
 * link instead of pushing megabytes through a function. A read with no data
 * at all is returned but never cached (USGS may simply have been down); a
 * partial read stays in memory for 5 minutes only.
 */
export async function groundCached(
  svc: Svc | null,
  b: LngLatBox,
  signal: AbortSignal,
  opts: { companyId: string; who?: string },
): Promise<{ bytes: Uint8Array; grid: GroundGrid; header: GroundHeader; cached: boolean; stored: string | null }> {
  const p = planGrid(b)
  const key = `${opts.companyId}/${p.key}`
  const path = groundPath(opts.companyId, p.key)
  const hit = mem.get(key)
  if (hit && hit.partial && Date.now() - hit.at > PARTIAL_TTL_MS) mem.delete(key)
  else if (hit) {
    const d = decodeGround(hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength) as ArrayBuffer)
    if (d) return { bytes: hit.bytes, grid: d.grid, header: d.header, cached: true, stored: hit.stored }
  }
  if (svc) {
    try {
      const { data } = await svc.storage.from('dirt').download(path)
      if (data) {
        const buf = await data.arrayBuffer()
        const d = decodeGround(buf)
        if (d) {
          const bytes = new Uint8Array(buf)
          remember(key, { bytes, partial: false, at: Date.now(), stored: path })
          return { bytes, grid: d.grid, header: d.header, cached: true, stored: path }
        }
      }
    } catch { /* fall through to USGS */ }
  }
  if (opts.who && !spendMiss(opts.who)) throw new GroundBusy()
  const { header, z } = await fetchGround(b, signal)
  const bytes = encodeGround(header, z)
  let stored: string | null = null
  if (header.coverage > 0) {
    if (svc && !header.partial) {
      try {
        const { error } = await svc.storage.from('dirt').upload(path, bytes, { contentType: 'application/octet-stream', upsert: true })
        if (!error) stored = path
      } catch { /* cache is best-effort */ }
    }
    remember(key, { bytes, partial: !!header.partial, at: Date.now(), stored })
  }
  return {
    bytes,
    grid: { zone: header.zone, epsg: header.epsg, x0: header.x0, y0: header.y0, dx: header.dx, dy: header.dy, nx: header.nx, ny: header.ny, z, source: header.source, resolutionM: header.resolutionM },
    header,
    cached: false,
    stored,
  }
}
