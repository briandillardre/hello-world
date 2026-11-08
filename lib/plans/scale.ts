/**
 * Proving a sheet's scale — pure (Brian, Nov 7: "Assurance that scale is
 * working?").
 *
 * Up to five independent measures of the same number, feet per inch of paper:
 *   stated     1" = 30' in the title block, at the paper size the PDF is
 *   bar        the graphic scale bar, measured off its own labels
 *   dims       labelled distances (245.67') against the length of the line
 *              they label
 *   grid       the state plane ticks (lib/plans/gridfit.ts)
 *   placement  the sheet's fit on the map — the ground knows real feet
 * Green when two or more agree within 0.5 %, amber with only one, red when
 * any two disagree by more than 1 % — and a print at exactly half (or twice)
 * the stated scale is named for what it is.
 */

import type { PdfLine, PdfText } from '../dirt/pdf-vectors'
import { lines } from './title-block'

export type ScaleKey = 'stated' | 'bar' | 'dims' | 'grid' | 'placement' | 'set'

export interface ScaleCheck {
  key: ScaleKey
  feetPerInch: number
  /** Plain words: "1\" = 30' in the title block", "4 of 5 labelled distances agree". */
  detail: string
}

export const SCALE_LABEL: Record<ScaleKey, string> = {
  stated: 'Stated scale',
  bar: 'Scale bar',
  dims: 'Labelled distances',
  grid: 'Grid ticks',
  placement: 'Placement on the map',
  set: 'Set by hand',
}

/** "1\" = 30'" for a feet-per-inch number. */
export function scaleWords(fpi: number): string {
  const r = Math.abs(fpi - Math.round(fpi)) < 0.05 ? String(Math.round(fpi)) : fpi.toFixed(1)
  return `1" = ${r}'`
}

// ── The scale bar ───────────────────────────────────────────────────────────

const BAR_NUM = /^(\d{1,4})(?:'|FT\.?|FEET)?$/i
const UNIT_WORD = /\b(FEET|FT|SCALE|GRAPHIC)\b/i

/**
 * The graphic scale bar: three or more numbers starting at 0 on one baseline
 * whose positions grow in step with their values (0 15 30 60), next to a
 * FEET / SCALE word. Contour labels never start at 0; a table of quantities
 * never sits in a straight proportional line.
 */
export function scaleBar(words: PdfText[]): { feetPerInch: number; detail: string } | null {
  const nums = words
    .map((w) => ({ w, m: BAR_NUM.exec(marks(w.str).trim()) }))
    .filter((x): x is { w: PdfText; m: RegExpExecArray } => !!x.m)
    .map(({ w, m }) => {
      const c = Math.cos(-w.angle), s = Math.sin(-w.angle)
      return { w, v: Number(m[1]), rx: w.x * c - w.y * s, ry: w.x * s + w.y * c }
    })
  const units = words.filter((w) => UNIT_WORD.test(w.str))
  let best: { feetPerInch: number; detail: string; n: number } | null = null
  for (const zero of nums.filter((n) => n.v === 0)) {
    const row = nums.filter((n) =>
      Math.abs(n.w.angle - zero.w.angle) < 0.03 &&
      Math.abs(n.ry - zero.ry) < 0.6 * Math.max(n.w.size, zero.w.size) &&
      Math.abs(n.w.size - zero.w.size) < 0.3 * zero.w.size &&
      n.rx >= zero.rx - 1 && n.rx - zero.rx < 800)
      .sort((a, b) => a.rx - b.rx)
    // One label per value, values rising left to right.
    const seq: typeof row = []
    for (const n of row) {
      if (seq.length && n.v <= seq[seq.length - 1].v) continue
      seq.push(n)
    }
    if (seq.length < 3) continue
    // Fit rx = r0 + k·v.
    const mv = seq.reduce((t, n) => t + n.v, 0) / seq.length
    const mr = seq.reduce((t, n) => t + n.rx, 0) / seq.length
    let num = 0, den = 0
    for (const n of seq) { num += (n.v - mv) * (n.rx - mr); den += (n.v - mv) ** 2 }
    if (den <= 0) continue
    const k = num / den
    if (!(k > 0)) continue
    const span = seq[seq.length - 1].rx - seq[0].rx
    const worst = Math.max(...seq.map((n) => Math.abs(mr + k * (n.v - mv) - n.rx)))
    if (worst > Math.max(1.5, 0.02 * span)) continue
    const cx = (seq[0].w.x + seq[seq.length - 1].w.x) / 2, cy = (seq[0].w.y + seq[seq.length - 1].w.y) / 2
    const near = units.some((u) => Math.hypot(u.x - cx, u.y - cy) < Math.max(span, 12 * zero.w.size))
    if (!near) continue
    const fpi = 72 / k
    if (!(fpi >= 1 && fpi <= 2000)) continue
    if (!best || seq.length > best.n) {
      best = { feetPerInch: Math.round(fpi * 100) / 100, detail: `bar ${seq.map((n) => n.v).join(' · ')} ft`, n: seq.length }
    }
  }
  return best ? { feetPerInch: best.feetPerInch, detail: best.detail } : null
}

// ── Labelled distances ──────────────────────────────────────────────────────

const DIST = /(?:^|[^\d.])(\d{1,4}\.\d{1,2})\s*(?:'|FT\b)(?!\d)/gi
/** PDFs print a foot mark as ' or ’ or ′ (and inches as " ” ″) — one form here. */
const marks = (s: string) => s.replace(/[’‘′´`]/g, "'").replace(/[“”″]/g, '"')
const CELL = 60

interface Seg { x0: number; y0: number; x1: number; y1: number; len: number; ang: number }

/**
 * Boundary calls and dimension text — "N 45°12'30\" E 245.67'" — against the
 * straight line each one labels (parallel to the words, beside them, the
 * words over its middle). Each pair gives a feet-per-inch; the answer is
 * where most of them agree.
 */
export function labelledDistances(words: PdfText[], strokes: PdfLine[]): { feetPerInch: number; n: number; agree: number; detail: string } | null {
  // Straight pieces at least half an inch long, indexed by the cells they cross.
  const segs: Seg[] = []
  const grid = new Map<string, number[]>()
  for (const l of strokes) {
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const x0 = l.pts[i], y0 = l.pts[i + 1], x1 = l.pts[i + 2], y1 = l.pts[i + 3]
      const len = Math.hypot(x1 - x0, y1 - y0)
      if (len < 36) continue
      const id = segs.push({ x0, y0, x1, y1, len, ang: Math.atan2(y1 - y0, x1 - x0) }) - 1
      const steps = Math.ceil(len / (CELL / 2))
      const seen = new Set<string>()
      for (let k = 0; k <= steps; k++) {
        const key = `${Math.floor((x0 + ((x1 - x0) * k) / steps) / CELL)},${Math.floor((y0 + ((y1 - y0) * k) / steps) / CELL)}`
        if (seen.has(key)) continue
        seen.add(key)
        let arr = grid.get(key)
        if (!arr) { arr = []; grid.set(key, arr) }
        arr.push(id)
      }
      if (segs.length > 200_000) break
    }
  }
  const ratios: number[] = []
  for (const l of lines(words)) {
    if (l.str.length > 60) continue
    DIST.lastIndex = 0
    let m: RegExpExecArray | null
    const vals: number[] = []
    const str = marks(l.str)
    while ((m = DIST.exec(str))) vals.push(Number(m[1]))
    if (vals.length !== 1 || !(vals[0] > 5)) continue
    const feet = vals[0]
    const cx = Math.floor(l.x / CELL), cy = Math.floor(l.y / CELL)
    let pick: Seg | null = null
    let pickD = Infinity
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const id of grid.get(`${gx},${gy}`) ?? []) {
        const s = segs[id]
        let da = Math.abs(s.ang - l.angle) % Math.PI
        if (da > Math.PI / 2) da = Math.PI - da
        if (da > (2 * Math.PI) / 180) continue
        const ux = (s.x1 - s.x0) / s.len, uy = (s.y1 - s.y0) / s.len
        const along = (l.x - s.x0) * ux + (l.y - s.y0) * uy
        if (along < 0.1 * s.len || along > 0.9 * s.len) continue
        const off = Math.abs(-(l.x - s.x0) * uy + (l.y - s.y0) * ux)
        if (off > 3 * l.size) continue
        if (off < pickD) { pickD = off; pick = s }
      }
    }
    if (pick) ratios.push(feet / (pick.len / 72))
  }
  if (!ratios.length) return null
  ratios.sort((a, b) => a - b)
  // The densest cluster within 1 %.
  let bestI = 0, bestN = 0
  for (let i = 0; i < ratios.length; i++) {
    let j = i
    while (j < ratios.length && ratios[j] <= ratios[i] * 1.01) j++
    if (j - i > bestN) { bestN = j - i; bestI = i }
  }
  const agree = ratios.slice(bestI, bestI + bestN)
  if (bestN < 2) return null
  const fpi = agree[Math.floor(agree.length / 2)]
  if (!(fpi >= 1 && fpi <= 2000)) return null
  return { feetPerInch: Math.round(fpi * 100) / 100, n: ratios.length, agree: bestN, detail: `${bestN} of ${ratios.length} labelled distances agree` }
}

/** Feet per inch the sheet's placement implies (metres per page point × 72). */
export function placementFeetPerInch(metresPerPoint: number): number {
  return Math.round(((metresPerPoint / 0.3048) * 72) * 100) / 100
}

// ── The verdict ─────────────────────────────────────────────────────────────

export interface ScaleVerdict {
  tone: 'green' | 'amber' | 'red' | 'none'
  words: string
  /** The scale to use instead, when one reading is a print-size mistake. */
  suggest: number | null
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.min(a, b)

export function scaleVerdict(checks: ScaleCheck[]): ScaleVerdict {
  // A person who set the scale has decided; the other checks still show.
  const set = checks.find((c) => c.key === 'set' && c.feetPerInch > 0)
  if (set) return { tone: 'green', words: `Set by hand: ${scaleWords(set.feetPerInch)}`, suggest: null }
  const cs = checks.filter((c) => Number.isFinite(c.feetPerInch) && c.feetPerInch > 0)
  if (!cs.length) return { tone: 'none', words: 'No scale found on this sheet — place it on the map to measure it.', suggest: null }
  if (cs.length === 1) {
    return { tone: 'amber', words: `Only one check: ${scaleWords(cs[0].feetPerInch)} (${SCALE_LABEL[cs[0].key].toLowerCase()}). Place it on the map to confirm.`, suggest: null }
  }
  let worst = 0, pair: [ScaleCheck, ScaleCheck] | null = null
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const r = rel(cs[i].feetPerInch, cs[j].feetPerInch)
    if (r > worst) { worst = r; pair = [cs[i], cs[j]] }
  }
  if (worst > 0.01 && pair) {
    // The stated scale against everything else that agrees with itself.
    const stated = cs.find((c) => c.key === 'stated')
    const rest = cs.filter((c) => c.key !== 'stated')
    if (stated && rest.length && rest.every((c) => rel(c.feetPerInch, rest[0].feetPerInch) <= 0.01)) {
      const r = rest[0].feetPerInch / stated.feetPerInch
      if (Math.abs(r - 2) <= 0.02) return { tone: 'red', words: `Looks like a half-size print. Use ${scaleWords(stated.feetPerInch * 2)}?`, suggest: stated.feetPerInch * 2 }
      if (Math.abs(r - 0.5) <= 0.01) return { tone: 'red', words: `Looks like a double-size print. Use ${scaleWords(stated.feetPerInch / 2)}?`, suggest: stated.feetPerInch / 2 }
    }
    return {
      tone: 'red',
      words: `${SCALE_LABEL[pair[0].key]} says ${scaleWords(pair[0].feetPerInch)} but ${SCALE_LABEL[pair[1].key].toLowerCase()} says ${scaleWords(pair[1].feetPerInch)} — check before measuring.`,
      suggest: null,
    }
  }
  const tone = worst <= 0.005 ? 'green' : 'amber'
  return { tone, words: `${cs.length} checks agree${tone === 'amber' ? ' within 1 %' : ''}: ${scaleWords(cs[0].feetPerInch)}`, suggest: null }
}
