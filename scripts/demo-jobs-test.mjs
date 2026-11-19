// The demo company's sample job (lib/demo/jobs.ts) run through the real engines:
// pay apps chain and freeze, job cost rolls up, the portfolio agrees with billing,
// and a week of time cards builds with one shift flagged. Run after ANY change
// to lib/demo/jobs.ts or the engines it feeds.
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = fileURLToPath(new URL('..', import.meta.url))
const cache = new Map()
// Transpile a TS module and everything it imports (relative and '@/'), type-only imports dropped.
function load(file) {
  if (cache.has(file)) return cache.get(file)
  let js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  js = js.replace(/from '([^']+)'/g, (m, spec) => {
    if (!spec.startsWith('.') && !spec.startsWith('@/')) return m
    const base = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(file), spec)
    const f = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(existsSync)
    if (!f) throw new Error('cannot resolve ' + spec + ' from ' + file)
    return `from '${load(f)}'`
  })
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  cache.set(file, url)
  return url
}
const D = await import(load(path.join(root, 'lib/demo/jobs.ts')))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m) } }

const page = D.demoJobPage('fence-1', true)
ok(page.job?.stage === 'active' && page.job.number === '26-014', 'active job on fence-1')
ok(page.money?.contractAmount === 1_284_500, 'contract amount')
ok(page.checklist.length > 10 && page.checklist.some((c) => c.doneAt) && page.checklist.some((c) => !c.doneAt), 'checklist part done')
ok(D.demoJobPage('fence-1', false).money === null, 'no money without costs')
ok(D.demoJobPage('fence-3', true).job === null, 'the yard has no job')
ok(D.demoJobLog(true).length === 2, 'two jobs on the log')

const b = D.demoBilling('demo-job-riverfront')
ok(b.sov.reduce((s, l) => s + l.scheduled, 0) === 1_284_500, 'SOV sums to the contract')
ok(b.apps.length === 3, 'three applications')
const [a1, a2, a3] = b.apps
ok(a1.frozen && a1.status === 'paid' && a1.paidAmount === a1.totals.currentDue, 'app 1 frozen and paid in full')
ok(a2.frozen && a2.status === 'approved' && a2.paidAmount === null, 'app 2 approved, unpaid')
ok(!a3.frozen && a3.status === 'draft', 'app 3 is the draft')
ok(Math.abs(a3.totals.contractToDate - (1_284_500 + 48_750)) < 0.01, `contract to date carries the approved CO only (${a3.totals.contractToDate})`)
ok(Math.abs(a3.totals.currentDue + a3.totals.prevCerts - a3.totals.earnedLessRet) < 0.01, 'draft: due = earned less retainage − previous')
ok(a3.totals.currentDue > 0 && a3.totals.currentDue < 300_000, `draft due is sane (${a3.totals.currentDue})`)
ok(a3.warnings.length === 0, 'draft has no warnings: ' + a3.warnings.join(' | '))
const pct = a3.totals.completedStored / a3.totals.contractToDate
ok(pct > 0.4 && pct < 0.75, `job about half done (${(pct * 100).toFixed(0)}%)`)

const c = D.demoJobCost('demo-job-riverfront')
ok(c.budget.reduce((s, l) => s + l.original, 0) === 1_050_000, 'budget 1.05M')
const p = D.demoPortfolio()
ok(p.jobs.length === 2 && p.apps.length === 2 && p.wip.length === 1, 'portfolio: 2 jobs, 2 sent apps, 1 WIP row')
ok(p.wip[0].billed === a2.totals.completedStored, 'WIP billed = the last sent application')

const I = D.demoIssues('demo-job-riverfront', false)
ok(I.length === 4 && I.every((i) => i.costExposure === null), 'issues hide dollars without costs')
ok(D.demoDocuments('demo-job-riverfront').some((d) => d.expiresOn), 'a paper that expires')

// A fixed week: Mon Nov 16 – Sun Nov 22 2026 Eastern, "now" Friday 5 PM.
const tz = 'America/New_York'
const from = Date.parse('2026-11-16T05:00:00Z'), to = Date.parse('2026-11-23T05:00:00Z'), now = Date.parse('2026-11-20T22:00:00Z')
const cards = D.demoTimeCards(from, to, tz, now)
ok(cards.length === 5, `five people on the cards (${cards.length})`)
const rowsOf = (cs) => cs.flatMap((x) => x.days.flatMap((d) => d.entries ?? d.rows ?? []))
const rows = rowsOf(cards)
ok(rows.length === 25, `25 shifts Mon–Fri (${rows.length})`)
ok(rows.every((r) => r.outAt), 'all closed by Friday 5 PM')
ok(cards.reduce((n, x) => n + x.review, 0) >= 1, 'at least one shift needs a look')
ok(cards.every((x) => x.verifiedPct === null || x.verifiedPct > 50), 'GPS-verified across the crew')
ok(rows.filter((r) => r.zoneId === 'fence-2').length === 1, 'the driver on the bid site once')
ok(rowsOf(D.demoTimeCards(from, to, tz, Date.parse('2026-11-18T16:00:00Z'))).some((r) => !r.outAt), 'mid-shift = still clocked in')

console.log(`demo jobs: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
