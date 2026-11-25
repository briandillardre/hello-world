/**
 * The demo company's jobs (no database). One ACTIVE job on Riverfront Tower
 * with everything a real one carries — the contract, the checklist, contacts,
 * a schedule of values, three change orders, three pay applications (paid,
 * approved and waiting, this month's draft), the cost budget with actuals,
 * issues and the job's papers — and a BID on Maple St Grading, so the project
 * log shows more than one stage. Time cards for this week ride the same
 * story: the crew clocked to Riverfront Tower, one shift that needs a look.
 *
 * Every date is relative to today, so the demo never goes stale. Every number
 * goes through the same engines a real job does (computeApps, rollup, wip,
 * buildTimeCards) — the demo can only show what the product computes.
 * Company and crew names are fiction (the demo is a public surface).
 */
import { dayKey } from '@/lib/dates'
import { DEFAULT_CHECKLIST, NO_MONEY, sectionsNow, type CheckItem, type Contact, type JobFields, type JobMoney, type Stage } from '@/lib/jobs/job'
import type { Job } from '@/lib/db/jobs'
import { computeApps, counts, type AppRow, type ChangeOrder, type SovLine } from '@/lib/jobs/payapp'
import { rollup, type BudgetLine, type CostEntry, type Pcat } from '@/lib/jobs/cost'
import type { Issue } from '@/lib/jobs/issues'
import type { JobDocument } from '@/lib/jobs/documents'
import { buildTimeCards, type PersonCard, type TimeCardEntry } from '@/lib/timecards'

export const DEMO_TZ = 'America/New_York'
const DAY = 86_400_000

const today = () => dayKey(Date.now(), DEMO_TZ)
/** The day `n` days before today (negative = after). */
const back = (n: number) => dayKey(Date.parse(`${today()}T12:00:00Z`) - n * DAY, 'UTC')
const iso = (day: string) => `${day}T14:00:00.000Z`

// ── People (fiction) ───────────────────────────────────────────────────────
export const DEMO_MEMBERS = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Dana Whitfield' },  // PM
  { id: '00000000-0000-4000-8000-000000000002', name: 'Luis Ortega' },     // super / crew lead
  { id: '00000000-0000-4000-8000-000000000003', name: 'Marcus Hale' },     // operator
  { id: '00000000-0000-4000-8000-000000000004', name: 'Tyler Brooks' },    // pipe layer
  { id: '00000000-0000-4000-8000-000000000005', name: 'Andre Simmons' },   // laborer
  { id: '00000000-0000-4000-8000-000000000006', name: 'Kevin Pruitt' },    // truck driver
]
const [PM, SUPER, OP, PIPE, LAB, DRIVER] = DEMO_MEMBERS

export const DEMO_ACTIVE_ZONE = 'fence-1'
export const DEMO_BID_ZONE = 'fence-2'
const JOB_A = 'demo-job-riverfront'
const JOB_B = 'demo-job-maple'

const blankFields: JobFields = {
  number: null, customer: null, customerJobNo: null, ownerName: null, contractNo: null, contractDate: null, scope: null, exclusions: null,
  projectType: null, contractType: null, billingType: null, bidDue: null, awardDate: null, ntpDate: null, startDate: null, targetCompletion: null,
  actualCompletion: null, pmId: null, superId: null, address: null, city: null, county: null, state: null, zip: null, risk: null, lostReason: null, notes: null,
}

function jobA(): Job {
  return {
    ...blankFields,
    id: JOB_A, zoneId: DEMO_ACTIVE_ZONE, stage: 'active', estimateId: null,
    createdAt: iso(back(118)), updatedAt: iso(back(1)), closedAt: null, closedBy: null, closedNote: null,
    number: '26-014', customer: 'Harbor Point Builders', customerJobNo: 'HPB-2231', ownerName: 'Riverfront Tower LLC', contractNo: 'SC-2231-04',
    contractDate: back(96), scope: 'Sitework package: erosion control, clearing, mass grading, storm drainage, water and sewer, curb and gutter, stone base. Asphalt by our paving sub.',
    exclusions: 'Rock excavation (unit price per CY if found) · undercut below 2 ft · testing · permits and fees · landscaping',
    projectType: 'Commercial', contractType: 'lump_sum', billingType: 'progress',
    bidDue: back(124), awardDate: back(100), ntpDate: back(80), startDate: back(76), targetCompletion: back(-104), actualCompletion: null,
    pmId: PM.id, superId: SUPER.id, address: '400 Riverfront Pkwy', city: 'Nashville', county: 'Davidson', state: 'TN', zip: '37201', risk: 'medium',
    lostReason: null, notes: 'Owner wants the parking deck pad by the end of next month — grading first.',
  }
}

function jobB(): Job {
  return {
    ...blankFields,
    id: JOB_B, zoneId: DEMO_BID_ZONE, stage: 'submitted', estimateId: null,
    createdAt: iso(back(20)), updatedAt: iso(back(3)), closedAt: null, closedBy: null, closedNote: null,
    number: null, customer: 'City of Franklin — Public Works', projectType: 'Municipal', contractType: 'unit_price', billingType: 'unit_price',
    bidDue: back(3), pmId: PM.id, city: 'Nashville', state: 'TN', risk: 'low',
    scope: 'Street regrade and new curb, 1,900 LF.', notes: 'Bid opening Thursday; award expected in two weeks.',
  }
}

const MONEY_A: JobMoney = { bidAmount: 1_312_000, contractAmount: 1_284_500, retainagePct: 10, storedRetainagePct: 10, bonded: true }
const MONEY_B: JobMoney = { ...NO_MONEY, bidAmount: 486_200 }

function checklistFor(job: Job): CheckItem[] {
  // Earlier sections done, the "now" sections part done — a real job mid-flight.
  const now = sectionsNow(job.stage)
  let i = 0
  return DEFAULT_CHECKLIST.map((t, k) => {
    const isNow = now.includes(t.stage)
    const earlier = !isNow && (t.stage === 'bid' || (job.stage === 'active' && (t.stage === 'won')))
    const done = earlier || (isNow && t.stage !== 'monthly' && k % 3 !== 0) || (isNow && t.stage === 'monthly' && k % 2 === 0)
    i++
    return {
      id: `${job.id}-c${i}`, stage: t.stage, text: t.text, link: t.link, required: t.required, sort: i, note: null,
      doneAt: done ? iso(back(60 - (i % 40))) : null, doneBy: done ? (i % 2 ? PM.id : SUPER.id) : null,
    }
  })
}

const CONTACTS_A: Contact[] = [
  { id: 'dc1', role: 'gc_pm', companyName: 'Harbor Point Builders', name: 'Project manager', email: null, phone: null, note: 'Pay apps due the 25th' },
  { id: 'dc2', role: 'gc_super', companyName: 'Harbor Point Builders', name: 'Superintendent', email: null, phone: null, note: null },
  { id: 'dc3', role: 'engineer', companyName: 'Cumberland Civil Engineers', name: null, email: null, phone: null, note: 'Civil engineer of record' },
  { id: 'dc4', role: 'sub', companyName: 'Volunteer Paving', name: null, email: null, phone: null, note: 'Asphalt — 2" surface' },
  { id: 'dc5', role: 'supplier', companyName: 'Palmetto Aggregates', name: null, email: null, phone: null, note: 'ABC stone, Pit 4' },
]

// ── Jobs ───────────────────────────────────────────────────────────────────

export function demoJobPage(zoneId: string, withMoney: boolean): { job: Job | null; money: JobMoney | null; checklist: CheckItem[]; contacts: Contact[]; members: typeof DEMO_MEMBERS } {
  const job = zoneId === DEMO_ACTIVE_ZONE ? jobA() : zoneId === DEMO_BID_ZONE ? jobB() : null
  if (!job) return { job: null, money: null, checklist: [], contacts: [], members: DEMO_MEMBERS }
  return {
    job,
    money: withMoney ? (job.id === JOB_A ? MONEY_A : MONEY_B) : null,
    checklist: checklistFor(job),
    contacts: job.id === JOB_A ? CONTACTS_A : [],
    members: DEMO_MEMBERS,
  }
}

export function demoJobLog(withMoney: boolean) {
  return [
    { job: jobA(), zoneName: 'Riverfront Tower', money: withMoney ? MONEY_A : null, checks: checklistFor(jobA()).map((c) => ({ stage: c.stage, done: !!c.doneAt, required: c.required })) },
    { job: jobB(), zoneName: 'Maple St Grading', money: withMoney ? MONEY_B : null, checks: checklistFor(jobB()).map((c) => ({ stage: c.stage, done: !!c.doneAt, required: c.required })) },
  ]
}

export const demoJobId = (zoneId: string) => (zoneId === DEMO_ACTIVE_ZONE ? JOB_A : zoneId === DEMO_BID_ZONE ? JOB_B : null)

// ── Billing ────────────────────────────────────────────────────────────────

const SOV: SovLine[] = [
  ['1', 'Mobilization', 38_500], ['2', 'Erosion control', 46_200], ['3', 'Clearing & grubbing', 52_800], ['4', 'Mass grading', 312_000],
  ['5', 'Storm drainage', 268_400], ['6', 'Water & sewer', 221_600], ['7', 'Curb & gutter', 118_000], ['8', 'ABC stone base', 142_000],
  ['9', 'Asphalt paving (sub)', 85_000],
].map(([no, d, v], k) => ({ id: `sov${no}`, itemNo: String(no), area: null, description: String(d), scheduled: Number(v), retPct: null, sort: k + 1 }))

function changeOrders(): ChangeOrder[] {
  return [
    { id: 'co1', number: 1, customerNo: 'PCO-03', title: 'Undercut unsuitable soils — deck pad', description: 'Geotech called 2 ft of undercut under the parking deck pad; replaced with borrow.', type: 'field', status: 'approved',
      identifiedOn: back(62), submittedOn: back(58), approvedOn: back(41), requested: 52_400, approved: 48_750, costImpact: 39_000, scheduleDays: 4, note: null, costPcat: 'E' },
    { id: 'co2', number: 2, customerNo: 'PCO-05', title: 'Added storm inlet at the drive entrance', description: null, type: 'design', status: 'submitted',
      identifiedOn: back(19), submittedOn: back(12), approvedOn: null, requested: 14_200, approved: null, costImpact: 10_900, scheduleDays: 0, note: 'Waiting on the engineer', costPcat: 'M' },
    { id: 'co3', number: 3, customerNo: null, title: 'Rock at STA 3+40 (storm line)', description: 'Hit rock on the 15" run; unit price per CY in the contract.', type: 'field', status: 'pricing',
      identifiedOn: back(1), submittedOn: null, approvedOn: null, requested: null, approved: null, costImpact: null, scheduleDays: null, note: null, costPcat: 'E' },
  ]
}

function app(appNo: number, periodTo: string, status: AppRow['status'], entries: Record<string, number>, stored: Record<string, number> = {}, paid?: { on: string; amount: number }): AppRow {
  const e: AppRow['entries'] = {}
  for (const [k, v] of Object.entries(entries)) e[k] = { thisPeriod: v, stored: 0 }
  for (const [k, v] of Object.entries(stored)) e[k] = { thisPeriod: e[k]?.thisPeriod ?? 0, stored: v }
  return {
    id: `app${appNo}`, appNo, appDate: periodTo, periodTo, status, retPct: 10, storedRetPct: 10, release: false, entries: e, lines: null, totals: null,
    invoiceNo: `26-014-${String(appNo).padStart(2, '0')}`, note: null, submittedAt: status === 'draft' ? null : iso(periodTo), approvedAt: null,
    paidOn: paid?.on ?? null, paidAmount: paid?.amount ?? null, waiver: paid ? 'partial' : 'none', waiverOn: paid?.on ?? null,
  }
}

/** The three applications, each sent one frozen exactly the way the billing page freezes it. */
export function demoBilling(jobId: string) {
  if (jobId !== JOB_A) return { available: true, sov: [], cos: [], apps: [] }
  const cos = changeOrders()
  const plan: [AppRow['status'], string, Record<string, number>, Record<string, number>][] = [
    ['paid', back(56), { 'sov:sov1': 38_500, 'sov:sov2': 34_650, 'sov:sov3': 52_800, 'sov:sov4': 93_600 }, {}],
    ['approved', back(28), { 'sov:sov2': 6_930, 'sov:sov4': 109_200, 'sov:sov5': 80_520, 'sov:sov6': 44_320, 'co:co1': 24_375 }, {}],
    ['draft', back(0), { 'sov:sov4': 46_800, 'sov:sov5': 67_100, 'sov:sov6': 55_400, 'sov:sov7': 23_600, 'co:co1': 24_375 }, { 'sov:sov8': 18_000 }],
  ]
  const rows: AppRow[] = []
  plan.forEach(([status, periodTo, entries, stored], k) => {
    const draft = app(k + 1, periodTo, 'draft', entries, stored)
    const view = computeApps([...rows, draft], SOV, cos, MONEY_A.contractAmount).at(-1)!
    if (status === 'draft') { rows.push(draft); return }
    const due = view.totals.currentDue
    rows.push({ ...draft, status, lines: view.lines, totals: view.totals, submittedAt: iso(periodTo), approvedAt: iso(back(k === 0 ? 50 : 22)),
      ...(status === 'paid' ? { paidOn: back(24), paidAmount: due, waiver: 'partial' as const, waiverOn: back(24) } : {}) })
  })
  return { available: true, sov: SOV, cos, apps: computeApps(rows, SOV, cos, MONEY_A.contractAmount) }
}

// ── Job cost ───────────────────────────────────────────────────────────────

const BUDGET: BudgetLine[] = ([
  ['01', 'Crew labor', 'L', 248_000], ['02', 'Pipe, structures, stone, fabric', 'M', 312_000], ['03', 'Paving sub', 'S', 96_000],
  ['04', 'Machines & trucking', 'E', 372_000], ['05', 'Survey, testing, misc.', 'O', 22_000],
] as [string, string, Pcat, number][]).map(([code, d, p, v], k) => ({ id: `b${k}`, costCode: code, description: d, pcat: p, original: v, sort: k }))

const ACTUALS: CostEntry[] = [
  { pcat: 'L', amount: 118_420 }, { pcat: 'M', amount: 131_880 }, { pcat: 'E', amount: 176_310 },
  { pcat: 'F', amount: 14_260 }, { pcat: 'R', amount: 3_140 }, { pcat: 'O', amount: 6_820 },
]

export function demoJobCost(jobId: string) {
  const base = {
    available: true, partial: false, from: jobId === JOB_A ? back(76) : null, budget: [] as BudgetLine[], entered: [] as {
      id: string; spentOn: string; pcat: Pcat; amount: number; vendor: string | null; reference: string | null; description: string | null; source: 'manual' | 'import'
    }[],
    coImpacts: [] as { pcat: Pcat; amount: number }[], actuals: [] as CostEntry[],
    sources: { labor: { hours: 0, dollars: 0, unpricedHours: 0, unpricedPeople: 0 }, equipment: { hours: 0, dollars: 0, machines: 0 }, receipts: { count: 0, dollars: 0 }, entered: { count: 0, dollars: 0 } },
    eac: null as number | null,
  }
  if (jobId !== JOB_A) return base
  const entered = [
    { id: 'e1', spentOn: back(44), pcat: 'M' as Pcat, amount: 61_240, vendor: 'Southern Pipe & Supply', reference: 'INV 88412', description: '15" and 24" RCP, structures', source: 'import' as const },
    { id: 'e2', spentOn: back(30), pcat: 'M' as Pcat, amount: 38_900, vendor: 'Palmetto Aggregates', reference: 'Stmt Oct', description: 'ABC stone, borrow', source: 'import' as const },
    { id: 'e3', spentOn: back(18), pcat: 'M' as Pcat, amount: 21_380, vendor: 'Southern Pipe & Supply', reference: 'INV 88957', description: 'DIP water main, fittings', source: 'import' as const },
    { id: 'e4', spentOn: back(9), pcat: 'O' as Pcat, amount: 4_600, vendor: 'Cumberland Civil Engineers', reference: '2231-07', description: 'Construction staking', source: 'manual' as const },
  ]
  return {
    ...base, budget: BUDGET, entered, coImpacts: [{ pcat: 'E' as Pcat, amount: 39_000 }], actuals: ACTUALS,
    sources: {
      labor: { hours: 2_960, dollars: 118_420, unpricedHours: 0, unpricedPeople: 0 },
      equipment: { hours: 1_412, dollars: 176_310, machines: 6 },
      receipts: { count: 23, dollars: 19_620 },
      entered: { count: entered.length, dollars: entered.reduce((s, e) => s + e.amount, 0) },
    },
  }
}

// ── Issues & papers ────────────────────────────────────────────────────────

export function demoIssues(jobId: string, money: boolean): Issue[] {
  if (jobId !== JOB_A) return []
  const m = (v: number) => (money ? v : null)
  return [
    { id: 'i1', number: 4, title: 'Rock at STA 3+40 on the storm line', category: 'site', priority: 'high', status: 'open', ownerId: SUPER.id, decisionFrom: 'Harbor Point Builders',
      dueOn: back(-2), scheduleDays: 3, detail: 'Hit rock 6 ft down; ~40 CY in the trench by the probe.', resolution: null, openedOn: back(1), resolvedOn: null, changeOrderId: 'co3', costExposure: m(9_800) },
    { id: 'i2', number: 3, title: 'Inlet added at the drive entrance — waiting on the engineer', category: 'design', priority: 'medium', status: 'waiting', ownerId: PM.id, decisionFrom: 'Cumberland Civil Engineers',
      dueOn: back(-5), scheduleDays: 0, detail: null, resolution: null, openedOn: back(19), resolvedOn: null, changeOrderId: 'co2', costExposure: m(14_200) },
    { id: 'i3', number: 2, title: 'Silt fence down after the storm — re-set before inspection', category: 'permit', priority: 'medium', status: 'open', ownerId: LAB.id, decisionFrom: null,
      dueOn: back(0), scheduleDays: null, detail: null, resolution: null, openedOn: back(2), resolvedOn: null, changeOrderId: null, costExposure: m(900) },
    { id: 'i4', number: 1, title: 'Unsuitable soils under the deck pad', category: 'site', priority: 'high', status: 'resolved', ownerId: PM.id, decisionFrom: 'Harbor Point Builders',
      dueOn: back(55), scheduleDays: 4, detail: null, resolution: 'Undercut 2 ft and replaced — CO 1 approved.', openedOn: back(62), resolvedOn: back(41), changeOrderId: 'co1', costExposure: m(48_750) },
  ]
}

export function demoDocuments(jobId: string): JobDocument[] {
  if (jobId !== JOB_A) return []
  const d = (id: string, kind: JobDocument['kind'], title: string, filename: string, docDate: string, expiresOn: string | null = null, payAppId: string | null = null): JobDocument =>
    ({ id, kind, title, docDate, expiresOn, note: null, filename, sizeBytes: 180_000 + id.length * 9_000, payAppId, createdBy: PM.id, createdAt: iso(docDate) })
  return [
    d('d1', 'contract', 'Subcontract — sitework', 'subcontract-sitework.pdf', back(96)),
    d('d2', 'bond', 'Performance & payment bond', 'bond.pdf', back(94), back(-260)),
    d('d3', 'insurance', 'Certificate of insurance (GC as additional insured)', 'coi-2026.pdf', back(95), back(-20)),
    d('d4', 'permit', 'Land disturbance permit', 'land-disturbance-permit.pdf', back(82), back(-200)),
    d('d5', 'change_order', 'CO 1 — signed', 'co-01-signed.pdf', back(41)),
    d('d6', 'lien_waiver', 'Partial waiver — application 1', 'waiver-app-01.pdf', back(24), null, 'app1'),
    d('d7', 'submittal', 'RCP pipe & structures submittal — approved', 'submittal-storm.pdf', back(70)),
    d('d8', 'inspection', 'Proof roll — deck pad, passed', 'proof-roll-deck-pad.pdf', back(38)),
  ]
}

// ── Money across jobs ──────────────────────────────────────────────────────

export function demoPortfolio() {
  const a = jobA(), b = jobB()
  const billing = demoBilling(JOB_A)
  const apps = billing.apps.filter((x) => counts(x.status)).map((x) => ({
    jobId: JOB_A, appNo: x.appNo, appDate: x.appDate, status: x.status, release: x.release, currentDue: x.totals.currentDue,
    paidAmount: x.paidAmount, paidOn: x.paidOn, contractToDate: x.totals.contractToDate, completedStored: x.totals.completedStored, retTotal: x.totals.retTotal,
  }))
  const last = apps.at(-1)!
  const cost = demoJobCost(JOB_A)
  const roll = rollup(cost.budget, cost.coImpacts, cost.actuals)
  return {
    available: true, partial: false,
    jobs: [
      { jobId: JOB_A, zoneId: a.zoneId, name: 'Riverfront Tower', number: a.number, customer: a.customer, stage: a.stage as Stage },
      { jobId: JOB_B, zoneId: b.zoneId, name: 'Maple St Grading', number: b.number, customer: b.customer, stage: b.stage as Stage },
    ],
    apps,
    wip: [{ jobId: JOB_A, contract: last.contractToDate, currentBudget: roll.total.current, costToDate: roll.total.actual, billed: last.completedStored, retainageHeld: last.retTotal, eac: null }],
    actuals: cost.actuals,
  }
}

// ── Time cards (this week) ─────────────────────────────────────────────────

/** Local wall-clock time in `tz` → epoch ms (two passes settle a DST edge). */
function localMs(day: string, h: number, m: number, tz: string): number {
  const want = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60_000
  let t = want
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)
    t += want - shown
  }
  return t
}

// Riverfront Tower in the demo's staging (west of the river) — the clock-in fixes sit on the site.
const SITE = { lat: 36.1612, lng: -86.7915 }

export function demoTimeCards(fromMs: number, toMs: number, tz: string, nowMs = Date.now()): PersonCard[] {
  const crew = [SUPER, OP, PIPE, LAB, DRIVER]
  const entries: TimeCardEntry[] = []
  for (let t = fromMs + 12 * 3_600_000; t < toMs; t += DAY) {
    const day = dayKey(t, tz)
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
    if (dow === 0 || dow === 6) continue
    crew.forEach((p, k) => {
      const inMs = localMs(day, 6, 40 + k * 4, tz)
      if (inMs > nowMs) return
      let outMs: number | null = localMs(day, 15, 35 + k * 5 + (dow === 5 ? -60 : 0), tz)
      if (outMs > nowMs) outMs = null
      const site = p === DRIVER && dow === 4 ? { id: DEMO_BID_ZONE, name: 'Maple St Grading' } : { id: DEMO_ACTIVE_ZONE, name: 'Riverfront Tower' }
      // One shift that needs a look: clocked in from home, on site 35 minutes later.
      const late = p === LAB && dow === 3
      const endMs = outMs ?? nowMs
      const fixes = Math.max(1, Math.round((endMs - inMs) / 60_000))
      entries.push({
        id: `tc-${day}-${k}`, userId: p.id, personName: p.name, category: 'work', zoneId: site.id, zoneName: site.name,
        plan: k === 2 ? 'Storm line STA 2+80 to 3+60' : '', inAt: new Date(inMs).toISOString(), outAt: outMs ? new Date(outMs).toISOString() : null,
        breakMinutes: 30, inLat: SITE.lat + (late ? 0.06 : 0.0004 * k), inLng: SITE.lng + (late ? 0.05 : 0.0003 * k), outLat: outMs ? SITE.lat : null, outLng: outMs ? SITE.lng : null,
        inPlace: late ? 'near 2210 Charlotte Pike, Nashville' : `at ${site.name}`, outPlace: outMs ? `at ${site.name}` : null, edited: null,
        gps: {
          fixes, onSite: late ? fixes - 35 : Math.round(fixes * (0.94 + (k % 3) * 0.02)),
          firstFix: new Date(inMs + 30_000).toISOString(), lastFix: new Date(endMs - 30_000).toISOString(),
          firstOnSite: new Date(inMs + (late ? 35 * 60_000 : 60_000)).toISOString(), lastOnSite: new Date(endMs - 60_000).toISOString(),
          spreadM: 420, inDistM: late ? 8_400 : 0, outDistM: outMs ? 0 : null, inAtYard: false,
        },
        deviceId: `demo-phone-${k}`, outDeviceId: outMs ? `demo-phone-${k}` : null,
      })
    })
  }
  return buildTimeCards(entries, { tz, nowMs })
}
