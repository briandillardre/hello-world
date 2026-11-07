/**
 * A plan page's fingerprint, ink box and viewed geometry — pure.
 *
 * The plan room's review screen (migration 143) tells a re-issued sheet that
 * changed from one that did not: engineers re-plot the whole set for an
 * addendum, and a sheet whose only change is the date and the revision mark
 * must not pile up a version. So the fingerprint covers what is DRAWN —
 * every stroke and word — outside the title block, where those two live.
 *
 * Everything here works in VIEWED space: the page the way it shows on screen
 * at scale 1 (points, y up from the bottom edge), after the PDF's own /Rotate.
 * The title-block reader thinks in that frame too (a right-edge strip is on
 * the right as you look at the sheet), and the placement carry-over compares
 * page sizes the way they print.
 */

import type { PdfLine, PdfText } from '../dirt/pdf-vectors'
import { inTitleRegion, type PageSize } from './title-block'

/** pdf.js viewport.transform at scale 1: user space → viewed pixels, y down. */
export type ViewTransform = [number, number, number, number, number, number]

/** Words into viewed space (y up), reading direction included. */
export function wordsToViewed(words: PdfText[], t: ViewTransform, viewH: number): PdfText[] {
  const [a, b, c, d, e, f] = t
  return words.map((w) => {
    const vx = a * w.x + c * w.y + e
    const vy = b * w.x + d * w.y + f
    const dx = Math.cos(w.angle), dy = Math.sin(w.angle)
    const ux = a * dx + c * dy, uy = b * dx + d * dy
    return { ...w, x: vx, y: viewH - vy, angle: Math.atan2(-uy, ux) }
  })
}

/** Stroked lines into viewed space (y up). */
export function linesToViewed(lines: PdfLine[], t: ViewTransform, viewH: number): PdfLine[] {
  const [a, b, c, d, e, f] = t
  return lines.map((l) => {
    const pts = new Array<number>(l.pts.length)
    for (let i = 0; i < l.pts.length; i += 2) {
      const x = l.pts[i], y = l.pts[i + 1]
      pts[i] = a * x + c * y + e
      pts[i + 1] = viewH - (b * x + d * y + f)
    }
    return { ...l, pts }
  })
}

/** Below this much vector content the page is a scan (or a cover with a
 *  picture): no fingerprint, so it can never read as "unchanged". */
const MIN_STROKES = 20
const MIN_WORDS = 5

/**
 * The text the fingerprint hashes: every word and every stroke that is not
 * wholly inside the title block, rounded to the point, sorted (drawing order
 * is not drawing content). Pens ride along by their look (colour, width,
 * dash), never by id — ids follow the order a PDF happens to use them in.
 * null when the page has too little vector content to fingerprint.
 */
export function fingerprintSource(
  words: PdfText[],
  lines: PdfLine[],
  pens: { id: number; color: string; width: number; dash: string }[],
  page: PageSize,
): string | null {
  if (lines.length < MIN_STROKES && words.length < MIN_WORDS) return null
  const penKey = new Map(pens.map((p) => [p.id, `${p.color}/${p.width}/${p.dash}`]))
  const parts: string[] = []
  for (const w of words) {
    if (inTitleRegion(w.x, w.y, page)) continue
    parts.push(`t${Math.round(w.x)},${Math.round(w.y)},${w.str}`)
  }
  for (const l of lines) {
    let outside = false
    for (let i = 0; i < l.pts.length; i += 2) {
      if (!inTitleRegion(l.pts[i], l.pts[i + 1], page)) { outside = true; break }
    }
    if (!outside) continue
    let s = `l${penKey.get(l.pen) ?? '?'}${l.closed ? 'z' : ''}:`
    for (let i = 0; i < l.pts.length; i += 2) s += `${Math.round(l.pts[i])},${Math.round(l.pts[i + 1])};`
    parts.push(s)
  }
  if (!parts.length) return null
  parts.sort()
  return parts.join('|')
}

/** SHA-256 hex of a string (browser and Node 18+). */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The box the linework fills on the page (viewed points, x0 y0 x1 y1),
 *  clamped to the page. null for a page with no strokes. */
export function inkBox(lines: PdfLine[], page: PageSize): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const l of lines) {
    for (let i = 0; i < l.pts.length; i += 2) {
      const x = Math.min(page.width, Math.max(0, l.pts[i]))
      const y = Math.min(page.height, Math.max(0, l.pts[i + 1]))
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (!Number.isFinite(x0) || x1 - x0 < 1 || y1 - y0 < 1) return null
  const r = (v: number) => Math.round(v * 10) / 10
  return [r(x0), r(y0), r(x1), r(y1)]
}

export interface PlotShape {
  pageW: number | null
  pageH: number | null
  inkBox: number[] | null
}

/**
 * Can a new version take the old one's place on the map with no clicks?
 *   exact — same paper and the linework fills the same box: the engineer
 *           re-plotted on the same sheet with the same origin (the usual case)
 *   check — same paper, but the drawing moved or the box is unknown: carry it
 *           and ask the person to look
 *   none  — different paper; it has to be placed again
 */
export function carryRule(prev: PlotShape, next: PlotShape): 'exact' | 'check' | 'none' {
  if (prev.pageW == null || prev.pageH == null || next.pageW == null || next.pageH == null) return 'none'
  if (Math.abs(prev.pageW - next.pageW) > 1 || Math.abs(prev.pageH - next.pageH) > 1) return 'none'
  const a = prev.inkBox, b = next.inkBox
  if (a && b && a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) <= 2)) return 'exact'
  return 'check'
}
