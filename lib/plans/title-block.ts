/**
 * Reading a plan sheet's title block — pure.
 *
 * The plan room (Brian, Nov 7: "versions of pdf plans … selectable pages,
 * versions") files every page of an uploaded set under its SHEET NUMBER, so
 * Rev 2 of C-101 lands on top of Rev 1 instead of beside it. This reads the
 * number, title, revision, date and stated scale off the page's own words
 * (pdf.js text layer + AutoCAD SHX notes, lib/dirt/pdf-vectors.ts).
 *
 * Every answer is a SUGGESTION the review screen shows editable: a scanned
 * page has no words and reads nothing, which is fine — the person types it.
 *
 * Where title blocks live: a strip down the right edge (most civil sets) or
 * across the bottom; the sheet number is the biggest short code in there.
 * The same page is full of look-alikes — structure labels (CB-1, MH-3),
 * borings (B-2), control points (CP-1) — which sit in the drawing, not in the
 * title block, and use plan-sized text. Position and size do the sorting.
 */

import type { PdfText } from '../dirt/pdf-vectors'

export interface TitleBlock {
  /** "C-101", "C3.0", "L-100" — null when nothing reads like one. */
  number: string | null
  /** The discipline letters off the number: "C", "CS", "L". */
  discipline: string | null
  /** "GRADING PLAN" — the best keyword line near the number. */
  title: string | null
  /** The newest revision mark found ("2", "B"), null when none. */
  rev: string | null
  /** The newest date in the title block, ISO yyyy-mm-dd. */
  date: string | null
  /** As printed: 1" = 30'. */
  scaleText: string | null
  /** Feet per inch of paper from the stated scale (30 for 1" = 30'). */
  feetPerInch: number | null
  /** 0..1 — how sure the number pick is. */
  confidence: number
}

export interface PageSize { width: number; height: number }

// Prefixes that label THINGS on a drawing, never sheets.
const THING_PREFIXES = new Set([
  'MH', 'CB', 'DI', 'YI', 'JB', 'HW', 'FES', 'B', 'TP', 'WM', 'FH', 'GV', 'IPF', 'IPS', 'CP', 'BM', 'STA',
  'PC', 'PT', 'PI', 'TW', 'BW', 'TC', 'BC', 'FG', 'FF', 'FFE', 'EL', 'INV', 'SS', 'SD', 'WV', 'RCP', 'HDPE',
  'PVC', 'DIP', 'CMP', 'ADS', 'NO', 'N', 'S', 'E', 'W', 'R', 'LF', 'SF', 'SY', 'CY', 'EA', 'AC', 'HP', 'LP',
  'GS', 'TOP', 'BOT', 'ME', 'POB', 'POC', 'TBM', 'PP', 'UP', 'LS', 'X', 'Y', 'Z', 'Q', 'V', 'D', 'H',
])
// Discipline prefixes civil/site sets actually use.
const SHEET_PREFIXES = new Set([
  'C', 'CS', 'CG', 'CU', 'CD', 'CE', 'G', 'GN', 'GI', 'L', 'LP', 'LA', 'A', 'AS', 'S', 'M', 'E', 'P', 'U',
  'EC', 'ES', 'ESC', 'SP', 'GR', 'UT', 'T', 'V', 'DM', 'DEMO', 'EX', 'PR', 'PL', 'ST', 'SW', 'W', 'LT', 'PH',
])

const NUMBER_RE = /^([A-Z]{1,4})[-.\s]?(\d{1,3}(?:[.-]\d{1,3})?)([A-Z]?)$/
const SHEET_WORD_RE = /^(SHEET|SHT|DWG|DRAWING)\b/i

const TITLE_WORDS = [
  'PLAN', 'PLANS', 'GRADING', 'UTILITY', 'UTILITIES', 'DETAIL', 'DETAILS', 'SITE', 'LAYOUT', 'LANDSCAPE',
  'DEMOLITION', 'DEMO', 'EXISTING', 'CONDITIONS', 'EROSION', 'SEDIMENT', 'CONTROL', 'STORM', 'SANITARY',
  'SEWER', 'WATER', 'PAVING', 'PAVEMENT', 'PROFILE', 'PROFILES', 'SECTION', 'SECTIONS', 'COVER', 'NOTES',
  'DRAINAGE', 'LIGHTING', 'PHOTOMETRIC', 'SURVEY', 'TOPOGRAPHIC', 'STRIPING', 'SIGNAGE', 'OVERALL',
  'DIMENSION', 'DIMENSIONAL', 'GEOMETRIC', 'STORMWATER', 'POND', 'PLANTING', 'IRRIGATION', 'GENERAL',
  'SPECIFICATIONS', 'TREE', 'PROTECTION', 'CLEARING', 'GRUBBING', 'ROADWAY', 'TYPICAL',
]
const TITLE_SET = new Set(TITLE_WORDS)

type Word = PdfText & { rx: number; ry: number } // reading-frame coordinates

/** Rotate a word into its own reading frame (a vertical title strip reads
 *  like a horizontal one there). */
function toReading(w: PdfText): Word {
  const c = Math.cos(-w.angle), s = Math.sin(-w.angle)
  return { ...w, rx: w.x * c - w.y * s, ry: w.x * s + w.y * c }
}

/** Where the title block is likely to be: right strip, bottom strip, or the
 *  bottom-right corner (strongest). 0.15 elsewhere. */
function regionWeight(x: number, y: number, page: PageSize): number {
  const fx = x / page.width, fy = y / page.height // PDF y runs UP from the bottom
  if (fx > 0.72 && fy < 0.38) return 1
  if (fx > 0.84) return 0.85
  if (fy < 0.13) return 0.6
  return 0.15
}

export function inTitleRegion(x: number, y: number, page: PageSize): boolean {
  return regionWeight(x, y, page) >= 0.6
}

/** Join words that sit on one line (same angle, same baseline, close gaps). */
export function lines(words: PdfText[]): { str: string; x: number; y: number; size: number; angle: number; words: PdfText[] }[] {
  const ws = words.map(toReading).sort((a, b) => (b.ry - a.ry) || (a.rx - b.rx))
  const out: { str: string; x: number; y: number; size: number; angle: number; words: PdfText[]; rx1: number; ry: number }[] = []
  for (const w of ws) {
    const prev = out.find((l) =>
      Math.abs(l.angle - w.angle) < 0.05 && Math.abs(l.ry - w.ry) < 0.6 * Math.max(l.size, w.size) &&
      w.rx - l.rx1 < 2.2 * Math.max(l.size, w.size) && w.rx - l.rx1 > -0.5 * w.size &&
      Math.abs(l.size - w.size) < 0.35 * Math.max(l.size, w.size))
    if (prev) {
      prev.str += ' ' + w.str
      prev.rx1 = w.rx + w.len / 2
      prev.words.push(w)
      prev.x = (prev.x + w.x) / 2; prev.y = (prev.y + w.y) / 2
    } else {
      out.push({ str: w.str, x: w.x, y: w.y, size: w.size, angle: w.angle, words: [w], rx1: w.rx + w.len / 2, ry: w.ry })
    }
  }
  return out.map(({ str, x, y, size, angle, words: lw }) => ({ str: str.replace(/\s+/g, ' ').trim(), x, y, size, angle, words: lw }))
}

function numberCandidates(words: PdfText[], page: PageSize): { number: string; prefix: string; score: number; w: PdfText }[] {
  const all = lines(words)
  const out: { number: string; prefix: string; score: number; w: PdfText }[] = []
  // How often each normalized code appears on the page — a sheet number is
  // printed once or twice; a structure label pattern repeats in families.
  const seen = new Map<string, number>()
  const cands: { number: string; prefix: string; size: number; x: number; y: number; w: PdfText; sheetWord: boolean }[] = []
  for (const l of all) {
    const tokens = l.str.toUpperCase().replace(/[,;()]/g, ' ').split(/\s+/)
    const sheetWord = SHEET_WORD_RE.test(l.str)
    for (let i = 0; i < tokens.length; i++) {
      // "C - 101" printed as three tokens
      let t = tokens[i]
      if (/^[A-Z]{1,4}$/.test(t) && tokens[i + 1] === '-' && /^\d/.test(tokens[i + 2] ?? '')) t = `${t}-${tokens[i + 2]}`
      const m = NUMBER_RE.exec(t)
      if (!m) continue
      const prefix = m[1]
      // Kept as printed ("C-101", "C3.0"); sheetKey() is what matches.
      const norm = t
      seen.set(sheetKey(norm), (seen.get(sheetKey(norm)) ?? 0) + 1)
      cands.push({ number: norm, prefix, size: l.size, x: l.x, y: l.y, w: l.words[0], sheetWord })
    }
  }
  const prefixFamily = new Map<string, number>()
  for (const c of cands) prefixFamily.set(c.prefix, (prefixFamily.get(c.prefix) ?? 0) + 1)
  // The biggest text on the page sets the scale for "big".
  const maxSize = Math.max(1, ...words.map((w) => w.size))
  for (const c of cands) {
    let score = (c.size / maxSize) * regionWeight(c.x, c.y, page)
    if (THING_PREFIXES.has(c.prefix)) score *= 0.08
    if (SHEET_PREFIXES.has(c.prefix)) score *= 1.4
    if (c.sheetWord) score *= 1.6
    // A family of five CB-1 … CB-5 is structures, not sheets.
    if ((prefixFamily.get(c.prefix) ?? 0) >= 5 && regionWeight(c.x, c.y, page) < 0.6) score *= 0.3
    if ((seen.get(sheetKey(c.number)) ?? 0) > 3) score *= 0.5
    // A word "SHEET" just above / beside the code.
    const near = words.some((w) => SHEET_WORD_RE.test(w.str) && Math.hypot(w.x - c.x, w.y - c.y) < 6 * Math.max(c.size, w.size))
    if (near) score *= 1.4
    out.push({ number: c.number, prefix: c.prefix, score, w: c.w })
  }
  return out.sort((a, b) => b.score - a.score)
}

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 }

/** Every date written on a line, ISO. Two-digit years read as 20xx. */
export function datesIn(s: string): string[] {
  const out: string[] = []
  const iso = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  for (const m of Array.from(s.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g))) iso(Number(m[3]), Number(m[1]), Number(m[2]))
  for (const m of Array.from(s.matchAll(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi))) {
    iso(Number(m[3]), MONTHS[m[1].toUpperCase()] ?? 0, Number(m[2]))
  }
  return out
}

/** "1" = 30'" / "1 INCH = 30 FEET" / "SCALE: 1"=40'-0"" → feet per inch. */
export function readScale(s: string): { text: string; feetPerInch: number } | null {
  const t = s.replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'")
  const m = /\b1\s*(?:"|''|IN\.?|INCH(?:ES)?)\s*=\s*(\d{1,4}(?:\.\d+)?)\s*(?:'|FT\.?|FEET)/i.exec(t)
  if (!m) return null
  const fpi = Number(m[1])
  if (!(fpi > 0 && fpi <= 2000)) return null
  return { text: `1" = ${m[1]}'`, feetPerInch: fpi }
}

/** Revision marks: "REV 2", "REVISION B", "REV. NO. 3". The newest wins. */
export function revsIn(s: string): string[] {
  const out: string[] = []
  for (const m of Array.from(s.matchAll(/\bREV(?:ISION)?\.?\s*(?:NO\.?\s*)?[:#]?\s*([0-9]{1,2}|[A-H])\b/gi))) out.push(m[1].toUpperCase())
  return out
}

function newestRev(revs: string[]): string | null {
  if (!revs.length) return null
  const nums = revs.filter((r) => /^\d+$/.test(r)).map(Number)
  if (nums.length) return String(Math.max(...nums))
  return revs.sort().slice(-1)[0]
}

export function readTitleBlock(words: PdfText[], page: PageSize): TitleBlock {
  const empty: TitleBlock = { number: null, discipline: null, title: null, rev: null, date: null, scaleText: null, feetPerInch: null, confidence: 0 }
  if (!words.length || !(page.width > 0 && page.height > 0)) return empty

  const cands = numberCandidates(words, page)
  const best = cands[0]
  const second = cands.find((c) => c.number !== best?.number)
  const number = best && best.score > 0.12 ? best.number : null
  // Clear of the runner-up AND big in a title-block spot = sure.
  const confidence = number && best ? Math.max(0, Math.min(1, (best.score / (best.score + (second?.score ?? 0))) * Math.min(1, best.score / 0.45))) : 0

  const all = lines(words)
  const tb = all.filter((l) => inTitleRegion(l.x, l.y, page))

  // Title: the keyword-heaviest big line in the title block, nearest the number.
  let title: string | null = null
  let titleScore = 0
  for (const l of tb) {
    const tokens = l.str.toUpperCase().split(/[^A-Z]+/).filter(Boolean)
    const hits = tokens.filter((t) => TITLE_SET.has(t)).length
    if (!hits || tokens.length > 9 || /\b(SCALE|DATE|DRAWN|CHECKED|PROJECT|JOB|REV|SHEET)\b/i.test(l.str)) continue
    let s = hits * l.size * (hits / tokens.length + 0.5)
    if (best) s /= 1 + Math.hypot(l.x - best.w.x, l.y - best.w.y) / (20 * l.size)
    if (s > titleScore) {
      titleScore = s
      // The number often shares the line ("GRADING PLAN  C-3.0") — not part of the title.
      const cleaned = l.str.toUpperCase().split(/\s+/).filter((t) => !best || sheetKey(t) !== sheetKey(best.number)).join(' ').trim()
      title = cleaned || null
    }
  }

  const tbText = tb.map((l) => l.str).join('\n')
  const dates = datesIn(tbText).sort()
  const date = dates.length ? dates[dates.length - 1] : null
  const rev = newestRev(revsIn(tbText))

  // Scale anywhere on the sheet (often under each view); the title block's wins.
  const scaleLine = tb.map((l) => readScale(l.str)).find(Boolean) ?? all.map((l) => readScale(l.str)).find(Boolean) ?? null

  const discipline = number ? (/^([A-Z]+)/.exec(number)?.[1] ?? null) : null
  return { number, discipline, title, rev, date, scaleText: scaleLine?.text ?? null, feetPerInch: scaleLine?.feetPerInch ?? null, confidence: Math.round(confidence * 100) / 100 }
}

/**
 * What decides "unchanged": every word outside the title block, placed to the
 * nearest point. A re-issued sheet carries a new date and revision in its
 * title block; if nothing else moved, it is the same drawing. The caller
 * hashes the string (crypto.subtle in the browser).
 */
export function drawingSignature(words: PdfText[], page: PageSize): string {
  return words
    .filter((w) => !inTitleRegion(w.x, w.y, page))
    .map((w) => `${Math.round(w.x)},${Math.round(w.y)},${w.str}`)
    .sort()
    .join('|')
}

/** "C-101" and "C101" and "c 101" are the same sheet. */
export function sheetKey(number: string): string {
  return number.toUpperCase().replace(/[\s-]+/g, '')
}
