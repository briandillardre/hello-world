/**
 * Counting a run once where two sheets draw it — pure.
 *
 * Brian, Nov 9 (Bluebeam's pain): an overall plan and its enlarged quadrant,
 * or two road sheets that meet at a matchline, both show the same stretch of
 * pipe, curb or paving. Measured on both, it is bid twice. Sheets the plan
 * room has LINKED (plan_links — their drawings matched corner for corner,
 * lib/plans/match.ts) know exactly where they sit on each other, so a mark on
 * one can be laid onto the other and the shared part found:
 *
 *  - lines / perimeters: the share of the mark's length that runs along a mark
 *    of the same item on the other sheet (within `tolFt`);
 *  - areas / volumes: the share of its area inside a mark of the same item;
 *  - counts: a count within `tolFt` of a count of the same item.
 *
 * The deduction is that share of the mark's own quantity, so it works in any
 * unit. Only one sheet of a pair gives up its share (the later one in sheet
 * order), a mark never gives up more than all of itself, and every deduction
 * is reported by sheet pair — the takeoff SAYS "C-102 ∩ C-101: −42 LF",
 * it never quietly shrinks.
 *
 * Marks are page fractions: u from the left, v from the TOP. Links are page
 * points with y UP (the corners' space).
 */

import { apply, invert, type Similarity } from './match'

export type UV = [number, number]

export interface OMark {
  id: string
  itemId: string
  kind: 'line' | 'area' | 'count'
  /** Closed outline (an area item's perimeter) — measured as a loop. */
  closed?: boolean
  pts: UV[]
  holes?: UV[][]
  qty: number
}

export interface OSheet {
  versionId: string
  /** Sheet order (the later one gives up the shared part). */
  order: string
  W: number
  H: number
  /** Feet per page point — for the tolerance. */
  ftPerPt: number
  marks: OMark[]
}

export interface OLink { a: string; b: string; t: Similarity }

export interface Deduction { itemId: string; from: string; against: string; qty: number }

type P = [number, number]

const toPage = (s: OSheet, p: UV): P => [p[0] * s.W, (1 - p[1]) * s.H]

function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function inRing(p: P, r: P[]): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const inArea = (p: P, outer: P[], holes: P[][]) => inRing(p, outer) && !holes.some((h) => inRing(p, h))

function pathOf(pts: P[], closed: boolean): [P, P][] {
  const out: [P, P][] = []
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]])
  if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]])
  return out
}

/** Share (0..1) of path A lying within tol of any of the paths B. */
function lineShare(A: [P, P][], B: [P, P][][], tol: number): number {
  let total = 0, shared = 0
  for (const [a, b] of A) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!L) continue
    const n = Math.max(1, Math.ceil(L / (tol / 2)))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const p: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      total += L / n
      if (B.some((path) => path.some(([c, d]) => segDist(p, c, d) <= tol))) shared += L / n
    }
  }
  return total ? shared / total : 0
}

/** Share (0..1) of area A inside any of the areas B — sampled on a grid. */
function areaShare(Aout: P[], Aholes: P[][], B: { outer: P[]; holes: P[][] }[], step: number): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of Aout) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  if (!(x1 > x0 && y1 > y0)) return 0
  // Keep the sample count bounded whatever the size.
  const s = Math.max(step, Math.sqrt(((x1 - x0) * (y1 - y0)) / 40_000))
  let inA = 0, both = 0
  for (let x = x0 + s / 2; x < x1; x += s) {
    for (let y = y0 + s / 2; y < y1; y += s) {
      const p: P = [x, y]
      if (!inArea(p, Aout, Aholes)) continue
      inA++
      if (B.some((b) => inArea(p, b.outer, b.holes))) both++
    }
  }
  return inA ? both / inA : 0
}

/**
 * What to take off each item for marks that two linked sheets both carry.
 * `tolFt` = how close two drawings of the same run may lie (default 1.5 ft).
 */
export function overlapDeductions(sheets: OSheet[], links: OLink[], tolFt = 1.5): Deduction[] {
  const byId = new Map(sheets.map((s) => [s.versionId, s]))
  const taken = new Map<string, number>() // mark id → share already given up
  const out = new Map<string, Deduction>()
  for (const l of links) {
    let A = byId.get(l.a), B = byId.get(l.b)
    if (!A || !B || !A.marks.length || !B.marks.length) continue
    // The later sheet gives up the shared part: put it in A, map A → B.
    let t = l.t
    if (A.order < B.order) { const x = A; A = B; B = x; t = invert(l.t) }
    const tol = tolFt / B.ftPerPt
    const onB = (p: UV): P => apply(t, ...toPage(A!, p))
    for (const m of A.marks) {
      const mine = B.marks.filter((x) => x.itemId === m.itemId && x.kind === m.kind)
      if (!mine.length || !(m.qty > 0)) continue
      let share = 0
      if (m.kind === 'count') {
        const p = onB(m.pts[0])
        share = mine.some((x) => { const q = toPage(B!, x.pts[0]); return Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol }) ? 1 : 0
      } else if (m.kind === 'line' || m.closed) {
        const path = pathOf(m.pts.map(onB), m.kind === 'area')
        share = lineShare(path, mine.map((x) => pathOf(x.pts.map((p) => toPage(B!, p)), x.kind === 'area')), tol)
      } else {
        share = areaShare(m.pts.map(onB), (m.holes ?? []).map((h) => h.map(onB)),
          mine.map((x) => ({ outer: x.pts.map((p) => toPage(B!, p)), holes: (x.holes ?? []).map((h) => h.map((p) => toPage(B!, p))) })), tol)
      }
      const already = taken.get(m.id) ?? 0
      share = Math.min(share, 1 - already)
      if (share < 0.01) continue
      taken.set(m.id, already + share)
      const key = `${m.itemId}|${A.versionId}|${B.versionId}`
      const d = out.get(key) ?? { itemId: m.itemId, from: A.versionId, against: B.versionId, qty: 0 }
      d.qty += m.qty * share
      out.set(key, d)
    }
  }
  return Array.from(out.values()).map((d) => ({ ...d, qty: Math.round(d.qty * 1000) / 1000 }))
}
