/**
 * Money across jobs (job flow, part 5; board #233) — pure. The Invoice
 * Tracking workbook from the jobs themselves: receivables aged by how late
 * they are (current / 1–30 / 31–60 / 61–90 / 90+ past the terms), the WIP
 * schedule (each running job's contract, cost, % complete, earned, billed,
 * over / under, retainage held, forecast margin) and cash by month (billed
 * against collected). No new tables — it reads the sent applications, the
 * approved change orders and job cost. Shared by /jobs/portfolio and
 * `scripts/portfolio-test.mjs`.
 */
import { counts, type AppStatus } from './payapp'
import { owedCents } from './closeout'
import { wip, type Wip } from './cost'

export interface PApp {
  jobId: string
  appNo: number
  appDate: string
  status: AppStatus
  release: boolean
  currentDue: number
  paidAmount: number | null
  paidOn: string | null
  contractToDate: number
  completedStored: number
  retTotal: number
}

export const AGE_BUCKETS = ['current', 'd30', 'd60', 'd90', 'over90'] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]
export const AGE_WORDS: Record<AgeBucket, string> = { current: 'Current', d30: '1–30 days', d60: '31–60 days', d90: '61–90 days', over90: '90+ days' }
export const TERMS = [0, 15, 30, 45, 60] as const
export const isTerms = (n: unknown): n is (typeof TERMS)[number] => typeof n === 'number' && (TERMS as readonly number[]).includes(n)

const DAY_MS = 86_400_000
export const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
export const daysFrom = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

/** Days past the due date → its column. Not yet due (or due today) is Current. */
export function ageBucket(daysPastDue: number): AgeBucket {
  if (daysPastDue <= 0) return 'current'
  if (daysPastDue <= 30) return 'd30'
  if (daysPastDue <= 60) return 'd60'
  if (daysPastDue <= 90) return 'd90'
  return 'over90'
}

export interface ArRow { jobId: string; appNo: number; appDate: string; dueOn: string; owed: number; daysPastDue: number; bucket: AgeBucket }

/**
 * What customers owe, application by application: every SENT application not
 * paid in full, due `termsDays` after its date, aged by days past due.
 * Retainage is in the owed amount only once the final application releases it.
 */
export function arAging(apps: PApp[], today: string, termsDays: number): { rows: ArRow[]; totals: Record<AgeBucket, number>; total: number; pastDue: number } {
  const cents: Record<AgeBucket, number> = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 }
  const rows: ArRow[] = []
  for (const a of apps) {
    if (!counts(a.status)) continue
    const owed = owedCents(a)
    if (owed <= 0) continue
    const dueOn = addDays(a.appDate, Math.max(0, termsDays))
    const late = daysFrom(dueOn, today)
    const bucket = ageBucket(late)
    cents[bucket] += owed
    rows.push({ jobId: a.jobId, appNo: a.appNo, appDate: a.appDate, dueOn, owed: owed / 100, daysPastDue: late, bucket })
  }
  rows.sort((x, y) => y.daysPastDue - x.daysPastDue || y.owed - x.owed)
  const totals = Object.fromEntries(AGE_BUCKETS.map((b) => [b, cents[b] / 100])) as Record<AgeBucket, number>
  const total = Object.values(cents).reduce((s, v) => s + v, 0) / 100
  return { rows, totals, total, pastDue: (cents.d30 + cents.d60 + cents.d90 + cents.over90) / 100 }
}

/** Each job's last SENT application — what it has billed to date and the retainage it holds. */
export function lastSentByJob(apps: PApp[]): Map<string, PApp> {
  const out = new Map<string, PApp>()
  for (const a of apps) {
    if (!counts(a.status)) continue
    const cur = out.get(a.jobId)
    if (!cur || a.appNo > cur.appNo) out.set(a.jobId, a)
  }
  return out
}

export interface CashMonth { month: string; billed: number; collected: number }

/**
 * The last `months` months, oldest first: billed = what the applications
 * dated that month asked for (this period's payment due); collected = what
 * was paid that month (an application marked Paid with no amount counts
 * as paid in full on its paid date).
 */
export function cashByMonth(apps: PApp[], today: string, months: number): CashMonth[] {
  const keys: string[] = []
  const [y, m] = today.split('-').map(Number)
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  const billed = new Map<string, number>(keys.map((k) => [k, 0]))
  const got = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const a of apps) {
    if (!counts(a.status)) continue
    const bk = a.appDate.slice(0, 7)
    if (billed.has(bk)) billed.set(bk, billed.get(bk)! + Math.round(a.currentDue * 100))
    if (a.paidOn) {
      const ck = a.paidOn.slice(0, 7)
      const amt = a.paidAmount !== null ? a.paidAmount : a.status === 'paid' ? a.currentDue : 0
      if (got.has(ck)) got.set(ck, got.get(ck)! + Math.round(amt * 100))
    }
  }
  return keys.map((k) => ({ month: k, billed: billed.get(k)! / 100, collected: got.get(k)! / 100 }))
}

export interface WipInput { jobId: string; contract: number; currentBudget: number; costToDate: number; billed: number; retainageHeld: number; eac: number | null }
export interface WipTotals { contract: number; estimatedCost: number; costToDate: number; earned: number; billed: number; overbilled: number; underbilled: number; retainageHeld: number; forecastMargin: number; leftToBill: number }

/** The WIP schedule: each running job cost to cost (the job cost page's own `wip`), and the totals a bank asks for. */
export function wipSchedule(lines: WipInput[]): { rows: (WipInput & { w: Wip })[]; totals: WipTotals } {
  const rows = lines.map((l) => ({ ...l, w: wip({ contract: l.contract, currentBudget: l.currentBudget, costToDate: l.costToDate, billed: l.billed, retainageHeld: l.retainageHeld, estimateAtCompletion: l.eac }) }))
  const sum = (f: (w: Wip) => number) => Math.round(rows.reduce((s, r) => s + Math.round(f(r.w) * 100), 0)) / 100
  return {
    rows,
    totals: {
      contract: sum((w) => w.contract), estimatedCost: sum((w) => w.estimatedCost), costToDate: sum((w) => w.costToDate),
      earned: sum((w) => w.earned), billed: sum((w) => w.billed),
      overbilled: sum((w) => Math.max(0, w.overUnder)), underbilled: sum((w) => Math.max(0, -w.overUnder)),
      retainageHeld: sum((w) => w.retainageHeld), forecastMargin: sum((w) => w.forecastMargin),
      leftToBill: sum((w) => Math.max(0, w.contract - w.billed)),
    },
  }
}

/** "2026-11" → "Nov 2026". */
export function monthWords(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
