/**
 * The fuel reconciliation pilot's engine, asserted
 * (run: node scripts/fuel-check-test.mjs).
 *
 * lib/fuel-check.ts reads card and fleet-card exports, places nothing it
 * can't, and raises only four exceptions — the vehicle wasn't at the pump,
 * more gallons than the tank had room for, no running after the purchase,
 * outside the shift / hours / area — each with the dollars at risk and what
 * telemetry limited it. These go in front of an owner as "your driver may
 * have bought fuel for something else", so the false alarms are asserted
 * out as hard as the real ones are asserted in. The last section drives the
 * runner (lib/db/fuel-check.ts runFuelCheck) end to end against a stand-in
 * database and a stubbed Photon. Run after ANY change to lib/fuel-check.ts,
 * lib/db/fuel-check.ts or lib/fuel-geocode.ts (and to lib/asset-stats.ts's
 * gauge reader).
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
const datesUrl = transpile('../lib/dates.ts')
const statsUrl = transpile('../lib/asset-stats.ts')
const iconsUrl = transpile('../lib/asset-icons.ts')
const bulkUrl = transpile('../lib/bulk-import.ts', { './asset-icons': iconsUrl })
const fc = await import(transpile('../lib/fuel-check.ts', { './asset-stats': statsUrl, './dates': datesUrl, './bulk-import': bulkUrl }))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => a != null && Math.abs(a - b) <= eps
const TZ = 'America/New_York'
const at = (s) => Date.parse(s)
const MIN = 60_000, HOUR = 3_600_000

// ── Small parsers ───────────────────────────────────────────────────────────
ok('money: a charge written negative', fc.parseMoney('-45.12') === -45.12)
ok('money: dollars, commas, parentheses', fc.parseMoney('$1,204.50') === 1204.5 && fc.parseMoney('(62.15)') === -62.15)
ok('money: a trailing minus and CR are credits', fc.parseMoney('45.12-') === -45.12 && fc.parseMoney('45.12 CR') === -45.12)
ok('money: junk is null', fc.parseMoney('n/a') === null && fc.parseMoney('') === null)
ok('date: US, ISO, 2-digit year, day-month-name', fc.parseDateCell('10/1/2026')?.day === '2026-10-01' && fc.parseDateCell('2026-10-01')?.day === '2026-10-01'
  && fc.parseDateCell('10/01/26')?.day === '2026-10-01' && fc.parseDateCell('01-OCT-2026')?.day === '2026-10-01')
ok('date: a time riding in the date cell', fc.parseDateCell('10/01/2026 7:42 AM')?.minutes === 462 && fc.parseDateCell('2026-10-01T19:05:00')?.minutes === 1145)
ok('date: an impossible date is refused', fc.parseDateCell('02/30/2026') === null && fc.parseDateCell('13/01/2026') === null)
ok('time: 24-hour, 12-hour, HHMM, noon and midnight', fc.parseTimeCell('07:42') === 462 && fc.parseTimeCell('7:42 PM') === 1182
  && fc.parseTimeCell('0742') === 462 && fc.parseTimeCell('12:05 AM') === 5 && fc.parseTimeCell('12:05 pm') === 725)
ok('time: nonsense is null', fc.parseTimeCell('25:00') === null && fc.parseTimeCell('7:61') === null && fc.parseTimeCell('soon') === null)
ok('local time → instant (EDT)', fc.localToUtcMs('2026-10-01', 462, TZ) === at('2026-10-01T07:42:00-04:00'))
ok('local time → instant (EST)', fc.localToUtcMs('2026-12-01', 462, TZ) === at('2026-12-01T07:42:00-05:00'))
ok('card: last four from any form', fc.last4Of('XXXX-XXXX-XXXX-4821') === '4821' && fc.last4Of('-41007') === '1007' && fc.last4Of('482') === null)

// ── Merchants ───────────────────────────────────────────────────────────────
ok('brand: the Carolinas lineup', fc.fuelBrand('SPINX #0156 GREENVILLE SC') === 'Spinx' && fc.fuelBrand('QT 1042 GREENVILLE SC') === 'QuikTrip'
  && fc.fuelBrand('CIRCLE K 02725 SPARTANBURG SC') === 'Circle K' && fc.fuelBrand('MURPHY7065ATWAL-MART GREER SC') === 'Murphy USA'
  && fc.fuelBrand('KANGAROO EXPRESS 3245 TRAVELERS REST SC') === 'Kangaroo Express' && fc.fuelBrand("LOVE'S #0451 OUTSIDE ANDERSON SC") === "Love's"
  && fc.fuelBrand('PILOT_00123 PIEDMONT SC') === 'Pilot' && fc.fuelBrand('RACETRAC 2345 SPARTANBURG SC') === 'RaceTrac')
ok('brand: a warehouse club only when the line says fuel', fc.fuelBrand('COSTCO GAS #1234 GREENVILLE SC') === 'Costco' && fc.fuelBrand('COSTCO WHSE #1234 GREENVILLE SC') === null
  && fc.fuelBrand("SAM'S CLUB #6370 GREENVILLE SC") === null && fc.fuelBrand('INGLES GAS EXP 92 GREER SC') === 'Ingles')
ok('fuel merchant: words and the issuer category', fc.isFuelMerchant('MAYS FOOD MART GAS SIMPSONVILLE SC') && fc.isFuelMerchant('ROADSIDE MARKET 12', 'Gas')
  && fc.isFuelMerchant('ROADSIDE MARKET 12', 'Transportation-Fuel') && fc.isFuelMerchant('ROADSIDE MARKET 12', '5542'))
ok('fuel merchant: not the gas bill, not the hardware store', !fc.isFuelMerchant('PIEDMONT NATURAL GAS') && !fc.isFuelMerchant('GAS SOUTH AUTOPAY')
  && !fc.isFuelMerchant('THE HOME DEPOT #1123') && !fc.isFuelMerchant('GASTONIA TIRE CENTER'))
ok('product: diesel, gas, DEF, not fuel', fc.productOf('Diesel #2') === 'diesel' && fc.productOf('ULSD') === 'diesel' && fc.productOf('Unleaded Regular') === 'gas'
  && fc.productOf('DEF') === 'def' && fc.productOf('Car Wash') === 'other' && fc.productOf('') === null)
{
  const m = fc.parseMerchant('SPINX #0156 NORTH CHARLESTON SC')
  ok('merchant: brand, store, two-word city first, state', m.brand === 'Spinx' && m.storeNo === '0156' && m.state === 'SC'
    && m.cityCandidates[0] === 'North Charleston' && m.cityCandidates[1] === 'Charleston', m)
  const g = fc.parseMerchant('SPINX #0156GREENVILLE SC')
  ok('merchant: a store number glued to the city', g.storeNo === '0156' && g.cityCandidates[0] === 'Greenville', g)
  const z = fc.parseMerchant('MAYS FOOD MART SIMPSONVILLE SC 29681')
  ok('merchant: an unbranded station keeps its name; a ZIP is not a store number', z.brand === null && z.name === 'Mays Food Mart' && z.zip === '29681'
    && z.storeNo === null && z.cityCandidates[0] === 'Simpsonville', z)
  const q = fc.parseMerchant('QT 1042 GREENVILLE SC')
  ok('merchant: the brand word is never part of the city', q.cityCandidates.length === 1 && q.cityCandidates[0] === 'Greenville' && q.storeNo === '1042', q)
  ok('merchant: no state, no city guess', fc.parseMerchant('SHELL OIL 57444136200').cityCandidates.length === 0)
}
ok('fuel type: VIN decode, then the name', fc.fuelTypeOf({ fuel: 'Diesel' }, 'Truck 2', 'vehicle') === 'diesel' && fc.fuelTypeOf({}, 'Chevy 1500', 'vehicle') === null
  && fc.fuelTypeOf({}, 'F650 Dump Truck', 'vehicle') === 'diesel' && fc.fuelTypeOf({}, 'Takeuchi TB235', 'equipment') === 'diesel')

// ── A bank export (Chase shape) ─────────────────────────────────────────────
const CHASE = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '10/01/2026,10/02/2026,SPINX #0156 GREENVILLE SC,Gas,Sale,-84.20,',
  '10/01/2026,10/02/2026,THE HOME DEPOT #1123,Home,Sale,-212.40,',
  '10/02/2026,10/03/2026,QT 1042 GREENVILLE SC,Gas,Sale,-6.49,',
  '10/03/2026,10/04/2026,CIRCLE K 02725 SPARTANBURG SC,Gas,Sale,-71.15,',
  '10/03/2026,10/04/2026,CIRCLE K 02725 SPARTANBURG SC,Gas,Sale,-71.15,',
  '10/04/2026,10/04/2026,Payment Thank You-Mobile,,Payment,500.00,',
  '10/05/2026,10/06/2026,EXXONMOBIL 4729 FOUNTAIN INN SC,Gas,Return,12.00,',
].join('\n')
const chase = fc.parseFuelCsv(CHASE, { tz: TZ })
ok('bank export: read as a bank shape, negatives flipped', chase.shape === 'bank' && chase.signFlipped, { shape: chase.shape, flipped: chase.signFlipped })
ok('bank export: keeps the three fuel charges', chase.rows.length === 3 && chase.rows.every((r) => r.amount > 15), chase.rows.map((r) => [r.merchant, r.amount]))
ok('bank export: drops the hardware store, the $6.49 snack, the payment and the refund',
  chase.skipped.some((s) => /Not a fuel merchant/.test(s.reason)) && chase.skipped.some((s) => /Under \$15/.test(s.reason))
  && chase.skipped.filter((s) => /credit|refund|payment/i.test(s.reason)).length === 2, chase.skipped.map((s) => s.reason))
ok('bank export: date only, no time', chase.rows.every((r) => !r.hasTime && r.txnAtMs === null && r.txnDate.startsWith('2026-10-0')))
ok('bank export: city read off the line', chase.rows[0].cityCandidates[0] === 'Greenville' && chase.rows[0].state === 'SC' && chase.rows[0].brand === 'Spinx')
ok('bank export: two identical lines are two purchases with two keys', chase.rows[1].dedupeKey !== chase.rows[2].dedupeKey && chase.rows[2].dedupeKey.endsWith('|2'), chase.rows.map((r) => r.dedupeKey))
ok('bank export: re-importing gives the same keys', fc.parseFuelCsv(CHASE, { tz: TZ }).rows.map((r) => r.dedupeKey).join() === chase.rows.map((r) => r.dedupeKey).join())

// ── A fleet-card export (WEX shape, title lines first) ─────────────────────
const WEX = [
  'WEX Fleet Transaction Detail',
  'Account: DEMO-0000,,,,,,,,,,,,',
  'Transaction Date,Transaction Time,Card Number,Driver Name,Vehicle Number,Site Name,Site Address,Site City,Site State,Product Description,Units,Price Per Unit,Net Amount,Odometer',
  '10/01/2026,07:42,XXXXXXXXXXXX0417,DRIVER A,TRUCK 3,SPINX #0156,1200 WADE HAMPTON BLVD,GREENVILLE,SC,Diesel #2,24.310,3.459,84.09,98123',
  '10/01/2026,07:43,XXXXXXXXXXXX0417,DRIVER A,TRUCK 3,SPINX #0156,1200 WADE HAMPTON BLVD,GREENVILLE,SC,DEF,2.500,3.990,9.98,98123',
  '10/01/2026,07:44,XXXXXXXXXXXX0417,DRIVER A,TRUCK 3,SPINX #0156,1200 WADE HAMPTON BLVD,GREENVILLE,SC,Car Wash,1,12.00,12.00,98123',
  '10/04/2026,18:12,XXXXXXXXXXXX0525,DRIVER B,RAM 3500,QT 1042,55 HWY 14,GREER,SC,Unleaded Regular,18.700,3.099,57.95,',
].join('\n')
const wex = fc.parseFuelCsv(WEX, { tz: TZ })
ok('fleet export: header found under the title lines', wex.headerRow === 2 && wex.shape === 'fleet', { row: wex.headerRow, shape: wex.shape })
ok('fleet export: every column mapped by its own name', ['date', 'time', 'card', 'driver', 'vehicle', 'merchant', 'address', 'city', 'state', 'product', 'gallons', 'unitPrice', 'amount', 'odometer']
  .every((f) => wex.mapping.includes(f)), wex.mapping)
ok('fleet export: fuel and DEF kept, the car wash dropped', wex.rows.length === 3 && wex.skipped.some((s) => /Car Wash/.test(s.reason)), wex.rows.map((r) => r.product))
ok('fleet export: the time is the company\'s wall clock', wex.rows[0].hasTime && wex.rows[0].txnAtMs === at('2026-10-01T07:42:00-04:00'))
ok('fleet export: gallons, price, card, vehicle, odometer carried', wex.rows[0].gallons === 24.31 && wex.rows[0].unitPrice === 3.459 && wex.rows[0].cardLast4 === '0417'
  && wex.rows[0].vehicle === 'TRUCK 3' && wex.rows[0].odometer === 98123 && wex.rows[0].product === 'diesel' && wex.rows[1].product === 'def')
ok('fleet export: address + city from their own columns', wex.rows[0].address === '1200 WADE HAMPTON BLVD' && wex.rows[0].city === 'Greenville' && wex.rows[0].state === 'SC')
const remapped = fc.parseFuelCsv(WEX, { tz: TZ, mapping: wex.mapping.map((k) => (k === 'time' ? null : k)) })
ok('a column un-mapped in the preview stays un-mapped on import (no time)', remapped.rows.every((r) => !r.hasTime))
ok('no header row → a plain warning, nothing imported', fc.parseFuelCsv('just some words\nmore words', { tz: TZ }).warnings.length === 1)

ok('same purchase: card alert vs the statement line', fc.samePurchase(
  { txnDate: '2026-10-01', amount: 84.2, cardLast4: '0417', txnAtMs: at('2026-10-01T07:42:00-04:00'), brand: 'Spinx' },
  { txnDate: '2026-10-01', amount: 84.2, cardLast4: null, txnAtMs: null, brand: 'Spinx' }))
ok('same purchase: different cents, card or brand are different purchases',
  !fc.samePurchase({ txnDate: '2026-10-01', amount: 84.2, cardLast4: '0417', txnAtMs: null, brand: null }, { txnDate: '2026-10-01', amount: 84.21, cardLast4: '0417', txnAtMs: null, brand: null })
  && !fc.samePurchase({ txnDate: '2026-10-01', amount: 84.2, cardLast4: '0417', txnAtMs: null, brand: null }, { txnDate: '2026-10-01', amount: 84.2, cardLast4: '0525', txnAtMs: null, brand: null })
  && !fc.samePurchase({ txnDate: '2026-10-01', amount: 84.2, cardLast4: null, txnAtMs: null, brand: 'Shell' }, { txnDate: '2026-10-01', amount: 84.2, cardLast4: null, txnAtMs: null, brand: 'Spinx' }))

// ── The checks ──────────────────────────────────────────────────────────────
// Greenville-ish stage: the station, a yard 14 miles east, a site west.
const STATION = { lat: 34.8526, lng: -82.394 }
const mLat = 1 / 110_574
const mLng = 1 / (111_320 * Math.cos((34.85 * Math.PI) / 180))
const off = (p, eastM, northM) => ({ lat: p.lat + northM * mLat, lng: p.lng + eastM * mLng })
const box = (c, half) => [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]].map(([e, n]) => { const q = off(c, e, n); return [q.lng, q.lat] })
const YARD_C = off(STATION, 22_530, 0) // 14 miles east
const SITE_C = off(STATION, -3_000, 1_000)
const ZONES = [
  { id: 'z-yard', name: 'Greenville yard', kind: 'yard', ring: box(YARD_C, 150) },
  { id: 'z-site', name: 'Creekside', kind: 'site', ring: box(SITE_C, 250) },
]
const HOURS = { tz: TZ, workStart: '07:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] }
const SETTINGS = { ...fc.DEFAULT_SETTINGS }
const T = at('2026-10-01T07:42:00-04:00') // a Thursday
const NOW = at('2026-10-06T12:00:00-04:00')
const RAM = { id: 'a-ram', name: 'RAM 3500', type: 'vehicle', hasTracker: true, tankGal: 32, fuelType: 'diesel', reportsFuelLevel: true, reportsIgnition: true }
const txnBase = {
  id: 't1', txnDate: '2026-10-01', txnAtMs: T, amount: 84.09, gallons: 24.31, unitPrice: 3.459, product: 'diesel', merchant: 'SPINX #0156',
  brand: 'Spinx', points: [STATION], precision: 'exact', placeLabel: 'Spinx (Wade Hampton Blvd)', cardLast4: '0417', cardholderUserId: null,
}
const presenceBase = { fromMs: T - 30 * MIN, toMs: T + 30 * MIN, near: null, stops: [], before: null, after: null, fixesInWindow: 40, others: [], cardholderPhone: null }
const input = (o = {}) => ({
  txn: { ...txnBase, ...(o.txn ?? {}) },
  asset: o.asset === undefined ? RAM : o.asset,
  assetVia: 'card',
  presence: o.presence === undefined ? presenceBase : o.presence === null ? null : { ...presenceBase, ...o.presence },
  gauge: o.gauge ?? null,
  runtime: o.runtime === undefined ? { fromMs: T, toMs: T + 24 * HOUR, firstRunMs: T + 6 * MIN, lastFixMs: T + 20 * HOUR } : o.runtime,
  area: o.area ?? { zones: ZONES, places: [], dayPath: [] },
  shift: o.shift ?? null,
  hours: o.hours ?? HOURS,
  settings: o.settings ?? SETTINGS,
  nowMs: o.nowMs ?? NOW,
})
const check = (kind, o) => fc.runFuelChecks(input(o)).find((r) => r.kind === kind)

// 1. At the pump
{
  const parked = check('asset_absent', { presence: { near: { firstMs: T - 6 * MIN, lastMs: T + 5 * MIN, n: 14, stillN: 11, minM: 38 } } })
  ok('at the pump: parked 38 m from the station at the time → pass', parked.outcome === 'pass' && /RAM 3500 was at Spinx/.test(parked.evidence), parked)
  const far = check('asset_absent', { presence: { before: { ...off(YARD_C, 0, 0), ms: T - 3 * MIN, speed: 0 } } })
  ok('14 miles away at the yard → exception', far.outcome === 'exception' && far.dollarsAtRisk === 84.09, far)
  ok('14 miles away: the sentence says how far, when, where', /RAM 3500 was 14 mi from Spinx \(Wade Hampton Blvd\) at 7:39 AM, at Greenville yard\./.test(far.evidence), far.evidence)
  ok('14 miles away: a timed purchase at a pinned station is high severity', far.severity === 'high' && far.facts.distanceM > 22_000)
  const other = check('asset_absent', { presence: { before: { ...YARD_C, ms: T - 3 * MIN, speed: 0 }, others: [{ assetId: 'a-f750', name: 'F750 Tool Truck', firstMs: T - 4 * MIN, minM: 22 }] } })
  ok('wrong vehicle on the card: names the one that WAS there', /F750 Tool Truck \(7:38 AM\) was there\./.test(other.evidence) && other.facts.others === 1, other.evidence)
  const drove = check('asset_absent', { presence: { near: { firstMs: T + 2 * MIN, lastMs: T + 2 * MIN, n: 1, stillN: 0, minM: 60 } } })
  ok('a quick top-off with no stationary fix but 60 m away → pass', drove.outcome === 'pass')
  const passing = check('asset_absent', { presence: { near: { firstMs: T + 2 * MIN, lastMs: T + 2 * MIN, n: 2, stillN: 0, minM: 210 }, before: { ...off(STATION, 0, 1_500), ms: T - 1 * MIN, speed: 44 } } })
  ok('driving past at 44 mph, 210 m off → exception, says it was driving', passing.outcome === 'exception' && /driving at 44 mph/.test(passing.evidence), passing.evidence)
  const nearMiss = check('asset_absent', { presence: { before: { ...off(STATION, 450, 0), ms: T - 2 * MIN, speed: 0 } } })
  ok('a near miss (450 m) is low severity — the geocode may be a lot off', nearMiss.outcome === 'exception' && nearMiss.severity === 'low', nearMiss)
  const asleep = check('asset_absent', { presence: { before: { ...YARD_C, ms: T - 100 * MIN, speed: 0 } } })
  ok('only a report 100 min before → low severity, says so', asleep.outcome === 'exception' && asleep.severity === 'low' && /nearest report/.test(asleep.evidence), asleep.evidence)
  const silent = check('asset_absent', { presence: { fixesInWindow: 0 } })
  ok('tracker silent → can\'t check, says so', silent.outcome === 'unknown' && silent.missing.includes('tracker_silent'), silent)
  const noCar = check('asset_absent', { asset: null, presence: { others: [{ assetId: 'a-f750', name: 'F750 Tool Truck', firstMs: T, minM: 30 }] } })
  ok('no vehicle on the card → can\'t check, names who was there', noCar.outcome === 'unknown' && noCar.missing.includes('no_vehicle') && /F750 Tool Truck/.test(noCar.evidence), noCar)
}

// Date-only purchases
{
  const dayFrom = at('2026-10-01T00:00:00-04:00')
  const dTxn = { txnAtMs: null }
  const stopAtPump = { lat: STATION.lat, lng: STATION.lng, fromMs: dayFrom + 9 * HOUR, toMs: dayFrom + 9 * HOUR + 9 * MIN, n: 5, engineOff: true }
  const yardStop = { ...YARD_C, fromMs: dayFrom + 6 * HOUR, toMs: dayFrom + 7 * HOUR, n: 30, engineOff: true }
  const okDay = check('asset_absent', { txn: dTxn, presence: { fromMs: dayFrom, toMs: dayFrom + 24 * HOUR, near: { firstMs: stopAtPump.fromMs, lastMs: stopAtPump.toMs, n: 5, stillN: 5, minM: 25 }, stops: [yardStop, stopAtPump] } })
  ok('date only: stopped at the station that day → pass', okDay.outcome === 'pass' && okDay.missing.includes('no_time'), okDay)
  const noDay = check('asset_absent', { txn: dTxn, presence: { fromMs: dayFrom, toMs: dayFrom + 24 * HOUR, stops: [yardStop] } })
  ok('date only: never stopped near it → exception, medium, names the closest stop', noDay.outcome === 'exception' && noDay.severity === 'medium'
    && /never stopped within 0\.2 mi of Spinx/.test(noDay.evidence) && /closest stop was 14 mi away \(Greenville yard, 6:00 AM\)/.test(noDay.evidence), noDay.evidence)
  const brand = check('asset_absent', { txn: { ...dTxn, precision: 'brand', placeLabel: 'Spinx in Greenville', points: [off(STATION, 0, 9_000), off(STATION, 4_000, -2_000)] },
    presence: { fromMs: dayFrom, toMs: dayFrom + 24 * HOUR, stops: [yardStop] } })
  ok('brand-level station: "any Spinx in Greenville"', brand.outcome === 'exception' && /of any Spinx in Greenville/.test(brand.evidence), brand.evidence)
  // Station not placed at all: the fuel-stop search
  const fuelStop = { ...off(STATION, 8_000, 0), fromMs: dayFrom + 10 * HOUR, toMs: dayFrom + 10 * HOUR + 7 * MIN, n: 4, engineOff: true, fuelStation: 'Circle K' }
  const unplaced = { points: [], precision: null, placeLabel: null }
  const found = check('asset_absent', { txn: { ...dTxn, ...unplaced }, presence: { stops: [yardStop, fuelStop] } })
  ok('station not placed: it stopped at a fuel station that day → pass, says which', found.outcome === 'pass' && /Circle K/.test(found.evidence) && found.missing.includes('merchant_unplaced'), found)
  const none = check('asset_absent', { txn: { ...dTxn, ...unplaced }, presence: { stops: [yardStop, { ...fuelStop, fuelStation: '' }] } })
  ok('station not placed: every stop looked up, none a station → exception', none.outcome === 'exception' && /None of RAM 3500's 2 stops/.test(none.evidence), none.evidence)
  const busy = check('asset_absent', { txn: { ...dTxn, ...unplaced }, presence: { stops: [yardStop, { ...fuelStop, fuelStation: undefined }] } })
  ok('station not placed: a stop not looked up → can\'t check', busy.outcome === 'unknown' && busy.missing.includes('stops_unchecked'), busy)
  ok('a red light is not a stop', !fc.isRealStop({ lat: 0, lng: 0, fromMs: 0, toMs: 40_000, n: 2, engineOff: false }) && fc.isRealStop({ lat: 0, lng: 0, fromMs: 0, toMs: 30_000, n: 2, engineOff: true }))
  const merged = fc.mergeStops([{ ...STATION, fromMs: 0, toMs: 60_000, n: 2, engineOff: false }, { ...off(STATION, 60, 0), fromMs: 90_000, toMs: 200_000, n: 3, engineOff: true }])
  ok('two clusters 60 m and 30 s apart are one stop', merged.length === 1 && merged[0].n === 5 && merged[0].engineOff && merged[0].toMs === 200_000)
}

// 2. The tank
{
  const fortyOn26 = check('gallons_exceed_tank', { txn: { gallons: 40, unitPrice: 3.5, amount: 140 }, asset: { ...RAM, tankGal: 26, reportsFuelLevel: false } })
  ok('40 gal on a 26-gal tank → exception', fortyOn26.outcome === 'exception' && near(fortyOn26.facts.excessGal, 14, 0.01), fortyOn26)
  ok('40 gal on a 26-gal tank: $ at risk = excess gallons × price', near(fortyOn26.dollarsAtRisk, 49, 0.01) && fortyOn26.severity === 'high', fortyOn26.dollarsAtRisk)
  ok('40 gal on a 26-gal tank: the sentence', /40\.0 gal bought on a 26\.0 gal tank — 14\.0 gal more than it holds, even empty\./.test(fortyOn26.evidence), fortyOn26.evidence)
  ok('no gauge on that truck is named', fortyOn26.missing.includes('no_fuel_level'))
  const fits = check('gallons_exceed_tank', { txn: { gallons: 24.31 }, asset: { ...RAM, reportsFuelLevel: false } })
  ok('24 gal into a 32-gal tank, no gauge → pass against the whole tank', fits.outcome === 'pass' && /whole 32\.0 gal tank/.test(fits.evidence), fits.evidence)
  const noTank = check('gallons_exceed_tank', { asset: { ...RAM, tankGal: null } })
  ok('missing tank size → can\'t check, says what to set', noTank.outcome === 'unknown' && noTank.missing.includes('no_tank_size') && /tank size isn't set/.test(noTank.evidence), noTank)
  const est = check('gallons_exceed_tank', { txn: { gallons: null, unitPrice: null, amount: 62.15, product: null }, asset: { ...RAM, tankGal: 26, fuelType: null, reportsFuelLevel: false } })
  ok('a bank row: gallons estimated from dollars at the default gas price', est.outcome === 'pass' && est.facts.estimated === true && near(est.facts.gallons, 20, 0.05) && est.missing.includes('gallons_estimated'), est)
  const def = check('gallons_exceed_tank', { txn: { product: 'def', gallons: 2.5 } })
  ok('DEF is never compared to the fuel tank', def.outcome === 'unknown' && def.missing.includes('def_product'))
  const r = fc.resolveGallons({ gallons: null, unitPrice: null, amount: 72, product: null }, { fuelType: 'diesel' }, SETTINGS)
  ok('estimate uses the vehicle\'s fuel type when the line is silent', r.estimated && near(r.gallons, 20, 0.01) && r.price === 3.6)
}

// The gauge around a fill: driving at 13% (slosh ±8), 11 min at the pump,
// driving away at 71% — the real F350 shape from Oct 1.
let seed = 7
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
function drive(fromMs, toMs, pct, stepMs = 5000, mph = 42) {
  const out = []
  for (let ms = fromMs; ms < toMs; ms += stepMs) out.push({ ms, pct: Math.max(1, Math.round(pct + (rnd() - 0.5) * 16)), mph })
  return out
}
{
  const g = [...drive(T - 40 * MIN, T - 6 * MIN, 13), ...drive(T + 6 * MIN, T + 50 * MIN, 71)]
  const fill = check('gallons_exceed_tank', { txn: { gallons: 19 }, asset: { ...RAM, tankGal: 34 }, gauge: g })
  ok('gauge: fill found, room read from just before it', fill.outcome === 'pass' && near(fill.facts.levelBeforePct, 13, 3) && fill.facts.gaugeAddedGal > 15, fill)
  ok('gauge: the sentence carries the rise', /The gauge rose 1\d% → 7\d%/.test(fill.evidence), fill.evidence)
  const over = check('gallons_exceed_tank', { txn: { gallons: 33, amount: 114.15 }, asset: { ...RAM, tankGal: 34 }, gauge: [...drive(T - 40 * MIN, T - 6 * MIN, 61), ...drive(T + 6 * MIN, T + 50 * MIN, 64)] })
  ok('gauge: 33 gal bought, the tank read 61% (room ≈ 13 gal) → exception', over.outcome === 'exception' && near(over.facts.roomGal, 13.3, 1.2) && /tank read 6\d%/.test(over.evidence), over)
  ok('gauge: dollars at risk are the gallons that could not fit', near(over.dollarsAtRisk, (33 - over.facts.roomGal) * (114.15 / 33), 0.25), over.dollarsAtRisk)
  const late = check('gallons_exceed_tank', { txn: { gallons: 20 }, asset: { ...RAM, tankGal: 34 }, gauge: drive(T - 5 * HOUR, T - 3 * HOUR, 70) })
  ok('gauge: a reading three hours old is not "the level before" → whole tank', late.outcome === 'pass' && late.facts.levelBeforePct === null && late.missing.includes('gauge_silent'), late)

  // 3. Running after
  const ranFill = check('no_runtime_after', { gauge: g, runtime: { fromMs: T, toMs: T + 24 * HOUR, firstRunMs: null, lastFixMs: T + 20 * HOUR } })
  ok('purchase followed by a fill on the gauge → pass', ranFill.outcome === 'pass' && /gauge shows a fill/.test(ranFill.evidence), ranFill)
  const ran = check('no_runtime_after', {})
  ok('purchase followed by the engine running → pass', ran.outcome === 'pass' && /ran again at 7:48 AM/.test(ran.evidence), ran.evidence)
  const nothing = check('no_runtime_after', { gauge: drive(T - 2 * HOUR, T - HOUR, 55), runtime: { fromMs: T, toMs: T + 24 * HOUR, firstRunMs: null, lastFixMs: T + 22 * HOUR } })
  ok('purchase followed by nothing, tracker alive → exception', nothing.outcome === 'exception' && /No fill on the gauge and no engine running in the 24 hours after the purchase/.test(nothing.evidence), nothing.evidence)
  ok('no running: the whole purchase is at risk, high with a gauge watching', nothing.dollarsAtRisk === 84.09 && nothing.severity === 'high')
  const quiet = check('no_runtime_after', { runtime: { fromMs: T, toMs: T + 24 * HOUR, firstRunMs: null, lastFixMs: T + 2 * HOUR } })
  ok('purchase followed by a silent tracker → can\'t check', quiet.outcome === 'unknown' && quiet.missing.includes('tracker_silent'))
  const soon = check('no_runtime_after', { nowMs: T + 3 * HOUR, runtime: { fromMs: T, toMs: T + 24 * HOUR, firstRunMs: null, lastFixMs: T + 2 * HOUR } })
  ok('purchase three hours ago with nothing yet → pending, not an exception', soon.outcome === 'pending')
  const machine = check('no_runtime_after', { asset: { ...RAM, name: 'Link-Belt 130X2', type: 'equipment', hasTracker: false }, runtime: null })
  ok('a can for a machine with no tracker → can\'t check', machine.outcome === 'unknown' && /can or bulk-tank purchase/.test(machine.evidence) && machine.missing.includes('no_tracker'))
  const battery = check('no_runtime_after', { asset: { ...RAM, reportsIgnition: false, reportsFuelLevel: false }, runtime: { fromMs: T, toMs: T + 24 * HOUR, firstRunMs: null, lastFixMs: T + 23 * HOUR } })
  ok('a battery unit: reads "no movement", medium', battery.outcome === 'exception' && /no movement/.test(battery.evidence) && battery.severity === 'medium' && battery.missing.includes('no_runtime_signal'), battery)
}

// 4. Shift, hours, area
{
  const sat = at('2026-10-03T10:15:00-04:00')
  const satRes = check('outside_shift_or_area', { txn: { txnDate: '2026-10-03', txnAtMs: sat } })
  ok('a Saturday purchase, Mon–Fri company → exception', satRes.outcome === 'exception' && /Saturday 10:15 AM — not a work day \(Mon–Fri\)/.test(satRes.evidence), satRes.evidence)
  const satOk = check('outside_shift_or_area', { txn: { txnDate: '2026-10-03', txnAtMs: sat }, hours: { ...HOURS, workDays: [1, 2, 3, 4, 5, 6] } })
  ok('a Saturday purchase, Mon–Sat company → pass', satOk.outcome === 'pass', satOk)
  const sun = check('outside_shift_or_area', { txn: { txnDate: '2026-10-04', txnAtMs: null } })
  ok('a Sunday, date only → exception, high', sun.outcome === 'exception' && sun.severity === 'high' && /Sunday — not a work day/.test(sun.evidence) && sun.missing.includes('no_time'), sun)
  const late = check('outside_shift_or_area', { txn: { txnAtMs: at('2026-10-01T21:30:00-04:00') } })
  ok('9:30 PM on a Thursday → outside work hours', late.outcome === 'exception' && /9:30 PM — outside work hours \(7:00 AM–5:00 PM\)/.test(late.evidence), late.evidence)
  const grace = check('outside_shift_or_area', { txn: { txnAtMs: at('2026-10-01T17:45:00-04:00') } })
  ok('5:45 PM — fuel on the way home is inside the grace hour → pass', grace.outcome === 'pass', grace)
  const clock = { usesClock: true, entries: [{ inMs: at('2026-10-01T06:55:00-04:00'), outMs: at('2026-10-01T15:10:00-04:00') }] }
  const onClock = check('outside_shift_or_area', { txn: { cardholderUserId: 'u1' }, shift: clock })
  ok('cardholder on the clock → pass', onClock.outcome === 'pass' && /on the clock/i.test(onClock.evidence), onClock)
  const offClock = check('outside_shift_or_area', { txn: { cardholderUserId: 'u1', txnAtMs: at('2026-10-01T16:20:00-04:00') }, shift: clock })
  ok('cardholder clocked out at 3:10, bought fuel at 4:20 → exception', offClock.outcome === 'exception' && /wasn't clocked in \(clocked out at 3:10 PM\)/.test(offClock.evidence), offClock.evidence)
  const noClock = check('outside_shift_or_area', { txn: { cardholderUserId: 'u1' }, shift: { usesClock: false, entries: [] } })
  ok('a cardholder who never clocks in is never accused of being off the clock', noClock.outcome === 'pass' && noClock.missing.includes('no_clock'), noClock)
  const farStation = off(STATION, -50_000, 0) // 31 miles west of everything
  const away = check('outside_shift_or_area', { txn: { points: [farStation], placeLabel: 'Spinx (Anderson)' } })
  ok('a station 31 mi from every site and yard → exception', away.outcome === 'exception' && /Spinx \(Anderson\) is \d\d mi from the nearest site/.test(away.evidence), away.evidence)
  const onRoute = check('outside_shift_or_area', { txn: { points: [farStation], placeLabel: 'Spinx (Anderson)' }, area: { zones: ZONES, places: [], dayPath: [off(farStation, 300, 0)] } })
  ok('the same station on the vehicle\'s route that day → pass', onRoute.outcome === 'pass', onRoute)
  const city = check('outside_shift_or_area', { txn: { points: [off(STATION, -12_000, 0)], precision: 'city', placeLabel: 'Easley', cityRadiusM: 6000 } })
  ok('a city-only station is measured generously (the city\'s radius off)', city.outcome === 'pass' && city.missing.includes('merchant_city_only'), city)
  const county = { id: 'z-county', name: 'Whole county', kind: 'boundary', ring: box(STATION, 80_000) }
  const ringed = check('outside_shift_or_area', { txn: { points: [farStation], placeLabel: 'Spinx (Anderson)' }, area: { zones: [...ZONES, county], places: [], dayPath: [] } })
  ok('a property boundary drawn round the county approves nothing', ringed.outcome === 'exception', ringed)
  const dateOnly = check('outside_shift_or_area', { txn: { txnAtMs: null, cardholderUserId: null } })
  ok('a date-only line says "no time" once — not "no cardholder" and "no clock" too', dateOnly.missing.includes('no_time') && !dateOnly.missing.includes('no_cardholder') && !dateOnly.missing.includes('no_clock'), dateOnly.missing)
  const timedNoHolder = check('outside_shift_or_area', { txn: { cardholderUserId: null } })
  ok('a timed purchase on a card tied to nobody says so', timedNoHolder.missing.includes('no_cardholder'))
}

// ── The public demo: built by the real checks, nothing real in it ───────────
{
  const mockUrl = transpile('../lib/mock-data.ts')
  const fcUrl = transpile('../lib/fuel-check.ts', { './asset-stats': statsUrl, './dates': datesUrl, './bulk-import': bulkUrl })
  const demo = await import(transpile('../lib/fuel-check-demo.ts', { './fuel-check': fcUrl, './dates': datesUrl, './mock-data': mockUrl }))
  for (const today of ['2026-10-06', '2026-10-11', '2026-12-31']) {
    const v = demo.demoFuelPilot(today, TZ, at(`${today}T12:00:00-04:00`))
    const kinds = new Set(v.exceptions.map((e) => e.kind))
    ok(`demo (${today}): every kind of exception shows up`, fc.CHECK_KINDS.every((k) => kinds.has(k)), Array.from(kinds))
    ok(`demo (${today}): verdicts of every kind, and some waiting`, ['valid', 'false', 'unsure'].every((x) => v.exceptions.some((e) => e.verdict === x)) && v.metrics.unclassified > 0)
    const routineSunday = v.txns.filter((t) => new Date(t.txnDate + 'T12:00:00Z').getUTCDay() === 0)
    ok(`demo (${today}): one Sunday purchase — the one meant to be flagged`, routineSunday.length === 1, routineSunday.map((t) => t.txnDate))
    ok(`demo (${today}): no dates past today, no verdict from the future`, v.txns.every((t) => t.txnDate <= today) && v.exceptions.every((e) => (e.verdictAtMs ?? 0) <= at(`${today}T12:00:00-04:00`)))
    const strings = []
    const walk = (x) => { if (typeof x === 'string') strings.push(x); else if (x && typeof x === 'object') Object.values(x).forEach(walk) }
    walk(v)
    ok(`demo (${today}): no tracker ids or card numbers in any text, cards are four digits`, strings.every((s) => !/\d{9,}/.test(s))
      && v.cards.every((c) => /^\d{4}$/.test(c.last4)), strings.filter((s) => /\d{9,}/.test(s)).slice(0, 3))
  }
}

// ── Storage: a re-check never touches a verdict ─────────────────────────────
{
  const SAT = at('2026-10-03T10:15:00-04:00')
  const results = fc.runFuelChecks(input({ presence: { before: { ...YARD_C, ms: SAT - 3 * MIN, speed: 0 } }, txn: { txnDate: '2026-10-03', txnAtMs: SAT } }))
  const w = fc.exceptionWrites('t1', 'c1', results, '2026-10-06T12:00:00.000Z')
  ok('writes: one row per exception kind', w.upserts.map((u) => u.kind).sort().join() === 'asset_absent,outside_shift_or_area', w.upserts.map((u) => u.kind))
  ok('writes: no verdict column is ever written by a check', w.upserts.every((u) => !('verdict' in u) && !('verdict_by' in u) && !('verdict_at' in u) && !('verdict_note' in u) && !('first_seen_at' in u)))
  // The table: an earlier run's row Brian already called valid.
  const table = new Map([['t1:asset_absent', { kind: 'asset_absent', verdict: 'valid', verdict_note: 'Driver admitted it', evidence: { text: 'old' }, cleared_at: null }]])
  for (const u of w.upserts) table.set(`t1:${u.kind}`, { ...(table.get(`t1:${u.kind}`) ?? {}), ...u })
  const kept = table.get('t1:asset_absent')
  ok('re-check: evidence updated in place, the verdict and note kept', kept.verdict === 'valid' && kept.verdict_note === 'Driver admitted it' && kept.evidence.text !== 'old')
  // Later evidence clears it: cleared, never deleted, verdict stays.
  const later = fc.runFuelChecks(input({ presence: { near: { firstMs: T, lastMs: T + 5 * MIN, n: 9, stillN: 9, minM: 30 } } }))
  const w2 = fc.exceptionWrites('t1', 'c1', later, '2026-10-07T12:00:00.000Z')
  ok('re-check: a kind that now passes is cleared, not deleted', w2.clear.includes('asset_absent') && !w2.upserts.some((u) => u.kind === 'asset_absent'))
  const stillUnknown = fc.exceptionWrites('t1', 'c1', [{ kind: 'no_runtime_after', outcome: 'unknown', severity: null, evidence: '', facts: {}, dollarsAtRisk: 0, missing: [] }], 'x')
  ok('re-check: "can\'t check now" neither clears nor rewrites an old exception', !stillUnknown.clear.length && !stillUnknown.upserts.length)
  const stored = fc.storedChecks(results, '2026-10-06T12:00:00.000Z')
  const back = fc.readStoredChecks(JSON.parse(JSON.stringify(stored)))
  ok('stored checks round-trip', back.r.length === 4 && back.r[0].k === 'asset_absent' && back.r[0].o === 'exception' && back.v === fc.CHECK_VERSION)
  ok('stored checks: a tampered blob reads safely', fc.readStoredChecks({ r: [{ k: 'drop table', o: 'x' }, { k: 'gallons_exceed_tank', o: 'nope', m: ['no_tank_size', 'evil'] }] }).r.length === 1
    && fc.readStoredChecks({ r: [{ k: 'gallons_exceed_tank', o: 'nope', m: ['no_tank_size', 'evil'] }] }).r[0].m.join() === 'no_tank_size' && fc.readStoredChecks('x') === null)
}

// ── The pilot's numbers ─────────────────────────────────────────────────────
{
  const chk = (missing) => ({ v: 1, at: 'x', r: [{ k: 'asset_absent', o: 'unknown', s: null, e: '', d: 0, m: missing }] })
  const txns = [
    { id: 'a', amount: 84, txnDate: '2026-09-02', hasTime: false, assetId: 'f650', cardLast4: '0417', checks: chk(['no_tank_size', 'no_time', 'no_fuel_level']) },
    { id: 'b', amount: 60, txnDate: '2026-09-03', hasTime: false, assetId: 'f750', cardLast4: '0417', checks: chk(['no_tank_size', 'no_time', 'no_fuel_level']) },
    { id: 'c', amount: 120, txnDate: '2026-09-04', hasTime: false, assetId: 'ram', cardLast4: '0525', checks: chk(['no_tank_size', 'no_time']) },
    { id: 'd', amount: 40, txnDate: '2026-09-05', hasTime: false, assetId: null, cardLast4: '9954', checks: chk(['no_vehicle', 'no_time']) },
    { id: 'e', amount: 50, txnDate: '2026-09-06', hasTime: true, assetId: 'ram', cardLast4: '0525', checks: chk([]) },
    { id: 'x', amount: 7, txnDate: '2026-09-06', hasTime: false, assetId: null, cardLast4: null, checks: chk(['no_vehicle']), excluded: true },
  ]
  const ex = [
    { transactionId: 'a', kind: 'asset_absent', dollarsAtRisk: 84, verdict: 'valid', clearedAt: null },
    { transactionId: 'a', kind: 'outside_shift_or_area', dollarsAtRisk: 84, verdict: 'valid', clearedAt: null },
    { transactionId: 'b', kind: 'gallons_exceed_tank', dollarsAtRisk: 21.5, verdict: 'valid', clearedAt: null },
    { transactionId: 'c', kind: 'asset_absent', dollarsAtRisk: 120, verdict: 'false', clearedAt: null },
    { transactionId: 'c', kind: 'no_runtime_after', dollarsAtRisk: 120, verdict: 'unsure', clearedAt: null },
    { transactionId: 'd', kind: 'outside_shift_or_area', dollarsAtRisk: 40, verdict: null, clearedAt: null },
    { transactionId: 'e', kind: 'asset_absent', dollarsAtRisk: 50, verdict: null, clearedAt: '2026-09-07T00:00:00Z' },
    { transactionId: 'e', kind: 'no_runtime_after', dollarsAtRisk: 50, verdict: 'false', clearedAt: '2026-09-07T00:00:00Z' },
    { transactionId: 'x', kind: 'asset_absent', dollarsAtRisk: 7, verdict: 'valid', clearedAt: null },
  ]
  const m = fc.pilotMetrics(txns, ex, { startedOn: '2026-09-01', todayKey: '2026-09-12' })
  ok('metrics: the excluded purchase is out of every number', m.transactions === 5 && m.excluded === 1 && m.dollars === 354)
  ok('metrics: cleared without a verdict drops off; cleared with one stays', m.exceptions === 7 && m.open === 6, { exceptions: m.exceptions, open: m.open })
  ok('metrics: false-positive rate = false ÷ (valid + false)', m.valid === 3 && m.falseAlarms === 2 && near(m.falsePositiveRate, 2 / 5, 1e-9), m)
  ok('metrics: unsure is asked again — not counted as classified', m.unsure === 1 && m.classified === 5 && m.unclassified === 2 && near(m.classifiedPct, 5 / 7, 1e-9))
  ok('metrics: recoverable = the largest valid $ per purchase, never double', m.recoverable === 84 + 21.5, m.recoverable)
  ok('metrics: awaiting a verdict', m.awaiting === 120 + 40, m.awaiting)
  ok('metrics: day 12 of the 30-day classification window and the 90-day pilot', m.daysIn === 12 && m.classifyDaysLeft === 18 && m.pilotDaysLeft === 78)
  ok('metrics: per-kind false-positive rate', near(m.byKind.asset_absent.fpRate, 1 / 2, 1e-9) && m.byKind.gallons_exceed_tank.fpRate === 0 && m.byKind.no_runtime_after.fpRate === 1)
  ok('metrics: an empty pilot divides by nothing', fc.pilotMetrics([], [], { startedOn: null, todayKey: '2026-09-12' }).falsePositiveRate === null)

  const miss = fc.missingTelemetry(txns, [{ id: 'f650', name: 'F650 Dump Truck' }, { id: 'f750', name: 'F750 Tool Truck' }, { id: 'ram', name: 'RAM 3500' }])
  const byCode = Object.fromEntries(miss.map((i) => [i.code, i]))
  ok('missing: "3 vehicles have no tank size", named', /^3 vehicles have no tank size: F650 Dump Truck, F750 Tool Truck and RAM 3500\.$/.test(byCode.no_tank_size?.text), byCode.no_tank_size)
  ok('missing: the trucks that send no fuel level', /F650 Dump Truck and F750 Tool Truck send no fuel level/.test(byCode.no_fuel_level?.text), byCode.no_fuel_level)
  ok('missing: "80% of purchases have no time of day" + the fix', byCode.no_time?.text === '80% of purchases have no time of day.' && /fleet-card export/.test(byCode.no_time.fix), byCode.no_time)
  ok('missing: the card with no vehicle', /Card …9954 has no vehicle \(1 purchase\)/.test(byCode.no_vehicle?.text), byCode.no_vehicle)
  ok('missing: ranked by the dollars they left unchecked', miss[0].code === 'no_time' && miss[0].dollars === 304, miss.map((i) => [i.code, i.dollars]))
}

// ── Export ──────────────────────────────────────────────────────────────────
{
  const csv = fc.exceptionsCsv([{
    txnDate: '2026-10-01', txnAtMs: T, merchant: '=HYPERLINK("x")', amount: 84.09, gallons: 24.31, gallonsEstimated: false, vehicle: 'RAM 3500', cardLast4: '0417',
    kind: 'asset_absent', severity: 'high', evidence: 'RAM 3500 was 14 mi away.', dollarsAtRisk: 84.09, missing: ['no_time'], cleared: false,
    verdict: 'valid', verdictNote: 'confirmed', verdictBy: 'Owner', verdictAtMs: at('2026-10-02T09:00:00-04:00'),
  }], TZ)
  const lines = csv.trim().split('\n')
  ok('export: a header and one row', lines.length === 2 && lines[0].startsWith('Date,Time,Merchant,Amount'))
  ok('export: a formula in a merchant name is defused', lines[1].includes(`"'=HYPERLINK(""x"")"`), lines[1])
  ok('export: verdict, plain kind label, card', lines[1].includes('Vehicle not at the pump') && lines[1].includes('Valid') && lines[1].includes('…0417') && lines[1].includes('7:42 AM'))
}

// Settings are clamped
ok('settings: junk falls back, extremes clamp', (() => {
  const s = fc.cleanSettings({ gasPrice: 'abc', dieselPrice: 99, areaMiles: 0.1, runtimeHours: 1000 })
  return s.gasPrice === fc.DEFAULT_SETTINGS.gasPrice && s.dieselPrice === 15 && s.areaMiles === 0.5 && s.runtimeHours === 96
})())
// Review finding (Oct 6): a cleared box sent Number('') = 0, which clamped UP
// to the floor — $0.50/gal, 0.5 mi, 4 h — and turned a $60 fill into 120 gal.
ok('settings: zero or less is a cleared box, never the floor', (() => {
  const s = fc.cleanSettings({ gasPrice: 0, dieselPrice: -3, areaMiles: '0', runtimeHours: '' })
  return s.gasPrice === fc.DEFAULT_SETTINGS.gasPrice && s.dieselPrice === fc.DEFAULT_SETTINGS.dieselPrice && s.areaMiles === fc.DEFAULT_SETTINGS.areaMiles && s.runtimeHours === fc.DEFAULT_SETTINGS.runtimeHours
})())
{
  const saved = { gasPrice: 3.459, dieselPrice: 3.899, areaMiles: 12, runtimeHours: 36 }
  const kept = fc.mergeSettings(saved, { gasPrice: '', dieselPrice: 0, areaMiles: -1, runtimeHours: 'abc' })
  ok('settings save: a blank, zero, negative or unreadable box keeps its saved value', JSON.stringify(kept) === JSON.stringify(saved), kept)
  const sparse = fc.mergeSettings(saved, { areaMiles: 7 })
  ok('settings save: only the boxes sent change', sparse.areaMiles === 7 && sparse.gasPrice === 3.459 && sparse.dieselPrice === 3.899 && sparse.runtimeHours === 36, sparse)
  const typed = fc.mergeSettings(saved, { gasPrice: '3.199', runtimeHours: 500 })
  ok('settings save: typed numbers are read and clamped like any setting', typed.gasPrice === 3.199 && typed.runtimeHours === 96, typed)
  ok('settings save: nothing sent changes nothing', JSON.stringify(fc.mergeSettings(saved, null)) === JSON.stringify(saved))
  ok('pump price: $1–$10 is a pump price; the $0.50 floor and $15 are not', fc.pumpPriceOk(3.1) && fc.pumpPriceOk(1) && fc.pumpPriceOk(10)
    && !fc.pumpPriceOk(0.5) && !fc.pumpPriceOk(15) && !fc.pumpPriceOk(NaN))
}
// An estimate is never concluded from — or stored off — a price that isn't a pump price.
{
  const floor = { ...SETTINGS, gasPrice: 0.5, dieselPrice: 0.5 }
  const sixty = { txn: { gallons: null, unitPrice: null, amount: 60, product: null }, asset: { ...RAM, tankGal: 26, fuelType: null, reportsFuelLevel: false }, settings: floor }
  const t = check('gallons_exceed_tank', sixty)
  ok('a $0.50 default price: a $60 fill is not "120 gal" — can\'t check, says why', t.outcome === 'unknown' && t.facts.priceOk === false && t.facts.gallons === undefined
    && /isn't a pump price/.test(t.evidence) && t.missing.includes('gallons_estimated') && t.dollarsAtRisk === 0, t)
  ok('a $0.50 default price raises no tank exception', fc.runFuelChecks(input(sixty)).every((r) => r.kind !== 'gallons_exceed_tank' || r.outcome !== 'exception'))
  ok('resolveGallons: an estimate at the floor is marked untrusted; exported gallons always trusted',
    fc.resolveGallons({ gallons: null, unitPrice: null, amount: 60, product: 'gas' }, null, floor).priceOk === false
    && fc.resolveGallons({ gallons: 20, unitPrice: null, amount: 60, product: 'gas' }, null, floor).priceOk === true)
  const good = check('gallons_exceed_tank', { ...sixty, settings: SETTINGS })
  const wbGood = fc.gallonsWriteBack({ gallons: null, gallonsEstimated: false }, good)
  ok('write-back: an estimate at a pump price is stored as an estimate', good.outcome === 'pass' && wbGood?.gallons_estimated === true && near(wbGood.gallons, 19.4, 0.05), wbGood)
  ok('write-back: an estimate at the floor price is never stored', fc.gallonsWriteBack({ gallons: null, gallonsEstimated: false }, t) === null)
  ok('write-back: …and one an earlier run stored is taken back', JSON.stringify(fc.gallonsWriteBack({ gallons: 120, gallonsEstimated: true }, t)) === JSON.stringify({ gallons: null, gallons_estimated: false }))
  ok('write-back: the export\'s own gallons are never touched', fc.gallonsWriteBack({ gallons: 24.3, gallonsEstimated: false }, t) === null && fc.gallonsWriteBack({ gallons: 24.3, gallonsEstimated: false }, good) === null)
  const bulk = check('gallons_exceed_tank', { ...sixty, txn: { ...sixty.txn, amount: 9_000, product: 'diesel' }, settings: SETTINGS })
  ok('write-back: a "fill" past the column\'s 2,000 gal (a bulk delivery) is flagged but never stored', bulk.outcome === 'exception'
    && fc.gallonsWriteBack({ gallons: null, gallonsEstimated: false }, bulk) === null, { o: bulk.outcome, g: bulk.facts.gallons })
  const noTank = check('gallons_exceed_tank', { ...sixty, asset: { ...RAM, tankGal: null }, settings: SETTINGS })
  ok('write-back: a check with no tank to compare to leaves the row alone', fc.gallonsWriteBack({ gallons: 19.4, gallonsEstimated: true }, noTank) === null)
}
ok('windows: a timed purchase reads ±30 min at the pump and 24 h after', (() => {
  const w = fc.checkWindows({ txnDate: '2026-10-01', txnAtMs: T }, SETTINGS, TZ)
  return w.presenceFromMs === T - 30 * MIN && w.presenceToMs === T + 30 * MIN && w.runtimeToMs === T + 24 * HOUR
})())
ok('windows: a date-only purchase reads the local day', (() => {
  const w = fc.checkWindows({ txnDate: '2026-10-01', txnAtMs: null }, SETTINGS, TZ)
  return w.presenceFromMs === at('2026-10-01T00:00:00-04:00') && w.presenceToMs === at('2026-10-02T00:00:00-04:00')
})())

// ── The runner, the real production path, against a stand-in database ──────
// lib/db/fuel-check.ts runFuelCheck exactly as the import, the re-check and
// the nightly cron call it: rows in, Photon (stubbed fetch) for the station,
// the geocode cache, the evidence reads (rpc stand-ins), stored checks and
// exception rows out. Only the database and the network are fakes.
{
  const devicesUrl = transpile('../lib/devices.ts')
  const catalogUrl = transpile('../lib/telemetry-catalog.ts', { './power-loss': transpile('../lib/power-loss.ts') })
  const fcUrl = transpile('../lib/fuel-check.ts', { './asset-stats': statsUrl, './dates': datesUrl, './bulk-import': bulkUrl })
  const geocodeUrl = transpile('../lib/fuel-geocode.ts', { './place-label': transpile('../lib/place-label.ts'), './fuel-check': fcUrl })
  const run = await import(transpile('../lib/db/fuel-check.ts', {
    '@/lib/fuel-check': fcUrl, '@/lib/asset-stats': statsUrl, '@/lib/dates': datesUrl, '@/lib/devices': devicesUrl,
    '@/lib/telemetry-catalog': catalogUrl, '@/lib/fuel-geocode': geocodeUrl, '@/lib/permissions': transpile('../lib/permissions.ts'),
  }))

  // Just the PostgREST calls the runner makes, over plain arrays.
  const fakeDb = (tables, rpcs = {}) => ({
    tables,
    from(table) {
      const filters = []
      let op = 'select', payload = null, onConflict = null, limitN = Infinity
      const rows = () => (tables[table] ??= [])
      const exec = () => {
        const hit = (r) => filters.every((f) => f(r))
        if (op === 'select') return { data: rows().filter(hit).slice(0, limitN), error: null }
        if (op === 'update') { for (const r of rows()) if (hit(r)) Object.assign(r, payload); return { data: null, error: null } }
        if (op === 'insert') { for (const p of [].concat(payload)) rows().push({ ...p }); return { data: null, error: null } }
        const keys = onConflict.split(',')
        for (const p of [].concat(payload)) {
          const same = rows().find((r) => keys.every((k) => r[k] === p[k]))
          if (same) Object.assign(same, p); else rows().push({ id: crypto.randomUUID(), ...p })
        }
        return { data: null, error: null }
      }
      const cmp = (c, v, f) => { filters.push((r) => r[c] != null && f(String(r[c]), String(v))); return q }
      const q = {
        select() { return q }, order() { return q }, or() { return q },
        eq(c, v) { filters.push((r) => r[c] === v); return q },
        in(c, vs) { filters.push((r) => vs.includes(r[c])); return q },
        is(c, v) { filters.push((r) => (r[c] ?? null) === v); return q },
        gte: (c, v) => cmp(c, v, (a, b) => a >= b), lte: (c, v) => cmp(c, v, (a, b) => a <= b), lt: (c, v) => cmp(c, v, (a, b) => a < b),
        limit(n) { limitN = n; return q },
        update(p) { op = 'update'; payload = p; return q },
        upsert(p, o) { op = 'upsert'; payload = p; onConflict = o.onConflict; return q },
        insert(p) { op = 'insert'; payload = p; return q },
        maybeSingle() { const r = exec(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }) },
        then(res, rej) { return Promise.resolve(exec()).then(res, rej) },
      }
      return q
    },
    rpc(name, args) { return Promise.resolve({ data: rpcs[name] ? rpcs[name](args) : [], error: null }) },
  })
  const CO = '7e1d2c3b-0000-4000-8000-0000000000c0'
  const iso = (ms) => new Date(ms).toISOString()
  const companyRow = { id: CO, work_start: '07:00', work_end: '17:00', work_days: [1, 2, 3, 4, 5], digest_prefs: { tz: TZ } }
  const zoneRow = (z) => ({ id: z.id, company_id: CO, name: z.name, kind: z.kind, owner_id: null, geometry: { type: 'Polygon', coordinates: [z.ring] } })
  const txnRow = (o) => ({
    company_id: CO, source: 'csv', dedupe_key: 'k-' + o.id, alt_keys: [], expense_id: null, txn_at: null, txn_date: '2026-10-01', has_time: false,
    brand: null, store_no: null, address: null, city: null, state: 'SC', zip: null, city_candidates: [], lat: null, lng: null, merchant_points: null,
    geocode_source: null, geocode_precision: null, place_label: null, geocoded_at: null, gallons: null, gallons_estimated: false, unit_price: null,
    amount: 62.15, product: null, card_last4: null, cardholder_user_id: null, driver_text: null, vehicle_text: null, job_text: null, asset_id: null,
    asset_source: null, geofence_id: null, odometer: null, excluded: false, excluded_reason: null, checks: null, checked_at: null, created_at: iso(NOW),
    ...o,
  })
  const stored = (db, id, kind) => fc.readStoredChecks(db.tables.fuel_transactions.find((t) => t.id === id)?.checks)?.r.find((x) => x.k === kind)

  // Finding: the city's measured radius was dropped — every city-only station
  // was read with a flat 8 km, both ways wrong.
  const SITE = { lat: 34.85, lng: -82.30 }
  const siteZone = { id: 'z-job', name: 'Creekside', kind: 'site', ring: box(SITE, 250) }
  const nearTown = off(SITE, -12_000, 0)  // an address 12 km west of the job, no station matched there
  const bigCity = off(SITE, -18_000, 0)   // the middle of a city whose edge runs past the job
  const easley = off(SITE, -14_000, 0)    // a town Photon will size at ~4.2 km across the half-diagonal
  const addrRow = txnRow({ id: 'tx-addr', merchant: 'SPINX #0412 GREENVILLE SC', brand: 'Spinx', address: '900 Main St', city: 'Greenville',
    lat: nearTown.lat, lng: nearTown.lng, merchant_points: [nearTown], geocode_source: 'address', geocode_precision: 'city', place_label: 'Main St, Greenville', geocoded_at: iso(NOW - HOUR) })
  const cityRow = txnRow({ id: 'tx-city', merchant: 'QT 1042 COLUMBIA SC', brand: 'QuikTrip', city_candidates: ['Columbia'],
    lat: bigCity.lat, lng: bigCity.lng, merchant_points: [bigCity], geocode_source: 'city', geocode_precision: 'city', place_label: 'Columbia', geocoded_at: iso(NOW - HOUR) })
  const freshRow = txnRow({ id: 'tx-fresh', merchant: 'SPINX #0156 EASLEY SC', brand: 'Spinx', city_candidates: ['Easley'] })
  const cache = [
    { company_id: CO, key: run.rowMerchantKey(addrRow), precision: 'city', lat: nearTown.lat, lng: nearTown.lng, points: [nearTown], label: 'Main St, Greenville', radius_m: 1500, source: 'address' },
    { company_id: CO, key: run.rowMerchantKey(cityRow), precision: 'city', lat: bigCity.lat, lng: bigCity.lng, points: [bigCity], label: 'Columbia', radius_m: 20_000, source: 'city' },
  ]
  const db = fakeDb({
    companies: [companyRow], fuel_pilot: [], fuel_transactions: [addrRow, cityRow, freshRow], fuel_merchant_places: cache,
    assets: [], fuel_card_assets: [], company_cards: [], geofences_json: [zoneRow(siteZone)], places: [], fuel_exceptions: [],
  })
  const sw = off(easley, -3_000, -3_000), ne = off(easley, 3_000, 3_000)
  const realFetch = globalThis.fetch
  const asked = []
  globalThis.fetch = async (url) => {
    const u = new URL(String(url))
    asked.push(u.pathname + '?' + u.searchParams.get('q'))
    if (u.hostname !== 'photon.komoot.io') return new Response('unexpected', { status: 500 })
    if (u.searchParams.get('osm_tag') === 'place' && /easley/i.test(u.searchParams.get('q') ?? '')) {
      return Response.json({ features: [{ geometry: { coordinates: [easley.lng, easley.lat] }, properties: {
        osm_key: 'place', osm_value: 'town', name: 'Easley', state: 'South Carolina', countrycode: 'US', extent: [sw.lng, ne.lat, ne.lng, sw.lat] } }] })
    }
    return Response.json({ features: [] }) // no Spinx found round the town
  }
  let r
  try {
    r = await run.runFuelCheck(db, CO, { ids: ['tx-addr', 'tx-city', 'tx-fresh'], budgetMs: 20_000, geocodeCalls: 8, nowMs: NOW })
  } finally {
    globalThis.fetch = realFetch
  }
  ok('runner: all three purchases checked, the new one placed by Photon', r.checked === 3 && r.placed === 1 && asked.length === 2, { r, asked })
  const freshPlace = db.tables.fuel_merchant_places.find((p) => p.key === run.rowMerchantKey(freshRow))
  ok('runner: the town is sized from its own extent and cached with that radius', freshPlace?.precision === 'city' && near(freshPlace.radius_m, 4243, 30), freshPlace)
  const a = stored(db, 'tx-addr', 'outside_shift_or_area')
  ok('runner: an address 12 km from every site is measured with its own 1.5 km — flagged (the flat 8 km passed it)',
    a?.o === 'exception' && /is 6\.\d mi from the nearest site/.test(a.e) && a.m.includes('merchant_city_only'), a)
  const c = stored(db, 'tx-city', 'outside_shift_or_area')
  ok('runner: a big city reaching past the job is measured with its own 20 km — not flagged (the flat 8 km flagged a pump beside the job)', c?.o === 'pass', c)
  const f = stored(db, 'tx-fresh', 'outside_shift_or_area')
  ok('runner: a town placed in the same run is measured with the radius just measured — flagged at 5.9 mi (the flat 8 km passed it)',
    f?.o === 'exception' && /is 5\.9 mi from the nearest site/.test(f.e), f)
  ok('runner: toCheckTxn carries the radius only for a city-only station', run.toCheckTxn(addrRow, null, 1500).cityRadiusM === 1500
    && run.toCheckTxn({ ...addrRow, geocode_precision: 'exact' }, null, 1500).cityRadiusM === null && run.toCheckTxn(addrRow, null).cityRadiusM === null)
  ok('runner: a lost radius falls back to 8 km, the old reading', fc.CITY_RADIUS_FALLBACK_M === 8000)

  // Finding: the stored evidence named vehicles (and the cardholder's phone)
  // that some of its readers may not see (111).
  const RAM_ID = 'a1111111-0000-4000-8000-000000000001', F750_ID = 'a1111111-0000-4000-8000-000000000002'
  const OWNER_ID = 'a1111111-0000-4000-8000-000000000003', PHONE_ID = 'a1111111-0000-4000-8000-000000000004'
  const evidenceWith = async (hidden) => {
    const meta = hidden ? { visibility: 'master' } : {}
    const db2 = fakeDb({
      companies: [companyRow], fuel_pilot: [], fuel_merchant_places: [], fuel_exceptions: [], places: [], trail_daily: [], time_entries: [],
      geofences_json: ZONES.map(zoneRow),
      assets: [
        { id: RAM_ID, company_id: CO, name: 'RAM 3500', type: 'vehicle', tracker_id: '350000000000001', metadata: {}, active: true },
        { id: F750_ID, company_id: CO, name: 'F750 Tool Truck', type: 'vehicle', tracker_id: '350000000000002', metadata: {}, active: true },
        { id: OWNER_ID, company_id: CO, name: 'Owner Tahoe', type: 'vehicle', tracker_id: '350000000000003', metadata: meta, active: true },
        { id: PHONE_ID, company_id: CO, name: 'Owner phone', type: 'personnel', tracker_id: 'phone-u-owner', metadata: meta, active: true },
      ],
      fuel_card_assets: [{ company_id: CO, last4: '0417', asset_id: RAM_ID, valid_from: '2026-09-01' }],
      company_cards: [{ company_id: CO, last4: '0417', user_id: 'u-owner' }],
      asset_telemetry_latest: [{ asset_id: RAM_ID, ign: true }],
      asset_locations: [{ id: 'l1', asset_id: RAM_ID, lat: YARD_C.lat, lng: YARD_C.lng, speed: 0, timestamp: iso(T - 3 * MIN) }],
      fuel_transactions: [txnRow({ id: 'tx-pump', merchant: 'SPINX #0156', brand: 'Spinx', has_time: true, txn_at: iso(T), card_last4: '0417', amount: 84.09,
        lat: STATION.lat, lng: STATION.lng, merchant_points: [STATION], geocode_source: 'export', geocode_precision: 'exact', place_label: 'Spinx (Wade Hampton Blvd)', geocoded_at: iso(NOW) })],
    }, {
      fuel_near: (args) => (args.p_asset ? [] : [
        { asset_id: OWNER_ID, first_at: iso(T - 6 * MIN), last_at: iso(T), n: 4, still_n: 3, min_m: 18 },
        { asset_id: F750_ID, first_at: iso(T - 4 * MIN), last_at: iso(T + 2 * MIN), n: 5, still_n: 4, min_m: 22 },
        { asset_id: PHONE_ID, first_at: iso(T - 5 * MIN), last_at: iso(T), n: 3, still_n: 3, min_m: 9 },
      ]),
    })
    await run.runFuelCheck(db2, CO, { ids: ['tx-pump'], budgetMs: 20_000, geocodeCalls: 4, nowMs: NOW })
    return { check: stored(db2, 'tx-pump', 'asset_absent'), row: db2.tables.fuel_exceptions.find((e) => e.kind === 'asset_absent') }
  }
  const open = await evidenceWith(false)
  ok('evidence (everyone sees all): names who was at the pump and the cardholder\'s phone',
    open.check?.o === 'exception' && /Owner Tahoe \(7:36 AM\) and F750 Tool Truck \(7:38 AM\) were there\./.test(open.check.e) && /cardholder's phone was there at 7:37 AM/.test(open.check.e), open.check?.e)
  const shut = await evidenceWith(true)
  ok('evidence: an owner-only truck at the pump is left out of the stored sentence',
    shut.check?.o === 'exception' && /F750 Tool Truck \(7:38 AM\) was there\./.test(shut.check.e) && !/Owner Tahoe/.test(shut.check.e) && shut.check.f?.others === 1, shut.check?.e)
  ok('evidence: an owner-only phone is not mentioned at all', !/phone/.test(shut.check?.e ?? 'phone'), shut.check?.e)
  ok('evidence: the exception row carries the same filtered sentence', shut.row && !/Owner Tahoe|phone/.test(shut.row.evidence.text) && /F750 Tool Truck/.test(shut.row.evidence.text), shut.row?.evidence)

  // Finding: the write-back stored "120 gal" estimated at the $0.50 floor.
  const db3 = fakeDb({
    companies: [companyRow], fuel_pilot: [{ company_id: CO, gas_price: 0.5, diesel_price: 0.5, area_miles: 5, runtime_hours: 24 }],
    fuel_merchant_places: [], fuel_exceptions: [], places: [], trail_daily: [], time_entries: [], geofences_json: ZONES.map(zoneRow),
    assets: [{ id: RAM_ID, company_id: CO, name: 'RAM 3500', type: 'vehicle', tracker_id: null, metadata: { fuel_tank_gal: 26 }, active: true }],
    fuel_card_assets: [{ company_id: CO, last4: '0417', asset_id: RAM_ID, valid_from: '2026-09-01' }], company_cards: [],
    fuel_transactions: [txnRow({ id: 'tx-est', merchant: 'SPINX #0156', brand: 'Spinx', card_last4: '0417', amount: 60, gallons: 120, gallons_estimated: true,
      lat: STATION.lat, lng: STATION.lng, merchant_points: [STATION], geocode_source: 'export', geocode_precision: 'exact', geocoded_at: iso(NOW) })],
  })
  await run.runFuelCheck(db3, CO, { ids: ['tx-est'], budgetMs: 20_000, geocodeCalls: 4, nowMs: NOW })
  const est = db3.tables.fuel_transactions[0]
  ok('runner: at a $0.50 default the stored "120 gal" estimate is taken back and nothing is flagged',
    est.gallons === null && est.gallons_estimated === false && stored(db3, 'tx-est', 'gallons_exceed_tank')?.o === 'unknown'
    && !db3.tables.fuel_exceptions.some((e) => e.kind === 'gallons_exceed_tank'), { gallons: est.gallons, est: est.gallons_estimated, chk: stored(db3, 'tx-est', 'gallons_exceed_tank') })
  db3.tables.fuel_pilot[0].gas_price = 3.1
  await run.runFuelCheck(db3, CO, { ids: ['tx-est'], budgetMs: 20_000, geocodeCalls: 4, nowMs: NOW })
  ok('runner: at a pump price the estimate is made and stored again', near(db3.tables.fuel_transactions[0].gallons, 19.4, 0.05) && db3.tables.fuel_transactions[0].gallons_estimated === true,
    db3.tables.fuel_transactions[0].gallons)
}

console.log(`fuel-check: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
