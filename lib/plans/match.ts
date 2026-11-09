/**
 * Putting a plan sheet on the map by its own drawing — pure.
 *
 * Brian, Nov 9: "Buildings, property lines … We also definitely need to take
 * note of zoomed out plan sets with zoomed in areas. When scaled and put on
 * grid or on map they need to be accurate to each other … Haywood Mall
 * project had 4 quadrants. Our Clemson project was linear (roads)."
 *
 * One idea serves both jobs. A CORNER is where two drawn lines meet — a
 * building corner, a property line's angle point, a curb return — with the
 * directions of its two lines. Two drawings of the same ground share corners,
 * and one shared corner (position + its two directions) fixes a whole
 * similarity once the scale is known. So: every pairing of a distinctive
 * corner on sheet A with a like-shaped corner on B proposes a placement; the
 * placement that lands the most of A's corners on B's corners (same spot,
 * same directions) wins, refined by least squares over everything it matched.
 *
 *  - sheet → ground: B = building footprints (and county parcel lines where a
 *    service is set) in local metres around the site.
 *  - sheet → sheet: B = another sheet of the set. CAD drawings of the same
 *    model are exact, so an enlarged quadrant lands on its overall plan to a
 *    fraction of a point, and two road sheets meet across their matchline.
 *
 * A match is only taken when it is SURE — enough corners, spread across the
 * drawing, a small residual, and no rival placement nearly as good (repeated
 * geometry — a row of identical buildings — must never be guessed). Anything
 * less is left for the person: two points, as far apart as the sheet allows.
 *
 * Harness: node scripts/plan-match-test.mjs — run it after ANY change here.
 */

import type { PdfLine, PdfPen } from '../dirt/pdf-vectors'

export interface Corner {
  x: number
  y: number
  /** Directions of its two lines (radians), CCW from a1 to a2 = the opening (< π). */
  a1: number
  a2: number
  /** The shorter of its two lines — longer = more distinctive. */
  len: number
  /** 0 any · 1 building · 2 property / right-of-way line. */
  role: 0 | 1 | 2
}

/** Stored on plan_versions.features. Page points, y up. */
export interface PlanFeatures {
  v: 1
  /** Flat [x, y, a1·1000, a2·1000, len, role] per corner (rounded). */
  c: number[]
  /** The drawing area the corners came from. */
  box: [number, number, number, number]
}

export interface Similarity { s: number; th: number; tx: number; ty: number }

export interface MatchResult extends Similarity {
  /** Corners matched. */
  n: number
  /** Root-mean-square miss of the matched corners, in B's units. */
  rms: number
  /** How far apart the matched corners are on B (bounding-box diagonal, B's units). */
  spread: number
  /** The best rival placement's corner count (a different placement). */
  rival: number
}

const TAU = Math.PI * 2
export const wrap = (a: number) => { let x = a % TAU; if (x > Math.PI) x -= TAU; if (x <= -Math.PI) x += TAU; return x }
const opening = (c: Corner) => { const o = (c.a2 - c.a1) % TAU; return o < 0 ? o + TAU : o }

export function apply(t: Similarity, x: number, y: number): [number, number] {
  const c = Math.cos(t.th) * t.s, s = Math.sin(t.th) * t.s
  return [c * x - s * y + t.tx, s * x + c * y + t.ty]
}

export function compose(outer: Similarity, inner: Similarity): Similarity {
  // outer ∘ inner
  const th = wrap(outer.th + inner.th), s = outer.s * inner.s
  const [tx, ty] = apply(outer, inner.tx, inner.ty)
  return { s, th, tx, ty }
}

export function invert(t: Similarity): Similarity {
  const s = 1 / t.s, th = -t.th
  const c = Math.cos(th) * s, sn = Math.sin(th) * s
  return { s, th, tx: -(c * t.tx - sn * t.ty), ty: -(sn * t.tx + c * t.ty) }
}

// ── Corners from line work ──────────────────────────────────────────────────

export interface Seg { x0: number; y0: number; x1: number; y1: number; role: 0 | 1 | 2 }

/**
 * Corners where exactly two segments meet at an angle between 35° and 145°
 * (three or more = a tee or a hatch's edge, ambiguous; straighter = just a
 * bend). `snap` joins endpoints that miss by a hair; `minLen` drops text
 * strokes and hatch ticks.
 */
export function cornersOf(segs: Seg[], snap: number, minLen: number, max = 600): Corner[] {
  const nodes = new Map<string, { x: number; y: number; ends: { dx: number; dy: number; len: number; role: number }[] }>()
  const key = (x: number, y: number) => `${Math.round(x / snap)},${Math.round(y / snap)}`
  const add = (x: number, y: number, ox: number, oy: number, len: number, role: number) => {
    const k = key(x, y)
    let n = nodes.get(k)
    if (!n) { n = { x, y, ends: [] }; nodes.set(k, n) }
    // the same segment twice (a double stroke) counts once
    const dx = (ox - x) / len, dy = (oy - y) / len
    if (n.ends.some((e) => Math.abs(e.dx - dx) < 0.02 && Math.abs(e.dy - dy) < 0.02)) return
    n.ends.push({ dx, dy, len, role })
  }
  for (const s of segs) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0)
    if (!(len >= minLen)) continue
    add(s.x0, s.y0, s.x1, s.y1, len, s.role)
    add(s.x1, s.y1, s.x0, s.y0, len, s.role)
  }
  const out: Corner[] = []
  for (const n of Array.from(nodes.values())) {
    if (n.ends.length !== 2) continue
    const [e, f] = n.ends
    const cross = e.dx * f.dy - e.dy * f.dx, dot = e.dx * f.dx + e.dy * f.dy
    const ang = Math.atan2(Math.abs(cross), dot)
    if (ang < (35 * Math.PI) / 180 || ang > (145 * Math.PI) / 180) continue
    const [p, q] = cross >= 0 ? [e, f] : [f, e]
    out.push({ x: n.x, y: n.y, a1: Math.atan2(p.dy, p.dx), a2: Math.atan2(q.dy, q.dx), len: Math.min(e.len, f.len), role: Math.max(e.role, f.role) as 0 | 1 | 2 })
  }
  out.sort((a, b) => (b.len * (1 + b.role)) - (a.len * (1 + a.role)))
  return out.slice(0, max)
}

const BUILDING_LAYER = /BLDG|BUILD|STRUCT|FOOTPRINT|FFE/i
const BOUNDARY_LAYER = /PROP|BOUND|\bPL\b|R-?O-?W|PARCEL|\bLOT\b|EASE/i

/** The sheet's corners off its pdf.js line work (viewed space, points). */
export function planFeatures(pens: PdfPen[], lines: PdfLine[], size: { width: number; height: number }, box?: { x0: number; y0: number; x1: number; y1: number } | null): PlanFeatures | null {
  const W = size.width, H = size.height
  if (!(W > 0 && H > 0)) return null
  // Crop fractions are of the page with y DOWN (lib/plans/crop.ts); corners are y up.
  const bx: [number, number, number, number] = box
    ? [box.x0 * W, (1 - box.y1) * H, box.x1 * W, (1 - box.y0) * H]
    : [0.02 * W, 0.02 * H, 0.84 * W, 0.98 * H]
  const roleOf = new Map<number, 0 | 1 | 2>()
  for (const p of pens) {
    const l = p.layer ?? ''
    // A dash-dot pen is how boundaries are drawn when the export lost its layers.
    const dashDot = (p.dash.split(',').filter(Boolean).length >= 4)
    roleOf.set(p.id, BUILDING_LAYER.test(l) ? 1 : (BOUNDARY_LAYER.test(l) || dashDot) ? 2 : 0)
  }
  const segs: Seg[] = []
  for (const ln of lines) {
    const role = roleOf.get(ln.pen) ?? 0
    const p = ln.pts
    const n = p.length / 2
    for (let i = 0; i + 1 < n + (ln.closed ? 1 : 0); i++) {
      const j = (i + 1) % n
      const x0 = p[2 * i], y0 = p[2 * i + 1], x1 = p[2 * j], y1 = p[2 * j + 1]
      const cut = clipSeg(x0, y0, x1, y1, bx)
      if (cut) segs.push({ x0: cut[0], y0: cut[1], x1: cut[2], y1: cut[3], role })
      if (segs.length > 60_000) break
    }
    if (segs.length > 60_000) break
  }
  const corners = cornersOf(segs, 0.35, 4, 500)
  if (corners.length < 8) return null
  const r = (v: number) => Math.round(v * 10) / 10
  return {
    v: 1,
    c: corners.flatMap((c) => [r(c.x), r(c.y), Math.round(c.a1 * 1000), Math.round(c.a2 * 1000), r(c.len), c.role]),
    box: [r(bx[0]), r(bx[1]), r(bx[2]), r(bx[3])],
  }
}

/** A segment cut to a box (Liang–Barsky); null when it misses. A line that
 *  runs off the drawing keeps its inside part, so the corner it makes inside
 *  still counts (a quadrant's buildings are cut by its matchlines). */
export function clipSeg(x0: number, y0: number, x1: number, y1: number, b: [number, number, number, number]): [number, number, number, number] | null {
  let t0 = 0, t1 = 1
  const dx = x1 - x0, dy = y1 - y0
  const p = [-dx, dx, -dy, dy], q = [x0 - b[0], b[2] - x0, y0 - b[1], b[3] - y0]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue }
    const r = q[i] / p[i]
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r } else { if (r < t0) return null; if (r < t1) t1 = r }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy]
}

export function cornersFrom(f: unknown): Corner[] {
  const c = (f as PlanFeatures | null)?.c
  if (!Array.isArray(c) || c.length % 6) return []
  const out: Corner[] = []
  for (let i = 0; i + 5 < c.length && out.length < 600; i += 6) {
    const [x, y, a1, a2, len, role] = c.slice(i, i + 6)
    if (![x, y, a1, a2, len].every((v) => typeof v === 'number' && Number.isFinite(v))) continue
    out.push({ x, y, a1: a1 / 1000, a2: a2 / 1000, len, role: role === 1 || role === 2 ? role : 0 })
  }
  return out
}

export function cleanFeatures(f: unknown): PlanFeatures | null {
  const cs = cornersFrom(f)
  const b = (f as PlanFeatures | null)?.box
  if (cs.length < 8 || !Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return { v: 1, c: cs.flatMap((c) => [c.x, c.y, Math.round(c.a1 * 1000), Math.round(c.a2 * 1000), c.len, c.role]), box: b as PlanFeatures['box'] }
}

// ── The match ───────────────────────────────────────────────────────────────

export interface MatchOpts {
  /** B units per A unit to try (the scale is known up to a list). */
  scales: number[]
  /** How far a matched corner may land from its partner, B units. */
  tol: number
  /** How much a corner's directions may disagree. */
  angTol?: number
  /** Least squares may move the scale this much (fraction) off the tried one. */
  scaleSlack?: number
}

interface Grid { cell: number; map: Map<string, number[]>; pts: Corner[] }

function gridOf(pts: Corner[], cell: number): Grid {
  const map = new Map<string, number[]>()
  pts.forEach((p, i) => {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`
    const l = map.get(k); if (l) l.push(i); else map.set(k, [i])
  })
  return { cell, map, pts }
}

/** Partner of every A corner under t (or -1), one partner per B corner. */
function partners(t: Similarity, A: Corner[], g: Grid, tol: number, angTol: number): number[] {
  const out = new Array<number>(A.length).fill(-1)
  const used = new Set<number>()
  for (let i = 0; i < A.length; i++) {
    const a = A[i]
    const [x, y] = apply(t, a.x, a.y)
    const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell)
    let best = -1, bd = tol
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = g.map.get(`${cx + dx},${cy + dy}`)
      if (!l) continue
      for (const j of l) {
        if (used.has(j)) continue
        const b = g.pts[j]
        const d = Math.hypot(b.x - x, b.y - y)
        if (d >= bd) continue
        if (Math.abs(wrap(b.a1 - (a.a1 + t.th))) > angTol || Math.abs(wrap(b.a2 - (a.a2 + t.th))) > angTol) continue
        best = j; bd = d
      }
    }
    if (best >= 0) { out[i] = best; used.add(best) }
  }
  return out
}

function countHits(t: Similarity, A: Corner[], g: Grid, tol: number, angTol: number): number {
  let n = 0
  for (const a of A) {
    const [x, y] = apply(t, a.x, a.y)
    const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell)
    let hit = false
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) {
      const l = g.map.get(`${cx + dx},${cy + dy}`)
      if (!l) continue
      for (const j of l) {
        const b = g.pts[j]
        if (Math.hypot(b.x - x, b.y - y) < tol && Math.abs(wrap(b.a1 - (a.a1 + t.th))) <= angTol) { hit = true; break }
      }
    }
    if (hit) n++
  }
  return n
}

/** Least-squares similarity B ≈ T(A) over paired points (Umeyama, no reflection). */
export function fitSimilarity(P: [number, number][], Q: [number, number][]): Similarity | null {
  const n = P.length
  if (n < 2) return null
  let px = 0, py = 0, qx = 0, qy = 0
  for (let i = 0; i < n; i++) { px += P[i][0]; py += P[i][1]; qx += Q[i][0]; qy += Q[i][1] }
  px /= n; py /= n; qx /= n; qy /= n
  let sxx = 0, a = 0, b = 0
  for (let i = 0; i < n; i++) {
    const ux = P[i][0] - px, uy = P[i][1] - py, vx = Q[i][0] - qx, vy = Q[i][1] - qy
    sxx += ux * ux + uy * uy
    a += ux * vx + uy * vy
    b += ux * vy - uy * vx
  }
  if (!(sxx > 0)) return null
  const th = Math.atan2(b, a)
  const s = Math.hypot(a, b) / sxx
  const c = Math.cos(th) * s, sn = Math.sin(th) * s
  return { s, th, tx: qx - (c * px - sn * py), ty: qy - (sn * px + c * py) }
}

function refine(t0: Similarity, A: Corner[], g: Grid, tol: number, angTol: number, sMin: number, sMax: number): { t: Similarity; pairs: [number, number][] } | null {
  let t = t0
  let pairs: [number, number][] = []
  for (let it = 0; it < 4; it++) {
    const pr = partners(t, A, g, tol, angTol)
    pairs = []
    pr.forEach((j, i) => { if (j >= 0) pairs.push([i, j]) })
    if (pairs.length < 3) return null
    const f = fitSimilarity(pairs.map(([i]) => [A[i].x, A[i].y]), pairs.map(([, j]) => [g.pts[j].x, g.pts[j].y]))
    if (!f || f.s < sMin || f.s > sMax) return null
    t = f
  }
  return { t, pairs }
}

/**
 * The placement that lands the most of A's corners on B's. Null when there
 * is nothing worth calling a match (fewer than 3 corners agree).
 */
export function matchCorners(Ain: Corner[], Bin: Corner[], o: MatchOpts): MatchResult | null {
  const angTol = o.angTol ?? (8 * Math.PI) / 180
  const slack = o.scaleSlack ?? 0.03
  const A = Ain.slice(0, 400), B = Bin.slice(0, 600)
  if (A.length < 3 || B.length < 3) return null
  const g = gridOf(B, o.tol)
  const anchors = A.slice(0, 40)
  // A thin sample of A scores every proposal cheaply; the best few get the full count.
  const step = Math.max(1, Math.floor(A.length / 70))
  const sample = A.filter((_, i) => i % step === 0)
  const props: { t: Similarity; pre: number; s0: number }[] = []
  for (const s of o.scales) {
    if (!(s > 0)) continue
    for (const a of anchors) {
      const oa = opening(a)
      for (const b of B) {
        if (Math.abs(opening(b) - oa) > angTol) continue
        const th = wrap(b.a1 - a.a1)
        const c = Math.cos(th) * s, sn = Math.sin(th) * s
        const t = { s, th, tx: b.x - (c * a.x - sn * a.y), ty: b.y - (sn * a.x + c * a.y) }
        const pre = countHits(t, sample, g, o.tol, angTol)
        if (pre >= 2) props.push({ t, pre, s0: s })
      }
    }
  }
  if (!props.length) return null
  props.sort((p, q) => q.pre - p.pre)
  const scored: { t: Similarity; pairs: [number, number][] }[] = []
  for (const p of props.slice(0, 60)) {
    const r = refine(p.t, A, g, o.tol, angTol, p.s0 * (1 - slack), p.s0 * (1 + slack))
    if (r && r.pairs.length >= 3) scored.push(r)
  }
  if (!scored.length) return null
  scored.sort((p, q) => q.pairs.length - p.pairs.length)
  const best = scored[0]
  // A rival = a placement that puts A's middle somewhere else (or turned).
  const ax = A.reduce((t, c) => t + c.x, 0) / A.length, ay = A.reduce((t, c) => t + c.y, 0) / A.length
  const [mx, my] = apply(best.t, ax, ay)
  let rival = 0
  for (const r of scored.slice(1)) {
    const [rx, ry] = apply(r.t, ax, ay)
    if (Math.hypot(rx - mx, ry - my) > 3 * o.tol || Math.abs(wrap(r.t.th - best.t.th)) > (2 * Math.PI) / 180) { rival = Math.max(rival, r.pairs.length) }
  }
  let ss = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [i, j] of best.pairs) {
    const [x, y] = apply(best.t, A[i].x, A[i].y)
    const b = B[j]
    ss += (b.x - x) ** 2 + (b.y - y) ** 2
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x); y1 = Math.max(y1, b.y)
  }
  return { ...best.t, n: best.pairs.length, rms: Math.sqrt(ss / best.pairs.length), spread: Math.hypot(x1 - x0, y1 - y0), rival }
}

// ── Sure enough? ────────────────────────────────────────────────────────────

/** Sheet ↔ sheet: CAD to CAD is exact, so the bar is high. `ftPerB` = feet per B unit. */
export function sheetMatchSure(m: MatchResult | null, ftPerB: number, bDiag: number): boolean {
  if (!m) return false
  return m.n >= 10 && m.rms * ftPerB <= 1 && m.rival <= 0.6 * m.n && m.spread >= 0.1 * bDiag
}

/** Sheet → ground (metres): footprints are traced from imagery, a metre or two off. */
export function groundMatchSure(m: MatchResult | null, sheetDiagM: number): boolean {
  if (!m) return false
  return m.n >= 6 && m.rms <= 2 && m.rival <= 0.6 * m.n && m.spread >= 0.15 * sheetDiagM
}

/** Engineering scales (feet per inch) to try when a sheet states none. */
export const COMMON_FPI = [10, 20, 30, 40, 50, 60, 80, 100, 200]

/** Scale ratios A→B to try between two sheets (A pts → B pts). */
export function sheetRatios(fpiA: number | null, fpiB: number | null): number[] {
  if (fpiA && fpiB) return [fpiA / fpiB]
  const out = new Set<number>()
  const as = fpiA ? [fpiA] : COMMON_FPI, bs = fpiB ? [fpiB] : COMMON_FPI
  for (const a of as) for (const b of bs) { const r = a / b; if (r >= 0.1 && r <= 10) out.add(Math.round(r * 1e6) / 1e6) }
  return Array.from(out).slice(0, 30)
}

// ── Page ↔ ground ───────────────────────────────────────────────────────────

export type LngLat = [number, number]
export type Corners4 = [LngLat, LngLat, LngLat, LngLat]

const M_PER_DEG_LAT = 110_574
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

/** Local metres (east, north) around an origin ↔ lng/lat. */
export function toLocal(o: LngLat, p: LngLat): [number, number] {
  return [(p[0] - o[0]) * kx(o[1]), (p[1] - o[1]) * M_PER_DEG_LAT]
}
export function fromLocal(o: LngLat, x: number, y: number): LngLat {
  return [o[0] + x / kx(o[1]), o[1] + y / M_PER_DEG_LAT]
}

/** The picture's corners (TL, TR, BR, BL) for a page → local-metres similarity. */
export function cornersFor(t: Similarity, o: LngLat, W: number, H: number): Corners4 {
  const at = (x: number, y: number) => { const [ex, ey] = apply(t, x, y); return fromLocal(o, ex, ey) }
  return [at(0, H), at(W, H), at(W, 0), at(0, 0)]
}

/** The page → local-metres similarity a placed picture's corners imply. */
export function similarityOf(c: Corners4, o: LngLat, W: number, H: number): Similarity | null {
  const page: [number, number][] = [[0, H], [W, H], [W, 0], [0, 0]]
  const local = c.map((p) => toLocal(o, p))
  return fitSimilarity(page, local)
}

/** How far apart two hand-picked points are, as a share of the sheet's
 *  drawing — the two-point line-up is only as good as their spread. */
export function spreadWords(dPage: number, diagPage: number): { ok: boolean; words: string } {
  const f = diagPage > 0 ? dPage / diagPage : 0
  if (f >= 0.5) return { ok: true, words: 'Good spread — the points are far apart.' }
  if (f >= 0.25) return { ok: true, words: 'OK — points farther apart line it up better.' }
  return { ok: false, words: 'These points are close together — pick two as far apart as the sheet allows.' }
}
