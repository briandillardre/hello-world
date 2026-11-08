// node scripts/machine-test.mjs — the design out to the machines
// (lib/machine/export.ts) and machine files by revision (lib/machine/status.ts).
// Run it after ANY change there or to the dirt surfaces: a wrong subgrade is a
// machine cutting to the wrong grade.
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
const spUrl = transpile('../lib/plans/stateplane.ts')
const X = await import(transpile('../lib/machine/export.ts', { '../dirt/takeoff': tkUrl, '../dirt/tm': tmUrl, '../dirt/geom': geomUrl, '../dirt/surface': surfUrl, '../plans/stateplane': spUrl, './grid': transpile('../lib/machine/grid.ts', { '../plans/stateplane': spUrl }) }))
const tm = await import(tmUrl)
const tk = await import(tkUrl)
const SP = await import(spUrl)
const ST = await import(transpile('../lib/machine/status.ts', { '../plans/room': transpile('../lib/plans/room.ts') }))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const near = (a, b, tol, msg) => ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`)

// ── A site in Greenville, in true feet ──
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
// Existing slopes 1% east; the design: a pad (FFE 302, subgrade 8" down), a parking lot at 301 with an 8" section, spots between.
const ground = grid((x) => 298 + 0.01 * x, -20, -20, 320, 320)
const design = { v: 1, existing: { source: 'lidar', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 }, features: [
  { id: 'lim', kind: 'boundary', coords: rect(0, 0, 300, 300) },
  { id: 'pad', kind: 'platform', coords: rect(40, 40, 120, 120), z: 302, offsetIn: -8, label: 'Building' },
  { id: 'lot', kind: 'reduce', coords: rect(160, 40, 260, 140), thicknessIn: 8, label: 'Light duty' },
  ...[[160, 40], [260, 40], [260, 140], [160, 140], [210, 90], [150, 200], [250, 250], [60, 220]].map(([x, y], i) => ({ id: `s${i}`, kind: 'fg_spot', coords: [ll(x, y)], z: 301 })),
] }
const ctx = tk.buildContext(design, ground)
const now = new Date('2026-11-08T15:00:00Z')
const out = X.designFiles(ctx, design, { project: 'Test site & yard', now, grid: 'sc' })

// ── where the points land ──
ok(out.crs.epsg === 2273 && out.crs.unit === 'ft', `SC State Plane feet in Greenville (${JSON.stringify(out.crs)})`)
ok(X.defaultGrid(-82.394, 34.8526) === 'sc' && X.defaultGrid(-86.78, 36.16) === 'utm', 'SC State Plane is the default in SC, UTM in Nashville')
const [ce, cn] = SP.toStatePlane(...ll(40, 40))
const padCorner = out.fg.e.findIndex((e, i) => Math.abs(e - ce) < 0.01 && Math.abs(out.fg.n[i] - cn) < 0.01)
ok(padCorner >= 0, 'the pad corner is a point of the finished grade, at its state plane position')
near(out.fg.z[padCorner], 302, 0.001, 'the pad corner sits at its finished floor')

// Barycentric lookup in a mesh (output coordinates).
function zIn(m, e, n) {
  for (let t = 0; t < m.faces.length; t += 3) {
    const [a, b, c] = [m.faces[t], m.faces[t + 1], m.faces[t + 2]]
    const x1 = m.e[a], y1 = m.n[a], x2 = m.e[b], y2 = m.n[b], x3 = m.e[c], y3 = m.n[c]
    const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if (Math.abs(d) < 1e-12) continue
    const l1 = ((y2 - y3) * (e - x3) + (x3 - x2) * (n - y3)) / d
    const l2 = ((y3 - y1) * (e - x3) + (x1 - x3) * (n - y3)) / d
    const l3 = 1 - l1 - l2
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * m.z[a] + l2 * m.z[b] + l3 * m.z[c]
  }
  return NaN
}
const P = (xf, yf) => SP.toStatePlane(...ll(xf, yf))
near(zIn(out.fg, ...P(210, 90)), 301, 0.001, 'finished grade in the lot: 301')
near(zIn(out.sg, ...P(210, 90)), 301 - 8 / 12, 0.001, 'subgrade in the lot: 8 in down')
near(zIn(out.sg, ...P(80, 80)), 302 - 8 / 12, 0.001, 'subgrade on the pad: FFE − 8 in')
near(zIn(out.sg, ...P(160.1, 90)), zIn(out.fg, ...P(160.1, 90)) - 8 / 12, 0.001, 'a tenth of a foot inside the lot edge: already down 8 in (the wall)')
near(zIn(out.sg, ...P(159.9, 90)), zIn(out.fg, ...P(159.9, 90)), 0.01, 'a tenth of a foot outside it: finished grade')
near(zIn(out.sg, ...P(200, 250)), zIn(out.fg, ...P(200, 250)), 0.001, 'away from any section: subgrade = finished grade')

// Volume between the surfaces = section areas × thickness (pad 80×80, lot 100×100, both 8 in).
let vol = 0
const step = 2
for (let y = step / 2; y < 300; y += step) for (let x = step / 2; x < 300; x += step) {
  const [e, n] = P(x, y)
  const d = zIn(out.fg, e, n) - zIn(out.sg, e, n)
  if (Number.isFinite(d)) vol += d * step * step
}
near(vol / 27, ((80 * 80 + 100 * 100) * (8 / 12)) / 27, 0.01 * ((80 * 80 + 100 * 100) * (8 / 12)) / 27, 'finished grade − subgrade = the two sections × 8 in (CY)')

// ── the files ──
const x = out.landxml
ok(x.startsWith('<?xml') && x.includes('version="1.2"') && x.trim().endsWith('</LandXML>'), 'LandXML 1.2 document')
ok((x.match(/<Surface /g) ?? []).length === 2 && x.includes('name="Finished grade"') && x.includes('name="Subgrade"'), 'two surfaces')
ok((x.match(/<P id=/g) ?? []).length === out.fg.e.length + out.sg.e.length, 'every point written')
ok((x.match(/<F>/g) ?? []).length === (out.fg.faces.length + out.sg.faces.length) / 3, 'every face written')
ok(x.includes('epsgCode="2273"') && x.includes('linearUnit="foot"') && x.includes('name="Test site &amp; yard"'), 'grid, units, and the name escaped')
const firstP = x.match(/<P id="1">([^<]+)<\/P>/)[1].split(' ').map(Number)
ok(Math.abs(firstP[0] - out.fg.n[0]) < 0.001 && Math.abs(firstP[1] - out.fg.e[0]) < 0.001, 'LandXML points are northing, easting, elevation')
const surfaces = x.split('<Surface ').slice(1)
const maxIdIn = (sx) => Math.max(...Array.from(sx.matchAll(/<F>(\d+) (\d+) (\d+)<\/F>/g)).flatMap((m) => [+m[1], +m[2], +m[3]]))
const minIdIn = (sx) => Math.min(...Array.from(sx.matchAll(/<F>(\d+) (\d+) (\d+)<\/F>/g)).flatMap((m) => [+m[1], +m[2], +m[3]]))
ok(maxIdIn(surfaces[0]) === out.fg.e.length && maxIdIn(surfaces[1]) === out.sg.e.length && minIdIn(surfaces[0]) === 1 && minIdIn(surfaces[1]) === 1, 'faces reference points of their own surface (1-based), every point used')
const d = out.dxf
ok(d.startsWith('0\r\nSECTION\r\n2\r\nHEADER') && d.includes('AC1009') && d.trim().endsWith('EOF'), 'DXF R12 shell')
ok(X.DXF_LAYERS.every((l) => d.includes(`2\r\n${l.name}\r\n`)), 'every layer declared')
ok((d.match(/\r\n3DFACE\r\n/g) ?? []).length === (out.fg.faces.length + out.sg.faces.length) / 3, 'both surfaces as 3D faces')
ok(d.includes('Building FFE 302.00 SG 301.33') && d.includes('Light duty 8 in'), 'pad and section labelled')
ok((d.match(/\r\nPOLYLINE\r\n/g) ?? []).length === 3 && (d.match(/\r\nSEQEND\r\n/g) ?? []).length === 3, 'limits, pad and lot as closed polylines')
ok(/\r\nPOINT\r\n8\r\nHT-FG-SPOT/.test(d), 'spot grades as points')

// ── UTM, and the refusals ──
const utm = X.designFiles(ctx, design, { project: 'x', now, grid: 'utm' })
ok(utm.crs.unit === 'm' && utm.crs.epsg === 26917 && utm.landxml.includes('linearUnit="meter"'), 'UTM zone 17 in metres when asked')
near(utm.fg.z[padCorner], 302 * FT, 0.001, '…elevations in metres too')
const flat = { ...design, features: design.features.filter((f) => f.kind === 'boundary') }
let refused = ''
try { X.designFiles(tk.buildContext(flat, ground), flat, { project: 'x', now }) } catch (e) { refused = e.message }
ok(/Trace the proposed grades/.test(refused), `no design surface: refused in words (${refused})`)
const noSection = { ...design, features: design.features.filter((f) => f.kind !== 'reduce' && f.kind !== 'platform') }
const ns = X.designFiles(tk.buildContext(noSection, ground), noSection, { project: 'x', now })
ok(!ns.sg.faces.length && !ns.landxml.includes('name="Subgrade"') && ns.warnings.some((w) => /subgrade is the finished grade/.test(w)), 'nothing to lower: finished grade only, and it says so')
// A pad drawn over part of the lot: the pad wins there.
const over = { ...design, features: [...design.features, { id: 'pad2', kind: 'platform', coords: rect(230, 100, 280, 160), z: 303, offsetIn: -6, label: 'Shed' }] }
const ov = X.designFiles(tk.buildContext(over, ground), over, { project: 'x', now, grid: 'sc' })
near(zIn(ov.sg, ...P(245, 120)), 303 - 0.5, 0.001, 'where a pad overlaps the lot, the pad’s subgrade wins')

// ── machine files by revision ──
{
  const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const v = (id, rev, issuedOn) => ({ id: u(id), rev, issuedOn, createdAt: `${issuedOn}T12:00:00Z` })
  const sheets = new Map([
    [u(1), { id: u(1), number: 'C-101', pinnedVersionId: null, voidedAt: null, versions: [v(11, '0', '2026-09-01'), v(12, '1', '2026-10-01'), v(13, '2', '2026-11-03')] }],
    [u(2), { id: u(2), number: 'C-102', pinnedVersionId: null, voidedAt: null, versions: [v(21, '0', '2026-09-01')] }],
    [u(3), { id: u(3), number: 'C-103', pinnedVersionId: u(31), voidedAt: null, versions: [v(31, 'A', '2026-09-01'), v(32, 'B', '2026-10-15')] }],
    [u(4), { id: u(4), number: 'C-104', pinnedVersionId: null, voidedAt: '2026-11-01T00:00:00Z', versions: [v(41, '0', '2026-09-01')] }],
  ])
  const now = ST.fileStatus([{ sheetId: u(1), versionId: u(13) }, { sheetId: u(2), versionId: u(21) }], sheets)
  ok(now.state === 'current' && now.lines[0] === 'Matches the current plans: C-101 Rev 2, C-102 Rev 0.', `built from today's revisions: current (${JSON.stringify(now)})`)
  const old = ST.fileStatus([{ sheetId: u(1), versionId: u(12) }, { sheetId: u(2), versionId: u(21) }], sheets)
  ok(old.state === 'behind' && old.lines.length === 1 && old.lines[0] === 'C-101: built from Rev 1 — Rev 2 is current (issued 2026-11-03).', `a newer revision landed: behind, named (${JSON.stringify(old)})`)
  const pinned = ST.fileStatus([{ sheetId: u(3), versionId: u(32) }], sheets)
  ok(pinned.state === 'behind' && /built from Rev B, but Rev A is pinned as current/.test(pinned.lines[0]), `a newer revision than the pinned one says so (${pinned.lines[0]})`)
  ok(/voided/.test(ST.fileStatus([{ sheetId: u(4), versionId: u(41) }], sheets).lines[0]), 'a voided sheet is named')
  ok(/deleted/.test(ST.fileStatus([{ sheetId: u(9), versionId: u(91) }], sheets).lines[0]), 'a deleted sheet is named')
  ok(ST.fileStatus([], sheets).state === 'unknown', 'nothing recorded: unknown, never "current"')
  ok(ST.cleanBuiltFrom([{ sheetId: u(1), versionId: u(12) }, { sheetId: u(1), versionId: u(13) }, { sheetId: 'x', versionId: u(1) }, null, 'junk']).length === 1, 'built_from cleaned: ids only, one per sheet')
  ok(ST.kindOf('Creekside SUBGRADE.TP3') === 'tp3' && ST.kindOf('design.xml') === 'landxml' && ST.kindOf('notes') === 'other', 'kind from the file name')
  const files = ST.markOlder([
    { id: u(101), name: 'Subgrade', kind: 'tp3', createdAt: '2026-10-01T00:00:00Z' },
    { id: u(102), name: 'subgrade ', kind: 'tp3', createdAt: '2026-11-05T00:00:00Z' },
    { id: u(103), name: 'Subgrade', kind: 'landxml', createdAt: '2026-10-02T00:00:00Z' },
  ])
  ok(files[0].id === u(102) && !files[0].older && files.find((f) => f.id === u(101)).older && !files.find((f) => f.id === u(103)).older, 'the newer file of a name and kind wins; another kind stands alone')
}

console.log(`\nmachine: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
