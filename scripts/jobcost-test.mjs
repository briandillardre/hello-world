// node scripts/jobcost-test.mjs — job cost (lib/jobs/cost.ts, migration 155): the
// budget by cost type, actuals, WIP. Run it after ANY change to the engine.
// Every figure here is made up.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const transpile = (path, map = {}) => {
  let js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  for (const [k, v] of Object.entries(map)) js = js.split(`'${k}'`).join(`'${v}'`)
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
}
const iconsUrl = transpile('../lib/asset-icons.ts')
const bulkUrl = transpile('../lib/bulk-import.ts', { './asset-icons': iconsUrl })
const C = await import(transpile('../lib/jobs/cost.ts', { '../bulk-import': bulkUrl }))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

// ── receipts book by what they bought ──
eq(['Fuel', 'Diesel #2', 'Repair', 'Tire', 'Material', 'Stone', 'Tool', 'Equipment rental', 'Meal', null].map(C.pcatOfReceipt), ['F', 'F', 'R', 'R', 'M', 'M', 'E', 'E', 'O', 'O'], 'receipt categories → cost types')

// ── the budget from the won estimate: direct cost only, by type ──
{
  const b = C.budgetFromEstimate([
    { section: 'Earthwork', material: 0, haul: 12000, install: 40000, sub: 0, lowboy: 1500 },
    { section: 'Paving', material: 55000.55, haul: 4000, install: 10000, sub: 30000, lowboy: 0 },
    { section: 'Earthwork', material: 2000, haul: 0, install: 0, sub: 0, lowboy: 0 },
  ], 0.4)
  const get = (sec, p) => b.find((x) => x.costCode === sec && x.pcat === p)?.original ?? 0
  eq([get('Earthwork', 'L'), get('Earthwork', 'E'), get('Earthwork', 'M')], [16000, 37500, 2000], 'earthwork: 40% of the crew is labor; the rest of the crew, haul and lowboy are equipment; material stays material')
  eq([get('Paving', 'M'), get('Paving', 'S'), get('Paving', 'L'), get('Paving', 'E')], [55000.55, 30000, 4000, 10000], 'paving to the cent, the sub as a sub')
  ok(!b.some((x) => x.pcat === 'F' || x.pcat === 'R'), 'fuel and repairs are actual-only — never budgeted')
  eq(Math.round(b.reduce((s, x) => s + x.original * 100, 0)), Math.round((12000 + 40000 + 1500 + 55000.55 + 4000 + 10000 + 30000 + 2000) * 100), 'the budget adds up to the estimate’s direct cost exactly')
}

// ── budget vs actual ──
{
  const budget = [
    { id: '1', costCode: 'E', description: 'x', pcat: 'L', original: 20000, sort: 0 },
    { id: '2', costCode: 'E', description: 'x', pcat: 'E', original: 50000, sort: 1 },
    { id: '3', costCode: 'P', description: 'x', pcat: 'M', original: 55000, sort: 2 },
  ]
  const r = C.rollup(budget, [{ pcat: 'E', amount: 12000 }], [
    { pcat: 'L', amount: 22000 }, { pcat: 'E', amount: 30000.25 }, { pcat: 'F', amount: 4000 }, { pcat: 'R', amount: 900 }, { pcat: 'M', amount: 10000 },
  ])
  const row = (p) => r.rows.find((x) => x.pcat === p)
  eq([row('E').original, row('E').changeOrders, row('E').current, row('E').actual, row('E').remaining], [50000, 12000, 62000, 30000.25, 31999.75], 'the current budget = original + approved change orders; the original never moves')
  eq(r.overBudget, ['L'], 'labor over its budget is called out')
  eq([row('F').current, row('F').actual, row('F').pctUsed], [0, 4000, null], 'fuel is actual-only')
  eq([r.total.original, r.total.current, r.total.actual], [125000, 137000, 66900.25], 'totals')
}

// ── WIP, cost to cost ──
{
  const w = C.wip({ contract: 200000, currentBudget: 150000, costToDate: 60000, billed: 90000, retainageHeld: 9000 })
  eq([w.pctComplete, w.earned, w.overUnder, w.forecastMargin, w.marginPct], [40, 80000, 10000, 50000, 25], '40% of the cost spent → 40% of the contract earned; billed 90k = 10k overbilled')
  const u = C.wip({ contract: 200000, currentBudget: 150000, costToDate: 120000, billed: 90000, retainageHeld: 9000 })
  eq(u.overUnder, -70000, 'spent ahead of billing = underbilled (earned, not billed)')
  const over = C.wip({ contract: 200000, currentBudget: 150000, costToDate: 170000, billed: 190000, retainageHeld: 0 })
  eq([over.estimatedCost, over.pctComplete, over.forecastMargin], [170000, 100, 30000], 'past the budget: the cost so far is the estimate, never a % past 100')
  eq(C.wip({ contract: 200000, currentBudget: 150000, costToDate: 60000, billed: 0, retainageHeld: 0, estimateAtCompletion: 180000 }).pctComplete, 33.3, 'the PM’s own estimate at completion wins')
}

// ── pasted costs ──
{
  const p = C.parseCosts('Date,Type,Amount,Vendor,Reference,Description\n5/21/2026,S,"12,500",Sub Co,INV-77,Curb\n13/40/2026,M,5\n6/1/26,X,5\n6/2/26,L,(300),Payroll,ADJ,credit')
  eq(p.rows.map((r) => [r.spentOn, r.pcat, r.amount]), [['2026-05-21', 'S', 12500], ['2026-06-02', 'L', -300]], 'a quoted "12,500" reads whole; parentheses are a credit')
  eq(p.skipped.map((s) => s.line), [3, 4], 'a date that doesn’t exist and an unknown type are skipped with why')
  const tsv = C.parseCosts('2026-05-22\tM\t$1,250.50\tQuarry\tT-9\tStone')
  eq(tsv.rows.map((r) => [r.spentOn, r.pcat, r.amount, r.vendor]), [['2026-05-22', 'M', 1250.5, 'Quarry']], 'a tab-separated paste (straight out of Excel) reads too')
}
eq([C.toIso('5/21/2026'), C.toIso('05/21/26'), C.toIso('2026-02-30')], ['2026-05-21', '2026-05-21', null], 'dates the way the sheets write them')

console.log(`\njob cost: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
