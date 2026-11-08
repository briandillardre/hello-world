/**
 * The takeoff's first pass (Plans & Takeoff phase 2; Brian, Nov 7: "Ideally
 * ai does the takeoff and completes all of the typical stuff").
 *
 * A civil sheet's PDF keeps its CAD layers: the curb is drawn on C-CURB, the
 * silt fence on C-ESC-SF, the storm pipe on C-STRM-PIPE. So the pass works in
 * two steps — WORDS from the AI (or, without a key, these rules): which layer
 * is which item in the company's library; NUMBERS from the engine: the marks
 * those layers draw, measured on the server at the sheet's scale like any
 * mark. Every mark lands as "suggested" (dashed) until a person accepts it.
 *
 * Pure. The device reads the PDF (components/plans/pdf.ts readVectors); the
 * server maps layers and stores marks. Page space here is the viewed page at
 * scale 1 with y UP (fingerprint.ts linesToViewed); marks are page fractions
 * with v DOWN from the top edge.
 */
import { chainLines, simplify } from '../dirt/plan-read'
import type { PdfLine, PdfPen } from '../dirt/pdf-vectors'
import { kindFor, type MarkGeom, type MarkKind, type Measure } from './measure'

/** One pen (layer + colour + width + dash) of the sheet, by the numbers. */
export interface PenStat {
  pen: number
  layer: string | null
  color: string
  width: number
  dash: string
  /** Stroked pieces. */
  pieces: number
  /** Total length on the paper, inches. */
  lengthIn: number
  /** Closed shapes big enough to be an area (≥ ¼ sq in of paper). */
  areas: number
  /** Small closed shapes — a structure, a symbol. */
  symbols: number
}

export interface LibraryItem { id: string; code: string; name: string; measure: Measure; section: string | null }

export interface Assignment { pen: number; itemId: string; why: string }

export interface ProposedMark { itemId: string; kind: MarkKind; geom: MarkGeom; label: string }

/** A drawing-area box in page fractions (v down) — legends and title blocks outside it are left alone. */
export interface Box { x0: number; y0: number; x1: number; y1: number }

const PT_PER_IN = 72
/** ¼ sq in: below this a closed shape is a symbol, not an area. */
const MIN_AREA_PT2 = 18 * 18
/** A symbol fits in ⅓ inch. */
const SYMBOL_PT = 24
/** Lines shorter than ⅛ inch are tick marks, not curb. */
const MIN_LINE_PT = 9

function polyArea(pts: number[]): number {
  let a = 0
  const n = pts.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) a += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1]
  return Math.abs(a) / 2
}
function lenOf(pts: number[]): number {
  let t = 0
  for (let i = 2; i < pts.length; i += 2) t += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
  return t
}
function bboxOf(pts: number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i]
    if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1]
  }
  return { x0, y0, x1, y1 }
}
/** Closed: flagged closed, or ending where it started. */
function isClosed(l: PdfLine): boolean {
  const p = l.pts
  return l.closed || (p.length >= 8 && Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) < 0.5)
}

/** The lines inside the drawing area (all of them when there is no box). */
export function inBox(lines: PdfLine[], size: { width: number; height: number }, box: Box | null): PdfLine[] {
  if (!box) return lines
  const X0 = box.x0 * size.width, X1 = box.x1 * size.width
  // v down → y up
  const Y0 = (1 - box.y1) * size.height, Y1 = (1 - box.y0) * size.height
  return lines.filter((l) => {
    const b = bboxOf(l.pts)
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
    return cx >= X0 && cx <= X1 && cy >= Y0 && cy <= Y1
  })
}

/** Every pen's numbers, longest first, at most `max` pens. */
export function penStats(pens: PdfPen[], lines: PdfLine[], max = 150): PenStat[] {
  const by = new Map<number, PenStat>()
  for (const p of pens) by.set(p.id, { pen: p.id, layer: p.layer, color: p.color, width: Math.round(p.width * 100) / 100, dash: p.dash, pieces: 0, lengthIn: 0, areas: 0, symbols: 0 })
  for (const l of lines) {
    const s = by.get(l.pen)
    if (!s) continue
    s.pieces++
    s.lengthIn += lenOf(l.pts) / PT_PER_IN
    if (isClosed(l)) {
      const a = polyArea(l.pts), b = bboxOf(l.pts)
      if (a >= MIN_AREA_PT2) s.areas++
      else if (b.x1 - b.x0 <= SYMBOL_PT && b.y1 - b.y0 <= SYMBOL_PT) s.symbols++
    }
  }
  return Array.from(by.values())
    .filter((s) => s.pieces > 0 && !/^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/i.test(s.color)) // white = masks, never printed
    .map((s) => ({ ...s, lengthIn: Math.round(s.lengthIn * 10) / 10 }))
    .sort((a, b) => b.lengthIn - a.lengthIn)
    .slice(0, max)
}

/** What a pen can be measured as, from its geometry. */
export function penFits(s: PenStat, kind: MarkKind): boolean {
  if (kind === 'line') return s.lengthIn >= 0.5
  if (kind === 'area') return s.areas > 0
  return s.symbols > 0
}

/** Stats arriving from a device — bounded and typed before anything reads them. */
export function cleanPenStats(x: unknown): PenStat[] {
  if (!Array.isArray(x)) return []
  const num = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= hi ? v : 0)
  return x.slice(0, 300).flatMap((r) => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    if (typeof o.pen !== 'number' || !Number.isInteger(o.pen) || o.pen < 0 || o.pen > 1e6) return []
    return [{
      pen: o.pen,
      layer: typeof o.layer === 'string' ? o.layer.replace(/[\u0000-\u001f]/g, '').slice(0, 120) : null,
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#000000',
      width: num(o.width, 100),
      dash: typeof o.dash === 'string' ? o.dash.replace(/[^0-9.,]/g, '').slice(0, 40) : '',
      pieces: Math.round(num(o.pieces, 1e7)),
      lengthIn: num(o.lengthIn, 1e7),
      areas: Math.round(num(o.areas, 1e6)),
      symbols: Math.round(num(o.symbols, 1e6)),
    }]
  })
}

// ── The rules (no key, or the model didn't answer) ─────────────────────────

/** Layer words → what the item's name says. Ordered: the first that fits wins. */
const RULES: { layer: RegExp; item: RegExp | RegExp[]; kinds: MarkKind[] }[] = [
  { layer: /\b(SILT|SF|SFENCE|SILTFENCE)\b|SILT.?FENCE/, item: /silt/i, kinds: ['line'] },
  { layer: /\b(CG|C&G|GUTTER)\b|CURB.?(AND|&).?GUTTER/, item: /curb and gutter|gutter/i, kinds: ['line'] },
  // A plain curb layer: a plain curb item before a curb-and-gutter one.
  { layer: /CURB/, item: [/^(?!.*gutter).*curb/i, /curb/i], kinds: ['line'] },
  { layer: /STRIP|STRIPE|PVMK|PVMT.?MARK|\bMARKING/, item: /strip/i, kinds: ['line'] },
  { layer: /\b(INLET|CB|CATCH|DI|YI)\b|CATCH.?BASIN|STRUCT/, item: /catch|inlet|structure/i, kinds: ['count'] },
  { layer: /\b(MH|MANHOLE|SSMH)\b|MANHOLE/, item: /manhole/i, kinds: ['count'] },
  { layer: /\b(STRM|STORM|SD|RCP|HDPE|CMP)\b|STORM/, item: /\b(rcp|hdpe|cmp|storm|pipe)\b|"\s*rcp/i, kinds: ['line'] },
  { layer: /\b(SAN|SS|SEWR|SEWER)\b|SANIT/, item: /sanitary|sewer/i, kinds: ['line'] },
  { layer: /\b(WTR|WATER|WL)\b|WATER/, item: /water/i, kinds: ['line'] },
  { layer: /\b(SDWK|WALK|SW)\b|SIDEWALK/, item: /sidewalk/i, kinds: ['area'] },
  { layer: /HEAVY|\bHD\b/, item: /heavy duty/i, kinds: ['area'] },
  { layer: /\b(PAVE|PAV|PVMT|ASPH|AC)\b|PAVE|ASPH/, item: /asphalt|paving|pavement/i, kinds: ['area'] },
  { layer: /CONC/, item: /concrete/i, kinds: ['area'] },
  { layer: /\b(SOD)\b/, item: /\bsod\b/i, kinds: ['area'] },
  { layer: /SEED|GRASS|LAWN|TURF/, item: /seed|grass/i, kinds: ['area'] },
  { layer: /\bFENCE\b/, item: /^(?!.*silt).*fence/i, kinds: ['line'] },
  { layer: /STALL|PARK/, item: /stall/i, kinds: ['count'] },
]

/** The number a layer name carries (C-STRM-24 → 24) — picks 24" RCP over 15". */
function sizeIn(s: string): string | null {
  const m = s.match(/(?:^|[^0-9])(\d{1,2})(?:IN|"|”|[^0-9]|$)/)
  return m ? m[1] : null
}

/** Keyword assignment: a layer whose name says what it is, to the item that says the same. */
export function ruleAssign(stats: PenStat[], items: LibraryItem[]): Assignment[] {
  const out: Assignment[] = []
  for (const s of stats) {
    if (!s.layer) continue
    const L = s.layer.toUpperCase().replace(/[_|.]/g, '-')
    for (const r of RULES) {
      if (!r.layer.test(L)) continue
      let fits: LibraryItem[] = []
      for (const re of Array.isArray(r.item) ? r.item : [r.item]) {
        fits = items.filter((it) => re.test(it.name) && r.kinds.includes(kindFor(it.measure)) && penFits(s, kindFor(it.measure)))
        if (fits.length) break
      }
      if (!fits.length) continue
      const size = sizeIn(L)
      const pick = (size && fits.find((it) => new RegExp(`(^|[^0-9])${size}(?:"|”|\\s*in|[^0-9]|$)`, 'i').test(`${it.name} ${it.code}`))) || fits[0]
      out.push({ pen: s.pen, itemId: pick.id, why: `layer ${s.layer}` })
      break
    }
  }
  return out
}

/** A model's answer, kept only where it names a real item that fits the pen's shapes. */
export function cleanAssignments(raw: unknown, stats: PenStat[], items: LibraryItem[]): Assignment[] {
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { assign?: unknown }).assign)) ? (raw as { assign: unknown[] }).assign : []
  const byPen = new Map(stats.map((s) => [s.pen, s]))
  const byCode = new Map(items.map((it) => [it.code.toUpperCase(), it]))
  const seen = new Set<number>()
  const out: Assignment[] = []
  for (const a of list.slice(0, 300)) {
    if (!a || typeof a !== 'object') continue
    const { pen, item, why } = a as { pen?: unknown; item?: unknown; why?: unknown }
    if (typeof pen !== 'number' || seen.has(pen)) continue
    const s = byPen.get(pen)
    const it = typeof item === 'string' ? byCode.get(item.toUpperCase()) : undefined
    if (!s || !it || !penFits(s, kindFor(it.measure))) continue
    seen.add(pen)
    out.push({ pen, itemId: it.id, why: typeof why === 'string' ? why.replace(/\s+/g, ' ').slice(0, 80) : `pen ${pen}` })
  }
  return out
}

// ── The marks ───────────────────────────────────────────────────────────────

export const MAX_MARKS_PER_ITEM = 120
export const MAX_MARKS = 400
/** All the points one run may send (a server action body stays well under its 4 MB cap). */
export const MAX_POINTS = 60_000
/** Raw points one polyline keeps before simplifying. */
const MAX_RAW = 4000

interface Candidate { itemId: string; kind: MarkKind; pts: number[]; closeRing: boolean; label: string }

/**
 * The marks the assigned pens draw: every chained run of an assigned length
 * pen, every closed outline of an area pen, every symbol of a count pen (one
 * count mark per item). Page fractions, simplified, bounded — past the
 * points budget the linework is simplified harder, then the smallest marks
 * are left out (and counted).
 */
export function proposeMarks(
  assign: Assignment[], items: LibraryItem[], lines: PdfLine[], size: { width: number; height: number }, labelOf: (a: Assignment) => string,
): { marks: ProposedMark[]; dropped: number } {
  const itemById = new Map(items.map((it) => [it.id, it]))
  const W = size.width, H = size.height
  const r5 = (x: number) => Math.round(x * 1e5) / 1e5
  const uv = (pts: number[]): [number, number][] => {
    const out: [number, number][] = []
    for (let i = 0; i < pts.length; i += 2) out.push([r5(pts[i] / W), r5(1 - pts[i + 1] / H)])
    return out
  }
  const piecesOf = new Map<number, PdfLine[]>()
  for (const l of lines) {
    const a = piecesOf.get(l.pen)
    if (a) a.push(l); else piecesOf.set(l.pen, [l])
  }
  const cands: Candidate[] = []
  let dropped = 0
  const countPts = new Map<string, { pts: [number, number][]; label: string }>()
  for (const a of assign) {
    const it = itemById.get(a.itemId)
    const pieces = piecesOf.get(a.pen) ?? []
    if (!it || !pieces.length) continue
    const kind = kindFor(it.measure)
    const label = labelOf(a).slice(0, 120)
    if (kind === 'line') {
      const runs: Candidate[] = chainLines(pieces.filter((l) => !isClosed(l)).map((l) => l.pts), 0.6)
        .filter((c) => c.pts.length >= 4 && lenOf(c.pts) >= MIN_LINE_PT)
        .map((c) => ({ itemId: it.id, kind, pts: c.pts, closeRing: false, label }))
      // A closed outline drawn on a length layer (a curb island) is still curb, all the way round.
      for (const l of pieces.filter(isClosed)) if (lenOf(l.pts) >= MIN_LINE_PT) runs.push({ itemId: it.id, kind, pts: l.pts, closeRing: true, label })
      runs.sort((x, y) => lenOf(y.pts) - lenOf(x.pts))
      cands.push(...runs.slice(0, MAX_MARKS_PER_ITEM))
      dropped += Math.max(0, runs.length - MAX_MARKS_PER_ITEM)
    } else if (kind === 'area') {
      const rings = pieces.filter((l) => isClosed(l) && polyArea(l.pts) >= MIN_AREA_PT2)
        .sort((x, y) => polyArea(y.pts) - polyArea(x.pts))
      for (const l of rings.slice(0, MAX_MARKS_PER_ITEM)) cands.push({ itemId: it.id, kind, pts: l.pts, closeRing: false, label })
      dropped += Math.max(0, rings.length - MAX_MARKS_PER_ITEM)
    } else {
      const at = countPts.get(it.id) ?? { pts: [], label }
      for (const l of pieces) {
        if (!isClosed(l)) continue
        const b = bboxOf(l.pts)
        if (b.x1 - b.x0 > SYMBOL_PT || b.y1 - b.y0 > SYMBOL_PT || polyArea(l.pts) >= MIN_AREA_PT2) continue
        const c: [number, number] = [r5(((b.x0 + b.x1) / 2) / W), r5(1 - ((b.y0 + b.y1) / 2) / H)]
        // One symbol is often drawn as several closed pieces: one count each.
        if (at.pts.some((p) => Math.hypot((p[0] - c[0]) * W, (p[1] - c[1]) * H) < 6)) continue
        at.pts.push(c)
      }
      countPts.set(it.id, at)
    }
  }
  // Simplify to fit the budget: 0.3 pt, then coarser, then leave the smallest
  // out. A monster polyline is thinned first (Douglas–Peucker is quadratic at
  // worst, and this runs on a phone).
  const thin = (pts: number[]) => {
    const n = pts.length / 2
    if (n <= MAX_RAW) return pts
    const k = Math.ceil(n / MAX_RAW), out: number[] = []
    for (let i = 0; i < n; i += k) out.push(pts[2 * i], pts[2 * i + 1])
    if ((n - 1) % k) out.push(pts[pts.length - 2], pts[pts.length - 1])
    return out
  }
  for (const c of cands) c.pts = thin(c.pts)
  let shaped: { c: Candidate; pts: number[] }[] = []
  for (const tol of [0.3, 1, 2.5]) {
    shaped = cands.map((c) => ({ c, pts: simplify(c.pts, tol) }))
    if (shaped.reduce((t, x) => t + x.pts.length / 2, 0) <= MAX_POINTS) break
  }
  const marks: ProposedMark[] = []
  let budget = MAX_POINTS
  countPts.forEach((v) => { budget -= Math.min(v.pts.length, 2000) })
  for (const { c, pts } of shaped) {
    let q = pts
    if (c.kind === 'area' && q.length >= 4 && Math.hypot(q[0] - q[q.length - 2], q[1] - q[q.length - 1]) < 0.5) q = q.slice(0, -2) // marks close themselves
    if (c.closeRing && q.length >= 4 && Math.hypot(q[0] - q[q.length - 2], q[1] - q[q.length - 1]) >= 0.5) q = [...q, q[0], q[1]]
    const n = q.length / 2
    if ((c.kind === 'area' && n < 3) || n < 2) continue
    if (n > 2000 || n > budget || marks.length >= MAX_MARKS) { dropped++; continue }
    budget -= n
    marks.push({ itemId: c.itemId, kind: c.kind, geom: { pts: uv(q) }, label: c.label })
  }
  countPts.forEach((v, itemId) => {
    if (!v.pts.length) return
    if (marks.length >= MAX_MARKS) { dropped++; return }
    marks.push({ itemId, kind: 'count', geom: { pts: v.pts.slice(0, 2000) }, label: v.label })
    dropped += Math.max(0, v.pts.length - 2000)
  })
  return { marks, dropped }
}

/** What the model is asked (the shapes in numbers, the library by code). */
export function firstPassPrompt(stats: PenStat[], items: LibraryItem[]): string {
  return JSON.stringify({
    items: items.map((it) => ({ code: it.code, name: it.name, measure: it.measure, section: it.section })),
    pens: stats.map((s) => ({ pen: s.pen, layer: s.layer, color: s.color, width: s.width, dash: s.dash || 'solid', pieces: s.pieces, lengthIn: s.lengthIn, closedAreas: s.areas, smallSymbols: s.symbols })),
  })
}

export const FIRST_PASS_SYSTEM = `You map the pens (CAD layers) of one civil sitework plan sheet to the takeoff items a sitework estimator measures.
You get the company's items (code, name, measure) and the sheet's pens: layer name (may be null), colour, width, dash pattern, how many pieces, total length on the paper in inches, closed areas and small symbols.
Assign a pen to an item ONLY when the layer name (or, with no layer name, an unmistakable combination of dash pattern and use) says it is that item: silt fence, curb, curb and gutter, storm/sanitary/water pipe by size, structures (inlets, catch basins, manholes) as counts of small symbols, paving / sidewalk / concrete areas as closed areas, striping, seeding.
Never assign contours, spot elevations, property lines, easements, setbacks, existing features, text, dimensions, hatch, grid, borders or title blocks.
A length item needs a pen with length; an area item needs closed areas; a count item needs small symbols.
Reply with JSON only: {"assign":[{"pen":<number>,"item":"<item code>","why":"<5-10 words>"}]}. Leave a pen out when unsure.`
