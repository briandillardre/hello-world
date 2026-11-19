// node scripts/survey-test.mjs — site survey (Beta, migration 163): rover
// shots in (lib/survey/shots.ts), the drone checked against them
// (lib/survey/check.ts), contours off a drone surface (lib/survey/contours.ts),
// the design re-fit to the curb as built and cut to top of stone / subgrade
// (lib/survey/refit.ts + asbuiltFiles in lib/machine/export.ts), and takeoff
// version legends (lib/dirt/versions.ts). Run it after ANY change to those —
// a wrong stone surface is a machine cutting to the wrong grade.
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
const spUrl = transpile('../lib/plans/stateplane.ts')
const shotsUrl = transpile('../lib/survey/shots.ts', { '../plans/stateplane': spUrl })
const S = await import(shotsUrl)
const C = await import(transpile('../lib/survey/check.ts', { './shots': shotsUrl }))
const K = await import(transpile('../lib/survey/contours.ts'))
const refitUrl = transpile('../lib/survey/refit.ts')
const R = await import(refitUrl)
const V = await import(transpile('../lib/dirt/versions.ts'))
const SP = await import(spUrl)
const tmUrl = transpile('../lib/dirt/tm.ts')
const geomUrl = transpile('../lib/dirt/geom.ts')
const surfUrl = transpile('../lib/dirt/surface.ts', { delaunator: npm('delaunator'), '@kninnug/constrainautor': npm('@kninnug/constrainautor'), './geom': geomUrl })
const tkUrl = transpile('../lib/dirt/takeoff.ts', { earcut: npm('earcut'), './tm': tmUrl, './geom': geomUrl, './surface': surfUrl })
const X = await import(transpile('../lib/machine/export.ts', { '../dirt/takeoff': tkUrl, '../dirt/tm': tmUrl, '../dirt/geom': geomUrl, '../dirt/surface': surfUrl, '../plans/stateplane': spUrl, './grid': transpile('../lib/machine/grid.ts', { '../plans/stateplane': spUrl }) }))
const tm = await import(tmUrl)
const tk = await import(tkUrl)

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const near = (a, b, tol, msg) => ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`)
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)

// ── shots ──
{
  const [e, n] = SP.toStatePlane(-82.394, 34.8526)
  const pnezd = [`101,${n.toFixed(3)},${e.toFixed(3)},301.25,LIP`, `102,${(n + 10).toFixed(3)},${e.toFixed(3)},301.30,FL`, `103,${(n + 20).toFixed(3)},${e.toFixed(3)},301.80,BOC`, `104,${(n + 30).toFixed(3)},${e.toFixed(3)},300.1,GCP 4`].join('\n')
  const p = S.parseShots(pnezd)
  eq(p.shots.length, 4, 'PNEZD without a header reads 4 shots')
  near(p.shots[0].lng, -82.394, 1e-6, 'state plane → lng'); near(p.shots[0].lat, 34.8526, 1e-6, 'state plane → lat')
  eq(p.shots.map((s) => s.kind), ['lip', 'flowline', 'curb_top', 'control'], 'codes → kinds')
  const head = S.parseShots(`Point,Easting,Northing,Elev,Desc\n1,${e},${n},301,EOP\n2,${n},${e},302,spot`)
  eq(head.shots.length, 2, 'header in any column order; swapped N/E put right')
  ok(head.problems.some((x) => /swapped/.test(x)), 'swap reported')
  const local = S.parseShots('1,5000.00,5000.00,100.0,LIP\n2,5010,5000,100.2,LIP')
  ok(local.shots.length === 0 && local.problems.some((x) => /local site grid/.test(x)), 'a local grid is refused with the reason')
  const ll = S.parseShots('lat,lng,z,code\n34.85,-82.39,301,LIP')
  eq([ll.coords, ll.shots.length], ['lnglat', 1], 'lat/lng with a header')
  ok(!S.parseShots('lat,lng,z\n134.85,-82.39,301').shots.length, 'impossible latitude skipped')
  eq(S.kindOf('TBC'), 'curb_top', 'TBC = top/back of curb'); eq(S.kindOf('GL 3'), 'lip', 'GL = gutter lip'); eq(S.kindOf('TREE'), 'spot', 'anything else = spot')
  eq(S.cleanShots([{ lng: -82, lat: 34, z: 300, code: 'FL' }, { lng: 500, lat: 34, z: 1 }]).length, 1, 'cleanShots drops a bad point')
}

// ── drone vs rover ──
{
  const shots = Array.from({ length: 40 }, (_, i) => ({ id: String(i), lng: -82.39 + i * 1e-5, lat: 34.85, z: 300 + i * 0.01, code: i < 20 ? 'LIP' : 'SPOT', kind: i < 20 ? 'lip' : 'spot' }))
  // drone 0.10 ft high everywhere, ±0.01 noise; one shot under a truck
  const r = C.checkShots(shots, (lng) => { const i = Math.round((lng + 82.39) / 1e-5); return i === 39 ? 300 + 39 * 0.01 + 3 : 300 + i * 0.01 + 0.1 + (i % 2 ? 0.01 : -0.01) }, new Date('2026-11-19T12:00:00Z'))
  near(r.all.bias, 0.1, 0.011, 'bias = the datum shift')
  ok(r.all.p95 <= 0.02, `p95 ignores one outlier (${r.all.p95})`)
  near(r.all.maxAbs, 2.9, 0.02, 'the outlier is still reported as the max')
  eq(r.verdict.level, 'curb', 'tight curb shots after the datum fix = good for the curb tie')
  ok(/high overall/.test(r.verdict.words), 'the bias is said in words')
  const loose = C.checkShots(shots, (lng) => { const i = Math.round((lng + 82.39) / 1e-5); return 300 + i * 0.01 + (i % 2 ? 0.06 : -0.06) }, new Date())
  eq(loose.verdict.level, 'subgrade', '±0.06 ft = subgrade only')
  const none = C.checkShots(shots.slice(0, 5), () => null, new Date())
  eq([none.verdict.level, none.missing], ['no', 5], 'no drone under the shots = no verdict, all missing')
  eq(C.dzColor(0.11, 0.1), '#2dd4bf', 'within ¼" after the bias = teal'); eq(C.dzColor(0.16, 0.1), '#f59e0b', 'over ½" = amber'); eq(C.dzColor(0.2, 0.1), '#ef4444', 'over 1" = red')
}

// ── contours ──
{
  const nx = 21, ny = 21, z = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 100 - Math.hypot(i - 10, j - 10) * 0.5 // a cone, peak 100
  const levels = K.contourLevels(95, 100, 1)
  eq(levels, [95, 96, 97, 98, 99, 100], 'levels on the interval')
  const lines = K.contours({ nx, ny, z }, levels, 1, 5)
  const l97 = lines.filter((l) => l.level === 97)
  eq(l97.length, 1, 'one closed ring at 97')
  const ring = l97[0].pts
  ok(Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 1e-6, 'the 97 ring closes')
  ok(ring.every(([x, y]) => Math.abs(Math.hypot(x - 10, y - 10) - 6) < 0.15), 'the 97 ring sits 6 cells from the peak')
  ok(lines.find((l) => l.level === 95).index && !l97[0].index, 'every 5th level is an index contour')
  const gappy = Float64Array.from(z); gappy[10 * nx + 16] = NaN
  ok(K.contours({ nx, ny, z: gappy }, [97], 1).length >= 1, 'a no-data cell breaks a line, never throws')
  const s = K.simplify([[0, 0], [1, 0.001], [2, 0], [3, 2]], 0.01)
  eq(s.length, 3, 'simplify drops a near-collinear point')
}

// ── correction field ──
{
  const f = R.correctionField([{ x: 0, y: 0, dz: 0.03 }, { x: 10, y: 0, dz: 0.05 }], 6)
  near(f.at(0, 0), 0.03, 1e-9, 'exact at a shot')
  near(f.at(10, 0), 0.05, 1e-9, 'exact at the other shot')
  ok(f.at(5, 0) > 0 && f.at(5, 0) < 0.05, 'blended between (and fading)')
  eq(f.at(30, 30), 0, 'nothing far from every shot')
  ok(Math.abs(f.at(3, 0)) > Math.abs(f.at(0, 5.5)), 'fades with distance from the curb')
  const sum = R.refitSummary([{ x: 0, y: 0, dz: 0.3048 * 0.1 }, { x: 1, y: 0, dz: -0.3048 * 0.05 }])
  ok(/high of the design on average/.test(sum.words) && sum.shotsUsed === 2, 'summary in words')
}

// ── as-built: re-fit the design to the curb, cut stone and subgrade ──
{
  const FT = 0.3048
  const T = tm.makeFrame(-82.394, 34.8526, 17)
  const ll = (xf, yf) => tm.fromFrame(T, xf * FT * T.k, yf * FT * T.k)
  const rect = (x0, y0, x1, y1) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)]
  const nx = 400, ny = 400, zg = new Float32Array(nx * ny).fill(299 * FT)
  const ground = { zone: 17, epsg: 26917, x0: T.e0 - 20, y0: T.n0 - 20, dx: 1, dy: 1, nx, ny, z: zg, source: 't', resolutionM: 1 }
  const spots = []
  for (let x = 0; x <= 300; x += 50) for (let y = 0; y <= 300; y += 50) spots.push([x, y])
  const design = { v: 1, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 }, features: [
    { id: 'lim', kind: 'boundary', coords: rect(0, 0, 300, 300) },
    { id: 'lot', kind: 'reduce', coords: rect(100, 100, 200, 200), thicknessIn: 8, label: 'Parking' },
    ...spots.map(([x, y], i) => ({ id: `s${i}`, kind: 'fg_spot', coords: [ll(x, y)], z: 300 })),
  ] }
  const ctx = tk.buildContext(design, ground)
  // the curb along the lot's west edge was poured 0.10 ft HIGH
  const shots = [100, 120, 140, 160, 180, 200].map((y) => { const [lng, lat] = ll(100, y); return { lng, lat, zFt: 300.10, kind: 'lip' } })
  shots.push({ ...shots[0], zFt: 300.6, kind: 'curb_top' }) // a curb top never drives the fit
  const f = X.asbuiltFiles(ctx, design, shots, { project: 'Lot', now: new Date('2026-11-19T12:00:00Z'), grid: 'sc', radiusFt: 40, asphaltIn: 2, kinds: ['lip', 'flowline'], correctionField: R.correctionField })
  eq(f.residualsFt.length, 6, 'only lip / flowline shots drive the fit')
  ok(f.residualsFt.every((r) => Math.abs(r - 0.1) < 0.002), `residuals are the curb's +0.10 ft (${f.residualsFt})`)
  ok(f.faces.fg > 0 && f.faces.stone > 0 && f.faces.sg > 0, `three surfaces (${JSON.stringify(f.faces)})`)
  ok((f.landxml.match(/<Surface name=/g) ?? []).length === 3, 'LandXML carries 3 surfaces')
  ok(/Top of stone/.test(f.landxml) && /Finished grade \(as-built fit\)/.test(f.landxml) && /epsgCode="2273"/.test(f.landxml), 'named surfaces, SC State Plane')
  // read the surfaces back: at the curb FG = 300.10; far from it FG = 300.00; stone = FG − 2"; subgrade = FG − 8"
  const pts = (name) => {
    const block = f.landxml.split('<Surface name="').find((b) => b.startsWith(name))
    return [...block.matchAll(/<P id="\d+">([\d.-]+) ([\d.-]+) ([\d.-]+)<\/P>/g)].map((m) => ({ n: +m[1], e: +m[2], z: +m[3] }))
  }
  const [ce, cn] = SP.toStatePlane(...ll(100, 150))
  const [fe, fn] = SP.toStatePlane(...ll(250, 250))
  const nearest = (list, e, n) => list.reduce((b, p) => (Math.hypot(p.e - e, p.n - n) < Math.hypot(b.e - e, b.n - n) ? p : b))
  const fgPts = pts('Finished grade'), stPts = pts('Top of stone'), sgPts = pts('Subgrade')
  const atCurb = nearest(fgPts, ce, cn)
  ok(Math.hypot(atCurb.e - ce, atCurb.n - cn) < 30, 'a FG point near the curb')
  near(nearest(fgPts, fe, fn).z, 300.0, 0.005, 'far from the curb the design is untouched')
  // inside the lot, 5 ft in from the curb: stone 2" and subgrade 8" below the re-fit FG at the same spot
  const [ie, in_] = SP.toStatePlane(...ll(150, 150))
  const fgIn = nearest(fgPts, ie, in_), stIn = nearest(stPts, ie, in_), sgIn = nearest(sgPts, ie, in_)
  ok(Math.hypot(stIn.e - fgIn.e, stIn.n - fgIn.n) < 1e-3, 'stone shares the FG vertex inside the lot')
  near(fgIn.z - stIn.z, 2 / 12, 0.002, 'top of stone = FG − 2" asphalt')
  near(fgIn.z - sgIn.z, 8 / 12, 0.002, 'subgrade = FG − 8" section')
  // the re-fit lifts FG near the curb
  const nearCurbIn = fgPts.filter((p) => Math.hypot(p.e - ce, p.n - cn) < 12)
  ok(nearCurbIn.length && nearCurbIn.some((p) => p.z > 300.05), 'FG lifted toward the built curb')
  let threw = ''
  try { X.asbuiltFiles(ctx, design, [{ ...shots[0], lng: -80, lat: 33 }], { project: 'x', now: new Date(), grid: 'sc', radiusFt: 40, asphaltIn: 2, kinds: ['lip'], correctionField: R.correctionField }) } catch (e) { threw = e.message }
  ok(/None of the pavement-edge shots/.test(threw), 'shots off the site are refused in words')
  const off = X.asbuiltFiles(ctx, design, shots.map((s) => ({ ...s, zFt: s.zFt + 2 })), { project: 'x', now: new Date(), grid: 'sc', radiusFt: 40, asphaltIn: 2, kinds: ['lip'], correctionField: R.correctionField })
  ok(off.warnings.some((w) => /vertical datum/.test(w)), 'a 2 ft miss warns about the datum')
}

// ── as-built on a SPARSE design: shots between vertices are met exactly ──
{
  const FT = 0.3048
  const T = tm.makeFrame(-82.394, 34.8526, 17)
  const ll = (xf, yf) => tm.fromFrame(T, xf * FT * T.k, yf * FT * T.k)
  const rect = (x0, y0, x1, y1) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)]
  const nx = 400, ny = 400, zg = new Float32Array(nx * ny).fill(299 * FT)
  const ground = { zone: 17, epsg: 26917, x0: T.e0 - 20, y0: T.n0 - 20, dx: 1, dy: 1, nx, ny, z: zg, source: 't', resolutionM: 1 }
  // spot grades 75 ft apart on a sloped plane — the design's vertices are sparse
  const spots = []
  for (let x = 0; x <= 300; x += 75) for (let y = 0; y <= 300; y += 75) spots.push([x, y])
  const design = { v: 1, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 }, features: [
    { id: 'lim', kind: 'boundary', coords: rect(0, 0, 300, 300) },
    { id: 'lot', kind: 'reduce', coords: rect(100, 100, 200, 200), thicknessIn: 8, label: 'Parking' },
    ...spots.map(([x, y], i) => ({ id: `s${i}`, kind: 'fg_spot', coords: [ll(x, y)], z: 300 + 0.01 * x + 0.02 * y })),
  ] }
  const ctx = tk.buildContext(design, ground)
  const designFt = (lng, lat) => { const [x, y] = tm.toFrame(ctx.frame, lng, lat); return ctx.fg.zAt(x, y) / FT }
  // between vertices, inside the lot; the first two are > 40 ft (the radius) from every design vertex
  const spec = [[112, 113, 0.2], [187, 112, -0.1], [150, 185, 0.15], [131, 160, 0.05]]
  const shots = spec.map(([x, y, dz]) => { const [lng, lat] = ll(x, y); return { lng, lat, zFt: designFt(lng, lat) + dz, kind: 'lip' } })
  const radiusFt = 40
  const f = X.asbuiltFiles(ctx, design, shots, { project: 'Sparse', now: new Date('2026-11-19T12:00:00Z'), grid: 'sc', radiusFt, asphaltIn: 2, kinds: ['lip', 'flowline'], correctionField: R.correctionField })
  ok(f.residualsFt.every((r, i) => Math.abs(r - spec[i][2]) < 0.002), `sparse residuals as placed (${f.residualsFt})`)
  const surf = (name) => {
    const block = f.landxml.split('<Surface name="').find((b) => b.startsWith(name))
    const pts = [...block.matchAll(/<P id="\d+">([\d.-]+) ([\d.-]+) ([\d.-]+)<\/P>/g)].map((m) => ({ n: +m[1], e: +m[2], z: +m[3] }))
    const faces = [...block.matchAll(/<F>(\d+) (\d+) (\d+)<\/F>/g)].map((m) => [+m[1] - 1, +m[2] - 1, +m[3] - 1])
    return { pts, faces }
  }
  // height of an output surface at (e, n): the triangle holding it, linear inside
  const zOn = (s, e, n) => {
    for (const [a, b, c] of s.faces) {
      const A = s.pts[a], B = s.pts[b], C = s.pts[c]
      const det = (B.e - A.e) * (C.n - A.n) - (C.e - A.e) * (B.n - A.n)
      if (Math.abs(det) < 1e-12) continue
      const u = ((e - A.e) * (C.n - A.n) - (C.e - A.e) * (n - A.n)) / det
      const v = ((B.e - A.e) * (n - A.n) - (e - A.e) * (B.n - A.n)) / det
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue
      return A.z + u * (B.z - A.z) + v * (C.z - A.z)
    }
    return NaN
  }
  const fg = surf('Finished grade'), st = surf('Top of stone'), sg = surf('Subgrade')
  spec.forEach(([x, y], i) => {
    const [e, n] = SP.toStatePlane(...ll(x, y))
    const zf = zOn(fg, e, n)
    near(zf, shots[i].zFt, 0.01, `re-fit FG passes through shot ${i + 1} (between design vertices)`)
    near(zf - zOn(st, e, n), 2 / 12, 0.01, `top of stone = FG − 2" at shot ${i + 1}`)
    near(zf - zOn(sg, e, n), 8 / 12, 0.01, `subgrade = FG − 8" at shot ${i + 1}`)
  })
  // 2× the radius from every shot: the design, untouched
  for (const [x, y] of [[270, 30], [30, 270], [280, 280], [20, 20]]) {
    const dmin = Math.min(...spec.map(([sx, sy]) => Math.hypot(sx - x, sy - y)))
    ok(dmin >= 2 * radiusFt, `far point (${x},${y}) is ≥ 2× radius from the shots`)
    const [lng, lat] = ll(x, y)
    const [e, n] = SP.toStatePlane(lng, lat)
    near(zOn(fg, e, n), designFt(lng, lat), 0.002, `FG at (${x},${y}), far from every shot, is the design`)
  }
  // smooth inside the radius: halfway to the radius the correction is partial, never an overshoot
  {
    const [lng, lat] = ll(112, 133)
    const [e, n] = SP.toStatePlane(lng, lat)
    const d = zOn(fg, e, n) - designFt(lng, lat)
    ok(d > 0.01 && d < 0.2, `20 ft from a +0.20 ft shot the lift is partial (${d.toFixed(3)} ft)`)
  }
  ok(f.faces.fg < 50_000, `triangle count stays bounded (${f.faces.fg})`)
}

// ── versions ──
{
  const design = { v: 1, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 15, truckCy: 12 }, features: [{ id: 't', kind: 'topsoil', coords: [], thicknessIn: 4, label: 'Fields' }, { id: 'c', kind: 'fg_contour', coords: [] }] }
  const results = { cutCy: 12000.4, fillCy: 9000, fillAdjCy: 10350, onsiteCy: 9000, exportCy: 1650, importCy: 0, topsoil: { cy: 2100, sf: 1 }, loads: 138, maxCutFt: 6.42, maxFillFt: 4.1, boundarySf: 435600,
    existing: { detail: 'USGS 1 m lidar, 2019' }, reduce: [{ label: 'Heavy duty', thicknessIn: 11, sf: 30000 }], platforms: [{ label: 'Bldg A', ffeFt: 302, subgradeFt: 301.33, sf: 1 }], demo: [], warnings: ['w1'] }
  const a = V.buildLegend(design, results, [{ number: 'C-101', rev: '1', issuedOn: '2026-10-01' }])
  eq([a.earthwork.cutCy, a.earthwork.acres, a.assumptions.shrinkPct], [12000, 10, 15], 'legend earthwork + assumptions')
  eq(a.assumptions.topsoil, ['Fields: 4"'], 'topsoil in words')
  eq(a.assumptions.counts.contours, 1, 'counts')
  const b = V.buildLegend({ ...design, settings: { shrinkPct: 20, truckCy: 12 } }, { ...results, exportCy: 2400, reduce: [{ label: 'Heavy duty', thicknessIn: 12, sf: 30000 }] }, [{ number: 'C-101', rev: '2', issuedOn: '2026-11-01' }])
  const d = V.diffLegends(a, b)
  const what = d.map((x) => x.what)
  ok(what.includes('Export') && what.includes('Shrink') && what.includes('Sections') && what.includes('Plan sheets'), `what changed: ${what}`)
  ok(d.find((x) => x.what === 'Export').big && d.find((x) => x.what === 'Export').delta === '+750 CY', 'export +750 CY is big')
  eq(V.diffLegends(a, a), [], 'no change, no rows')
  const vs = [{ id: 1, createdAt: '2026-10-01T12:00:00Z' }, { id: 2, createdAt: '2026-11-01T12:00:00Z' }]
  eq(V.versionOn(vs, Date.parse('2026-10-15T00:00:00Z'))?.id, 1, 'mid-October shows v1')
  eq(V.versionOn(vs, Date.parse('2026-12-01T00:00:00Z'))?.id, 2, 'December shows v2')
  eq(V.versionOn(vs, Date.parse('2026-09-01T00:00:00Z')), null, 'before the first version: none')
}

console.log(`\nsurvey: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
