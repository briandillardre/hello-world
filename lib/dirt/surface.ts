/**
 * Ground surfaces for the dirt takeoff, both piecewise-linear (a TIN), in
 * frame metres (see ./tm.ts):
 *
 *  - GridSurface — the lidar existing ground. Nodes are the DEM's pixel
 *    centres; each cell is split into two triangles on its SW→NE diagonal,
 *    so zAt() and the triangles the volume integrator walks are the SAME
 *    surface (never a bilinear patch beside a triangulated one).
 *  - TinSurface — traced contours, spot grades and pad edges: Delaunay on the
 *    points with every contour segment forced in as an edge (constrained
 *    Delaunay, Constrainautor), so no triangle ever bridges across a contour.
 *
 * Pure; harness: scripts/dirt-test.mjs.
 */
import Delaunator from 'delaunator'
import Constrainautor from '@kninnug/constrainautor'
import { BinIndex, type Box, boxOf } from './geom'

/** A triangle in frame metres, CCW, with its plane z = p0 + p1·x + p2·y. */
export interface PlaneTri {
  /** [ax, ay, bx, by, cx, cy], counter-clockwise. */
  v: number[]
  p0: number
  p1: number
  p2: number
}

export interface Surface {
  /** Elevation (metres) at a frame point, NaN where the surface has no data. */
  zAt(x: number, y: number): number
  /** Every triangle that may overlap `box` (callers test exact overlap). */
  each(box: Box, cb: (t: PlaneTri) => void): void
}

/** Plane through three points, or null for a degenerate (zero-area) triangle. */
export function planeOf(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): { p0: number; p1: number; p2: number } | null {
  const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(det) < 1e-12) return null
  const p1 = ((bz - az) * (cy - ay) - (cz - az) * (by - ay)) / det
  const p2 = ((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / det
  return { p0: az - p1 * ax - p2 * ay, p1, p2 }
}

// ── Lidar grid ─────────────────────────────────────────────────────────────

export class GridSurface implements Surface {
  /** Frame coordinates of node (0,0) — the SOUTH-WEST pixel centre. */
  readonly x0: number
  readonly y0: number
  readonly dx: number
  readonly dy: number
  readonly nx: number
  readonly ny: number
  /** Row-major, row 0 = south; metres; NaN = no data. Offset already applied. */
  readonly z: Float32Array | Float64Array

  constructor(g: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; z: Float32Array | Float64Array }) {
    this.x0 = g.x0; this.y0 = g.y0; this.dx = g.dx; this.dy = g.dy
    this.nx = g.nx; this.ny = g.ny; this.z = g.z
  }

  private node(i: number, j: number): number {
    return this.z[j * this.nx + i]
  }

  zAt(x: number, y: number): number {
    const fx = (x - this.x0) / this.dx, fy = (y - this.y0) / this.dy
    let i = Math.floor(fx), j = Math.floor(fy)
    if (i < 0 || j < 0 || i > this.nx - 1 || j > this.ny - 1) return NaN
    if (i === this.nx - 1) i--          // the far edge belongs to the last cell
    if (j === this.ny - 1) j--
    if (i < 0 || j < 0) return NaN
    const u = fx - i, v = fy - j
    const z00 = this.node(i, j), z10 = this.node(i + 1, j)
    const z01 = this.node(i, j + 1), z11 = this.node(i + 1, j + 1)
    return u >= v
      ? z00 + u * (z10 - z00) + v * (z11 - z10)
      : z00 + v * (z01 - z00) + u * (z11 - z01)
  }

  each(box: Box, cb: (t: PlaneTri) => void): void {
    const i0 = Math.max(0, Math.floor((box.x0 - this.x0) / this.dx))
    const j0 = Math.max(0, Math.floor((box.y0 - this.y0) / this.dy))
    const i1 = Math.min(this.nx - 2, Math.floor((box.x1 - this.x0) / this.dx))
    const j1 = Math.min(this.ny - 2, Math.floor((box.y1 - this.y0) / this.dy))
    for (let j = j0; j <= j1; j++) {
      const ya = this.y0 + j * this.dy, yb = ya + this.dy
      for (let i = i0; i <= i1; i++) {
        const xa = this.x0 + i * this.dx, xb = xa + this.dx
        const z00 = this.node(i, j), z10 = this.node(i + 1, j)
        const z01 = this.node(i, j + 1), z11 = this.node(i + 1, j + 1)
        if (!Number.isFinite(z00) || !Number.isFinite(z11)) continue
        if (Number.isFinite(z10)) {
          const pl = planeOf(xa, ya, z00, xb, ya, z10, xb, yb, z11)
          if (pl) cb({ v: [xa, ya, xb, ya, xb, yb], ...pl })
        }
        if (Number.isFinite(z01)) {
          const pl = planeOf(xa, ya, z00, xb, yb, z11, xa, yb, z01)
          if (pl) cb({ v: [xa, ya, xb, yb, xa, yb], ...pl })
        }
      }
    }
  }

  /** Box of the grid's data (node centres). */
  bounds(): Box {
    return { x0: this.x0, y0: this.y0, x1: this.x0 + (this.nx - 1) * this.dx, y1: this.y0 + (this.ny - 1) * this.dy }
  }
}

/** A surface that is another surface plus a constant (the datum offset). */
export class OffsetSurface implements Surface {
  constructor(private base: Surface, private dz: number) {}
  zAt(x: number, y: number): number { return this.base.zAt(x, y) + this.dz }
  each(box: Box, cb: (t: PlaneTri) => void): void {
    this.base.each(box, t => cb({ v: t.v, p0: t.p0 + this.dz, p1: t.p1, p2: t.p2 }))
  }
}

// ── TIN from traced features ───────────────────────────────────────────────

export interface TinPoint {
  x: number
  y: number
  z: number
  /** Which traced feature it came from (for warnings). */
  src: string
}

export interface TinBuild {
  tin: TinSurface | null
  /** Plain-words problems found while building (crossing contours, conflicts). */
  warnings: string[]
  /** Constraint segments that could not be honoured. */
  droppedEdges: number
  /** Triangles whose three corners sit on one contour (flat spots). */
  flatTriangles: number
}

/**
 * Constrained Delaunay TIN. `edges` are pairs of indices into `points`
 * (consecutive contour vertices, pad edges). Points closer than 1 mm are
 * merged (first one wins; a different elevation there is a warning).
 */
export function buildTin(points: TinPoint[], edges: [number, number][]): TinBuild {
  const warnings: string[] = []
  // Merge near-duplicates on a 1 mm hash.
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`
  const seen = new Map<string, number>()
  const remap = new Int32Array(points.length)
  const pts: TinPoint[] = []
  const conflicts = new Set<string>()
  points.forEach((p, i) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) { remap[i] = -1; return }
    const k = key(p.x, p.y)
    const at = seen.get(k)
    if (at === undefined) { seen.set(k, pts.length); remap[i] = pts.length; pts.push(p) }
    else {
      remap[i] = at
      if (Math.abs(pts[at].z - p.z) > 0.01) conflicts.add(`${pts[at].src}|${p.src}`)
    }
  })
  for (const c of Array.from(conflicts)) {
    const [a, b] = c.split('|')
    warnings.push(`${a} and ${b} give two different elevations at the same spot — the first one is used.`)
  }
  if (pts.length < 3) return { tin: null, warnings, droppedEdges: 0, flatTriangles: 0 }

  const flat = new Float64Array(pts.length * 2)
  pts.forEach((p, i) => { flat[2 * i] = p.x; flat[2 * i + 1] = p.y })
  let del: Delaunator<Float64Array>
  try {
    del = new Delaunator(flat)
  } catch {
    warnings.push('The traced points all sit on one line — add points off that line.')
    return { tin: null, warnings, droppedEdges: 0, flatTriangles: 0 }
  }
  if (del.triangles.length === 0) {
    warnings.push('The traced points all sit on one line — add points off that line.')
    return { tin: null, warnings, droppedEdges: 0, flatTriangles: 0 }
  }

  // Constrain the contour segments. A segment that crosses an earlier one or
  // runs through another point can't be honoured — skip it, say which.
  const uniq = new Set<string>()
  const segs: [number, number][] = []
  for (const [a0, b0] of edges) {
    const a = remap[a0], b = remap[b0]
    if (a < 0 || b < 0 || a === b) continue
    const k = a < b ? `${a},${b}` : `${b},${a}`
    if (uniq.has(k)) continue
    uniq.add(k)
    segs.push([a, b])
  }
  let dropped = 0
  const droppedSrc = new Set<string>()
  if (segs.length) {
    const con = new Constrainautor(del)
    const accepted: [number, number][] = []
    const box = boxOf(flat)
    const idx = new BinIndex(box, Math.max((box.x1 - box.x0), (box.y1 - box.y0)) / 64 || 1)
    for (const [a, b] of segs) {
      const ax = flat[2 * a], ay = flat[2 * a + 1], bx = flat[2 * b], by = flat[2 * b + 1]
      const sb = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }
      let bad = false
      for (const id of idx.query(sb)) {
        const [c, d] = accepted[id]
        if (c === a || c === b || d === a || d === b) continue
        if (segmentsCross(ax, ay, bx, by, flat[2 * c], flat[2 * c + 1], flat[2 * d], flat[2 * d + 1])) { bad = true; break }
      }
      if (!bad) {
        try {
          con.constrainOne(a, b)
          idx.insert(accepted.length, sb)
          accepted.push([a, b])
          continue
        } catch {
          // runs through another point, or the library gave up — fall through
        }
      }
      dropped++
      droppedSrc.add(pts[a].src === pts[b].src ? pts[a].src : `${pts[a].src} / ${pts[b].src}`)
    }
    try { con.delaunify(true) } catch { /* the constrained triangulation stands as is */ }
  }
  if (dropped) {
    const names = Array.from(droppedSrc).slice(0, 4).join(', ')
    warnings.push(`${dropped} traced segment${dropped === 1 ? '' : 's'} cross another line (${names}) — check those traces.`)
  }

  const tin = new TinSurface(flat, pts.map(p => p.z), del.triangles)
  // Flat triangles: three corners from the same traced contour at one level.
  let flatTris = 0
  const tr = del.triangles
  for (let t = 0; t < tr.length; t += 3) {
    const a = pts[tr[t]], b = pts[tr[t + 1]], c = pts[tr[t + 2]]
    if (a.src === b.src && b.src === c.src && a.src.startsWith('contour') && a.z === b.z && b.z === c.z) flatTris++
  }
  return { tin, warnings, droppedEdges: dropped, flatTriangles: flatTris }
}

/** Proper crossing of two segments (shared endpoints and touching don't count). */
export function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const d1 = o(cx, cy, dx, dy, ax, ay)
  const d2 = o(cx, cy, dx, dy, bx, by)
  const d3 = o(ax, ay, bx, by, cx, cy)
  const d4 = o(ax, ay, bx, by, dx, dy)
  const eps = 1e-12
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
}

export class TinSurface implements Surface {
  readonly count: number
  /** Per triangle: ax, ay, bx, by, cx, cy (CCW). */
  private v: Float64Array
  /** Per triangle: p0, p1, p2. */
  private pl: Float64Array
  private live: Uint8Array
  private index: BinIndex
  private hits: number[] = []
  private seen = new Set<number>()

  constructor(xy: Float64Array, z: number[], tris: Uint32Array) {
    const n = tris.length / 3
    this.count = n
    this.v = new Float64Array(n * 6)
    this.pl = new Float64Array(n * 3)
    this.live = new Uint8Array(n)
    const box = boxOf(xy)
    const span = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1)
    // ~4 triangles per bin on average.
    this.index = new BinIndex(box, Math.max(span / Math.max(1, Math.sqrt(n / 4)), 0.5))
    for (let t = 0; t < n; t++) {
      let a = tris[3 * t], b = tris[3 * t + 1]
      const c = tris[3 * t + 2]
      let ax = xy[2 * a], ay = xy[2 * a + 1], bx = xy[2 * b], by = xy[2 * b + 1]
      const cx = xy[2 * c], cy = xy[2 * c + 1]
      if ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay) < 0) {
        ;[a, b] = [b, a]
        ;[ax, ay, bx, by] = [bx, by, ax, ay]
      }
      const p = planeOf(ax, ay, z[a], bx, by, z[b], cx, cy, z[c])
      if (!p) continue
      this.live[t] = 1
      this.v.set([ax, ay, bx, by, cx, cy], t * 6)
      this.pl[3 * t] = p.p0; this.pl[3 * t + 1] = p.p1; this.pl[3 * t + 2] = p.p2
      this.index.insert(t, {
        x0: Math.min(ax, bx, cx), y0: Math.min(ay, by, cy),
        x1: Math.max(ax, bx, cx), y1: Math.max(ay, by, cy),
      })
    }
  }

  zAt(x: number, y: number): number {
    this.hits.length = 0
    this.index.query({ x0: x, y0: y, x1: x, y1: y }, this.hits, this.seen)
    for (const t of this.hits) {
      const o = t * 6
      const ax = this.v[o], ay = this.v[o + 1], bx = this.v[o + 2], by = this.v[o + 3], cx = this.v[o + 4], cy = this.v[o + 5]
      const eps = -1e-9
      if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < eps) continue
      if ((cx - bx) * (y - by) - (cy - by) * (x - bx) < eps) continue
      if ((ax - cx) * (y - cy) - (ay - cy) * (x - cx) < eps) continue
      return this.pl[3 * t] + this.pl[3 * t + 1] * x + this.pl[3 * t + 2] * y
    }
    return NaN
  }

  each(box: Box, cb: (t: PlaneTri) => void): void {
    const hits: number[] = []
    this.index.query(box, hits)
    for (const t of hits) {
      if (!this.live[t]) continue
      const o = t * 6
      cb({
        v: [this.v[o], this.v[o + 1], this.v[o + 2], this.v[o + 3], this.v[o + 4], this.v[o + 5]],
        p0: this.pl[3 * t], p1: this.pl[3 * t + 1], p2: this.pl[3 * t + 2],
      })
    }
  }
}
