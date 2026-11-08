// node scripts/progress-test.mjs — progress by drone flight (lib/dirt/progress.ts):
// levelling a flight on untouched ground, then the design run against it.
// Run it after ANY change there: these numbers go in front of an owner as
// "62% done".
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const npm = (spec) => import.meta.resolve(spec)
function transpile(rel, deps = {}) {
  let src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [spec, url] of Object.entries(deps)) src = src.replaceAll(`from '${spec}'`, `from '${url}'`)
  return dataUrl(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}
const tmUrl = transpile('../lib/dirt/tm.ts')
const geomUrl = transpile('../lib/dirt/geom.ts')
const surfUrl = transpile('../lib/dirt/surface.ts', { delaunator: npm('delaunator'), '@kninnug/constrainautor': npm('@kninnug/constrainautor'), './geom': geomUrl })
const tkUrl = transpile('../lib/dirt/takeoff.ts', { earcut: npm('earcut'), './tm': tmUrl, './geom': geomUrl, './surface': surfUrl })
const P = await import(transpile('../lib/dirt/progress.ts', { './tm': tmUrl, './geom': geomUrl }))
const tm = await import(tmUrl)
const tk = await import(tkUrl)
const surf = await import(surfUrl)

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const near = (a, b, tol, msg) => ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`)

// ── levelling ──
const noise = (i) => ((i * 7919) % 101) / 100 - 0.5 // deterministic ±0.5
const clean = Array.from({ length: 2000 }, (_, i) => 0.9754 + 0.04 * noise(i))
near(P.datumFit(clean).offsetM, 0.9754, 0.005, 'a flight 0.98 m low: the median brings it back')
ok(P.datumFit(clean).spreadM < 0.02, 'tight band: small spread')
const trees = [...clean.slice(0, 1400), ...Array.from({ length: 600 }, (_, i) => 0.9754 - 12 - noise(i))]
near(P.datumFit(trees).offsetM, 0.9754, 0.03, '30% of the band under trees (flight 12 m higher there): the median holds')
ok(P.datumFit(trees).spreadM / 0.3048 > P.LOOSE_FT, '…and the spread says the levelling is rough')
ok(P.datumFit(clean.slice(0, 150)) === null, 'too little untouched ground: no levelling, never a guess')

// ── the design for a flight ──
const d0 = { v: 1, existing: { source: 'traced', offsetFt: 2 }, settings: { shrinkPct: 0, truckCy: 12 }, features: [
  { id: 'a', kind: 'boundary', coords: [] }, { id: 'b', kind: 'topsoil', coords: [], thicknessIn: 4 }, { id: 'c', kind: 'demo', coords: [], thicknessIn: 6 }, { id: 'd', kind: 'platform', coords: [], z: 1 } ] }
const pd = P.progressDesign(d0)
ok(pd.features.map((f) => f.kind).join() === 'boundary,platform' && pd.existing.source === 'lidar' && pd.existing.offsetFt === 0, 'no topsoil or demo deductions; the flight is the existing ground, as flown')

// ── through the takeoff: half the pad dug, the flight floating 3 m high ──
const FT = 0.3048
const T = tm.makeFrame(-82.394, 34.8526, 17)
const ll = (xf, yf) => tm.fromFrame(T, xf * FT * T.k, yf * FT * T.k)
const rect = (x0, y0, x1, y1) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)]
function grid(f, x0, y0, x1, y1, stepM = 1) {
  const xm0 = x0 * FT * T.k, ym0 = y0 * FT * T.k
  const nx = Math.ceil(((x1 - x0) * FT * T.k) / stepM) + 1, ny = Math.ceil(((y1 - y0) * FT * T.k) / stepM) + 1
  const z = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = f((xm0 + i * stepM) / T.k / FT, (ym0 + j * stepM) / T.k / FT) * FT
  return { zone: 17, epsg: 26917, x0: T.e0 + xm0, y0: T.n0 + ym0, dx: stepM, dy: stepM, nx, ny, z, source: 'test grid', resolutionM: stepM }
}
const design = { v: 1, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 }, features: [
  { id: 'lim', kind: 'boundary', coords: rect(0, 0, 200, 200) },
  { id: 'pad', kind: 'platform', coords: rect(0, 0, 200, 200), z: 290, offsetIn: 0, label: 'Pad' },
  { id: 'ts', kind: 'topsoil', coords: rect(0, 0, 200, 200), thicknessIn: 6 },
] }
const lidar = grid(() => 300, -150, -150, 350, 350)
const original = tk.runTakeoff(design, lidar).results
// The flight: the west half dug to grade, the east half untouched, the whole survey 3 m high (no control).
const flightGrid = grid((x) => (x >= 0 && x <= 200 && x < 100 ? 290 : 300) + 3 / FT, -100, -100, 300, 300)
const frame = tm.makeFrame(...ll(100, 100))
const toSurface = (g) => new surf.GridSurface({ x0: g.x0 - frame.e0, y0: g.y0 - frame.n0, dx: g.dx, dy: g.dy, nx: g.nx, ny: g.ny, z: g.z })
const flightS = toSurface(flightGrid), lidarS = toSurface(lidar)
const lim = P.limitsOf(design, frame)
ok(lim.rings.length === 1 && lim.inside(...tm.toFrame(frame, ...ll(100, 100))) && !lim.inside(...tm.toFrame(frame, ...ll(250, 100))), 'the limits as frame rings')
const diffs = P.bandDiffs({ flight: flightS, existing: lidarS, inside: lim.inside, box: lim.box })
const fit = P.datumFit(diffs)
near(fit.offsetM, -3, 0.01, `levelled on the band outside the limits (${diffs.length} samples): −3 m`)
const levelled = P.flightGround(flightS, frame, fit.offsetM, 'flight', 1)
const left = tk.runTakeoff(P.progressDesign(design), levelled).results
// Where the job started: the same design against the original ground, measured the way a flight is.
const startRun = tk.runTakeoff({ ...P.progressDesign(design), existing: design.existing }, lidar)
const start = startRun.results
const pr = P.progressResults({ flownOn: '2026-11-05', left, start, original, fit, asFlown: false, resolutionM: 1 })
near(pr.pctDone, 50, 1.5, 'half the pad dug: about 50% done')
near(pr.cutLeftCy, start.cutCy / 2, 0.02 * start.cutCy, '…half of what had to come out is left')
ok(pr.cutCy === Math.round(start.cutCy) && Math.abs(start.cutCy - (original.cutCy + original.topsoil.cy)) < 0.01 * start.cutCy, 'on a cut site the start is the cut plus the strip the takeoff booked apart')
ok(pr.datum.mode === 'levelled' && Math.abs(pr.datum.offsetFt + 9.84) < 0.05, `the levelling is reported in feet (${pr.datum.offsetFt})`)
const raw = tk.runTakeoff(P.progressDesign(design), P.flightGround(flightS, frame, 0, 'flight', 1)).results
const prRaw = P.progressResults({ flownOn: '2026-11-05', left: raw, start, original, fit: null, asFlown: false, resolutionM: 1 })
ok(prRaw.pctDone < 10 && prRaw.warnings.some((w) => /used as flown/.test(w)), `without levelling a 3 m-high flight reads as nothing done — and says it wasn't levelled (${prRaw.pctDone}%)`)
const done = tk.runTakeoff(P.progressDesign(design), P.flightGround(toSurface(grid(() => 290, -100, -100, 300, 300)), frame, 0, 'f', 1)).results
near(P.progressResults({ flownOn: 'x', left: done, start, original, fit: null, asFlown: true, resolutionM: 1 }).pctDone, 100, 0.5, 'graded to the pad everywhere: 100%')
ok(P.progressResults({ flownOn: 'x', left: done, start: null, original, fit: null, asFlown: true, resolutionM: 1 }).warnings.some((w) => /start of the job couldn/.test(w)), 'no start measured: says % done is against the takeoff')
ok(JSON.stringify(P.movedBetween([{ cutLeftCy: 400, fillLeftCy: 10 }, { cutLeftCy: 1000, fillLeftCy: 10 }, { cutLeftCy: 1500, fillLeftCy: 50 }])) === '[600,540,null]', 'yards moved between flights')
const partial = tk.runTakeoff(P.progressDesign(design), P.flightGround(toSurface(grid(() => 290, -100, -100, 120, 300)), frame, 0, 'f', 1)).results
ok(P.progressResults({ flownOn: 'x', left: partial, start, original, fit: null, asFlown: true, resolutionM: 1 }).warnings.some((w) => /covers \d+% of the grading limits/.test(w)), 'a flight that missed part of the site says so')

// ── a FILL site (ship-check, Nov 8): untouched ground reads 0% done, not 9% ──
{
  const fillDesign = { v: 1, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 }, features: [
    { id: 'lim', kind: 'boundary', coords: rect(0, 0, 200, 200) },
    { id: 'pad', kind: 'platform', coords: rect(0, 0, 200, 200), z: 310, offsetIn: 0, label: 'Pad' },
    { id: 'ts', kind: 'topsoil', coords: rect(0, 0, 200, 200), thicknessIn: 6 },
  ] }
  const fStart = tk.runTakeoff({ ...P.progressDesign(fillDesign), existing: fillDesign.existing }, lidar)
  const fOrig = tk.runTakeoff(fillDesign, lidar).results
  const untouched = tk.runTakeoff(P.progressDesign(fillDesign), P.flightGround(toSurface(grid(() => 300, -100, -100, 300, 300)), frame, 0, 'f', 1), new Date(), { tieIn: { frame: fStart.ctx.frame, eg: fStart.ctx.eg } }).results
  near(P.progressResults({ flownOn: 'x', left: untouched, start: fStart.results, original: fOrig, fit: null, asFlown: true, resolutionM: 1 }).pctDone, 0, 0.5, 'a 10 ft fill pad over untouched ground: 0% done')
}

// ── the tie-in stays on the original ground (ship-check, Nov 8) ──
{
  const sloped = { v: 1, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 }, features: [
    { id: 'lim', kind: 'boundary', coords: rect(0, 0, 300, 300) },
    { id: 'pad', kind: 'platform', coords: rect(100, 100, 200, 200), z: 306, offsetIn: 0, label: 'Pad' },
  ] }
  const sStart = tk.runTakeoff({ ...P.progressDesign(sloped), existing: sloped.existing }, lidar)
  // Nothing built — just a 6 ft berm straddling the north limit line.
  const berm = toSurface(grid((x, y) => (y >= 290 && y <= 310 ? 306 : 300), -100, -100, 400, 400))
  const flightB = P.flightGround(berm, frame, 0, 'f', 1)
  const tied = tk.runTakeoff(P.progressDesign(sloped), flightB, new Date(), { tieIn: { frame: sStart.ctx.frame, eg: sStart.ctx.eg } }).results
  const bent = tk.runTakeoff(P.progressDesign(sloped), flightB).results
  ok(tied.fillCy <= sStart.results.fillCy * 1.01 && tied.cutCy > 50, `a berm on the limit line is cut left; the design's fill is unchanged (fill ${Math.round(tied.fillCy)} vs ${Math.round(sStart.results.fillCy)} at the start, cut ${Math.round(tied.cutCy)})`)
  ok(bent.fillCy > tied.fillCy, `…tied into the flight instead, the design bends toward the berm (fill ${Math.round(bent.fillCy)})`)
}

console.log(`\nprogress: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
