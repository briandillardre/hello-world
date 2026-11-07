/**
 * Harness for the plan room's rules (lib/plans/room.ts) and the page
 * fingerprint (lib/plans/fingerprint.ts) — migration 143.
 *
 *   node scripts/plan-room-test.mjs
 *
 * Current / superseded / held / NEW, the map's version-on-a-day, the review
 * screen's verdicts, sheet ordering, and the fingerprint on the REAL fixture
 * PDF through pdf.js: a re-issue that only changes the title block must read
 * as the same drawing, a new line in the drawing must not, and the same plot
 * must carry its placement with no clicks. Run it after ANY change to either.
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
const tbUrl = transpile('../lib/plans/title-block.ts')
const R = await import(transpile('../lib/plans/room.ts'))
const F = await import(transpile('../lib/plans/fingerprint.ts', { './title-block': tbUrl }))
const TB = await import(tbUrl)
const PV = await import(transpile('../lib/dirt/pdf-vectors.ts'))
const N = await import(transpile('../lib/plans/north.ts'))
const C = await import(transpile('../lib/plans/compare.ts'))
const SP = await import(transpile('../lib/plans/stateplane.ts'))
const GF = await import(transpile('../lib/plans/gridfit.ts', { './title-block': tbUrl, './stateplane': transpile('../lib/plans/stateplane.ts') }))
const SC = await import(transpile('../lib/plans/scale.ts', { './title-block': tbUrl }))
const CR = await import(transpile('../lib/plans/crop.ts'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const V = (id, issuedOn, createdAt, extra = {}) => ({
  id, sheetId: 's1', setId: null, fileId: null, imageId: null, page: 1, rev: null, issuedOn, createdAt,
  createdBy: 'u-office', signature: null, pageW: 2592, pageH: 1728, inkBox: null, feetPerInch: null,
  scaleText: null, placement: null, crop: null, ...extra,
})

// ── current / superseded / held ──
{
  const v0 = V('v0', '2026-08-12', '2026-08-12T10:00:00Z', { rev: '0' })
  const v1 = V('v1', '2026-08-20', '2026-08-20T09:00:00Z', { rev: '1' })
  const v2 = V('v2', '2026-09-30', '2026-09-30T09:00:00Z', { rev: '2' })
  const all = [v1, v0, v2]
  const sheet = { pinnedVersionId: null }
  eq(R.currentOf(sheet, all)?.id, 'v2', 'newest issued is current')
  eq(R.statusOf(v2, sheet, all), { kind: 'current', pinned: false }, 'v2 current')
  eq(R.statusOf(v0, sheet, all).by?.id, 'v1', 'Rev 0 superseded BY Rev 1 (the next one up), not by the current')
  eq(R.statusOf(v1, sheet, all).by?.id, 'v2', 'Rev 1 superseded by Rev 2')
  const pinned = { pinnedVersionId: 'v1' }
  eq(R.currentOf(pinned, all)?.id, 'v1', 'a pin wins')
  eq(R.statusOf(v1, pinned, all), { kind: 'current', pinned: true }, 'pinned current says pinned')
  eq(R.statusOf(v2, pinned, all).kind, 'held', 'newer than the pin = held')
  eq(R.statusOf(v0, pinned, all).by?.id, 'v1', 'older than the pin = superseded by the pin')
  eq(R.currentOf({ pinnedVersionId: 'gone' }, all)?.id, 'v2', 'a pin to a deleted version falls back to the newest')
  eq(R.currentOf(sheet, []), null, 'no versions = no current')
  // Same issue date: the later upload wins.
  const a = V('a', '2026-10-01', '2026-10-01T08:00:00Z'), b = V('b', '2026-10-01', '2026-10-01T09:00:00Z')
  eq(R.currentOf(sheet, [a, b])?.id, 'b', 'same date: later upload is current')
  // The map's timeline ignores the pin and looks at what was issued by then.
  eq(R.currentOn('2026-08-19', all)?.id, 'v0', 'Aug 19 → Rev 0')
  eq(R.currentOn('2026-08-20', all)?.id, 'v1', 'Aug 20 → Rev 1 (issued that day)')
  eq(R.currentOn('2026-12-01', all)?.id, 'v2', 'later → Rev 2')
  eq(R.currentOn('2026-08-01', all), null, 'before the first issue → nothing')
}

// ── NEW ──
{
  const cur = V('v9', '2026-11-01', '2026-11-01T00:00:00Z', { createdBy: 'u-office' })
  ok(R.isNewFor('u-field', cur, null), 'never opened, someone else uploaded → NEW')
  ok(!R.isNewFor('u-field', cur, 'v9'), 'opened it → not new')
  ok(R.isNewFor('u-field', cur, 'v8'), 'opened an older version → NEW again')
  ok(!R.isNewFor('u-office', cur, null), 'your own upload is never new to you')
  ok(!R.isNewFor('u-field', { ...cur, createdBy: null }, null), 'adopted pre-plan-room sheets are never new')
  ok(!R.isNewFor(null, cur, null), 'no viewer → no dot')
}

// ── labels, order ──
eq(R.revLabel('2'), 'Rev 2', 'rev label')
eq(R.revLabel(null), 'No rev', 'no rev label')
eq(R.disciplineOf('C-101'), 'C', 'discipline C')
eq(R.disciplineOf('CG3.0'), 'CG', 'discipline CG')
eq(R.disciplineOf('101'), null, 'no letters')
eq(R.disciplineName(null, 'P-3'), 'Other sheets', 'placeholder P-sheets file under Other')
eq(R.disciplineName('L', 'L-100'), 'Landscape', 'L = Landscape')
eq(R.compareSheetNumbers('C-2', 'C-10') < 0, true, 'C-2 before C-10')
eq(R.compareSheetNumbers('C1.1', 'C1.0') > 0, true, 'C1.0 before C1.1')
eq(R.compareSheetNumbers('C2.0', 'C10.0') < 0, true, 'C2.0 before C10.0')
{
  const g = R.groupSheets([
    { number: 'L-100', discipline: 'L' }, { number: 'C-102', discipline: 'C' }, { number: 'P-1', discipline: null },
    { number: 'C-10', discipline: 'C' }, { number: 'G-001', discipline: 'G' }, { number: 'C-9', discipline: 'C' },
  ])
  eq(g.map((x) => x.name), ['General', 'Civil', 'Landscape', 'Other sheets'], 'binding order of groups')
  eq(g[1].sheets.map((s) => s.number), ['C-9', 'C-10', 'C-102'], 'natural order inside a group')
}
eq(R.cleanNumber('  c-101 '), 'C-101', 'clean number')
eq(R.cleanNumber('C 101'), 'C 101', 'spaces kept as printed')
eq(R.numberKey('C 101'), R.numberKey('C-101'), 'C 101 = C-101')
eq(R.cleanNumber(''), null, 'empty refused')
eq(R.cleanNumber('<script>'), null, 'junk refused')
eq(R.cleanNumber('X'.repeat(25)), null, 'too long refused')
eq(R.nextRev('0'), '1', 'next rev 0 → 1')
eq(R.nextRev('B'), 'C', 'next rev B → C')
eq(R.nextRev(null), '1', 'no rev → 1')
eq(R.nextRev('1A'), null, 'odd marks stay blank')
eq(R.commonDate(['2026-09-01', '2026-09-01', null, '2026-08-01']), '2026-09-01', 'common date')
eq(R.commonDate(['2026-09-01', '2026-10-01']), '2026-10-01', 'tie → newest')
eq(R.commonDate([null, null]), null, 'no dates')
ok(R.isFullIssue('ifc') && !R.isFullIssue('addendum'), 'IFC is a full issue, an addendum is not')

// ── verdicts ──
{
  const sheets = [{ id: 's1', numberKey: 'C101', pinnedVersionId: null }, { id: 's2', numberKey: 'C102', pinnedVersionId: null }]
  const bySheet = new Map([
    ['s1', [V('a0', '2026-08-12', '2026-08-12T00:00:00Z', { signature: 'sigA', rev: '0' })]],
    ['s2', [V('b0', '2026-09-01', '2026-09-01T00:00:00Z', { signature: 'sigB', rev: '1', sheetId: 's2' })]],
  ])
  eq(R.verdictFor({ number: 'C-103', signature: 'x' }, '2026-08-20', sheets, bySheet).kind, 'new', 'unknown number → new')
  const rv = R.verdictFor({ number: 'C 101', signature: 'sigA2' }, '2026-08-20', sheets, bySheet)
  eq([rv.kind, rv.from?.id], ['revises', 'a0'], 'changed drawing → revises the current')
  eq(R.verdictFor({ number: 'C-101', signature: 'sigA' }, '2026-08-20', sheets, bySheet).kind, 'unchanged', 'same fingerprint → unchanged')
  eq(R.verdictFor({ number: 'C-101', signature: null }, '2026-08-20', sheets, bySheet).kind, 'revises', 'a scan (no fingerprint) is never unchanged')
  eq(R.verdictFor({ number: 'C-102', signature: 'old' }, '2026-08-01', sheets, bySheet).kind, 'older', 'issued before the current → files behind it')
  eq(R.verdictFor({ number: null, signature: 'z' }, '2026-08-20', sheets, bySheet).kind, 'not-sheet', 'no number → not a sheet')
  // Rev 1 pinned, Rev 2 held: the Addendum 2 PDF uploaded again is the held
  // drawing — unchanged, never a third copy that would release the pin.
  const pinSheets = [{ id: 's3', numberKey: 'C103', pinnedVersionId: 'c1' }]
  const pinVs = new Map([['s3', [
    V('c0', '2026-08-01', '2026-08-01T00:00:00Z', { signature: 'sig0', rev: '0', sheetId: 's3' }),
    V('c1', '2026-09-01', '2026-09-01T00:00:00Z', { signature: 'sig1', rev: '1', sheetId: 's3' }),
    V('c2', '2026-10-01', '2026-10-01T00:00:00Z', { signature: 'sig2', rev: '2', sheetId: 's3' }),
  ]]])
  const held = R.verdictFor({ number: 'C-103', signature: 'sig2' }, '2026-10-01', pinSheets, pinVs)
  eq([held.kind, held.same?.id], ['unchanged', 'c2'], 'the held revision again → unchanged')
  const again = R.verdictFor({ number: 'C-103', signature: 'sig0' }, '2026-08-01', pinSheets, pinVs)
  eq([again.kind, again.same?.id], ['unchanged', 'c0'], 'an old set uploaded again → unchanged, no duplicate in the history')
  eq(R.verdictFor({ number: 'C-103', signature: 'sig0' }, '2026-11-01', pinSheets, pinVs).kind, 'revises', 'Rev 0’s drawing under a new date is a revert — a real revision')
}

// ── carry rule ──
eq(F.carryRule({ pageW: 2592, pageH: 1728, inkBox: [20, 20, 2572, 1708] }, { pageW: 2592.4, pageH: 1728, inkBox: [20, 21, 2572, 1708] }), 'exact', 'same paper + same ink box → exact')
eq(F.carryRule({ pageW: 2592, pageH: 1728, inkBox: [20, 20, 2572, 1708] }, { pageW: 2592, pageH: 1728, inkBox: [60, 20, 2572, 1708] }), 'check', 'same paper, drawing moved → check')
eq(F.carryRule({ pageW: 2592, pageH: 1728, inkBox: null }, { pageW: 2592, pageH: 1728, inkBox: [20, 20, 2572, 1708] }), 'check', 'unknown box → check')
eq(F.carryRule({ pageW: 2592, pageH: 1728, inkBox: null }, { pageW: 1728, pageH: 1296, inkBox: null }), 'none', 'different paper → none')
eq(F.carryRule({ pageW: null, pageH: null, inkBox: null }, { pageW: 1728, pageH: 1296, inkBox: null }), 'none', 'adopted sheet with no size → none')

// ── viewed space ──
{
  // Rotate 90: pdf.js transform for a 100×50 page at scale 1 is [0,1,1,0,0,0] (y down, viewed 50×100).
  const t = [0, 1, 1, 0, 0, 0]
  const [w] = F.wordsToViewed([{ str: 'A', x: 10, y: 20, angle: 0, size: 5, len: 3, src: 'text' }], t, 100)
  eq([w.x, w.y], [20, 90], 'word position into viewed space')
  ok(Math.abs(w.angle + Math.PI / 2) < 1e-9, `reading direction turns with the page (${w.angle})`)
  const [l] = F.linesToViewed([{ pen: 0, pts: [0, 0, 100, 0], closed: false }], t, 100)
  eq(l.pts, [0, 100, 0, 0], 'line into viewed space')
}

// ── north ──
{
  // A sheet placed square to the world: page up = north.
  const lat = 34.85, lng = -82.4
  const sq = [[lng, lat + 0.001], [lng + 0.0012, lat + 0.001], [lng + 0.0012, lat], [lng, lat]]
  ok(Math.abs(N.pageUpBearing(sq)) < 1e-6, `square sheet: page up is north (${N.pageUpBearing(sq)})`)
  // Turned so page up points east.
  const east = [[lng + 0.001, lat + 0.0012], [lng + 0.001, lat], [lng, lat], [lng, lat + 0.0012]]
  ok(Math.abs(N.pageUpBearing(east) - 90) < 0.5, `page up east → 90° (${N.pageUpBearing(east)})`)
  const [u, v] = N.uvOf(sq, [lng + 0.0006, lat + 0.0005])
  ok(Math.abs(u - 0.5) < 0.01 && Math.abs(v - 0.5) < 0.01, `centre of the sheet → uv 0.5, 0.5 (${u}, ${v})`)
  const [u2, v2] = N.uvOf(sq, [lng + 0.0012, lat])
  ok(Math.abs(u2 - 1) < 1e-6 && Math.abs(v2 - 1) < 1e-6, 'BR corner → uv 1, 1')
  ok(N.metresPerUnit(sq, 1000) > 0.1 && N.metresPerUnit(sq, 1000) < 0.12, `metres per page unit (${N.metresPerUnit(sq, 1000)})`)
  ok(Math.abs(N.SC_N - 0.5546) < 0.002, `SC cone constant ≈ sin(33.68°) (${N.SC_N})`)
  const gvl = N.scGridConvergence(-82.4, 34.85), chs = N.scGridConvergence(-79.93, 32.78)
  ok(gvl !== null && gvl < -0.7 && gvl > -0.85, `Greenville grid north ≈ 0.8° west (${gvl})`)
  ok(chs !== null && chs > 0.5 && chs < 0.7, `Charleston grid north ≈ 0.6° east (${chs})`)
  eq(N.scGridConvergence(-84.4, 33.75), null, 'Atlanta is not on the SC grid')
  eq(N.convergenceWords(-0.776), '0.8° west of true north', 'convergence words')
}

// ── compare ──
{
  const W = 120, H = 120
  const page = (draw) => { const px = new Uint8ClampedArray(W * H * 4).fill(255); draw((x, y) => { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0 }); return px }
  const line = (set) => { for (let x = 5; x < 115; x++) { set(x, 20); set(x, 21) } }
  const oldPx = page((set) => line(set))
  const newPx = page((set) => { line(set); for (let y = 80; y < 95; y++) for (let x = 70; x < 90; x++) set(x, y) })
  const out = new Uint8ClampedArray(W * H * 4)
  C.composite(oldPx, newPx, out)
  const at = (x, y) => Array.from(out.slice((y * W + x) * 4, (y * W + x) * 4 + 3))
  eq(at(50, 20), [0, 0, 0], 'unchanged ink prints dark')
  eq(at(80, 85), [0, 0, 255], 'new-only ink prints blue')
  eq(at(10, 60), [255, 255, 255], 'paper stays white')
  const out2 = new Uint8ClampedArray(W * H * 4)
  C.composite(newPx, oldPx, out2)
  eq(Array.from(out2.slice((85 * W + 80) * 4, (85 * W + 80) * 4 + 3)), [255, 0, 0], 'old-only ink prints red')
  const boxes = C.changeBoxes(oldPx, newPx, W, H, 12)
  eq(boxes.length, 1, 'one change cloud')
  ok(boxes[0] && boxes[0].x0 <= 70 && boxes[0].x1 >= 90 && boxes[0].y0 <= 80 && boxes[0].y1 >= 95, `cloud rings the new block (${JSON.stringify(boxes[0])})`)
  eq(C.changeBoxes(oldPx, oldPx, W, H, 12).length, 0, 'identical pages: no clouds')
  // Two far-apart changes, reading order.
  const two = page((set) => { line(set); for (let y = 90; y < 100; y++) for (let x = 10; x < 20; x++) set(x, y); for (let y = 40; y < 50; y++) for (let x = 95; x < 105; x++) set(x, y) })
  const tb = C.changeBoxes(oldPx, two, W, H, 12)
  eq(tb.length, 2, 'two clouds')
  ok(tb[0].y0 < tb[1].y0, 'top one first')
}

// ── SC State Plane (reference values from proj4, EPSG:2273 international feet) ──
{
  const near = (a, b, tol) => Math.abs(a - b) <= tol
  const g = SP.toStatePlane(-82.4, 34.85)
  ok(near(g[0], 1579943.986, 0.01) && near(g[1], 1100467.230, 0.01), `Greenville → E ${g[0].toFixed(3)} N ${g[1].toFixed(3)}`)
  const c = SP.toStatePlane(-79.93, 32.78)
  ok(near(c[0], 2328844.713, 0.01) && near(c[1], 346147.414, 0.01), `Charleston → E ${c[0].toFixed(3)} N ${c[1].toFixed(3)}`)
  const o = SP.toStatePlane(-81, 31 + 50 / 60)
  ok(near(o[0], 2000000, 1e-6) && near(o[1], 0, 1e-6), 'origin → 2,000,000 / 0')
  ok(near(SP.toStatePlane(-81, 34)[1], 788303.868, 0.01), 'on the central meridian')
  const back = SP.fromStatePlane(1579943.986, 1100467.230)
  ok(near(back[0], -82.4, 1e-9) && near(back[1], 34.85, 1e-9), `round trip (${back})`)
  ok(SP.plausibleSC(1579943, 1100467) && !SP.plausibleSC(5000, 5000), 'an assumed grid is not SC')
}

// ── placing a sheet from its grid ticks ──
{
  const W = 2592, H = 1728 // 36 × 24 in
  const fpi = 30, k = fpi / 72 // feet per point
  const E0 = 1579000, N0 = 1100000 // grid at the page's bottom-left
  const turn = (8 * Math.PI) / 180
  const toGrid = (x, y, t = 0) => [E0 + k * (x * Math.cos(t) - y * Math.sin(t)), N0 + k * (x * Math.sin(t) + y * Math.cos(t))]
  const w = (str, x, y, angle = 0) => ({ str, x, y, angle, size: 8, len: str.length * 4.8, src: 'text' })
  // Ticks every 200 ft along the bottom and left borders, labels at the line.
  const square = []
  for (let e = 1579200; e <= 1580000; e += 200) square.push(w(`E ${e.toLocaleString('en-US')}`, (e - E0) / k, 30))
  for (let n = 1100200; n <= 1100600; n += 200) square.push(w(`N ${n.toLocaleString('en-US')}`, 30, (n - N0) / k))
  const obs = GF.findGridLabels(square)
  eq(obs.length, 8, 'eight tick labels read')
  const fit = GF.fitGrid(obs, { width: W, height: H })
  ok(fit && Math.abs(fit.feetPerInch - 30) < 0.05, `grid ticks imply 1" = 30' (${fit?.feetPerInch})`)
  ok(fit && fit.worstFt < 0.2, `worst tick within 0.2 ft (${fit?.worstFt})`)
  ok(fit && fit.assumedUp, 'labels on one border each cannot fix the turn — grid north assumed up, and said so')
  const want = SP.fromStatePlane(...toGrid(0, H))
  ok(fit && Math.abs(fit.bounds[0][0] - want[0]) < 1e-6 && Math.abs(fit.bounds[0][1] - want[1]) < 1e-6, 'top-left corner lands on the grid')
  // A turned sheet with control points (N and E on one line) spread out.
  const cps = [[300, 300], [2200, 400], [1200, 1500], [600, 1200]].map(([x, y]) => {
    const [e, n] = toGrid(x, y, turn)
    return w(`CP N ${n.toFixed(2)} E ${e.toFixed(2)}`, x, y)
  })
  const fit2 = GF.fitGrid(GF.findGridLabels(cps), { width: W, height: H })
  ok(fit2 && Math.abs(fit2.turnDeg - 8) < 0.01 && !fit2.assumedUp, `control points fix the turn (${fit2?.turnDeg}°)`)
  eq(fit2?.what, '4 control points', 'says what it used')
  // One mistyped label among good ones is dropped, not averaged in.
  const bad = [...square, w('E 1,579,900', ((1579500 - E0) / k), 30)]
  const fit3 = GF.fitGrid(GF.findGridLabels(bad), { width: W, height: H })
  ok(fit3 && fit3.worstFt < 0.2 && fit3.n === 8, `a bad label is dropped (n ${fit3?.n}, worst ${fit3?.worstFt})`)
  eq(GF.fitGrid(GF.findGridLabels([w('N 5000', 10, 10), w('E 5000', 20, 20)]), { width: W, height: H }), null, 'an assumed grid never places a sheet')
  eq(GF.findGridLabels([w('STA 12+50', 100, 100), w('FFE 811.50', 200, 200), w('AREA 1,234,567 SF', 300, 300)]).length, 0, 'stations, elevations and areas are not grid labels')
}

// ── scale checks ──
{
  const w = (str, x, y, size = 8, angle = 0) => ({ str, x, y, angle, size, len: str.length * size * 0.6, src: 'text' })
  // A scale bar 0 · 15 · 30 · 60 at 1" = 30' (2.4 pt per foot).
  const bar = [w('0', 2000, 100), w('15', 2036, 100), w('30', 2072, 100), w('60', 2144, 100), w('SCALE: 1" = 30\'', 2070, 120)]
  const b = SC.scaleBar(bar)
  ok(b && Math.abs(b.feetPerInch - 30) < 0.05, `scale bar reads 30 ft/in (${b?.feetPerInch})`)
  eq(SC.scaleBar([w('810', 100, 100), w('812', 130, 100), w('814', 160, 100), w('FEET', 130, 110)]), null, 'contour labels are not a scale bar')
  eq(SC.scaleBar([w('0', 100, 100), w('15', 136, 100), w('30', 172, 100)]), null, 'no FEET/SCALE word nearby → no bar')
  // Labelled distances: 245.67' along a 589.6 pt line (1" = 30').
  const len = 245.67 / 30 * 72
  const strokes = [
    { pen: 0, pts: [500, 500, 500 + len, 500], closed: false },
    { pen: 0, pts: [500, 900, 500 + 120 / 30 * 72, 900], closed: false },
    { pen: 0, pts: [1500, 300, 1500, 300 + 88.4 / 30 * 72], closed: false },
  ]
  const dims = [w("N 89°59'50\" E 245.67'", 500 + len / 2, 510), w("120.00'", 500 + 60 / 30 * 72, 892), w("88.40'", 1510, 300 + 44.2 / 30 * 72, 8, Math.PI / 2)]
  const d = SC.labelledDistances(dims, strokes)
  ok(d && Math.abs(d.feetPerInch - 30) < 0.1 && d.agree === 3, `labelled distances agree on 30 (${JSON.stringify(d)})`)
  // Verdicts.
  const ck = (key, fpi) => ({ key, feetPerInch: fpi, detail: '' })
  eq(SC.scaleVerdict([ck('stated', 30), ck('bar', 30.05)]).tone, 'green', 'two within 0.5 % → green')
  eq(SC.scaleVerdict([ck('stated', 30)]).tone, 'amber', 'one check → amber')
  eq(SC.scaleVerdict([ck('stated', 30), ck('bar', 30.25)]).tone, 'amber', 'within 1 % but not 0.5 % → amber')
  const half = SC.scaleVerdict([ck('stated', 30), ck('bar', 60), ck('dims', 60.1)])
  eq([half.tone, half.suggest], ['red', 60], 'a half-size print is named, 1" = 60\' suggested')
  ok(/half-size print/.test(half.words), half.words)
  eq(SC.scaleVerdict([ck('stated', 30), ck('bar', 40)]).tone, 'red', 'disagreement → red')
  eq(SC.scaleVerdict([]).tone, 'none', 'nothing → none')
  eq(SC.scaleWords(30), '1" = 30\'', 'scale words')
  ok(Math.abs(SC.placementFeetPerInch(30 * 0.3048 / 72) - 30) < 0.01, 'placement metres per point → feet per inch')
}

// ── crop to the drawing + which version the map shows ──
{
  const W = 2592, H = 1728
  const seg = (x0, y0, x1, y1) => ({ pen: 0, pts: [x0, y0, x1, y1], closed: false })
  // Border inset 36 pt, a title strip divider at x = 2200, some drawing.
  const strokes = [seg(36, 36, 2556, 36), seg(2556, 36, 2556, 1692), seg(2556, 1692, 36, 1692), seg(36, 1692, 36, 36), seg(2200, 36, 2200, 1692), seg(400, 400, 900, 700)]
  const c = CR.autoCrop(strokes, { width: W, height: H })
  ok(c && Math.abs(c.x1 - 2200 / W) < 0.006 && c.x0 > 36 / W && c.y0 > 0 && c.y1 < 1, `crop stops at the title strip (${JSON.stringify(c)})`)
  const bottom = CR.autoCrop([...strokes.slice(0, 4), seg(36, 300, 2556, 300)], { width: W, height: H })
  ok(bottom && Math.abs(bottom.y1 - (1 - 300 / H)) < 0.006, `a bottom title strip trims the bottom (${JSON.stringify(bottom)})`)
  eq(CR.autoCrop([seg(10, 10, 20, 20)], { width: W, height: H }), null, 'no border → no crop')
  eq(CR.cleanCrop({ x0: 0.1, y0: 0.1, x1: 0.8, y1: 0.9 })?.on, true, 'a crop is on unless said off')
  eq(CR.cleanCrop({ x0: 0.5, y0: 0.1, x1: 0.55, y1: 0.9 }), null, 'a sliver is refused')
  eq(CR.cleanCrop({ x0: -1, y0: 0, x1: 1, y1: 1 }), null, 'out of range refused')
  // subCorners: the whole box gives the corners back; a half box splits the width.
  const lat = 34.85, lng = -82.4
  const corners = [[lng, lat + 0.002], [lng + 0.003, lat + 0.002], [lng + 0.003, lat], [lng, lat]]
  const same = CR.subCorners(corners, { x0: 0, y0: 0, x1: 1, y1: 1 })
  ok(same.every((p, i) => Math.abs(p[0] - corners[i][0]) < 1e-9 && Math.abs(p[1] - corners[i][1]) < 1e-9), 'full crop = the same corners')
  const half = CR.subCorners(corners, { x0: 0, y0: 0, x1: 0.5, y1: 1 })
  ok(Math.abs(half[1][0] - (lng + 0.0015)) < 1e-9, 'half crop ends halfway across')
  // planFrameIds
  const frames = [
    { id: 'a0', sheetId: 's1', issuedOn: '2026-08-12', current: false },
    { id: 'a1', sheetId: 's1', issuedOn: '2026-10-20', current: true },
    { id: 'b0', sheetId: 's2', issuedOn: '2026-09-30', current: true },
    { id: 'legacy' },
  ]
  const ids = (day, hidden = new Set(), picked = new Map()) => [...CR.planFrameIds(frames, day, hidden, picked)].sort().join(',')
  eq(ids(null), 'a1,b0,legacy', 'live: current versions')
  eq(ids('2026-09-01'), 'a0,b0,legacy', 'Sep 1: Rev 0 of s1; s2 not issued yet shows its first version (as plans always did)')
  eq(ids('2026-10-01'), 'a0,b0,legacy', 'Oct 1: s2 issued, s1 still Rev 0')
  eq(ids('2026-12-01'), 'a1,b0,legacy', 'Dec 1: the newest of each')
  eq(ids(null, new Set(['s2'])), 'a1,legacy', 'a hidden sheet leaves the map')
  eq(ids(null, new Set(), new Map([['s1', 'a0']])), 'a0,b0,legacy', 'a picked version replaces the automatic one')
  // A pinned Rev 1 with Rev 2 held back: held is never drawn, and a replay
  // of today is the live map (the pin), not the held revision.
  const pinned = [
    { id: 'p0', sheetId: 's3', issuedOn: '2026-08-01' },
    { id: 'p1', sheetId: 's3', issuedOn: '2026-09-01', current: true },
    { id: 'p2', sheetId: 's3', issuedOn: '2026-10-01', held: true },
  ]
  const pid = (day, today = null, picked = new Map()) => [...CR.planFrameIds(pinned, day, new Set(), picked, today)].join(',')
  eq(pid(null), 'p1', 'live: the pinned version')
  eq(pid('2026-11-07', '2026-11-07'), 'p1', 'a replay of today shows the pin, not the held revision')
  eq(pid('2026-10-15', '2026-11-07'), 'p1', 'a past day after the held revision still shows the pin (held = not for use)')
  eq(pid('2026-08-15', '2026-11-07'), 'p0', 'mid-August: Rev 0')
  eq(pid('2026-07-01', '2026-11-07'), 'p0', 'before the first issue: the earliest version')
  eq(pid(null, null, new Map([['s3', 'p2']])), 'p2', 'picking the held revision shows it')
  // Same-day versions: the current one, else the one filed last.
  const sameDay = [
    { id: 't0', sheetId: 's4', issuedOn: '2026-10-01', createdAt: '2026-10-01T10:00:00Z' },
    { id: 't1', sheetId: 's4', issuedOn: '2026-10-01', createdAt: '2026-10-01T12:00:00Z' },
    { id: 't2', sheetId: 's4', issuedOn: '2026-10-05', current: true, createdAt: '2026-10-05T09:00:00Z' },
    { id: 'u0', sheetId: 's5', issuedOn: '2026-10-01', current: true, createdAt: '2026-10-01T08:00:00Z' },
    { id: 'u1', sheetId: 's5', issuedOn: '2026-10-01', createdAt: '2026-10-01T09:00:00Z' },
  ]
  const sid = (day) => [...CR.planFrameIds(sameDay, day, new Set(), new Map(), '2026-11-07')].sort().join(',')
  eq(sid('2026-10-02'), 't1,u0', 'same day: filed last, unless one is current')
  eq(sid('2026-09-01'), 't1,u0', 'before the first issue: what that first day shows')
}

// ── the fingerprint on the real fixture PDF ──
{
  const pdfjs = await import(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
  const geomUrl = transpile('../lib/dirt/geom.ts')
  const pr = await import(transpile('../lib/dirt/plan-read.ts', { './geom': geomUrl }))
  const readPdf = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    const [ops, tc, annots, oc] = await Promise.all([
      page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }), page.getTextContent(), page.getAnnotations(), doc.getOptionalContentConfig(),
    ])
    const names = new Map()
    try { for (const [id, g] of oc) names.set(id, g?.name ?? id) } catch { /* none */ }
    const { pens, lines } = PV.extractVectors(ops, pdfjs.OPS, (id) => names.get(id) ?? null)
    const t = Array.from(vp.transform)
    const words = F.wordsToViewed([...PV.textFromContent(tc.items), ...PV.textFromShx(annots)], t, vp.height)
    const vl = F.linesToViewed(lines, t, vp.height)
    const size = { width: vp.width, height: vp.height }
    const src = F.fingerprintSource(words, vl, pens, size)
    await doc.loadingTask?.destroy?.()
    return { size, src, sig: src ? await F.sha256Hex(src) : null, ink: F.inkBox(vl, size), tb: TB.readTitleBlock(words, size) }
  }
  const base = await readPdf(buildPlanPdf(pr.chainLines).bytes)
  const reissue = await readPdf(buildPlanPdf(pr.chainLines, { titleNote: 'REV 1  10/20/2026  ADDENDUM 1' }).bytes)
  const moved = await readPdf(buildPlanPdf(pr.chainLines, { extraLine: [500, 500, 640, 560] }).bytes)
  const turned = await readPdf(buildPlanPdf(pr.chainLines, { rotate: 90 }).bytes)
  const turned2 = await readPdf(buildPlanPdf(pr.chainLines, { rotate: 90, titleNote: 'REV 2' }).bytes)
  ok(base.sig && /^[0-9a-f]{64}$/.test(base.sig), 'fixture fingerprint is a SHA-256')
  eq(reissue.sig, base.sig, 'a title-block-only re-issue keeps the fingerprint (unchanged)')
  ok(moved.sig !== base.sig, 'a new line in the drawing changes the fingerprint (revised)')
  eq(reissue.tb.number, 'C-3.0', 'the re-issue still reads its number')
  eq(reissue.tb.rev, '1', 'the re-issue reads its new rev')
  eq(F.carryRule({ pageW: base.size.width, pageH: base.size.height, inkBox: base.ink }, { pageW: reissue.size.width, pageH: reissue.size.height, inkBox: reissue.ink }), 'exact', 'same plot → placement carries with no clicks')
  eq([turned.size.width, turned.size.height], [base.size.height, base.size.width], 'a /Rotate 90 page is viewed portrait')
  ok(turned.sig !== base.sig, 'viewed geometry is in the fingerprint (rotated plot differs)')
  eq(turned2.sig, turned.sig, 'rotated re-issue keeps its fingerprint too')
  eq(F.carryRule({ pageW: base.size.width, pageH: base.size.height, inkBox: base.ink }, { pageW: turned.size.width, pageH: turned.size.height, inkBox: turned.ink }), 'none', 'rotated paper never carries')
  eq(F.fingerprintSource([], [], [], base.size), null, 'a scan has no fingerprint')

  // The scale card + grid line-up on a real PDF: stated 1" = 30', a bar,
  // labelled boundary distances and SC State Plane ticks on the border.
  {
    const e0 = 1579000, n0 = 1100000
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buildPlanPdf(pr.chainLines, { scaleKit: { e0, n0 } }).bytes), verbosity: 0 }).promise
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    const [ops, tc, annots] = await Promise.all([page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }), page.getTextContent(), page.getAnnotations()])
    const t = Array.from(vp.transform)
    const words = F.wordsToViewed([...PV.textFromContent(tc.items), ...PV.textFromShx(annots)], t, vp.height)
    const { lines } = PV.extractVectors(ops, pdfjs.OPS)
    const vl = F.linesToViewed(lines, t, vp.height)
    const size = { width: vp.width, height: vp.height }
    const tb = TB.readTitleBlock(words, size)
    eq(tb.feetPerInch, 30, 'fixture: stated scale read')
    const bar = SC.scaleBar(words)
    ok(bar && Math.abs(bar.feetPerInch - 30) < 0.3, `fixture: scale bar measured (${bar?.feetPerInch})`)
    const dims = SC.labelledDistances(words, vl)
    ok(dims && Math.abs(dims.feetPerInch - 30) < 0.3 && dims.agree >= 2, `fixture: labelled distances measured (${JSON.stringify(dims)})`)
    const fit = GF.fitGrid(GF.findGridLabels(words), size)
    ok(fit && Math.abs(fit.feetPerInch - 30) < 0.3, `fixture: grid ticks imply 30 ft/in (${fit?.feetPerInch})`)
    ok(fit && fit.worstFt < 4, `fixture: ticks agree within a few feet (${fit?.worstFt} ft over ${fit?.n})`)
    const bl = fit ? SP.toStatePlane(...fit.bounds[3]) : [0, 0]
    ok(fit && Math.abs(bl[0] - e0) < 5 && Math.abs(bl[1] - n0) < 5, `fixture: the page's bottom-left lands at the grid origin (${bl.map((v) => v.toFixed(1))})`)
    const v = SC.scaleVerdict([{ key: 'stated', feetPerInch: tb.feetPerInch, detail: '' }, { key: 'bar', feetPerInch: bar.feetPerInch, detail: '' }, { key: 'dims', feetPerInch: dims.feetPerInch, detail: '' }, { key: 'grid', feetPerInch: fit.feetPerInch, detail: '' }])
    ok(v.tone === 'green' || v.tone === 'amber', `fixture: four checks agree (${v.tone}: ${v.words})`)
    await doc.loadingTask?.destroy?.()
  }
}

console.log(`\nplan-room: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
