/**
 * Harness for lib/beta/* — the Beta section's pure engines: the record
 * validator, the lien clock, certified payroll, ownership cost, rentals,
 * haul reconciliation, weather-delay claims, DVIR, activation, status.
 *
 *   node scripts/beta-test.mjs
 *
 * Run it after ANY change to lib/beta. Payroll and the lien clock are money
 * and deadlines: an off-by-one here is a missed lien or an under-paid crew.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const load = (rel, deps = {}) => {
  let s = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [k, v] of Object.entries(deps)) s = s.replaceAll(`from '${k}'`, `from '${v}'`)
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText).toString('base64')
}
const regUrl = load('../lib/beta/registers.ts')
const R = await import(regUrl)
const L = await import(load('../lib/beta/lien.ts', { './registers': regUrl }))
const P = await import(load('../lib/beta/payroll.ts'))
const O = await import(load('../lib/beta/owning.ts'))
const RT = await import(load('../lib/beta/rentals.ts'))
const H = await import(load('../lib/beta/haul.ts', { './registers': regUrl }))
const W = await import(load('../lib/beta/weather.ts'))
const D = await import(load('../lib/beta/dvir.ts'))
const A = await import(load('../lib/beta/activation.ts'))
const S = await import(load('../lib/beta/status.ts'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

// ── registers ──
{
  const c = R.cleanRecord('locate', { ticket: ' 2611190042 ', called: '2026-11-03', validThrough: '2026-11-24', junk: 'x' }, { site: 'Creekside' }, false)
  ok(c.ok, 'a locate ticket cleans')
  eq(c.ok && c.value.title, '#2611190042 · Creekside', 'locate title')
  eq(c.ok && c.value.dueOn, '2026-11-24', 'locate due = valid through')
  ok(c.ok && !('junk' in c.value.data), 'unknown keys dropped')
  ok(!R.cleanRecord('locate', { ticket: '1', called: '2026-11-03', validThrough: '2026-11-01' }, {}, false).ok, 'valid-through before the call is refused')
  ok(!R.cleanRecord('locate', { called: '2026-11-03', validThrough: '2026-11-24' }, {}, false).ok, 'ticket number is required')
  const rent = R.cleanRecord('rental', { what: 'CAT 320', vendor: 'Sunbelt', onRent: '2026-11-01', dayRate: '$1,250.50' }, {}, true)
  eq(rent.ok && rent.value.data.dayRate, 1250.5, 'money parses $1,250.50')
  const noMoney = R.cleanRecord('rental', { what: 'CAT 320', vendor: 'Sunbelt', onRent: '2026-11-01', dayRate: 900 }, {}, false)
  ok(noMoney.ok && noMoney.value.data.dayRate === undefined, 'a login without costs never writes a rate')
  ok(!R.cleanRecord('owning', { price: 1000, salvage: 2000, lifeYears: 5 }, {}, true).ok, 'salvage over price refused')
  ok(!R.cleanRecord('worker_class', { classification: 'Laborer', base: 20, idLast4: '123456789' }, {}, true).ok, 'a whole SSN is refused')
  ok(R.cleanRecord('worker_class', { classification: 'Laborer', base: 20, idLast4: '6789' }, {}, true).ok, 'last four is fine')
  ok(!R.cleanRecord('haul_ticket', { ticket: '1', day: '2026-11-03', source: 'Pit 4', direction: 'in', material: 'abc' }, {}, false).ok, 'a ticket needs tons or CY')
  ok(!R.cleanRecord('credential', { type: 'nope' }, { person: 'X' }, false).ok, 'credential type must be on the list')
  { const c = R.cleanRecord('credential', { type: R.CREDENTIAL_KINDS[0].value, number: 'SC-0123 4567-89' }, { person: 'X' }, false)
    eq(c.ok && c.value.data.number, '456789', 'a card number keeps only its last six letters/digits') }
  { const c = R.cleanRecord('credential', { type: R.CREDENTIAL_KINDS[0].value, number: '--' }, { person: 'X' }, false)
    ok(c.ok && !('number' in c.value.data), 'a card number with no letters or digits is dropped') }
  eq(R.addWorkdays('2026-11-20', 3), '2026-11-25', 'Fri + 3 working days = Wed')
  eq(R.dueState('2026-11-18', '2026-11-19'), 'overdue', 'due yesterday = overdue')
  eq(R.dueState('2026-12-10', '2026-11-19'), 'soon', 'due in 21 days = soon')
  eq(R.withoutMoney('rental', { what: 'x', dayRate: 5 }), { what: 'x' }, 'withoutMoney strips rates')
}

// ── lien clock ──
{
  const today = '2026-11-19'
  const done = L.lienClock({ role: 'sub', lastFurnished: '2026-10-01' }, { first: '2026-06-01', last: '2026-10-01' }, today, false)
  const lien = done.deadlines.find((d) => d.key === 'lien')
  eq(lien.due, '2026-12-30', 'lien due = last furnished + 90')
  eq(lien.state, 'ok', '41 days out = ok')
  const nof = done.deadlines.find((d) => d.key === 'nof')
  eq(nof.due, '2026-08-30', 'NOF due = first + 90')
  eq(nof.state, 'overdue', 'NOF past')
  const moving = L.lienClock({ role: 'sub' }, { first: '2026-11-01', last: '2026-11-18' }, today, true)
  eq(moving.last, today, 'still working: last furnished is today')
  eq(moving.deadlines.find((d) => d.key === 'lien').state, 'moving', 'lien clock moves while on site')
  const prime = L.lienClock({ role: 'prime' }, { first: '2026-06-01', last: '2026-11-01' }, today, false)
  ok(!prime.deadlines.some((d) => d.key === 'nof'), 'a prime needs no notice of furnishing')
  const filed = L.lienClock({ role: 'sub', lastFurnished: '2026-09-01', lienFiled: '2026-10-15' }, { first: null, last: null }, today, false)
  eq(filed.deadlines.find((d) => d.key === 'lien').state, 'done', 'a filed lien is done')
  eq(filed.deadlines.find((d) => d.key === 'suit').due, '2027-04-15', 'suit = 6 months after filing')
  const pub = L.lienClock({ role: 'sub2', public: true }, { first: '2026-01-01', last: '2026-11-01' }, today, false)
  eq(pub.deadlines.map((d) => d.key), ['bond_notice', 'bond_suit'], 'public job: bond notice + bond suit, no lien')
  eq(pub.deadlines[1].due, '2027-11-01', 'bond suit = one year')
  const paid = L.lienClock({ role: 'sub', released: '2026-11-10' }, { first: '2026-06-01', last: '2026-10-01' }, today, false)
  ok(paid.deadlines.every((d) => d.state === 'done'), 'paid in full stops every clock')
  eq(L.worstState(done.deadlines), 'overdue', 'worst state')
  ok(L.reminderToday({ due: '2026-11-26', state: 'urgent' }, today), '7 days out is a reminder day')
  ok(!L.reminderToday({ due: '2026-11-27', state: 'urgent' }, today), '8 days out is not')
  const none = L.lienClock({ role: 'sub' }, { first: null, last: null }, today, false)
  ok(none.deadlines.every((d) => d.state === 'waiting'), 'no dates = waiting, never a fake deadline')
}

// ── certified payroll ──
{
  const ws = '2026-11-15' // Sunday
  eq(P.weekStart('2026-11-19'), ws, 'week starts Sunday')
  eq(P.weekEnding(ws), '2026-11-21', 'week ends Saturday')
  const dayOf = (iso) => iso.slice(0, 10)
  const e = (u, z, day, h) => ({ userId: u, zoneId: z, inAt: `${day}T07:00:00Z`, outAt: `${day}T${String(7 + h).padStart(2, '0')}:00:00Z`, paidHours: h })
  const entries = [
    // A: 10h × 4 days on the job (Mon–Thu) + 8h Friday at ANOTHER site → 48h, OT falls on Friday (other job)
    e('A', 'J', '2026-11-16', 10), e('A', 'J', '2026-11-17', 10), e('A', 'J', '2026-11-18', 10), e('A', 'J', '2026-11-19', 10), e('A', 'X', '2026-11-20', 8),
    // B: 9h × 5 on the job → 45h, last 5 OT on Friday
    ...['16', '17', '18', '19', '20'].map((d) => e('B', 'J', `2026-11-${d}`, 9)),
    // C: never on this job
    e('C', 'X', '2026-11-16', 8),
  ]
  const classes = [
    { userId: 'A', name: 'Op One', classification: 'Operator: Excavator', idLast4: '1111', base: 30, fringeCash: 2 },
    { userId: 'B', name: 'Lab Two', classification: 'Laborer: Common', base: 15, fringeCash: 0 },
  ]
  const rates = [{ classification: 'operator - excavator', base: 28, fringe: 4 }, { classification: 'Laborer: Common', base: 16, fringe: 1.5 }]
  const lines = P.buildPayroll({ zoneId: 'J', weekStart: ws, entries, classes, rates, names: new Map(), dayOf })
  eq(lines.map((l) => l.userId).sort(), ['A', 'B'], 'only people who worked the job')
  const a = lines.find((l) => l.userId === 'A'), b = lines.find((l) => l.userId === 'B')
  eq([a.st, a.ot], [40, 0], 'A: 40 straight on this job, OT happened elsewhere')
  eq(a.allHours, 48, 'A: all-work hours 48')
  eq(b.days[5], [4, 5], 'B: Friday 4 straight + 5 OT (hours 41–45)')
  eq([b.st, b.ot], [40, 5], 'B: 40 + 5')
  eq(b.rateOt, 22.5, 'OT = 1.5 × base, fringe not multiplied')
  near(b.grossProject, 40 * 15 + 5 * 22.5, 0.001, 'B gross')
  ok(a.problems.length === 0, `A matches "operator - excavator" and is paid enough: ${a.problems}`)
  ok(b.problems.some((p) => /under the decision/.test(p)), 'B: base under the decision flagged')
  ok(b.problems.some((p) => /short/.test(p)), 'B: base+fringe shortfall flagged')
  near(a.grossAll, 40 * 32 + 8 * (45 + 2), 0.001, 'A all-work gross counts OT')
  const csv = P.lcpCsv(lines, ws, { number: '26-014', name: 'Creekside' })
  ok(csv.split('\n').filter(Boolean).length === 1 + 4 + 5, 'LCP CSV: a row per worker-day')
  ok(!P.lcpCsv([{ ...a, name: '=HYPERLINK("x")' }], ws, { number: null, name: 'J' }).includes(',=HYPERLINK'), 'CSV formula injection defused')
  const t = P.payrollTotals(lines)
  eq([t.st, t.ot], [80, 5], 'totals')
  const nocls = P.buildPayroll({ zoneId: 'J', weekStart: ws, entries: [e('Z', 'J', '2026-11-16', 8)], classes: [], rates, names: new Map([['Z', 'New Hand']]), dayOf })
  ok(nocls[0].grossProject === null && nocls[0].problems.length === 1 && nocls[0].name === 'New Hand', 'no class = no invented pay, one problem')
  const open = P.buildPayroll({ zoneId: 'J', weekStart: ws, entries: [{ ...e('A', 'J', '2026-11-16', 8), outAt: null }], classes, rates, names: new Map(), dayOf })
  eq(open.length, 0, 'an open shift is not on a certified payroll')
}

// ── ownership cost ──
{
  const r = O.owningCost({ price: 300000, salvage: 60000, lifeYears: 8, interestPct: 6, insuranceYr: 4000, taxStorageYr: 1000, fuelGph: 5, fuelPrice: 3.5, repairPct: 70, wearHr: 4, rentRate: 9000, currentValue: 200000 }, 1000, { repairsLast12: 30000, currentRate: 80 })
  eq(r.hoursSource, 'measured', 'uses measured hours')
  near(r.owning.depreciation, 240000 / 8000, 0.01, 'depreciation')
  const avgInv = (300000 * 9 + 60000 * 7) / 16
  near(r.owning.interest, (avgInv * 0.06) / 1000, 0.01, 'interest on average investment')
  near(r.owning.insuranceTax, 5, 0.001, 'insurance + tax per hour')
  near(r.operating.fuel, 17.5, 0.001, 'fuel')
  near(r.operating.repairs, 210000 / 8000, 0.01, 'repairs')
  near(r.total, r.owning.total + r.operating.total, 0.02, 'total adds up')
  ok(r.breakEvenHours > 0 && /Owning|Renting/.test(r.rentWords), 'rent vs own says something')
  ok(/Keep running/.test(r.replaceWords), '15% of value in repairs = keep running')
  ok(/under its real cost/.test(r.rateWords) || /over its real cost/.test(r.rateWords), 'rate comparison')
  eq(O.owningCost({ price: 100000, lifeYears: 5 }, null).hoursSource, 'default', 'no measured hours → default')
  eq(O.owningCost({ price: 100000, lifeYears: 5, plannedHours: 900 }, 2000).hoursYear, 900, 'planned hours win')
  const cheap = O.owningCost({ price: 100000, lifeYears: 5, rentRate: 100, repairPct: 300 }, 1000)
  ok(/Renting is cheaper at any/.test(cheap.rentWords), 'rental under running cost')
}

// ── rentals ──
{
  const rates = { dayRate: 400, weekRate: 1200, monthRate: 3200 }
  eq(RT.rentalCharge(1, rates), 400, '1 day')
  eq(RT.rentalCharge(4, rates), 1200, '4 days caps at a week')
  eq(RT.rentalCharge(9, rates), 1200 + 800, 'week + 2 days')
  eq(RT.rentalCharge(28, rates), 3200, '28 days = 4-week rate')
  eq(RT.rentalCharge(30, rates), 3200 + 800, '30 days = month + 2 days')
  eq(RT.rentalCharge(26, rates), 3200, '26 days caps at the month')
  eq(RT.rentalCharge(10, { weekRate: 1000 }), 2000, 'week-only rate rounds up')
  eq(RT.rentalCharge(5, {}), null, 'no rate = null')
  const v = RT.rentalView({ onRent: '2026-11-01', ...rates, delivery: 250 }, '2026-11-19', '2026-11-10')
  ok(v.flags.some((f) => f.kind === 'idle') && v.idleDays === 9, `idle 9 days flagged (${v.idleDays})`)
  eq(v.days, 19, '19 days on rent')
  eq(v.charged, RT.rentalCharge(19, rates) + 250, 'charge includes delivery')
  const off = RT.rentalView({ onRent: '2026-11-01', offRentCalled: '2026-11-05', ...rates }, '2026-11-19', '2026-11-02')
  ok(!off.live && !off.flags.length, 'called off: no flags, billing stopped')
  const late = RT.rentalView({ onRent: '2026-11-01', expectedOff: '2026-11-15', ...rates }, '2026-11-19', null)
  ok(late.flags.some((f) => f.kind === 'past_due') && late.idleDays === null, 'past due flagged; no tracker = no idle guess')
}

// ── haul ──
{
  eq(H.ticketQty({ material: 'abc', tons: 21 }), { tons: 21, cy: 15, derived: 'cy' }, 'tons → CY by material')
  eq(H.ticketQty({ material: 'fill', cy: 10 }), { tons: 12, cy: 10, derived: 'tons' }, 'CY → tons')
  const tickets = [
    { id: '1', day: '2026-11-18', assetId: 'T1', direction: 'in', material: 'abc', tons: 20, price: 18 },
    { id: '2', day: '2026-11-18', assetId: 'T1', direction: 'in', material: 'abc', tons: 21, price: 18 },
    { id: '3', day: '2026-11-18', assetId: 'T2', direction: 'in', material: 'abc', tons: 20 },
    { id: '4', day: '2026-11-18', assetId: null, truckText: 'Hauler 7', direction: 'out', material: 'fill', cy: 14 },
  ]
  const trips = [{ assetId: 'T1', day: '2026-11-18', arrivals: 3 }, { assetId: 'T2', day: '2026-11-18', arrivals: 1 }, { assetId: 'T9', day: '2026-11-18', arrivals: 5 }]
  const rec = H.reconcile(tickets, trips, new Map([['T1', 'Truck 1'], ['T2', 'Truck 2']]))
  eq(rec.find((r) => r.assetId === 'T1').state, 'missing_ticket', '3 trips, 2 tickets = a load with no ticket')
  eq(rec.find((r) => r.assetId === 'T2').state, 'match', 'T2 agrees')
  ok(!rec.some((r) => r.assetId === 'T9'), 'a truck that never hauls for this site is not listed')
  const tot = H.haulTotals(tickets)
  eq(tot.inTons, 61, 'in tons'); eq(tot.outCy, 14, 'out CY'); eq(tot.cost, 738, 'priced tickets only'); eq(tot.loads, 4, 'loads')
  eq(H.haulTotals([tickets[2]]).cost, null, 'no prices = no cost')
}

// ── weather claim ──
{
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.parse('2026-11-02T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)) // Mon Nov 2 → Sun Nov 15
  const wx = new Map(days.map((d) => [d, { day: d, precipIn: 0, gustMph: 10, tMinF: 45, tMaxF: 65 }]))
  wx.set('2026-11-04', { day: '2026-11-04', precipIn: 1.4, gustMph: 20, tMinF: 50, tMaxF: 60 }) // Wed: heavy rain, no work
  wx.set('2026-11-10', { day: '2026-11-10', precipIn: 0.7, gustMph: 15, tMinF: 50, tMaxF: 62 }) // Tue: rain, worked through
  const hours = new Map(days.map((d) => [d, 9]))
  hours.set('2026-11-04', 0); hours.set('2026-11-05', 2) // Thu: mud day, barely worked
  const { verdicts, normalHours } = W.judgeDays(days, wx, hours, W.DEFAULT_THRESHOLDS)
  eq(normalHours, 9, 'normal day = median worked')
  eq(verdicts.length, 10, 'weekdays only by default')
  eq(verdicts.filter((v) => v.lost).map((v) => v.day), ['2026-11-04', '2026-11-05'], 'rain day + mud day lost')
  eq(verdicts.filter((v) => v.workedThrough).map((v) => v.day), ['2026-11-10'], 'worked through is not claimed')
  const s = W.claimDays(verdicts, { '2026-11': 1 })
  eq([s.lost, s.anticipated, s.claim], [2, 1, 1], 'anticipated days come off the top')
  const letter = W.claimLetter({ companyName: 'DCG', jobName: 'Creekside', jobNumber: '26-014', customer: 'Owner', contractNo: null, from: days[0], to: days[13], summary: s, verdicts, normalHours, today: '2026-11-19', lat: 34.85, lng: -82.4 })
  ok(/extension of 1 working day/.test(letter) && /Wednesday, November 4, 2026/.test(letter), 'letter names the claim and the days')
  ok(W.evidenceCsv(verdicts).includes('"1.40"" rain"'), 'CSV escapes the inch mark')
  const noWx = W.judgeDays(['2026-11-04'], new Map(), new Map([['2026-11-04', 0]]), W.DEFAULT_THRESHOLDS)
  ok(!noWx.verdicts[0].lost, 'no weather record = never claimed')
}

// ── DVIR ──
{
  const sig = 'M1 1L20 20L40 5'
  const c = D.cleanDvir({ when: 'pre', odometer: '120345', defects: [{ item: 'tires', severity: 'oos', note: 'cut sidewall LF' }, { item: 'tires', severity: 'minor' }, { item: 'trailer_lights', severity: 'minor' }, { item: 'nope' }], signature: sig }, '2026-11-19T12:00:00Z')
  ok(c.ok, 'a DVIR cleans')
  eq(c.ok && c.value.defects.map((d) => d.item), ['tires'], 'duplicates, unknown and trailer items (no trailer) dropped')
  eq(D.dvirStatus(c.value).state, 'unsafe', 'an out-of-service defect = unsafe')
  eq(D.dvirStatus({ ...c.value, repair: { by: 'Shop', at: 'x', outcome: 'repaired' } }).state, 'repaired', 'certified repair clears it')
  eq(D.dvirStatus({ defects: [] }).state, 'ok', 'no defects = ok')
  ok(!D.cleanDvir({ when: 'pre', defects: [], signature: '<script>' }, 'x').ok, 'a signature must be a path')
  ok(!D.cleanDvir({ when: 'pre', defects: [], odometer: -5, signature: sig }, 'x').ok, 'odometer bounded')
  const withTrailer = D.cleanDvir({ when: 'post', trailer: 'Lowboy', defects: [{ item: 'trailer_lights', severity: 'minor' }], signature: sig }, 'x')
  eq(withTrailer.ok && withTrailer.value.defects.length, 1, 'trailer items allowed with a trailer')
}

// ── activation + status ──
{
  const now = Date.parse('2026-11-19T12:00:00Z')
  const a = A.activation({ id: 'c', name: 'Co', signup: '2026-11-10T00:00:00Z', tracker: '2026-11-11T00:00:00Z', fix: '2026-11-13T00:00:00Z', site: null, team: null, clock: null, lastFix: '2026-11-19T00:00:00Z', assets: 2 }, now)
  ok(a.activated, 'fix on day 3 = activated')
  eq(a.next, 'Draw their first site with them', 'next nudge')
  const b = A.activation({ id: 'd', name: 'D', signup: '2026-11-01T00:00:00Z', tracker: '2026-11-02T00:00:00Z', fix: null, site: null, team: null, clock: null, lastFix: null, assets: 0 }, now)
  ok(!b.activated && b.stalled && /nothing reporting/.test(b.next), 'stalled after a week with no fix')
  eq(A.funnel([a, b]).find((f) => f.key === 'fix').count, 1, 'funnel counts')
  const checks = [
    { at: '2026-11-19T10:00:00Z', db: true, ingest: true, ai: false },
    { at: '2026-11-19T11:00:00Z', db: true, ingest: true, ai: true },
    { at: '2026-11-18T11:00:00Z', db: true, ingest: false, ai: null },
  ]
  const bars = S.dailyBars(checks, 3, '2026-11-19')
  eq(bars.ai.map((x) => x.state), ['none', 'none', 'partial'], 'no AI check = no data, never up')
  eq(bars.ingest.map((x) => x.state), ['none', 'down', 'up'], 'ingest days')
  eq(S.uptime(checks, 'ai'), 50, 'uptime ignores nulls')
  eq(S.current(checks, now).ai, 'up', 'current = newest fresh check')
  eq(S.current(checks, now + 5 * 3_600_000).app, 'unknown', 'stale = unknown, not up')
}

{ // legal deadlines by the calendar, never 30-day months (ship-check Nov 19)
  eq(R.addMonths('2026-08-31', 6), '2027-02-28', 'Aug 31 + 6 months = Feb 28')
  eq(R.addMonths('2027-01-31', 6), '2027-07-31', 'Jan 31 + 6 months = Jul 31')
  eq(R.addMonths('2027-08-31', 6), '2028-02-29', 'leap year')
  eq(R.addMonths('2026-03-15', 12), '2027-03-15', 'one calendar year')
  const f = L.lienClock({ role: 'sub', lastFurnished: '2026-06-01', lienFiled: '2026-08-31' }, { first: null, last: null }, '2026-09-01', false)
  eq(f.deadlines.find((d) => d.key === 'suit')?.due, '2027-02-28', 'suit = six calendar months after filing')
  // no worked days on record = no evidence = nothing claimed
  const days = ['2026-11-02', '2026-11-03']
  const wx = new Map(days.map((d) => [d, { precipIn: 1.2, tMaxF: 60, gustMph: 10 }]))
  const j = W.judgeDays(days, wx, new Map(), W.DEFAULT_THRESHOLDS)
  eq(j.verdicts.filter((v) => v.lost).length, 0, 'no hours on record claims no lost days')
}

console.log(`\nbeta: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
