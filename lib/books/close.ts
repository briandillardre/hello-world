/**
 * The month-end close — "books closed by the 10th" (migration 167). PURE;
 * harness scripts/books-test.mjs. A month's close is due on the 10th of the
 * month after it, signed by the owner, the bookkeeper or the CPA once every
 * step is ticked. Dates are calendar days ('YYYY-MM-DD') in the company's
 * time zone; a sign-off time is read in that zone (9 PM on the 10th in
 * Greenville is the 11th in UTC and still on time).
 */

export interface CloseStep { key: string; words: string; why: string }

export const CLOSE_STEPS: CloseStep[] = [
  { key: 'bank_reconciled', words: 'Every bank account reconciled to its statement', why: 'Cash is the one number that can be proven. If it doesn’t match the bank, nothing below it can be trusted.' },
  { key: 'cards_reconciled', words: 'Credit cards reconciled to their statements', why: 'Card charges are where fuel, parts and personal spending hide.' },
  { key: 'uncategorized_cleared', words: 'Receipts attached and nothing left uncategorized', why: 'Money in a catch-all account makes the profit a guess — and an audit asks for the receipt.' },
  { key: 'invoices_entered', words: 'Customer invoices and pay apps entered', why: 'Revenue is what you billed, not what hit the bank this month.' },
  { key: 'bills_entered', words: 'Supplier bills entered', why: 'A missing quarry or rental bill makes the month look better than it was.' },
  { key: 'payroll_posted', words: 'Payroll posted', why: 'Labor is the biggest cost on most jobs; a missed run moves the margin by points.' },
  { key: 'job_costs_coded', words: 'Job costs coded to their jobs', why: 'Without it there is no job profit — only a company total.' },
  { key: 'wip_adjusted', words: 'Over / under billing adjusted (WIP)', why: 'Billing ahead of the work isn’t profit yet; billing behind it hides profit. Lenders and sureties ask for this.' },
  { key: 'pnl_reviewed', words: 'Profit and loss checked against last month', why: 'A big swing in one line is usually a posting mistake, found in a minute now or never.' },
  { key: 'period_locked', words: 'The month locked in QuickBooks (closing date set)', why: 'So nobody changes a closed month by accident.' },
]
export const STEP_KEYS = CLOSE_STEPS.map((s) => s.key)

export type SignRole = 'owner' | 'bookkeeper' | 'cpa'
export const SIGN_ROLES: { key: SignRole; words: string }[] = [
  { key: 'owner', words: 'Owner' },
  { key: 'bookkeeper', words: 'Bookkeeper' },
  { key: 'cpa', words: 'CPA' },
]

export interface StepTick { by: string | null; name: string | null; at: string; note: string | null }
export interface CloseRecord {
  /** First of the month, 'YYYY-MM-01'. */
  month: string
  items: Record<string, StepTick>
  signedBy: string | null
  signedName: string | null
  signedRole: SignRole | null
  signedAt: string | null
  note: string | null
}

export type CloseStatus = 'on_time' | 'late' | 'open'
export interface CloseState {
  month: string
  due: string
  done: number
  total: number
  signed: boolean
  /** Signed by the due date = on_time; signed after it, or not signed and past it = late; else open. */
  status: CloseStatus
  /** Days from today to the due date (0 = due today, negative = past). */
  daysLeft: number
}

const DAY = 86_400_000
const MONTH = /^(\d{4})-(\d{2})(?:-\d{2})?$/

/** 'YYYY-MM' or any day in it → 'YYYY-MM-01'; null when it isn't a month. */
export function monthStart(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const m = s.match(MONTH)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null
  return `${m[1]}-${m[2]}-01`
}

/** The first of the month `n` months after `month` (negative = before). */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + n
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`
}

/** The 10th of the month after. */
export const dueOn = (month: string) => addMonths(month, 1).slice(0, 8) + '10'

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY)

/** An ISO time → its calendar day in `tz`. */
export function dayIn(iso: string, tz = 'America/New_York'): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso.slice(0, 10)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
  } catch {
    return new Date(t).toISOString().slice(0, 10)
  }
}

export function stepsDone(record: Pick<CloseRecord, 'items'> | null | undefined): number {
  if (!record?.items) return 0
  return STEP_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(record.items, k) && record.items[k]).length
}

export function closeState(month: string, record: CloseRecord | null | undefined, today: string, tz?: string): CloseState {
  const m = monthStart(month) ?? month
  const due = dueOn(m)
  const signed = !!record?.signedAt
  let status: CloseStatus
  if (signed) status = dayIn(record!.signedAt!, tz) <= due ? 'on_time' : 'late'
  else status = today > due ? 'late' : 'open'
  return { month: m, due, done: stepsDone(record), total: CLOSE_STEPS.length, signed, status, daysLeft: days(today, due) }
}

/** The month being closed now: last month until its 10th (unless already signed), this month after. */
export function closeMonthFor(today: string, records: CloseRecord[] = []): string {
  const cur = `${today.slice(0, 7)}-01`
  const prev = addMonths(cur, -1)
  const day = Number(today.slice(8, 10))
  const prevSigned = records.some((r) => r.month === prev && r.signedAt)
  return day <= 10 && !prevSigned ? prev : cur
}

/** Months in a row closed on time, counting back from the newest one that is due (a close not yet due doesn't break it). */
export function onTimeStreak(records: CloseRecord[], today: string, tz?: string): number {
  const by = new Map(records.map((r) => [monthStart(r.month) ?? r.month, r]))
  let m = `${today.slice(0, 7)}-01`
  let streak = 0
  for (let i = 0; i < 120; i++, m = addMonths(m, -1)) {
    const st = closeState(m, by.get(m), today, tz)
    if (st.status === 'open') { if (streak === 0) continue; break }
    if (st.status !== 'on_time') break
    streak++
  }
  return streak
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthWords = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month
export const dueWords = (due: string) => `${MONTH_NAMES[Number(due.slice(5, 7)) - 1]?.slice(0, 3) ?? ''} ${Number(due.slice(8, 10))}`

/** "November close: 4 of 10 · due Dec 10" (and its signed / late forms). */
export function closeLine(st: CloseState): string {
  const head = `${monthWords(st.month)} close`
  if (st.signed) return `${head}: signed off${st.status === 'late' ? ' (late)' : ' on time'}`
  return `${head}: ${st.done} of ${st.total} · ${st.status === 'late' ? `was due ${dueWords(st.due)}` : `due ${dueWords(st.due)}`}`
}
