/**
 * Harness for lib/plans/title-block.ts — reading a plan sheet's number,
 * title, revision, date and stated scale off its own words.
 *
 *   node scripts/title-block-test.mjs
 *
 * Synthetic sheets laid out the way civil sets are (a title strip down the
 * right edge, a vertical one, a bottom one), full of look-alikes the reader
 * must NOT pick (structure labels CB-1…CB-6, MH-3, boring B-1, control point
 * CP-1, "SEE SHEET C-102" in the drawing), plus the real fixture PDF the
 * plan reader is tested on, parsed by pdf.js. Run it after ANY change to
 * lib/plans/title-block.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildPlanPdf } from './plan-pdf-fixture.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
function transpile(rel, deps = {}) {
  let src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [spec, url] of Object.entries(deps)) src = src.replaceAll(`from '${spec}'`, `from '${url}'`)
  return dataUrl(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}
const tb = await import(transpile('../lib/plans/title-block.ts'))
const pv = await import(transpile('../lib/dirt/pdf-vectors.ts'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

// A word the way pdf-vectors hands them over: centre, angle, size, length.
const w = (str, x, y, size, angle = 0) => ({ str, x, y, angle, size, len: str.length * size * 0.6, src: 'text' })
const PAGE = { width: 2592, height: 1728 } // 36 × 24 in

// ── A: right-edge title strip, revision table, look-alikes in the drawing ──
{
  const words = [
    w('SHEET', 2440, 210, 10), w('C-101', 2440, 150, 36),
    w('GRADING AND DRAINAGE PLAN', 2440, 320, 16),
    w('SCALE: 1" = 30\'', 2440, 420, 9),
    w('REV 1', 2400, 560, 8), w('10/02/2026 ADDENDUM 1', 2480, 560, 8),
    w('REV 2', 2400, 580, 8), w('10/20/2026 REVISED PER CITY COMMENTS', 2500, 580, 8),
    w('DATE: 09/15/2026', 2440, 650, 9),
    w('PROJECT: CREEKSIDE COMMONS', 2440, 700, 10),
    ...[1, 2, 3, 4, 5, 6].map((i) => w(`CB-${i}`, 300 + i * 180, 500 + (i % 3) * 90, 8)),
    w('MH-3', 900, 900, 8), w('B-1', 1200, 300, 8), w('CP-1', 400, 1300, 8),
    w('SEE SHEET C-102 FOR UTILITIES', 1000, 1500, 8),
    w('FG 812.45', 700, 700, 7), w('INV 805.10', 760, 760, 7),
    w('GRADING LEGEND', 1800, 1600, 10),
  ]
  const r = tb.readTitleBlock(words, PAGE)
  eq(r.number, 'C-101', 'A number')
  eq(r.discipline, 'C', 'A discipline')
  eq(r.title, 'GRADING AND DRAINAGE PLAN', 'A title')
  eq(r.rev, '2', 'A newest revision')
  eq(r.date, '2026-10-20', 'A newest date')
  eq(r.feetPerInch, 30, 'A scale feet per inch')
  ok(r.confidence >= 0.6, `A confidence high (${r.confidence})`)
}

// ── B: vertical title strip (text rotated 90°) ──
{
  const up = Math.PI / 2
  const words = [
    w('L-100', 2550, 300, 30, up), w('LANDSCAPE PLAN', 2550, 600, 14, up),
    w('SCALE 1 INCH = 40 FEET', 2510, 600, 8, up),
    w('MH-1', 800, 800, 8), w('MH-2', 900, 820, 8), w('TREE PROTECTION', 600, 600, 9),
  ]
  const r = tb.readTitleBlock(words, PAGE)
  eq(r.number, 'L-100', 'B vertical number')
  eq(r.title, 'LANDSCAPE PLAN', 'B vertical title')
  eq(r.feetPerInch, 40, 'B "1 INCH = 40 FEET"')
}

// ── C: bottom strip, dotted number, month-name date, no rev ──
{
  const words = [
    w('SHEET NO.', 2300, 90, 9), w('C3.0', 2300, 50, 28),
    w('OVERALL SITE PLAN', 1900, 60, 15),
    w('NOVEMBER 3, 2026', 1500, 60, 9),
    w('1" = 50\'', 1700, 40, 8),
    w('TP-1', 900, 900, 8), w('TP-2', 950, 950, 8),
  ]
  const r = tb.readTitleBlock(words, PAGE)
  eq(r.number, 'C3.0', 'C dotted number kept as printed')
  eq(r.title, 'OVERALL SITE PLAN', 'C title')
  eq(r.date, '2026-11-03', 'C month-name date')
  eq(r.rev, null, 'C no revision')
  eq(r.feetPerInch, 50, 'C bare scale')
}

// ── D: a scanned sheet has no words → nothing guessed ──
{
  const r = tb.readTitleBlock([], PAGE)
  eq(r.number, null, 'D scanned: no number')
  eq(r.confidence, 0, 'D scanned: zero confidence')
}

// ── E: only structure labels on the page → no number invented ──
{
  const words = [...[1, 2, 3, 4, 5].map((i) => w(`CB-${i}`, 400 + i * 100, 400, 8)), w('MH-9', 2450, 150, 8)]
  const r = tb.readTitleBlock(words, PAGE)
  ok(r.number === null || r.confidence < 0.4, `E look-alikes only: ${r.number} @ ${r.confidence}`)
}

// ── Helpers ──
eq(tb.sheetKey('c - 101'), 'C101', 'sheetKey normalizes')
eq(tb.sheetKey('C-101'), tb.sheetKey('C101'), 'C-101 = C101')
eq(tb.readScale('SCALE: 1"=40\'-0"')?.feetPerInch, 40, 'scale with -0"')
eq(tb.readScale('HORIZ: 1" = 20\'  VERT: 1" = 2\'')?.feetPerInch, 20, 'profile: horizontal first')
eq(tb.readScale('NTS'), null, 'NTS has no scale')
eq(tb.datesIn('ISSUED 3/5/26').join(), '2026-03-05', 'short year')
eq(tb.datesIn('13/40/2026').length, 0, 'impossible date rejected')
eq(tb.revsIn('REV. NO. 3 · REVISION B').join(), '3,B', 'revision marks')
{
  const a = [w('C-101', 2440, 150, 36), w('DATE: 09/15/2026', 2440, 650, 9), w('FG 812.45', 700, 700, 7)]
  const b = [w('C-101', 2440, 150, 36), w('DATE: 10/20/2026', 2440, 650, 9), w('FG 812.45', 700, 700, 7)]
  const c = [w('C-101', 2440, 150, 36), w('DATE: 10/20/2026', 2440, 650, 9), w('FG 813.00', 700, 700, 7)]
  eq(tb.drawingSignature(a, PAGE), tb.drawingSignature(b, PAGE), 'signature ignores the title block (date change only)')
  ok(tb.drawingSignature(a, PAGE) !== tb.drawingSignature(c, PAGE), 'signature sees a changed spot grade')
}

// ── F: the real fixture PDF, through pdf.js ──
{
  const pdfjs = await import(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
  const geomUrl = transpile('../lib/dirt/geom.ts')
  const pr = await import(transpile('../lib/dirt/plan-read.ts', { './geom': geomUrl }))
  const { bytes } = buildPlanPdf(pr.chainLines)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const words = pv.textFromContent((await page.getTextContent()).items)
  const r = tb.readTitleBlock(words, { width: vp.width, height: vp.height })
  eq(r.number, 'C-3.0', 'F fixture PDF number')
  eq(r.title, 'GRADING PLAN', 'F fixture PDF title')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
