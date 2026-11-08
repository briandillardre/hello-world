/**
 * Pay apps (migration 154) — pure: the schedule of values, change orders and
 * the application for payment in the G702 / G703 layout DCG's sheets use.
 * Shared by the billing page, the PDF, the Excel and `scripts/payapp-test.mjs`.
 *
 *   G703 (continuation sheet), per line:
 *     C scheduled value · D work completed from previous applications ·
 *     E work completed this period · F materials presently stored ·
 *     G total completed and stored to date (D + E + F) · G ÷ C ·
 *     H balance to finish (C − G) · I retainage
 *   G702 (the application):
 *     1 original contract sum · 2 net change by change orders ·
 *     3 contract sum to date · 4 total completed and stored to date ·
 *     5 retainage (a. on completed work, b. on stored material) ·
 *     6 total earned less retainage · 7 less previous certificates ·
 *     8 current payment due · 9 balance to finish, including retainage
 *
 * Money is kept in cents inside every sum (no float drift across a hundred
 * lines) and rounded to the cent on the way out.
 */

export const CO_STATUSES = ['potential', 'pricing', 'submitted', 'approved', 'rejected', 'void'] as const
export type CoStatus = (typeof CO_STATUSES)[number]
export const CO_STATUS_WORDS: Record<CoStatus, string> = {
  potential: 'Potential', pricing: 'Pricing', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', void: 'Void',
}
export const CO_TYPES = ['owner', 'field', 'design', 'scope', 'credit', 'other'] as const
export type CoType = (typeof CO_TYPES)[number]
export const CO_TYPE_WORDS: Record<CoType, string> = {
  owner: 'Owner / GC request', field: 'Field condition', design: 'Design change', scope: 'Scope gap', credit: 'Credit / deduct', other: 'Other',
}

export const APP_STATUSES = ['draft', 'submitted', 'approved', 'paid', 'void'] as const
export type AppStatus = (typeof APP_STATUSES)[number]
export const APP_STATUS_WORDS: Record<AppStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', paid: 'Paid', void: 'Void' }
/** A sent application is history: its numbers are frozen and later ones build on it. */
export const counts = (s: AppStatus) => s === 'submitted' || s === 'approved' || s === 'paid'

export interface SovLine { id: string; itemNo: string; area: string | null; description: string; scheduled: number; retPct: number | null; sort: number }
export interface ChangeOrder {
  id: string; number: number; customerNo: string | null; title: string; description: string | null; type: CoType | null; status: CoStatus
  identifiedOn: string | null; submittedOn: string | null; approvedOn: string | null
  requested: number | null; approved: number | null; costImpact: number | null; scheduleDays: number | null; note: string | null
  /** The budget cost type the cost impact lands on (job cost, 155): L M S E O. */
  costPcat?: 'L' | 'M' | 'S' | 'E' | 'O' | null
}

/** One line of an application: what it was billed against and what was billed. */
export interface AppLine {
  /** 'sov:<id>' or 'co:<id>' — the line's identity across applications. */
  key: string
  itemNo: string
  area: string | null
  description: string
  /** C */ scheduled: number
  /** D */ prev: number
  /** E */ thisPeriod: number
  /** F — the stored balance NOW (it falls as stored material goes in). */
  stored: number
  /** A line's own retainage %, or null for the job's. */
  retPct: number | null
  isCo: boolean
}

export interface AppTotals {
  originalSum: number
  coNet: number
  contractToDate: number
  completedStored: number
  retWork: number
  retStored: number
  retTotal: number
  earnedLessRet: number
  prevCerts: number
  currentDue: number
  balanceToFinish: number
  co: { priorAdd: number; priorDeduct: number; thisAdd: number; thisDeduct: number }
}

const c = (v: number) => Math.round((Number(v) || 0) * 100)
const d = (cents: number) => Math.round(cents) / 100

/**
 * G, %, H, I for one line at the given job retainage. `release` = the final
 * application releasing every dollar of retainage (lines with their own %
 * included). A line's I is shown to the cent; the application's line 5 takes
 * the % of the total once (totalsFor), as G702 does, so I's column can differ
 * from line 5 by a cent of rounding.
 */
export function lineMath(l: AppLine, retPct: number, storedRetPct: number, release = false) {
  const g = c(l.prev) + c(l.thisPeriod) + c(l.stored)
  const pct = l.scheduled !== 0 ? (g / c(l.scheduled)) * 100 : 0
  const work = c(l.prev) + c(l.thisPeriod)
  const rw = release ? 0 : Math.round((work * (l.retPct ?? retPct)) / 100)
  const rs = release ? 0 : Math.round((c(l.stored) * storedRetPct) / 100)
  return { total: d(g), pct, balance: d(c(l.scheduled) - g), retWork: d(rw), retStored: d(rs), ret: d(rw + rs) }
}

/**
 * The lines an application bills against: the schedule of values, then one
 * line per change order approved by the period's end — each carrying what
 * the applications before it billed (D) and its stored balance.
 * `prior` = the frozen lines of the last sent application, if any.
 */
export function linesFor(o: {
  sov: SovLine[]; cos: ChangeOrder[]; periodTo: string; prior: AppLine[] | null
  /** This application's own entries, kept when the lines are rebuilt. */
  entries?: Record<string, { thisPeriod: number; stored: number }>
}): AppLine[] {
  const before = new Map((o.prior ?? []).map((l) => [l.key, l]))
  const entry = (key: string, prevLine: AppLine | undefined) => ({
    // D = everything the earlier applications billed as work (their D + E).
    prev: prevLine ? d(c(prevLine.prev) + c(prevLine.thisPeriod)) : 0,
    thisPeriod: o.entries?.[key]?.thisPeriod ?? 0,
    // F carries forward until it is changed: stored material sits until it is installed.
    stored: o.entries?.[key]?.stored ?? prevLine?.stored ?? 0,
  })
  const out: AppLine[] = [...o.sov].sort((a, b) => a.sort - b.sort).map((s) => {
    const key = `sov:${s.id}`
    return { key, itemNo: s.itemNo, area: s.area, description: s.description, scheduled: s.scheduled, retPct: s.retPct, isCo: false, ...entry(key, before.get(key)) }
  })
  for (const co of approvedBy(o.cos, o.periodTo)) {
    const key = `co:${co.id}`
    out.push({ key, itemNo: `CO${co.number}`, area: null, description: co.title, scheduled: co.approved ?? 0, retPct: null, isCo: true, ...entry(key, before.get(key)) })
  }
  // A line billed before that is gone from the schedule (deleted, or its change order voided) stays — history can't vanish.
  for (const [key, l] of Array.from(before.entries())) {
    if (!out.some((x) => x.key === key) && (c(l.prev) + c(l.thisPeriod) + c(l.stored)) !== 0) out.push({ ...l, ...entry(key, l), description: `${l.description} (no longer on the schedule)` })
  }
  return out
}

/** Approved change orders whose approval falls on or before the day, by number. */
export function approvedBy(cos: ChangeOrder[], day: string): ChangeOrder[] {
  return cos.filter((x) => x.status === 'approved' && x.approved !== null && (!x.approvedOn || x.approvedOn <= day)).sort((a, b) => a.number - b.number)
}

/**
 * The G702 totals. `prevCerts` = line 6 of the last sent application (0 for
 * the first). Line 5a is the job's % of all the completed work taken once
 * (plus each line that carries its own %), 5b the stored %, of all the stored
 * material — per-line rounding drifted a cent. `release` zeroes both.
 */
export function totalsFor(o: {
  lines: AppLine[]; retPct: number; storedRetPct: number; prevCerts: number
  cos: ChangeOrder[]; periodTo: string; prevPeriodTo: string | null; release?: boolean
}): AppTotals {
  let original = 0, coNet = 0, g = 0, workJob = 0, retOwn = 0, stored = 0
  for (const l of o.lines) {
    if (l.isCo) coNet += c(l.scheduled)
    else original += c(l.scheduled)
    const work = c(l.prev) + c(l.thisPeriod)
    g += work + c(l.stored)
    stored += c(l.stored)
    if (l.retPct === null) workJob += work
    else retOwn += Math.round((work * l.retPct) / 100)
  }
  const rw = o.release ? 0 : Math.round((workJob * o.retPct) / 100) + retOwn
  const rs = o.release ? 0 : Math.round((stored * o.storedRetPct) / 100)
  const earned = g - rw - rs
  const contract = original + coNet
  const co = { priorAdd: 0, priorDeduct: 0, thisAdd: 0, thisDeduct: 0 }
  for (const x of approvedBy(o.cos, o.periodTo)) {
    const amt = c(x.approved ?? 0)
    const prior = !!(o.prevPeriodTo && x.approvedOn && x.approvedOn <= o.prevPeriodTo)
    if (amt >= 0) { if (prior) co.priorAdd += amt; else co.thisAdd += amt } else { if (prior) co.priorDeduct -= amt; else co.thisDeduct -= amt }
  }
  return {
    originalSum: d(original), coNet: d(coNet), contractToDate: d(contract), completedStored: d(g),
    retWork: d(rw), retStored: d(rs), retTotal: d(rw + rs), earnedLessRet: d(earned),
    prevCerts: d(c(o.prevCerts)), currentDue: d(earned - c(o.prevCerts)), balanceToFinish: d(contract - earned),
    co: { priorAdd: d(co.priorAdd), priorDeduct: d(co.priorDeduct), thisAdd: d(co.thisAdd), thisDeduct: d(co.thisDeduct) },
  }
}

/** What to look at before sending, in words. Nothing here blocks a draft. */
export function appWarnings(lines: AppLine[], t: AppTotals, contractAmount: number | null): string[] {
  const w: string[] = []
  for (const l of lines) {
    const g = c(l.prev) + c(l.thisPeriod) + c(l.stored)
    if (c(l.scheduled) >= 0 && g > c(l.scheduled)) w.push(`${l.itemNo} ${l.description}: billed past its scheduled value (${(g / Math.max(1, c(l.scheduled)) * 100).toFixed(1)}%).`)
    if (c(l.thisPeriod) < 0) w.push(`${l.itemNo} ${l.description}: a negative amount this period — say why in the note.`)
    if (c(l.stored) < 0) w.push(`${l.itemNo} ${l.description}: stored material can’t be negative.`)
  }
  if (contractAmount !== null && Math.abs(c(contractAmount) - c(t.originalSum)) >= 100) {
    w.push(`The schedule of values adds up to ${money(t.originalSum)}, the contract to ${money(contractAmount)}.`)
  }
  if (t.currentDue < 0) w.push('This application takes money back (current payment due is negative).')
  return w
}

/** "% complete to date" typed in → this period's dollars (what the sheet does with its % column). */
export function thisPeriodFromPct(l: Pick<AppLine, 'scheduled' | 'prev' | 'stored'>, pctToDate: number): number {
  return d(Math.round((c(l.scheduled) * pctToDate) / 100) - c(l.prev) - c(l.stored))
}

export function money(v: number): string {
  const neg = v < 0
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${neg ? '−' : ''}$${s}`
}

// ── The schedule of values from the won estimate ───────────────────────────

/**
 * The estimate's sections as schedule-of-values lines, priced to the contract:
 * each section's direct cost × (contract ÷ total direct), to the cent, with
 * the rounding on the last line so they add up to the contract exactly.
 */
export function sovFromSections(sections: { section: string; total: number }[], contract: number): { itemNo: string; description: string; scheduled: number }[] {
  const live = sections.filter((s) => s.total > 0)
  const direct = live.reduce((a, s) => a + c(s.total), 0)
  if (!live.length || direct <= 0 || !(contract > 0)) return []
  const want = c(contract)
  let used = 0
  return live.map((s, i) => {
    const v = i === live.length - 1 ? want - used : Math.round((c(s.total) * want) / direct)
    used += v
    return { itemNo: String(i + 1), description: s.section.toUpperCase(), scheduled: d(v) }
  })
}

// ── Cleaners ────────────────────────────────────────────────────────────────

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : null
}
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

/** "$1,250.50", "(1,250.50)", "-1250.5", 1250.5 → dollars; '' → null; junk → 'bad'. */
export function readDollars(v: unknown, allowNegative = true): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1e9 && (allowNegative || v >= 0) ? d(c(v)) : 'bad'
  let s = String(v).trim()
  const paren = /^\(.*\)$/.test(s)
  s = s.replace(/[()$,\s]/g, '').replace(/^−/, '-')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) return 'bad'
  const val = paren ? -Math.abs(n) : n
  if (!allowNegative && val < 0) return 'bad'
  return d(c(val))
}

export function cleanSovLine(raw: unknown): { line?: Omit<SovLine, 'id' | 'sort'>; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Nothing to save.' }
  const o = raw as Record<string, unknown>
  const description = clip(o.description, 200)
  if (!description) return { error: 'A line needs a description.' }
  const scheduled = readDollars(o.scheduled)
  if (scheduled === 'bad' || scheduled === null) return { error: `${description}: give it a scheduled value.` }
  const r = o.retPct === null || o.retPct === undefined || o.retPct === '' ? null : Number(o.retPct)
  if (r !== null && !(Number.isFinite(r) && r >= 0 && r <= 50)) return { error: `${description}: retainage runs 0–50%.` }
  return { line: { itemNo: clip(o.itemNo, 12) ?? '', area: clip(o.area, 60), description, scheduled, retPct: r } }
}

export function cleanChangeOrder(raw: unknown): { co?: Omit<ChangeOrder, 'id' | 'number'>; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Nothing to save.' }
  const o = raw as Record<string, unknown>
  const title = clip(o.title, 200)
  if (!title) return { error: 'A change order needs a title.' }
  const status = (CO_STATUSES as readonly unknown[]).includes(o.status) ? (o.status as CoStatus) : 'potential'
  const type = (CO_TYPES as readonly unknown[]).includes(o.type) ? (o.type as CoType) : null
  const requested = readDollars(o.requested), approved = readDollars(o.approved), costImpact = readDollars(o.costImpact)
  if (requested === 'bad' || approved === 'bad' || costImpact === 'bad') return { error: `${title}: a dollar amount can’t be read.` }
  const days = o.scheduleDays === null || o.scheduleDays === undefined || o.scheduleDays === '' ? null : Number(o.scheduleDays)
  if (days !== null && !(Number.isInteger(days) && Math.abs(days) <= 1000)) return { error: `${title}: schedule days are whole days.` }
  const day = (v: unknown) => (isDay(v) ? v : null)
  // Approved means a number the customer agreed to — and a day it happened.
  if (status === 'approved' && approved === null) return { error: `${title}: an approved change order needs its approved amount.` }
  return {
    co: {
      customerNo: clip(o.customerNo, 40), title, description: clip(o.description, 2000), type, status,
      identifiedOn: day(o.identifiedOn), submittedOn: day(o.submittedOn), approvedOn: status === 'approved' ? day(o.approvedOn) : day(o.approvedOn),
      requested, approved, costImpact, scheduleDays: days, note: clip(o.note, 500),
      costPcat: (['L', 'M', 'S', 'E', 'O'] as const).find((p) => p === o.costPcat) ?? null,
    },
  }
}

/** This application's entries from a device: only known lines, dollars that read, F never negative. */
export function cleanEntries(raw: unknown, keys: string[]): { entries?: Record<string, { thisPeriod: number; stored: number }>; error?: string } {
  if (!raw || typeof raw !== 'object') return { entries: {} }
  const out: Record<string, { thisPeriod: number; stored: number }> = {}
  for (const k of keys) {
    const e = (raw as Record<string, unknown>)[k]
    if (!e || typeof e !== 'object') continue
    const t = readDollars((e as Record<string, unknown>).thisPeriod)
    const s = readDollars((e as Record<string, unknown>).stored, false)
    if (t === 'bad' || s === 'bad') return { error: 'A dollar amount on a line can’t be read (stored material can’t be negative).' }
    out[k] = { thisPeriod: t ?? 0, stored: s ?? 0 }
  }
  return { entries: out }
}

// ── The chain of applications ───────────────────────────────────────────────

export interface AppRow {
  id: string; appNo: number; appDate: string; periodTo: string; status: AppStatus
  retPct: number; storedRetPct: number; release: boolean
  entries: Record<string, { thisPeriod: number; stored: number }>
  lines: AppLine[] | null; totals: AppTotals | null
  invoiceNo: string | null; note: string | null; submittedAt: string | null; approvedAt: string | null
  paidOn: string | null; paidAmount: number | null; waiver: 'none' | 'partial' | 'final'; waiverOn: string | null
}
export interface AppView extends AppRow { lines: AppLine[]; totals: AppTotals; warnings: string[]; frozen: boolean }

/**
 * Every application with its lines and G702 totals: a sent one exactly as it
 * was sent (frozen), a draft computed on the last sent application before it.
 * A voided application drops out of the chain — the next one builds on the
 * one before it.
 */
export function computeApps(rows: AppRow[], sov: SovLine[], cos: ChangeOrder[], contractAmount: number | null): AppView[] {
  const out: AppView[] = []
  let prior: { lines: AppLine[]; totals: AppTotals; periodTo: string } | null = null
  // A voided application shares its number with the resubmission — the void one first.
  for (const r of [...rows].sort((a, b) => a.appNo - b.appNo || (a.status === 'void' ? 0 : 1) - (b.status === 'void' ? 0 : 1))) {
    if (counts(r.status) && r.lines && r.totals) {
      out.push({ ...r, lines: r.lines, totals: r.totals, warnings: [], frozen: true })
      prior = { lines: r.lines, totals: r.totals, periodTo: r.periodTo }
      continue
    }
    const lines = linesFor({ sov, cos, periodTo: r.periodTo, prior: prior?.lines ?? null, entries: r.entries })
    const totals = totalsFor({ lines, retPct: r.retPct, storedRetPct: r.storedRetPct, prevCerts: prior?.totals.earnedLessRet ?? 0, cos, periodTo: r.periodTo, prevPeriodTo: prior?.periodTo ?? null, release: r.release })
    const view: AppView = { ...r, lines: r.status === 'void' && r.lines ? r.lines : lines, totals: r.status === 'void' && r.totals ? r.totals : totals, warnings: r.status === 'draft' ? appWarnings(lines, totals, contractAmount) : [], frozen: r.status === 'void' }
    if (prior && r.status === 'draft' && r.periodTo <= prior.periodTo) view.warnings.unshift('This period ends on or before the last application’s — check the dates.')
    out.push(view)
  }
  return out
}
