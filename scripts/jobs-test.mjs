// node scripts/jobs-test.mjs — the job (lib/jobs/job.ts, migration 152).
// Run it after ANY change to the stages, the checklist template or the cleaners.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/jobs/job.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const J = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

// ── job numbers: DCG's YY-NNN at the front of the zone name ──
eq(J.nextJobNumber(['26-083 Pond', 'Z26-084 Haywood', '25-099 Old', null, 'Creekside'], 2026), '26-085', 'one past the highest this year, completed (Z) ones included')
eq(J.nextJobNumber(['25-057 Clinic'], 2026), '26-001', 'a new year starts at 001')
eq(J.nextJobNumber(['26-009'], 2026), '26-010', 'three digits, zero-padded')

// ── stages ──
eq(J.MAIN_PATH, ['estimating', 'submitted', 'awarded', 'active', 'substantial', 'closeout', 'closed'], 'the road from the bid to closed')
eq(['estimating', 'awarded', 'on_hold', 'closeout', 'closed', 'no_bid'].map(J.bucketOf), ['bidding', 'won', 'active', 'closing', 'closed', 'lost'], 'every stage sits in one tab of the log')
eq(J.sectionsNow('submitted'), ['bid'], 'a bid out: the bid checklist')
eq(J.sectionsNow('awarded'), ['won', 'mobilize'], 'won: set-up and mobilize')
eq(J.sectionsNow('active'), ['mobilize', 'monthly'], 'active: what is left of mobilizing, and the monthly round')
eq(J.sectionsNow('lost'), [], 'a lost bid has nothing next')
ok(J.STAGES.every((s) => J.STAGE_WORDS[s]), 'every stage has words')

// ── dates a move fills in (never over a typed one) ──
eq(J.datesOnMove('awarded', { awardDate: null, startDate: null, actualCompletion: null }, '2026-11-08'), { awardDate: '2026-11-08' }, 'won today: awarded today')
eq(J.datesOnMove('active', { awardDate: '2026-10-01', startDate: null, actualCompletion: null }, '2026-11-08'), { startDate: '2026-11-08' }, 'started: a typed award date stands')
eq(J.datesOnMove('closed', { awardDate: '2026-10-01', startDate: '2026-10-05', actualCompletion: '2026-11-01' }, '2026-11-08'), {}, 'nothing typed is ever overwritten')

// ── the patch cleaner ──
{
  const r = J.cleanJobPatch({ customer: '  A GC  ', bidDue: '2026-11-20', pmId: 'AAAAAAAA-0000-4000-8000-000000000001', scope: 'x'.repeat(2000), unknown: 'dropped', notes: '' })
  eq([r.patch.customer, r.patch.bidDue, r.patch.pmId, r.patch.scope.length, 'unknown' in r.patch, r.patch.notes], ['A GC', '2026-11-20', 'aaaaaaaa-0000-4000-8000-000000000001', 1000, false, null], 'trimmed, capped, lower-cased ids, unknown keys dropped, blank clears')
  ok(!!J.cleanJobPatch({ bidDue: '2026-02-30' }).error, 'a day that does not exist is refused')
  ok(!!J.cleanJobPatch({ contractType: 'cost_plus' }).error, 'an unknown contract type is refused')
  ok(!!J.cleanJobPatch({ superId: 'not-a-uuid' }).error, 'a person must be an id')
  ok(!J.cleanJobPatch({ customer: 'A\u0000B' }).error && J.cleanJobPatch({ customer: 'A\u0000B' }).patch.customer === 'AB', 'control characters stripped')
}

// ── money ──
eq(J.cleanMoney({ bidAmount: '$703,955.34', contractAmount: '', retainagePct: '10', bonded: true }).money, { bidAmount: 703955.34, contractAmount: null, retainagePct: 10, storedRetainagePct: 10, bonded: true }, 'dollars read the way the sheet writes them; stored retainage follows the work retainage')
ok(!!J.cleanMoney({ retainagePct: 75 }).error, 'retainage past 50% is refused')
ok(!!J.cleanMoney({ contractAmount: 'lots' }).error, 'a dollar amount that can’t be read is refused, never zero')

// ── contacts ──
ok(!!J.cleanContact({ role: 'gc_pm' }).error, 'a contact needs a company or a name')
ok(!!J.cleanContact({ role: 'gc_pm', name: 'PM', email: 'not an email' }).error, 'a bad email is refused')
ok(!!J.cleanContact({ role: 'boss', name: 'X' }).error, 'an unknown role is refused')
eq(J.cleanContact({ role: 'surveyor', companyName: ' Survey Co ', phone: '864-555-0100' }).contact?.companyName, 'Survey Co', 'a company alone is enough')

// ── the checklist ──
{
  const T = J.DEFAULT_CHECKLIST
  ok(J.CHECK_STAGES.every((st) => T.some((t) => t.stage === st)), 'the built-in checklist covers every section')
  ok(T.every((t) => !t.link || J.LINK_KEYS.includes(t.link)), 'every built-in link goes somewhere real')
  ok(!T.some((t) => /@|\b\d{3}[-.]\d{3}[-.]\d{4}\b/.test(t.text)), 'no email addresses or phone numbers in the built-in checklist')
  eq(J.cleanTemplate([{ stage: 'bid', text: ' Takeoff ', link: 'takeoff', required: true }, { stage: 'nope', text: 'x' }, { stage: 'won', text: '' }, { stage: 'won', text: 'COIs', link: 'mars' }]),
    [{ stage: 'bid', text: 'Takeoff', link: 'takeoff', required: true }, { stage: 'won', text: 'COIs', link: null, required: false }], 'template cleaning: bad sections and blanks dropped, unknown links nulled')
  const items = [
    { id: '1', stage: 'won', text: 'a', link: null, required: true, doneAt: 'x', doneBy: null, note: null, sort: 0 },
    { id: '2', stage: 'won', text: 'b', link: null, required: true, doneAt: null, doneBy: null, note: null, sort: 1 },
    { id: '3', stage: 'won', text: 'c', link: null, required: false, doneAt: null, doneBy: null, note: null, sort: 2 },
    { id: '4', stage: 'bid', text: 'd', link: null, required: true, doneAt: null, doneBy: null, note: null, sort: 3 },
  ]
  eq(J.progressOf(items, ['won']), { done: 1, total: 3, requiredOpen: 1 }, 'progress over the sections that are now')
  ok(!J.readyToStart(items), 'not ready to start while a must-do of the set-up is open')
  ok(J.readyToStart(items.map((i) => (i.id === '2' ? { ...i, doneAt: 'y' } : i))), '…ready once every must-do is done (optional ones don’t hold it up)')
}

// ── links ──
eq(J.linkHref('takeoff', 'z1'), '/plans/z1/takeoff', 'items open the page the work is done on')
eq(J.linkHref('billing', 'z1'), null, 'no link to a page that isn’t there yet')
eq(J.linkHref('billing', 'z1', { billing: true }), '/jobs/z1/billing', '…and one once it is')

console.log(`\njobs: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
