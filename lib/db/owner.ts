/**
 * The owner dashboard's reads (lib/owner/dashboard.ts does the math): the
 * money across jobs, the project log, supplier invoices and the bid history —
 * each through its own reader and the caller's RLS, so nothing here sees more
 * than the pages it sums up. Costs logins only (the page checks).
 */
import { getPortfolio } from '@/lib/db/portfolio'
import { listJobs } from '@/lib/db/jobs'
import { getInvoices } from '@/lib/db/invoices'
import { getRateLibrary } from '@/lib/db/bids'
import { arAging, wipSchedule } from '@/lib/jobs/portfolio'
import { apAging } from '@/lib/pricing/invoice'
import { backlog, bidFunnel, concentration, moneySankey, type OwnerBid, type OwnerJob } from '@/lib/owner/dashboard'
import { BOOKS_TZ, getCloses, getLatestBooks } from '@/lib/db/books'
import { cashInBank } from '@/lib/books/report'
import { closeLine, closeMonthFor, closeState, type CloseStatus } from '@/lib/books/close'
import { getConnectionStatus, isQboConfigured } from '@/lib/qbo'

const DAY = 86_400_000
const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface OwnerBooks {
  connected: boolean
  /** Bank accounts added up off the newest good QuickBooks read; null before one. */
  cash: { total: number; accounts: number } | null
  asOf: string | null
  close: { line: string; status: CloseStatus; signed: boolean }
}

/** Cash in the bank + this month's close — the owner's books (Admin or the Master; the tables read nothing for anyone else). */
async function ownerBooks(companyId: string, today: string): Promise<OwnerBooks> {
  const [books, closes, conn] = await Promise.all([
    getLatestBooks(companyId),
    getCloses(companyId),
    isMock ? Promise.resolve({ connected: true }) : isQboConfigured ? getConnectionStatus(companyId).catch(() => ({ connected: false })) : Promise.resolve({ connected: false }),
  ])
  const month = closeMonthFor(today, closes.records)
  const st = closeState(month, closes.records.find((r) => r.month === month), today, BOOKS_TZ)
  return {
    connected: conn.connected,
    cash: cashInBank(books.good?.data),
    asOf: books.good?.takenAt ?? null,
    close: { line: closeLine(st), status: st.status, signed: st.signed },
  }
}

export async function getOwnerDashboard(companyId: string, opts: { admin: boolean; today?: string }) {
  const today = opts.today ?? dayOf(Date.now())
  const [p, log, inv, bids, books] = await Promise.all([
    getPortfolio(companyId),
    listJobs(true),
    getInvoices(),
    getRateLibrary(companyId, false),
    opts.admin ? ownerBooks(companyId, today).catch(() => null) : Promise.resolve(null),
  ])

  const jobs: OwnerJob[] = log.rows.map((r) => ({
    jobId: r.job.id, name: r.zoneName, customer: r.job.customer ?? null, stage: r.job.stage,
    contract: r.money?.contractAmount ?? null, awardedOn: r.job.awardDate ?? null,
  }))
  const wipRows = wipSchedule(p.wip).rows
  const wip = wipRows.map((r) => ({ jobId: r.jobId, contract: r.contract, earned: r.w.earned, billed: r.billed, costToDate: r.costToDate, known: r.w.known }))
  const nameOf = new Map(jobs.map((j) => [j.jobId, j.name]))

  // One bid per estimate (or per pasted job + date): its total and how it ended.
  const byBid = new Map<string, OwnerBid>()
  for (const b of bids.rows) {
    const k = b.estimateId ?? `${b.jobName}|${b.bidOn}`
    const cur = byBid.get(k) ?? { estimateId: k, status: b.result === 'pending' ? 'sent' : b.result, bidOn: b.bidOn, total: 0 }
    cur.total = (cur.total ?? 0) + (b.qty ?? 0) * b.unitPrice
    byBid.set(k, cur)
  }
  const from90 = dayOf(Date.parse(`${today}T12:00:00Z`) - 90 * DAY)
  const from365 = dayOf(Date.parse(`${today}T12:00:00Z`) - 365 * DAY)

  const ar = arAging(p.apps, today, 30)
  const ap = apAging(inv.invoices.map((i) => ({ id: i.id, total: i.total, paidAmount: i.paidAmount, paidOn: i.paidOn, dueOn: i.dueOn, invoiceOn: i.invoiceOn })), today)
  const sankey = moneySankey(wip.map((w) => ({ name: nameOf.get(w.jobId) ?? 'Job', earned: w.known ? w.earned : 0 })), p.actuals)

  return {
    available: p.available && log.available,
    partial: p.partial || bids.truncated,
    today,
    ar: { total: ar.total, pastDue: ar.pastDue, over60: (ar.totals.d90 ?? 0) + (ar.totals.over90 ?? 0), totals: ar.totals },
    ap: { available: inv.available, total: ap.open, pastDue: ap.pastDue, dueThisWeek: ap.dueThisWeek, buckets: ap.buckets, count: ap.openCount },
    backlog: backlog(jobs, wip),
    bids90: bidFunnel(Array.from(byBid.values()), from90, today),
    bids365: bidFunnel(Array.from(byBid.values()), from365, today),
    concentration: concentration(jobs, from365),
    sankey,
    retainageHeld: Math.round(p.wip.reduce((t, w) => t + w.retainageHeld, 0) * 100) / 100,
    /** null below Admin — the owner's books stay the owner's. */
    books,
  }
}

export type OwnerDashboardData = Awaited<ReturnType<typeof getOwnerDashboard>>
