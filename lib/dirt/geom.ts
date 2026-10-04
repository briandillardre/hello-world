/**
 * Planar geometry for the dirt takeoff — polygons as flat [x0,y0,x1,y1,…]
 * arrays in frame metres. Pure; harness: scripts/dirt-test.mjs.
 *
 * Every volume is integrated over CONVEX pieces on which both surfaces are
 * linear and every area (demo, topsoil, pavement, pad) is either fully in or
 * fully out. Pieces come from clipping one surface's triangle by the other's
 * (Sutherland–Hodgman) and then cutting along each area edge that crosses
 * them — a cut along an edge's whole line is harmless (just one more piece),
 * so the edge walls come out exactly vertical with no sliver approximation.
 */

export type Poly = number[]

/** Signed area (CCW positive) of a flat ring. */
export function signedArea(p: ArrayLike<number>): number {
  let s = 0
  const n = p.length
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    s += p[i] * p[j + 1] - p[j] * p[i + 1]
  }
  return s / 2
}

export function polyArea(p: ArrayLike<number>): number {
  return Math.abs(signedArea(p))
}

/** Area centroid of a convex (or simple) polygon; falls back to the vertex mean on slivers. */
export function centroid(p: ArrayLike<number>): [number, number] {
  let a = 0, cx = 0, cy = 0
  const n = p.length
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    const cr = p[i] * p[j + 1] - p[j] * p[i + 1]
    a += cr
    cx += (p[i] + p[j]) * cr
    cy += (p[i + 1] + p[j + 1]) * cr
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0
    for (let i = 0; i < n; i += 2) { sx += p[i]; sy += p[i + 1] }
    return [sx / (n / 2), sy / (n / 2)]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** Even-odd point-in-ring test. */
export function pointInRing(x: number, y: number, r: ArrayLike<number>): boolean {
  let inside = false
  const n = r.length
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const yi = r[i + 1], yj = r[j + 1]
    if ((yi > y) !== (yj > y)) {
      const xi = r[i], xj = r[j]
      if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export function boxOf(p: ArrayLike<number>): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
}

/** Make a flat ring counter-clockwise (in place) and return it. */
export function ccw(p: Poly): Poly {
  if (signedArea(p) < 0) {
    for (let i = 0, j = p.length - 2; i < j; i += 2, j -= 2) {
      const tx = p[i], ty = p[i + 1]
      p[i] = p[j]; p[i + 1] = p[j + 1]
      p[j] = tx; p[j + 1] = ty
    }
  }
  return p
}

/**
 * Clip a convex polygon by a CCW triangle (a convex clip region).
 * Returns the intersection (possibly empty → []).
 */
export function clipByTriangle(subject: Poly, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Poly {
  let out = subject
  out = clipHalf(out, ax, ay, bx, by)
  if (out.length < 6) return []
  out = clipHalf(out, bx, by, cx, cy)
  if (out.length < 6) return []
  out = clipHalf(out, cx, cy, ax, ay)
  return out.length < 6 ? [] : out
}

/** Keep the part of `p` to the LEFT of the directed line a→b (inclusive). */
function clipHalf(p: Poly, ax: number, ay: number, bx: number, by: number): Poly {
  const out: Poly = []
  const n = p.length
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const side = (x: number, y: number) => (dx * (y - ay) - dy * (x - ax)) / len
  let px = p[n - 2], py = p[n - 1]
  let ps = side(px, py)
  for (let i = 0; i < n; i += 2) {
    const qx = p[i], qy = p[i + 1]
    const qs = side(qx, qy)
    const pIn = ps >= -1e-12, qIn = qs >= -1e-12
    if (qIn) {
      if (!pIn) {
        const t = ps / (ps - qs)
        out.push(px + t * (qx - px), py + t * (qy - py))
      }
      out.push(qx, qy)
    } else if (pIn) {
      const t = ps / (ps - qs)
      out.push(px + t * (qx - px), py + t * (qy - py))
    }
    px = qx; py = qy; ps = qs
  }
  return dedupe(out)
}

/** Drop consecutive duplicate vertices (clipping leaves them on shared edges). */
function dedupe(p: Poly): Poly {
  if (p.length < 4) return p
  const out: Poly = []
  const n = p.length
  for (let i = 0; i < n; i += 2) {
    const j = (i + n - 2) % n
    if (Math.abs(p[i] - p[j]) > 1e-12 || Math.abs(p[i + 1] - p[j + 1]) > 1e-12) out.push(p[i], p[i + 1])
  }
  return out
}

/**
 * Does segment a→b pass through the interior of convex `p` for a positive
 * length? (Touching a vertex or running along an edge does not count.)
 */
export function segmentCrosses(p: Poly, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-18) return false
  const len = Math.sqrt(len2)
  const n = p.length
  let pos = false, neg = false
  for (let i = 0; i < n; i += 2) {
    const s = (dx * (p[i + 1] - ay) - dy * (p[i] - ax)) / len
    if (s > 1e-9) pos = true
    else if (s < -1e-9) neg = true
    if (pos && neg) break
  }
  if (!(pos && neg)) return false
  // Chord of the line through p, as parameters along a→b.
  let tMin = Infinity, tMax = -Infinity
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    const s1 = (dx * (p[i + 1] - ay) - dy * (p[i] - ax)) / len
    const s2 = (dx * (p[j + 1] - ay) - dy * (p[j] - ax)) / len
    if ((s1 > 0) !== (s2 > 0) || s1 === 0 || s2 === 0) {
      const den = s1 - s2
      const u = den === 0 ? 0 : s1 / den
      const ix = p[i] + u * (p[j] - p[i]), iy = p[i + 1] + u * (p[j + 1] - p[i + 1])
      const t = ((ix - ax) * dx + (iy - ay) * dy) / len2
      if (t < tMin) tMin = t
      if (t > tMax) tMax = t
    }
  }
  const lo = Math.max(tMin, 0), hi = Math.min(tMax, 1)
  return hi - lo > 1e-9 / len
}

/** Split convex `p` by the infinite line through a→b; empty halves are dropped. */
export function splitByLine(p: Poly, ax: number, ay: number, bx: number, by: number): Poly[] {
  const left = clipHalf(p, ax, ay, bx, by)
  const right = clipHalf(p, bx, by, ax, ay)
  const out: Poly[] = []
  if (left.length >= 6 && polyArea(left) > 1e-10) out.push(left)
  if (right.length >= 6 && polyArea(right) > 1e-10) out.push(right)
  return out.length ? out : [p]
}

/**
 * Exact ∫ max(d,0) dA and ∫ max(−d,0) dA over a triangle where d is linear,
 * given the vertex values. The zero line cuts a lone-signed vertex off as a
 * small triangle whose integral is A·p³ / (3(p−q)(p−r)).
 */
export function triPosNeg(area: number, a: number, b: number, c: number): [number, number] {
  const total = (area * (a + b + c)) / 3
  const pos = (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0) + (c > 0 ? 1 : 0)
  const neg = (a < 0 ? 1 : 0) + (b < 0 ? 1 : 0) + (c < 0 ? 1 : 0)
  if (neg === 0) return [total, 0]
  if (pos === 0) return [0, -total]
  if (pos === 1) {
    // lone positive vertex p, others q, r ≤ 0
    const [p, q, r] = a > 0 ? [a, b, c] : b > 0 ? [b, c, a] : [c, a, b]
    const P = (area * p * p * p) / (3 * (p - q) * (p - r))
    return [P, P - total]
  }
  // lone negative vertex
  const [p, q, r] = a < 0 ? [a, b, c] : b < 0 ? [b, c, a] : [c, a, b]
  const Nn = (area * -p * -p * -p) / (3 * (q - p) * (r - p))
  return [total + Nn, Nn]
}

/**
 * Exact positive/negative integral of a linear function over a convex polygon,
 * given its value at each vertex (fan from vertex 0).
 */
export function polyPosNeg(p: Poly, vals: ArrayLike<number>): [number, number] {
  let P = 0, Nn = 0
  const n = p.length / 2
  for (let i = 1; i < n - 1; i++) {
    const ax = p[0], ay = p[1]
    const bx = p[2 * i], by = p[2 * i + 1]
    const cx = p[2 * i + 2], cy = p[2 * i + 3]
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
    if (area < 1e-14) continue
    const [pp, nn] = triPosNeg(area, vals[0], vals[i], vals[i + 1])
    P += pp; Nn += nn
  }
  return [P, Nn]
}

/** Uniform bin index over boxes (triangles, segments, rings). */
/**
 * Does a closed ring cross itself — two edges that aren't neighbours properly
 * intersecting? A bowtie's signed area is |A1 − A2| while point-in-ring sees
 * A1 + A2, so a self-crossing area can't be measured honestly: refuse it.
 */
export function ringSelfCrosses(ring: ArrayLike<number>): boolean {
  const n = ring.length >> 1
  if (n < 4) return false
  const b = boxOf(ring)
  const idx = new BinIndex(b, Math.max(b.x1 - b.x0, b.y1 - b.y0, 1e-9) / Math.max(4, Math.ceil(Math.sqrt(n))))
  const eb = (i: number): Box => {
    const j = (i + 1) % n
    return { x0: Math.min(ring[2 * i], ring[2 * j]), y0: Math.min(ring[2 * i + 1], ring[2 * j + 1]), x1: Math.max(ring[2 * i], ring[2 * j]), y1: Math.max(ring[2 * i + 1], ring[2 * j + 1]) }
  }
  for (let i = 0; i < n; i++) idx.insert(i, eb(i))
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const hits: number[] = []
  const seen = new Set<number>()
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n
    const ax = ring[2 * i], ay = ring[2 * i + 1], bx = ring[2 * i2], by = ring[2 * i2 + 1]
    const len = Math.hypot(bx - ax, by - ay)
    hits.length = 0
    idx.query(eb(i), hits, seen)
    for (const j of hits) {
      if (j <= i || j === i + 1 || (i === 0 && j === n - 1)) continue
      const j2 = (j + 1) % n
      const cx = ring[2 * j], cy = ring[2 * j + 1], dx = ring[2 * j2], dy = ring[2 * j2 + 1]
      const eps = 1e-9 * Math.max(len, Math.hypot(dx - cx, dy - cy), 1e-9)
      const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by)
      const d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy)
      if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true
    }
  }
  return false
}

export class BinIndex {
  readonly x0: number
  readonly y0: number
  readonly size: number
  readonly nx: number
  readonly ny: number
  private bins: Map<number, number[]> = new Map()

  constructor(bounds: Box, size: number) {
    this.size = Math.max(size, 1e-6)
    this.x0 = bounds.x0
    this.y0 = bounds.y0
    this.nx = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / this.size) + 1)
    this.ny = Math.max(1, Math.ceil((bounds.y1 - bounds.y0) / this.size) + 1)
  }

  private span(b: Box): [number, number, number, number] {
    const i0 = Math.max(0, Math.floor((b.x0 - this.x0) / this.size))
    const j0 = Math.max(0, Math.floor((b.y0 - this.y0) / this.size))
    const i1 = Math.min(this.nx - 1, Math.floor((b.x1 - this.x0) / this.size))
    const j1 = Math.min(this.ny - 1, Math.floor((b.y1 - this.y0) / this.size))
    return [i0, j0, i1, j1]
  }

  insert(id: number, b: Box): void {
    const [i0, j0, i1, j1] = this.span(b)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i
        let bin = this.bins.get(k)
        if (!bin) { bin = []; this.bins.set(k, bin) }
        bin.push(id)
      }
    }
  }

  /** Ids whose bins touch `b` (deduplicated; callers still test exact overlap). */
  query(b: Box, out: number[] = [], seen?: Set<number>): number[] {
    const [i0, j0, i1, j1] = this.span(b)
    const s = seen ?? new Set<number>()
    if (seen) seen.clear()
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const bin = this.bins.get(j * this.nx + i)
        if (!bin) continue
        for (const id of bin) {
          if (!s.has(id)) { s.add(id); out.push(id) }
        }
      }
    }
    return out
  }
}
