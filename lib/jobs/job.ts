/**
 * The job (migration 152) — pure: stages, the checklist template, the
 * cleaners every write goes through, the next job number. Shared by the job
 * page, the project log, the actions and `scripts/jobs-test.mjs`.
 *
 * One job per site, from the first bid to the final lien waiver. The stages
 * and the checklist are DCG's own (the PM Master's Project Status list and the
 * per-job PROJECT CHECKLIST), written generic — no supplier or person names.
 */

export const STAGES = [
  'estimating', 'submitted', 'awarded', 'active', 'on_hold', 'substantial', 'closeout', 'closed', 'lost', 'no_bid', 'cancelled',
] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_WORDS: Record<Stage, string> = {
  estimating: 'Estimating', submitted: 'Bid submitted', awarded: 'Awarded', active: 'Active', on_hold: 'On hold',
  substantial: 'Substantially complete', closeout: 'Financial closeout', closed: 'Closed', lost: 'Lost', no_bid: 'No bid', cancelled: 'Cancelled',
}

/** The road a job travels; the side states sit off it. */
export const MAIN_PATH: Stage[] = ['estimating', 'submitted', 'awarded', 'active', 'substantial', 'closeout', 'closed']
export const SIDE_STAGES: Stage[] = ['on_hold', 'lost', 'no_bid', 'cancelled']

/** The project log's tabs. */
export type Bucket = 'bidding' | 'won' | 'active' | 'closing' | 'closed' | 'lost'
export const BUCKETS: Bucket[] = ['bidding', 'won', 'active', 'closing', 'closed', 'lost']
export const BUCKET_WORDS: Record<Bucket, string> = {
  bidding: 'Bidding', won: 'Won · setting up', active: 'Active', closing: 'Closing out', closed: 'Closed', lost: 'Lost & no bid',
}
export function bucketOf(stage: Stage): Bucket {
  switch (stage) {
    case 'estimating': case 'submitted': return 'bidding'
    case 'awarded': return 'won'
    case 'active': case 'on_hold': return 'active'
    case 'substantial': case 'closeout': return 'closing'
    case 'closed': return 'closed'
    default: return 'lost'
  }
}

export const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v)

// ── The checklist ───────────────────────────────────────────────────────────

export const CHECK_STAGES = ['bid', 'won', 'mobilize', 'monthly', 'closeout'] as const
export type CheckStage = (typeof CHECK_STAGES)[number]
export const CHECK_WORDS: Record<CheckStage, string> = {
  bid: 'The bid', won: 'Won — set it up', mobilize: 'Mobilize', monthly: 'Every month', closeout: 'Closeout',
}
export const isCheckStage = (v: unknown): v is CheckStage => typeof v === 'string' && (CHECK_STAGES as readonly string[]).includes(v)

/** Which checklist sections are "now" at a stage (the rest stay one tap away). */
export function sectionsNow(stage: Stage): CheckStage[] {
  switch (stage) {
    case 'estimating': case 'submitted': return ['bid']
    case 'awarded': return ['won', 'mobilize']
    case 'active': case 'on_hold': return ['mobilize', 'monthly']
    case 'substantial': case 'closeout': return ['closeout']
    default: return []
  }
}

/** Where an item's work is done in the app. */
export const LINK_KEYS = [
  'log', 'folder', 'plans', 'takeoff', 'dirt', 'ground', 'estimate', 'machine', 'progress',
  'imagery', 'contract', 'contacts', 'schedule', 'punch', 'billing', 'qbo', 'logs', 'time', 'issues', 'documents',
] as const
export type LinkKey = (typeof LINK_KEYS)[number]
export const isLinkKey = (v: unknown): v is LinkKey => typeof v === 'string' && (LINK_KEYS as readonly string[]).includes(v)

export const LINK_WORDS: Record<LinkKey, string> = {
  log: 'Project log', folder: 'Folder', plans: 'Plan room', takeoff: 'Takeoff', dirt: 'Dirt takeoff', ground: 'Borings',
  estimate: 'Estimate', machine: 'Machine files', progress: 'Drone progress', imagery: 'Site photos', contract: 'Contract',
  contacts: 'Contacts', schedule: 'Milestones', punch: 'Punch list', billing: 'Pay apps', qbo: 'QuickBooks', logs: 'Daily logs', time: 'Time cards',
  issues: 'Issues & actions', documents: 'Documents',
}

/** The page an item opens, or null where there is none yet. `features` = what the viewer may open. */
export function linkHref(key: LinkKey, zoneId: string, opts: { billing?: boolean } = {}): string | null {
  const z = encodeURIComponent(zoneId)
  switch (key) {
    case 'log': return '/jobs'
    case 'folder': case 'dirt': case 'imagery': case 'schedule': case 'punch': return `/zones/${z}`
    case 'plans': return `/plans/${z}`
    case 'takeoff': return `/plans/${z}/takeoff`
    case 'ground': return `/plans/${z}/ground`
    case 'estimate': return `/plans/${z}/estimate`
    case 'machine': return `/plans/${z}/machine`
    case 'progress': return `/plans/${z}/progress`
    case 'contract': return `/jobs/${z}#contract`
    case 'contacts': return `/jobs/${z}#contacts`
    case 'billing': return opts.billing ? `/jobs/${z}/billing` : null
    case 'qbo': return '/accounting'
    case 'logs': return '/logs'
    case 'time': return '/timecards'
    case 'issues': return `/jobs/${z}/issues`
    case 'documents': return `/jobs/${z}/documents`
  }
}

export interface TemplateItem { stage: CheckStage; text: string; link: LinkKey | null; required: boolean }

const t = (stage: CheckStage, text: string, link: LinkKey | null = null, required = false): TemplateItem => ({ stage, text, link, required })

/** The checklist a company starts with — DCG's PROJECT CHECKLIST, generic. */
export const DEFAULT_CHECKLIST: TemplateItem[] = [
  t('bid', 'Make the project folder — plans, pictures, description', 'folder'),
  t('bid', 'On the project log with the bid due date', 'log'),
  t('bid', 'Questions to the GC / owner (RFQ)'),
  t('bid', 'Plans out to suppliers for pricing — precast, pipe, specialty items'),
  t('bid', 'Quantity takeoff on the sheets', 'takeoff', true),
  t('bid', 'Dirt takeoff — cut, fill, import / export', 'dirt'),
  t('bid', 'Borings and test pits read in', 'ground'),
  t('bid', 'Estimate — sources, haul, crews, margins', 'estimate', true),
  t('bid', 'Proposal reviewed, finalized, sent — the PDF filed', null, true),
  t('bid', 'Revised proposal? Keep every version (V1, V2…) and update the log'),
  t('bid', 'Time spent estimating written down'),
  t('won', 'Contract matches the final proposal — contract amount entered', 'contract', true),
  t('won', 'Same job number and customer in QuickBooks (exact name) so the crew can clock in', 'qbo', true),
  t('won', 'COIs and W-9 to the GC / owner', 'documents', true),
  t('won', 'Shop drawings and submittals from suppliers', 'documents'),
  t('won', 'CAD file from the GC / owner'),
  t('won', 'Survey control — at least 5 points around the site (northing, easting, elevation)'),
  t('won', 'CAD and control to the dealer for the machine model — price and timing', 'machine'),
  t('won', 'Issued-for-construction plans checked against the plans we priced', 'plans', true),
  t('won', 'Change-order items from the proposal gone over with the GC / owner'),
  t('won', 'Job numbers set up with the stone, asphalt and concrete suppliers'),
  t('won', 'Schedule reviewed with the GC / owner', 'schedule'),
  t('won', 'Start date and delivery plan set'),
  t('mobilize', 'Handed off to the PM, superintendent and foreman with every contact', 'contacts', true),
  t('mobilize', 'Pre-construction photos and drone flight', 'imagery'),
  t('mobilize', 'Crew and equipment on site', 'time'),
  t('monthly', 'This month’s pay app — change orders, GC portal, PDF, partial lien waiver', 'billing'),
  t('monthly', 'Schedule and punch list brought up to date', 'punch'),
  t('closeout', 'Punch list finished', 'punch', true),
  t('closeout', 'As-built and pond verification grades', 'documents'),
  t('closeout', 'Sewer, water and fire approvals', 'documents'),
  t('closeout', 'Warranty letters', 'documents'),
  t('closeout', 'Change orders reconciled and final', 'billing', true),
  t('closeout', 'Final retainage invoice', 'billing', true),
  t('closeout', 'Final lien waiver', 'billing', true),
  t('closeout', 'Post-construction photos and drone flight', 'imagery'),
]

export const MAX_TEMPLATE_ITEMS = 120

/** A template from anywhere (a device, the database) — what can't be read is dropped. */
export function cleanTemplate(raw: unknown): TemplateItem[] {
  if (!Array.isArray(raw)) return []
  const out: TemplateItem[] = []
  for (const r of raw.slice(0, MAX_TEMPLATE_ITEMS)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const text = clip(o.text, 300)
    if (!text || !isCheckStage(o.stage)) continue
    out.push({ stage: o.stage, text, link: isLinkKey(o.link) ? o.link : null, required: o.required === true })
  }
  return out
}

export interface CheckItem { id: string; stage: CheckStage; text: string; link: LinkKey | null; required: boolean; doneAt: string | null; doneBy: string | null; note: string | null; sort: number }

/** Done / total over the given sections, and the required items still open. */
export function progressOf(items: CheckItem[], sections: CheckStage[]): { done: number; total: number; requiredOpen: number } {
  const its = items.filter((i) => sections.includes(i.stage))
  return {
    done: its.filter((i) => i.doneAt).length,
    total: its.length,
    requiredOpen: its.filter((i) => i.required && !i.doneAt).length,
  }
}

/** "Ready to start" = every required item of the won section done (DCG's Setup Readiness). */
export function readyToStart(items: CheckItem[]): boolean {
  return progressOf(items, ['won']).requiredOpen === 0
}

// ── The job's fields ────────────────────────────────────────────────────────

export const CONTRACT_TYPES = ['lump_sum', 'unit_price', 'tm', 'internal'] as const
export const BILLING_TYPES = ['progress', 'unit_price', 'tm', 'milestone'] as const
export const RISKS = ['low', 'medium', 'high', 'critical'] as const
export const CONTRACT_TYPE_WORDS: Record<(typeof CONTRACT_TYPES)[number], string> = { lump_sum: 'Lump sum', unit_price: 'Unit price', tm: 'Time & material', internal: 'Internal' }
export const BILLING_TYPE_WORDS: Record<(typeof BILLING_TYPES)[number], string> = { progress: 'Progress billing (pay apps)', unit_price: 'Unit price', tm: 'T&M', milestone: 'Milestone' }
export const PROJECT_TYPES = ['Grading', 'Utilities', 'Paving', 'Concrete', 'Site development', 'Mixed scope', 'Landscaping', 'Overhead']

export interface JobFields {
  number: string | null
  customer: string | null
  customerJobNo: string | null
  ownerName: string | null
  contractNo: string | null
  contractDate: string | null
  scope: string | null
  exclusions: string | null
  projectType: string | null
  contractType: (typeof CONTRACT_TYPES)[number] | null
  billingType: (typeof BILLING_TYPES)[number] | null
  bidDue: string | null
  awardDate: string | null
  ntpDate: string | null
  startDate: string | null
  targetCompletion: string | null
  actualCompletion: string | null
  pmId: string | null
  superId: string | null
  address: string | null
  city: string | null
  county: string | null
  state: string | null
  zip: string | null
  risk: (typeof RISKS)[number] | null
  lostReason: string | null
  notes: string | null
}

/** camelCase field → its column. */
export const JOB_COLUMNS: Record<keyof JobFields, string> = {
  number: 'number', customer: 'customer', customerJobNo: 'customer_job_no', ownerName: 'owner_name', contractNo: 'contract_no',
  contractDate: 'contract_date', scope: 'scope', exclusions: 'exclusions', projectType: 'project_type', contractType: 'contract_type',
  billingType: 'billing_type', bidDue: 'bid_due', awardDate: 'award_date', ntpDate: 'ntp_date', startDate: 'start_date',
  targetCompletion: 'target_completion', actualCompletion: 'actual_completion', pmId: 'pm_id', superId: 'super_id',
  address: 'address', city: 'city', county: 'county', state: 'state', zip: 'zip', risk: 'risk', lostReason: 'lost_reason', notes: 'notes',
}

const TEXT_CAPS: Partial<Record<keyof JobFields, number>> = {
  number: 20, customer: 120, customerJobNo: 60, ownerName: 120, contractNo: 60, scope: 1000, exclusions: 2000, projectType: 40,
  address: 200, city: 80, county: 80, state: 40, zip: 12, lostReason: 300, notes: 4000,
}
const DATE_FIELDS: (keyof JobFields)[] = ['contractDate', 'bidDue', 'awardDate', 'ntpDate', 'startDate', 'targetCompletion', 'actualCompletion']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : null
}

/** A calendar day, "2026-11-08", that really exists. */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1990-01-01' && v <= '2100-12-31'
}

/**
 * A patch from a device: only the fields named, each cleaned. A field sent as
 * '' or null clears it; one that can't be read is an error (never a silent
 * wrong value).
 */
export function cleanJobPatch(raw: unknown): { patch: Partial<JobFields>; error?: string } {
  if (!raw || typeof raw !== 'object') return { patch: {}, error: 'Nothing to save.' }
  const o = raw as Record<string, unknown>
  const patch: Partial<JobFields> = {}
  for (const k of Object.keys(JOB_COLUMNS) as (keyof JobFields)[]) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) continue
    const v = o[k]
    const empty = v === null || v === undefined || (typeof v === 'string' && !v.trim())
    if (empty) { (patch as Record<string, unknown>)[k] = null; continue }
    if (DATE_FIELDS.includes(k)) {
      if (!isDay(v)) return { patch: {}, error: 'A date there isn’t a real date.' }
      ;(patch as Record<string, unknown>)[k] = v
    } else if (k === 'pmId' || k === 'superId') {
      if (typeof v !== 'string' || !UUID.test(v)) return { patch: {}, error: 'Pick someone from the team.' }
      patch[k] = v.toLowerCase()
    } else if (k === 'contractType') {
      if (!(CONTRACT_TYPES as readonly unknown[]).includes(v)) return { patch: {}, error: 'Unknown contract type.' }
      patch.contractType = v as JobFields['contractType']
    } else if (k === 'billingType') {
      if (!(BILLING_TYPES as readonly unknown[]).includes(v)) return { patch: {}, error: 'Unknown billing type.' }
      patch.billingType = v as JobFields['billingType']
    } else if (k === 'risk') {
      if (!(RISKS as readonly unknown[]).includes(v)) return { patch: {}, error: 'Unknown risk level.' }
      patch.risk = v as JobFields['risk']
    } else {
      const s = clip(v, TEXT_CAPS[k] ?? 200)
      ;(patch as Record<string, unknown>)[k] = s
    }
  }
  return { patch }
}

/** The dates a stage move fills in when they are still blank (never overwrites one typed in). */
export function datesOnMove(to: Stage, cur: Pick<JobFields, 'awardDate' | 'startDate' | 'actualCompletion'>, today: string): Partial<JobFields> {
  const out: Partial<JobFields> = {}
  if ((to === 'awarded' || to === 'active') && !cur.awardDate) out.awardDate = today
  if (to === 'active' && !cur.startDate) out.startDate = today
  if ((to === 'substantial' || to === 'closeout' || to === 'closed') && !cur.actualCompletion) out.actualCompletion = today
  return out
}

/**
 * The next job number: "YY-NNN" one past the highest this year has used
 * (DCG's convention — the number is the front of the zone name, the folder
 * and the QuickBooks customer). Codes from other years don't count.
 */
export function nextJobNumber(codes: (string | null | undefined)[], year: number): string {
  const yy = String(year % 100).padStart(2, '0')
  let max = 0
  for (const c of codes) {
    const m = typeof c === 'string' ? c.trim().match(/^Z?(\d{2})-(\d{3})\b/i) : null
    if (m && m[1] === yy) max = Math.max(max, Number(m[2]))
  }
  return `${yy}-${String(Math.min(999, max + 1)).padStart(3, '0')}`
}

// ── Money ───────────────────────────────────────────────────────────────────

export interface JobMoney { bidAmount: number | null; contractAmount: number | null; retainagePct: number; storedRetainagePct: number; bonded: boolean }
export const NO_MONEY: JobMoney = { bidAmount: null, contractAmount: null, retainagePct: 10, storedRetainagePct: 10, bonded: false }

/** "$703,955.34" / "703955.34" / 703955.34 → the number; '' → null; anything else → 'bad'. */
export function readMoney(v: unknown): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 1e9) return 'bad'
  return Math.round(n * 100) / 100
}

export function cleanMoney(raw: unknown): { money?: JobMoney; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Nothing to save.' }
  const o = raw as Record<string, unknown>
  const bid = readMoney(o.bidAmount)
  const contract = readMoney(o.contractAmount)
  if (bid === 'bad' || contract === 'bad') return { error: 'A dollar amount there can’t be read.' }
  const pct = (v: unknown, d: number) => {
    if (v === null || v === undefined || v === '') return d
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= 50 ? Math.round(n * 100) / 100 : NaN
  }
  const ret = pct(o.retainagePct, 10)
  const stored = pct(o.storedRetainagePct, ret)
  if (Number.isNaN(ret) || Number.isNaN(stored)) return { error: 'Retainage runs 0–50%.' }
  return { money: { bidAmount: bid, contractAmount: contract, retainagePct: ret, storedRetainagePct: stored, bonded: o.bonded === true } }
}

// ── Contacts ────────────────────────────────────────────────────────────────

export const CONTACT_ROLES = ['owner', 'gc_pm', 'gc_super', 'billing', 'engineer', 'architect', 'surveyor', 'inspector', 'utility', 'sub', 'supplier', 'other'] as const
export type ContactRole = (typeof CONTACT_ROLES)[number]
export const CONTACT_WORDS: Record<ContactRole, string> = {
  owner: 'Owner / client', gc_pm: 'GC project manager', gc_super: 'GC superintendent', billing: 'Billing contact', engineer: 'Engineer',
  architect: 'Architect', surveyor: 'Surveyor', inspector: 'Inspector', utility: 'Utility', sub: 'Subcontractor', supplier: 'Supplier', other: 'Other',
}
export interface Contact { id: string; role: ContactRole; companyName: string | null; name: string | null; email: string | null; phone: string | null; note: string | null }

export function cleanContact(raw: unknown): { contact?: Omit<Contact, 'id'>; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Nothing to save.' }
  const o = raw as Record<string, unknown>
  if (!(CONTACT_ROLES as readonly unknown[]).includes(o.role)) return { error: 'Pick what they do on the job.' }
  const c = {
    role: o.role as ContactRole, companyName: clip(o.companyName, 120), name: clip(o.name, 120),
    email: clip(o.email, 200), phone: clip(o.phone, 40), note: clip(o.note, 300),
  }
  if (!c.companyName && !c.name) return { error: 'A company or a name, at least.' }
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return { error: 'That email doesn’t look right.' }
  return { contact: c }
}
