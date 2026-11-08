// node scripts/estimate-test.mjs — the estimate engine (lib/estimate/engine.ts).
// Run it after ANY change to the engine: these are bid dollars.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/estimate/engine.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const E = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
const near = (a, b, tol, msg) => ok(a !== null && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`)
const S = E.DEFAULT_SETTINGS

// ── units ──
near(E.qtyIn(100, 'SY', 8, 'CY', null, S), 22.2222, 0.001, '100 SY at 8" = 22.22 CY')
near(E.qtyIn(100, 'SY', 8, 'TON', 1.9, S), 42.2222, 0.001, '…= 42.2 tons of stone at 1.9 t/CY')
near(E.qtyIn(100, 'SY', 8, 'LOAD', 1.9, S), 42.2222 / 18, 0.001, '…= 2.35 loads of 18 t')
near(E.qtyIn(10, 'CY', null, 'TON', 1.9, S), 19, 1e-9, 'CY → tons')
near(E.qtyIn(19, 'TON', null, 'CY', 1.9, S), 10, 1e-9, 'tons → CY')
near(E.qtyIn(1, 'AC', null, 'SY', null, S), 4840, 1e-9, 'an acre is 4,840 SY')
near(E.qtyIn(90, 'SF', null, 'SY', null, S), 10, 1e-9, '90 SF = 10 SY')
eq(E.qtyIn(100, 'LF', null, 'TON', 1.9, S), null, 'curb LF never turns into tons')
eq(E.qtyIn(100, 'SY', null, 'CY', null, S), null, 'an area with no depth has no volume')
eq(E.qtyIn(5, 'LS', null, 'EA', null, S), null, 'a lump sum has no unit to convert')
eq(E.qtyIn(12, 'EA', null, 'EA', null, S), 12, 'same unit passes')

// ── loads and trips ──
eq(E.loadsFor(40, 'TON', null, S), 3, '40 t in 18 t trucks = 3 loads')
eq(E.loadsFor(36, 'TON', null, S), 2, 'exactly two loads stays two')
eq(E.loadsFor(30, 'CY', 1.9, S), 4, 'heavy CY: the truck fills by weight first (57 t → 4 loads, not 3 by volume)')
eq(E.loadsFor(30, 'CY', 1.1, S), 3, 'light CY: the truck fills by volume first (30/14 → 3)')
eq(E.loadsFor(100, 'SY', null, S), null, 'SY doesn\'t haul by the load')
eq(E.loadsFor(0, 'TON', null, S), 0, 'nothing to haul, no loads')
near(E.tripCost({ miles: 15, minutes: 20, source: 'road' }, S), ((40 + 15) / 60) * 95, 1e-9, 'a round trip: both ways + load and dump, at the truck rate')

// ── the source that wins ──
const mats = [{ id: 'm-stone', name: 'ABC stone', unit: 'TON', tonsPerCy: 1.9, wastePct: 5 }, { id: 'm-asph', name: 'Surface asphalt', unit: 'TON', tonsPerCy: 2.0, wastePct: 3 }]
const sources = [{ id: 'q-a', name: 'Quarry A', kind: 'quarry' }, { id: 'q-b', name: 'Quarry B', kind: 'quarry' }, { id: 'p-c', name: 'Plant C', kind: 'asphalt' }, { id: 'p-d', name: 'Far quarry', kind: 'quarry' }]
const prices = [
  { id: 'pa', placeId: 'q-a', materialId: 'm-stone', price: 20, unit: 'TON', basis: 'pickup', minCharge: null, fuelPct: null, quotedOn: '2026-10-01' },
  { id: 'pb', placeId: 'q-b', materialId: 'm-stone', price: 18, unit: 'TON', basis: 'pickup', minCharge: null, fuelPct: null, quotedOn: '2026-10-01' },
  { id: 'pc', placeId: 'p-c', materialId: 'm-stone', price: 30, unit: 'TON', basis: 'delivered', minCharge: null, fuelPct: null, quotedOn: '2026-10-01' },
  { id: 'pd', placeId: 'p-d', materialId: 'm-stone', price: 10, unit: 'TON', basis: 'pickup', minCharge: null, fuelPct: null, quotedOn: '2026-10-01' },
  { id: 'pe', placeId: 'p-c', materialId: 'm-asph', price: 70, unit: 'TON', basis: 'pickup', minCharge: 500, fuelPct: 4, quotedOn: '2026-10-15' },
]
const dist = new Map([['q-a', { miles: 18, minutes: 30, source: 'road' }], ['q-b', { miles: 40, minutes: 60, source: 'road' }], ['p-c', { miles: 9, minutes: 15, source: 'fleet' }]])
const opts = E.sourceOptions('m-stone', mats, prices, sources, dist, S)
eq(opts.map((o) => o.placeId), ['q-a', 'q-b', 'p-c', 'p-d'], 'cheapest delivered first; a source with no distance last')
near(opts[0].delivered, 20 + (((60 + 15) / 60) * 95) / 18, 0.01, 'Quarry A delivered = plant + haul per ton')
near(opts[1].delivered, 18 + (((120 + 15) / 60) * 95) / 18, 0.01, 'Quarry B is cheaper at the plant, dearer delivered')
eq([opts[2].haulPerUnit, opts[2].delivered], [0, 30], 'a delivered price carries no haul')
eq([opts[3].delivered, opts[3].haulPerUnit], [null, null], 'no distance yet: delivered unknown, never guessed')
near(E.sourceOptions('m-asph', mats, prices, sources, dist, S)[0].plant, 72.8, 1e-9, 'the fuel surcharge rides on the plant price')

// ── a line ──
const settings = { ...S, crews: [{ key: 'paving', name: 'Paving crew', ratePerHr: 450 }] }
const ctx = { materials: mats, prices, sources, distances: dist, settings, shop: { miles: 12, minutes: 22, source: 'road' } }
const stone = { id: 'l1', section: 'Paving', code: 'PAV-HD', name: 'Stone base 8"', unit: 'SY', qty: 1000, depthIn: 8, materialId: 'm-stone', placeId: null, wastePct: null, crewKey: null, perDay: null, subUnit: null, lowboyTrips: null, note: null }
const c1 = E.lineCost(stone, ctx)
const tons = (1000 * 9 * 8) / 12 / 27 * 1.9 * 1.05
near(c1.materialQty, tons, 0.01, 'stone: 1,000 SY × 8" × 1.9 t/CY × 5% waste')
eq(c1.source?.placeId, 'q-a', 'stone: the cheapest delivered source is picked')
near(c1.material, tons * 20, 0.01, 'stone: material $ at the plant price')
eq(c1.loads, Math.ceil(tons / 18), 'stone: whole loads')
near(c1.haul, Math.ceil(tons / 18) * (((60 + 15) / 60) * 95), 0.01, 'stone: haul = loads × round trip')
near(c1.unitCost, c1.total / 1000, 0.01, 'stone: unit cost per SY')
eq(c1.warnings, [], 'stone: nothing to warn')
const pinned = E.lineCost({ ...stone, placeId: 'q-b' }, ctx)
eq(pinned.source?.placeId, 'q-b', 'a pinned source wins over the cheapest')
const asphalt = { ...stone, id: 'l2', name: 'Surface 3"', depthIn: 3, materialId: 'm-asph', crewKey: 'paving', perDay: 2500 }
const c2 = E.lineCost(asphalt, ctx)
const atons = (1000 * 9 * 3) / 12 / 27 * 2.0 * 1.03
near(c2.material, Math.max(atons * 72.8, 500), 0.01, 'asphalt: fuel surcharge in, minimum charge respected')
near(c2.install, (1000 / 2500) * 450 * 8, 0.01, 'asphalt: crew days × $/hr × hours')
eq(c2.crewDays, 0.4, 'asphalt: 0.4 crew-days')
const small = E.lineCost({ ...asphalt, id: 'l3', qty: 20, crewKey: null, perDay: null }, ctx)
near(small.material, 500, 0.01, 'a small pour pays the minimum charge')
const mob = E.lineCost({ id: 'mob', section: 'General', code: 'MOB', name: 'Mobilization', unit: 'LS', qty: 1, depthIn: null, materialId: null, placeId: null, wastePct: null, crewKey: null, perDay: null, subUnit: null, lowboyTrips: 4, note: null }, ctx)
near(mob.lowboy, 4 * (((44 + 45) / 60) * 150), 0.01, 'mobilization: lowboy round trips from the shop')
eq(mob.unitCost, null, 'a lump sum has no unit cost')
const sub = E.lineCost({ ...stone, id: 'l4', materialId: null, subUnit: 1.25, unit: 'LF', qty: 800 }, ctx)
near(sub.total, 1000, 1e-9, 'a sub quote × the quantity')
const noDist = E.lineCost({ ...stone, id: 'l5', placeId: 'p-d' }, ctx)
ok(noDist.warnings.some((w) => /No road distance/.test(w)) && noDist.haul === 0, 'pinned to a source with no distance: the haul is flagged, not guessed')
const bad = E.lineCost({ ...stone, id: 'l6', depthIn: null }, ctx)
ok(bad.warnings.some((w) => /doesn't convert/.test(w)) && bad.material === 0, 'an area with no depth can\'t be priced by the ton — said so')
const crewless = E.lineCost({ ...stone, id: 'l7', materialId: null, crewKey: 'paving', perDay: null }, ctx)
ok(crewless.warnings.some((w) => /in a day/.test(w)), 'a crew with no production rate asks for one')

// ── the bid ──
const T = E.totals([{ line: stone, cost: { ...c1, total: 600, material: 400 } }, { line: { ...stone, section: 'Storm' }, cost: { ...c1, total: 400, material: 200 } }],
  { overheadPct: 10, contingencyPct: 5, profitPct: 10, bondPct: 1, taxPct: 6 })
eq([T.direct, T.materials, T.overhead, T.contingency, T.profit, T.tax, T.bond, T.bid], [1000, 600, 100, 50, 115, 36, 13.01, 1314.01], 'markups stack: overhead and contingency on cost, profit on that, tax on materials, bond on the lot')
eq(T.bySection, [{ section: 'Paving', total: 600 }, { section: 'Storm', total: 400 }], 'totals by section')
eq(E.totals([], E.NO_MARKUPS).bid, 0, 'an empty estimate is $0')
eq(E.trucksNeeded({ miles: 18, minutes: 30, source: 'road' }, S, 20), 4, 'trucks: a 75-min round trip, a load every 20 min → 4 trucks')

// ── what a device may send ──
// ── ship-check, Nov 8: the quote that stands, light loads, nothing to buy ──
{
  const quotes = [
    { id: 'old', placeId: 'q-a', materialId: 'm-stone', price: 18, unit: 'TON', basis: 'pickup', minCharge: null, fuelPct: null, quotedOn: '2026-01-10' },
    { id: 'new', placeId: 'q-a', materialId: 'm-stone', price: 24, unit: 'TON', basis: 'pickup', minCharge: null, fuelPct: null, quotedOn: '2026-10-02' },
  ]
  const o = E.sourceOptions('m-stone', mats, quotes, sources, dist, S)
  eq(o.map((x) => [x.priceId, x.plant]), [['new', 24]], 'January’s $18 never beats October’s $24 at the same quarry — the newest quote stands')
  const pinnedOld = E.lineCost({ ...stone, placeId: 'q-a' }, { ...ctx, prices: quotes })
  eq(pinnedOld.source?.priceId, 'new', '…a line pinned to that quarry is priced off the newest quote too')
  const top = { id: 'm-top', name: 'Topsoil', unit: 'LOAD', tonsPerCy: 1.1, wastePct: 0 }
  near(E.qtyIn(140, 'CY', null, 'LOAD', 1.1, S), 10, 1e-9, '140 CY of topsoil = 10 loads by volume (14 CY beds), not 8.6 by weight')
  eq(E.loadsFor(140 * 1.1, 'TON', 1.1, S), 10, 'tons of a light material haul by volume too')
  const zero = E.lineCost({ ...stone, id: 'z', qty: 0 }, { ...ctx, prices: [{ ...prices[4], id: 'pz', materialId: 'm-stone' }] })
  eq(zero.material, 0, 'a line with nothing to buy pays no minimum charge')
  void top
  eq(E.layersOf('Heavy duty asphalt (3" on 8" stone)', 11), [3, 8], 'a layered paving item splits into its layers (3" + 8" = the 11" section)')
  eq(E.layersOf('Light duty asphalt (2" on 6" stone)', 8), [2, 6], '…light duty too')
  eq(E.layersOf('Stone base (ABC), 8"', 8), null, 'one material, one layer: the item’s depth')
  eq(E.layersOf('Odd (3" on 8" stone)', 14), null, 'layers that don’t add up to the section are never guessed')
}

const cl = E.cleanLines([
  { id: 'a1', name: 'Curb', unit: 'LF', qty: 120, crewKey: 'Bad Key', subUnit: -3, materialId: 'not-a-uuid' },
  { id: 'a1', name: 'dupe', unit: 'LF', qty: 1 },
  { id: 'b1', name: '', unit: 'LF' },
  { id: 'c1', name: 'x', unit: 'MILES' },
  'junk',
])
eq(cl.map((l) => [l.id, l.name, l.unit, l.qty, l.crewKey, l.subUnit, l.materialId]), [['a1', 'Curb', 'LF', 120, null, null, null]], 'lines: ids unique, names and units required, junk dropped, bad values nulled')
const cs = E.cleanSettings({ haul: { truckTons: 500, ratePerHr: 110 }, crews: [{ key: 'grade', name: 'Grading', ratePerHr: 600 }, { key: 'grade', name: 'Dupe', ratePerHr: 1 }, { key: 'BAD', name: 'x', ratePerHr: 1 }] })
eq([cs.haul.truckTons, cs.haul.ratePerHr, cs.crews.map((c) => c.key)], [18, 110, ['grade']], 'settings: out-of-range values fall back, crew keys unique and well-formed')
eq(E.cleanMarkups({ overheadPct: 12, profitPct: 400, bondPct: 'x' }), { overheadPct: 12, contingencyPct: 0, profitPct: 0, bondPct: 0, taxPct: 0 }, 'markups: 0–100 % only')
eq(E.crewKeyOf('Paving Crew #2'), 'paving-crew-2', 'crew keys from names')

console.log(`\nestimate: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
