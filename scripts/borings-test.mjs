// node scripts/borings-test.mjs — the ground from borings (lib/borings/layers.ts +
// lib/borings/ground.ts, run against a real takeoff). Run it after ANY change
// there: these numbers become rock and undercut prices on a bid.
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
const layersUrl = transpile('../lib/borings/layers.ts')
const groundUrl = transpile('../lib/borings/ground.ts', { '../dirt/takeoff': tkUrl, '../dirt/tm': tmUrl, './layers': layersUrl })
const iconsUrl = transpile('../lib/asset-icons.ts')
const bulkUrl = transpile('../lib/bulk-import.ts', { './asset-icons': iconsUrl })
const spUrl = transpile('../lib/plans/stateplane.ts')
const P = await import(transpile('../lib/borings/paste.ts', { '../bulk-import': bulkUrl, '../plans/stateplane': spUrl }))
const SP = await import(spUrl)
const B = await import(layersUrl)
const G = await import(groundUrl)
const tm = await import(tmUrl)
const tk = await import(tkUrl)

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const near = (a, b, tol, msg) => ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`)
const FT = B.FT
const bor = (id, x, y, o = {}) => ({ id, name: id, kind: 'boring', x, y, groundFt: 100, depthFt: 8, topsoilIn: 4, fillFt: null, pwrFt: 4, refusalFt: 6, waterFt: null, unsuitableFt: null, ...o })

// ── spreading ──
near(B.idw([{ x: 0, y: 0, v: 2 }, { x: 10, y: 0, v: 6 }], 0, 0), 2, 1e-9, 'IDW passes through a boring exactly')
near(B.idw([{ x: 0, y: 0, v: 2 }, { x: 10, y: 0, v: 6 }], 5, 0), 4, 1e-9, 'IDW halfway between two borings is the mean')
const h = B.hull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }])
ok(h.length === 4 && B.inHull(h, 5, 5) && !B.inHull(h, 11, 5), 'hull of five borings is the four corners; inside / outside')

const three = [bor('B-1', 0, 0, { refusalFt: 6 }), bor('B-2', 100, 0, { refusalFt: 10, pwrFt: null }), bor('B-3', 0, 100, { refusalFt: null, pwrFt: null, depthFt: 15 })]
const L = B.layers(three, () => null)
const c1 = L.column(0, 0)
ok(c1.hit?.share === 1 && c1.hit.rock === 94 && c1.hit.pwr === 96 && !c1.clean, 'at B-1: all hit — PWR from 96, rock from 94')
near(L.column(100, 0).hit.rock, 90, 1e-9, 'rock at B-2 = ground − refusal')
near(L.column(100, 0).hit.pwr, 90, 1e-9, 'B-2 hit refusal with no PWR: the PWR line meets the rock')
const c3 = L.column(0, 100)
ok(c3.clean?.share === 1 && c3.clean.bottom === 85 && !c3.hit, 'B-3 stopped at 15 ft without refusal: soil to 85, unknown below — no rock line there')
near(L.column(300, 0).hit.rock, 90, 1e-9, 'beyond the borings: the nearest one holds')
ok(L.column(300, 0).hit.share === 1, '…alone')
const mid = L.column(30, 30)
ok(mid.hit.share > 0.3 && mid.hit.share < 0.9 && Math.abs(mid.hit.share + mid.clean.share - 1) < 1e-9, `between, the evidence splits by weight (${mid.hit.share.toFixed(2)} hit / ${mid.clean.share.toFixed(2)} clean)`)
ok(mid.hit.rock < 94 && mid.hit.rock > 90, '…and the rock line blends only among the borings that hit rock')
const swapped = B.layers([bor('S-1', 0, 0, { pwrFt: 7, refusalFt: 5 })], () => null)
near(swapped.column(0, 0).hit.pwr, 95, 1e-9, 'a PWR reading below refusal is read as none — the PWR line meets the rock')
const pwrOnly = B.layers([bor('W-1', 0, 0, { pwrFt: 3, refusalFt: null, depthFt: 10 })], () => null).column(0, 0)
ok(pwrOnly.pwr?.share === 1 && pwrOnly.pwr.pwr === 97 && pwrOnly.pwr.bottom === 90, 'PWR found, no refusal to 10 ft: PWR from 97 down to its bottom at 90')
ok(L.conf(30, 30).inside && !L.conf(300, 0).inside, 'confidence: inside the borings vs beyond them')
near(L.conf(0, 50).ft, 50 / FT, 1e-6, 'confidence: feet to the nearest boring')
near(L.depth('topsoilIn', 30, 30), 4, 1e-9, 'topsoil spreads as a depth')
ok(B.layers([bor('Q', 0, 0, { topsoilIn: null })], () => null).depth('topsoilIn', 0, 0) === null, 'a log silent on topsoil says nothing — no guess')
near(B.layers([bor('Q', 0, 0)], () => null).depth('fillFt', 0, 0), 0, 1e-9, 'a log silent on fill found none')
const noLog = B.layers([bor('P-1', 0, 0, { groundFt: null })], () => 120)
near(noLog.column(0, 0).hit.rock, 114, 1e-9, 'a pit with no logged elevation takes the existing ground\'s')
const none = B.layers([bor('P-2', 0, 0, { groundFt: null })], () => null)
ok(none.column(0, 0) === null, 'no elevation anywhere: no lines, never a guess')

// ── the ground in the cut ──
// A 100 m square at 100 ft cut flat to 90 ft; borings at the corners and the centre.
const sq = [bor('C-1', 0, 0), bor('C-2', 100, 0), bor('C-3', 100, 100), bor('C-4', 0, 100), bor('C-5', 50, 50)]
const at = (eg, sg) => () => ({ inside: true, eg: eg * FT, sg: sg * FT, eg0: eg * FT })
const box = { x0: 0, y0: 0, x1: 100, y1: 100 }
const cyPerFt = (100 * 100 * FT) / 0.764554857984
const r1 = B.rockCut(at(100, 90), B.layers(sq, () => null), box, 10000)
near(r1.sampledCutCy, 10 * cyPerFt, 2, 'sampled cut = 10 ft over the square')
near(r1.pwrCy, 2 * cyPerFt, 2, 'PWR from 96 to 94 ft: 2 ft of the cut')
near(r1.rockCy, 4 * cyPerFt, 2, 'rock from 94 down to grade at 90: 4 ft')
near(r1.unexploredCy, 0, 0.5, 'every boring found the rock: nothing unexplored')
near(r1.topsoilIn, 4, 1e-9, 'topsoil average over the limits')
const noRock = sq.map((b) => ({ ...b, pwrFt: null, refusalFt: null }))
const r2 = B.rockCut(at(100, 90), B.layers(noRock, () => null), box, 10000)
near(r2.rockCy + r2.pwrCy, 0, 0.5, 'no boring hit rock: no rock priced…')
near(r2.unexploredCy, 2 * cyPerFt, 2, '…but the 2 ft cut below where they stopped (92) is unexplored, not "rock-free"')
// One refusal among clean borings that went deeper than the cut: the rock does not smear across the site.
const one = sq.map((b) => (b.id === 'C-1' ? b : { ...b, pwrFt: null, refusalFt: null, depthFt: 20 }))
const r3 = B.rockCut(at(100, 90), B.layers(one, () => null), box, 10000)
ok(r3.rockCy < 0.5 * 4 * cyPerFt, `one refusal in a corner among four clean 20-ft borings: rock stays near it (${r3.rockCy} CY, not ${Math.round(4 * cyPerFt)})`)
ok(r3.rockCy > 0, '…but it is not lost either')
near(r3.unexploredCy, 0, 1, '…and the clean borings went below the cut: nothing unexplored')
const deep = B.rockCut(at(100, 95), B.layers(sq, () => null), box, 10000)
near(deep.rockCy, 0, 0.5, 'a shallow cut above the rock line has no rock')
near(deep.pwrCy, 1 * cyPerFt, 2, '…and 1 ft of PWR (96 to 95)')
const pwrCut = B.rockCut(at(100, 85), B.layers(sq.map((b) => ({ ...b, refusalFt: null, depthFt: 10 })), () => null), box, 10000)
near(pwrCut.pwrCy, 6 * cyPerFt, 2, 'PWR found from 96 to the bottoms at 90: 6 ft of PWR…')
near(pwrCut.unexploredCy, 5 * cyPerFt, 2, '…and the 5 ft cut below where they stopped is unexplored')
near(pwrCut.rockCy, 0, 0.5, '…never rock')
const wet = B.rockCut(at(100, 90), B.layers(sq.map((b) => ({ ...b, waterFt: 5 })), () => null), box, 10000)
near(wet.belowWaterSf, (100 * 100) / (FT * FT), 5, 'grade below the water line: the whole square is flagged')
const dry = B.rockCut(at(100, 90), B.layers(sq.map((b) => ({ ...b, depthFt: 6 })), () => null), box, 10000)
near(dry.belowWaterSf, 0, 0.5, 'borings that found no water never flag water')
// Unsuitable to 2 ft: a 1-ft fill leaves all of it under the work; a 10-ft cut digs it (minus nothing left).
const softFill = B.rockCut(at(100, 101), B.layers(sq.map((b) => ({ ...b, unsuitableFt: 2 })), () => null), box, 10000)
near(softFill.undercutCy, 2 * cyPerFt, 2, 'unsuitable soil to 2 ft under a fill: 2 ft of undercut')
near(softFill.unsuitableInCutCy, 0, 0.5, '…and none of it is in a cut')
const softCut = B.rockCut(at(100, 90), B.layers(sq.map((b) => ({ ...b, unsuitableFt: 2 })), () => null), box, 10000)
near(softCut.undercutCy, 0, 0.5, 'a 10 ft cut digs the unsuitable soil out — no undercut left…')
near(softCut.unsuitableInCutCy, 2 * cyPerFt, 2, '…and 2 ft of the cut is unsuitable (waste it)')
const fillSite = B.rockCut(at(100, 99), B.layers(sq.map((b) => ({ ...b, fillFt: 3 })), () => null), box, 10000)
near(fillSite.fillInCutCy, 1 * cyPerFt, 2, 'existing fill to 3 ft, cut 1 ft: 1 ft of the cut is existing fill')
near(fillSite.fillLeftCy, 2 * cyPerFt, 2, '…and 2 ft of it stays under the work')
const beyond = B.rockCut(at(100, 90), B.layers([bor('X', 0, 0), bor('Y', 10, 0), bor('Z', 0, 10)], () => null), box, 10000)
ok(beyond.beyondSf > 0.9 * (100 * 100) / (FT * FT), 'three borings in a corner: most of the site is beyond them, and says so')

// ── against the existing ground ──
const chk = B.checkAgainstGround([bor('L-1', 0, 0, { groundFt: 101 }), bor('L-2', 1, 0, { groundFt: 103 }), bor('L-3', 2, 0, { groundFt: null })], () => 101.5)
ok(chk[0].flag === false && chk[1].flag === true && chk[2].flag === false && chk[1].diffFt === 1.5, `the log 1.5 ft above the ground is flagged; within a foot is not; no log elevation can't be checked (${JSON.stringify(chk)})`)
ok(G.shallowerWater(8, 6) === 6 && G.shallowerWater(null, 6) === 6 && G.shallowerWater(null, null) === null, 'water: the shallower of the drilling and 24-hour readings')

// ── through a real takeoff run (feet around Greenville) ──
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
  { id: 'b', kind: 'boundary', coords: rect(0, 0, 200, 200) },
  { id: 'p', kind: 'platform', coords: rect(0, 0, 200, 200), z: 290, offsetIn: 0, label: 'Pad' },
] }
const run = tk.runTakeoff(design, grid(() => 300, -20, -20, 220, 220))
const logAt = (name, xf, yf, o = {}) => {
  const [lng, lat] = ll(xf, yf)
  return { id: name, name, kind: 'boring', lat, lng, groundFt: 300, depthFt: 12, topsoilIn: 6, fillFt: null, pwrFt: 4, refusalFt: 6, waterFt: null, water24hFt: null, unsuitableFt: null, ...o }
}
const site = [logAt('B-1', 0, 0), logAt('B-2', 200, 0), logAt('B-3', 200, 200), logAt('B-4', 0, 200), logAt('B-5', 100, 100), logAt('B-9', 20000, 0)]
const g = G.groundResults(run.ctx, site, 60_000)
const cyFt = (200 * 200) / 27
near(run.results.cutCy, 10 * cyFt, 1, 'the takeoff: a 10 ft cut over 200×200 ft')
near(g.rock.rockCy, 4 * cyFt, 0.01 * 4 * cyFt, 'through the takeoff: rock below 294 to the pad at 290 = 4 ft over the pad')
near(g.rock.pwrCy, 2 * cyFt, 0.01 * 2 * cyFt, '…PWR 296–294 = 2 ft')
near(g.rock.sampledCutCy, run.results.cutCy, 0.01 * run.results.cutCy, '…the sampled cut matches the takeoff\'s exact cut within 1%')
ok(g.borings === 5 && g.far.length === 1 && g.far[0] === 'B-9', `a boring 4 miles off is left out, by name (${JSON.stringify(g.far)})`)
ok(g.checks.every((c) => !c.flag && c.groundFt === 300), 'every log agrees with the lidar at 300 ft')
const words = G.groundWords(g, run.results.boundarySf)
ok(words[0].startsWith('Rock:') && words.some((w) => w.startsWith('Left out one log')), `plain words, rock first (${JSON.stringify(words)})`)
const off = G.groundResults(run.ctx, site.map((b) => (b.id === 'B-5' ? { ...b, groundFt: 303 } : b)), 60_000)
ok(off.checks.find((c) => c.id === 'B-5').flag && G.groundWords(off, run.results.boundarySf).some((w) => w.startsWith('B-5: its log puts the ground 3.0 ft above')), 'a log 3 ft above the lidar is named')
ok(G.groundResults(run.ctx, [], 60_000) === null, 'no borings: nothing to say')
const allFar = G.groundResults(run.ctx, [logAt('Z-1', 20000, 20000)], 60_000)
ok(allFar.rock === null && G.groundWords(allFar, 1)[0].startsWith('No boring sits within 1 km'), 'only far borings: no numbers, and it says why')

// ── a pasted geotech table ──
{
  const t = [
    'Boring No.\tLatitude\tLongitude\tGround Elev. (ft)\tBoring Depth (ft)\tTopsoil (in.)\tPWR (ft)\tAuger Refusal (ft)\tGroundwater at Drilling (ft)\tGroundwater (24 hr)\tRemarks',
    'B-1\t34.85261\t-82.39410\t301.2\t20\t6"\t8.5\t14.5\tNone\tNE\tSPT every 2.5 ft',
    'B-2\t34.85301\t-82.39388\t—\t25\t4\t—\tNone\t18.0\t16.5\t',
    'TP-1\t34.85280\t-82.39400\t\t6\t5\t\t\tDry\t\t',
    'B-3\t34.8529\t-82.3940\t300\t12\t4\t\t14\t\t\t',
    'B-4\tabc\t-82.39\t300\t12\t4\t\t\t\t\t',
  ].join('\n')
  const r = P.parseBorings(t)
  ok(r.rows.length === 3 && r.skipped.length === 2, `three good rows, two skipped (${JSON.stringify(r.skipped)})`)
  const b1 = r.rows[0].boring
  ok(b1.name === 'B-1' && b1.groundFt === 301.2 && b1.depthFt === 20 && b1.topsoilIn === 6 && b1.pwrFt === 8.5 && b1.refusalFt === 14.5 && b1.waterFt === null && b1.water24hFt === null && b1.note === 'SPT every 2.5 ft', `B-1 read as logged (${JSON.stringify(b1)})`)
  const b2 = r.rows[1].boring
  ok(b2.groundFt === null && b2.refusalFt === null && b2.waterFt === 18 && b2.water24hFt === 16.5, `"—" and "None" read as not encountered; both water readings kept (${JSON.stringify(b2)})`)
  ok(r.rows[2].boring.kind === 'pit' && r.rows[0].boring.kind === 'boring', 'TP-1 is a test pit by its name')
  ok(r.skipped.some((x) => /refusal at 14 ft is deeper than the boring went/.test(x.why)) && r.skipped.some((x) => /isn't a number/.test(x.why)), 'refusal below the bottom and a bad number are named')
  ok(r.columns.includes('water at 24 h') && r.columns.includes('refusal at'), `headings matched by alias (${r.columns.join(', ')})`)
  const [e, n] = SP.toStatePlane(-82.3941, 34.85261)
  const sp = P.parseBorings(`Name,Northing,Easting,Depth\nB-7,${n.toFixed(2)},${e.toFixed(2)},15`)
  ok(sp.rows.length === 1 && Math.abs(sp.rows[0].boring.lat - 34.85261) < 1e-6 && Math.abs(sp.rows[0].boring.lng + 82.3941) < 1e-6, 'SC State Plane N/E come back to the same lat/lng')
  const swap = P.parseBorings(`Name,Northing,Easting,Depth\nB-8,${e.toFixed(2)},${n.toFixed(2)},15`)
  ok(swap.rows.length === 1 && Math.abs(swap.rows[0].boring.lat - 34.85261) < 1e-6, 'northing and easting swapped by the report: put right')
  const local = P.parseBorings('Name,N,E,Depth\nB-9,5000,5000,15')
  ok(!local.rows.length && /local site grid/.test(local.skipped[0]?.why ?? ''), 'a local site grid (N 5000 / E 5000) is refused, never placed')
  ok(!!P.parseBorings('just some text').error, 'no header row: says what it needs')
  {
    // Every label the panel echoes back must itself read as a heading — the doc lists them that way (truth-check, Nov 8).
    const labels = Object.values(P.WORDS)
    const echo = P.parseBorings(labels.join('\t') + '\n' + labels.map(() => '').join('\t'))
    ok(echo.columns.length === labels.length, `every echoed label reads back as a heading (${echo.columns.length}/${labels.length})`)
  }
  ok(P.readNumber("12.5'") === 12.5 && P.readNumber('@ 8 ft bgs') === 8 && P.readNumber('NE') === null && P.readNumber('none') === null && P.readNumber('x') === 'bad', 'values read the way logs write them')
  ok(P.boringProblem({ ...b1, pwrFt: 16, refusalFt: 14.5 })?.includes('below refusal'), 'PWR below refusal is refused')
  const refOnly = P.parseBorings('Boring,Lat,Lng,Refusal\nB-1,34.85,-82.39,9.5')
  ok(refOnly.error?.includes('Depth') ?? false, 'a table with no depth column says it needs one')
}

console.log(`\nborings: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
