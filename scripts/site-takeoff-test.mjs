/**
 * Site takeoff, asserted (run: node scripts/site-takeoff-test.mjs).
 *
 * lib/site-takeoff/* turns marks on a drone picture into bid quantities —
 * SF/SY, LF, counts, mulch CY and $ totals. This checks the ground measure
 * against an independent spherical computation, the money math, CSV safety,
 * the design validator, the picture ↔ map mapping, the magic wand on a
 * synthetic parking lot (stripes, a parked car, grass around it), and the
 * stall counter on synthetic paint. Run after ANY change to lib/site-takeoff.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
function transpile(rel, deps = {}) {
  let src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [spec, url] of Object.entries(deps)) src = src.replaceAll(`from '${spec}'`, `from '${url}'`)
  return dataUrl(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}
const tmUrl = transpile('../lib/dirt/tm.ts')
const geomUrl = transpile('../lib/dirt/geom.ts')
const itemsUrl = transpile('../lib/site-takeoff/items.ts')
const measure = await import(transpile('../lib/site-takeoff/measure.ts', { '../dirt/tm': tmUrl, '../dirt/geom': geomUrl, './items': itemsUrl }))
const items = await import(itemsUrl)
const schema = await import(transpile('../lib/site-takeoff/schema.ts', { './items': itemsUrl }))
const wand = await import(transpile('../lib/site-takeoff/wand.ts'))
const stalls = await import(transpile('../lib/site-takeoff/stalls.ts'))
const quad = await import(transpile('../lib/site-takeoff/quad.ts'))
const tm = await import(tmUrl)

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => Number.isFinite(a) && Math.abs(a - b) <= eps
const rel = (a, b) => Math.abs(a - b) / Math.abs(b)

// ── Independent sphere: haversine + spherical-excess area (R = mean radius) ──
const R = 6371008.8, D = Math.PI / 180
const hav = (a, b) => {
  const dφ = (b[1] - a[1]) * D, dλ = (b[0] - a[0]) * D
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a[1] * D) * Math.cos(b[1] * D) * Math.sin(dλ / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const sphArea = (ring) => {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length]
    s += (q[0] - p[0]) * D * (2 + Math.sin(p[1] * D) + Math.sin(q[1] * D))
  }
  return Math.abs(s * R * R / 2)
}

// ── Ground measure ─────────────────────────────────────────────────────────
const LOT = [-82.394, 34.8526]
const f0 = tm.makeFrame(...LOT)
// A 120 m × 80 m lot and an L-shaped bed, corners laid out in the frame.
const sq = [[-60, -40], [60, -40], [60, 40], [-60, 40]].map(([x, y]) => tm.fromFrame(f0, x * f0.k, y * f0.k))
const ell = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]].map(([x, y]) => tm.fromFrame(f0, x * f0.k + 70, y * f0.k + 50))
{
  const f = measure.frameFor(sq)
  const a = measure.ringAreaM2(f, sq)
  ok('area: 120 × 80 m lot = 9,600 m² (frame, scale-corrected)', near(a, 9600, 0.5), a)
  ok('area: agrees with an independent spherical area to 0.3%', rel(a, sphArea(sq)) < 0.003, [a, sphArea(sq)])
  const aL = measure.ringAreaM2(f, ell)
  ok('area: L-shaped bed = 450 m²', near(aL, 450, 0.2), aL)
  ok('area: L bed vs sphere to 0.3%', rel(aL, sphArea(ell)) < 0.003, [aL, sphArea(ell)])
  ok('area: ring direction does not matter', near(measure.ringAreaM2(f, sq.slice().reverse()), a, 1e-6))
  const line = [sq[0], sq[1], sq[2]]
  const L = measure.lineLengthM(f, line)
  ok('length: two sides = 200 m', near(L, 200, 0.05), L)
  ok('length: agrees with haversine to 0.3%', rel(L, hav(sq[0], sq[1]) + hav(sq[1], sq[2])) < 0.003, [L, hav(sq[0], sq[1]) + hav(sq[1], sq[2])])
  // A long line far from the site still measures right (frame is the takeoff's mean).
  const far = [tm.fromFrame(f0, -2000, 0), tm.fromFrame(f0, 2000, 0)]
  ok('length: 4 km line vs haversine to 0.3%', rel(measure.lineLengthM(measure.frameFor(far), far), hav(far[0], far[1])) < 0.003)
  ok('area: degenerate ring is 0', measure.ringAreaM2(f, sq.slice(0, 2)) === 0)
  ok('frameFor: no coords → null', measure.frameFor([]) === null)
}

// ── Quantities, prices, mulch, minus areas ────────────────────────────────
{
  const d = items.emptySiteDesign()
  ok('presets: 12 line items, every kind present', d.items.length === 12 && ['area', 'line', 'count'].every(k => d.items.some(i => i.kind === k)))
  ok('presets: mulch carries a 3" depth and is priced per CY', d.items.find(i => i.id === 'mulch').depthIn === 3 && d.items.find(i => i.id === 'mulch').priceUnit === 'cy')
  ok('presets: no price is filled in', d.items.every(i => i.price === null))
  d.items.find(i => i.id === 'asphalt').price = 18 // $/SY
  d.items.find(i => i.id === 'mulch').price = 45 // $/CY
  d.items.find(i => i.id === 'striping').price = 0.5
  d.items.find(i => i.id === 'stalls').price = 12
  const island = [[-5, -5], [5, -5], [5, 5], [-5, 5]].map(([x, y]) => tm.fromFrame(f0, x * f0.k, y * f0.k))
  d.marks.push({ id: 'm1', item: 'asphalt', coords: sq })
  d.marks.push({ id: 'm2', item: 'asphalt', coords: island, minus: true })
  d.marks.push({ id: 'm3', item: 'mulch', coords: ell })
  d.marks.push({ id: 'm4', item: 'striping', coords: [sq[0], sq[1]] })
  d.marks.push({ id: 'm5', item: 'stalls', coords: [sq[0], sq[1]], count: 14, src: 'stall' })
  d.marks.push({ id: 'm6', item: 'stalls', coords: [sq[2], sq[3]] })
  d.marks.push({ id: 'm7', item: 'trees', coords: [sq[0], sq[1], sq[2]] })
  const r = measure.computeSite(d)
  const by = (id) => r.items.find(i => i.id === id)
  const SF = measure.M2_TO_SF
  ok('asphalt: lot minus the island, in SF', near(by('asphalt').qty, (9600 - 100) * SF, 0.2), by('asphalt').qty)
  ok('asphalt: SY = SF ÷ 9', near(by('asphalt').sy, by('asphalt').qty / 9, 0.02))
  ok('asphalt: priced per SY', near(by('asphalt').total, Math.round(by('asphalt').qty / 9 * 18 * 100) / 100, 0.1), by('asphalt').total)
  const mulchCy = 450 * SF * (3 / 12) / 27
  ok('mulch: CY = SF × depth ÷ 27', near(by('mulch').cy, mulchCy, 0.02), [by('mulch').cy, mulchCy])
  ok('mulch: priced per CY', near(by('mulch').total, mulchCy * 45, 1), by('mulch').total)
  ok('striping: LF', near(by('striping').qty, 120 * measure.M_TO_FT, 0.05), by('striping').qty)
  ok('stalls: row count 14 + two single points = 16', by('stalls').qty === 16, by('stalls').qty)
  ok('stalls: $12 × 16', by('stalls').total === 192)
  ok('trees: three points = 3, no price → unpriced', by('trees').qty === 3 && by('trees').total === null)
  ok('unpriced counts items with quantities but no price', r.unpriced === 1, r.unpriced)
  const sum = ['asphalt', 'mulch', 'striping', 'stalls'].reduce((s, id) => s + by(id).total, 0)
  ok('grand total = sum of priced lines', near(r.total, sum, 0.02), [r.total, sum])
  // A minus bigger than its item never goes negative.
  const d2 = items.emptySiteDesign()
  d2.marks.push({ id: 'a', item: 'turf', coords: island }, { id: 'b', item: 'turf', coords: sq, minus: true })
  ok('area never negative', measure.computeSite(d2).items.find(i => i.id === 'turf').qty === 0)
  ok('count mark with count 0 counts 0', measure.markCount({ id: 'x', item: 'stalls', coords: [sq[0], sq[1]], count: 0 }) === 0)

  const csv = measure.resultsCsv('=HYPERLINK("x") lot', r)
  ok('CSV: header row present', csv.includes('Line item,Quantity,Unit'))
  ok('CSV: a formula-looking name is defused', csv.includes(`"'=HYPERLINK(""x"") lot"`), csv.split('\n')[0])
  ok('CSV: items without marks are left out', !csv.includes('Concrete'))
  ok('CSV: total row', /\nTotal,+[0-9.]+\n$/.test(csv), csv.slice(-40))
  ok('qtyLabel: area reads SF · SY', /SF · .* SY/.test(measure.qtyLabel(by('asphalt'))))
  ok('qtyLabel: mulch adds CY at depth', /CY at 3"/.test(measure.qtyLabel(by('mulch'))))
}

// ── Validator ─────────────────────────────────────────────────────────────
{
  const good = items.emptySiteDesign()
  good.marks.push({ id: 'm1', item: 'asphalt', coords: sq, extra: 'drop me' })
  const c = schema.checkSiteDesign({ ...good, junk: 1 })
  ok('schema: a good design passes', c.ok, c.error)
  ok('schema: unknown keys are dropped', c.ok && !('junk' in c.design) && !('extra' in c.design.marks[0]))
  ok('schema: a mark on a missing item fails', !schema.checkSiteDesign({ ...good, marks: [{ id: 'z', item: 'nope', coords: sq }] }).ok)
  ok('schema: an area with 2 corners fails', !schema.checkSiteDesign({ ...good, marks: [{ id: 'z', item: 'asphalt', coords: sq.slice(0, 2) }] }).ok)
  ok('schema: a point off the map fails', !schema.checkSiteDesign({ ...good, marks: [{ id: 'z', item: 'trees', coords: [[200, 0]] }] }).ok)
  ok('schema: NaN coordinate fails', !schema.checkSiteDesign({ ...good, marks: [{ id: 'z', item: 'trees', coords: [['x', 0]] }] }).ok)
  ok('schema: duplicate item ids fail', !schema.checkSiteDesign({ ...good, items: [...good.items, good.items[0]] }).ok)
  ok('schema: price per CY needs a depth', !schema.checkSiteDesign({ ...good, items: good.items.map(i => i.id === 'mulch' ? { ...i, depthIn: null } : i) }).ok)
  ok('schema: a count item cannot be priced per SF', !schema.checkSiteDesign({ ...good, items: good.items.map(i => i.id === 'trees' ? { ...i, priceUnit: 'sf' } : i) }).ok)
  ok('schema: negative price fails', !schema.checkSiteDesign({ ...good, items: good.items.map(i => i.id === 'curb' ? { ...i, price: -3 } : i) }).ok)
  ok('schema: bad imagery id fails', !schema.checkSiteDesign({ ...good, imageryId: '../x' }).ok)
  ok('schema: too many marks fails', !schema.checkSiteDesign({ ...good, marks: Array.from({ length: schema.MAX_MARKS + 1 }, (_, i) => ({ id: 'm' + i, item: 'trees', coords: [sq[0]] })) }).ok)
  const minus = schema.checkSiteDesign({ ...good, marks: [{ id: 'z', item: 'trees', coords: [sq[0]], minus: true }, { id: 'y', item: 'turf', coords: sq, minus: true }] })
  ok('schema: minus kept on areas only', minus.ok && !minus.design.marks[0].minus && minus.design.marks[1].minus === true)
  ok('schema: a non-object fails', !schema.checkSiteDesign('x').ok && !schema.checkSiteDesign(null).ok)
}

// ── Picture ↔ map ─────────────────────────────────────────────────────────
{
  const corners = [[-82.3950, 34.8540], [-82.3920, 34.8538], [-82.3921, 34.8515], [-82.3952, 34.8516]]
  const q = quad.makeQuad(corners)
  const c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => quad.uvToLngLat(q, u, v))
  ok('quad: the four corners land on their corners', c.every((p, i) => near(p[0], corners[i][0], 1e-12) && near(p[1], corners[i][1], 1e-9)))
  let worst = 0
  for (let i = 0; i < 200; i++) {
    const u = Math.random(), v = Math.random()
    const [lng, lat] = quad.uvToLngLat(q, u, v)
    const back = quad.lngLatToUv(q, lng, lat)
    worst = Math.max(worst, Math.abs(back[0] - u), Math.abs(back[1] - v))
  }
  ok('quad: uv → lng/lat → uv round-trips (200 random points)', worst < 1e-9, worst)
  ok('quad: bad corners → null', quad.makeQuad([[0, 0]]) === null)
  const off = quad.lngLatToUv(q, -82.40, 34.86)
  ok('quad: a point off the picture falls outside [0,1]', off && (off[0] < 0 || off[0] > 1 || off[1] < 0 || off[1] > 1))
}

// ── Magic wand on a synthetic lot ─────────────────────────────────────────
let seed = 7
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
function lotImage({ withCar = true, stripes = true } = {}) {
  const W = 220, H = 160
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const inLot = x >= 40 && x < 170 && y >= 30 && y < 120
      let r, g, b
      if (inLot) {
        const n = (rnd() - 0.5) * 8
        r = 72 + n; g = 74 + n; b = 78 + n
        if (stripes && y >= 34 && y < 64 && (x - 50) % 22 < 2 && x >= 50 && x < 160) { r = 235; g = 235; b = 230 }
        if (withCar && x >= 100 && x < 112 && y >= 80 && y < 100) { r = 150; g = 20; b = 20 }
      } else {
        const n = (rnd() - 0.5) * 50
        r = 60 + n; g = 120 + n; b = 45 + n * 0.5
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  return { width: W, height: H, data }
}
{
  const img = lotImage()
  const res = wand.magicWand(img, 130, 100, { tolerance: 30 })
  ok('wand: returns a polygon', !!res && res.ring.length >= 4, res)
  const A = res ? wand.ringPixelArea(res.ring) : 0
  ok('wand: lot area within 3% of 130 × 90 px (stripes bridged, car hole filled)', rel(A, 130 * 90) < 0.03, A)
  ok('wand: did not leak into the grass', res && res.ring.every(([x, y]) => x >= 38 && x <= 172 && y >= 28 && y <= 122), res && res.ring.slice(0, 6))
  ok('wand: simplified to a handful of corners', res && res.ring.length <= 16, res && res.ring.length)
  ok('wand: not capped', res && !res.capped)
  const tight = wand.magicWand(img, 130, 100, { tolerance: 0 })
  ok('wand: tolerance 0 grows less than tolerance 30', !tight || wand.ringPixelArea(tight.ring) <= A + 1)
  const off = wand.magicWand(img, -5, 10, {})
  ok('wand: a tap off the picture gives nothing', off === null)
  const grass = wand.magicWand(img, 10, 10, { tolerance: 30 })
  ok('wand: a tap on the busy grass never takes the asphalt', !grass || grass.ring.every(([x, y]) => !(x > 60 && x < 150 && y > 50 && y < 110)) || wand.ringPixelArea(grass.ring) < 130 * 90 * 0.5)
  const capped = wand.magicWand(img, 130, 100, { tolerance: 30, maxPixels: 500 })
  ok('wand: maxPixels caps the grow and says so', capped && capped.capped)
  // Morphology pieces.
  const W = 9, H = 9, m = new Uint8Array(W * H); m[4 * W + 4] = 1
  const dil = wand.morph(m, W, H, 1)
  ok('morph: dilate a dot by 1 → 3×3', dil.reduce((a, b) => a + b, 0) === 9)
  ok('morph: erode it back → 1', wand.morph(dil, W, H, -1).reduce((a, b) => a + b, 0) === 1)
  const ring = new Uint8Array(W * H)
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) ring[y * W + x] = (x === 2 || x === 6 || y === 2 || y === 6) ? 1 : 0
  ok('fillHoles: a hollow square fills to 25', wand.fillHoles(ring, W, H).reduce((a, b) => a + b, 0) === 25)
  const out = wand.traceOutline(wand.fillHoles(ring, W, H), W, H)
  ok('traceOutline: 5×5 block outline has area 25', wand.ringPixelArea(out) === 25, out.length)
  ok('simplifyRing: the 5×5 outline simplifies to 4 corners', wand.simplifyRing(out, 0.5).length === 4, wand.simplifyRing(out, 0.5))
  ok('rgbToLab: white ≈ L 100', near(wand.rgbToLab(255, 255, 255)[0], 100, 0.01))
  ok('rgbToLab: black = L 0', near(wand.rgbToLab(0, 0, 0)[0], 0, 0.01))
}

// ── Stall counter ─────────────────────────────────────────────────────────
{
  const profile = (n, period, width, { skip = -1, base = 80, paint = 220 } = {}) => {
    const p = []
    for (let i = 0; i < n; i++) {
      const k = Math.floor((i - 5) / period), off = (i - 5) - k * period
      const on = i >= 5 && off < width && k !== skip && k <= 9
      p.push((on ? paint : base) + (rnd() - 0.5) * 10)
    }
    return p
  }
  const p = profile(260, 27, 3)
  const s = stalls.findStripes(p)
  ok('stalls: 10 stripes → 9 stalls', s.stripes.length === 10 && s.stalls === 9, s)
  ok('stalls: spacing ≈ 27 samples', near(s.spacing, 27, 1), s.spacing)
  ok('stalls: a regular row is not flagged', !s.irregular)
  const miss = stalls.findStripes(profile(260, 27, 3, { skip: 4 }))
  ok('stalls: a missing stripe (car over it) undercounts and is flagged irregular', miss.stalls === 8 && miss.irregular, miss)
  ok('stalls: plain asphalt → 0', stalls.findStripes(Array.from({ length: 200 }, () => 80 + (rnd() - 0.5) * 10)).stalls === 0)
  const dbl = []
  for (let i = 0; i < 200; i++) { const off = i % 40; dbl.push((off === 10 || off === 11 || off === 14 || off === 15) ? 220 : 80) }
  ok('stalls: a double line counts as one divider', stalls.findStripes(dbl).stripes.length === 5, stalls.findStripes(dbl))
  ok('stalls: too short a profile → 0', stalls.findStripes([1, 2]).stalls === 0)
  // From the synthetic lot picture: a row across the stripes (y = 50).
  const img = lotImage({ withCar: false })
  const prof = stalls.sampleProfile(img, 45, 50, 165, 50)
  const fromImg = stalls.findStripes(prof)
  ok('stalls: from the picture, 5 stripes → 4 stalls', fromImg.stripes.length === 5 && fromImg.stalls === 4, fromImg)
  const skew = stalls.findStripes(stalls.sampleProfile(img, 45, 48, 165, 53))
  ok('stalls: a slightly slanted row line still finds them', skew.stripes.length === 5, skew)
  ok('sampleProfile: zero-length line → []', stalls.sampleProfile(img, 5, 5, 5, 5).length === 0)
}

console.log(`site-takeoff: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
