// node scripts/portfolio-test.mjs — money across jobs (lib/jobs/portfolio.ts):
// receivables aging, the WIP schedule, cash by month. Run it after ANY change
// to it (these are the numbers a bank reads). Every figure here is made up.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const transpile = (path, map = {}) => {
  let js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  for (const [k, v] of Object.entries(map)) js = js.split(`'${k}'`).join(`'${v}'`)
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
}
const payapp = transpile('../lib/jobs/payapp.ts')
const closeout = transpile('../lib/jobs/closeout.ts', { './payapp': payapp })
const icons = transpile('../lib/asset-icons.ts')
const bulk = transpile('../lib/bulk-import.ts', { './asset-icons': icons })
const cost = transpile('../lib/jobs/cost.ts', { '../bulk-import': bulk })
const P = await import(transpile('../lib/jobs/portfolio.ts', { './payapp': payapp, './closeout': closeout, './cost': cost }))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
const today = '2026-11-08'
const app = (o) => ({ jobId: 'A', appNo: 1, appDate: '2026-10-25', status: 'submitted', release: false, currentDue: 1000, paidAmount: null, paidOn: null, contractToDate: 100000, completedStored: 50000, retTotal: 5000, ...o })

// ── the buckets ──
eq([-5, 0, 1, 30, 31, 60, 61, 90, 91, 400].map(P.ageBucket), ['current', 'current', 'd30', 'd30', 'd60', 'd60', 'd90', 'd90', 'over90', 'over90'], 'days past due → its column (due today is current)')
eq([P.addDays('2026-10-25', 30), P.daysFrom('2026-11-24', today)], ['2026-11-24', -16], 'net 30 from the application date')

// ── receivables ──
{
  const apps = [
    app({ jobId: 'A', appNo: 1, appDate: '2026-10-25', currentDue: 20000 }), // due Nov 24 → current
    app({ jobId: 'A', appNo: 2, appDate: '2026-09-20', currentDue: 15000.5, paidAmount: 5000 }), // due Oct 20 → 19 late, owes 10,000.50
    app({ jobId: 'B', appNo: 3, appDate: '2026-07-01', currentDue: 8000, status: 'approved' }), // due Jul 31 → 100 late
    app({ jobId: 'B', appNo: 4, appDate: '2026-08-15', currentDue: 9000, status: 'paid', paidAmount: null, paidOn: '2026-09-10' }), // paid
    app({ jobId: 'B', appNo: 5, appDate: '2026-08-01', currentDue: 7000, status: 'draft' }), // not sent
    app({ jobId: 'C', appNo: 6, appDate: '2026-09-01', currentDue: 5000, status: 'void' }), // void
    app({ jobId: 'C', appNo: 7, appDate: '2026-09-01', currentDue: 3000, paidAmount: 3500, status: 'approved' }), // overpaid
  ]
  const r = P.arAging(apps, today, 30)
  eq(r.rows.map((x) => [x.appNo, x.bucket, x.owed, x.daysPastDue]), [[3, 'over90', 8000, 100], [2, 'd30', 10000.5, 19], [1, 'current', 20000, -16]], 'only sent applications not paid in full, latest-due first, short pays to the cent')
  eq([r.totals.current, r.totals.d30, r.totals.d60, r.totals.d90, r.totals.over90, r.total, r.pastDue], [20000, 10000.5, 0, 0, 8000, 38000.5, 18000.5], 'bucket totals, everything owed, what is past due')
  eq(P.arAging(apps, today, 0).rows.find((x) => x.appNo === 1).bucket, 'd30', 'due on receipt: two weeks old is 1–30 days late…')
  eq(P.arAging(apps, today, 0).rows.find((x) => x.appNo === 1).daysPastDue, 14, '…14 days past due')
  eq([P.isTerms(30), P.isTerms(31), P.isTerms('30')], [true, false, false], 'terms come from the list')
}

// ── last sent application per job ──
{
  const m = P.lastSentByJob([app({ jobId: 'A', appNo: 1 }), app({ jobId: 'A', appNo: 3, completedStored: 80000 }), app({ jobId: 'A', appNo: 4, status: 'draft', completedStored: 99999 }), app({ jobId: 'B', appNo: 2, status: 'void' })])
  eq([m.get('A').appNo, m.get('A').completedStored, m.has('B')], [3, 80000, false], 'billed to date = the last SENT application (a draft or a void one never)')
}

// ── cash by month ──
{
  const c = P.cashByMonth([
    app({ appDate: '2026-11-02', currentDue: 12000 }),
    app({ appDate: '2026-10-05', currentDue: 30000, status: 'paid', paidAmount: 29500, paidOn: '2026-11-01' }),
    app({ appDate: '2026-09-05', currentDue: 20000, status: 'paid', paidAmount: null, paidOn: '2026-10-03' }),
    app({ appDate: '2026-04-05', currentDue: 99999, status: 'paid', paidAmount: 99999, paidOn: '2026-05-01' }),
    app({ appDate: '2026-10-20', currentDue: 777, status: 'draft' }),
  ], today, 3)
  eq(c, [{ month: '2026-09', billed: 20000, collected: 0 }, { month: '2026-10', billed: 30000, collected: 20000 }, { month: '2026-11', billed: 12000, collected: 29500 }], 'billed by application date, collected by paid date, three months oldest first; drafts and older months left out')
  eq(P.cashByMonth([], '2026-01-15', 3).map((x) => x.month), ['2025-11', '2025-12', '2026-01'], 'months roll back across the year')
  eq(P.monthWords('2026-11'), 'Nov 2026', 'a month in words')
}

// ── the WIP schedule ──
{
  const s = P.wipSchedule([
    { jobId: 'A', contract: 400000, currentBudget: 300000, costToDate: 150000, billed: 180000, retainageHeld: 18000, eac: null },
    { jobId: 'B', contract: 100000, currentBudget: 80000, costToDate: 60000, billed: 50000, retainageHeld: 5000, eac: 90000 },
  ])
  eq([s.rows[0].w.pctComplete, s.rows[0].w.earned, s.rows[0].w.overUnder], [50, 200000, -20000], 'job A: half the cost spent → half the contract earned; billed 180k → 20k underbilled')
  eq([s.rows[1].w.estimatedCost, s.rows[1].w.pctComplete, s.rows[1].w.earned, s.rows[1].w.overUnder, s.rows[1].w.forecastMargin], [90000, 66.7, 66666.67, -16666.67, 10000], 'job B: the PM’s estimate at completion drives % complete and margin')
  eq([s.totals.contract, s.totals.costToDate, s.totals.earned, s.totals.billed, s.totals.underbilled, s.totals.overbilled, s.totals.retainageHeld, s.totals.forecastMargin, s.totals.leftToBill],
    [500000, 210000, 266666.67, 230000, 36666.67, 0, 23000, 110000, 270000], 'the totals a bank asks for — over and under billing kept apart, never netted')
  const nb = P.wipSchedule([
    { jobId: 'A', contract: 400000, currentBudget: 300000, costToDate: 150000, billed: 180000, retainageHeld: 18000, eac: null },
    { jobId: 'N', contract: 1000000, currentBudget: 0, costToDate: 5000, billed: 40000, retainageHeld: 4000, eac: null },
  ])
  eq([nb.totals.noBudget, nb.totals.earned, nb.totals.underbilled, nb.totals.estimatedCost, nb.totals.forecastMargin, nb.totals.contract, nb.totals.billed, nb.totals.costToDate, nb.totals.leftToBill],
    [1, 200000, 20000, 300000, 100000, 1400000, 220000, 155000, 1180000], 'a job with no budget stays out of earned, over / under, estimated cost and margin — never "100% done"; its contract, cost and billing still count')
}

console.log(`portfolio: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
