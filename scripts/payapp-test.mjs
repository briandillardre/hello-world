// node scripts/payapp-test.mjs — pay apps (lib/jobs/payapp.ts, migration 154): the
// G702 / G703 math. Run it after ANY change to the engine: these are invoices.
// Every figure here is made up — no customer's contract is in this repo.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/jobs/payapp.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const P = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const sov = [
  { id: 'a', itemNo: '1', area: null, description: 'GENERAL CONDITIONS', scheduled: 10000, retPct: null, sort: 0 },
  { id: 'b', itemNo: '2', area: null, description: 'GRADING', scheduled: 100000.10, retPct: null, sort: 1 },
  { id: 'c', itemNo: '3', area: null, description: 'ASPHALT', scheduled: 50000, retPct: 5, sort: 2 },
]
const co = (id, number, status, approved, approvedOn) => ({ id, number, customerNo: null, title: `Change ${number}`, description: null, type: 'owner', status, identifiedOn: null, submittedOn: null, approvedOn, requested: approved, approved, costImpact: null, scheduleDays: null, note: null })

// ── one line ──
{
  const m = P.lineMath({ key: 'x', itemNo: '1', area: null, description: 'x', scheduled: 1000, prev: 200, thisPeriod: 300, stored: 100, retPct: null, isCo: false }, 10, 5)
  eq([m.total, Math.round(m.pct), m.balance, m.retWork, m.retStored, m.ret], [600, 60, 400, 50, 5, 55], 'G = D+E+F, G/C, H = C−G, I = 10% of work + 5% of stored')
}

// ── application 1 ──
const cos1 = [co('k1', 1, 'approved', 2500.25, '2026-09-10'), co('k2', 2, 'submitted', 9000, null), co('k3', 3, 'approved', -1000, '2026-10-20')]
const lines1 = P.linesFor({ sov, cos: cos1, periodTo: '2026-09-30', prior: null, entries: { 'sov:a': { thisPeriod: 10000, stored: 0 }, 'sov:b': { thisPeriod: 25000.05, stored: 8000 }, 'co:k1': { thisPeriod: 2500.25, stored: 0 } } })
eq(lines1.map((l) => l.itemNo), ['1', '2', '3', 'CO1'], 'the schedule, then each change order approved by the period end (CO3 is approved later; CO2 isn’t approved)')
const t1 = P.totalsFor({ lines: lines1, retPct: 10, storedRetPct: 10, prevCerts: 0, cos: cos1, periodTo: '2026-09-30', prevPeriodTo: null })
eq([t1.originalSum, t1.coNet, t1.contractToDate], [160000.1, 2500.25, 162500.35], 'lines 1–3: original sum, change orders, contract to date')
eq(t1.completedStored, 45500.3, 'line 4: completed and stored (10,000 + 25,000.05 + 8,000 + 2,500.25)')
eq([t1.retWork, t1.retStored, t1.retTotal], [3750.03, 800, 4550.03], 'line 5: 10% of the work (to the cent), 10% of the stored material')
eq([t1.earnedLessRet, t1.prevCerts, t1.currentDue], [40950.27, 0, 40950.27], 'lines 6–8 on the first application')
eq(t1.balanceToFinish, 121550.08, 'line 9: balance to finish including retainage = 3 − 6')
eq(t1.co, { priorAdd: 0, priorDeduct: 0, thisAdd: 2500.25, thisDeduct: 0 }, 'change-order summary: approved this month')

// ── application 2: D carries, stored material goes in, a deduct arrives ──
const lines2 = P.linesFor({ sov, cos: cos1, periodTo: '2026-10-31', prior: lines1, entries: { 'sov:b': { thisPeriod: 30000, stored: 0 }, 'sov:c': { thisPeriod: 10000, stored: 0 } } })
const b2 = lines2.find((l) => l.key === 'sov:b')
eq([b2.prev, b2.thisPeriod, b2.stored], [25000.05, 30000, 0], 'D = what the earlier applications billed; the stored 8,000 was installed (it is in E now, F back to 0)')
eq(lines2.find((l) => l.key === 'sov:a').prev, 10000, 'a line finished last month carries its whole amount in D')
eq(lines2.map((l) => l.itemNo), ['1', '2', '3', 'CO1', 'CO3'], 'the deduct approved in October joins the October application')
const t2 = P.totalsFor({ lines: lines2, retPct: 10, storedRetPct: 10, prevCerts: t1.earnedLessRet, cos: cos1, periodTo: '2026-10-31', prevPeriodTo: '2026-09-30' })
eq([t2.coNet, t2.contractToDate], [1500.25, 161500.35], 'the deduct lowers the contract to date')
eq(t2.co, { priorAdd: 2500.25, priorDeduct: 0, thisAdd: 0, thisDeduct: 1000 }, 'summary: September’s addition is prior, October’s deduct is this month')
eq([t2.completedStored, t2.retWork, t2.retStored], [77500.3, 7250.03, 0], 'line 4 and 5 — the asphalt line holds its own 5%')
eq([t2.earnedLessRet, t2.currentDue], [70250.27, 29300], 'line 6, and line 8 = 6 − the last certificate')

// ── stored material carries until it changes ──
{
  const l3 = P.linesFor({ sov, cos: [], periodTo: '2026-11-30', prior: lines1, entries: {} })
  eq(l3.find((l) => l.key === 'sov:b').stored, 8000, 'stored material nobody touched carries forward')
}

// ── the final application releases retainage ──
{
  const done = P.linesFor({ sov, cos: cos1, periodTo: '2026-12-31', prior: lines2, entries: { 'sov:b': { thisPeriod: 45000.05, stored: 0 }, 'sov:c': { thisPeriod: 40000, stored: 0 }, 'co:k3': { thisPeriod: -1000, stored: 0 } } })
  const tf = P.totalsFor({ lines: done, retPct: 10, storedRetPct: 10, prevCerts: t2.earnedLessRet, cos: cos1, periodTo: '2026-12-31', prevPeriodTo: '2026-10-31', release: true })
  const held = P.totalsFor({ lines: done, retPct: 0, storedRetPct: 0, prevCerts: t2.earnedLessRet, cos: cos1, periodTo: '2026-12-31', prevPeriodTo: '2026-10-31' })
  eq([tf.completedStored, tf.retTotal, tf.earnedLessRet, tf.balanceToFinish], [161500.35, 0, 161500.35, 0], 'the final application releases retainage: nothing left to finish')
  eq(tf.currentDue, 91250.08, 'the last payment includes every dollar of retainage held')
  eq(held.retTotal, 2500, 'setting the job’s % to 0 alone leaves a line with its own 5% holding — the release switch is what lets it all go')
}

// ── history never vanishes ──
{
  const gone = P.linesFor({ sov: sov.filter((s) => s.id !== 'a'), cos: cos1, periodTo: '2026-10-31', prior: lines1, entries: {} })
  const a = gone.find((l) => l.key === 'sov:a')
  ok(a && a.prev === 10000 && /no longer on the schedule/.test(a.description), 'a line billed before stays on the application after it leaves the schedule')
}

// ── warnings ──
{
  const over = P.linesFor({ sov, cos: [], periodTo: '2026-09-30', prior: null, entries: { 'sov:a': { thisPeriod: 12000, stored: 0 } } })
  const t = P.totalsFor({ lines: over, retPct: 10, storedRetPct: 10, prevCerts: 0, cos: [], periodTo: '2026-09-30', prevPeriodTo: null })
  const w = P.appWarnings(over, t, 170000)
  ok(w.some((x) => /past its scheduled value/.test(x)), 'billing a line past 100% is called out')
  ok(w.some((x) => /adds up to/.test(x)), 'a schedule that doesn’t add up to the contract is called out')
}

// ── % complete to date → this period ──
eq(P.thisPeriodFromPct({ scheduled: 100000.10, prev: 25000.05, stored: 0 }, 55), 30000.01, '55% of 100,000.10 to date, less what was billed, to the cent')

// ── the schedule of values from the won estimate ──
{
  const s = P.sovFromSections([{ section: 'Earthwork', total: 412345.67 }, { section: 'Paving', total: 188000 }, { section: 'Zero', total: 0 }, { section: 'Storm', total: 99654.33 }], 812345.99)
  eq(s.map((x) => x.description), ['EARTHWORK', 'PAVING', 'STORM'], 'one line per priced section')
  eq(Math.round(s.reduce((a, x) => a + x.scheduled * 100, 0)), 81234599, 'the lines add up to the contract to the cent')
}

// ── reading what people type ──
eq([P.readDollars('$1,250.50'), P.readDollars('(1,250.50)'), P.readDollars('−80'), P.readDollars(''), P.readDollars('abc'), P.readDollars('-5', false)], [1250.5, -1250.5, -80, null, 'bad', 'bad'], 'dollars as sheets write them; parentheses are a credit')
ok(!!P.cleanChangeOrder({ title: 'Undercut', status: 'approved' }).error, 'an approved change order needs its approved amount')
eq(P.cleanChangeOrder({ title: 'Undercut', status: 'pricing', requested: '28,000', scheduleDays: '2' }).co?.requested, 28000, 'a change order being priced keeps its asking price')
ok(!!P.cleanSovLine({ description: 'X', scheduled: 'lots' }).error, 'a schedule line needs a value that reads')
ok(!!P.cleanEntries({ 'sov:a': { thisPeriod: 5, stored: -1 } }, ['sov:a']).error, 'stored material can’t go negative')
eq(P.cleanEntries({ 'sov:a': { thisPeriod: '1,000' }, 'sov:zz': { thisPeriod: 9 } }, ['sov:a']).entries, { 'sov:a': { thisPeriod: 1000, stored: 0 } }, 'entries only for the application’s own lines')

// ── the chain: sent applications frozen, the draft on the last sent one, a void one skipped ──
{
  const row = (id, appNo, status, periodTo, extra = {}) => ({ id, appNo, appDate: periodTo, periodTo, status, retPct: 10, storedRetPct: 10, release: false, entries: {}, lines: null, totals: null, invoiceNo: null, note: null, submittedAt: null, approvedAt: null, paidOn: null, paidAmount: null, waiver: 'none', waiverOn: null, ...extra })
  const v = P.computeApps([
    row('a1', 1, 'paid', '2026-09-30', { lines: lines1, totals: t1 }),
    row('a2', 2, 'void', '2026-10-31', { lines: lines2, totals: { ...t2, earnedLessRet: 999999 } }),
    row('a3', 3, 'draft', '2026-10-31', { entries: { 'sov:b': { thisPeriod: 30000, stored: 0 }, 'sov:c': { thisPeriod: 10000, stored: 0 } } }),
  ], sov, cos1, 160000.1)
  eq(v.map((x) => [x.appNo, x.frozen]), [[1, true], [2, true], [3, false]], 'sent and void applications stay as they were; the draft is computed')
  eq([v[2].totals.prevCerts, v[2].totals.currentDue], [40950.27, 29300], 'the draft builds on the last SENT application — the voided one is skipped')
  ok(v[2].warnings.length === 0, `a clean draft has nothing to warn about (${v[2].warnings.join(' | ')})`)
}

console.log(`\npay apps: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
