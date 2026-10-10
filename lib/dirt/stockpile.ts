/**
 * Stockpile volumes — pure (harness: scripts/dirt-test.mjs).
 *
 * Brian, Oct 2026: a stockpile option like Propeller's "point, click and
 * calculate from current drone survey data". The estimator draws the pile's
 * TOE on the map; the top is the surveyed surface (a drone DSM the company
 * uploaded, else USGS lidar with a warning); the BASE is either
 *
 *  - 'tin'    — a triangulated surface through heights sampled along the toe
 *               (the ground the pile sits on, as the toe shows it), or
 *  - 'lowest' — a flat floor at the lowest toe height (a pile against a wall,
 *               or in a bin, measured down to the yard).
 *
 * The integration is the takeoff's: every top triangle is clipped by every
 * base triangle it meets (both planes linear on the convex piece), cut along
 * the toe's edges, and the pieces inside the toe are integrated EXACTLY
 * (polyPosNeg). Volume above the base is the pile; volume below it (a hole
 * inside the toe) is reported apart, never netted silently.
 */
import { BinIndex, type Box, boxOf, boxesOverlap, ccw, centroid, clipByTriangle, pointInRing, polyArea, polyPosNeg, ringSelfCrosses, segmentCrosses, splitByLine, type Poly } from './geom'
import { buildTin, GridSurface, type PlaneTri, type Surface, type TinPoint } from './surface'
import { fromFrame, tmForward, utmParams, type Frame } from './tm'

export const CY_M3 = 0.764554857984
const FT = 0.3048
const SF_M2 = 0.09290304

export type PileBase = 'tin' | 'lowest'

/** Bulk densities, short tons per cubic yard (typical; the estimator edits them). */
export const MATERIALS: { id: string; label: string; tCy: number }[] = [
  { id: 'gravel', label: 'Gravel', tCy: 1.5 },
  { id: 'stone', label: 'Crushed stone (#57 / ABC)', tCy: 1.4 },
  { id: 'sand', label: 'Sand', tCy: 1.35 },
  { id: 'fill', label: 'Fill dirt', tCy: 1.25 },
  { id: 'topsoil', label: 'Topsoil', tCy: 1.1 },
  { id: 'millings', label: 'Asphalt millings', tCy: 1.2 },
  { id: 'other', label: 'Other', tCy: 1.3 },
]

export function materialDensity(id: string): number {
  return MATERIALS.find(m => m.id === id)?.tCy ?? 1.3
}

export class PileError extends Error {
  constructor(msg: string) { super(msg); this.name = 'PileError' }
}

export interface PileMeasure {
  /** Plan area inside the toe that the surface covers, true m² (÷ k²). */
  areaM2: number
  /** Toe ring area, true m². */
  toeAreaM2: number
  volumeM3: number
  /** Volume BELOW the base inside the toe (a hole), m³ — not the pile. */
  belowM3: number
  maxHeightM: number
  baseMinZ: number
  baseMaxZ: number
  /** Share of the toe the surface covers (0–1). */
  coverage: number
  warnings: string[]
}

/** A flat plane at z over any box (the 'lowest' base). */
class FlatSurface implements Surface {
  constructor(private z: number, private b: Box) {}
  zAt(): number { return this.z }
  each(_box: Box, cb: (t: PlaneTri) => void): void {
    const { x0, y0, x1, y1 } = this.b
    cb({ v: [x0, y0, x1, y0, x1, y1], p0: this.z, p1: 0, p2: 0 })
    cb({ v: [x0, y0, x1, y1, x0, y1], p0: this.z, p1: 0, p2: 0 })
  }
}

/**
 * Measure one pile. `ring` is the toe in frame metres (flat [x,y,…], open),
 * `top` the surveyed surface in the same frame, `k` the frame's scale
 * (true area = frame area ÷ k²), `sampleM` the spacing of the toe heights.
 */
export function measurePile(ringIn: Poly, top: Surface, base: PileBase, k: number, opts: { sampleM: number; deadline?: number }): PileMeasure {
  const ring = ccw(ringIn.slice())
  const n = ring.length / 2
  if (n < 3) throw new PileError('Draw the toe with at least three corners.')
  if (ringSelfCrosses(ring)) throw new PileError('The toe crosses itself — redraw it as one loop.')
  const toeArea = polyArea(ring)
  if (toeArea < 1) throw new PileError('That toe is too small to measure.')
  const warnings: string[] = []

  // ── Heights along the toe ──
  const step = Math.max(0.05, opts.sampleM)
  const pts: TinPoint[] = []
  let missing = 0, total = 0
  for (let i = 0; i < n; i++) {
    const ax = ring[2 * i], ay = ring[2 * i + 1]
    const bx = ring[(2 * i + 2) % ring.length], by = ring[(2 * i + 3) % ring.length]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let s = 0; s < steps; s++) {
      const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps
      const z = top.zAt(x, y)
      total++
      if (Number.isFinite(z)) pts.push({ x, y, z, src: 'toe' })
      else missing++
    }
  }
  if (pts.length < 3 || missing > total * 0.25) throw new PileError('The survey doesn’t cover the toe — draw it inside the surveyed area.')
  if (missing) warnings.push(`${Math.round((missing / total) * 100)}% of the toe has no survey height — the base is drawn across those gaps.`)
  let baseMinZ = Infinity, baseMaxZ = -Infinity
  for (const p of pts) { baseMinZ = Math.min(baseMinZ, p.z); baseMaxZ = Math.max(baseMaxZ, p.z) }

  const rb = boxOf(ring)
  let baseSurf: Surface
  if (base === 'lowest') {
    baseSurf = new FlatSurface(baseMinZ, { x0: rb.x0 - 1, y0: rb.y0 - 1, x1: rb.x1 + 1, y1: rb.y1 + 1 })
  } else {
    const edges: [number, number][] = []
    for (let i = 0; i < pts.length; i++) edges.push([i, (i + 1) % pts.length])
    const built = buildTin(pts, edges)
    if (!built.tin) throw new PileError('Could not build a base from the toe heights.')
    if (built.droppedEdges) warnings.push('The toe folds back on itself in places — the base there is approximate.')
    baseSurf = built.tin
  }

  // ── Toe edges, indexed ──
  const span = Math.max(rb.x1 - rb.x0, rb.y1 - rb.y0, 1)
  const segIdx = new BinIndex(rb, Math.max(span / 64, 0.25))
  for (let i = 0; i < n; i++) {
    const ax = ring[2 * i], ay = ring[2 * i + 1]
    const bx = ring[(2 * i + 2) % ring.length], by = ring[(2 * i + 3) % ring.length]
    segIdx.insert(i, { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) })
  }

  let area = 0, vol = 0, below = 0, maxH = 0, work = 0
  const hits: number[] = []
  const seen = new Set<number>()
  top.each(rb, t => {
    const v = t.v
    const tb: Box = { x0: Math.min(v[0], v[2], v[4]), y0: Math.min(v[1], v[3], v[5]), x1: Math.max(v[0], v[2], v[4]), y1: Math.max(v[1], v[3], v[5]) }
    if (!boxesOverlap(tb, rb)) return
    if ((++work & 4095) === 0 && opts.deadline && Date.now() > opts.deadline) throw new PileError('This pile is too big to measure in one go — draw a smaller toe.')
    baseSurf.each(tb, b => {
      const piece = clipByTriangle(v.slice(), b.v[0], b.v[1], b.v[2], b.v[3], b.v[4], b.v[5])
      if (piece.length < 6) return
      let pieces: Poly[] = [piece]
      hits.length = 0
      segIdx.query(boxOf(piece), hits, seen)
      for (const s of hits) {
        const ax = ring[2 * s], ay = ring[2 * s + 1]
        const bx = ring[(2 * s + 2) % ring.length], by = ring[(2 * s + 3) % ring.length]
        const next: Poly[] = []
        for (const p of pieces) {
          if (segmentCrosses(p, ax, ay, bx, by)) next.push(...splitByLine(p, ax, ay, bx, by))
          else next.push(p)
        }
        pieces = next
      }
      for (const p of pieces) {
        const [cx, cy] = centroid(p)
        if (!pointInRing(cx, cy, ring)) continue
        const vals: number[] = []
        for (let i = 0; i < p.length; i += 2) {
          const d = (t.p0 + t.p1 * p[i] + t.p2 * p[i + 1]) - (b.p0 + b.p1 * p[i] + b.p2 * p[i + 1])
          vals.push(d)
          if (d > maxH) maxH = d
        }
        const [P, N] = polyPosNeg(p, vals)
        area += polyArea(p); vol += P; below += N
      }
    })
  })
  const k2 = k * k
  const coverage = Math.min(1, area / toeArea)
  if (coverage < 0.98) warnings.push(`The survey covers ${Math.round(coverage * 100)}% of the toe — the rest isn’t counted.`)
  if (below / k2 > 0.05 * Math.max(vol / k2, 1)) warnings.push('Part of the surface inside the toe sits below the base (a hole or a cut) — it is shown apart, not taken off the pile.')
  return {
    areaM2: area / k2, toeAreaM2: toeArea / k2, volumeM3: vol / k2, belowM3: below / k2, maxHeightM: maxH,
    baseMinZ, baseMaxZ, coverage, warnings,
  }
}

/** What gets stored on a stockpile row. */
export interface PileResults {
  v: 1
  computedAt: string
  base: PileBase
  source: { kind: 'dsm' | 'lidar'; detail: string; resolutionM: number }
  areaSf: number
  areaM2: number
  cy: number
  m3: number
  belowCy: number
  maxHeightFt: number
  densityTCy: number
  tons: number
  coverage: number
  warnings: string[]
}

export function pileResults(m: PileMeasure, o: { base: PileBase; densityTCy: number; source: PileResults['source']; now?: Date }): PileResults {
  const cy = m.volumeM3 / CY_M3
  return {
    v: 1,
    computedAt: (o.now ?? new Date()).toISOString(),
    base: o.base,
    source: o.source,
    areaSf: m.areaM2 / SF_M2,
    areaM2: m.areaM2,
    cy,
    m3: m.volumeM3,
    belowCy: m.belowM3 / CY_M3,
    maxHeightFt: m.maxHeightM / FT,
    densityTCy: o.densityTCy,
    tons: cy * o.densityTCy,
    coverage: m.coverage,
    warnings: m.warnings,
  }
}

// ── Drone surveys (DSM GeoTIFFs) ───────────────────────────────────────────

/** Metres per unit for the GeoTIFF linear-unit codes we accept. */
const UNIT_M: Record<number, number> = { 9001: 1, 9002: FT, 9003: 1200 / 3937 }

export type DsmCrs =
  | { kind: 'utm'; epsg: number; zone: number; south: boolean; unitM: number }
  | { kind: 'geo'; epsg: number }

export type ZUnits = 'auto' | 'm' | 'ft' | 'usft'

/** UTM zone for an EPSG code we know (WGS84, NAD83, NAD83(2011)), or null. */
export function utmFromEpsg(epsg: number): { zone: number; south: boolean } | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false }
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true }
  if (epsg >= 26901 && epsg <= 26923) return { zone: epsg - 26900, south: false }
  if (epsg >= 6330 && epsg <= 6348) return { zone: epsg - 6329, south: false }
  return null
}

/**
 * Read a DSM's coordinate system and units from its GeoKeys. Accepts UTM
 * (WGS84 / NAD83 / NAD83(2011)) and geographic lng/lat; anything else (state
 * plane, a local grid) is refused with the export to ask for.
 */
export function dsmCrs(keys: Record<string, unknown> | null | undefined, zUnits: ZUnits = 'auto'):
  { ok: true; crs: DsmCrs; zScaleM: number; words: string } | { ok: false; error: string } {
  const k = keys ?? {}
  const proj = Number(k.ProjectedCSTypeGeoKey)
  const geog = Number(k.GeographicTypeGeoKey)
  const model = Number(k.GTModelTypeGeoKey)
  const vCode = Number(k.VerticalUnitsGeoKey)
  let crs: DsmCrs | null = null
  let hUnit = 1
  if (Number.isFinite(proj) && proj > 0 && proj !== 32767) {
    const u = utmFromEpsg(proj)
    if (!u) return { ok: false, error: `This survey is in EPSG:${proj}, which we can’t read yet — export the DSM in UTM (metres) or WGS84 lng/lat.` }
    const lu = Number(k.ProjLinearUnitsGeoKey)
    hUnit = Number.isFinite(lu) && lu > 0 ? UNIT_M[lu] ?? NaN : 1
    if (!Number.isFinite(hUnit)) return { ok: false, error: 'This survey uses a ground unit we can’t read — export it in metres or feet.' }
    crs = { kind: 'utm', epsg: proj, zone: u.zone, south: u.south, unitM: hUnit }
  } else if (model === 2 || [4326, 4269, 6318, 4979].includes(geog)) {
    crs = { kind: 'geo', epsg: Number.isFinite(geog) && geog > 0 ? geog : 4326 }
  }
  if (!crs) return { ok: false, error: 'This file has no map location we can read (no GeoTIFF coordinate system). Export the DSM as a georeferenced GeoTIFF.' }
  let zScaleM: number
  let zWords: string
  if (zUnits === 'm') { zScaleM = 1; zWords = 'metres (set by you)' }
  else if (zUnits === 'ft') { zScaleM = FT; zWords = 'feet (set by you)' }
  else if (zUnits === 'usft') { zScaleM = 1200 / 3937; zWords = 'US survey feet (set by you)' }
  else if (Number.isFinite(vCode) && UNIT_M[vCode]) { zScaleM = UNIT_M[vCode]; zWords = vCode === 9001 ? 'metres' : 'feet' }
  else if (crs.kind === 'utm' && hUnit !== 1) { zScaleM = hUnit; zWords = 'feet (same as the ground unit)' }
  else { zScaleM = 1; zWords = 'metres (assumed — the file doesn’t say)' }
  const where = crs.kind === 'utm' ? `UTM zone ${crs.zone}${crs.south ? 'S' : 'N'} (EPSG:${crs.epsg})` : `lng/lat (EPSG:${crs.epsg})`
  return { ok: true, crs, zScaleM, words: `${where}, heights in ${zWords}` }
}

/** A GeoTIFF's placement: origin (top-left corner) and pixel size in CRS units (resY < 0). */
export interface RasterGeo { originX: number; originY: number; resX: number; resY: number; width: number; height: number }

/** The source position (CRS units) of a lng/lat. */
function toSrc(crs: DsmCrs, lng: number, lat: number): [number, number] {
  if (crs.kind === 'geo') return [lng, lat]
  const [e, n] = tmForward(utmParams(crs.zone, crs.south), lng, lat)
  return [e / crs.unitM, n / crs.unitM]
}

/** Pixel size in metres near a latitude. */
export function srcResM(crs: DsmCrs, g: RasterGeo, lat: number): number {
  if (crs.kind === 'utm') return Math.abs(g.resX) * crs.unitM
  return Math.abs(g.resX) * 111_320 * Math.cos((lat * Math.PI) / 180)
}

export interface FramePlan { x0: number; y0: number; dx: number; nx: number; ny: number }

/** The frame grid a pile is measured on: the toe's box + 2 cells, at the survey's resolution (coarser past maxNodes). */
export function planPileGrid(ring: Poly, resM: number, maxNodes = 600_000): FramePlan {
  const b = boxOf(ring)
  let dx = Math.max(resM, 0.02)
  const w = b.x1 - b.x0, h = b.y1 - b.y0
  const need = (w * h) / (dx * dx)
  if (need > maxNodes) dx *= Math.sqrt(need / maxNodes)
  const x0 = b.x0 - 2 * dx, y0 = b.y0 - 2 * dx
  return { x0, y0, dx, nx: Math.ceil(w / dx) + 5, ny: Math.ceil(h / dx) + 5 }
}

/** Pixel window [c0, r0, c1, r1) of the source that covers a frame plan (+2 px). */
export function sourceWindow(frame: Frame, plan: FramePlan, crs: DsmCrs, g: RasterGeo): [number, number, number, number] | null {
  let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity
  const xs = [plan.x0, plan.x0 + (plan.nx - 1) * plan.dx / 2, plan.x0 + (plan.nx - 1) * plan.dx]
  const ys = [plan.y0, plan.y0 + (plan.ny - 1) * plan.dx / 2, plan.y0 + (plan.ny - 1) * plan.dx]
  for (const x of xs) for (const y of ys) {
    const [lng, lat] = fromFrame(frame, x, y)
    const [sx, sy] = toSrc(crs, lng, lat)
    const c = (sx - g.originX) / g.resX, r = (sy - g.originY) / g.resY
    cMin = Math.min(cMin, c); cMax = Math.max(cMax, c); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r)
  }
  const c0 = Math.max(0, Math.floor(cMin) - 2), r0 = Math.max(0, Math.floor(rMin) - 2)
  const c1 = Math.min(g.width, Math.ceil(cMax) + 2), r1 = Math.min(g.height, Math.ceil(rMax) + 2)
  return c1 > c0 && r1 > r0 ? [c0, r0, c1, r1] : null
}

/**
 * Resample a source window onto the frame plan (bilinear between pixel
 * centres; NaN where any of the four is no-data) → a GridSurface in metres.
 */
export function sampleToFrame(
  frame: Frame, plan: FramePlan, crs: DsmCrs, g: RasterGeo,
  win: { c0: number; r0: number; w: number; h: number; data: ArrayLike<number>; nodata: number | null },
  zScaleM: number,
): { surface: GridSurface; filled: number } {
  const z = new Float64Array(plan.nx * plan.ny).fill(NaN)
  const val = (c: number, r: number) => {
    const cc = c - win.c0, rr = r - win.r0
    if (cc < 0 || rr < 0 || cc >= win.w || rr >= win.h) return NaN
    const v = win.data[rr * win.w + cc]
    if (!Number.isFinite(v) || v === win.nodata || v < -1e5 || v > 1e5) return NaN
    return v
  }
  let filled = 0
  for (let j = 0; j < plan.ny; j++) {
    for (let i = 0; i < plan.nx; i++) {
      const [lng, lat] = fromFrame(frame, plan.x0 + i * plan.dx, plan.y0 + j * plan.dx)
      const [sx, sy] = toSrc(crs, lng, lat)
      const fc = (sx - g.originX) / g.resX - 0.5, fr = (sy - g.originY) / g.resY - 0.5
      const ci = Math.floor(fc), ri = Math.floor(fr), u = fc - ci, t = fr - ri
      const a = val(ci, ri), b = val(ci + 1, ri), c = val(ci, ri + 1), d = val(ci + 1, ri + 1)
      const v = a * (1 - u) * (1 - t) + b * u * (1 - t) + c * (1 - u) * t + d * u * t
      if (Number.isFinite(v)) { z[j * plan.nx + i] = v * zScaleM; filled++ }
    }
  }
  return { surface: new GridSurface({ x0: plan.x0, y0: plan.y0, dx: plan.dx, dy: plan.dx, nx: plan.nx, ny: plan.ny, z }), filled }
}

/** A drawn toe from untrusted input: 3–500 finite lng/lat corners, open ring. */
export function parseToe(v: unknown): [number, number][] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > 501) return null
  const pts = v.map(p => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [NaN, NaN]) as [number, number])
  if (!pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85)) return null
  const last = pts[pts.length - 1]
  if (pts.length > 3 && last[0] === pts[0][0] && last[1] === pts[0][1]) pts.pop()
  return pts.length >= 3 && pts.length <= 500 ? pts : null
}
