/**
 * Placing a sheet from the coordinates printed on it — pure.
 *
 * The strongest evidence a sheet carries about where it sits is its own
 * coordinates: state plane grid ticks along the border ("N 1,100,000",
 * "E 1,580,000") or a control-point table. Each tick label pins one grid
 * line to a place on the paper; with two of each the paper's scale, turn
 * and position all fall out (a similarity transform, least squares, every
 * label's own miss reported so one bad label stands out instead of quietly
 * skewing the sheet). Labels are read in VIEWED space (lib/plans/fingerprint).
 */

import type { PdfText } from '../dirt/pdf-vectors'
import { lines } from './title-block'
import { fromStatePlane, plausibleSC } from './stateplane'

export interface GridObs { kind: 'E' | 'N'; value: number; x: number; y: number; text: string }

export interface GridFit {
  /** TL, TR, BR, BL as [lng, lat] (MapLibre image order). */
  bounds: [[number, number], [number, number], [number, number], [number, number]]
  /** Labels used. */
  n: number
  worstFt: number
  rmsFt: number
  /** Feet per inch of paper the grid implies — a scale check of its own. */
  feetPerInch: number
  /** Degrees the grid is turned on the paper (counter-clockwise). */
  turnDeg: number
  /** True when the labels could not fix the turn and grid north was assumed up. */
  assumedUp: boolean
  /** "4 grid ticks" / "2 control points". */
  what: string
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{6,7})(\.\d+)?`
const N_BEFORE = new RegExp(String.raw`\bN(?:ORTH(?:ING)?)?\.?\s*[:=]?\s*${NUM}\b`, 'i')
const N_AFTER = new RegExp(String.raw`\b${NUM}\s*'?\s*N\b`, 'i')
const E_BEFORE = new RegExp(String.raw`\bE(?:AST(?:ING)?)?\.?\s*[:=]?\s*${NUM}\b`, 'i')
const E_AFTER = new RegExp(String.raw`\b${NUM}\s*'?\s*E\b`, 'i')

const val = (m: RegExpExecArray | null): number | null => {
  if (!m) return null
  const v = Number(m[1].replace(/,/g, '') + (m[2] ?? ''))
  return Number.isFinite(v) ? v : null
}

/** Every grid coordinate printed on the page, with where it sits. */
export function findGridLabels(words: PdfText[]): GridObs[] {
  const out: GridObs[] = []
  for (const l of lines(words)) {
    const s = l.str.toUpperCase().replace(/[’‘′´`]/g, "'")
    if (s.length > 80) continue
    const n = val(N_BEFORE.exec(s)) ?? val(N_AFTER.exec(s))
    const e = val(E_BEFORE.exec(s)) ?? val(E_AFTER.exec(s))
    // Only grid-sized numbers: a station, an elevation or an area never is.
    if (n !== null && e !== null && plausibleSC(e, n)) {
      out.push({ kind: 'N', value: n, x: l.x, y: l.y, text: l.str }, { kind: 'E', value: e, x: l.x, y: l.y, text: l.str })
    } else if (n !== null && n >= 0 && n <= 1_300_000 && e === null) {
      out.push({ kind: 'N', value: n, x: l.x, y: l.y, text: l.str })
    } else if (e !== null && e >= 1_250_000 && e <= 2_800_000 && n === null) {
      out.push({ kind: 'E', value: e, x: l.x, y: l.y, text: l.str })
    }
  }
  return out
}

/** Solve a small dense system (Gaussian elimination, partial pivoting). */
function solve(M: number[][], v: number[]): number[] | null {
  const n = v.length
  const a = M.map((r, i) => [...r, v[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    if (Math.abs(a[p][c]) < 1e-9) return null
    ;[a[c], a[p]] = [a[p], a[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const k = a[r][c] / a[c][c]
      for (let j = c; j <= n; j++) a[r][j] -= k * a[c][j]
    }
  }
  return a.map((r, i) => r[n] / r[i])
}

type Model = { a: number; b: number; tx: number; ty: number }
const predict = (m: Model, o: GridObs) => (o.kind === 'E' ? m.a * o.x - m.b * o.y + m.tx : m.b * o.x + m.a * o.y + m.ty)

function fitOnce(obs: GridObs[], free: boolean): Model | null {
  // Unknowns: free → [a, b, tx, ty]; fixed turn → [a, tx, ty] with b = 0.
  const k = free ? 4 : 3
  const AtA = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const Atb = new Array<number>(k).fill(0)
  for (const o of obs) {
    const row = o.kind === 'E'
      ? (free ? [o.x, -o.y, 1, 0] : [o.x, 1, 0])
      : (free ? [o.y, o.x, 0, 1] : [o.y, 0, 1])
    for (let i = 0; i < k; i++) {
      Atb[i] += row[i] * o.value
      for (let j = 0; j < k; j++) AtA[i][j] += row[i] * row[j]
    }
  }
  const s = solve(AtA, Atb)
  if (!s) return null
  return free ? { a: s[0], b: s[1], tx: s[2], ty: s[3] } : { a: s[0], b: 0, tx: s[1], ty: s[2] }
}

/** Can the labels fix the turn? Needs E labels spread up the page or N
 *  labels spread across it (or both kinds at one control point). */
function turnFixed(obs: GridObs[]): boolean {
  const spread = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0)
  const eY = spread(obs.filter((o) => o.kind === 'E').map((o) => o.y))
  const nX = spread(obs.filter((o) => o.kind === 'N').map((o) => o.x))
  return eY > 50 || nX > 50
}

/**
 * Fit the page to the grid. null when there is not enough to fit (two E and
 * two N labels at least, spread apart), the labels disagree beyond repair,
 * or the result is not a believable plan scale.
 */
export function fitGrid(obs: GridObs[], page: { width: number; height: number }): GridFit | null {
  let use = dedupe(obs)
  for (let pass = 0; pass < 4; pass++) {
    const es = use.filter((o) => o.kind === 'E'), ns = use.filter((o) => o.kind === 'N')
    if (es.length < 2 || ns.length < 2) return null
    if (new Set(es.map((o) => o.value)).size < 2 || new Set(ns.map((o) => o.value)).size < 2) return null
    const free = turnFixed(use)
    const m = fitOnce(use, free)
    if (!m) return null
    const res = use.map((o) => Math.abs(predict(m, o) - o.value))
    const worst = Math.max(...res)
    const sorted = [...res].sort((p, q) => p - q)
    const median = sorted[Math.floor(sorted.length / 2)]
    // One label far off the rest: drop it and fit again (it is reported as
    // dropped by the label count, never silently averaged in).
    if (worst > 5 && worst > 4 * Math.max(median, 0.5) && use.length > 4) {
      const drop = res.indexOf(worst)
      use = use.filter((_, i) => i !== drop)
      continue
    }
    const ftPerPt = Math.hypot(m.a, m.b)
    const fpi = ftPerPt * 72
    if (!(fpi >= 1 && fpi <= 2000)) return null
    if (worst > 25) return null
    const corner = (x: number, y: number) => fromStatePlane(m.a * x - m.b * y + m.tx, m.b * x + m.a * y + m.ty)
    const W = page.width, H = page.height
    const points = new Set(use.filter((o) => use.some((p) => p !== o && p.x === o.x && p.y === o.y && p.kind !== o.kind)).map((o) => `${o.x},${o.y}`))
    return {
      bounds: [corner(0, H), corner(W, H), corner(W, 0), corner(0, 0)],
      n: use.length,
      worstFt: Math.round(worst * 10) / 10,
      rmsFt: Math.round(Math.sqrt(res.reduce((t, r) => t + r * r, 0) / res.length) * 10) / 10,
      feetPerInch: Math.round(fpi * 100) / 100,
      turnDeg: Math.round((Math.atan2(m.b, m.a) * 180 / Math.PI) * 100) / 100,
      assumedUp: !free,
      what: points.size >= 2 ? `${points.size} control points` : `${use.length} grid ticks`,
    }
  }
  return null
}

/** The same label read twice (text layer + SHX) counts once. */
function dedupe(obs: GridObs[]): GridObs[] {
  const out: GridObs[] = []
  for (const o of obs) {
    if (!out.some((p) => p.kind === o.kind && p.value === o.value && Math.hypot(p.x - o.x, p.y - o.y) < 4)) out.push(o)
  }
  return out
}
