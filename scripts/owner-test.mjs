// node scripts/owner-test.mjs — the owner dashboard's pure engine
// (lib/owner/dashboard.ts): backlog, the bid funnel, customer concentration,
// the buyer's discounts and the money Sankey. Run it after ANY change there.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/owner/dashboard.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const O = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m) } }
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e

const jobs = [
  { jobId: 'a', name: 'Riverfront', customer: 'Harbor Point Builders', stage: 'active', contract: 1_000_000, awardedOn: '2026-06-01' },
  { jobId: 'b', name: 'Maple', customer: 'harbor point builders ', stage: 'awarded', contract: 500_000, awardedOn: '2026-09-01' },
  { jobId: 'c', name: 'School', customer: 'County Schools', stage: 'active', contract: 300_000, awardedOn: '2026-07-01' },
  { jobId: 'd', name: 'Lot 9', customer: null, stage: 'active', contract: 100_000, awardedOn: '2026-08-01' },
  { jobId: 'e', name: 'No price', customer: 'X', stage: 'active', contract: null, awardedOn: null },
  { jobId: 'f', name: 'Old', customer: 'Y', stage: 'closed', contract: 50_000, awardedOn: '2025-01-01' },
  { jobId: 'g', name: 'Bid', customer: 'Z', stage: 'submitted', contract: 900_000, awardedOn: null },
]
const wip = [
  { jobId: 'a', contract: 1_050_000, earned: 600_000, billed: 650_000, costToDate: 480_000, known: true },
  { jobId: 'c', contract: 300_000, earned: 0, billed: 90_000, costToDate: 50_000, known: false },
]
const bl = O.backlog(jobs, wip)
ok(near(bl.total, 450_000 + 500_000 + 210_000 + 100_000), `backlog total (${bl.total})`)
ok(bl.jobs[0].name === 'Maple' && bl.jobs[0].left === 500_000, 'biggest first; a job with no pay app is all backlog')
ok(bl.jobs.find((j) => j.name === 'School').left === 210_000, 'unknown % complete → billed is the floor')
ok(bl.unknown.length === 1 && bl.unknown[0] === 'No price', 'no contract named, not counted')
ok(!bl.jobs.some((j) => j.name === 'Bid' || j.name === 'Old'), 'bids and closed jobs are not backlog')

const bids = [
  { estimateId: '1', status: 'won', bidOn: '2026-10-01', total: 400_000 },
  { estimateId: '2', status: 'lost', bidOn: '2026-10-05', total: 200_000 },
  { estimateId: '3', status: 'lost', bidOn: '2026-10-09', total: 100_000 },
  { estimateId: '4', status: 'sent', bidOn: '2026-11-01', total: 50_000 },
  { estimateId: '5', status: 'won', bidOn: '2026-01-01', total: 1_000 },
  { estimateId: '6', status: 'draft', bidOn: '2026-10-02', total: 9 },
]
const f = O.bidFunnel(bids, '2026-09-01', '2026-11-25')
ok(f.sent === 4 && f.won === 1 && f.lost === 2 && f.pending === 1, 'funnel counts in the window, drafts out')
ok(near(f.winRate, 1 / 3) && near(f.dollarWinRate, 400 / 700), 'win rate by count and by dollars')
ok(O.bidFunnel([], '2026-01-01', '2026-12-31').winRate === null, 'no decided bids → null, not 0%')

const c = O.concentration(jobs, null)
ok(c.customers[0].name.startsWith('Harbor') && near(c.customers[0].share, 1_500_000 / 1_850_000), 'customers merged case-insensitively')
ok(c.noCustomer === 100_000, 'no-customer work set apart')
ok(near(c.top3, 1), 'top 3 share')
ok(c.hhi > 0.6 && c.hhi <= 1, `hhi (${c.hhi})`)
ok(!c.customers.some((x) => x.name === 'Z'), 'a bid is not a customer yet')
ok(O.concentration(jobs, '2026-08-15').customers.length === 1, 'window by award date')

const d1 = O.valuationDiscounts(c, { cpaReviewed: true, personalSeparate: true, revenueFromInvoices: true })
ok(d1.length === 1 && d1[0].key === 'concentration' && d1[0].pct === 20, 'top customer > 50% → 20%')
const d2 = O.valuationDiscounts({ ...c, top: 0.35 }, { cpaReviewed: null, personalSeparate: false, revenueFromInvoices: null })
ok(d2.map((d) => d.pct).join() === '10,10,5,5', 'unanswered costs the discount')
ok(/Not known/.test(d2[1].why) && /runs through/.test(d2[2].why), 'reasons say which')
const d3 = O.valuationDiscounts({ ...c, top: 0.9 }, { cpaReviewed: false, personalSeparate: false, revenueFromInvoices: false })
ok(d3.reduce((t, d) => t + d.pct, 0) === 40, 'capped at 40% together')
ok(O.valuationDiscounts({ ...c, top: null }, { cpaReviewed: true, personalSeparate: true, revenueFromInvoices: true }).length === 0, 'clean books, no customers → no discount')
const adj = O.applyDiscounts({ lo: 1_000_000, hi: 2_000_000 }, d2)
ok(adj.lo === 700_000 && adj.hi === 1_400_000, 'discounts applied to the range')
ok(O.applyDiscounts(null, d2) === null, 'no range stays null')

const s = O.moneySankey(
  [{ name: 'A', earned: 600_000 }, { name: 'B', earned: 200_000 }, { name: 'Z', earned: 0 }],
  [{ pcat: 'L', amount: 200_000 }, { pcat: 'M', amount: 250_000 }, { pcat: 'E', amount: 150_000 }, { pcat: 'L', amount: 20_000 }, { pcat: 'F', amount: 0 }],
)
ok(s && s.margin === 180_000, 'margin = earned − cost')
ok(s.nodes.filter((n) => n.col === 0).length === 2, 'jobs with nothing earned left out')
const inCo = s.links.filter((l) => l.to === 'co').reduce((t, l) => t + l.value, 0)
const outCo = s.links.filter((l) => l.from === 'co').reduce((t, l) => t + l.value, 0)
ok(near(inCo, outCo), 'money in = money out (incl. margin)')
ok(s.nodes.find((n) => n.id === 'cL').value === 220_000, 'cost types summed')
const loss = O.moneySankey([{ name: 'A', earned: 100 }], [{ pcat: 'M', amount: 150 }])
ok(loss.margin === -50 && !loss.nodes.some((n) => n.id === 'margin'), 'a loss shows no margin band')
ok(loss.nodes.find((n) => n.id === 'loss').value === 50 && loss.nodes.find((n) => n.id === 'co').value === 150, 'a loss flows in so the middle balances')
const ll = O.layoutSankey(loss, 600, 300)
const co = ll.nodes.find((n) => n.id === 'co')
ok(co.outY <= co.y + co.h + 0.01 && co.inY <= co.y + co.h + 0.01, 'bands stay inside the middle node on a loss')
ok(O.moneySankey([], []) === null, 'nothing earned → null')
const many = O.moneySankey(Array.from({ length: 9 }, (_, i) => ({ name: `J${i}`, earned: 100 - i })), [])
ok(many.nodes.filter((n) => n.col === 0).length === 7 && many.nodes.some((n) => n.label === '3 other jobs'), 'top 6 + other jobs')
const lay = O.layoutSankey(s, 600, 300)
ok(lay.bands.length === s.links.length && lay.bands.every((b) => /^M[\d.]+,[\d.]+ C/.test(b.d)), 'every link has a path')
ok(lay.nodes.every((n) => n.y >= -0.01 && n.y + n.h <= 300.01), 'nodes inside the box')

console.log(`owner: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
