/**
 * Job cost reads (migration 155). The budget, entered costs and change orders
 * come through the caller's RLS (costs-only). The actuals that feed
 * themselves are read where they already live, on the service role, AFTER the
 * page has checked Jobs + costs — and only as totals (no person's hours or
 * pay is shown): time cards clocked to the job × each person's loaded rate,
 * the hours ledger × each machine's rates, job-coded receipts by category.
 */
import { ledgerRowCost } from '@/lib/costs'
import { allRows } from '@/lib/db/paged'
import { isPcat, pcatOfReceipt, type BudgetLine, type CostEntry, type Pcat } from '@/lib/jobs/cost'
import { shiftHours } from '@/lib/timecards'
import type { AssetType } from '@/lib/types'

/** Entered costs a job may hold (the paste and the form refuse past it; the reader pages up to it). */
export const MAX_JOB_COSTS = 20_000

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface EnteredCost { id: string; spentOn: string; pcat: Pcat; amount: number; vendor: string | null; reference: string | null; description: string | null; source: 'manual' | 'import' }

export interface JobCostData {
  available: boolean
  /** A read failed part way or hit its ceiling — the totals may be short (the page says so). */
  partial: boolean
  /** Counting from this day (the job's start, else its award, else when it went on the log). */
  from: string | null
  budget: BudgetLine[]
  entered: EnteredCost[]
  coImpacts: { pcat: Pcat; amount: number }[]
  actuals: CostEntry[]
  sources: {
    labor: { hours: number; dollars: number; unpricedHours: number; unpricedPeople: number }
    equipment: { hours: number; dollars: number; machines: number }
    receipts: { count: number; dollars: number }
    entered: { count: number; dollars: number }
  }
  eac: number | null
}

const empty: JobCostData = {
  available: false, partial: false, from: null, budget: [], entered: [], coImpacts: [], actuals: [],
  sources: { labor: { hours: 0, dollars: 0, unpricedHours: 0, unpricedPeople: 0 }, equipment: { hours: 0, dollars: 0, machines: 0 }, receipts: { count: 0, dollars: 0 }, entered: { count: 0, dollars: 0 } },
  eac: null,
}

export async function getJobCost(companyId: string, job: { id: string; zoneId: string; from: string | null }): Promise<JobCostData> {
  if (isMock) return { ...empty, available: true }
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [b, e, co, m] = await Promise.all([
      db.from('job_budget_lines').select('id, cost_code, description, pcat, original, sort').eq('job_id', job.id).order('sort').order('id').limit(1000),
      // Every entered cost — the API answers ~1,000 rows a request, so page through them.
      allRows((f, t) => db.from('job_costs').select('id, spent_on, pcat, amount, vendor, reference, description, source').eq('job_id', job.id)
        .order('spent_on', { ascending: false }).order('id').range(f, t), { max: MAX_JOB_COSTS }),
      db.from('job_change_orders').select('status, cost_impact, cost_pcat').eq('job_id', job.id).eq('status', 'approved').limit(1000),
      db.from('job_money').select('estimate_at_completion').eq('job_id', job.id).maybeSingle(),
    ])
    if (b.error || e.error || co.error) return empty
    const budget: BudgetLine[] = (b.data ?? []).map((r) => ({
      id: String(r.id), costCode: (r.cost_code as string | null) ?? null, description: String(r.description), pcat: (isPcat(r.pcat) ? r.pcat : 'O') as Pcat, original: Number(r.original), sort: Number(r.sort ?? 0),
    }))
    const entered: EnteredCost[] = e.rows.map((r) => ({
      id: String(r.id), spentOn: String(r.spent_on), pcat: (isPcat(r.pcat) ? r.pcat : 'O') as Pcat, amount: Number(r.amount),
      vendor: (r.vendor as string | null) ?? null, reference: (r.reference as string | null) ?? null, description: (r.description as string | null) ?? null,
      source: r.source === 'import' ? 'import' : 'manual',
    }))
    const coImpacts = (co.data ?? []).filter((x) => x.cost_impact !== null).map((x) => ({ pcat: (isPcat(x.cost_pcat) ? x.cost_pcat : 'O') as Pcat, amount: Number(x.cost_impact) }))

    const svc = createServiceClient()
    const fromTs = job.from ? `${job.from}T00:00:00Z` : null
    // Time cards clocked to the job.
    const teR = await allRows((f, t) => {
      let q = svc.from('time_entries').select('id, user_id, clock_in_at, clock_out_at, break_minutes').eq('company_id', companyId).eq('project_geofence_id', job.zoneId)
      if (fromTs) q = q.gte('clock_in_at', fromTs)
      return q.order('id').range(f, t)
    }, { max: 50_000 })
    // Machine hours on the site, from the ledger.
    const udR = await allRows((f, t) => {
      let q = svc.from('usage_daily').select('asset_id, day, on_site_secs, active_secs').eq('company_id', companyId).eq('geofence_id', job.zoneId)
      if (job.from) q = q.gte('day', job.from)
      return q.order('day').order('asset_id').range(f, t)
    }, { max: 100_000 })
    // Job-coded receipts (not rejected).
    const rcR = await allRows((f, t) => {
      let q = svc.from('receipts').select('id, amount, category, status, txn_date, created_at').eq('company_id', companyId).eq('project_geofence_id', job.zoneId).neq('status', 'rejected')
      if (job.from) q = q.or(`txn_date.gte.${job.from},and(txn_date.is.null,created_at.gte.${fromTs})`)
      return q.order('id').range(f, t)
    }, { max: 20_000 })

    const te = teR.rows, ud = udR.rows, rc = rcR.rows
    const partial = [e, teR, udR, rcR].some((x) => x.truncated)

    // Rates: each person's phone asset (loaded labor $/hr), each machine's own.
    const people = Array.from(new Set(te.map((x) => String(x.user_id))))
    const machineIds = Array.from(new Set(ud.map((x) => String(x.asset_id))))
    const rate = new Map<string, number>()
    for (let i = 0; i < people.length; i += 150) {
      const { data } = await svc.from('assets').select('tracker_id, hourly_rate').eq('company_id', companyId).in('tracker_id', people.slice(i, i + 150).map((u) => `phone-${u}`))
      for (const a of data ?? []) if (a.hourly_rate !== null && Number(a.hourly_rate) > 0) rate.set(String(a.tracker_id).slice(6), Number(a.hourly_rate))
    }
    const assets = new Map<string, { type: AssetType | null; hourly_rate: number | null; daily_cost: number | null }>()
    for (let i = 0; i < machineIds.length; i += 150) {
      const { data } = await svc.from('assets').select('id, type, hourly_rate, daily_cost').eq('company_id', companyId).in('id', machineIds.slice(i, i + 150))
      for (const a of data ?? []) assets.set(String(a.id), { type: a.type as AssetType | null, hourly_rate: a.hourly_rate as number | null, daily_cost: a.daily_cost as number | null })
    }

    const now = Date.now()
    let labH = 0, labD = 0, unH = 0
    const unpriced = new Set<string>()
    for (const x of te) {
      // The time cards' own rule (paid = elapsed less the break, an open shift to now, 24 h at most),
      // so a job's labor hours and the time cards agree — a corrected time card corrects both.
      const h = shiftHours(String(x.clock_in_at), x.clock_out_at ? String(x.clock_out_at) : null, Number(x.break_minutes ?? 0), now).paid
      labH += h
      const r = rate.get(String(x.user_id))
      if (r) labD += h * r
      else { unH += h; unpriced.add(String(x.user_id)) }
    }
    let eqH = 0, eqD = 0
    const ran = new Set<string>()
    for (const x of ud) {
      const a = assets.get(String(x.asset_id))
      if (!a || (a.type !== 'vehicle' && a.type !== 'equipment')) continue // people are labor (time cards); tools carry no hours
      eqH += Number(x.on_site_secs) / 3600
      eqD += ledgerRowCost(a, Number(x.on_site_secs), Number(x.active_secs))
      ran.add(String(x.asset_id))
    }
    const actuals: CostEntry[] = []
    if (labD) actuals.push({ pcat: 'L', amount: Math.round(labD * 100) / 100 })
    if (eqD) actuals.push({ pcat: 'E', amount: Math.round(eqD * 100) / 100 })
    let rcD = 0
    for (const x of rc) {
      const amt = Number(x.amount ?? 0)
      if (!amt) continue
      rcD += amt
      actuals.push({ pcat: pcatOfReceipt(x.category as string | null), amount: amt })
    }
    for (const x of entered) actuals.push({ pcat: x.pcat, amount: x.amount })

    return {
      available: true, partial, from: job.from, budget, entered, coImpacts, actuals,
      sources: {
        labor: { hours: Math.round(labH * 10) / 10, dollars: Math.round(labD * 100) / 100, unpricedHours: Math.round(unH * 10) / 10, unpricedPeople: unpriced.size },
        equipment: { hours: Math.round(eqH * 10) / 10, dollars: Math.round(eqD * 100) / 100, machines: ran.size },
        receipts: { count: rc.length, dollars: Math.round(rcD * 100) / 100 },
        entered: { count: entered.length, dollars: Math.round(entered.reduce((s, x) => s + x.amount, 0) * 100) / 100 },
      },
      eac: m.data?.estimate_at_completion === null || m.data?.estimate_at_completion === undefined ? null : Number(m.data.estimate_at_completion),
    }
  } catch {
    return empty
  }
}
