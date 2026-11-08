// node scripts/closeout-test.mjs — issues & actions, the job's documents and
// closeout that checks itself (lib/jobs/issues.ts, documents.ts, closeout.ts;
// migration 156). Run it after ANY change to those three. Every figure here is made up.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const transpile = (path, map = {}) => {
  let js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  for (const [k, v] of Object.entries(map)) js = js.split(`'${k}'`).join(`'${v}'`)
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
}
const I = await import(transpile('../lib/jobs/issues.ts'))
const D = await import(transpile('../lib/jobs/documents.ts'))
const C = await import(transpile('../lib/jobs/closeout.ts', { './payapp': transpile('../lib/jobs/payapp.ts') }))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
const today = '2026-11-08'

// ── issues: the form ──
{
  const base = { title: '  Rock at the  outfall ', category: 'site', priority: 'high', status: 'open', dueOn: '2026-11-12', scheduleDays: '4', costExposure: '$12,500.00' }
  const a = I.cleanIssue(base, { money: true })
  eq([a.issue?.title, a.issue?.priority, a.issue?.scheduleDays, a.issue?.costExposure], ['Rock at the outfall', 'high', 4, 12500], 'an issue reads: title tidied, days a number, dollars read')
  const b = I.cleanIssue(base, { money: false })
  ok(b.issue && !('costExposure' in b.issue), 'without costs the dollars are never written (left as stored)')
  eq(I.cleanIssue({ ...base, title: ' ' }, { money: true }).error, 'Give it a title.', 'a title is required')
  eq(I.cleanIssue({ ...base, category: 'gossip' }, { money: true }).error, 'Pick what kind of issue it is.', 'the category must be one of the list')
  eq(I.cleanIssue({ ...base, scheduleDays: '2.5' }, { money: true }).error, 'Schedule days must be a whole number, up to 1,000.', 'schedule days are whole')
  eq(I.cleanIssue({ ...base, dueOn: '2026-02-30' }, { money: true }).error, 'That due date can’t be read.', 'a day that does not exist is refused')
  eq(I.cleanIssue({ ...base, costExposure: '(4,000)' }, { money: true }).issue?.costExposure, -4000, 'a saving in parentheses is negative')
  eq(I.cleanIssue({ ...base, costExposure: '' }, { money: true }).issue?.costExposure, null, 'a blank amount clears it')
  eq(I.cleanIssue({ ...base, costExposure: 'lots' }, { money: true }).error, 'That dollar amount can’t be read.', 'words are not dollars')
  const odd = I.cleanIssue({ ...base, ownerId: 'not-a-uuid', priority: 'urgent!!', status: 'nope' }, { money: true }).issue
  eq([odd.ownerId, odd.priority, odd.status], [null, 'medium', 'open'], 'unknown owner / priority / status fall back')
}

// ── issues: the order on the page ──
{
  const mk = (number, status, priority, dueOn, resolvedOn = null) => ({ number, status, priority, dueOn, resolvedOn, costExposure: number * 1000 })
  const list = [mk(1, 'resolved', 'high', null, '2026-10-01'), mk(2, 'open', 'low', '2026-11-01'), mk(3, 'open', 'high', '2026-12-01'), mk(4, 'waiting', 'high', '2026-11-02'), mk(5, 'resolved', 'low', null, '2026-11-05'), mk(6, 'open', 'medium', null)]
  eq(I.sortIssues(list, today).map((i) => i.number), [4, 3, 6, 2, 5, 1], 'high first (overdue first within it), then medium, low; the resolved last, newest first')
  ok(I.isOverdue(mk(2, 'open', 'low', '2026-11-01'), today) && !I.isOverdue(mk(9, 'resolved', 'low', '2026-11-01'), today), 'a resolved issue is never late')
  const s = I.issueSummary(list, today, true)
  eq([s.open, s.waiting, s.overdue, s.high, s.exposure], [3, 1, 2, 2, 15000], 'the job page line: open 3, waiting 1, late 2, high 2, $15,000 exposure on the live ones')
  eq(I.issueSummary(list, today, false).exposure, null, 'no dollars without costs')
  const co = I.changeOrderFromIssue({ number: 7, title: 'Extra undercut', detail: 'Unsuitable at pad B', scheduleDays: 3, costExposure: 8200 }, today)
  eq([co.title, co.description, co.status, co.costImpact, co.scheduleDays, co.identifiedOn], ['Extra undercut', 'From issue I-7. Unsuitable at pad B', 'potential', 8200, 3, today], 'an issue becomes a potential change order with its words, cost and days')
  eq([I.changeOrderFromIssue({ number: 8, title: 't', detail: null, scheduleDays: 2400, costExposure: null }, today).scheduleDays, I.changeOrderFromIssue({ number: 9, title: 't', detail: null, scheduleDays: -1500, costExposure: null }, today).scheduleDays], [1000, -1000], 'a change order takes ±1,000 days — an older issue with more is clamped, never refused')
  eq(I.cleanIssue({ title: 'x', category: 'site', scheduleDays: '1200' }, { money: false }).error, 'Schedule days must be a whole number, up to 1,000.', 'new issues keep to the change orders’ limit')
}

// ── documents ──
{
  eq(['COI - Acme 2026.pdf', 'W9_signed.pdf', 'Conditional lien waiver #3.pdf', 'Grading permit.pdf', 'CO-04 pipe reroute.pdf', 'G702 app 5.pdf', 'Subcontract agreement.pdf', 'Shop drawings - inlets.pdf', 'RFI 12.pdf', 'Proctor results.pdf', 'Warranty letter.pdf', 'As-built survey.dwg', 'Toolbox talk.pdf', 'Notice of delay.docx', 'photo.jpg'].map(D.kindFromName),
    ['insurance', 'w9', 'lien_waiver', 'permit', 'change_order', 'invoice', 'contract', 'submittal', 'rfi', 'inspection', 'warranty', 'asbuilt', 'safety', 'correspondence', 'other'], 'a first guess at the type from the file name')
  eq(D.COSTS_ONLY_KINDS.slice().sort(), ['bond', 'change_order', 'contract', 'invoice', 'lien_waiver', 'w9'], 'the money papers (keep in step with 156’s CHECK)')
  const sql = readFileSync(new URL('../supabase/migrations/156_job_issues_documents_closeout.sql', import.meta.url), 'utf8')
  const m = sql.match(/costs_only = \(kind IN \(([^)]*)\)\)/)
  eq(m ? m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort() : null, D.COSTS_ONLY_KINDS.slice().sort(), 'the database CHECK names the same money papers')
  const kinds = sql.match(/kind\s+TEXT NOT NULL CHECK \(kind IN \(([\s\S]*?)\)\)/)
  eq(kinds ? kinds[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort() : null, D.DOC_KINDS.slice().sort(), 'the database knows every type the app files')
  eq(D.cleanDocMeta({ kind: 'lien_waiver', title: 'Waiver 3' }, { money: false }).error, 'Lien waivers are for logins that can see costs.', 'a money paper needs costs')
  const a = D.cleanDocMeta({ kind: 'permit', title: '', expiresOn: '2027-01-31', payAppId: '11111111-1111-1111-1111-111111111111' }, { money: false, filename: 'Land disturbance permit.pdf' })
  eq([a.meta?.title, a.meta?.expiresOn, a.meta?.payAppId], ['Land disturbance permit', '2027-01-31', null], 'a blank title takes the file name; a permit keeps its expiry; only waivers and invoices point at an application')
  eq(D.cleanDocMeta({ kind: 'rfi', title: 'RFI 3', expiresOn: '2027-01-31' }, { money: false }).meta?.expiresOn, null, 'an RFI does not run out')
  eq(D.cleanDocMeta({ kind: 'lien_waiver', title: 'W', payAppId: '11111111-1111-1111-1111-111111111111' }, { money: true }).meta?.payAppId, '11111111-1111-1111-1111-111111111111', 'a lien waiver points at its application')
  eq(D.cleanDocMeta({ title: 'x' }, { money: true, filename: 'COI.pdf' }).meta?.kind, 'insurance', 'no type sent → the guess from the name')
  eq([D.expiryState('2026-11-01', today), D.expiryState('2026-11-08', today), D.expiryState('2026-12-08', today), D.expiryState('2026-12-09', today), D.expiryState(null, today)], ['expired', 'soon', 'soon', 'ok', null], 'expired · within 30 days · fine')
  eq([D.expiryWords('2026-11-05', today), D.expiryWords(today, today), D.expiryWords('2026-11-09', today)], ['Expired 3 days ago', 'Expires today', 'Expires in 1 day'], 'expiry in words')
  eq(D.expiring([{ id: 'a', expiresOn: '2027-06-01' }, { id: 'b', expiresOn: '2026-11-20' }, { id: 'c', expiresOn: null }, { id: 'd', expiresOn: '2026-10-01' }], today).map((d) => d.id), ['d', 'b'], 'the job page warns about run-out papers, soonest first')
  eq([D.sizeWords(1536), D.sizeWords(3 * 1024 * 1024 + 200000)], ['2 KB', '3.2 MB'], 'sizes in words')
}

// ── closeout ──
{
  const clean = {
    punchOpen: 0, mustDos: [], cosPending: [], issuesOpen: [], clockedIn: 0, machinesOnSite: 0,
    apps: [
      { appNo: 1, status: 'paid', release: false, currentDue: 90000, paidAmount: 90000, waiver: 'partial' },
      { appNo: 2, status: 'paid', release: true, currentDue: 30500, paidAmount: null, waiver: 'final' },
    ],
  }
  const r = C.closeoutChecks(clean, { money: true })
  ok(r.ready && r.blocking.length === 0, 'everything settled, paid and waived → ready to close')
  ok(r.checks.find((c) => c.key === 'charging').ok, 'nothing still charging')

  const open = {
    punchOpen: 3, mustDos: ['Final lien waiver', 'Warranty letters', 'As-built grades', 'Sewer approval'],
    cosPending: [{ number: 4, title: 'Reroute' }], issuesOpen: [{ number: 2, title: 'x' }, { number: 5, title: 'y' }],
    clockedIn: 1, machinesOnSite: 2,
    apps: [
      { appNo: 1, status: 'paid', release: false, currentDue: 90000, paidAmount: 90000, waiver: 'partial' },
      { appNo: 2, status: 'approved', release: false, currentDue: 45000.5, paidAmount: 40000, waiver: 'partial' },
      { appNo: 3, status: 'void', release: true, currentDue: 1, paidAmount: null, waiver: 'final' },
      { appNo: 4, status: 'draft', release: true, currentDue: 1, paidAmount: null, waiver: 'final' },
    ],
  }
  const o = C.closeoutChecks(open, { money: true })
  eq(o.blocking.map((c) => c.key), ['punch', 'mustdos', 'cos', 'issues', 'final', 'paid', 'waiver'], 'every open thing blocks, in the order a PM works them')
  eq(o.checks.find((c) => c.key === 'charging').level, 'warn', 'something still charging the job warns, never blocks')
  eq(o.checks.find((c) => c.key === 'punch').detail, '3 items still open', 'punch in words')
  eq(o.checks.find((c) => c.key === 'mustdos').detail, 'Still to do: Final lien waiver, Warranty letters, As-built grades and 1 more', 'must-dos listed, three at most')
  eq(o.checks.find((c) => c.key === 'paid').detail, '$5,000.50 still owed on #2', 'a short pay is owed to the cent; void and draft applications are not sent')
  eq(C.closeoutChecks(open, { money: false }).checks.find((c) => c.key === 'paid').detail, 'Not paid in full: #2', 'no dollars without costs')
  eq(o.checks.find((c) => c.key === 'final').detail, 'No application marked final yet', 'a void or draft final is not the final')
  eq(o.checks.find((c) => c.key === 'charging').detail, '1 person clocked in to the site · 2 machines on the site in the last 3 days', 'what is still charging, in words')
  ok(C.blockWords(o.blocking).startsWith('Punch list finished — 3 items still open · Closeout must-dos'), 'a refused close says what is open')

  const noBilling = { ...clean, apps: [] }
  eq(C.closeoutChecks(noBilling, { money: true }).checks.find((c) => c.key === 'final').detail, 'No application sent from Pay apps', 'a job billed outside Pay apps is told so (a Manager can close it with a reason)')
  const tm = C.closeoutChecks({ ...clean, apps: [], billedOutside: true }, { money: true })
  ok(tm.ready, 'a T&M / unit-price / internal job with no pay apps can close — its final invoice and waiver are checked where it is billed')
  eq(tm.checks.filter((c) => c.key === 'final' || c.key === 'waiver').map((c) => c.level), ['warn', 'warn'], '…as warnings, never silently dropped')
  eq(C.closeoutChecks({ ...clean, apps: [{ ...clean.apps[0] }], billedOutside: true }, { money: true }).blocking.map((c) => c.key), ['final', 'waiver'], 'once it bills through Pay apps, Pay apps decide')
  const waiverMissing = { ...clean, apps: [{ ...clean.apps[0] }, { ...clean.apps[1], waiver: 'partial' }] }
  eq(C.closeoutChecks(waiverMissing, { money: true }).blocking.map((c) => c.detail), ['Not marked on application #2'], 'the final waiver is read off the final application')
  eq([C.owedCents({ status: 'paid', currentDue: 100, paidAmount: null }), C.owedCents({ status: 'submitted', currentDue: 100.1, paidAmount: 100 }), C.owedCents({ status: 'approved', currentDue: 50, paidAmount: 80 })], [0, 10, 0], 'owed: marked paid = settled, a short pay to the cent, an overpay owes nothing')
  eq([C.cleanCloseNote('  Retainage written off   per owner  '), C.cleanCloseNote(''), C.cleanCloseNote(5)], ['Retainage written off per owner', null, null], 'a Manager’s reason, tidied')
}

console.log(`closeout: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
