/**
 * The dirt takeoff, asserted (run: node scripts/dirt-test.mjs).
 *
 * lib/dirt/* turns traced plans + lidar into the three numbers that go into a
 * bid — topsoil CY, cut/fill, import/export. Bids are won and lost on them, so
 * this checks shapes with EXACT answers (a flat pad, a sloped plane split at
 * its zero line, vertical construction-thickness deducts, overlapping pads,
 * a planar TIN from traced contours), the projection against a published UTM
 * value, and a brute-force fuzz: random ground, random design, random areas,
 * integrated exactly and by a fine sample grid — the two must agree.
 * Run after ANY change to lib/dirt/*.
 */
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
const surfUrl = transpile('../lib/dirt/surface.ts', {
  delaunator: npm('delaunator'), '@kninnug/constrainautor': npm('@kninnug/constrainautor'), './geom': geomUrl,
})
const tkUrl = transpile('../lib/dirt/takeoff.ts', { earcut: npm('earcut'), './tm': tmUrl, './geom': geomUrl, './surface': surfUrl })
const heatUrl = transpile('../lib/dirt/heat.ts', { './takeoff': tkUrl, './geom': geomUrl })
const tm = await import(tmUrl)
const geom = await import(geomUrl)
const surf = await import(surfUrl)
const tk = await import(tkUrl)
const heat = await import(heatUrl)

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => Number.isFinite(a) && Math.abs(a - b) <= eps

const FT = 0.3048
const CY = 27 // ft³

// ── Projection ─────────────────────────────────────────────────────────────
{
  // 40°N on a central meridian: northing = k0 × meridian arc = 4,427,757.219 m.
  const p = tm.utmParams(13)
  const [e, n] = tm.tmForward(p, -105, 40)
  ok('UTM: 40°N on the central meridian easting', near(e, 500000, 1e-6), e)
  ok('UTM: 40°N northing matches the published 4,427,757.22', near(n, 4427757.22, 0.02), n)
  const [lng, lat] = tm.tmInverse(p, e + 1234.5, n - 987.6)
  const [e2, n2] = tm.tmForward(p, lng, lat)
  ok('UTM: inverse then forward round-trips to < 1 mm', near(e2, e + 1234.5, 1e-3) && near(n2, n - 987.6, 1e-3), [e2 - e - 1234.5, n2 - n + 987.6])
  ok('UTM: scale 0.9996 on the central meridian', near(tm.scaleAt(p, -105, 40), 0.9996, 1e-7), tm.scaleAt(p, -105, 40))
  // Greenville sits 1.39° west of zone 17's meridian: k a little above 0.9996.
  const kg = tm.scaleAt(tm.utmParams(17), -82.394, 34.8526)
  ok('UTM: Greenville scale factor ≈ 0.99980', near(kg, 0.9998, 0.00002), kg)
  ok('UTM zone for Greenville is 17', tm.utmZone(-82.394) === 17)
  const f = tm.makeFrame(-82.394, 34.8526)
  const [x, y] = tm.toFrame(f, -82.394, 34.8526)
  ok('Frame origin is within a metre of the site', Math.abs(x) < 1 && Math.abs(y) < 1, [x, y])
}

// ── Exact integrals ───────────────────────────────────────────────────────
{
  // d = 1 at one corner, -1 at the other two over a unit-area triangle.
  const [p, n] = geom.triPosNeg(1, 1, -1, -1)
  // lone positive: A p³/(3(p-q)(p-r)) = 1/(3·2·2) = 1/12
  ok('triPosNeg: lone positive corner = A·p³/(3(p−q)(p−r))', near(p, 1 / 12, 1e-12), p)
  ok('triPosNeg: pos − neg = mean × area', near(p - n, -1 / 3, 1e-12), p - n)
  const [p2, n2] = geom.triPosNeg(2, 0, 0, 3)
  ok('triPosNeg: all ≥ 0 → all positive', near(p2, 2, 1e-12) && n2 === 0)
  const [p3, n3] = geom.triPosNeg(1, -1, 2, 2)
  ok('triPosNeg: lone negative corner', near(n3, 1 / 27, 1e-12) && near(p3 - n3, 1, 1e-12), [p3, n3])
  // A square split by a line through its middle: d = x − 0.5 on [0,1]².
  const sq = [0, 0, 1, 0, 1, 1, 0, 1]
  const [ps, ns] = geom.polyPosNeg(sq, [-0.5, 0.5, 0.5, -0.5])
  ok('polyPosNeg: symmetric split square = 1/8 each side', near(ps, 0.125, 1e-12) && near(ns, 0.125, 1e-12), [ps, ns])
  // Clipping: unit square ∩ triangle covering its lower-left half.
  const c = geom.clipByTriangle(sq, 0, 0, 2, 0, 0, 2)
  ok('clipByTriangle: square ∩ big triangle = square', near(geom.polyArea(c), 1, 1e-12), geom.polyArea(c))
  const c2 = geom.clipByTriangle(sq, 0, 0, 1, 0, 0, 1)
  ok('clipByTriangle: square ∩ half triangle = 0.5', near(geom.polyArea(c2), 0.5, 1e-12), geom.polyArea(c2))
  const parts = geom.splitByLine(sq, 0.25, -1, 0.25, 2)
  ok('splitByLine: two pieces, areas 0.25 + 0.75', parts.length === 2 && near(parts.map(geom.polyArea).sort()[0], 0.25, 1e-12))
  ok('segmentCrosses: a segment ending before the polygon does not cross', !geom.segmentCrosses(sq, 0.5, 2, 0.5, 1.5))
  ok('segmentCrosses: a segment through the middle crosses', geom.segmentCrosses(sq, 0.5, -1, 0.5, 2))
  ok('segmentCrosses: a segment along an edge does not', !geom.segmentCrosses(sq, -1, 0, 2, 0))
}

// ── Fixtures in TRUE feet around Greenville ───────────────────────────────
const T = tm.makeFrame(-82.394, 34.8526, 17)
const ll = (xf, yf) => tm.fromFrame(T, xf * FT * T.k, yf * FT * T.k)
const rect = (x0, y0, x1, y1) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)]
/** Lidar-style grid over [x0,x1]×[y0,y1] feet, nodes every `stepM` UTM metres, z(feet) = f(x, y) in true feet. */
function grid(f, x0, y0, x1, y1, stepM = 1) {
  const xm0 = x0 * FT * T.k, ym0 = y0 * FT * T.k
  const nx = Math.ceil(((x1 - x0) * FT * T.k) / stepM) + 1
  const ny = Math.ceil(((y1 - y0) * FT * T.k) / stepM) + 1
  const z = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const xf = (xm0 + i * stepM) / T.k / FT, yf = (ym0 + j * stepM) / T.k / FT
    z[j * nx + i] = f(xf, yf) * FT
  }
  return { zone: 17, epsg: 26917, x0: T.e0 + xm0, y0: T.n0 + ym0, dx: stepM, dy: stepM, nx, ny, z, source: 'test grid', resolutionM: stepM }
}
let fid = 0
const F = (kind, coords, extra = {}) => ({ id: `f${++fid}`, kind, coords, ...extra })
const design = (features, extra = {}) => ({ v: 1, features, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 }, ...extra })

// ── 1. Flat ground, a pad 1 ft above it ───────────────────────────────────
{
  const g = grid(() => 300, -20, -20, 120, 120)
  const d = design([
    F('boundary', rect(0, 0, 100, 100)),
    F('platform', rect(0, 0, 100, 100), { z: 301, offsetIn: 0, label: 'Pad' }),
  ])
  const { results: r } = tk.runTakeoff(d, g)
  ok('Pad: 1 ft of fill over 100×100 ft = 370.37 CY', near(r.fillCy, 10000 / CY, 0.05), r.fillCy)
  ok('Pad: no cut', near(r.cutCy, 0, 0.05), r.cutCy)
  ok('Pad: import 370.4 CY, no export', near(r.importCy, 370.4, 0.1) && r.exportCy === 0, [r.importCy, r.exportCy])
  ok('Pad: grading limits measure 10,000 SF', near(r.boundarySf, 10000, 1), r.boundarySf)
  ok('Pad: the whole limit is covered', r.coveredPct > 99.9, r.coveredPct)
  ok('Pad: platform row reports finished floor and subgrade', r.platforms[0]?.ffeFt === 301 && r.platforms[0]?.subgradeFt === 301 && near(r.platforms[0]?.sf, 10000, 1), r.platforms)
  // Default −8" offset: subgrade = FFE − 0.667 ft.
  const d2 = design([F('boundary', rect(0, 0, 100, 100)), F('platform', rect(0, 0, 100, 100), { z: 301 + 8 / 12 })])
  const r2 = tk.runTakeoff(d2, g).results
  ok('Pad: −8" default offset puts subgrade at FFE − 0.667 ft', near(r2.fillCy, 10000 / CY, 0.05) && near(r2.platforms[0].subgradeFt, 301, 0.01), [r2.fillCy, r2.platforms[0]])
  // Truckloads round up.
  ok('Pad: 370.4 CY import at 12 CY a load = 31 loads', r.loads === 31, r.loads)
  // Shrink 10% grows the fill to 407.4 bank CY.
  const d3 = design(d.features, { settings: { shrinkPct: 10, truckCy: 14 } })
  const r3 = tk.runTakeoff(d3, g).results
  ok('Shrink 10%: fill needs 407.4 bank CY', near(r3.fillAdjCy, 407.4, 0.1) && near(r3.importCy, 407.4, 0.1), [r3.fillAdjCy, r3.importCy])
  ok('Shrink 10%: 30 loads at 14 CY', r3.loads === 30, r3.loads)
}

// ── 2. Sloped ground, flat pad: the zero line splits it in half ───────────
{
  // z = 300 + 0.02x; subgrade 301 → fill on x<50, cut on x>50, 2,500 ft³ each.
  const g = grid((x) => 300 + 0.02 * x, -20, -20, 120, 120)
  const d = design([
    F('boundary', rect(0, 0, 100, 100)),
    F('platform', rect(0, 0, 100, 100), { z: 301, offsetIn: 0 }),
  ])
  const { results: r } = tk.runTakeoff(d, g)
  ok('Slope: fill 2,500 ft³ = 92.59 CY', near(r.fillCy, 2500 / CY, 0.05), r.fillCy)
  ok('Slope: cut 2,500 ft³ = 92.59 CY', near(r.cutCy, 2500 / CY, 0.05), r.cutCy)
  ok('Slope: balances on site', near(r.onsiteCy, 92.6, 0.1) && r.importCy < 0.1 && r.exportCy < 0.1, [r.onsiteCy, r.importCy, r.exportCy])
  ok('Slope: deepest fill 1 ft, deepest cut 1 ft', near(r.maxFillFt, 1, 0.01) && near(r.maxCutFt, 1, 0.01), [r.maxFillFt, r.maxCutFt])
}

// ── 3. Vertical deducts: topsoil + an asphalt section, no regrade ─────────
{
  const g = grid(() => 300, -20, -20, 120, 120)
  const d = design([
    F('boundary', rect(0, 0, 100, 100)),
    F('reduce', rect(25, 25, 75, 75), { thicknessIn: 8, label: 'Light duty asphalt' }),
  ])
  const r = tk.runTakeoff(d, g).results
  ok('Asphalt 8" on 50×50 with no regrade: 1,666.7 ft³ = 61.73 CY of cut (walls exactly vertical)', near(r.cutCy, (2500 * 8 / 12) / CY, 0.02), r.cutCy)
  ok('Asphalt: no fill', near(r.fillCy, 0, 0.02), r.fillCy)
  ok('Asphalt: finished grade = existing when nothing is proposed', r.proposedFromExisting === true)
  ok('Asphalt: reduce row 2,500 SF @ 8"', r.reduce[0]?.sf === 2500 && r.reduce[0]?.thicknessIn === 8, r.reduce)

  // Add 3" topsoil over the whole site: it is stripped first, so the asphalt
  // undercut shrinks by 3" and the rest of the site needs 3" back as fill.
  const d2 = design([...d.features, F('topsoil', rect(0, 0, 100, 100), { thicknessIn: 3 })])
  const r2 = tk.runTakeoff(d2, g).results
  ok('Topsoil 3" over 10,000 SF = 92.59 CY', near(r2.topsoil.cy, 2500 / CY, 0.02) && near(r2.topsoil.sf, 10000, 1), r2.topsoil)
  ok('Topsoil: asphalt cut drops to 5" × 2,500 SF = 38.58 CY', near(r2.cutCy, (2500 * 5 / 12) / CY, 0.02), r2.cutCy)
  ok('Topsoil: 3" of fill back over the other 7,500 SF = 69.44 CY', near(r2.fillCy, (7500 * 3 / 12) / CY, 0.02), r2.fillCy)
}

// ── 4. Overlapping areas: the one drawn last wins ─────────────────────────
{
  const g = grid(() => 300, -20, -20, 120, 120)
  const d = design([
    F('boundary', rect(0, 0, 100, 100)),
    F('reduce', rect(20, 20, 80, 80), { thicknessIn: 8, label: 'Asphalt' }),
    F('reduce', rect(40, 40, 60, 60), { thicknessIn: 6, label: 'Concrete' }),
  ])
  const r = tk.runTakeoff(d, g).results
  const asp = r.reduce.find(x => x.label === 'Asphalt'), con = r.reduce.find(x => x.label === 'Concrete')
  ok('Overlap: asphalt keeps 3,200 SF (its 400 SF under the concrete is gone)', asp?.sf === 3200, asp)
  ok('Overlap: concrete 400 SF', con?.sf === 400, con)
  ok('Overlap: cut = 3,200×8" + 400×6" = 2,333.3 ft³ = 86.42 CY', near(r.cutCy, (3200 * 8 / 12 + 400 * 6 / 12) / CY, 0.02), r.cutCy)
  // Drawn the other way round the big area wins everywhere.
  const d2 = design([d.features[0], d.features[2], d.features[1]])
  const r2 = tk.runTakeoff(d2, g).results
  ok('Overlap reversed: asphalt drawn last covers the pad entirely', r2.reduce.find(x => x.label === 'Concrete')?.sf === 0 && near(r2.cutCy, (3600 * 8 / 12) / CY, 0.02), [r2.reduce, r2.cutCy])
  // A platform beats a reduce area under it.
  const d3 = design([
    F('boundary', rect(0, 0, 100, 100)),
    F('platform', rect(30, 30, 70, 70), { z: 300, offsetIn: -8 }),
    F('reduce', rect(0, 0, 100, 100), { thicknessIn: 4, label: 'Topsoil respread' }),
  ])
  const r3 = tk.runTakeoff(d3, g).results
  ok('Pad beats paving: 1,600 SF at 8" + 8,400 SF at 4" = 3,866.7 ft³', near(r3.cutCy, (1600 * 8 / 12 + 8400 * 4 / 12) / CY, 0.05), r3.cutCy)
}

// ── 5. Demo ────────────────────────────────────────────────────────────────
{
  const g = grid(() => 300, -20, -20, 120, 120)
  const d = design([
    F('boundary', rect(0, 0, 100, 100)),
    F('demo', rect(10, 10, 50, 50), { thicknessIn: 4, label: 'Asphalt' }),
    F('demo', rect(60, 60, 80, 80), { thicknessIn: 6, label: 'Concrete' }),
  ])
  const r = tk.runTakeoff(d, g).results
  const a = r.demo.find(x => x.label === 'Asphalt'), c = r.demo.find(x => x.label === 'Concrete')
  ok('Demo: asphalt 1,600 SF × 4" = 19.75 CY', a?.sf === 1600 && near(a?.cy, 1600 * 4 / 12 / CY, 0.01), a)
  ok('Demo: concrete 400 SF × 6" = 7.41 CY', c?.sf === 400 && near(c?.cy, 400 * 6 / 12 / CY, 0.01), c)
  ok('Demo: the demo holes come back as fill to existing grade', near(r.fillCy, (1600 * 4 / 12 + 400 * 6 / 12) / CY, 0.02), r.fillCy)
}

// ── 6. Traced existing contours (Kubla's way) ──────────────────────────────
{
  // Existing contours every 10 ft in x: z = 300 + 0.1x, run past the limits in y.
  const contours = []
  for (let x = 0; x <= 50; x += 10) contours.push(F('eg_contour', [ll(x, -10), ll(x, 20), ll(x, 60)], { z: 300 + x / 10 }))
  const d = design([
    ...contours,
    F('boundary', rect(5, 0, 45, 40)),
    F('platform', rect(5, 0, 45, 40), { z: 302.5, offsetIn: 0 }),
  ], { existing: { source: 'traced', offsetFt: 0 } })
  const r = tk.runTakeoff(d, null).results
  ok('Traced: the plane between contours is exact — 800 ft³ fill = 29.63 CY', near(r.fillCy, 800 / CY, 0.02), r.fillCy)
  ok('Traced: and 800 ft³ cut', near(r.cutCy, 800 / CY, 0.02), r.cutCy)
  ok('Traced: existing source reads traced', r.existing.source === 'traced')
  ok('Traced: no constraint was dropped', r.diagnostics.droppedEdges === 0, r.diagnostics)

  // Two existing contours crossing: one segment can't be honoured — say so.
  const bad = design([
    ...contours,
    F('eg_contour', [ll(-5, 30), ll(55, 30)], { z: 303 }),
    F('boundary', rect(5, 0, 45, 40)),
  ], { existing: { source: 'traced', offsetFt: 0 } })
  const rb = tk.runTakeoff(bad, null).results
  ok('Traced: a contour crossing others is reported', rb.diagnostics.droppedEdges > 0 && rb.warnings.some(w => /cross/.test(w)), rb.warnings)
}

// ── 7. Proposed contours tie into existing at the grading limits ──────────
{
  // Flat existing at 300; a proposed mound: contour 301 around a 302 spot,
  // all inside the limits. Fill must be positive, no cut, and the tie-in
  // means nothing changes at the limits.
  const g = grid(() => 300, -20, -20, 120, 120)
  const ring = []
  for (let k = 0; k < 24; k++) { const a = (2 * Math.PI * k) / 24; ring.push(ll(50 + 20 * Math.cos(a), 50 + 20 * Math.sin(a))) }
  ring.push(ring[0])
  const d = design([
    F('boundary', rect(10, 10, 90, 90)),
    F('fg_contour', ring, { z: 301 }),
    F('fg_spot', [ll(50, 50)], { z: 302 }),
  ])
  const r = tk.runTakeoff(d, g).results
  ok('Mound: fill, no cut', r.fillCy > 10 && r.cutCy < 0.01, [r.fillCy, r.cutCy])
  ok('Mound: deepest fill = the 2 ft spot', near(r.maxFillFt, 2, 0.01), r.maxFillFt)
  ok('Mound: proposed sits ~1 ft above existing (datum looks right, no warning)', !r.warnings.some(w => /datum/.test(w)), r.warnings)

  // Same plan on an assumed datum (100.00): the datum check speaks up.
  const off = design(d.features.map(f => (f.z != null ? { ...f, z: f.z - 200 } : f)))
  const ro = tk.runTakeoff(off, g).results
  ok('Datum: a plan 200 ft below the lidar is flagged', ro.warnings.some(w => /assumed datum/.test(w)), ro.warnings)
  // Traced existing spots on the plan datum suggest the offset.
  const tie = design([...off.features, F('eg_spot', [ll(15, 15)], { z: 100 }), F('eg_spot', [ll(85, 85)], { z: 100 })])
  const rt = tk.runTakeoff(tie, g).results
  ok('Datum: traced existing spots measure the offset (−200 ft)', near(rt.datum.planExistingMinusLidarFt, -200, 0.01), rt.datum)
  const fixed = design(off.features, { existing: { source: 'lidar', offsetFt: -200 } })
  const rf = tk.runTakeoff(fixed, g).results
  ok('Datum: with the −200 ft offset the volumes match the NAVD88 run', near(rf.fillCy, r.fillCy, 0.05), [rf.fillCy, r.fillCy])
}

// ── 8. Missing ground ──────────────────────────────────────────────────────
{
  const g = grid(() => 300, -20, -20, 120, 120)
  // Knock a hole in the lidar (water, a tile edge).
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const xf = (g.x0 - T.e0 + i * g.dx) / T.k / FT
    if (xf > 60) g.z[j * g.nx + i] = NaN
  }
  const d = design([F('boundary', rect(0, 0, 100, 100)), F('platform', rect(0, 0, 100, 100), { z: 301, offsetIn: 0 })])
  const r = tk.runTakeoff(d, g).results
  ok('Gap: coverage reported below 100%', r.coveredPct < 70 && r.coveredPct > 50, r.coveredPct)
  ok('Gap: a warning names it', r.warnings.some(w => /covers only/.test(w)), r.warnings)
  const none = tk.runTakeoff(d, null).results
  ok('No lidar: says to trace existing instead', none.existing.source === 'none' && none.warnings.some(w => /trace the existing/.test(w)), none.warnings)
  const nob = tk.runTakeoff(design([F('platform', rect(0, 0, 100, 100), { z: 301 })]), g).results
  ok('No grading limits: asks for them', nob.warnings.some(w => /grading limits/.test(w)) && nob.cutCy === 0 && nob.fillCy === 0, nob.warnings)
}

// ── 9. Fuzz: exact integration vs a brute-force sample grid ───────────────
{
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  let worst = 0, cases = 0
  for (let c = 0; c < 6; c++) {
    const bumps = Array.from({ length: 4 }, () => [rnd() * 100, rnd() * 100, 0.5 + rnd() * 3, 10 + rnd() * 25])
    const f = (x, y) => 300 + 0.01 * x - 0.015 * y + bumps.reduce((s, [bx, by, h, r]) => s + h * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (r * r)), 0)
    const g = grid(f, -30, -30, 130, 130, 1.5)
    const feats = [F('boundary', [ll(5, 8), ll(95, 3), ll(98, 92), ll(40, 97), ll(2, 60)])]
    for (let k = 0; k < 5; k++) {
      const z = 300 + rnd() * 4
      const pts = []
      const cx = 20 + rnd() * 60, cy = 20 + rnd() * 60
      for (let a = 0; a < 7; a++) pts.push(ll(cx + (8 + k * 3) * Math.cos(a), cy + (6 + k * 2) * Math.sin(a)))
      feats.push(F('fg_spot', [ll(cx, cy)], { z }))
    }
    feats.push(F('fg_contour', [ll(15, 20), ll(50, 25), ll(85, 20)], { z: 301 }))
    feats.push(F('reduce', rect(30 + rnd() * 10, 30, 70, 60 + rnd() * 10), { thicknessIn: 8 }))
    feats.push(F('reduce', rect(45, 40 + rnd() * 5, 60, 55), { thicknessIn: 4 }))
    feats.push(F('topsoil', rect(0, 0, 100, 100), { thicknessIn: 2 + rnd() * 3 }))
    feats.push(F('demo', rect(60, 10, 80 + rnd() * 10, 30), { thicknessIn: 4 }))
    feats.push(F('platform', rect(10, 60, 30, 85), { z: 301 + rnd(), offsetIn: -8 }))
    const d = design(feats)
    const { results: r, ctx } = tk.runTakeoff(d, g)
    // Brute force: a fine sample grid with the same surfaces and area rules.
    const look = tk.lookups(ctx)
    const b = ctx.domain
    const h = 0.05 // m
    let fill = 0, cut = 0
    for (let y = b.y0 + h / 2; y < b.y1; y += h) {
      for (let x = b.x0 + h / 2; x < b.x1; x += h) {
        const p = tk.pointAt(ctx, look, x, y)
        if (!p.inside || !Number.isFinite(p.eg) || !Number.isFinite(p.sg)) continue
        const dd = p.sg - p.eg
        if (dd > 0) fill += dd * h * h
        else cut -= dd * h * h
      }
    }
    const k2 = ctx.frame.k ** 2
    const bf = fill / k2 / 0.764554857984, bc = cut / k2 / 0.764554857984
    const e1 = Math.abs(bf - r.fillCy) / Math.max(10, bf), e2 = Math.abs(bc - r.cutCy) / Math.max(10, bc)
    worst = Math.max(worst, e1, e2)
    cases++
    ok(`Fuzz ${c + 1}: fill agrees with brute force within 0.5% (or 0.05 CY on tiny totals)`, e1 < 0.005, { exact: r.fillCy, brute: +bf.toFixed(2) })
    ok(`Fuzz ${c + 1}: cut agrees with brute force within 0.5% (or 0.05 CY on tiny totals)`, e2 < 0.005, { exact: r.cutCy, brute: +bc.toFixed(2) })
  }
  console.log(`  fuzz: ${cases} random sites, worst exact-vs-brute difference ${(worst * 100).toFixed(3)}%`)
}

// ── 10. Heat map ───────────────────────────────────────────────────────────
{
  const g = grid((x) => 300 + 0.02 * x, -20, -20, 120, 120)
  const d = design([F('boundary', rect(0, 0, 100, 100)), F('platform', rect(0, 0, 100, 100), { z: 301, offsetIn: 0 })])
  const { ctx } = tk.runTakeoff(d, g)
  const hr = heat.heatRaster(ctx, { maxPx: 200 })
  ok('Heat: raster sized to the limits at the 0.25 m floor (100 ft = 122 px)', hr && hr.width === 122 && hr.height === 122, hr && [hr.width, hr.height])
  ok('Heat: four lng/lat corners, TL north-west of BR', hr.corners.length === 4 && hr.corners[0][1] > hr.corners[2][1] && hr.corners[0][0] < hr.corners[2][0], hr.corners)
  const px = (col, row) => Array.from(hr.rgba.slice((row * hr.width + col) * 4, (row * hr.width + col) * 4 + 4))
  const mid = Math.floor(hr.height / 2)
  const west = px(5, mid), east = px(hr.width - 6, mid)
  ok('Heat: the low west side is fill (blue)', west[2] > west[0] && west[3] > 0, west)
  ok('Heat: the high east side is cut (red)', east[0] > east[2] && east[3] > 0, east)
  ok('Heat: band width 0.25 ft for a 1 ft max', hr.bandFt === 0.25, hr.bandFt)
  const lg = heat.legendRows(0.5)
  ok('Heat legend: five bands per side, last one open-ended', lg.cut.length === 5 && lg.fill[4][0] === '2+ ft' && lg.fill[0][0] === '0–0.5 ft', lg.fill)
  ok('Heat: band choices widen for deep sites', heat.bandFor(12) === 5 && heat.bandFor(60) === 10 && heat.bandFor(0.8) === 0.25)
}

console.log(`dirt takeoff: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
