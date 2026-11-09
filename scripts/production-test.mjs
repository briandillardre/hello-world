/**
 * 📏 Production tracking, asserted (run: node scripts/production-test.mjs).
 *
 * The production read tells an owner whether the job is making or losing
 * money against the bid, so the arithmetic is guarded like money: items from
 * the estimate, installed / % / remaining, the day's cost shared by earned
 * value, unit cost and production rate, over/under, unallocated days, and
 * the no-money (foreman) view. Run after ANY change to lib/jobs/production.ts.
 */
import { importTs } from './lib/ts-import.mjs'

const P = await importTs('../lib/jobs/production.ts', import.meta.url)
const { itemsFromEstimate, productionRollup, qtyWords, readQty } = P

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.log('✗', name, extra)
}
const near = (a, b, eps = 0.011) => a !== null && Math.abs(a - b) <= eps

// ---- items from the estimate
{
  const lines = [
    { id: 'a', section: 'Storm', code: '02-310', name: '15" RCP', unit: 'LF', qty: 800, perDay: 160, crewKey: 'pipe' },
    { id: 'b', section: 'Earthwork', code: null, name: 'Mass excavation', unit: 'CY', qty: 5000, perDay: 1000, crewKey: 'dirt' },
    { id: 'c', section: 'General', code: 'MOB', name: 'Mobilization', unit: 'LS', qty: 1, perDay: null, crewKey: null },
    { id: 'd', section: 'Paving', code: null, name: 'Nothing yet', unit: 'SY', qty: 0, perDay: null, crewKey: null },
  ]
  const costs = new Map([['a', { total: 40000, unitCost: 50 }], ['b', { total: 30000, unitCost: 6 }], ['c', { total: 4200, unitCost: null }]])
  const items = itemsFromEstimate(lines, costs, (k) => (k === 'pipe' ? 'Pipe crew' : k === 'dirt' ? 'Dirt crew' : null))
  ok('zero-quantity lines are skipped', items.length === 3)
  ok('code falls back to the section', items[1].code === 'Earthwork' && items[0].code === '02-310')
  ok('unit cost + production rate carried', items[0].bidUnitCost === 50 && items[0].bidPerDay === 160 && items[0].crew === 'Pipe crew')
  ok('lump sum = 1 unit priced at its total', items[2].unit === 'LS' && items[2].budgetQty === 1 && items[2].bidUnitCost === 4200)
}

const items = [
  { id: 'pipe', code: '02-310', name: '15" RCP', unit: 'LF', budgetQty: 800, bidUnitCost: 50, bidPerDay: 160, crew: 'Pipe crew', sort: 1 },
  { id: 'exc', code: 'EW', name: 'Mass excavation', unit: 'CY', budgetQty: 5000, bidUnitCost: 6, bidPerDay: 1000, crew: 'Dirt crew', sort: 2 },
]

// ---- a single item, single day: the whole day's cost is its cost
{
  const r = productionRollup(items, [{ itemId: 'pipe', day: '2026-11-02', qty: 200 }], [{ day: '2026-11-02', laborHrs: 40, laborCost: 2000, equipHrs: 10, equipCost: 1500 }])
  const p = r.items.find((i) => i.id === 'pipe')
  ok('installed / pct / remaining', p.installed === 200 && near(p.pct, 0.25) && p.remaining === 600)
  ok('earned = installed × bid unit cost', p.earned === 10000)
  ok('one item carries the whole day', p.actualCost === 3500 && p.actualUnitCost === 17.5)
  ok('over/under = earned − actual (under bid → +)', p.overUnder === 6500)
  ok('production rate + days left', p.actualPerDay === 200 && near(p.daysLeft, 3))
  ok('labor hours carried', p.laborHrs === 40)
  const job = r
  ok('job % complete by earned value', near(job.pctComplete, 10000 / 70000, 0.001))
  ok('job over/under', job.overUnder === 6500 && job.unallocatedCost === 0)
}

// ---- two items on one day: cost shared by the value each earned
{
  const r = productionRollup(items, [
    { itemId: 'pipe', day: '2026-11-03', qty: 100 }, // earned 5,000
    { itemId: 'exc', day: '2026-11-03', qty: 2500 }, // earned 15,000
  ], [{ day: '2026-11-03', laborHrs: 80, laborCost: 6000, equipHrs: 20, equipCost: 2000 }])
  const pipe = r.items.find((i) => i.id === 'pipe')
  const exc = r.items.find((i) => i.id === 'exc')
  ok('cost split 25 / 75 by earned value', pipe.actualCost === 2000 && exc.actualCost === 6000)
  ok('hours split the same way', pipe.laborHrs === 20 && exc.laborHrs === 60)
  ok('shares add back to the day', pipe.actualCost + exc.actualCost === 8000)
}

// ---- days with cost but no quantity are shown, never hidden or spread
{
  const r = productionRollup(items, [{ itemId: 'pipe', day: '2026-11-04', qty: 100 }], [
    { day: '2026-11-04', laborHrs: 10, laborCost: 1000, equipHrs: 0, equipCost: 0 },
    { day: '2026-11-05', laborHrs: 10, laborCost: 900, equipHrs: 5, equipCost: 600 },
  ])
  ok('the unlogged day is unallocated', r.unallocatedCost === 1500 && r.unallocatedDays.join() === '2026-11-05')
  ok('it does not land on the item', r.items.find((i) => i.id === 'pipe').actualCost === 1000)
  ok('days logged counts quantity days only', r.daysLogged === 1)
}

// ---- losing money reads negative
{
  const r = productionRollup(items, [{ itemId: 'exc', day: '2026-11-06', qty: 500 }], [{ day: '2026-11-06', laborHrs: 50, laborCost: 4000, equipHrs: 20, equipCost: 3000 }])
  const exc = r.items.find((i) => i.id === 'exc')
  ok('over budget → negative over/under', exc.overUnder === 3000 - 7000 && exc.actualUnitCost === 14)
}

// ---- the foreman view: no unit costs → no money anywhere, still progress
{
  const blind = items.map((i) => ({ ...i, bidUnitCost: null }))
  const r = productionRollup(blind, [{ itemId: 'pipe', day: '2026-11-02', qty: 400 }, { itemId: 'exc', day: '2026-11-02', qty: 0 }], [{ day: '2026-11-02', laborHrs: 40, laborCost: 2000, equipHrs: 0, equipCost: 0 }])
  ok('no money leaks without unit costs', r.earned === null && r.overUnder === null && r.budgetValue === null && r.unallocatedCost === 0 && r.items.every((i) => i.actualCost === null && i.earned === null && i.overUnder === null))
  ok('% complete falls back to the average item %', near(r.pctComplete, (0.5 + 0) / 2, 0.001))
  ok('quantities and rate still read', r.items[0].installed === 400 && r.items[0].actualPerDay === 400)
  ok('hours still read', r.items[0].laborHrs === 40)
}

// ---- hostile / odd inputs
{
  const r = productionRollup(items, [
    { itemId: 'ghost', day: '2026-11-02', qty: 50 },
    { itemId: 'pipe', day: 'yesterday', qty: 50 },
    { itemId: 'pipe', day: '2026-11-02', qty: -40 },
    { itemId: 'pipe', day: '2026-11-02', qty: NaN },
    { itemId: 'pipe', day: '2026-11-07', qty: 900 }, // over-run past the bid quantity
  ], [{ day: '2026-11-07', laborHrs: NaN, laborCost: 100, equipHrs: 0, equipCost: 0 }])
  const p = r.items.find((i) => i.id === 'pipe')
  ok('unknown items, bad days, negatives and NaN are ignored', p.installed === 900 && p.daysWorked === 1)
  ok('an over-run reads >100% with nothing remaining', p.pct > 1 && p.remaining === 0 && p.daysLeft === 0)
  ok('NaN hours never poison the totals', Number.isFinite(r.overUnder) && p.laborHrs === 0)
}

// ---- no data at all
{
  const r = productionRollup(items, [], [])
  ok('empty job reads zero, not NaN', r.earned === 0 && r.pctComplete === 0 && r.overUnder === 0 && r.items.every((i) => i.installed === 0 && i.daysLeft === 5 || i.daysLeft === 4))
  ok('days left from the bid rate before anything is logged', r.items[0].daysLeft === 5 && r.items[1].daysLeft === 5)
}

// ---- 1,000-day fuzz: shares always add back to the logged days' cost
{
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const entries = []
  const days = []
  for (let d = 0; d < 1000; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10)
    days.push({ day, laborHrs: rnd() * 80, laborCost: rnd() * 5000, equipHrs: rnd() * 30, equipCost: rnd() * 3000 })
    if (rnd() < 0.8) entries.push({ itemId: rnd() < 0.5 ? 'pipe' : 'exc', day, qty: rnd() * 300 })
    if (rnd() < 0.3) entries.push({ itemId: 'exc', day, qty: rnd() * 900 })
  }
  const r = productionRollup(items, entries, days)
  const total = days.reduce((a, d) => a + d.laborCost + d.equipCost, 0)
  ok('fuzz: allocated + unallocated = every field dollar', Math.abs(r.allocatedCost + r.unallocatedCost - total) < 0.5, `${r.allocatedCost + r.unallocatedCost} vs ${total}`)
  ok('fuzz: everything finite', r.items.every((i) => Number.isFinite(i.actualCost) && Number.isFinite(i.overUnder)))
}

// ---- words + typed numbers
{
  ok('qtyWords', qtyWords(1240, 'LF') === '1,240 LF' && qtyWords(3.46, 'CY') === '3.5 CY' && qtyWords(1, 'LS') === 'Done' && qtyWords(0, 'LS') === 'Not started')
  ok('readQty', readQty('1,250') === 1250 && readQty('12.5') === 12.5 && readQty('') === null && readQty('-3') === 'bad' && readQty('abc') === 'bad' && readQty(5) === 5)
}


// ---- review pass (Nov 9): a lump sum marked done twice earns once; unpriced items share hours and their dollars show as unallocated
{
  const ls = [{ id: 'mob', code: 'MOB', name: 'Mobilization', unit: 'LS', budgetQty: 1, bidUnitCost: 4000, bidPerDay: null, crew: null, sort: 1 }]
  const r = productionRollup(ls, [{ itemId: 'mob', day: '2026-11-02', qty: 1 }, { itemId: 'mob', day: '2026-11-05', qty: 1 }], [])
  ok('LS done twice earns once', r.items[0].installed === 1 && r.items[0].earned === 4000 && r.pctComplete === 1)
  const mixed = [items[0], { id: 'dirt', code: null, name: 'Typed by hand', unit: 'CY', budgetQty: 1000, bidUnitCost: null, bidPerDay: null, crew: null, sort: 3 }]
  const m = productionRollup(mixed, [{ itemId: 'pipe', day: '2026-11-03', qty: 100 }, { itemId: 'dirt', day: '2026-11-03', qty: 500 }], [{ day: '2026-11-03', laborHrs: 40, laborCost: 3000, equipHrs: 0, equipCost: 1000 }])
  const pipe = m.items.find((i) => i.id === 'pipe'), dirt = m.items.find((i) => i.id === 'dirt')
  ok('unpriced item gets its share of the hours', dirt.laborHrs > 25 && pipe.laborHrs < 15, `${pipe.laborHrs}/${dirt.laborHrs}`)
  ok('unpriced share lands in unallocated, nothing lost', Math.abs(m.allocatedCost + m.unallocatedCost - 4000) < 0.02 && dirt.actualCost === null, `${m.allocatedCost}+${m.unallocatedCost}`)
}

console.log(fail === 0 ? `production: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
