/**
 * The dirt takeoff — Brian's Kubla process (DCG takeoff/estimate process,
 * Apr 2025) as one calculation:
 *
 *   EXISTING   lidar ground (USGS 1 m, NAVD88) + a datum offset, or traced
 *              existing contours / spot grades
 *   DEMO       areas lowered by each demo type's thickness (asphalt 4" …)
 *   TOPSOIL    areas lowered by the stripping depth (geotech average, or
 *              1–3" fields / 5" woods)
 *   PROPOSED   proposed contours + spot grades, tied into existing at the
 *              grading limits
 *   REDUCE     construction thickness under each pavement / slab type
 *              (light duty 8", heavy duty 11" …) — subgrade = finished − t
 *   PLATFORM   building pad: subgrade = finished floor + offset (−8" default)
 *
 * Kubla needs every reduce area and platform drawn with an external batter of
 * 0:0.01 so its TIN can approximate a wall. Here the wall is EXACT: each area
 * edge cuts the integration pieces along its line, so the step at the edge is
 * a true vertical face and costs no sliver of volume.
 *
 * Volumes are integrated exactly over the overlay of the two triangulated
 * surfaces (every piece is convex with both surfaces linear on it), then
 * converted from UTM metres (÷ k²) to cubic yards. Overlapping areas of the
 * same kind: the one drawn LAST wins (a concrete pad drawn on an asphalt lot).
 *
 * Pure and framework-free. Harness: scripts/dirt-test.mjs — run it after ANY
 * change to lib/dirt/*.
 */
import earcut from 'earcut'
import { fromFrame, makeFrame, toFrame, utmZone, type Frame } from './tm'
import {
  BinIndex, boxOf, boxesOverlap, centroid, clipByTriangle, ccw, pointInRing, polyArea,
  polyPosNeg, ringSelfCrosses, segmentCrosses, splitByLine, type Box, type Poly,
} from './geom'
import { buildTin, GridSurface, OffsetSurface, type PlaneTri, type Surface, type TinPoint } from './surface'

export const FT = 0.3048
export const IN = 0.0254
export const CY_M3 = 0.764554857984
export const SF_M2 = 0.09290304

export type DirtKind =
  | 'boundary' | 'eg_contour' | 'eg_spot' | 'fg_contour' | 'fg_spot'
  | 'platform' | 'demo' | 'topsoil' | 'reduce'

export const DIRT_KINDS: DirtKind[] = ['boundary', 'eg_contour', 'eg_spot', 'fg_contour', 'fg_spot', 'platform', 'demo', 'topsoil', 'reduce']

export interface DirtFeature {
  id: string
  kind: DirtKind
  /** Demo / reduce type, platform name. */
  label?: string
  /** Feet: contour or spot elevation, platform finished floor. */
  z?: number
  /** Platform: subgrade offset from finished floor, inches (default −8). */
  offsetIn?: number
  /** Demo / topsoil / reduce thickness, inches. */
  thicknessIn?: number
  /** [lng, lat] — one point for a spot, a line for a contour, a ring (not closed) for an area. */
  coords: [number, number][]
}

export interface DirtDesign {
  v: 1
  features: DirtFeature[]
  existing: { source: 'lidar' | 'traced'; offsetFt: number }
  settings: { shrinkPct: number; truckCy: number }
  /** Plan sheets shown under the trace (zone imagery ids). */
  sheets?: string[]
}

export function emptyDesign(): DirtDesign {
  return { v: 1, features: [], existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 } }
}

/** Existing ground as delivered by /api/dirt/ground: a UTM grid, metres. */
export interface GroundGrid {
  zone: number
  epsg: number
  /** UTM coordinates of node (0,0) — the south-west pixel centre. */
  x0: number
  y0: number
  dx: number
  dy: number
  nx: number
  ny: number
  /** Row 0 = south; metres NAVD88; NaN = no data. */
  z: Float32Array
  /** Plain words, e.g. "USGS 1 m lidar, 2019 (SC Savannah–Pee Dee)". */
  source: string
  resolutionM: number
}

export interface DirtResults {
  v: 1
  computedAt: string
  frame: { zone: number; epsg: number; k: number; e0: number; n0: number }
  existing: { source: 'lidar' | 'traced' | 'none'; detail: string; offsetFt: number; resolutionM: number | null }
  /** No proposed contours, spots or pads: finished grade = existing. */
  proposedFromExisting: boolean
  boundarySf: number
  /** Share of the grading limits with both surfaces under it, 0–100. */
  coveredPct: number
  cutCy: number
  fillCy: number
  shrinkPct: number
  /** Fill grown by the shrink: the bank yards it takes to make it. */
  fillAdjCy: number
  /** Cut that goes back in as fill on site. */
  onsiteCy: number
  exportCy: number
  importCy: number
  truckCy: number
  loads: number
  maxCutFt: number
  maxFillFt: number
  topsoil: { sf: number; cy: number }
  demo: { label: string; thicknessIn: number; sf: number; cy: number }[]
  reduce: { label: string; thicknessIn: number; sf: number }[]
  platforms: { label: string; ffeFt: number; subgradeFt: number; sf: number }[]
  datum: {
    /** Median proposed-minus-existing over the traced proposed points, feet. */
    proposedMinusExistingFt: number | null
    /** Lidar mode with traced existing points: median plan-existing − lidar, feet. */
    planExistingMinusLidarFt: number | null
    samples: number
  }
  diagnostics: { pieces: number; ms: number; flatTriangles: number; droppedEdges: number; work?: number }
  warnings: string[]
  /** Band width (ft) of the stored cut/fill picture — set by the server run. */
  heatBandFt?: number
}

// ── Limits ────────────────────────────────────────────────────────────────

/**
 * Thrown when a design is too much work to run — on the server it means the
 * design is NOT saved (a run that can't finish must never park a design that
 * hangs everyone's editor). A real 1.2 km site with 40 contours and 20 paving
 * areas is ~2.8M pieces / ~10 s; the caps sit well above that.
 */
export class TakeoffTooBig extends Error {
  constructor() {
    super('This takeoff is too complex to run in one go — split the site into smaller takeoffs, or simplify the grading limits and areas (fewer, straighter edges).')
    this.name = 'TakeoffTooBig'
  }
}

export interface RunLimits {
  /** Epoch ms after which the run gives up. */
  deadline?: number
  /** Integration pieces + area splits allowed. */
  maxWork?: number
}

const DEFAULT_MAX_WORK = 15_000_000
/** Tie-in samples along the grading limits: every 2 m, but never more than this many. */
const MAX_TIE_SAMPLES = 20_000

class Budget {
  private work = 0
  constructor(private limits: RunLimits) {}
  get used(): number { return this.work }
  spend(n = 1): void {
    this.work += n
    if (this.work > (this.limits.maxWork ?? DEFAULT_MAX_WORK)) throw new TakeoffTooBig()
    if (this.limits.deadline && (this.work & 1023) < n && Date.now() > this.limits.deadline) throw new TakeoffTooBig()
  }
}

// ── Internal: the built takeoff (also feeds the heat map) ─────────────────

export interface Area { ring: Poly; box: Box; t: number; label: string; z: number; order: number }

export interface TakeoffContext {
  frame: Frame
  eg: Surface | null
  fg: Surface | null
  boundary: Area[]
  demo: Area[]
  topsoil: Area[]
  reduce: Area[]
  platforms: Area[]
  domain: Box | null
}

const ft = (m: number) => m / FT

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function centerOf(design: DirtDesign): [number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const f of design.features) for (const [lng, lat] of f.coords) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (lng < x0) x0 = lng
    if (lng > x1) x1 = lng
    if (lat < y0) y0 = lat
    if (lat > y1) y1 = lat
  }
  return Number.isFinite(x0) ? [(x0 + x1) / 2, (y0 + y1) / 2] : null
}

/** A flat CCW ring in frame metres, or null when it has < 3 distinct corners. */
function ringOf(frame: Frame, coords: [number, number][]): Poly | null {
  const out = rawRingOf(frame, coords)
  if (out.length < 6 || polyArea(out) < 1e-6) return null
  return ccw(out)
}

/** A traced area that crosses itself (a bowtie) — checked before its area, which a symmetric bowtie zeroes. */
function crossesItself(frame: Frame, coords: [number, number][]): boolean {
  const r = rawRingOf(frame, coords)
  return r.length >= 8 && ringSelfCrosses(r)
}

/** Frame-metre corners, consecutive duplicates and a closing duplicate dropped. */
function rawRingOf(frame: Frame, coords: [number, number][]): Poly {
  const out: Poly = []
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    const [x, y] = toFrame(frame, lng, lat)
    const n = out.length
    if (n >= 2 && Math.abs(out[n - 2] - x) < 1e-6 && Math.abs(out[n - 1] - y) < 1e-6) continue
    out.push(x, y)
  }
  // drop a closing duplicate
  if (out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 1e-6 && Math.abs(out[1] - out[out.length - 1]) < 1e-6) out.length -= 2
  return out
}

function lineOf(frame: Frame, coords: [number, number][]): number[] {
  const out: number[] = []
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    const [x, y] = toFrame(frame, lng, lat)
    const n = out.length
    if (n >= 2 && Math.abs(out[n - 2] - x) < 1e-6 && Math.abs(out[n - 1] - y) < 1e-6) continue
    out.push(x, y)
  }
  return out
}

/** Areas of one kind with the parts covered by later areas of that kind removed. */
export function effectiveAreas(areas: Area[], budget: Budget = new Budget({})): number[] {
  return areas.map((a, i) => {
    const later = areas.slice(i + 1).filter(b => boxesOverlap(a.box, b.box))
    if (!later.length) return polyArea(a.ring)
    const idx = earcut(a.ring)
    let sum = 0
    for (let t = 0; t < idx.length; t += 3) {
      let parts: Poly[] = [[
        a.ring[2 * idx[t]], a.ring[2 * idx[t] + 1],
        a.ring[2 * idx[t + 1]], a.ring[2 * idx[t + 1] + 1],
        a.ring[2 * idx[t + 2]], a.ring[2 * idx[t + 2] + 1],
      ]]
      for (const b of later) {
        const r = b.ring
        for (let k = 0; k < r.length; k += 2) {
          const m = (k + 2) % r.length
          const next: Poly[] = []
          budget.spend(parts.length)
          for (const p of parts) {
            if (segmentCrosses(p, r[k], r[k + 1], r[m], r[m + 1])) next.push(...splitByLine(p, r[k], r[k + 1], r[m], r[m + 1]))
            else next.push(p)
          }
          parts = next
        }
      }
      for (const p of parts) {
        const [cx, cy] = centroid(p)
        if (!later.some(b => pointInRing(cx, cy, b.ring))) sum += polyArea(p)
      }
    }
    return sum
  })
}

/** Top-most area (highest order) of a kind containing a point, or -1. */
export class AreaLookup {
  private idx: BinIndex | null = null
  private hits: number[] = []
  private seen = new Set<number>()
  constructor(private areas: Area[]) {
    if (!areas.length) return
    let b: Box = { ...areas[0].box }
    for (const a of areas) b = { x0: Math.min(b.x0, a.box.x0), y0: Math.min(b.y0, a.box.y0), x1: Math.max(b.x1, a.box.x1), y1: Math.max(b.y1, a.box.y1) }
    const span = Math.max(b.x1 - b.x0, b.y1 - b.y0, 1)
    this.idx = new BinIndex(b, span / 32)
    areas.forEach((a, i) => this.idx!.insert(i, a.box))
  }
  at(x: number, y: number): number {
    if (!this.idx) return -1
    this.hits.length = 0
    this.idx.query({ x0: x, y0: y, x1: x, y1: y }, this.hits, this.seen)
    let best = -1
    for (const i of this.hits) {
      if (i > best && pointInRing(x, y, this.areas[i].ring)) best = i
    }
    return best
  }
}

/** Build every surface and area for a design. Shared by the volume run and the heat map. */
export function buildContext(design: DirtDesign, ground: GroundGrid | null, warnings: string[] = []): TakeoffContext & { flatTriangles: number; droppedEdges: number; proposedFromExisting: boolean; fgPoints: TinPoint[]; egTracedPoints: TinPoint[] } {
  const c = centerOf(design)
  const zone = ground?.zone ?? (c ? utmZone(c[0]) : 17)
  const frame = makeFrame(c?.[0] ?? -81, c?.[1] ?? 34, zone)
  const offsetM = (Number(design.existing?.offsetFt) || 0) * FT

  const byKind = (k: DirtKind) => design.features.filter(f => f.kind === k)
  const areasOf = (k: DirtKind, t: (f: DirtFeature) => number, z: (f: DirtFeature) => number = () => 0): Area[] => {
    const out: Area[] = []
    for (const f of byKind(k)) {
      if (crossesItself(frame, f.coords)) {
        warnings.push(k === 'boundary' ? 'The grading limits cross themselves — redraw them.' : `A ${kindWords(k)} area crosses itself — redraw it. It was skipped.`)
        continue
      }
      const ring = ringOf(frame, f.coords)
      if (!ring) { warnings.push(k === 'boundary' ? 'The grading limits have fewer than 3 corners — redraw them.' : `A ${kindWords(k)} area has fewer than 3 corners — skipped.`); continue }
      out.push({ ring, box: boxOf(ring), t: t(f), label: (f.label ?? '').trim(), z: z(f), order: out.length })
    }
    return out
  }

  const boundary = areasOf('boundary', () => 0)
  const demo = areasOf('demo', f => clampIn(f.thicknessIn) * IN)
  const topsoil = areasOf('topsoil', f => clampIn(f.thicknessIn) * IN)
  const reduce = areasOf('reduce', f => clampIn(f.thicknessIn) * IN)
  const platforms: Area[] = []
  for (const f of byKind('platform')) {
    if (!Number.isFinite(f.z)) { warnings.push(`Platform "${f.label || 'pad'}" has no finished floor elevation — skipped.`); continue }
    if (crossesItself(frame, f.coords)) { warnings.push(`Platform "${f.label || 'pad'}" crosses itself — redraw it. It was skipped.`); continue }
    const ring = ringOf(frame, f.coords)
    if (!ring) { warnings.push(`Platform "${f.label || 'pad'}" has fewer than 3 corners — skipped.`); continue }
    const off = Number.isFinite(f.offsetIn) ? Number(f.offsetIn) : -8
    platforms.push({ ring, box: boxOf(ring), t: 0, label: (f.label ?? '').trim(), z: Number(f.z) * FT + off * IN, order: platforms.length })
  }

  // ── Existing ground ──
  let eg: Surface | null = null
  const egTracedPoints: TinPoint[] = []
  let flatTriangles = 0, droppedEdges = 0
  const egContours = byKind('eg_contour'), egSpots = byKind('eg_spot')
  const traced = design.existing?.source === 'traced'
  if (!traced) {
    if (ground) {
      eg = new OffsetSurface(new GridSurface({
        x0: ground.x0 - frame.e0, y0: ground.y0 - frame.n0, dx: ground.dx, dy: ground.dy,
        nx: ground.nx, ny: ground.ny, z: ground.z,
      }), offsetM)
    }
  }
  // Traced existing points are always collected: in lidar mode they check the datum.
  const egEdges: [number, number][] = []
  for (const f of egContours) {
    if (!Number.isFinite(f.z)) { warnings.push('An existing contour has no elevation — skipped.'); continue }
    const line = lineOf(frame, f.coords)
    const base = egTracedPoints.length
    for (let i = 0; i < line.length; i += 2) egTracedPoints.push({ x: line[i], y: line[i + 1], z: Number(f.z) * FT, src: `contour ${f.z}` })
    for (let i = 1; i < line.length / 2; i++) egEdges.push([base + i - 1, base + i])
  }
  for (const f of egSpots) {
    if (!Number.isFinite(f.z) || !f.coords[0]) continue
    const [x, y] = toFrame(frame, f.coords[0][0], f.coords[0][1])
    egTracedPoints.push({ x, y, z: Number(f.z) * FT, src: `spot ${f.z}` })
  }
  if (traced) {
    if (egTracedPoints.length >= 3) {
      const b = buildTin(egTracedPoints, egEdges)
      warnings.push(...b.warnings.map(w => `Existing: ${w}`))
      eg = b.tin
      flatTriangles += b.flatTriangles
      droppedEdges += b.droppedEdges
    }
  }

  // ── Proposed ground ──
  const fgPoints: TinPoint[] = []
  const fgEdges: [number, number][] = []
  for (const f of byKind('fg_contour')) {
    if (!Number.isFinite(f.z)) { warnings.push('A proposed contour has no elevation — skipped.'); continue }
    const line = lineOf(frame, f.coords)
    const base = fgPoints.length
    for (let i = 0; i < line.length; i += 2) fgPoints.push({ x: line[i], y: line[i + 1], z: Number(f.z) * FT, src: `contour ${f.z}` })
    for (let i = 1; i < line.length / 2; i++) fgEdges.push([base + i - 1, base + i])
  }
  for (const f of byKind('fg_spot')) {
    if (!Number.isFinite(f.z) || !f.coords[0]) { warnings.push('A proposed spot grade has no elevation — skipped.'); continue }
    const [x, y] = toFrame(frame, f.coords[0][0], f.coords[0][1])
    fgPoints.push({ x, y, z: Number(f.z) * FT, src: `spot ${f.z}` })
  }
  const padEdges: [number, number][][] = []
  for (const f of byKind('platform')) {
    if (!Number.isFinite(f.z)) continue
    const ring = ringOf(frame, f.coords)
    if (!ring || crossesItself(frame, f.coords)) continue
    const base = fgPoints.length
    const n = ring.length / 2
    const edges: [number, number][] = []
    for (let i = 0; i < n; i++) fgPoints.push({ x: ring[2 * i], y: ring[2 * i + 1], z: Number(f.z) * FT, src: `pad ${f.label || ''}`.trim() })
    for (let i = 0; i < n; i++) edges.push([base + i, base + ((i + 1) % n)])
    padEdges.push(edges)
  }
  // The later pad wins where pads overlap, so its edges are honoured first.
  for (let i = padEdges.length - 1; i >= 0; i--) fgEdges.push(...padEdges[i])
  // Everything the plan says (contours, spots, pad corners) — the datum check
  // reads these, never the tie-in samples below, which ARE existing.
  const designPoints = fgPoints.length
  const proposedFromExisting = fgPoints.length === 0

  let fg: Surface | null = null
  if (proposedFromExisting) {
    fg = eg
  } else if (eg) {
    // Tie into existing along the grading limits: sample the ORIGINAL existing
    // ground every ≤2 m, skipping samples within 0.3 m of a traced point or
    // line (two elevations a hair apart would fight).
    const near = new BinIndex(boxOf(fgPoints.flatMap(p => [p.x, p.y]).concat(boundary.flatMap(b => b.ring))), 4)
    const segs: number[][] = []
    fgEdges.forEach(([a, b]) => {
      const s = [fgPoints[a].x, fgPoints[a].y, fgPoints[b].x, fgPoints[b].y]
      near.insert(segs.length, { x0: Math.min(s[0], s[2]) - 0.3, y0: Math.min(s[1], s[3]) - 0.3, x1: Math.max(s[0], s[2]) + 0.3, y1: Math.max(s[1], s[3]) + 0.3 })
      segs.push(s)
    })
    fgPoints.forEach(p => {
      near.insert(segs.length, { x0: p.x - 0.3, y0: p.y - 0.3, x1: p.x + 0.3, y1: p.y + 0.3 })
      segs.push([p.x, p.y, p.x, p.y])
    })
    const hits: number[] = []
    const seen = new Set<number>()
    const tooClose = (x: number, y: number) => {
      hits.length = 0
      near.query({ x0: x, y0: y, x1: x, y1: y }, hits, seen)
      for (const i of hits) if (distToSeg(x, y, segs[i]) < 0.3) return true
      return false
    }
    let missing = 0
    let perimeter = 0
    for (const b of boundary) for (let i = 0; i < b.ring.length; i += 2) {
      const j = (i + 2) % b.ring.length
      perimeter += Math.hypot(b.ring[j] - b.ring[i], b.ring[j + 1] - b.ring[i + 1])
    }
    const spacing = Math.max(2, perimeter / MAX_TIE_SAMPLES)
    for (const b of boundary) {
      const r = b.ring
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length
        const len = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1])
        const steps = Math.max(1, Math.ceil(len / spacing))
        for (let s = 0; s < steps; s++) {
          const x = r[i] + ((r[j] - r[i]) * s) / steps
          const y = r[i + 1] + ((r[j + 1] - r[i + 1]) * s) / steps
          if (tooClose(x, y)) continue
          const z = eg.zAt(x, y)
          if (!Number.isFinite(z)) { missing++; continue }
          fgPoints.push({ x, y, z, src: 'grading limits' })
        }
      }
    }
    if (missing) warnings.push(`Existing ground is missing along part of the grading limits (${missing} points) — proposed ground can't tie in there.`)
    const b = buildTin(fgPoints, fgEdges)
    warnings.push(...b.warnings.map(w => `Proposed: ${w}`))
    fg = b.tin
    flatTriangles += b.flatTriangles
    droppedEdges += b.droppedEdges
  }

  // Domain: the grading limits.
  let domain: Box | null = null
  for (const b of boundary) domain = domain ? { x0: Math.min(domain.x0, b.box.x0), y0: Math.min(domain.y0, b.box.y0), x1: Math.max(domain.x1, b.box.x1), y1: Math.max(domain.y1, b.box.y1) } : { ...b.box }

  return { frame, eg, fg, boundary, demo, topsoil, reduce, platforms, domain, flatTriangles, droppedEdges, proposedFromExisting, fgPoints: fgPoints.slice(0, designPoints), egTracedPoints }
}

function distToSeg(x: number, y: number, s: number[]): number {
  const [ax, ay, bx, by] = s
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

function clampIn(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(240, n))
}

export function kindWords(k: DirtKind): string {
  switch (k) {
    case 'boundary': return 'grading limits'
    case 'eg_contour': return 'existing contour'
    case 'eg_spot': return 'existing spot grade'
    case 'fg_contour': return 'proposed contour'
    case 'fg_spot': return 'proposed spot grade'
    case 'platform': return 'building pad'
    case 'demo': return 'demo'
    case 'topsoil': return 'topsoil'
    case 'reduce': return 'construction thickness'
  }
}

/** The per-point picture at a frame location: existing (after demo + topsoil), subgrade, and what's in force. */
export function pointAt(ctx: TakeoffContext, look: {
  boundary: AreaLookup; demo: AreaLookup; topsoil: AreaLookup; reduce: AreaLookup; platforms: AreaLookup
}, x: number, y: number): { inside: boolean; eg: number; sg: number } {
  const inside = look.boundary.at(x, y) >= 0
  const eg0 = ctx.eg ? ctx.eg.zAt(x, y) : NaN
  const di = look.demo.at(x, y), ti = look.topsoil.at(x, y)
  const eg = eg0 - (di >= 0 ? ctx.demo[di].t : 0) - (ti >= 0 ? ctx.topsoil[ti].t : 0)
  const pi = look.platforms.at(x, y)
  let sg: number
  if (pi >= 0) sg = ctx.platforms[pi].z
  else {
    const ri = look.reduce.at(x, y)
    sg = (ctx.fg ? ctx.fg.zAt(x, y) : NaN) - (ri >= 0 ? ctx.reduce[ri].t : 0)
  }
  return { inside, eg, sg }
}

export function lookups(ctx: TakeoffContext) {
  return {
    boundary: new AreaLookup(ctx.boundary),
    demo: new AreaLookup(ctx.demo),
    topsoil: new AreaLookup(ctx.topsoil),
    reduce: new AreaLookup(ctx.reduce),
    platforms: new AreaLookup(ctx.platforms),
  }
}

/**
 * Run the takeoff. `now` is injectable for the harness; `limits` bound the
 * work (TakeoffTooBig past them).
 */
export function runTakeoff(design: DirtDesign, ground: GroundGrid | null, now: Date = new Date(), limits: RunLimits = {}): { results: DirtResults; ctx: TakeoffContext } {
  const t0 = Date.now()
  const budget = new Budget(limits)
  const warnings: string[] = []
  const built = buildContext(design, ground, warnings)
  const { frame, eg, fg, boundary, demo, topsoil, reduce, platforms, domain } = built
  const k2 = frame.k * frame.k
  const look = lookups(built)

  // Region edges (every area kind + grading limits) — a piece crossing one is cut along it.
  const segs: number[] = []
  const allAreas = [...boundary, ...demo, ...topsoil, ...reduce, ...platforms]
  let segIdx: BinIndex | null = null
  if (domain && allAreas.length) {
    const sb = allAreas.reduce<Box>((b, a) => ({ x0: Math.min(b.x0, a.box.x0), y0: Math.min(b.y0, a.box.y0), x1: Math.max(b.x1, a.box.x1), y1: Math.max(b.y1, a.box.y1) }), { ...allAreas[0].box })
    segIdx = new BinIndex(sb, Math.max(sb.x1 - sb.x0, sb.y1 - sb.y0, 1) / 128)
    for (const a of allAreas) {
      const r = a.ring
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length
        const id = segs.length / 4
        segs.push(r[i], r[i + 1], r[j], r[j + 1])
        segIdx.insert(id, { x0: Math.min(r[i], r[j]), y0: Math.min(r[i + 1], r[j + 1]), x1: Math.max(r[i], r[j]), y1: Math.max(r[i + 1], r[j + 1]) })
      }
    }
  }

  let fillM3 = 0, cutM3 = 0, covered = 0, pieces = 0
  let maxCut = 0, maxFill = 0
  const segHits: number[] = []
  const segSeen = new Set<number>()

  const piece = (part: Poly, egT: PlaneTri, fgT: PlaneTri) => {
    const [cx, cy] = centroid(part)
    if (look.boundary.at(cx, cy) < 0) return
    const di = look.demo.at(cx, cy), ti = look.topsoil.at(cx, cy)
    const pi = look.platforms.at(cx, cy), ri = pi >= 0 ? -1 : look.reduce.at(cx, cy)
    const lower = (di >= 0 ? demo[di].t : 0) + (ti >= 0 ? topsoil[ti].t : 0)
    const n = part.length / 2
    const vals = new Float64Array(n)
    for (let v = 0; v < n; v++) {
      const x = part[2 * v], y = part[2 * v + 1]
      const e = egT.p0 + egT.p1 * x + egT.p2 * y - lower
      const s = pi >= 0 ? platforms[pi].z : fgT.p0 + fgT.p1 * x + fgT.p2 * y - (ri >= 0 ? reduce[ri].t : 0)
      const d = s - e
      vals[v] = d
      if (d > maxFill) maxFill = d
      if (-d > maxCut) maxCut = -d
    }
    const [pos, neg] = polyPosNeg(part, vals)
    fillM3 += pos
    cutM3 += neg
    covered += polyArea(part)
    pieces++
  }

  const cutAlongEdges = (p: Poly, egT: PlaneTri, fgT: PlaneTri) => {
    if (!segIdx) return
    segHits.length = 0
    segIdx.query(boxOf(p), segHits, segSeen)
    let parts: Poly[] = [p]
    budget.spend(1 + segHits.length)
    for (const s of segHits) {
      const o = 4 * s
      const ax = segs[o], ay = segs[o + 1], bx = segs[o + 2], by = segs[o + 3]
      let next: Poly[] | null = null
      for (let k = 0; k < parts.length; k++) {
        const q = parts[k]
        if (segmentCrosses(q, ax, ay, bx, by)) {
          if (!next) next = parts.slice(0, k)
          next.push(...splitByLine(q, ax, ay, bx, by))
        } else if (next) next.push(q)
      }
      if (next) { budget.spend(next.length); parts = next }
    }
    for (const q of parts) piece(q, egT, fgT)
  }

  if (domain && eg && fg) {
    eg.each(domain, egT => {
      const tb: Box = { x0: Math.min(egT.v[0], egT.v[2], egT.v[4]), y0: Math.min(egT.v[1], egT.v[3], egT.v[5]), x1: Math.max(egT.v[0], egT.v[2], egT.v[4]), y1: Math.max(egT.v[1], egT.v[3], egT.v[5]) }
      if (!boxesOverlap(tb, domain)) return
      if (fg === eg) { cutAlongEdges(egT.v.slice(), egT, egT); return }
      fg.each(tb, fgT => {
        const fb: Box = { x0: Math.min(fgT.v[0], fgT.v[2], fgT.v[4]), y0: Math.min(fgT.v[1], fgT.v[3], fgT.v[5]), x1: Math.max(fgT.v[0], fgT.v[2], fgT.v[4]), y1: Math.max(fgT.v[1], fgT.v[3], fgT.v[5]) }
        if (!boxesOverlap(tb, fb)) return
        const p = clipByTriangle(egT.v, fgT.v[0], fgT.v[1], fgT.v[2], fgT.v[3], fgT.v[4], fgT.v[5])
        if (p.length < 6 || polyArea(p) < 1e-10) return
        cutAlongEdges(p, egT, fgT)
      })
    })
  }

  // ── Quantities ──
  const boundaryM2 = boundary.reduce((s, b) => s + polyArea(b.ring), 0)
  const coveredPct = boundaryM2 > 0 ? Math.min(100, (100 * covered) / boundaryM2) : 0
  if (!boundary.length) warnings.push('Draw the grading limits to get cut and fill.')
  else if (!eg) warnings.push(design.existing?.source === 'traced'
    ? 'Trace at least three existing contour points or spot grades to build existing ground.'
    : 'No lidar ground loaded for this site — trace the existing contours instead.')
  else if (coveredPct < 99) warnings.push(`Existing or proposed ground covers only ${coveredPct.toFixed(0)}% of the grading limits — the rest counts as no change.`)

  const effTop = effectiveAreas(topsoil, budget)
  const topsoilM2 = effTop.reduce((s, a) => s + a, 0)
  const topsoilM3 = effTop.reduce((s, a, i) => s + a * topsoil[i].t, 0)

  const effDemo = effectiveAreas(demo, budget)
  const demoRows = new Map<string, { label: string; thicknessIn: number; sf: number; cy: number }>()
  demo.forEach((d, i) => {
    const label = d.label || 'Demo'
    const tIn = round(d.t / IN, 2)
    const key = `${label}|${tIn}`
    const row = demoRows.get(key) ?? { label, thicknessIn: tIn, sf: 0, cy: 0 }
    row.sf += effDemo[i] / k2 / SF_M2
    row.cy += (effDemo[i] * d.t) / k2 / CY_M3
    demoRows.set(key, row)
  })

  // A pad wins over paving under it (as in the volume), so paving SF stops at the pad.
  const effReduce = effectiveAreas([...reduce, ...platforms], budget).slice(0, reduce.length)
  const reduceRows = new Map<string, { label: string; thicknessIn: number; sf: number }>()
  reduce.forEach((r, i) => {
    const label = r.label || 'Paving'
    const tIn = round(r.t / IN, 2)
    const key = `${label}|${tIn}`
    const row = reduceRows.get(key) ?? { label, thicknessIn: tIn, sf: 0 }
    row.sf += effReduce[i] / k2 / SF_M2
    reduceRows.set(key, row)
  })

  const effPads = effectiveAreas(platforms, budget)
  const padFeatures = design.features.filter(f => {
    if (f.kind !== 'platform' || !Number.isFinite(f.z)) return false
    return !!ringOf(frame, f.coords) && !crossesItself(frame, f.coords)
  })
  const platformRows = platforms.map((p, i) => ({
    label: p.label || 'Building pad',
    ffeFt: round(Number(padFeatures[i]?.z), 2),
    subgradeFt: round(ft(p.z), 2),
    sf: round(effPads[i] / k2 / SF_M2, 0),
  }))

  const cutCy = cutM3 / k2 / CY_M3
  const fillCy = fillM3 / k2 / CY_M3
  const shrinkPct = Math.max(0, Math.min(60, Number(design.settings?.shrinkPct) || 0))
  const truckCy = Math.max(1, Math.min(40, Number(design.settings?.truckCy) || 12))
  const fillAdjCy = fillCy * (1 + shrinkPct / 100)
  const net = cutCy - fillAdjCy

  // ── Datum check ──
  let proposedMinusExistingFt: number | null = null
  let planExistingMinusLidarFt: number | null = null
  let samples = 0
  if (eg && !built.proposedFromExisting) {
    const diffs: number[] = []
    for (const p of built.fgPoints) {
      if (domain && look.boundary.at(p.x, p.y) < 0) continue
      const e = eg.zAt(p.x, p.y)
      if (Number.isFinite(e)) diffs.push(p.z - e)
    }
    const m = median(diffs)
    samples = diffs.length
    if (m !== null) proposedMinusExistingFt = round(ft(m), 2)
    if (m !== null && diffs.length >= 3 && Math.abs(ft(m)) > 15 && design.existing?.source !== 'traced') {
      warnings.push(`The plan's proposed grades sit ${Math.abs(ft(m)).toFixed(1)} ft ${m > 0 ? 'above' : 'below'} the lidar ground on average — the plan may use an assumed datum. Set the existing-ground offset, or trace the existing contours.`)
    }
  }
  if (design.existing?.source !== 'traced' && ground && built.egTracedPoints.length) {
    const lidar = new GridSurface({ x0: ground.x0 - frame.e0, y0: ground.y0 - frame.n0, dx: ground.dx, dy: ground.dy, nx: ground.nx, ny: ground.ny, z: ground.z })
    const diffs: number[] = []
    for (const p of built.egTracedPoints) {
      const e = lidar.zAt(p.x, p.y)
      if (Number.isFinite(e)) diffs.push(p.z - e)
    }
    const m = median(diffs)
    if (m !== null) {
      planExistingMinusLidarFt = round(ft(m), 2)
      const off = Number(design.existing?.offsetFt) || 0
      if (Math.abs(ft(m) - off) > 1) warnings.push(`Your traced existing grades read ${ft(m).toFixed(1)} ft from the lidar (offset now ${off.toFixed(1)} ft) — set the offset to ${ft(m).toFixed(1)} ft if the plan uses its own datum.`)
    }
  }
  if (built.flatTriangles > 0) warnings.push(`${built.flatTriangles} flat triangle${built.flatTriangles === 1 ? '' : 's'} where a contour bends back on itself — add a spot grade at those peaks and low points for a closer number.`)

  const results: DirtResults = {
    v: 1,
    computedAt: now.toISOString(),
    frame: { zone: frame.zone, epsg: frame.epsg, k: frame.k, e0: frame.e0, n0: frame.n0 },
    existing: {
      source: !eg ? 'none' : design.existing?.source === 'traced' ? 'traced' : 'lidar',
      detail: design.existing?.source === 'traced' ? 'Traced existing contours' : ground?.source ?? 'No lidar loaded',
      offsetFt: Number(design.existing?.offsetFt) || 0,
      resolutionM: design.existing?.source === 'traced' ? null : ground?.resolutionM ?? null,
    },
    proposedFromExisting: built.proposedFromExisting,
    boundarySf: round(boundaryM2 / k2 / SF_M2, 0),
    coveredPct: round(coveredPct, 1),
    cutCy: round(cutCy, 2),
    fillCy: round(fillCy, 2),
    shrinkPct,
    fillAdjCy: round(fillAdjCy, 2),
    onsiteCy: round(Math.min(cutCy, fillAdjCy), 2),
    exportCy: round(Math.max(0, net), 2),
    importCy: round(Math.max(0, -net), 2),
    truckCy,
    loads: Math.ceil(Math.abs(net) / truckCy - 1e-9),
    maxCutFt: round(ft(maxCut), 2),
    maxFillFt: round(ft(maxFill), 2),
    topsoil: { sf: round(topsoilM2 / k2 / SF_M2, 0), cy: round(topsoilM3 / k2 / CY_M3, 2) },
    demo: Array.from(demoRows.values()).map(r => ({ ...r, sf: round(r.sf, 0), cy: round(r.cy, 2) })),
    reduce: Array.from(reduceRows.values()).map(r => ({ ...r, sf: round(r.sf, 0) })),
    platforms: platformRows,
    datum: { proposedMinusExistingFt, planExistingMinusLidarFt, samples },
    diagnostics: { pieces, ms: Date.now() - t0, flatTriangles: built.flatTriangles, droppedEdges: built.droppedEdges, work: budget.used },
    warnings: Array.from(new Set(warnings)),
  }
  return { results, ctx: built }
}

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Frame box → its four corners as lng/lat (TL, TR, BR, BL — MapLibre image order). */
export function boxCorners(frame: Frame, b: Box): [number, number][] {
  return [
    fromFrame(frame, b.x0, b.y1),
    fromFrame(frame, b.x1, b.y1),
    fromFrame(frame, b.x1, b.y0),
    fromFrame(frame, b.x0, b.y0),
  ]
}
