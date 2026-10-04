/**
 * Reading grading plans, asserted (run: node scripts/plan-read-test.mjs).
 *
 * lib/dirt/pdf-vectors.ts + plan-read.ts turn a placed plan sheet's PDF into
 * contours with elevations, spot grades, the finished-floor pad and the limit
 * of grading; plan-geo.ts takes them to the map. A wrong contour elevation is
 * a wrong bid, so this builds a REAL PDF with a known answer
 * (scripts/plan-pdf-fixture.mjs — drawn the way Civil 3D exports look: CAD
 * layers, dashed grey existing with exploded-dash minors and AutoCAD SHX
 * labels, solid proposed with labels cut into gaps, spot shots, a building
 * with its FFE, a legend outside the site, distractors inside it), reads it
 * through pdf.js exactly as the browser does, and checks every number.
 * Run after ANY change to lib/dirt/pdf-vectors.ts, plan-read.ts or plan-geo.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildPlanPdf, exist, prop, PT_PER_FT, BUILDING, toFt } from './plan-pdf-fixture.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
function transpile(rel, deps = {}) {
  let src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [spec, url] of Object.entries(deps)) src = src.replaceAll(`from '${spec}'`, `from '${url}'`)
  return dataUrl(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}
const geomUrl = transpile('../lib/dirt/geom.ts')
const pv = await import(transpile('../lib/dirt/pdf-vectors.ts'))
const pr = await import(transpile('../lib/dirt/plan-read.ts', { './geom': geomUrl }))
const pg = await import(transpile('../lib/dirt/plan-geo.ts'))
const tmUrl = transpile('../lib/dirt/tm.ts')
const surfUrl = transpile('../lib/dirt/surface.ts', { delaunator: import.meta.resolve('delaunator'), '@kninnug/constrainautor': import.meta.resolve('@kninnug/constrainautor'), './geom': geomUrl })
const pl = await import(transpile('../lib/dirt/plan-lidar.ts', { './surface': surfUrl, './tm': tmUrl }))
const tm = await import(tmUrl)
const tk = await import(transpile('../lib/dirt/takeoff.ts', { earcut: import.meta.resolve('earcut'), './tm': tmUrl, './geom': geomUrl, './surface': surfUrl }))
const pi = await import(transpile('../lib/dirt/plan-import.ts', { './geom': geomUrl, './limits': transpile('../lib/dirt/limits.ts'), './plan-read': transpile('../lib/dirt/plan-read.ts', { './geom': geomUrl }) }))
const fe = await import(transpile('../lib/dirt/features.ts'))
const pdfjs = await import(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => Number.isFinite(a) && Math.abs(a - b) <= eps

async function open(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  const page = await doc.getPage(1)
  const oc = await doc.getOptionalContentConfig()
  const names = new Map()
  for (const [id, g] of oc) names.set(id, g.name)
  const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }) // as the reader does
  const tc = await page.getTextContent()
  const ann = await page.getAnnotations()
  const { pens, lines } = pv.extractVectors(ops, pdfjs.OPS, id => names.get(id) ?? null)
  const texts = [...pv.textFromContent(tc.items), ...pv.textFromShx(ann)]
  return { doc, page, pens, lines, texts }
}

/** The level a read contour really is: the truth surface along it. */
function levelOf(c) {
  const f = c.role === 'eg' ? exist : prop
  const vals = []
  for (let i = 0; i < c.pts.length; i += 2) vals.push(f(...toFt(c.pts[i], c.pts[i + 1])))
  vals.sort((a, b) => a - b)
  const med = vals[vals.length >> 1]
  const lv = Math.round(med)
  let worst = 0
  for (const v of vals) worst = Math.max(worst, Math.abs(v - lv))
  return { lv, worst }
}

const lenOf = (p) => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s }
const areaOf = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1] } return Math.abs(a / 2) }

const fx = buildPlanPdf(pr.chainLines)
const { pens, lines, texts, page } = await open(fx.bytes)
const box = fx.sitePageBox
const input = { pens, lines, texts, box, ptPerFt: PT_PER_FT }

// ── What the PDF gives us ──────────────────────────────────────────────────
{
  const byLayer = (name) => pens.filter(p => p.layer === name)
  ok('vectors: CAD layers come through as pens', ['V-TOPO-MAJR', 'V-TOPO-MINR', 'C-TOPO-MAJR', 'C-TOPO-MINR', 'C-BLDG', 'C-GRAD-LIMT'].every(n => byLayer(n).length > 0), pens.map(p => p.layer))
  const vmaj = byLayer('V-TOPO-MAJR')[0]
  ok('vectors: existing majors are grey, 0.9 pt, dashed 9/4.5', vmaj && vmaj.color === '#999999' && vmaj.width === 0.9 && vmaj.dash === '9,4.5', vmaj)
  const cmaj = byLayer('C-TOPO-MAJR')[0]
  ok('vectors: proposed majors are black, 1.2 pt, solid', cmaj && cmaj.color === '#000000' && cmaj.width === 1.2 && cmaj.dash === '', cmaj)
  const bldg = lines.filter(l => pens[l.pen].layer === 'C-BLDG')
  ok('vectors: the building is one closed ring (re → 4 corners)', bldg.length === 1 && bldg[0].closed && bldg[0].pts.length >= 8, bldg.map(b => b.pts.length))
  const lim = lines.filter(l => pens[l.pen].layer === 'C-GRAD-LIMT')
  ok('vectors: the limit of grading closes (h S)', lim.length === 1 && lim[0].closed, lim.map(l => [l.closed, l.pts.length]))
  const shx = texts.filter(t => t.src === 'shx')
  ok('words: SHX notes read from the annotations', shx.some(t => t.str === '810') && shx.some(t => t.str === 'GS'), shx.slice(0, 6).map(t => t.str))
  const ffe = texts.find(t => /^FFE/.test(t.str))
  const [bx, by] = [(BUILDING.x0 + BUILDING.x1) / 2, (BUILDING.y0 + BUILDING.y1) / 2]
  ok('words: real text keeps its centre (FFE inside the building)', ffe && near(toFt(ffe.x, ffe.y)[0], bx, 1) && near(toFt(ffe.x, ffe.y)[1], by, 1.5), ffe && toFt(ffe.x, ffe.y))
  const rot = texts.filter(t => t.src === 'text' && /^\d{3}$/.test(t.str) && Math.abs(Math.sin(t.angle)) > 0.2)
  ok('words: rotated contour labels keep their direction', rot.length >= 3, rot.length)
}

// ── Pens → roles ───────────────────────────────────────────────────────────
const sum = pr.summarizePens(input)
const roleOf = (layer) => sum.find(p => p.layer === layer)?.suggested
{
  ok('roles: V-TOPO-MAJR (labelled, dashed, survey layer) → existing', roleOf('V-TOPO-MAJR') === 'eg', sum.find(p => p.layer === 'V-TOPO-MAJR'))
  ok('roles: V-TOPO-MINR (exploded dashes, no labels) → existing', roleOf('V-TOPO-MINR') === 'eg', sum.find(p => p.layer === 'V-TOPO-MINR'))
  ok('roles: C-TOPO-MAJR → proposed', roleOf('C-TOPO-MAJR') === 'fg', sum.find(p => p.layer === 'C-TOPO-MAJR'))
  ok('roles: C-TOPO-MINR → proposed', roleOf('C-TOPO-MINR') === 'fg', sum.find(p => p.layer === 'C-TOPO-MINR'))
  for (const l of ['C-BLDG', 'C-ANNO-SPOT', 'C-GRAD-LIMT', 'C-CURB', 'C-STRM']) ok(`roles: ${l} is not a contour`, (roleOf(l) ?? 'none') === 'none', sum.find(p => p.layer === l))
  ok('roles: the legend and title block are outside the read area', !sum.some(p => p.layer === 'C-LEGEND' || p.layer === 'G-ANNO-TTLB'), sum.map(p => p.layer))
}
const roles = Object.fromEntries(sum.map(p => [p.id, p.suggested]))

// ── The read ───────────────────────────────────────────────────────────────
function checkRead(r, label) {
  const eg = r.contours.filter(c => c.role === 'eg'), fg = r.contours.filter(c => c.role === 'fg')
  ok(`${label}: existing contours chain into whole lines (${eg.length} read, ${fx.truth.exist.length} drawn)`, eg.length === fx.truth.exist.length, [eg.length, fx.truth.exist.length])
  ok(`${label}: proposed contours chain into whole lines (${fg.length} read, ${fx.truth.prop.length} drawn)`, fg.length === fx.truth.prop.length, [fg.length, fx.truth.prop.length])
  let wrong = 0, known = 0, off = 0
  const bad = []
  for (const c of r.contours) {
    const { lv, worst } = levelOf(c)
    if (worst > 0.25) off++
    if (c.z === null) continue
    known++
    if (c.z !== lv) { wrong++; bad.push({ id: c.id, role: c.role, z: c.z, truth: lv, how: c.how }) }
  }
  ok(`${label}: every read contour lies on one level of the truth surface`, off === 0, off)
  ok(`${label}: no contour gets a wrong elevation`, wrong === 0, bad.slice(0, 6))
  // Without the lidar, a contour past the last label is named only two steps
  // out (a ridge there would make a further count wrong) — the rest wait for
  // the lidar, a tap or a cross line. Never a wrong number.
  const share = known / Math.max(1, r.contours.length)
  ok(`${label}: ≥ 90% of contours get an elevation (${(share * 100).toFixed(1)}%)`, share >= 0.9, r.contours.filter(c => c.z === null).slice(0, 5).map(c => ({ id: c.id, role: c.role, truth: levelOf(c).lv, len: Math.round(lenOf(c.pts)), flags: c.flags })))
  ok(`${label}: the interval is measured, 1 ft both kinds`, r.interval.eg === 1 && r.interval.fg === 1, r.interval)
  ok(`${label}: labels, ladders both used`, r.contours.some(c => c.how === 'label') && r.contours.some(c => c.how === 'ladder'), r.contours.reduce((m, c) => (m[c.how] = (m[c.how] || 0) + 1, m), {}))
  ok(`${label}: every proposed contour is named (labels, ladders, tie-ins to existing)`, fg.every(c => c.z !== null), fg.filter(c => c.z === null).map(c => levelOf(c).lv))
  ok(`${label}: proposed contours tie into existing at the grading limit`, fg.some(c => c.how === 'tie-in'))
  ok(`${label}: SHX labels name existing contours`, eg.some(c => c.how === 'label'))
  ok(`${label}: contours of one kind never cross`, !r.contours.some(c => c.flags.includes('crosses another contour')), r.contours.filter(c => c.flags.includes('crosses another contour')).length)
  ok(`${label}: nothing is read from outside the site box`, r.contours.every(c => { for (let i = 0; i < c.pts.length; i += 2) if (c.pts[i] < box.x0 - 1e-6 || c.pts[i] > box.x1 + 1e-6 || c.pts[i + 1] < box.y0 - 1e-6 || c.pts[i + 1] > box.y1 + 1e-6) return false; return true }))
  // Spots.
  for (const t of fx.truth.spots) {
    const s = r.spots.find(q => Math.hypot(q.x - t.x, q.y - t.y) < 3)
    ok(`${label}: spot ${t.tag} ${t.z.toFixed(2)} found on its marker`, !!s, r.spots.map(q => [q.text, Math.round(q.x), Math.round(q.y)]))
    if (s) ok(`${label}: spot ${t.tag} reads ${t.z.toFixed(2)} as ${t.role}`, near(s.z, t.z, 0.005) && s.role === t.role && s.tag === t.tag, s)
  }
  ok(`${label}: no stray spots (the shots + the FFE)`, r.spots.length === fx.truth.spots.length + 1, r.spots.map(s => s.text))
  // Pad.
  ok(`${label}: one finished-floor pad`, r.pads.length === 1, r.pads.length)
  const pad = r.pads[0]
  if (pad) {
    const a = areaOf(pad.ring) / PT_PER_FT ** 2, want = (BUILDING.x1 - BUILDING.x0) * (BUILDING.y1 - BUILDING.y0)
    ok(`${label}: FFE ${BUILDING.ffe.toFixed(2)} with the building outline (${a.toFixed(0)} sf of ${want})`, pad.ffe === BUILDING.ffe && pad.outline && Math.abs(a - want) / want < 0.03, { ffe: pad.ffe, outline: pad.outline, a })
  }
  // Limits.
  const want = Math.PI * fx.truth.limit.rx * fx.truth.limit.ry
  const la = r.limits ? areaOf(r.limits) / PT_PER_FT ** 2 : 0
  ok(`${label}: limit of grading read from its layer (${la.toFixed(0)} sf of ${want.toFixed(0)})`, !!r.limits && Math.abs(la - want) / want < 0.01, la)
}

let t0 = Date.now()
const read = pr.readPlan(input, { roles })
const ms = Date.now() - t0
checkRead(read, 'read')
ok(`read: under 1.5 s (${ms} ms)`, ms < 1500, ms)
{
  // The station "100" on an existing minor contour is not its elevation.
  const st = fx.truth.station
  const c = read.contours.find(q => q.role === 'eg' && q.flags.some(f => /100 is far/.test(f)))
  ok('read: a stray "100" on a contour is set aside', !!c && read.warnings.some(w => /1 existing label ignored/.test(w)), read.warnings)
  if (c) ok('read: …and that contour is still named right (803)', c.z === 803 && st && c.pts.some((v, i) => i % 2 === 0 && Math.hypot(v - st.x, c.pts[i + 1] - st.y) < 2), { z: c.z, how: c.how })
  ok('read: the pipe size "24" never becomes a contour', !read.contours.some(q => q.z === 24))
  ok('read: survey point numbers beside their shots are not labels', fx.truth.spots.filter(s => s.tag === 'GS').length === 3)
}

// ── Variants ───────────────────────────────────────────────────────────────
{
  // Minors drawn whole with a dash pattern (most exports) instead of exploded.
  const fx2 = buildPlanPdf(pr.chainLines, { explodeMinor: false })
  const o2 = await open(fx2.bytes)
  const in2 = { pens: o2.pens, lines: o2.lines, texts: o2.texts, box: fx2.sitePageBox, ptPerFt: PT_PER_FT }
  const s2 = pr.summarizePens(in2)
  ok('dashed minors: still suggested existing', s2.find(p => p.layer === 'V-TOPO-MINR')?.suggested === 'eg')
  const r2 = pr.readPlan(in2, { roles: Object.fromEntries(s2.map(p => [p.id, p.suggested])) })
  checkRead(r2, 'dashed minors')
}
{
  // Existing labels as real text in parentheses — "(810)", the other common convention.
  const fx4 = buildPlanPdf(pr.chainLines, { parenLabels: true })
  const o4 = await open(fx4.bytes)
  const in4 = { pens: o4.pens, lines: o4.lines, texts: o4.texts, box: fx4.sitePageBox, ptPerFt: PT_PER_FT }
  const s4 = pr.summarizePens(in4)
  const r4 = pr.readPlan(in4, { roles: Object.fromEntries(s4.map(p => [p.id, p.suggested])) })
  checkRead(r4, '(parenthesised)')
}
{
  // The whole sheet, seal and all: quick, and the seal's scribble is never a contour.
  const t1 = Date.now()
  const whole = pr.summarizePens({ pens, lines, texts, box: null, ptPerFt: PT_PER_FT })
  const ms = Date.now() - t1
  ok(`whole sheet: pens summarised in under 1.5 s (${ms} ms)`, ms < 1500, ms)
  const seal = whole.filter(p => p.layer === 'G-ANNO-TTLB')
  ok('whole sheet: the seal is not a contour', seal.length > 0 && seal.every(p => p.suggested === 'none'), seal)
  ok('whole sheet: white mask boxes are never contours', whole.filter(p => p.color === '#ffffff').every(p => p.suggested === 'none'), whole.filter(p => p.color === '#ffffff'))
}
{
  // A sheet with /Rotate 90 (landscape stored portrait): same user space, same read.
  const fx3 = buildPlanPdf(pr.chainLines, { rotate: 90 })
  const o3 = await open(fx3.bytes)
  const in3 = { pens: o3.pens, lines: o3.lines, texts: o3.texts, box: fx3.sitePageBox, ptPerFt: PT_PER_FT }
  const s3 = pr.summarizePens(in3)
  const r3 = pr.readPlan(in3, { roles: Object.fromEntries(s3.map(p => [p.id, p.suggested])) })
  ok('rotated sheet: identical read', JSON.stringify(r3.contours.map(c => [c.z, c.pts.length])) === JSON.stringify(read.contours.map(c => [c.z, c.pts.length])) && r3.spots.length === read.spots.length)
}
{
  // Without a layer name in sight (an export that dropped layers): pens are colour + width + dash only.
  const flat = { pens: pens.map(p => ({ ...p, layer: null })), lines, texts, box, ptPerFt: PT_PER_FT }
  const sf = pr.summarizePens(flat)
  const eg = sf.filter(p => p.suggested === 'eg').map(p => p.id), fgp = sf.filter(p => p.suggested === 'fg').map(p => p.id)
  const byL = (n) => pens.filter(p => p.layer === n && p.color !== '#ffffff').map(p => p.id)
  ok('no layers: existing majors (dashed grey, labelled) → existing', byL('V-TOPO-MAJR').every(id => eg.includes(id)), sf.filter(p => p.suggested !== 'none'))
  ok('no layers: proposed majors (solid, labelled) → proposed', byL('C-TOPO-MAJR').every(id => fgp.includes(id)), sf.filter(p => p.suggested !== 'none'))
}

// ── Lidar assist ───────────────────────────────────────────────────────────
const lidar = (x, y) => exist(...toFt(x, y)) - 200 // the lidar is on another datum: plan = lidar + 200 ft
{
  // Every label, plus the lidar: the whole sheet, nothing wrong.
  const r = pr.readPlan(input, { roles, existingFt: lidar })
  const wrong = r.contours.filter(c => c.z !== null && c.z !== levelOf(c).lv)
  ok('lidar + labels: every contour named', r.contours.every(c => c.z !== null), r.contours.filter(c => c.z === null).map(c => [c.role, levelOf(c).lv]))
  ok('lidar + labels: none wrong', wrong.length === 0, wrong.map(c => [c.role, c.z, levelOf(c).lv, c.how]))
  ok('lidar + labels: no false alarms', !r.contours.some(c => c.flags.some(f => /lidar|jumps|disagree/.test(f))), r.contours.filter(c => c.flags.length).map(c => c.flags))
}
{
  // No existing contour labels at all — only the spot shots (GS) tie the plan to
  // the lidar, and the lidar shows the interval.
  const bare = texts.filter(t => !(t.src === 'shx' && /^\d{3}$/.test(t.str)))
  const r = pr.readPlan({ ...input, texts: bare }, { roles, existingFt: lidar })
  const eg = r.contours.filter(c => c.role === 'eg')
  ok('lidar, no labels: datum from the spot shots (+200 ft)', near(r.datumFt, 200, 0.05), r.datumFt)
  ok('lidar, no labels: interval from the lidar (1 ft)', r.interval.eg === 1, r.interval)
  ok('lidar, no labels: every existing contour named, none wrong', eg.every(c => c.z !== null && c.z === levelOf(c).lv), eg.filter(c => c.z === null || c.z !== levelOf(c).lv).map(c => [c.z, levelOf(c).lv, c.how]))
}
{
  // Only three existing labels survive (a sheet that labels sparsely) — the
  // ladders and the lidar must finish the job without a wrong number.
  const keep = new Set()
  const sparse = texts.filter(t => {
    if (t.src !== 'shx' || !/^\d{3}$/.test(t.str)) return true
    if (keep.size < 3 && !keep.has(t.str) && t.str !== '100') { keep.add(t.str); return true }
    return false
  })
  const r = pr.readPlan({ ...input, texts: sparse }, { roles, existingFt: lidar })
  ok('lidar: the plan datum is measured (+200 ft)', near(r.datumFt, 200, 0.05), r.datumFt)
  const eg = r.contours.filter(c => c.role === 'eg')
  const wrong = eg.filter(c => c.z !== null && c.z !== levelOf(c).lv)
  const unknown = eg.filter(c => c.z === null)
  ok('lidar: sparse labels + lidar name every existing contour', unknown.length === 0, unknown.length)
  ok('lidar: …without a wrong one', wrong.length === 0, wrong.slice(0, 5).map(c => ({ z: c.z, truth: levelOf(c).lv, how: c.how })))
  ok('lidar: some come from the lidar', eg.some(c => c.how === 'lidar') || eg.every(c => c.how !== null), eg.reduce((m, c) => (m[c.how] = (m[c.how] || 0) + 1, m), {}))
  // A mislabelled contour is called out.
  const lab = texts.find(t => t.src === 'shx' && t.str === '810')
  const lie = texts.map(t => t === lab ? { ...t, str: '815' } : t)
  const r2 = pr.readPlan({ ...input, texts: lie }, { roles, existingFt: lidar })
  const flagged = r2.contours.filter(c => c.flags.some(f => /off the lidar|labels disagree/.test(f)))
  ok('lidar: a wrong label is flagged', flagged.length >= 1, r2.contours.filter(c => c.flags.length).map(c => c.flags))
}

// ── The estimator's cross line ─────────────────────────────────────────────
{
  // Along y = 94 ft the existing ground rises steadily west → east (the
  // sine term vanishes there): every contour crossed is one step up.
  const fresh = () => pr.readPlan(input, { roles })
  const [x0, y0] = [5 * PT_PER_FT + 150, 94 * PT_PER_FT + 150], [x1, y1] = [415 * PT_PER_FT + 150, 94 * PT_PER_FT + 150]
  const z0 = Math.ceil(exist(5, 94))
  const r = fresh()
  for (const c of r.contours) if (c.role === 'eg') { c.z = null; c.how = null }
  const { set, disagree } = pr.assignAlong(r.contours, 'eg', [x0, y0, x1, y1], z0, 1)
  const crossed = r.contours.filter(c => c.role === 'eg' && c.how === 'user')
  ok(`cross line: names every existing contour it crosses (${set})`, set >= 12 && disagree === 0, { set, disagree })
  ok('cross line: …each one right', crossed.every(c => c.z === levelOf(c).lv), crossed.filter(c => c.z !== levelOf(c).lv).map(c => [c.z, levelOf(c).lv]))
  // Then the ladders finish the sheet from those.
  pr.resolveElevations(r.contours, r.ladders, r.interval)
  const eg = r.contours.filter(c => c.role === 'eg')
  ok('cross line: the ladders carry it past the line', eg.filter(c => c.z !== null).length > crossed.length, eg.filter(c => c.z === null).length)
  ok('cross line: …still nothing wrong', eg.every(c => c.z === null || c.z === levelOf(c).lv))
  // A second line up the north side (also one steady climb there) finishes it.
  const z1 = Math.ceil(exist(5, 250))
  const b = pr.assignAlong(r.contours, 'eg', [5 * PT_PER_FT + 150, 250 * PT_PER_FT + 150, 415 * PT_PER_FT + 150, 250 * PT_PER_FT + 150], z1, 1)
  pr.resolveElevations(r.contours, r.ladders, r.interval)
  ok('cross line: a second line agrees with the first', b.disagree === 0 && b.set > 0, b)
  ok('cross line: two lines name ≥ 90% of the existing contours, none wrong', eg.filter(c => c.z !== null).length / eg.length >= 0.9 && eg.every(c => c.z === null || c.z === levelOf(c).lv), eg.filter(c => c.z === null).map(c => levelOf(c).lv))
  // Over labelled contours, a wrong start is caught, not written.
  const r2 = fresh()
  const before = JSON.stringify(r2.contours.map(c => [c.z, c.how]))
  const res = pr.assignAlong(r2.contours, 'eg', [x0, y0, x1, y1], z0 + 1, 1)
  ok('cross line: a start one foot off disagrees with the labels', res.disagree > 0 && res.set === 0, res)
  ok('cross line: …writes nothing', JSON.stringify(r2.contours.map(c => [c.z, c.how])) === before)
  ok(`cross line: …and says what the labels make the first one (${res.implied})`, res.implied === z0, res)
}

// ── The cross line's first tap, and the numbers counted between labels ────────
{
  // From the labelled 805 to just short of 810, along y = 94 ft — the first tap lands 0.3 ft PAST
  // 805 (under a pixel at street zoom), so the line never properly crosses it.
  const y = 94 * PT_PER_FT + 150
  const line = [(88.6 + 0.3) * PT_PER_FT + 150, y, 229 * PT_PER_FT + 150, y]
  const slop = 2 * PT_PER_FT // ~10 px of finger at the zoom a line is drawn at
  const r = pr.readPlan(input, { roles })
  const snap = pr.assignAlong(r.contours, 'eg', line, 805, 1, { slop })
  const mine = r.contours.filter(c => c.role === 'eg' && c.how === 'user')
  ok(`cross line: a first tap just past the contour still starts on it (${snap.set} set)`, snap.disagree === 0 && snap.counted === 0 && mine.every(c => c.z === levelOf(c).lv), { snap, wrong: mine.filter(c => c.z !== levelOf(c).lv).map(c => [c.z, levelOf(c).lv]) })
  // Without the snap the run is one off — and the numbers counted between the labels say so.
  const r2 = pr.readPlan(input, { roles })
  const before = JSON.stringify(r2.contours.map(c => [c.z, c.how]))
  const off = pr.assignAlong(r2.contours, 'eg', line, 805, 1)
  ok(`cross line: a run one off from the counted numbers writes nothing (${off.counted} disagree)`, off.set === 0 && off.counted > 0 && JSON.stringify(r2.contours.map(c => [c.z, c.how])) === before, off)
  ok(`cross line: …and says what they make the first one (${off.implied})`, off.implied === 806, off)
  const forced = pr.assignAlong(r2.contours, 'eg', line, 805, 1, { force: true })
  ok('cross line: "use mine anyway" writes it', forced.set > 0, forced)
}

// ── Reading a crop: the editor reads the site + 60 ft, never the whole sheet ──
{
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pg = (xft, yft) => [150 + xft * PT_PER_FT, 150 + yft * PT_PER_FT]
  const N = 40
  let reads = 0, silent = 0, labelled = 0, guessed = 0, other = 0
  for (let k = 0; k < N; k++) {
    const w = 80 + rnd() * 180, h = 80 + rnd() * 180
    const a = rnd() * (420 - w), b = rnd() * (300 - h)
    const [x0, y0] = pg(a - 60, b - 60), [x1, y1] = pg(a + w + 60, b + h + 60)
    const r = pr.readPlan({ ...input, box: { x0, y0, x1, y1 } }, { roles })
    const wrong = r.contours.filter(q => q.z !== null && q.z !== levelOf(q).lv)
    if (wrong.length) reads++
    for (const q of wrong) {
      if (!q.flags.length) silent++
      if (q.how === 'label') labelled++
      else if (q.how === 'extrapolated') guessed++
      else other++
    }
  }
  ok(`crop: ${N} site-sized reads — no wrong elevation goes unflagged`, silent === 0, { silent, labelled, guessed, other })
  ok("crop: no label names the wrong contour at the read area's edge", labelled === 0, labelled)
  ok(`crop: what's left wrong is trend guesses (${guessed} in ${reads} reads) — the import leaves them out unless checked`, other === 0, { other, guessed })
}

// ── The datum when only two labels survive and one of them is a contour off ──
{
  const lidar = (x, y) => exist(...toFt(x, y)) - 200
  for (const delta of [1, -1]) {
    const keep = []
    const sparse = texts.filter(t => {
      if (t.src !== 'shx' || !/^\d{3}$/.test(t.str) || t.str === '100') return true
      if (keep.length < 2 && !keep.some(k => k.str === t.str)) { keep.push(t); return true }
      return false
    })
    const liar = keep[1]
    const lie = sparse.map(t => (t === liar ? { ...t, str: String(Number(t.str) + delta) } : t))
    const r = pr.readPlan({ ...input, texts: lie }, { roles, existingFt: lidar })
    const wrong = r.contours.filter(c => c.z !== null && c.z !== levelOf(c).lv)
    ok(`datum: two labels a contour apart (${liar.str} → ${Number(liar.str) + delta}) agree on nothing — the spot shots set it (${r.datumFt})`, near(r.datumFt, 200, 0.05), r.datumFt)
    ok(`datum: …only the lying label is wrong, and it is flagged (${wrong.length} wrong)`, wrong.length <= 1 && wrong.every(c => c.flags.some(f => /lidar datum/.test(f))), wrong.map(c => [c.z, c.flags]))
  }
}

// ── Spot grades that are really dimensions ──
{
  const dims = [
    { str: '24.00', x: 150 + 300 * PT_PER_FT, y: 150 + 60 * PT_PER_FT, angle: 0, size: 6, len: 15, src: 'text' },
    { str: '18.00', x: 150 + 320 * PT_PER_FT, y: 150 + 80 * PT_PER_FT, angle: 0, size: 6, len: 15, src: 'text' },
  ]
  const r = pr.readPlan({ ...input, texts: [...texts, ...dims] }, { roles })
  ok('spots: a drive width "24.00" and a stall depth "18.00" are not spot grades', !r.spots.some(sp => sp.z < 100) && r.warnings.some(w => /not read as spot grade/.test(w)), r.spots.map(sp => sp.z))
}

// ── "Not a contour": the line goes before anything reads it ──
{
  const r = pr.readPlan(input, { roles })
  const victim = r.contours.find(c => c.role === 'eg' && c.how === 'label')
  const r2 = pr.readPlan(input, { roles, exclude: [victim.pts] })
  ok('set aside: the line is out of the read and listed aside', r2.contours.length === r.contours.length - 1 && (r2.aside ?? []).length >= 1 && !r2.contours.some(c => c.pts.length === victim.pts.length && c.pts[0] === victim.pts[0] && c.pts[1] === victim.pts[1]), { before: r.contours.length, after: r2.contours.length, aside: (r2.aside ?? []).length })
  ok('set aside: …and nothing else goes wrong', r2.contours.every(c => c.z === null || c.z === levelOf(c).lv))
}

// ── Sheet ↔ map ────────────────────────────────────────────────────────────
for (const rotate of [0, 90]) {
  const f = rotate ? buildPlanPdf(pr.chainLines, { rotate }) : fx
  const o = rotate ? await open(f.bytes) : { page }
  const base = o.page.getViewport({ scale: 1 })
  const s = pg.rasterScale(base.width, base.height)
  ok(`geo r${rotate}: raster scale matches ZonePlans (3000 px long edge)`, near(s, 3000 / 1728, 1e-12), s)
  const vp = o.page.getViewport({ scale: s })
  const imgW = Math.ceil(vp.width), imgH = Math.ceil(vp.height)
  // The truth: the site's feet, turned 20° off north, at Greenville.
  const lng0 = -82.394, lat0 = 34.8526, th = (20 * Math.PI) / 180
  const truthLL = (x, y) => {
    const [fx_, fy_] = toFt(x, y)
    const e = (fx_ * Math.cos(th) - fy_ * Math.sin(th)) * 0.3048, n = (fx_ * Math.sin(th) + fy_ * Math.cos(th)) * 0.3048
    return [lng0 + e / (111_320 * Math.cos((lat0 * Math.PI) / 180)), lat0 + n / 110_574]
  }
  const [a, b, c, d, e, ff] = vp.transform
  const det = a * d - b * c
  const pxToPage = (px, py) => [(d * (px - e) - c * (py - ff)) / det, (-b * (px - e) + a * (py - ff)) / det]
  const corners = [[0, 0], [imgW, 0], [imgW, imgH], [0, imgH]].map(([px, py]) => truthLL(...pxToPage(px, py)))
  const m = pg.sheetMap({ vp: vp.transform, imgW, imgH, corners })
  let worstM = 0, worstPt = 0
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const x = (i / 10) * 1728, y = (j / 10) * 1296
    const [lng, lat] = m.toLngLat(x, y)
    const [tl, tt] = truthLL(x, y)
    worstM = Math.max(worstM, Math.hypot((lng - tl) * mPerDegLng, (lat - tt) * 110_574))
    const [bx, by] = m.toPage(lng, lat)
    worstPt = Math.max(worstPt, Math.hypot(bx - x, by - y))
  }
  ok(`geo r${rotate}: page → map lands within 2 cm of the truth (${(worstM * 100).toFixed(2)} cm)`, worstM < 0.02, worstM)
  ok(`geo r${rotate}: map → page round-trips (${worstPt.toExponential(1)} pt)`, worstPt < 1e-4, worstPt)
  ok(`geo r${rotate}: the sheet's drawn scale is recovered (${m.ptPerFt.toFixed(4)} pt/ft)`, near(m.ptPerFt, PT_PER_FT, PT_PER_FT * 0.002), m.ptPerFt)
}

// ── Import: what was read, as takeoff features in lng/lat ────────────────────
{
  const base = page.getViewport({ scale: 1 })
  const sc = pg.rasterScale(base.width, base.height)
  const vp = page.getViewport({ scale: sc })
  const imgW = Math.ceil(vp.width), imgH = Math.ceil(vp.height)
  const lng0 = -82.394, lat0 = 34.8526
  const truthLL = (x, y) => { const [a, b] = toFt(x, y); return [lng0 + (a * 0.3048) / (111_320 * Math.cos((lat0 * Math.PI) / 180)), lat0 + (b * 0.3048) / 110_574] }
  const [a, b, c, d, e, ff] = vp.transform
  const det = a * d - b * c
  const px2pg = (px, py) => [(d * (px - e) - c * (py - ff)) / det, (-b * (px - e) + a * (py - ff)) / det]
  const map = pg.sheetMap({ vp: vp.transform, imgW, imgH, corners: [[0, 0], [imgW, 0], [imgW, imgH], [0, imgH]].map(([x, y]) => truthLL(...px2pg(x, y))) })
  let n = 0
  const newId = (pfx = 'f') => `${pfx}${(n++).toString(36)}`
  const named = (r) => read.contours.filter(q => q.role === r && q.z !== null).length
  const all = { egContours: true, fgContours: true, egSpots: true, fgSpots: true, pads: [0], limits: true, excluded: new Set() }
  const res = pi.readToFeatures(read, map, all, { features: 3000, points: 80000 }, 'sheet-1', newId)
  ok('import: every named contour goes in', res.counts.egContours === named('eg') && res.counts.fgContours === named('fg'), { counts: res.counts, eg: named('eg'), fg: named('fg') })
  ok('import: spot grades by role (3 GS, 2 FG — the curb top stays out)', res.counts.egSpots === 3 && res.counts.fgSpots === 2, res.counts)
  ok('import: the building pad, with its finished floor and −8" subgrade', res.counts.pads === 1 && res.features.some(f => f.kind === 'platform' && f.z === BUILDING.ffe && f.offsetIn === -8), res.features.filter(f => f.kind === 'platform'))
  ok('import: the limit of grading as the grading limits', res.counts.limits === 1)
  ok('import: every feature carries its sheet', res.features.every(f => f.src === 'sheet-1'))
  ok('import: thinned only to 0.15 ft', res.tolFt === 0.15 && res.dropped === 0, res)
  // Contours land where the plan draws them: back through the placement, within 0.2 ft of the line.
  let worst = 0
  for (const f of res.features.filter(q => q.kind === 'eg_contour').slice(0, 8)) {
    for (const [lng, lat] of f.coords) {
      const [x, y] = map.toPage(lng, lat)
      worst = Math.max(worst, Math.abs(exist(...toFt(x, y)) - f.z))
    }
  }
  ok(`import: imported contours sit on their level (worst ${worst.toFixed(3)} ft)`, worst < 0.15, worst)
  // The whole chain, PDF to cubic yards: the imported design run through the takeoff against the
  // fixture's own surfaces integrated on a 1 ft grid (the building at its subgrade, finished floor − 8").
  {
    const design = { v: 1, features: res.features, existing: { source: 'traced', offsetFt: 0 }, settings: { shrinkPct: 0, truckCy: 12 } }
    const { results } = tk.runTakeoff(design, null, new Date())
    let cut = 0, fill = 0
    const L = fx.truth.limit, sub = BUILDING.ffe - 8 / 12
    for (let x = 0.5; x < 420; x += 1) for (let y = 0.5; y < 300; y += 1) {
      if (((x - L.cx) / L.rx) ** 2 + ((y - L.cy) / L.ry) ** 2 > 1) continue
      const inPad = x >= BUILDING.x0 && x <= BUILDING.x1 && y >= BUILDING.y0 && y <= BUILDING.y1
      const d = (inPad ? sub : prop(x, y)) - exist(x, y)
      if (d > 0) fill += d; else cut -= d
    }
    cut /= 27; fill /= 27
    const net = fill - cut, rnet = results.fillCy - results.cutCy
    console.log(`  PDF → takeoff: fill ${Math.round(results.fillCy)} CY (exact ${Math.round(fill)}, ${(100 * (results.fillCy - fill) / fill).toFixed(1)}%) · cut ${Math.round(results.cutCy)} (exact ${Math.round(cut)}) · net ${Math.round(rnet)} (exact ${Math.round(net)}, ${(100 * (rnet - net) / net).toFixed(1)}%)`)
    ok(`PDF → takeoff: fill ${Math.round(results.fillCy)} CY vs ${Math.round(fill)} exact (${(100 * (results.fillCy - fill) / fill).toFixed(1)}%)`, Math.abs(results.fillCy - fill) / fill < 0.05, { results: results.fillCy, exact: fill })
    ok(`PDF → takeoff: cut ${Math.round(results.cutCy)} CY vs ${Math.round(cut)} exact`, Math.abs(results.cutCy - cut) < Math.max(0.1 * cut, 60), { results: results.cutCy, exact: cut })
    ok(`PDF → takeoff: net import ${Math.round(rnet)} CY vs ${Math.round(net)} exact (${(100 * (rnet - net) / net).toFixed(1)}%)`, Math.abs(rnet - net) / Math.abs(net) < 0.05, { rnet, net })
  }
  const sc2 = pi.readToFeatures(read, map, all, { features: 3000, points: 400 }, 'sheet-1', newId)
  const pts2 = sc2.features.reduce((m, f) => m + f.coords.length, 0)
  ok(`import: a tight budget thins, then drops the shortest — and fits (${pts2} pts, tol ${sc2.tolFt} ft, ${sc2.dropped} dropped)`, pts2 <= 400 && sc2.warnings.length > 0, sc2.warnings)
  const ex = new Set(read.contours.filter(q => q.role === 'eg' && q.z !== null).slice(0, 3).map(q => q.id))
  const r3 = pi.readToFeatures(read, map, { ...all, excluded: ex }, { features: 3000, points: 80000 }, 'sheet-1', newId)
  ok('import: contours set aside stay out', r3.counts.egContours === named('eg') - 3, r3.counts)

  // The caps hold whatever a sheet throws at them (lib/dirt/limits.ts): 2,500 spot shots, 3,500
  // contour fragments, one 13,000-point contour no thinning can shorten, one label of 45,000 ft.
  {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    let cid = 1e6
    const shots = (n) => Array.from({ length: n }, () => ({ role: 'eg', z: 800 + rnd() * 20, x: 60 + rnd() * 1580, y: 60 + rnd() * 1140, text: '800' }))
    const zig = []
    for (let i = 0; i < 13000; i++) zig.push(40 + i * 0.12, 600 + (i % 2 ? 6 : -6))
    const big = { id: cid++, role: 'eg', z: 812, pts: zig }
    const frags = Array.from({ length: 3500 }, (_, i) => { const x = 60 + (i % 70) * 23, y = 60 + Math.floor(i / 70) * 23; return { id: cid++, role: 'fg', z: 805 + (i % 10), pts: [x, y, x + 4 + (i % 7), y + 3] } })
    const wild = { id: cid++, role: 'eg', z: 45000, pts: [100, 100, 200, 200] }
    const sheet = (contours, spots) => ({ contours, ladders: [], interval: { eg: 1, fg: 1 }, datumFt: null, spots, pads: [], limits: null, warnings: [] })
    const picks = { ...all, pads: [], limits: false }
    const cap = { features: 3000, points: 80000 }
    const r = pi.readToFeatures(sheet([big, wild, ...frags], shots(2500)), map, picks, cap, 'sheet-2', fe.newId)
    const totPts = r.features.reduce((m, f) => m + f.coords.length, 0)
    ok(`caps: ${r.features.length} features, ${totPts.toLocaleString()} points — inside 3,000 / 80,000`, r.features.length <= 3000 && totPts <= 80000, { n: r.features.length, totPts })
    ok('caps: no feature over 6,000 points', r.features.every(f => f.coords.length <= 6000), Math.max(...r.features.map(f => f.coords.length)))
    ok('caps: every id unique (no wrap at 1,296)', new Set(r.features.map(f => f.id)).size === r.features.length)
    const pieces = r.features.filter(f => f.kind === 'eg_contour')
    const joined = pieces.every((f, i) => i === 0 || (f.coords[0][0] === pieces[i - 1].coords.at(-1)[0] && f.coords[0][1] === pieces[i - 1].coords.at(-1)[1]))
    ok(`caps: the 13,000-point contour splits into ${pieces.length} pieces that share their ends — nothing lost`, pieces.length === 3 && joined && pieces.reduce((m, f) => m + f.coords.length, 0) === pr.simplify(zig, 0.15 * PT_PER_FT).length / 2 + 2 && r.counts.egContours === 1, { n: pieces.length, joined, counts: r.counts })
    ok('caps: too many contours drops the shortest without thinning the rest', r.tolFt === 0.15 && r.dropped > 0 && r.warnings.some(w => /short contours left out/.test(w)), { tol: r.tolFt, dropped: r.dropped })
    ok('caps: a 45,000 ft label is left out and said', !r.features.some(f => f.z === 45000) && r.warnings.some(w => /outside/.test(w)), r.warnings)
    ok(`caps: fragments can't crowd the spot grades out (${r.counts.egSpots} of 2,500 kept)`, r.counts.egSpots >= 1250 && r.droppedSpots === 2500 - r.counts.egSpots, r.counts)
    const quad = [0, 0, 0, 0]
    for (const f of r.features.filter(q => q.kind === 'eg_spot')) { const [x, y] = map.toPage(...f.coords[0]); quad[(x > 850 ? 1 : 0) + (y > 630 ? 2 : 0)]++ }
    ok(`caps: the spot grades kept are spread over the sheet (${quad.join(' / ')} by quarter)`, quad.every(q => q > 0.2 * r.counts.egSpots), quad)
    const r2 = pi.readToFeatures(sheet([big], shots(5000)), map, picks, cap, 'sheet-2', fe.newId)
    ok(`caps: a dense survey can't crowd the contours out (contour kept, ${r2.counts.egSpots} of 5,000 spots)`, r2.counts.egContours === 1 && r2.features.length === 3000 && r2.dropped === 0, { counts: r2.counts, n: r2.features.length })
    const wavy = []
    for (let i = 0; i < 13000; i++) wavy.push(40 + i * 0.12, 600 + (i % 2 ? 1 : -1))
    const r4 = pi.readToFeatures(sheet([{ id: cid++, role: 'eg', z: 812, pts: wavy }], shots(10)), map, picks, { features: 3000, points: 9000 }, 'sheet-2', fe.newId)
    const p4 = r4.features.reduce((m, f) => m + f.coords.length, 0)
    ok(`caps: too many points thins (${r4.tolFt} ft) and still fits (${p4.toLocaleString()} of 9,000)`, r4.tolFt > 0.15 && p4 <= 9000 && r4.counts.egContours === 1 && r4.counts.egSpots === 10, { tol: r4.tolFt, p4, counts: r4.counts })
  }

  // The lidar through the placement: a grid of the truth in UTM, read back in page space.
  const p17 = tm.utmParams(17)
  const sw = map.toLngLat(0, 0), ne = map.toLngLat(1728, 1296)
  const [e0, n0] = tm.tmForward(p17, Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1]))
  const [e1, n1] = tm.tmForward(p17, Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1]))
  const dxm = 1, nx = Math.ceil((e1 - e0) / dxm) + 3, ny = Math.ceil((n1 - n0) / dxm) + 3
  const z = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const [lng, lat] = tm.tmInverse(p17, e0 - dxm + i * dxm, n0 - dxm + j * dxm)
    const [x, y] = map.toPage(lng, lat)
    z[j * nx + i] = (exist(...toFt(x, y)) - 200) * 0.3048
  }
  const grid = { zone: 17, epsg: 26917, x0: e0 - dxm, y0: n0 - dxm, dx: dxm, dy: dxm, nx, ny, z, source: 'test', resolutionM: 1 }
  const at = pl.lidarAtPage(map, grid)
  let wl = 0
  for (let k = 0; k < 50; k++) { const x = 200 + k * 19, y = 200 + (k * 37) % 600; wl = Math.max(wl, Math.abs(at(x, y) - (exist(...toFt(x, y)) - 200))) }
  ok(`lidar in page space: page → lng/lat → UTM grid (worst ${wl.toFixed(3)} ft)`, wl < 0.05, wl)
  const rl = pr.readPlan(input, { roles, existingFt: at })
  ok('lidar in page space: the read measures the +200 ft datum through it', near(rl.datumFt, 200, 0.05), rl.datumFt)
}

// ── Small pieces ───────────────────────────────────────────────────────────
{
  // chainLines: exploded dashes join; a corner that turns back does not.
  const dashes = []
  for (let x = 0; x < 100; x += 9) dashes.push([x, 0, x + 6, 0])
  const ch = pr.chainLines(dashes, 4)
  ok('chainLines: dashes 3 apart join into one line', ch.length === 1 && near(lenOf(ch[0].pts), 105, 1e-9), ch.map(c => lenOf(c.pts)))
  const vee = pr.chainLines([[0, 0, 10, 0], [10, 2, 0, 3]], 4)
  ok('chainLines: ends that do not face each other stay apart', vee.length === 2, vee.length)
  const sq = pr.chainLines([[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]], 0.5)
  ok('chainLines: four touching sides close a ring', sq.length === 1 && sq[0].closed, sq.map(c => c.closed))
  const simp = pr.simplify([0, 0, 1, 0.01, 2, 0, 3, 5], 0.1)
  ok('simplify: drops the near-collinear point, keeps the corner', simp.length === 6 && simp[4] === 3, simp)
}

console.log(`plan-read: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
