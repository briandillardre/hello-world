/**
 * Reading a grading plan — pure. Turns a sheet's vectors and words
 * (pdf-vectors.ts) into contours with elevations, spot grades, building pads
 * and the limit of grading, all in PDF user space (plan-geo.ts maps them).
 *
 * The pipeline, and why each step exists:
 *
 *  1. PENS. Linework is grouped by pen (CAD layer + colour + width + dash).
 *     Each pen gets a suggested role — existing contour, proposed contour or
 *     not a contour — from its layer name, the elevation labels sitting on
 *     it, dashes (existing is dashed by convention), screening (existing is
 *     grey) and shape (contours are long and smooth). The estimator confirms.
 *  2. CHAINS. Exporters break a contour into pieces: exploded dashes (every
 *     dash its own path), label gaps, sheet clipping. Pieces of one pen are
 *     joined end to end when the ends meet, or face each other across a
 *     dash-sized gap.
 *  3. LABELS. A contour label sits ON its line or in a gap cut for it. Each
 *     whole-number label is matched to the line(s) beside it, parallel when
 *     the words have a direction; a label in a gap also stitches the two
 *     pieces back into one contour.
 *  4. LADDERS. Only index contours carry labels. Rays across the contours
 *     give ordered "ladders"; between two known contours the unlabelled ones
 *     step evenly (812, ·, ·, ·, ·, 817 → 813…816), which also measures the
 *     contour interval. Votes from every ladder decide; a ridge or valley
 *     (812, ·, 812) is ambiguous and never guessed.
 *  5. LIDAR (existing only). Existing contours are checked against the USGS
 *     ground: the median difference is the plan's datum offset, a contour far
 *     off is flagged, and an existing contour nothing else could reach takes
 *     the interval step nearest the lidar.
 *  6. SPOTS, PADS, LIMITS. Spot elevations with their tags (GS, FG, TC, BC…,
 *     paired across separate SHX words), the finished floor with the building
 *     outline around it, and a limit-of-grading ring when the plan has one.
 */
import { BinIndex, pointInRing, polyArea, type Box } from './geom'
import type { PdfLine, PdfPen, PdfText } from './pdf-vectors'

export type Role = 'eg' | 'fg' | 'none'
export type How = 'label' | 'ladder' | 'tie-in' | 'lidar' | 'extrapolated' | 'user' | null

export interface PenSummary extends PdfPen {
  lines: number
  length: number
  medianLen: number
  labels: number
  suggested: Role
  why: string
}

export interface PlanContour {
  id: number
  role: 'eg' | 'fg'
  pen: number
  pts: number[]
  closed: boolean
  z: number | null
  how: How
  flags: string[]
}

export interface PlanSpot { x: number; y: number; z: number; role: 'eg' | 'fg' | 'skip'; tag: string; text: string }
export interface PlanPad { ring: number[]; ffe: number; text: string; outline: boolean }

export interface PlanRead {
  contours: PlanContour[]
  /** Ladders (ordered contour ids along rays), kept so re-propagation after an edit is instant. */
  ladders: number[][]
  interval: { eg: number | null; fg: number | null }
  datumFt: number | null
  spots: PlanSpot[]
  pads: PlanPad[]
  limits: number[] | null
  warnings: string[]
  /** Lines the estimator set aside ("Not a contour"), as read — they took part in nothing. */
  aside?: PlanContour[]
  /** The read area the linework was clipped to (null = the whole sheet). */
  box?: Box | null
}

export interface ReadInput {
  pens: PdfPen[]
  lines: PdfLine[]
  texts: PdfText[]
  /** Only read inside this page-space box (the site + a margin — keeps legends and title blocks out). */
  box?: Box | null
  /** Page points per ground foot (from the sheet's placement); sizes tolerances. */
  ptPerFt?: number
}

export interface ReadOptions {
  roles: Record<number, Role>
  /** Existing ground (ft, plan datum NOT applied) at a page point, NaN where unknown — lidar. */
  existingFt?: (x: number, y: number) => number
  /** Interval the estimator typed, when the plan can't show it. */
  interval?: { eg?: number | null; fg?: number | null }
  /** Lines the estimator set aside ("Not a contour"), as an earlier read drew them. */
  exclude?: number[][]
}

// ── small geometry ─────────────────────────────────────────────────────────

const lenOf = (p: number[]) => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s }

function boxOfPts(p: ArrayLike<number>): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i]
    if (p[i] > x1) x1 = p[i]
    if (p[i + 1] < y0) y0 = p[i + 1]
    if (p[i + 1] > y1) y1 = p[i + 1]
  }
  return { x0, y0, x1, y1 }
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Ray (px,py)+t·(dx,dy) against segment AB: t, or NaN. Unit (dx,dy). */
function rayHit(px: number, py: number, dx: number, dy: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax, ey = by - ay
  const den = dx * ey - dy * ex
  if (Math.abs(den) < 1e-12) return NaN
  const wx = ax - px, wy = ay - py
  const t = (wx * ey - wy * ex) / den
  const s = (wx * dy - wy * dx) / den
  return s >= 0 && s <= 1 ? t : NaN
}

/** Douglas–Peucker on a flat polyline. */
export function simplify(p: number[], tol: number): number[] {
  const n = p.length / 2
  if (n <= 2 || tol <= 0) return p.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    let best = -1, bestD = tol
    for (let k = i + 1; k < j; k++) {
      const d = distToSeg(p[2 * k], p[2 * k + 1], p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1])
      if (d > bestD) { bestD = d; best = k }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]) }
  }
  const out: number[] = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(p[2 * k], p[2 * k + 1])
  return out
}

/** Clip a polyline to a box (Liang–Barsky per segment); pieces that leave and come back are separate. */
function clipToBox(p: number[], b: Box): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  const inside = (x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1]
    let t0 = 0, t1 = 1
    const dx = bx - ax, dy = by - ay
    const clip = (pp: number, q: number): boolean => {
      if (pp === 0) return q >= 0
      const r = q / pp
      if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r } else { if (r < t0) return false; if (r < t1) t1 = r }
      return true
    }
    if (!(clip(-dx, ax - b.x0) && clip(dx, b.x1 - ax) && clip(-dy, ay - b.y0) && clip(dy, b.y1 - ay))) {
      if (cur.length >= 4) out.push(cur)
      cur = []
      continue
    }
    const sx = ax + t0 * dx, sy = ay + t0 * dy, ex = ax + t1 * dx, ey = ay + t1 * dy
    if (!cur.length) cur.push(sx, sy)
    else if (Math.hypot(cur[cur.length - 2] - sx, cur[cur.length - 1] - sy) > 1e-9) { if (cur.length >= 4) out.push(cur); cur = [sx, sy] }
    cur.push(ex, ey)
    if (t1 < 1 || !inside(bx, by)) { if (cur.length >= 4) out.push(cur); cur = [] }
  }
  if (cur.length >= 4) out.push(cur)
  return out
}

// ── numbers in words ───────────────────────────────────────────────────────

/** A contour label: a whole number (or .5), nothing else — in parentheses when it is existing ground (a common convention). */
const CONTOUR_LABEL = /^([(\[]?)\s*(-?\d{1,5}(?:\.[05])?)\s*([)\]]?)$/
function labelValue(s: string): number | null {
  const m = s.match(CONTOUR_LABEL)
  if (!m || !m[1] !== !m[3]) return null
  return Number(m[2])
}
/**
 * How far from a label's centre its gap's ends can be, and how close a line
 * must pass to be the one it sits on. An SHX label's box is axis-aligned
 * around rotated words, so its short side is not the letter height — use the
 * smaller of the two.
 */
const labelReach = (t: PdfText) => t.len * 0.75 + Math.min(t.size, t.len) + 2
const onLine = (t: PdfText) => Math.min(t.size, t.len) * 0.6 + 1

/** A number with decimals: a spot elevation (alone or tagged). */
const DECIMAL_WORDS = /^\(?\s*-?\d{1,5}\.\d{1,3}\s*\)?$|^-?\d{1,5}\.\d{1,3}\s*[A-Z]{1,5}$|^[A-Z]{1,5}\s*[=:]?\s*-?\d{1,5}\.\d{1,3}$/i
const SPOT_NUM = /^\(?\s*(-?\d{1,5}\.\d{1,3})\s*\)?$/
const TAG_FIRST = /^([A-Z][A-Z.]{0,5})\s*[=:]?\s*(-?\d{1,5}(?:\.\d{1,3})?)$/i
const TAG_AFTER = /^(-?\d{1,5}\.\d{1,3})\s*([A-Z][A-Z.]{0,5})$/i
const FF_WORDS = /^(?:G?\.?F\.?\s?F\.?\s?E?\.?|FIN(?:ISH(?:ED)?)?\.?\s*FL(?:OO)?R\.?)\s*(?:ELEV\.?)?\s*[=:]?\s*(-?\d{1,5}(?:\.\d{1,3})?)$/i

/** What a spot tag means for the takeoff. `skip` = not ground (curb tops, walls, pipes). */
export const SPOT_TAGS: Record<string, 'eg' | 'fg' | 'skip' | 'ff'> = {
  GS: 'eg', EG: 'eg', EX: 'eg', EXG: 'eg', OG: 'eg', NG: 'eg', E: 'eg', GRD: 'eg',
  FG: 'fg', FS: 'fg', BC: 'fg', FL: 'fg', EP: 'fg', EOP: 'fg', HP: 'fg', LP: 'fg', ME: 'fg', G: 'fg', GR: 'fg',
  P: 'fg', PVMT: 'fg', BW: 'fg', BOW: 'fg', PAD: 'fg', SW: 'fg', BS: 'fg', TOE: 'fg',
  TC: 'skip', TW: 'skip', TOW: 'skip', TOP: 'skip', RIM: 'skip', TG: 'skip', INV: 'skip', IE: 'skip', TOC: 'skip', TS: 'skip', TF: 'skip',
  FF: 'ff', FFE: 'ff', GFF: 'ff',
}
const normTag = (t: string) => t.replace(/\./g, '').toUpperCase()

const isWhite = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return r >= 0xf0 && g >= 0xf0 && b >= 0xf0
}
const isGrey = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && r >= 0x70 && r < 0xf0
}

const layerBase = (layer: string | null) => (layer ?? '').split('|').pop() ?? ''
const EXIST_HINT = /(^|[^A-Z])(EX|EXIST|EXST|EXG|EG|OG|SURV|SURVEY)([^A-Z]|$)|^V-|TOPO\|/i
const PROP_HINT = /(^|[^A-Z])(PROP|PRO|PR|FG|FIN|DSGN|DESIGN|GRAD|GRADING)([^A-Z]|$)/i
/** The status field at the end of an NCS layer name: …-E existing, …-N new. */
const EXIST_STATUS = /-(E|EX|EXST|EXIS)$/i
const PROP_STATUS = /-(N|NEW|PROP|PR)$/i
const CONTOUR_NAME = /CONT|CNTR|CTR|MAJR|MINR|MAJOR|MINOR|INDEX|INTRM|TOPO/i
const NOT_CONTOUR_NAME = /TEXT|TXT|LABEL|LBL|ANNO|SPOT|POINT|SHOT|TREE|FENCE|BLDG|BUILD|ROOF|DECK|CURB|ETW|PAVE|DRIVE|WALL|PIPE|DRAIN|STORM|SEW|WATER|ELEC|GAS|PROPERTY|EASE|ROW|RIGHT|CENTER|SECTION|DETAIL|HATCH|TTLB|TITLE|BORDER|NOTE|DIM/i

// ── 1. Pens ────────────────────────────────────────────────────────────────

interface Prepared {
  lines: { pen: number; pts: number[]; closed: boolean; len: number }[]
  texts: PdfText[]
  /** Whole numbers that are NOT contour labels: survey point numbers beside their shot's elevation. */
  notLabel: Set<PdfText>
  lineIdx: BinIndex | null
  segPen: number[]
  segs: number[]
}

function prepare(inp: ReadInput): Prepared {
  const lines: Prepared['lines'] = []
  for (const l of inp.lines) {
    const parts = inp.box ? clipToBox(l.pts, inp.box) : [l.pts]
    for (const p of parts) {
      if (p.length < 4) continue
      lines.push({ pen: l.pen, pts: p, closed: l.closed && parts.length === 1, len: lenOf(p) })
    }
  }
  const texts = inp.box ? inp.texts.filter(t => t.x >= inp.box!.x0 && t.x <= inp.box!.x1 && t.y >= inp.box!.y0 && t.y <= inp.box!.y1) : inp.texts.slice()
  // One index over every segment, for "what lies beside this word".
  const segs: number[] = [], segPen: number[] = []
  let all: Box | null = null
  for (const l of lines) {
    const b = boxOfPts(l.pts)
    all = all ? { x0: Math.min(all.x0, b.x0), y0: Math.min(all.y0, b.y0), x1: Math.max(all.x1, b.x1), y1: Math.max(all.y1, b.y1) } : b
  }
  let lineIdx: BinIndex | null = null
  if (all) {
    const span = Math.max(all.x1 - all.x0, all.y1 - all.y0, 1)
    lineIdx = new BinIndex(all, Math.max(span / 256, 2))
    lines.forEach((l, li) => {
      for (let i = 2; i < l.pts.length; i += 2) {
        const id = segPen.length
        segs.push(l.pts[i - 2], l.pts[i - 1], l.pts[i], l.pts[i + 1], li)
        segPen.push(l.pen)
        lineIdx!.insert(id, { x0: Math.min(l.pts[i - 2], l.pts[i]), y0: Math.min(l.pts[i - 1], l.pts[i + 1]), x1: Math.max(l.pts[i - 2], l.pts[i]), y1: Math.max(l.pts[i - 1], l.pts[i + 1]) })
      }
    })
  }
  return { lines, texts, lineIdx, segPen, segs, notLabel: pointNumbers(texts) }
}

/**
 * Survey shots are drawn as a point number and the elevation side by side
 * ("126" over "286.57"). A whole number touching a decimal one is that point
 * number, never a contour label.
 */
function pointNumbers(texts: PdfText[]): Set<PdfText> {
  const out = new Set<PdfText>()
  const dec = texts.filter(t => DECIMAL_WORDS.test(t.str))
  if (!dec.length) return out
  const b = boxOfPts(dec.flatMap(t => [t.x, t.y]))
  const cell = Math.max(4, median(dec.map(t => t.size)) * 4)
  const idx = new BinIndex({ x0: b.x0 - cell, y0: b.y0 - cell, x1: b.x1 + cell, y1: b.y1 + cell }, cell)
  dec.forEach((t, i) => idx.insert(i, { x0: t.x, y0: t.y, x1: t.x, y1: t.y }))
  const hits: number[] = [], seen = new Set<number>()
  for (const t of texts) {
    if (labelValue(t.str) === null) continue
    const r = t.len + t.size * 3
    hits.length = 0
    idx.query({ x0: t.x - r, y0: t.y - r, x1: t.x + r, y1: t.y + r }, hits, seen)
    for (const i of hits) {
      const d = dec[i]
      const gap = Math.hypot(d.x - t.x, d.y - t.y) - (t.len + d.len) / 4
      // Drawn as a pair: same kind of words, the same height, touching.
      if (d.src !== t.src || t.size > d.size * 1.4 || t.size < d.size * 0.7) continue
      if (gap <= 1.2 * d.size) { out.add(t); break }
    }
  }
  return out
}

/** Segments (ids) within r of a point. */
function near(P: Prepared, x: number, y: number, r: number, out: number[] = [], seen = new Set<number>()): number[] {
  out.length = 0
  if (!P.lineIdx) return out
  const hits: number[] = []
  P.lineIdx.query({ x0: x - r, y0: y - r, x1: x + r, y1: y + r }, hits, seen)
  for (const id of hits) {
    const o = id * 5
    if (distToSeg(x, y, P.segs[o], P.segs[o + 1], P.segs[o + 2], P.segs[o + 3]) <= r) out.push(id)
  }
  return out
}

/**
 * The pen each contour label belongs to: the line it sits ON (parallel, when
 * the words have a direction), or the line whose two ends face each other
 * across it (the gap a label is cut into).
 */
function labelPens(P: Prepared, pens: PdfPen[]): Map<PdfText, number> {
  const out = new Map<PdfText, number>()
  const seen = new Set<number>(), buf: number[] = []
  const white = new Set(pens.filter(p => isWhite(p.color)).map(p => p.id))
  for (const t of P.texts) {
    if (labelValue(t.str) === null || P.notLabel.has(t)) continue
    const r = labelReach(t)
    let best = -1, bestD = onLine(t)
    const ends = new Map<number, { x: number; y: number; ox: number; oy: number }[]>()
    const lineSeen = new Set<number>()
    const frame = Math.max(t.len, t.size) * 1.6 // a box or a circle drawn around the words is not their line
    for (const id of near(P, t.x, t.y, r, buf, seen)) {
      const o = id * 5
      const li = P.segs[o + 4]
      const line = P.lines[li]
      if (line.len < t.size * 3 || white.has(line.pen)) continue // glyph strokes of the word itself, masks
      if (line.closed && line.len < frame * 4) continue
      const d = distToSeg(t.x, t.y, P.segs[o], P.segs[o + 1], P.segs[o + 2], P.segs[o + 3])
      if (d < bestD) {
        const dx = P.segs[o + 2] - P.segs[o], dy = P.segs[o + 3] - P.segs[o + 1], l = Math.hypot(dx, dy) || 1
        if (t.src !== 'text' || Math.abs((dx / l) * Math.cos(t.angle) + (dy / l) * Math.sin(t.angle)) >= 0.82) { bestD = d; best = P.segPen[id] }
      }
      if (line.closed || lineSeen.has(li)) continue
      lineSeen.add(li)
      for (const e of endsOf(line.pts, li)) {
        if (Math.hypot(e.x - t.x, e.y - t.y) > r || (t.x - e.x) * e.ox + (t.y - e.y) * e.oy <= 0) continue
        const a = ends.get(line.pen) ?? []
        a.push(e)
        ends.set(line.pen, a)
      }
    }
    if (best < 0) {
      for (const [pen, es] of Array.from(ends.entries())) {
        let hit = false
        for (let i = 0; i < es.length && !hit; i++) for (let j = i + 1; j < es.length && !hit; j++) {
          const a = es[i], b = es[j]
          if ((a.x - t.x) * (b.x - t.x) + (a.y - t.y) * (b.y - t.y) >= 0 || a.ox * b.ox + a.oy * b.oy > -0.5) continue
          if (distToSeg(t.x, t.y, a.x, a.y, b.x, b.y) <= Math.max(t.size * 0.6, 1)) hit = true
        }
        if (hit) { best = pen; break }
      }
    }
    if (best >= 0) out.set(t, best)
  }
  return out
}

/** Share of a polyline's corners that are gentle bends — contours bend a little everywhere; hatching zig-zags, property lines run straight. */
function curvy(pts: number[]): number {
  let bends = 0, n = 0
  for (let i = 2; i + 2 < pts.length; i += 2) {
    const ax = pts[i] - pts[i - 2], ay = pts[i + 1] - pts[i - 1]
    const bx = pts[i + 2] - pts[i], by = pts[i + 3] - pts[i + 1]
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
    if (la < 1e-9 || lb < 1e-9) continue
    const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))))
    n++
    if (turn > 0.005 && turn < 0.6) bends++
  }
  return n ? bends / n : 0
}

/** How far apart a pen's pieces may be and still be one line: dashes drawn one by one, else touching ends only. */
function joinGap(ls: number[][]): number {
  if (!ls.length) return 0.6
  const medianLen = ls.map(lenOf).sort((a, b) => a - b)[ls.length >> 1] ?? 0
  const tg = medianLen < 15 ? typicalGap(ls) : 0
  return tg > 0 ? Math.min(12, Math.max(1, tg * 2.5)) : 0.6
}

/** Every pen in the read area with its numbers and a suggested role. */
export function summarizePens(inp: ReadInput): PenSummary[] {
  const P = prepare(inp)
  const lp = labelPens(P, inp.pens)
  const labels = new Map<number, number>()
  for (const pen of Array.from(lp.values())) labels.set(pen, (labels.get(pen) ?? 0) + 1)
  const piecesOf = new Map<number, number[][]>()
  for (const l of P.lines) {
    const a = piecesOf.get(l.pen)
    if (a) a.push(l.pts); else piecesOf.set(l.pen, [l.pts])
  }
  const out: PenSummary[] = []
  const stats = new Map<number, { smooth: number; chainMedian: number }>()
  for (const pen of inp.pens) {
    const ls = piecesOf.get(pen.id)
    if (!ls) continue
    const lens = ls.map(lenOf).sort((a, b) => a - b)
    const total = lens.reduce((a, b) => a + b, 0)
    const medianLen = lens[lens.length >> 1] ?? 0
    if (isWhite(pen.color)) {
      // White on white: masks behind words, wipeouts — never printed, never a contour.
      out.push({ ...pen, lines: ls.length, length: total, medianLen, labels: 0, suggested: 'none', why: 'white (a mask, not printed)' })
      continue
    }
    // Judge the lines the read would see: the pen's pieces joined (dashes drawn one by one become one line).
    const chains = chainLines(ls.length > 40_000 ? ls.slice(0, 40_000) : ls, joinGap(ls))
    let longLen = 0, smoothW = 0, closedN = 0
    const cl: number[] = []
    for (const c of chains) {
      const L = lenOf(c.pts)
      cl.push(L)
      if (L >= 24) longLen += L
      if (c.pts.length >= 8) smoothW += curvy(c.pts) * L
      if (c.closed) closedN++
    }
    cl.sort((a, b) => a - b)
    const chainMedian = cl[cl.length >> 1] ?? 0
    const joinedLen = cl.reduce((a, b) => a + b, 0) || 1
    const smooth = smoothW / joinedLen
    const longShare = longLen / joinedLen
    stats.set(pen.id, { smooth, chainMedian })
    const nLabels = labels.get(pen.id) ?? 0
    const base = layerBase(pen.layer)
    const named = CONTOUR_NAME.test(base) && !NOT_CONTOUR_NAME.test(base)
    const notNamed = NOT_CONTOUR_NAME.test(base)
    let score = 0
    const why: string[] = []
    if (named) { score += 2.5; why.push(`layer ${base}`) }
    if (notNamed) { score -= 2.5 }
    if (nLabels >= 2) { score += Math.min(3, 1 + nLabels / 4); why.push(`${nLabels} elevation labels on it`) }
    if (smooth > 0.35 && longShare > 0.5) { score += 1; why.push('long smooth lines') }
    else if (smooth < 0.15 && longShare >= 0.5 && !named) { score -= 2; why.push('straight or zig-zag lines') }
    if (longShare < 0.5) { score -= 3; why.push('short marks (text, hatching, symbols)') }
    if (closedN / Math.max(1, chains.length) > 0.6 && !named) score -= 1
    if (total < 60) score -= 2
    let suggested: Role = 'none'
    if (score >= 2) {
      const ex = (EXIST_HINT.test(pen.layer ?? '') || EXIST_STATUS.test(base)) && !PROP_HINT.test(base) && !PROP_STATUS.test(base)
      const pr = (PROP_HINT.test(base) || PROP_STATUS.test(base)) && !/EXIST|EXST/i.test(base)
      suggested = ex ? 'eg' : pr ? 'fg' : pen.dash || isGrey(pen.color) ? 'eg' : 'fg'
      why.push(suggested === 'eg' ? (ex ? 'existing layer' : pen.dash ? 'dashed' : 'screened grey') : (pr ? 'proposed layer' : 'solid'))
    }
    out.push({ ...pen, lines: ls.length, length: total, medianLen, labels: nLabels, suggested, why: why.join(' · ') })
  }
  // Minor contours carry no labels: a pen drawn like a labelled contour pen goes with it — the
  // same layer family (…-MAJR / …-MINR), or, with no layers, the same colour and dash with
  // long smooth lines of its own (black solid building lines must not ride along).
  for (const p of out) {
    if (p.suggested !== 'none' || p.length <= 60 || isWhite(p.color)) continue
    const st = stats.get(p.id)
    if (!st || st.chainMedian < 24) continue
    const fam = (l: string | null, re: RegExp) => layerBase(l).replace(re, '')
    const twin = out.find(q => {
      if (q.suggested === 'none' || q.labels < 2 || q.color !== p.color || q.dash !== p.dash) return false
      if (p.layer || q.layer) return !!p.layer && !!q.layer && p.layer !== q.layer && fam(q.layer, /MAJ(O?R)?|INDEX/i) === fam(p.layer, /MIN(O?R)?|INTRM|INTER/i)
      return st.smooth > 0.35 && p.width !== q.width
    })
    if (twin) { p.suggested = twin.suggested; p.why = `drawn like the labelled ${twin.suggested === 'eg' ? 'existing' : 'proposed'} contours` }
  }
  return out.sort((a, b) => (b.suggested !== 'none' ? 1 : 0) - (a.suggested !== 'none' ? 1 : 0) || b.labels - a.labels || b.length - a.length)
}

// ── 2. Chains ──────────────────────────────────────────────────────────────

interface End { line: number; at: 0 | 1; x: number; y: number; ox: number; oy: number }

/** Does any long line (any pen — not only the contours read) end facing these words within `reach`? */
function facesAnyEnd(P: Prepared, t: PdfText, reach: number): boolean {
  if (!P.lineIdx) return false
  const hits: number[] = []
  P.lineIdx.query({ x0: t.x - reach, y0: t.y - reach, x1: t.x + reach, y1: t.y + reach }, hits)
  const minLen = Math.max(t.len, 3 * t.size) // not the words' own strokes, not a hatch tick
  const seen = new Set<number>()
  for (const id of hits) {
    const li = P.segs[id * 5 + 4]
    if (seen.has(li)) continue
    seen.add(li)
    const l = P.lines[li]
    if (l.closed || l.len < minLen) continue
    for (const e of endsOf(l.pts, li)) {
      if (Math.hypot(e.x - t.x, e.y - t.y) <= reach && (t.x - e.x) * e.ox + (t.y - e.y) * e.oy > 0) return true
    }
  }
  return false
}

function endsOf(pts: number[], line: number): [End, End] {
  const n = pts.length
  const dir = (ax: number, ay: number, bx: number, by: number): [number, number] => {
    const dx = ax - bx, dy = ay - by, l = Math.hypot(dx, dy) || 1
    return [dx / l, dy / l]
  }
  // Outward tangent from a few points in (a single point is noisy on dense polylines).
  const k = Math.min(n - 2, 6)
  const [o0x, o0y] = dir(pts[0], pts[1], pts[k], pts[k + 1])
  const [o1x, o1y] = dir(pts[n - 2], pts[n - 1], pts[n - 2 - k], pts[n - 1 - k])
  return [
    { line, at: 0, x: pts[0], y: pts[1], ox: o0x, oy: o0y },
    { line, at: 1, x: pts[n - 2], y: pts[n - 1], ox: o1x, oy: o1y },
  ]
}

/**
 * Join polylines end to end: touching ends always, ends facing each other
 * across ≤ `gap` (exploded dashes) when both point into the gap. `forced`
 * adds links found elsewhere (a label's gap). Returns the joined polylines.
 */
export function chainLines(
  lines: number[][],
  gap: number,
  forced: [number, 0 | 1, number, 0 | 1][] = [],
  touch = 0.05,
): { pts: number[]; closed: boolean; from: number[] }[] {
  const ends: End[] = []
  lines.forEach((p, i) => { if (p.length >= 4) ends.push(...endsOf(p, i)) })
  const idOf = (line: number, at: 0 | 1) => line * 2 + at
  const link = new Int32Array(lines.length * 2).fill(-1)
  for (const [la, aa, lb, ab] of forced) {
    const a = idOf(la, aa), b = idOf(lb, ab)
    if (link[a] < 0 && link[b] < 0 && a !== b) { link[a] = b; link[b] = a }
  }
  if (ends.length) {
    const b = boxOfPts(ends.flatMap(e => [e.x, e.y]))
    const idx = new BinIndex(b, Math.max(gap, touch, 1))
    ends.forEach((e, i) => idx.insert(i, { x0: e.x, y0: e.y, x1: e.x, y1: e.y }))
    // Touching ends, by exact neighbourhood — a seal or a signature packs thousands of
    // strokes into a few points, where the gap search below would go quadratic.
    const cellT = Math.max(touch, 1e-6) * 2
    const fine = new Map<string, number[]>()
    const keyT = (x: number, y: number) => `${Math.floor(x / cellT)}:${Math.floor(y / cellT)}`
    ends.forEach((e, i) => { const k = keyT(e.x, e.y); const a = fine.get(k); if (a) a.push(i); else fine.set(k, [i]) })
    const cellG = Math.max(gap, touch, 1)
    const dense = new Map<string, number>()
    const keyG = (x: number, y: number) => `${Math.floor(x / cellG)}:${Math.floor(y / cellG)}`
    for (const e of ends) { const k = keyG(e.x, e.y); dense.set(k, (dense.get(k) ?? 0) + 1) }
    const crowd = (x: number, y: number) => {
      const cx = Math.floor(x / cellG), cy = Math.floor(y / cellG)
      let n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += dense.get(`${cx + dx}:${cy + dy}`) ?? 0
      return n
    }
    const cand: [number, number, number][] = []
    const hits: number[] = [], seen = new Set<number>()
    const cosTol = Math.cos((35 * Math.PI) / 180)
    ends.forEach((e, i) => {
      if (crowd(e.x, e.y) > 96) {
        // Crowded: touching ends only.
        const cx = Math.floor(e.x / cellT), cy = Math.floor(e.y / cellT)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          for (const j of fine.get(`${cx + dx}:${cy + dy}`) ?? []) {
            if (j <= i) continue
            const f = ends[j]
            if (f.line === e.line && lines[e.line].length < 8) continue
            const d = Math.hypot(f.x - e.x, f.y - e.y)
            if (d <= touch) cand.push([d, i, j])
          }
        }
        return
      }
      hits.length = 0
      idx.query({ x0: e.x - gap, y0: e.y - gap, x1: e.x + gap, y1: e.y + gap }, hits, seen)
      for (const j of hits) {
        if (j <= i) continue
        const f = ends[j]
        const dx = f.x - e.x, dy = f.y - e.y, d = Math.hypot(dx, dy)
        if (d > gap) continue
        if (f.line === e.line && lines[e.line].length < 8) continue
        if (d <= touch) { cand.push([d, i, j]); continue }
        const ux = dx / d, uy = dy / d
        const a1 = e.ox * ux + e.oy * uy, a2 = -(f.ox * ux + f.oy * uy)
        const facing = -(e.ox * f.ox + e.oy * f.oy)
        if (a1 >= cosTol && a2 >= cosTol && facing >= cosTol) cand.push([d * (2 - a1 - a2 + 1 - facing + 1), i, j])
      }
    })
    cand.sort((p, q) => p[0] - q[0])
    for (const [, i, j] of cand) {
      const a = idOf(ends[i].line, ends[i].at), b = idOf(ends[j].line, ends[j].at)
      if (link[a] >= 0 || link[b] >= 0) continue
      link[a] = b; link[b] = a
    }
  }
  // Walk.
  const visited = new Uint8Array(lines.length)
  const out: { pts: number[]; closed: boolean; from: number[] }[] = []
  for (let L = 0; L < lines.length; L++) {
    if (visited[L] || lines[L].length < 4) continue
    // Back up to the chain's start (or detect a cycle).
    let line = L, enter: 0 | 1 = 0, cycle = false
    for (let guard = 0; guard <= lines.length; guard++) {
      const o = link[idOf(line, enter)]
      if (o < 0) break
      const prev = o >> 1, prevExit = (o & 1) as 0 | 1
      const prevEnter = (1 - prevExit) as 0 | 1
      if (prev === L || prev === line) { cycle = true; break } // back where it started: a ring
      line = prev; enter = prevEnter
    }
    if (cycle) { line = L; enter = 0 }
    const pts: number[] = []
    const from: number[] = []
    const startLine = line, startEnter = enter
    for (let guard = 0; guard <= lines.length; guard++) {
      if (visited[line]) break
      visited[line] = 1
      from.push(line)
      const p = lines[line]
      const n = p.length / 2
      for (let k = 0; k < n; k++) {
        const v = enter === 0 ? k : n - 1 - k
        const x = p[2 * v], y = p[2 * v + 1]
        if (pts.length && Math.abs(pts[pts.length - 2] - x) <= touch && Math.abs(pts[pts.length - 1] - y) <= touch) continue
        pts.push(x, y)
      }
      const exit = (1 - enter) as 0 | 1
      const o = link[idOf(line, exit)]
      if (o < 0) break
      const next = o >> 1
      if (next === startLine && (o & 1) === startEnter) { cycle = true; break }
      line = next; enter = (o & 1) as 0 | 1
    }
    if (pts.length >= 4) {
      const closed = cycle || (pts.length >= 8 && Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) <= touch)
      out.push({ pts, closed, from })
    }
  }
  return out
}

/** Typical gap between a pen's pieces (exploded dashes): median distance from an end to its nearest other end. */
function typicalGap(lines: number[][]): number {
  const ends: End[] = []
  lines.forEach((p, i) => { if (p.length >= 4) ends.push(...endsOf(p, i)) })
  if (ends.length < 8) return 0
  const b = boxOfPts(ends.flatMap(e => [e.x, e.y]))
  const idx = new BinIndex(b, Math.max((b.x1 - b.x0 + b.y1 - b.y0) / 200, 1))
  ends.forEach((e, i) => idx.insert(i, { x0: e.x, y0: e.y, x1: e.x, y1: e.y }))
  const ds: number[] = []
  const hits: number[] = [], seen = new Set<number>()
  // Density first: a seal or a signature packs thousands of ends into a few points — not linework.
  const r = 30
  const count = new Map<string, number>()
  const key = (x: number, y: number) => `${Math.floor(x / r)}:${Math.floor(y / r)}`
  for (const e of ends) { const k = key(e.x, e.y); count.set(k, (count.get(k) ?? 0) + 1) }
  for (let i = 0; i < ends.length && ds.length < 4000; i += Math.max(1, Math.floor(ends.length / 4000))) {
    const e = ends[i]
    if ((count.get(key(e.x, e.y)) ?? 0) > 200) continue
    hits.length = 0
    idx.query({ x0: e.x - r, y0: e.y - r, x1: e.x + r, y1: e.y + r }, hits, seen)
    let best = Infinity
    for (const j of hits) {
      if (ends[j].line === e.line) continue
      const d = Math.hypot(ends[j].x - e.x, ends[j].y - e.y)
      if (d > 0.05 && d < best) best = d
    }
    if (Number.isFinite(best)) ds.push(best)
  }
  if (ds.length < 8) return 0
  ds.sort((a, b) => a - b)
  return ds[ds.length >> 1]
}

// ── 3–5. Read ──────────────────────────────────────────────────────────────

const NICE = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20]
const nice = (v: number) => NICE.find(n => Math.abs(n - v) < 1e-6 * Math.max(1, v)) ?? null

export function readPlan(inp: ReadInput, opt: ReadOptions): PlanRead {
  const P = prepare(inp)
  const warnings: string[] = []
  const ptPerFt = inp.ptPerFt && Number.isFinite(inp.ptPerFt) && inp.ptPerFt > 0 ? inp.ptPerFt : 1

  // ── Chains per pen ──
  const contours: PlanContour[] = []
  const penLines = new Map<number, number[][]>()
  for (const l of P.lines) {
    const role = opt.roles[l.pen]
    if (role !== 'eg' && role !== 'fg') continue
    const arr = penLines.get(l.pen) ?? []
    arr.push(l.pts)
    penLines.set(l.pen, arr)
  }
  for (const [pen, ls] of Array.from(penLines.entries())) {
    const role = opt.roles[pen] as 'eg' | 'fg'
    // Exploded dashes: many short pieces with small gaps between them.
    const first = chainLines(ls, joinGap(ls))
    // A contour broken in two by the drafter (a masked crossing, two polylines): pieces of one pen
    // facing each other across a few feet are one line.
    const open = first.filter(c => !c.closed).map(c => c.pts)
    const joined = [...first.filter(c => c.closed), ...chainLines(open, Math.max(joinGap(ls), Math.min(12, 4 * ptPerFt)))]
    for (const c of joined) {
      const L = lenOf(c.pts)
      if (L < 6) continue // a stray dash, a tick
      contours.push({ id: contours.length, role, pen, pts: c.pts, closed: c.closed, z: null, how: null, flags: [] })
    }
  }
  // Lines the estimator set aside go before anything reads them: they take no label, set aside no
  // neighbour, feed no ladder, datum or tie-in. Matched by vertex — the set-aside contour was built
  // from these very pieces (a label gap may have stitched two of them into one).
  const aside: PlanContour[] = []
  if (opt.exclude?.length) {
    const vk = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`
    const out = new Set<string>()
    for (const pl of opt.exclude) for (let i = 0; i + 1 < pl.length; i += 2) out.add(vk(pl[i], pl[i + 1]))
    const keep: PlanContour[] = []
    for (const c of contours) {
      let all = true
      for (let i = 0; i < c.pts.length && all; i += 2) all = out.has(vk(c.pts[i], c.pts[i + 1]))
      ;(all ? aside : keep).push(c)
    }
    contours.length = 0
    keep.forEach((c, i) => { c.id = i; contours.push(c) })
    aside.forEach((c, i) => { c.id = -1 - i })
  }

  // ── Spots first: they say what elevations this plan is about ──
  let spots = readSpots(P, inp.pens)
  const sz = spots.map(s => s.z).sort((a, b) => a - b)
  let zLo = -Infinity, zHi = Infinity
  if (sz.length >= 8) {
    const p5 = sz[Math.floor(sz.length * 0.05)], p95 = sz[Math.floor(sz.length * 0.95)]
    const m = Math.max(25, 0.5 * (p95 - p5))
    zLo = p5 - m; zHi = p95 + m
  }
  let offRange = 0

  // ── Labels ──
  const cIdx = indexContours(contours)
  const labelZ = new Map<number, number[]>()
  const stitch: [number, number, number][] = [] // contour a, contour b, z — pieces either side of a label gap
  const segHits: number[] = [], seen = new Set<number>()
  for (const t of P.texts) {
    const z = labelValue(t.str)
    if (z === null || P.notLabel.has(t)) continue
    if (z < zLo || z > zHi) { offRange++; continue }
    // Labels sit in the middle of their gap — usually: allow one off to a side.
    const reach = labelReach(t)
    segHits.length = 0
    if (!cIdx.idx) break
    cIdx.idx.query({ x0: t.x - reach, y0: t.y - reach, x1: t.x + reach, y1: t.y + reach }, segHits, seen)
    // Nearest distance per contour, and its direction there.
    const best = new Map<number, { d: number; dx: number; dy: number }>()
    for (const sid of segHits) {
      const o = sid * 5
      const ax = cIdx.segs[o], ay = cIdx.segs[o + 1], bx = cIdx.segs[o + 2], by = cIdx.segs[o + 3], ci = cIdx.segs[o + 4]
      const d = distToSeg(t.x, t.y, ax, ay, bx, by)
      const cur = best.get(ci)
      if (!cur || d < cur.d) best.set(ci, { d, dx: bx - ax, dy: by - ay })
    }
    // Gap: two contour ends either side of the label, facing it.
    const ends: { ci: number; x: number; y: number; ox: number; oy: number }[] = []
    for (const ci of Array.from(best.keys())) {
      const c = contours[ci]
      if (c.closed) continue
      for (const e of endsOf(c.pts, ci)) {
        const d = Math.hypot(e.x - t.x, e.y - t.y)
        if (d <= reach && ((t.x - e.x) * e.ox + (t.y - e.y) * e.oy) > 0) ends.push({ ci, x: e.x, y: e.y, ox: e.ox, oy: e.oy })
      }
    }
    let gapPair: [number, number] | null = null, gapCost = Infinity
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const a = ends[i], b = ends[j]
        if (contours[a.ci].role !== contours[b.ci].role) continue
        // Opposite sides of the label, facing each other, the words on the line between.
        if ((a.x - t.x) * (b.x - t.x) + (a.y - t.y) * (b.y - t.y) >= 0) continue
        if (a.ox * b.ox + a.oy * b.oy > -0.5) continue
        if (Math.hypot(b.x - a.x, b.y - a.y) > t.len + t.size * 4) continue
        if (distToSeg(t.x, t.y, a.x, a.y, b.x, b.y) > Math.max(t.size * 0.6, 1)) continue
        const cost = Math.hypot(a.x - t.x, a.y - t.y) + Math.hypot(b.x - t.x, b.y - t.y)
        if (cost < gapCost) { gapCost = cost; gapPair = [i, j] }
      }
    }
    if (gapPair) {
      const a = ends[gapPair[0]], b = ends[gapPair[1]]
      push(labelZ, a.ci, z); push(labelZ, b.ci, z)
      if (a.ci !== b.ci) stitch.push([a.ci, b.ci, z])
      continue
    }
    // Half a gap: an end faces the words but its partner is missing — clipped by the read area, cut
    // at the sheet's edge or a match line, masked, set aside, on a pen not picked. The words name
    // THAT line; a neighbour passing by must not take them. Leave it to the ladders.
    if (ends.length || facesAnyEnd(P, t, reach)) continue
    // At the read area's edge the other half of a gap may lie outside it: only well inside may the
    // words name the line they sit on.
    if (inp.box && (t.x - reach < inp.box.x0 || t.x + reach > inp.box.x1 || t.y - reach < inp.box.y0 || t.y + reach > inp.box.y1)) continue
    // On the line: the nearest contour, parallel to the words when they have a direction.
    let pick = -1, pickD = onLine(t)
    for (const [ci, v] of Array.from(best.entries())) {
      if (v.d > pickD) continue
      if (t.src === 'text') {
        const l = Math.hypot(v.dx, v.dy) || 1
        const par = Math.abs((v.dx / l) * Math.cos(t.angle) + (v.dy / l) * Math.sin(t.angle))
        if (par < 0.82) continue // > ~35° off the words' direction
      }
      pick = ci; pickD = v.d
    }
    if (pick >= 0) push(labelZ, pick, z)
  }
  for (const [ci, zs] of Array.from(labelZ.entries())) {
    const counts = new Map<number, number>()
    for (const z of zs) counts.set(z, (counts.get(z) ?? 0) + 1)
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      contours[ci].flags.push(`labels disagree (${sorted.map(s => s[0]).join(' / ')})`)
      continue
    }
    contours[ci].z = sorted[0][0]
    contours[ci].how = 'label'
    if (sorted.length > 1) contours[ci].flags.push(`one label says ${sorted[1][0]}`)
  }
  // Stitch label gaps: the two pieces are one contour.
  mergeStitched(contours, stitch)

  // Plausible elevations only: a stray "100" from a scale bar is not a contour.
  if (offRange) warnings.push(`${offRange} number${offRange === 1 ? '' : 's'} on lines ignored — nowhere near the plan's spot elevations.`)
  dropOutlierLabels(contours, warnings, spots.map(s => s.z))
  // A decimal number far from every elevation on the plan is a dimension or a station, not a spot grade.
  spots = dropOutlierSpots(spots, contours, warnings)

  // Contours of one kind never cross: a line that does is something else (a wall, hatching, a grid).
  const dropped = dropCrossers(contours)
  if (dropped) warnings.push(`${dropped} line${dropped === 1 ? '' : 's'} set aside — they cross labelled contours of the same kind.`)

  // ── Pads (before the ladders: a building is a hole in the contours, not a step of two) ──
  const rs = rings(P, inp.pens)
  const pads = readPads(P, inp.pens, spots, ptPerFt, rs)
  const bldgPens = new Set(inp.pens.filter(q => BLDG.test(layerBase(q.layer))).map(q => q.id))
  const barriers = [
    ...pads.filter(q => q.outline).map(q => q.ring),
    ...rs.filter(r => r.pen && bldgPens.has(r.pen.id) && r.area >= (10 * ptPerFt) ** 2).map(r => r.ring),
  ]

  // ── Ladders ──
  const ladders = buildLadders(contours, ptPerFt, inp.box ?? null, barriers)
  const interval = {
    eg: opt.interval?.eg ?? measureInterval(contours, ladders, 'eg'),
    fg: opt.interval?.fg ?? measureInterval(contours, ladders, 'fg'),
  }
  // ── Elevations: ladders, lidar, trend — and the checks between them ──
  const lidar = opt.existingFt ? { at: opt.existingFt, spots: spots.filter(s => s.role === 'eg') } : undefined
  if (lidar && interval.eg === null) interval.eg = lidarInterval(contours, ladders, lidar.at)
  const box = inp.box ?? null
  const { datumFt } = resolveElevations(contours, ladders, interval, { lidar, ptPerFt, box })

  // ── Crossings: two contours of one kind never cross — a misread pen or label shows up here. ──
  flagCrossings(contours)

  // ── Limits ──
  const limits = readLimits(P, inp.pens, ptPerFt, rs)

  const missing = contours.filter(c => c.z === null).length
  if (contours.length && missing) warnings.push(`${missing} of ${contours.length} contours need an elevation — tap one to type it, or draw a line across them.`)
  return { contours, ladders, interval, datumFt, spots, pads, limits, warnings, aside, box }
}

function push(m: Map<number, number[]>, k: number, v: number) {
  const a = m.get(k)
  if (a) a.push(v); else m.set(k, [v])
}

function indexContours(cs: PlanContour[]): { idx: BinIndex | null; segs: number[]; box: Box | null } {
  const segs: number[] = []
  let all: Box | null = null
  for (const c of cs) {
    const b = boxOfPts(c.pts)
    all = all ? { x0: Math.min(all.x0, b.x0), y0: Math.min(all.y0, b.y0), x1: Math.max(all.x1, b.x1), y1: Math.max(all.y1, b.y1) } : b
  }
  if (!all) return { idx: null, segs, box: null }
  const span = Math.max(all.x1 - all.x0, all.y1 - all.y0, 1)
  const idx = new BinIndex(all, Math.max(span / 200, 2))
  cs.forEach((c, ci) => {
    for (let i = 2; i < c.pts.length; i += 2) {
      const id = segs.length / 5
      segs.push(c.pts[i - 2], c.pts[i - 1], c.pts[i], c.pts[i + 1], ci)
      idx.insert(id, { x0: Math.min(c.pts[i - 2], c.pts[i]), y0: Math.min(c.pts[i - 1], c.pts[i + 1]), x1: Math.max(c.pts[i - 2], c.pts[i]), y1: Math.max(c.pts[i - 1], c.pts[i + 1]) })
    }
  })
  return { idx, segs, box: all }
}

/** Join the two pieces either side of a label gap into one contour (the later one empties). */
function mergeStitched(cs: PlanContour[], stitch: [number, number, number][]) {
  const alias = new Map<number, number>()
  const root = (i: number): number => { while (alias.has(i)) i = alias.get(i)!; return i }
  for (const [a0, b0] of stitch) {
    const a = root(a0), b = root(b0)
    if (a === b) continue
    const A = cs[a], B = cs[b]
    if (A.closed || B.closed || A.role !== B.role) continue
    if (A.z !== null && B.z !== null && A.z !== B.z) continue
    // Closest ends.
    const ae = [[A.pts[0], A.pts[1]], [A.pts[A.pts.length - 2], A.pts[A.pts.length - 1]]]
    const be = [[B.pts[0], B.pts[1]], [B.pts[B.pts.length - 2], B.pts[B.pts.length - 1]]]
    let bi = 0, bj = 0, bd = Infinity
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const d = Math.hypot(ae[i][0] - be[j][0], ae[i][1] - be[j][1])
      if (d < bd) { bd = d; bi = i; bj = j }
    }
    const rev = (p: number[]) => { const o: number[] = []; for (let k = p.length - 2; k >= 0; k -= 2) o.push(p[k], p[k + 1]); return o }
    const a1 = bi === 1 ? A.pts : rev(A.pts) // A ending at the gap
    const b1 = bj === 0 ? B.pts : rev(B.pts) // B starting at the gap
    A.pts = [...a1, ...b1]
    if (A.z === null && B.z !== null) { A.z = B.z; A.how = B.how }
    A.flags.push(...B.flags)
    B.pts = []
    alias.set(b, a)
  }
  // Drop the emptied ones and renumber.
  const keep = cs.filter(c => c.pts.length >= 4)
  cs.length = 0
  keep.forEach((c, i) => { c.id = i; cs.push(c) })
}

function dropOutlierLabels(cs: PlanContour[], warnings: string[], spotZ: number[]) {
  // Every elevation the plan states — for a kind with too few labels of its own to judge by.
  const pool = [...cs.filter(c => c.z !== null).map(c => c.z as number), ...spotZ]
  for (const role of ['eg', 'fg'] as const) {
    let zs = cs.filter(c => c.role === role && c.z !== null).map(c => c.z as number)
    if (zs.length < 3) zs = pool
    zs = [...zs].sort((a, b) => a - b)
    if (zs.length < 3) continue
    const med = zs[zs.length >> 1]
    // Robust spread: a keynote "10" on a 250 ft site is out, a 200 ft hillside is in.
    const dev = zs.map(z => Math.abs(z - med)).sort((a, b) => a - b)
    const lim = Math.max(40, 6 * dev[dev.length >> 1])
    let dropped = 0
    for (const c of cs) {
      if (c.role !== role || c.z === null) continue
      if (Math.abs(c.z - med) > lim) { c.flags.push(`label ${c.z} is far from the rest`); c.z = null; c.how = null; dropped++ }
    }
    if (dropped) warnings.push(`${dropped} ${role === 'eg' ? 'existing' : 'proposed'} label${dropped === 1 ? '' : 's'} ignored — far from the plan's other elevations.`)
  }
}

/** Spot grades far from every other elevation on the plan (the labels, else the spots): "24.00" is a drive width. */
function dropOutlierSpots(spots: PlanSpot[], cs: PlanContour[], warnings: string[]): PlanSpot[] {
  const labels = cs.filter(c => c.z !== null).map(c => c.z as number)
  const ref = (labels.length >= 3 ? labels : [...labels, ...spots.map(s => s.z)]).sort((a, b) => a - b)
  if (ref.length < 3) return spots
  const med = ref[ref.length >> 1]
  const dev = ref.map(z => Math.abs(z - med)).sort((a, b) => a - b)
  const lim = Math.max(40, 6 * dev[dev.length >> 1])
  const keep = spots.filter(s => Math.abs(s.z - med) <= lim)
  const n = spots.length - keep.length
  if (n) warnings.push(`${n} decimal number${n === 1 ? '' : 's'} not read as spot grade${n === 1 ? '' : 's'} — far from the plan's elevations (a dimension or a station?).`)
  return keep
}

/**
 * Rays across every contour → the contours they cross, in order. Every
 * crossing counts, so a ray over a hilltop reads 809 · 810 · 809 (the loop
 * crossed going up and again coming down) instead of skipping the way down.
 *
 * A ray that slips through a hole in the linework — a label gap, a contour
 * that stops at a wall or a building — would see 809 · 811 and count wrong,
 * so the ladder BREAKS there: where two contour ends face each other across
 * a gap, and wherever a contour ends right beside the ray.
 */
function buildLadders(cs: PlanContour[], ptPerFt: number, box: Box | null, barriers: number[][] = []): number[][] {
  const ladders: number[][] = []
  const maxLen = Math.max(200, 300 * ptPerFt) // up to ~300 ft of ground per ray
  const NEAR_END = 8 // pt
  const GAP = 30 // pt — a label gap, a wall's thickness
  for (const role of ['eg', 'fg'] as const) {
    const sub = cs.filter(c => c.role === role)
    if (sub.length < 2) continue
    const { idx, segs, box: cb } = indexContours(sub)
    if (!idx || !cb) continue
    // Breaks: contour ends inside the read area (not where the area clips them), and the gaps between facing ones.
    const all = box ?? cb
    const ends: End[] = []
    sub.forEach((c, si) => {
      if (c.closed || c.pts.length < 4) return
      for (const e of endsOf(c.pts, si)) if (e.x - all.x0 > 1 && all.x1 - e.x > 1 && e.y - all.y0 > 1 && all.y1 - e.y > 1) ends.push(e)
    })
    const brk: number[] = [] // x0,y0,x1,y1,owner (owner −1 = a gap segment or a wall)
    const brkIdx = new BinIndex(cb, idx.size)
    // Building walls: contours stop there, and the far side is no step of the near one.
    for (const r of barriers) {
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length
        brkIdx.insert(brk.length / 5, { x0: Math.min(r[i], r[j]), y0: Math.min(r[i + 1], r[j + 1]), x1: Math.max(r[i], r[j]), y1: Math.max(r[i + 1], r[j + 1]) })
        brk.push(r[i], r[i + 1], r[j], r[j + 1], -1)
      }
    }
    const cosTol = Math.cos((35 * Math.PI) / 180)
    ends.forEach((e, i) => {
      brkIdx.insert(brk.length / 5, { x0: e.x, y0: e.y, x1: e.x, y1: e.y })
      brk.push(e.x, e.y, e.x, e.y, e.line)
      for (let j = i + 1; j < ends.length; j++) {
        const f = ends[j]
        if (f.line === e.line) continue
        const dx = f.x - e.x, dy = f.y - e.y, d = Math.hypot(dx, dy)
        if (d > GAP || d < 1e-9) continue
        if ((e.ox * dx + e.oy * dy) / d < cosTol || -(f.ox * dx + f.oy * dy) / d < cosTol) continue
        brkIdx.insert(brk.length / 5, { x0: Math.min(e.x, f.x), y0: Math.min(e.y, f.y), x1: Math.max(e.x, f.x), y1: Math.max(e.y, f.y) })
        brk.push(e.x, e.y, f.x, f.y, -1)
      }
    })
    const step = Math.max(idx.size, 4)
    const hits: number[] = [], seen = new Set<number>()
    const cast = (px: number, py: number, dx: number, dy: number, self: number): number[] => {
      const found: { t: number; ci: number }[] = []
      const tested = new Set<number>(), testedB = new Set<number>()
      let end = maxLen
      for (let s = 0; s < end; s += step) {
        const qx = px + dx * (s + step / 2), qy = py + dy * (s + step / 2)
        const q = { x0: qx - step / 2 - NEAR_END, y0: qy - step / 2 - NEAR_END, x1: qx + step / 2 + NEAR_END, y1: qy + step / 2 + NEAR_END }
        hits.length = 0
        idx.query(q, hits, seen)
        for (const sid of hits) {
          if (tested.has(sid)) continue
          tested.add(sid)
          const o = sid * 5
          const t = rayHit(px, py, dx, dy, segs[o], segs[o + 1], segs[o + 2], segs[o + 3])
          if (!(t > 1e-6) || t > maxLen) continue
          if (segs[o + 4] === self && t < 0.5) continue
          found.push({ t, ci: segs[o + 4] })
        }
        hits.length = 0
        brkIdx.query(q, hits, seen)
        for (const bid of hits) {
          if (testedB.has(bid)) continue
          testedB.add(bid)
          const o = bid * 5
          if (brk[o + 4] === -1) {
            const t = rayHit(px, py, dx, dy, brk[o], brk[o + 1], brk[o + 2], brk[o + 3])
            if (t > 1e-6 && t <= maxLen) found.push({ t, ci: -1 })
          } else if (brk[o + 4] !== self) {
            const ex = brk[o] - px, ey = brk[o + 1] - py
            const t = ex * dx + ey * dy
            if (t > 1e-6 && t <= maxLen && Math.abs(ex * dy - ey * dx) <= NEAR_END) found.push({ t, ci: -1 })
          }
        }
        // Every crossing short of s + step is in hand by now: 16 make a ladder.
        let sure = 0
        for (const f of found) if (f.t <= s + step && f.ci >= 0) sure++
        if (sure >= 16) end = s + step
      }
      found.sort((a, b) => a.t - b.t)
      const out: number[] = []
      let lastT = -Infinity, lastCi = -2
      for (const f of found) {
        if (f.t > end) break
        if (f.ci === lastCi && f.t - lastT < 1e-6) continue // one vertex, two segments
        out.push(f.ci < 0 ? -1 : sub[f.ci].id)
        lastT = f.t; lastCi = f.ci
      }
      return out
    }
    sub.forEach((c, si) => {
      const L = lenOf(c.pts)
      const n = Math.max(1, Math.min(6, Math.round(L / 120)))
      for (let k = 0; k < n; k++) {
        const target = ((k + 0.5) / n) * L
        let acc = 0
        for (let i = 2; i < c.pts.length; i += 2) {
          const ax = c.pts[i - 2], ay = c.pts[i - 1], bx = c.pts[i], by = c.pts[i + 1]
          const sl = Math.hypot(bx - ax, by - ay)
          if (acc + sl >= target && sl > 1e-9) {
            const u = (target - acc) / sl
            const px = ax + (bx - ax) * u, py = ay + (by - ay) * u
            const nx = -(by - ay) / sl, ny = (bx - ax) / sl
            const seq = [...cast(px, py, -nx, -ny, si).reverse(), c.id, ...cast(px, py, nx, ny, si)]
            // Split at the breaks; drop a contour crossed twice in a row (the same band).
            let cur: number[] = []
            const flush = () => { if (cur.length >= 2) ladders.push(cur); cur = [] }
            for (const v of seq) {
              if (v < 0) { flush(); continue }
              if (cur.length && cur[cur.length - 1] === v) continue
              cur.push(v)
            }
            flush()
            break
          }
          acc += sl
        }
      }
    })
  }
  return ladders
}

/** The contour interval a role's ladders show: the even step between labelled contours. */
function measureInterval(cs: PlanContour[], ladders: number[][], role: 'eg' | 'fg'): number | null {
  const votes = new Map<number, number>()
  for (const lad of ladders) {
    if (cs[lad[0]]?.role !== role) continue
    let last = -1
    for (let i = 0; i < lad.length; i++) {
      const z = cs[lad[i]].z
      if (z === null) continue
      if (last >= 0) {
        const z0 = cs[lad[last]].z as number
        const k = i - last
        const st = nice(Math.abs(z - z0) / k)
        if (st && z !== z0) votes.set(st, (votes.get(st) ?? 0) + (k > 1 ? 2 : 1))
      }
      last = i
    }
  }
  const best = Array.from(votes.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  return best ? best[0] : null
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Where an elevation came from, strongest first. A trend guess never outranks anything. */
const RANK: Record<string, number> = { user: 4, label: 3, ladder: 2, 'tie-in': 1, lidar: 1, extrapolated: 0 }
const anchor = (c: PlanContour) => c.z !== null && c.how !== 'extrapolated'
/** Flags the elevation pass writes (and clears before it runs again). */
const AUTO_FLAG = /ft off the lidar$|ft off the lidar datum$|^labels disagree with the lidar|^jumps |^guessed from the trend|^the trend and the lidar|^ties into /

/** Even runs between anchors: 812 · · · · 817 steps 813…816. Repeats until nothing changes. */
function interpolate(cs: PlanContour[], ladders: number[][], interval: { eg: number | null; fg: number | null }): void {
  for (let round = 0; round < 12; round++) {
    const votes = new Map<number, Map<number, number>>()
    for (const lad of ladders) {
      const role = cs[lad[0]]?.role
      const dz = role ? interval[role] : null
      if (!dz) continue
      let last = -1
      for (let j = 0; j < lad.length; j++) {
        if (!anchor(cs[lad[j]])) continue
        const i = last
        last = j
        if (i < 0 || j - i < 2) continue
        const z0 = cs[lad[i]].z as number, z1 = cs[lad[j]].z as number
        // Not an even run (a ridge, a valley, a missing line): say nothing.
        if (Math.abs(Math.abs(z1 - z0) / dz - (j - i)) > 1e-6) continue
        const s = Math.sign(z1 - z0) * dz
        for (let k = i + 1; k < j; k++) {
          const m = votes.get(lad[k]) ?? new Map<number, number>()
          const z = round2(z0 + (k - i) * s)
          m.set(z, (m.get(z) ?? 0) + 1)
          votes.set(lad[k], m)
        }
      }
    }
    let changed = 0
    for (const [ci, m] of Array.from(votes.entries())) {
      const c = cs[ci]
      if (c.z !== null) continue
      const opts = Array.from(m.entries()).sort((a, b) => b[1] - a[1])
      const total = opts.reduce((s, o) => s + o[1], 0)
      if (opts[0][1] / total < 0.75) continue
      c.z = opts[0][0]
      c.how = 'ladder'
      changed++
    }
    if (!changed) break
  }
}

/**
 * Past the last anchor on a ladder the trend carries on — two contours at
 * most, never past a contour the ray already crossed (a hilltop), never over
 * one already named, and only when two ladders agree. A trend guess is never
 * a base for another guess.
 */
function extrapolate(cs: PlanContour[], ladders: number[][], interval: { eg: number | null; fg: number | null }, lidarSays: (c: PlanContour) => number | null): void {
  const votes = new Map<number, Map<number, number>>()
  const vote = (ci: number, z: number) => {
    const m = votes.get(ci) ?? new Map<number, number>()
    m.set(z, (m.get(z) ?? 0) + 1)
    votes.set(ci, m)
  }
  for (const lad of ladders) {
    const role = cs[lad[0]]?.role
    const dz = role ? interval[role] : null
    if (!dz) continue
    const known: number[] = []
    for (let i = 0; i < lad.length; i++) if (anchor(cs[lad[i]])) known.push(i)
    if (known.length < 2) continue
    for (const [outer, inner, dir] of [[known[0], known[1], -1], [known[known.length - 1], known[known.length - 2], 1]] as const) {
      const zo = cs[lad[outer]].z as number, zi = cs[lad[inner]].z as number
      const tr = (zo - zi) / Math.abs(outer - inner) // per contour, outward
      if (Math.abs(Math.abs(tr) - dz) > 1e-6) continue
      const passed = new Set<number>()
      for (let k = Math.min(outer, inner); k <= Math.max(outer, inner); k++) passed.add(lad[k])
      for (let step = 1; step <= 2; step++) {
        const k = outer + dir * step
        if (k < 0 || k >= lad.length) break
        const c = cs[lad[k]]
        if (c.z !== null || passed.has(c.id)) break
        passed.add(c.id)
        vote(c.id, round2(zo + step * tr))
      }
    }
  }
  for (const [ci, m] of Array.from(votes.entries())) {
    const c = cs[ci]
    if (c.z !== null) continue
    const opts = Array.from(m.entries()).sort((a, b) => b[1] - a[1])
    const total = opts.reduce((s, o) => s + o[1], 0)
    const [z, n] = opts[0]
    if (n < 2 || n / total < 0.75) continue
    const dz = interval[c.role] ?? 1
    const ld = lidarSays(c)
    if (ld !== null && Math.abs(ld - z) > 0.5 * dz) { c.flags.push(`the trend and the lidar disagree (${z} vs ${round2(ld)})`); continue }
    c.z = z
    c.how = 'extrapolated'
    c.flags.push('guessed from the trend — check')
  }
}

/**
 * Neighbours on a ladder are one interval apart or the same level. A bigger
 * jump means something is misread: the weaker of the two (a lidar snap or a
 * trend guess) gives way; two strong ones are both flagged for a look.
 * Returns how many elevations it took back.
 */
function checkLadders(cs: PlanContour[], ladders: number[][], interval: { eg: number | null; fg: number | null }): number {
  const blame = new Map<number, number>()
  const jump = new Set<number>()
  for (const lad of ladders) {
    const role = cs[lad[0]]?.role
    const dz = role ? interval[role] : null
    if (!dz) continue
    for (let i = 1; i < lad.length; i++) {
      const a = cs[lad[i - 1]], b = cs[lad[i]]
      if (a.z === null || b.z === null || Math.abs(a.z - b.z) <= dz + 1e-6) continue
      const ra = RANK[a.how ?? ''] ?? 0, rb = RANK[b.how ?? ''] ?? 0
      if (Math.max(ra, rb) <= 1) { blame.set(a.id, 1); blame.set(b.id, 1) } // two guesses: both go
      else if (Math.min(ra, rb) <= 1) blame.set((ra < rb ? a : b).id, 1)
      else { jump.add(a.id); jump.add(b.id) }
    }
  }
  let taken = 0
  for (const ci of Array.from(blame.keys())) {
    const c = cs[ci]
    c.z = null
    c.how = null
    c.flags = c.flags.filter(f => !/^guessed from the trend/.test(f))
    taken++
  }
  for (const ci of Array.from(jump)) {
    const c = cs[ci]
    if (c.z !== null && !c.flags.some(f => /^jumps /.test(f))) c.flags.push('jumps more than one interval from the contour beside it')
  }
  return taken
}

export interface LidarInput {
  /** Existing ground (ft, the lidar's datum) at a page point, NaN where unknown. */
  at: (x: number, y: number) => number
  /** Existing spot shots on the plan (GS 247.82…): a datum even when no contour is labelled. */
  spots?: { x: number; y: number; z: number }[]
}

function median(a: number[]): number { const s = [...a].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN }

/**
 * What most of `vals` agree on within `tol`: the median of the biggest
 * cluster, when it holds at least `min` values and more than half of them.
 * Two labels a contour apart agree on nothing — neither is trusted.
 */
function consensus(vals: number[], tol: number, min: number): number | null {
  const s = [...vals].sort((a, b) => a - b)
  let bi = 0, bn = 0
  for (let i = 0, j = 0; i < s.length; i++) {
    while (s[i] - s[j] > tol) j++
    if (i - j + 1 > bn) { bn = i - j + 1; bi = j }
  }
  if (bn < min || bn * 2 <= s.length) return null
  return median(s.slice(bi, bi + bn))
}

/** The lidar's median under each existing contour. */
function lidarAlong(cs: PlanContour[], at: (x: number, y: number) => number): Map<number, number> {
  const along = new Map<number, number>()
  for (const c of cs) {
    if (c.role !== 'eg') continue
    const n = c.pts.length / 2
    const vals: number[] = []
    const stride = Math.max(1, Math.floor(n / 24))
    for (let k = 0; k < n; k += stride) {
      const v = at(c.pts[2 * k], c.pts[2 * k + 1])
      if (Number.isFinite(v)) vals.push(v)
    }
    if (vals.length >= 3) along.set(c.id, median(vals))
  }
  return along
}

/** Existing contours with no labels at all: the interval the lidar shows between neighbours. */
function lidarInterval(cs: PlanContour[], ladders: number[][], at: (x: number, y: number) => number): number | null {
  const along = lidarAlong(cs, at)
  const steps: number[] = []
  for (const lad of ladders) {
    if (cs[lad[0]]?.role !== 'eg') continue
    for (let i = 1; i < lad.length; i++) {
      const a = along.get(lad[i - 1]), b = along.get(lad[i])
      if (a !== undefined && b !== undefined && Math.abs(a - b) > 1e-3) steps.push(Math.abs(a - b))
    }
  }
  if (steps.length < 10) return null
  const m = median(steps)
  const best = NICE.map(v => [v, Math.abs(Math.log(v / m))] as const).sort((p, q) => p[1] - q[1])[0]
  return best && best[1] < Math.log(1.3) ? best[0] : null
}

/**
 * A proposed contour that ENDS on an existing contour ties into the ground
 * there: same elevation (the grading stops where it meets existing). Both
 * ends must agree when both touch; an end touching two levels says nothing.
 */
function tieIns(cs: PlanContour[], tol: number, box: Box | null): number {
  const eg = cs.filter(c => c.role === 'eg' && c.z !== null)
  const { idx, segs } = indexContours(eg)
  if (!idx) return 0
  // Where an existing contour stops too, both stop at a line drawn across the plan — a match line,
  // the sheet's edge, the read area — not where the grading meets the ground.
  const egEnds: number[] = []
  for (const c of eg) if (!c.closed) egEnds.push(c.pts[0], c.pts[1], c.pts[c.pts.length - 2], c.pts[c.pts.length - 1])
  const cut = (x: number, y: number) => {
    if (box && (Math.abs(x - box.x0) < 0.5 || Math.abs(x - box.x1) < 0.5 || Math.abs(y - box.y0) < 0.5 || Math.abs(y - box.y1) < 0.5)) return true
    for (let i = 0; i < egEnds.length; i += 2) if (Math.hypot(egEnds[i] - x, egEnds[i + 1] - y) <= 2 * tol) return true
    return false
  }
  const hits: number[] = [], seen = new Set<number>()
  let n = 0
  for (const c of cs) {
    if (c.role !== 'fg' || c.z !== null || c.closed) continue
    const zs: number[] = []
    for (const [x, y] of [[c.pts[0], c.pts[1]], [c.pts[c.pts.length - 2], c.pts[c.pts.length - 1]]]) {
      if (cut(x, y)) continue
      hits.length = 0
      idx.query({ x0: x - tol, y0: y - tol, x1: x + tol, y1: y + tol }, hits, seen)
      const at = new Set<number>()
      for (const sid of hits) {
        const o = sid * 5
        if (distToSeg(x, y, segs[o], segs[o + 1], segs[o + 2], segs[o + 3]) <= tol) at.add(eg[segs[o + 4]].z as number)
      }
      if (at.size) zs.push(at.size === 1 ? Array.from(at)[0] : NaN)
    }
    if (!zs.length || zs.some(z => Number.isNaN(z))) continue
    if (zs.length === 2 && zs[0] !== zs[1]) { c.flags.push(`ties into ${zs[0]} and ${zs[1]}`); continue }
    c.z = zs[0]
    c.how = 'tie-in'
    n++
  }
  return n
}

/**
 * Every derived elevation, from what people wrote (labels, the estimator's
 * own numbers): ladders between them; then the lidar, where it is sure, on
 * the plan's datum (labelled contours, else existing spot shots); the
 * ladders again; the trend last. Each step is checked against the others.
 * Derived numbers are cleared first, so after an edit this simply runs again.
 */
export function resolveElevations(
  cs: PlanContour[],
  ladders: number[][],
  interval: { eg: number | null; fg: number | null },
  opt: { lidar?: LidarInput; ptPerFt?: number; box?: Box | null } = {},
): { datumFt: number | null } {
  const lidar = opt.lidar
  for (const c of cs) {
    c.flags = c.flags.filter(f => !AUTO_FLAG.test(f))
    if (c.how !== null && c.how !== 'label' && c.how !== 'user') { c.z = null; c.how = null }
  }
  interpolate(cs, ladders, interval)
  let datum: number | null = null
  let along: Map<number, number> | null = null
  const dzEg = interval.eg
  if (lidar && dzEg) {
    const al = lidarAlong(cs, lidar.at)
    along = al
    // The plan's datum: what the written existing numbers agree on (two labels a contour apart agree
    // on nothing), else what the existing spot shots agree on, else none.
    const tolD = Math.max(0.35 * dzEg, 0.3)
    const written = cs.filter(c => c.role === 'eg' && (c.how === 'label' || c.how === 'user') && al.has(c.id))
    const resid = written.map(c => (c.z as number) - (al.get(c.id) as number))
    datum = consensus(resid, tolD, 2)
    if (datum === null) {
      const sp: number[] = []
      for (const s of lidar.spots ?? []) { const v = lidar.at(s.x, s.y); if (Number.isFinite(v)) sp.push(s.z - v) }
      datum = consensus(sp, Math.max(tolD, 0.5), 3)
    }
    const d0 = datum
    if (d0 !== null) written.forEach((c, i) => { if (Math.abs(resid[i] - d0) > tolD) c.flags.push(`${(resid[i] - d0).toFixed(1)} ft off the lidar datum`) })
    else if (resid.length >= 2) written.forEach(c => c.flags.push('labels disagree with the lidar — check this one'))
    if (datum !== null) {
      for (const c of cs) {
        if (c.role !== 'eg' || c.z !== null || !along.has(c.id)) continue
        const expect = (along.get(c.id) as number) + datum
        const snap = Math.round(expect / dzEg) * dzEg
        if (Math.abs(expect - snap) <= 0.35 * dzEg) { c.z = round2(snap); c.how = 'lidar' }
      }
      interpolate(cs, ladders, interval)
    }
  }
  // Proposed contours tie into the existing ground where the grading ends.
  if (tieIns(cs, Math.max(0.5, 0.4 * (opt.ptPerFt ?? 1)), opt.box ?? null)) interpolate(cs, ladders, interval)
  const lidarSays = (c: PlanContour): number | null => (c.role === 'eg' && datum !== null && along?.has(c.id) ? (along.get(c.id) as number) + datum : null)
  // A lidar snap that does not fit a labelled neighbour gives way before anything builds on it.
  for (let round = 0; round < 3 && checkLadders(cs, ladders, interval) > 0; round++) interpolate(cs, ladders, interval)
  extrapolate(cs, ladders, interval, lidarSays)
  checkLadders(cs, ladders, interval)
  if (datum !== null && dzEg) {
    const tol = Math.max(1.5 * dzEg, 2)
    for (const c of cs) {
      const ld = lidarSays(c)
      if (ld === null || c.z === null) continue
      if (Math.abs(c.z - ld) > tol) c.flags.push(`${Math.abs(c.z - ld).toFixed(1)} ft off the lidar`)
    }
  }
  return { datumFt: datum === null ? null : round2(datum) }
}

/**
 * Contours of one kind never cross. A line crossing a LABELLED contour of its
 * own kind is not a contour (a wall drawn on the topo layer, a grid, hatching);
 * among unlabelled lines that cross each other, the one crossing most goes
 * first. Two labelled contours that cross are both kept — and flagged later.
 * Returns how many were set aside.
 */
function dropCrossers(cs: PlanContour[]): number {
  const gone = new Set<number>()
  for (const role of ['eg', 'fg'] as const) {
    const sub = cs.filter(c => c.role === role)
    if (sub.length < 2) continue
    const { idx, segs } = indexContours(sub)
    if (!idx) continue
    const pairs = new Map<string, [number, number]>()
    const hits: number[] = [], seen = new Set<number>()
    let work = 0
    for (let s = 0; s < segs.length / 5 && work < 6_000_000; s++) {
      const o = s * 5
      const ax = segs[o], ay = segs[o + 1], bx = segs[o + 2], by = segs[o + 3], ci = segs[o + 4]
      hits.length = 0
      idx.query({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }, hits, seen)
      for (const t of hits) {
        work++
        const p = t * 5
        const cj = segs[p + 4]
        if (cj <= ci) continue
        if (properCross(ax, ay, bx, by, segs[p], segs[p + 1], segs[p + 2], segs[p + 3])) pairs.set(`${ci}:${cj}`, [ci, cj])
      }
    }
    const labelled = (i: number) => sub[i].how === 'label'
    const live = Array.from(pairs.values())
    for (const [a, b] of live) {
      if (labelled(a) && !labelled(b)) gone.add(sub[b].id)
      else if (labelled(b) && !labelled(a)) gone.add(sub[a].id)
    }
    // Unlabelled tangles: drop the worst offender until none cross.
    for (let guard = 0; guard < sub.length; guard++) {
      const count = new Map<number, number>()
      for (const [a, b] of live) {
        if (gone.has(sub[a].id) || gone.has(sub[b].id) || labelled(a) || labelled(b)) continue
        count.set(a, (count.get(a) ?? 0) + 1); count.set(b, (count.get(b) ?? 0) + 1)
      }
      if (!count.size) break
      const [worst] = Array.from(count.entries()).sort((p, q) => q[1] - p[1] || lenOf(sub[p[0]].pts) - lenOf(sub[q[0]].pts))[0]
      gone.add(sub[worst].id)
    }
  }
  if (!gone.size) return 0
  const keep = cs.filter(c => !gone.has(c.id))
  cs.length = 0
  keep.forEach((c, i) => { c.id = i; cs.push(c) })
  return gone.size
}

function flagCrossings(cs: PlanContour[]) {
  for (const role of ['eg', 'fg'] as const) {
    const sub = cs.filter(c => c.role === role)
    if (sub.length < 2) continue
    const { idx, segs } = indexContours(sub)
    if (!idx) continue
    const hit = new Set<number>()
    const hits: number[] = [], seen = new Set<number>()
    let work = 0
    for (let s = 0; s < segs.length / 5 && work < 4_000_000; s++) {
      const o = s * 5
      const ax = segs[o], ay = segs[o + 1], bx = segs[o + 2], by = segs[o + 3], ci = segs[o + 4]
      hits.length = 0
      idx.query({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }, hits, seen)
      for (const t of hits) {
        work++
        const p = t * 5
        const cj = segs[p + 4]
        if (cj <= ci) continue
        if (properCross(ax, ay, bx, by, segs[p], segs[p + 1], segs[p + 2], segs[p + 3])) { hit.add(ci); hit.add(cj) }
      }
    }
    for (const si of Array.from(hit)) {
      const c = sub[si]
      if (!c.flags.includes('crosses another contour')) c.flags.push('crosses another contour')
    }
  }
}

function properCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by)
  const d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy)
  const e = 1e-9
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))
}

/**
 * The estimator's cross line: every contour of `role` the line crosses, in
 * order from its start, gets z0, z0 ± dz, … What people wrote along it (the
 * plan's labels, earlier numbers of the estimator's) is kept and checks the
 * run: if any of it disagrees, NOTHING is written — a typo in the first
 * elevation must not renumber a sheet — and `implied` says what those labels
 * make the first contour, when they agree among themselves. Values counted
 * between labels check it too: when they disagree nothing is written unless
 * `force` (`counted` says how many, `implied` what they make the first one).
 *
 * The first tap may land a hair past the contour it means (under a pixel at
 * street zoom), so the contour within `slop` of the start counts as crossed
 * first.
 */
export function assignAlong(
  cs: PlanContour[], role: 'eg' | 'fg', line: number[], z0: number, dz: number,
  opt: { skip?: (c: PlanContour) => boolean; slop?: number; force?: boolean } = {},
): { set: number; disagree: number; counted: number; implied: number | null } {
  const hits: { t: number; ci: number }[] = []
  const byId = new Map(cs.map(c => [c.id, c]))
  for (const c of cs) {
    if (c.role !== role || opt.skip?.(c)) continue
    let best = Infinity
    for (let i = 2; i < c.pts.length; i += 2) {
      for (let k = 2; k < line.length; k += 2) {
        const t = segT(line[k - 2], line[k - 1], line[k], line[k + 1], c.pts[i - 2], c.pts[i - 1], c.pts[i], c.pts[i + 1])
        if (t >= 0) best = Math.min(best, (k / 2 - 1) + t)
      }
    }
    if (Number.isFinite(best)) hits.push({ t: best, ci: c.id })
  }
  hits.sort((a, b) => a.t - b.t)
  if (opt.slop && opt.slop > 0 && line.length >= 2) {
    let near = -1, nd = opt.slop
    for (const c of cs) {
      if (c.role !== role || opt.skip?.(c)) continue
      for (let i = 2; i < c.pts.length; i += 2) {
        const d = distToSeg(line[0], line[1], c.pts[i - 2], c.pts[i - 1], c.pts[i], c.pts[i + 1])
        if (d < nd) { nd = d; near = c.id }
      }
    }
    if (near >= 0 && !hits.some(h => h.ci === near)) hits.unshift({ t: -1, ci: near })
  }
  const written = (c: PlanContour) => c.z !== null && (c.how === 'label' || c.how === 'user')
  const ladder = (c: PlanContour) => c.z !== null && c.how === 'ladder'
  let disagree = 0, counted = 0
  const implies = new Set<number>(), countedImplies = new Set<number>()
  hits.forEach((h, k) => {
    const c = byId.get(h.ci) as PlanContour
    const off = Math.abs((c.z as number) - round2(z0 + k * dz)) > 1e-6
    if (written(c)) { implies.add(round2((c.z as number) - k * dz)); if (off) disagree++ }
    else if (ladder(c)) { countedImplies.add(round2((c.z as number) - k * dz)); if (off) counted++ }
  })
  const one = (s: Set<number>) => (s.size === 1 ? Array.from(s)[0] : null)
  const implied = implies.size ? one(implies) : one(countedImplies)
  if (disagree) return { set: 0, disagree, counted, implied }
  if (counted && !opt.force) return { set: 0, disagree: 0, counted, implied }
  let set = 0
  hits.forEach((h, k) => {
    const c = byId.get(h.ci) as PlanContour
    if (written(c)) return // what people wrote is never overwritten; anything derived is
    c.z = round2(z0 + k * dz); c.how = 'user'; c.flags = c.flags.filter(f => !/labels disagree/.test(f)); set++
  })
  return { set, disagree: 0, counted, implied }
}

/** Segment AB vs CD: AB's parameter in [0,1] at a proper crossing, or −1. */
function segT(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return -1
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1
}

// ── 6. Spots, pads, limits ─────────────────────────────────────────────────

/** The pen most of a word's own strokes are drawn with (SHX text is strokes). */
function penUnder(P: Prepared, t: PdfText): number {
  if (!P.lineIdx) return -1
  const hits: number[] = []
  const r = Math.max(t.len, t.size) / 2 + 0.5
  P.lineIdx.query({ x0: t.x - r, y0: t.y - r, x1: t.x + r, y1: t.y + r }, hits)
  const count = new Map<number, number>()
  for (const id of hits) {
    const o = id * 5
    const line = P.lines[P.segs[o + 4]]
    if (line.len > t.size * 4) continue
    count.set(P.segPen[id], (count.get(P.segPen[id]) ?? 0) + 1)
  }
  let best = -1, bestN = 2
  for (const [pen, n] of Array.from(count.entries())) if (n > bestN) { best = pen; bestN = n }
  return best
}

function readSpots(P: Prepared, pens: PdfPen[]): PlanSpot[] {
  const out: PlanSpot[] = []
  const tags = P.texts.filter(t => /^[A-Z][A-Z.]{0,5}$/i.test(t.str) && SPOT_TAGS[normTag(t.str)] !== undefined)
  const usedTag = new Set<PdfText>()
  const nums: { t: PdfText; z: number; tag: string | null; paren: boolean }[] = []
  for (const t of P.texts) {
    let m = t.str.match(TAG_FIRST)
    if (m && SPOT_TAGS[normTag(m[1])] !== undefined && /\./.test(m[2])) { nums.push({ t, z: Number(m[2]), tag: normTag(m[1]), paren: false }); continue }
    m = t.str.match(TAG_AFTER)
    if (m && SPOT_TAGS[normTag(m[2])] !== undefined) { nums.push({ t, z: Number(m[1]), tag: normTag(m[2]), paren: false }); continue }
    const ff = t.str.match(FF_WORDS)
    if (ff) { nums.push({ t, z: Number(ff[1]), tag: 'FF', paren: false }); continue }
    m = t.str.match(SPOT_NUM)
    if (m) nums.push({ t, z: Number(m[1]), tag: null, paren: /^\(/.test(t.str) })
  }
  // A bare number takes the nearest free tag word beside it (SHX: "247.82" and "GS" are two notes).
  for (const n of nums) {
    if (n.tag) continue
    let best: PdfText | null = null, bestD = Math.max(n.t.size, 4) * 2.2
    for (const tg of tags) {
      if (usedTag.has(tg)) continue
      const d = Math.hypot(tg.x - n.t.x, tg.y - n.t.y) - (tg.len + n.t.len) / 4
      if (d < bestD) { bestD = d; best = tg }
    }
    if (best) { usedTag.add(best); n.tag = normTag(best.str) }
  }
  // Where's the point: the nearest small marker (an x, a +, a dot) beside the words, else the words.
  for (const n of nums) {
    if (n.tag && SPOT_TAGS[n.tag] === 'ff') {
      out.push({ x: n.t.x, y: n.t.y, z: n.z, role: 'skip', tag: 'FF', text: n.t.str })
      continue
    }
    let role: PlanSpot['role'] = n.tag ? (SPOT_TAGS[n.tag] as PlanSpot['role']) : 'fg'
    if (!n.tag) {
      const pen = penUnder(P, n.t)
      const p = pen >= 0 ? pens.find(q => q.id === pen) : null
      if (n.paren) role = 'eg'
      else if (p && (EXIST_HINT.test(p.layer ?? '') || isGrey(p.color))) role = 'eg'
    }
    const [mx, my] = marker(P, n.t)
    out.push({ x: mx, y: my, z: n.z, role, tag: n.tag ?? (n.paren ? '( )' : ''), text: n.t.str })
  }
  return out
}

function marker(P: Prepared, t: PdfText): [number, number] {
  if (!P.lineIdx) return [t.x, t.y]
  const r = Math.max(t.size, 3) * 2.5 + t.len / 2
  const hits: number[] = []
  P.lineIdx.query({ x0: t.x - r, y0: t.y - r, x1: t.x + r, y1: t.y + r }, hits)
  const small = new Map<number, Box>()
  for (const id of hits) {
    const li = P.segs[id * 5 + 4]
    const line = P.lines[li]
    if (line.len > Math.max(t.size, 3) * 2.2) continue
    small.set(li, boxOfPts(line.pts))
  }
  // Group little strokes that share a centre: two crossing strokes = an x or +.
  let best: [number, number] | null = null, bestD = Infinity
  const items = Array.from(small.values())
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2
    const partners = items.filter((b, j) => j !== i && Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy) < Math.max(t.size, 3) * 0.25)
    if (!partners.length) continue
    // Not part of the words themselves: a marker sits outside the words' own box.
    const inWords = Math.abs(cx - t.x) < t.len / 2 * 0.9 && Math.abs(cy - t.y) < t.size * 0.45
    if (inWords) continue
    const d = Math.hypot(cx - t.x, cy - t.y)
    if (d < bestD) { bestD = d; best = [cx, cy] }
  }
  return best ?? [t.x, t.y]
}

/** Closed rings in the read area: closed paths, plus pieces of one pen that meet end to end. */
function rings(P: Prepared, pens: PdfPen[]): { ring: number[]; pen: PdfPen | undefined; area: number }[] {
  const byPen = new Map<number, number[][]>()
  const out: { ring: number[]; pen: PdfPen | undefined; area: number }[] = []
  for (const l of P.lines) {
    if (l.closed) { out.push({ ring: l.pts, pen: pens.find(p => p.id === l.pen), area: polyArea(l.pts) }); continue }
    const a = byPen.get(l.pen) ?? []
    a.push(l.pts)
    byPen.set(l.pen, a)
  }
  for (const [pen, ls] of Array.from(byPen.entries())) {
    if (ls.length > 4000) continue
    for (const c of chainLines(ls, 0.05)) if (c.closed) out.push({ ring: c.pts, pen: pens.find(p => p.id === pen), area: polyArea(c.pts) })
  }
  return out
}

/**
 * The outline around a point, however it's drawn — closed paths, loose
 * segments, or a wall band of filled slivers (AutoCAD's solid hatch): the
 * nearby linework is drawn onto a grid, flooded from the point, and the
 * flood's edge traced. A flood that reaches the grid's edge leaked through a
 * gap: no outline (better none than the whole site).
 */
function enclosure(P: Prepared, x: number, y: number, pick: (pen: number, len: number) => boolean, radius: number, minCell: number): number[] | null {
  if (!P.lineIdx) return null
  const n = Math.max(32, Math.min(700, Math.ceil((2 * radius) / Math.max(minCell, 1e-6))))
  const c = (2 * radius) / n
  const x0 = x - radius, y0 = y - radius
  const wall = new Uint8Array(n * n)
  const hits: number[] = []
  P.lineIdx.query({ x0, y0, x1: x + radius, y1: y + radius }, hits)
  let any = false
  for (const id of hits) {
    const o = id * 5
    if (!pick(P.segPen[id], P.lines[P.segs[o + 4]].len)) continue
    const ax = (P.segs[o] - x0) / c, ay = (P.segs[o + 1] - y0) / c, bx = (P.segs[o + 2] - x0) / c, by = (P.segs[o + 3] - y0) / c
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1
    for (let k = 0; k <= steps; k++) {
      const u = k / steps
      const gx = Math.floor(ax + (bx - ax) * u), gy = Math.floor(ay + (by - ay) * u)
      if (gx >= 0 && gy >= 0 && gx < n && gy < n) { wall[gy * n + gx] = 1; any = true }
    }
  }
  if (!any) return null
  let sx = Math.floor((x - x0) / c), sy = Math.floor((y - y0) / c)
  if (wall[sy * n + sx]) {
    // Started on a line: the nearest open cell.
    let found = false
    for (let r = 1; r <= 3 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
      const qx = sx + dx, qy = sy + dy
      if (qx > 0 && qy > 0 && qx < n - 1 && qy < n - 1 && !wall[qy * n + qx]) { sx = qx; sy = qy; found = true }
    }
    if (!found) return null
  }
  const fill = new Uint8Array(n * n)
  const stack = [sy * n + sx]
  fill[sy * n + sx] = 1
  let count = 0
  while (stack.length) {
    const k = stack.pop()!
    count++
    const gx = k % n, gy = (k - gx) / n
    if (gx === 0 || gy === 0 || gx === n - 1 || gy === n - 1) return null // leaked
    for (const nk of [k - 1, k + 1, k - n, k + n]) if (!wall[nk] && !fill[nk]) { fill[nk] = 1; stack.push(nk) }
  }
  if (count < 4) return null
  // Out to the middle of the wall: grow the flood one cell into the lines it stopped at.
  const grown = fill.slice()
  for (let k = 0; k < n * n; k++) if (fill[k]) for (const nk of [k - 1, k + 1, k - n, k + n]) if (wall[nk]) grown[nk] = 1
  // Trace the edge (marching squares on cell centres) and keep the longest closed loop.
  const segsOut: number[][] = []
  const at = (gx: number, gy: number) => (gx >= 0 && gy >= 0 && gx < n && gy < n ? grown[gy * n + gx] : 0)
  for (let gy = -1; gy < n; gy++) for (let gx = -1; gx < n; gx++) {
    const a = at(gx, gy), b = at(gx + 1, gy), d = at(gx, gy + 1), e = at(gx + 1, gy + 1)
    const code = a | (b << 1) | (e << 2) | (d << 3)
    if (code === 0 || code === 15) continue
    const px = (u: number, v: number): number[] => [x0 + (gx + 0.5 + u) * c, y0 + (gy + 0.5 + v) * c]
    const T = px(0.5, 0), R = px(1, 0.5), B = px(0.5, 1), L = px(0, 0.5)
    const add = (p: number[], q: number[]) => segsOut.push([...p, ...q])
    switch (code) {
      case 1: case 14: add(L, T); break
      case 2: case 13: add(T, R); break
      case 3: case 12: add(L, R); break
      case 4: case 11: add(R, B); break
      case 6: case 9: add(T, B); break
      case 7: case 8: add(L, B); break
      case 5: add(L, T); add(R, B); break
      case 10: add(T, R); add(L, B); break
    }
  }
  const loops = chainLines(segsOut, c * 0.01, [], c * 0.01).filter(l => l.closed)
  if (!loops.length) return null
  const outer = loops.sort((p, q) => polyArea(q.pts) - polyArea(p.pts))[0].pts
  return simplify(outer, c * 0.75)
}

const BLDG = /BLDG|BUILD|BLD|FTPRNT|FOOTPRINT|SLAB|STRUCT|HOUSE/i

function readPads(P: Prepared, pens: PdfPen[], spots: PlanSpot[], ptPerFt: number, rs: ReturnType<typeof rings>): PlanPad[] {
  const ffs = spots.filter(s => s.tag === 'FF')
  if (!ffs.length) return []
  const minA = (12 * ptPerFt) ** 2, maxA = (800 * ptPerFt) ** 2
  const ok = (r: number[] | null): r is number[] => !!r && r.length >= 6 && polyArea(r) >= minA && polyArea(r) <= maxA
  const bldg = new Set(pens.filter(p => BLDG.test(layerBase(p.layer))).map(p => p.id))
  // Fine first (a small window, ~0.1 ft cells), wider only when the flood leaks out of it.
  const encl = (x: number, y: number, pick: (pen: number, len: number) => boolean): number[] | null => {
    for (const rFt of [40, 100, 250, 600]) {
      const r = enclosure(P, x, y, pick, rFt * ptPerFt, Math.max((2 * rFt) / 700, 0.1) * ptPerFt)
      if (r) return r
    }
    return null
  }
  const out: PlanPad[] = []
  for (const s of ffs) {
    const size = 4
    const around = (named: boolean) => rs
      .filter(r => (!named || (r.pen && bldg.has(r.pen.id))) && r.area >= minA && r.area <= maxA && pointInRing(s.x, s.y, r.ring))
      .sort((a, b) => a.area - b.area)[0]?.ring ?? null
    let ring: number[] | null = around(true)
    if (!ok(ring) && bldg.size) ring = encl(s.x, s.y, (pen, len) => bldg.has(pen) && len >= size)
    if (!ok(ring)) ring = around(false)
    if (!ok(ring)) ring = encl(s.x, s.y, (_pen, len) => len >= size * 6)
    out.push({ ring: ok(ring) ? ring : [], ffe: s.z, text: s.text, outline: ok(ring) })
  }
  return out
}

function readLimits(P: Prepared, pens: PdfPen[], ptPerFt: number, all: ReturnType<typeof rings>): number[] | null {
  const LIM = /LIMIT|LOD|DISTURB|GRAD.?LIM|LIM.?GRAD|CLEAR/i
  const rs = all.filter(r => r.area >= (30 * ptPerFt) ** 2)
  const named = rs.filter(r => LIM.test(layerBase(r.pen?.layer ?? null)))
  if (named.length) return named.sort((a, b) => b.area - a.area)[0].ring
  // A ring the "LIMIT OF GRADING" words sit on.
  const words = P.texts.filter(t => /LIMIT\s+OF\s+(GRADING|DISTURBANCE|WORK)|^L\.?O\.?D\.?$/i.test(t.str))
  for (const w of words) {
    const onIt = rs.filter(r => {
      for (let i = 2; i < r.ring.length; i += 2) if (distToSeg(w.x, w.y, r.ring[i - 2], r.ring[i - 1], r.ring[i], r.ring[i + 1]) < w.size * 2) return true
      return false
    })
    if (onIt.length) return onIt.sort((a, b) => b.area - a.area)[0].ring
  }
  return null
}
