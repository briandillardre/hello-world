/**
 * Harness for lib/plans/match.ts — sheets that put themselves on the map.
 *
 *   node scripts/plan-match-test.mjs
 *
 * A synthetic site (a few buildings, a property line, parking stripes) drawn
 * the way a civil set does: an overall sheet at 1" = 60', four enlarged
 * quadrants at 1" = 20' (the Haywood Mall case), and two road sheets that
 * meet at a matchline (the Clemson case). Each must land on the overall —
 * and the overall on the "ground" footprints (metres, a metre of trace noise,
 * some buildings missing from the map, a proposed building missing from the
 * ground) — within tolerance; a row of identical buildings must NOT be
 * guessed. Run it after ANY change to lib/plans/match.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/plans/match.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`)

// Seeded noise
let seed = 7
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }

// ── The site, in feet (east, north) ──
const rect = (x, y, w, h, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot)
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => [x + c * u - s * v, y + s * u + c * v])
}
const L = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x + w * 0.4, y + h], [x + w * 0.4, y + h * 0.6], [x, y + h * 0.6]]
const buildings = [
  rect(100, 120, 180, 90, 0.12), L(420, 80, 160, 140), rect(650, 300, 120, 200, -0.05),
  rect(120, 420, 90, 60, 0.3), L(330, 380, 200, 120), rect(820, 90, 70, 110, 0.0),
]
const proposed = rect(560, 520, 140, 80, 0.2) // on the plans, not on the ground yet
const boundary = [[40, 30], [960, 50], [990, 640], [480, 700], [30, 610]]
const stripes = [] // parking stripes: short parallel lines, never corners
for (let i = 0; i < 25; i++) stripes.push([[300 + i * 9, 250], [300 + i * 9, 268]])
// Curb islands and pads — what a real site plan is full of (irregular, so
// the drawing has corners everywhere, the way civil sheets do).
const islands = []
for (let i = 0; i < 40; i++) {
  const x = 60 + rnd() * 880, y = 60 + rnd() * 600, w = 12 + rnd() * 30, h = 8 + rnd() * 25
  islands.push(rect(x, y, w, h, rnd() * 1.4 - 0.7))
}

const ringSegs = (ring, role, closed = true) => {
  const out = []
  for (let i = 0; i + 1 < ring.length + (closed ? 1 : 0); i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    out.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], role })
  }
  return out
}
const siteSegs = (withProposed) => [
  ...buildings.flatMap((b) => ringSegs(b, 1)), ...(withProposed ? ringSegs(proposed, 1) : []),
  ...ringSegs(boundary, 2), ...stripes.flatMap((s) => ringSegs(s, 0, false)),
  ...islands.flatMap((r) => ringSegs(r, 0)),
]

// A sheet: feet → page points by fpi, turned by `turn`, offset; only what is inside its window.
function sheet(fpi, turn, off, win, noise = 0) {
  const k = 72 / fpi, c = Math.cos(turn), s = Math.sin(turn)
  const T = (p) => { const x = p[0] * k, y = p[1] * k; return [c * x - s * y + off[0] + noise * gauss(), s * x + c * y + off[1] + noise * gauss()] }
  const segs = siteSegs(true).flatMap((g) => {
    const cut = win ? M.clipSeg(g.x0, g.y0, g.x1, g.y1, win) : [g.x0, g.y0, g.x1, g.y1]
    if (!cut) return []
    const a = T([cut[0], cut[1]]), b = T([cut[2], cut[3]])
    return [{ x0: a[0], y0: a[1], x1: b[0], y1: b[1], role: g.role }]
  })
  return { segs, truth: { s: k, th: turn, tx: off[0], ty: off[1] }, fpi }
}
const truthMap = (sh) => (p) => M.apply(sh.truth, p[0], p[1]) // feet → page

// ── 1. Corners ──
const overall = sheet(60, 0.0, [80, 60])
const oc = M.cornersOf(overall.segs, 0.35, 4)
ok(oc.length >= 30, `overall corners found (${oc.length})`)
ok(!oc.some((c) => c.role === 0 && c.len < 4.5), 'parking stripe ends are not corners')
ok(oc.every((c) => { const o = ((c.a2 - c.a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return o > 0.6 && o < 2.6 }), 'openings are proper (35°–145°)')

// ── 2. Quadrants (1" = 20') onto the overall (1" = 60') ──
const quads = [[0, 0, 520, 380], [480, 0, 1000, 380], [0, 340, 520, 720], [480, 340, 1000, 720]]
quads.forEach((w, qi) => {
  const q = sheet(20, 0.0, [100 - w[0] * 3.6, 80 - w[1] * 3.6], w, 0.05)
  const A = M.cornersOf(q.segs, 0.35, 4), B = oc
  const m = M.matchCorners(A, B, { scales: M.sheetRatios(20, 60), tol: 1.2 })
  ok(!!m, `quadrant ${qi + 1} matched`)
  if (!m) return
  ok(M.sheetMatchSure(m, 60 / 72, 3000), `quadrant ${qi + 1} sure (n ${m.n}, rms ${m.rms.toFixed(3)}, rival ${m.rival})`)
  // truth: quad page → feet → overall page
  const inv = M.invert(q.truth)
  const expect = M.compose(overall.truth, inv)
  near(m.s, expect.s, 0.002, `quadrant ${qi + 1} scale`)
  near(M.wrap(m.th - expect.th), 0, 0.002, `quadrant ${qi + 1} turn`)
  const [ex, ey] = M.apply(expect, 400, 300), [gx, gy] = M.apply(m, 400, 300)
  ok(Math.hypot(ex - gx, ey - gy) * 60 / 72 < 0.5, `quadrant ${qi + 1} lands within 0.5 ft (${(Math.hypot(ex - gx, ey - gy) * 60 / 72).toFixed(2)})`)
})

// ── 3. A turned road sheet (no stated scale) onto the overall ──
{
  const r = sheet(40, 0.6, [300, -200], [300, 0, 1000, 400], 0.05)
  const A = M.cornersOf(r.segs, 0.35, 4)
  const m = M.matchCorners(A, oc, { scales: M.sheetRatios(null, 60), tol: 1.2 })
  ok(!!m && M.sheetMatchSure(m, 60 / 72, 3000), `turned sheet with no stated scale found (n ${m?.n}, s ${m?.s.toFixed(4)})`)
  if (m) near(m.s, 40 / 60, 0.003, 'turned sheet scale = 40/60')
}

// ── 4. Two road sheets that overlap only near the matchline ──
{
  const a = sheet(30, 0.0, [-0, 0], [0, 0, 560, 720], 0.05), b = sheet(30, 0.0, [-500 * 2.4, 0], [440, 0, 1000, 720], 0.05)
  const m = M.matchCorners(M.cornersOf(a.segs, 0.35, 4), M.cornersOf(b.segs, 0.35, 4), { scales: M.sheetRatios(30, 30), tol: 1.2 })
  ok(!!m && m.n >= 6, `matchline overlap matched (n ${m?.n})`)
  if (m) near(m.tx, -1200, 1, 'matchline offset')
}

// ── 5. Overall onto the ground (metres, trace noise, missing buildings) ──
{
  const ftToM = 0.3048
  const ground = [...buildings.slice(0, 4), buildings[5]].flatMap((b) => ringSegs(b.map(([x, y]) => [x * ftToM + gauss() * 0.6, y * ftToM + gauss() * 0.6]), 1))
  const G = M.cornersOf(ground, 0.3, 1.5)
  const A = oc
  const m = M.matchCorners(A, G, { scales: [ftToM * 60 / 72], tol: 2.5, scaleSlack: 0.04 })
  ok(!!m, 'ground matched')
  if (m) {
    const diag = Math.hypot(1000, 720) * ftToM
    ok(M.groundMatchSure(m, diag), `ground sure (n ${m.n}, rms ${m.rms.toFixed(2)} m, rival ${m.rival})`)
    // the page point of site (500,350) ft must land at (500,350)·0.3048 m
    const p = M.apply(overall.truth, 500, 350)
    const [gx, gy] = M.apply(m, p[0], p[1])
    ok(Math.hypot(gx - 500 * ftToM, gy - 350 * ftToM) < 1.0, `ground lands within 1 m (${Math.hypot(gx - 500 * ftToM, gy - 350 * ftToM).toFixed(2)})`)
  }
}

// ── 6. Repeated geometry is never guessed ──
{
  const row = []
  for (let i = 0; i < 6; i++) row.push(...ringSegs(rect(i * 100, 0, 60, 40), 1))
  const groundRow = row.map((s) => ({ ...s, x0: s.x0 * 0.3048, y0: s.y0 * 0.3048, x1: s.x1 * 0.3048, y1: s.y1 * 0.3048 }))
  // the sheet shows only two of the six identical buildings
  const two = []
  for (let i = 0; i < 2; i++) two.push(...ringSegs(rect(i * 100 * 1.2, 0, 60 * 1.2, 40 * 1.2), 1))
  const m = M.matchCorners(M.cornersOf(two, 0.35, 4), M.cornersOf(groundRow, 0.3, 1.5), { scales: [0.3048 / 1.2], tol: 2.5 })
  ok(!M.groundMatchSure(m, 60), `identical buildings not guessed (n ${m?.n}, rival ${m?.rival})`)
}

// ── 7. Plumbing ──
{
  const t = { s: 2.5, th: 0.7, tx: 10, ty: -4 }
  const r = M.compose(M.invert(t), t)
  near(r.s, 1, 1e-9, 'invert∘t scale'); near(r.tx, 0, 1e-9, 'invert∘t tx')
  const o = [-82.43, 34.8]
  const c = M.cornersFor(t, o, 2592, 1728)
  const back = M.similarityOf(c, o, 2592, 1728)
  near(back.s, t.s, 1e-6, 'corners round trip scale'); near(back.th, t.th, 1e-9, 'corners round trip turn')
  const f = M.planFeatures([{ id: 0, layer: 'C-BLDG', color: '#000', width: 1, dash: '' }],
    buildings.map((b) => ({ pen: 0, pts: b.flatMap(([x, y]) => [x * 1.2 + 50, y * 1.2 + 50]), closed: true })),
    { width: 2592, height: 1728 }, null)
  ok(!!f && M.cornersFrom(f).length >= 20 && M.cornersFrom(f).every((c) => c.role === 1), 'planFeatures reads closed building rings with their layer role')
  ok(!!M.cleanFeatures(f) && M.cleanFeatures({ c: [1, 2, 3] }) === null, 'cleanFeatures')
  ok(!M.spreadWords(100, 1000).ok && M.spreadWords(600, 1000).ok, 'two-point spread words')
}

// ── 8. The real fixture PDF through pdf.js: a sheet turned 90° finds its original ──
{
  const root = new URL('..', import.meta.url)
  const tsUrl = (rel, deps = {}) => {
    let s = readFileSync(new URL(rel, root), 'utf8')
    for (const [spec, url] of Object.entries(deps)) s = s.replaceAll(`from '${spec}'`, `from '${url}'`)
    return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText).toString('base64')
  }
  const { buildPlanPdf } = await import('./plan-pdf-fixture.mjs')
  const PV = await import(tsUrl('lib/dirt/pdf-vectors.ts'))
  const F = await import(tsUrl('lib/plans/fingerprint.ts', { './title-block': tsUrl('lib/plans/title-block.ts') }))
  const CR = await import(tsUrl('lib/plans/crop.ts'))
  const pr = await import(tsUrl('lib/dirt/plan-read.ts', { './geom': tsUrl('lib/dirt/geom.ts') }))
  const pdfjs = await import(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
  const read = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
    const page = await doc.getPage(1); const vp = page.getViewport({ scale: 1 })
    const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE })
    const { pens, lines } = PV.extractVectors(ops, pdfjs.OPS, () => null)
    const vl = F.linesToViewed(lines, Array.from(vp.transform), vp.height)
    const size = { width: vp.width, height: vp.height }
    await doc.loadingTask?.destroy?.()
    return M.planFeatures(pens, vl, size, CR.autoCrop(vl, size))
  }
  const a = await read(buildPlanPdf(pr.chainLines).bytes)
  const b = await read(buildPlanPdf(pr.chainLines, { rotate: 90 }).bytes)
  ok(!!a && M.cornersFrom(a).length >= 20, `fixture PDF corners read (${a && M.cornersFrom(a).length})`)
  const m = a && b ? M.matchCorners(M.cornersFrom(a), M.cornersFrom(b), { scales: [1], tol: 1.2 }) : null
  ok(!!m && m.n >= 20 && m.rms < 0.01, `turned fixture matched (n ${m?.n}, rms ${m?.rms})`)
  if (m) near(Math.abs(M.wrap(m.th)) * 180 / Math.PI, 90, 0.01, 'turned fixture: 90°')
}

console.log(`\nplan-match: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
