/**
 * Money across jobs (board #233): the jobs, their sent applications and
 * approved change orders through the caller's RLS (costs only), and each
 * running job's cost through job cost's own reader (getJobCost — its
 * service-role reads run only AFTER the page's Jobs + costs check). No tables
 * of its own.
 */
import { allRows } from '@/lib/db/paged'
import { listJobs } from '@/lib/db/jobs'
import { getJobCost } from '@/lib/db/jobcost'
import { rollup } from '@/lib/jobs/cost'
import { lastSentByJob, type PApp, type WipInput } from '@/lib/jobs/portfolio'
import type { AppStatus } from '@/lib/jobs/payapp'
import type { Stage } from '@/lib/jobs/job'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** The stages a WIP schedule carries: won and not yet closed. */
export const WIP_STAGES: Stage[] = ['awarded', 'active', 'on_hold', 'substantial', 'closeout']

export interface PortfolioJob { jobId: string; zoneId: string; name: string; number: string | null; customer: string | null; stage: Stage }

export interface Portfolio {
  available: boolean
  /** A job's cost or a list came back short — the page says so. */
  partial: boolean
  jobs: PortfolioJob[]
  apps: PApp[]
  wip: WipInput[]
}

export async function getPortfolio(companyId: string): Promise<Portfolio> {
  const empty: Portfolio = { available: false, partial: false, jobs: [], apps: [], wip: [] }
  if (isMock) return { ...empty, available: true }
  try {
    const log = await listJobs(true)
    if (!log.available) return empty
    const jobs: PortfolioJob[] = log.rows.map((r) => ({ jobId: r.job.id, zoneId: r.job.zoneId, name: r.zoneName, number: r.job.number ?? null, customer: r.job.customer ?? null, stage: r.job.stage }))
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [a, c] = await Promise.all([
      allRows((f, t) => db.from('job_pay_apps').select('id, job_id, app_no, app_date, status, release, totals, paid_on, paid_amount')
        .in('status', ['submitted', 'approved', 'paid']).order('id').range(f, t), { max: 20_000 }),
      allRows((f, t) => db.from('job_change_orders').select('id, job_id, approved_amount').eq('status', 'approved').order('id').range(f, t), { max: 20_000 }),
    ])
    if (a.error || c.error) return empty
    const apps: PApp[] = a.rows.map((r) => {
      const t = (r.totals ?? {}) as { currentDue?: number; contractToDate?: number; completedStored?: number; retTotal?: number }
      return {
        jobId: String(r.job_id), appNo: Number(r.app_no), appDate: String(r.app_date), status: r.status as AppStatus, release: r.release === true,
        currentDue: Number(t.currentDue ?? 0), paidAmount: r.paid_amount === null || r.paid_amount === undefined ? null : Number(r.paid_amount),
        paidOn: (r.paid_on as string | null) ?? null, contractToDate: Number(t.contractToDate ?? 0), completedStored: Number(t.completedStored ?? 0), retTotal: Number(t.retTotal ?? 0),
      }
    })
    const coCents = new Map<string, number>()
    for (const x of c.rows) coCents.set(String(x.job_id), (coCents.get(String(x.job_id)) ?? 0) + Math.round(Number(x.approved_amount ?? 0) * 100))
    const last = lastSentByJob(apps)

    // Each running job's cost, four at a time (each reads time cards, the hours ledger and receipts).
    const running = log.rows.filter((r) => WIP_STAGES.includes(r.job.stage))
    const wip: WipInput[] = []
    let partial = a.truncated || c.truncated
    for (let i = 0; i < running.length; i += 4) {
      const batch = await Promise.all(running.slice(i, i + 4).map(async (r) => {
        const j = r.job
        const from = j.startDate ?? j.awardDate ?? j.createdAt.slice(0, 10)
        const data = await getJobCost(companyId, { id: j.id, zoneId: j.zoneId, from })
        if (!data.available || data.partial) partial = true
        const roll = rollup(data.budget, data.coImpacts, data.actuals)
        const sent = last.get(j.id)
        const contract = sent ? sent.contractToDate : ((r.money?.contractAmount ?? 0) * 100 + (coCents.get(j.id) ?? 0)) / 100
        return { jobId: j.id, contract, currentBudget: roll.total.current, costToDate: roll.total.actual, billed: sent?.completedStored ?? 0, retainageHeld: sent?.retTotal ?? 0, eac: data.eac }
      }))
      wip.push(...batch)
    }
    return { available: true, partial, jobs, apps, wip }
  } catch {
    return empty
  }
}
