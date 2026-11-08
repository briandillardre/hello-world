/**
 * Reads for pay apps (migration 154), through the caller's RLS — every table
 * is behind the costs ability, so a login without it gets nothing back.
 */
import { computeApps, type AppLine, type AppRow, type AppTotals, type AppView, type ChangeOrder, type CoStatus, type CoType, type SovLine } from '@/lib/jobs/payapp'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export function sovFromRow(r: Record<string, unknown>): SovLine {
  return { id: String(r.id), itemNo: String(r.item_no ?? ''), area: (r.area as string | null) ?? null, description: String(r.description), scheduled: Number(r.scheduled_value), retPct: num(r.retainage_pct), sort: Number(r.sort ?? 0) }
}
export function coFromRow(r: Record<string, unknown>): ChangeOrder {
  return {
    id: String(r.id), number: Number(r.number), customerNo: (r.customer_no as string | null) ?? null, title: String(r.title), description: (r.description as string | null) ?? null,
    type: (r.type as CoType | null) ?? null, status: String(r.status) as CoStatus, identifiedOn: (r.identified_on as string | null) ?? null, submittedOn: (r.submitted_on as string | null) ?? null,
    approvedOn: (r.approved_on as string | null) ?? null, requested: num(r.requested_amount), approved: num(r.approved_amount), costImpact: num(r.cost_impact),
    scheduleDays: num(r.schedule_days), note: (r.note as string | null) ?? null, costPcat: (r.cost_pcat as ChangeOrder['costPcat']) ?? null,
  }
}
export function appFromRow(r: Record<string, unknown>): AppRow {
  return {
    id: String(r.id), appNo: Number(r.app_no), appDate: String(r.app_date), periodTo: String(r.period_to), status: String(r.status) as AppRow['status'],
    retPct: Number(r.retainage_pct), storedRetPct: Number(r.stored_retainage_pct), release: !!r.release,
    entries: (r.entries as AppRow['entries']) ?? {}, lines: (r.lines as AppLine[] | null) ?? null, totals: (r.totals as AppTotals | null) ?? null,
    invoiceNo: (r.invoice_no as string | null) ?? null, note: (r.note as string | null) ?? null, submittedAt: (r.submitted_at as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null, paidOn: (r.paid_on as string | null) ?? null, paidAmount: num(r.paid_amount),
    waiver: (r.waiver as AppRow['waiver']) ?? 'none', waiverOn: (r.waiver_on as string | null) ?? null,
  }
}

export const SOV_COLS = 'id, item_no, area, description, scheduled_value, retainage_pct, sort'
export const CO_COLS = 'id, number, customer_no, title, description, type, status, identified_on, submitted_on, approved_on, requested_amount, approved_amount, cost_impact, schedule_days, note, cost_pcat'
export const APP_COLS = 'id, app_no, app_date, period_to, status, retainage_pct, stored_retainage_pct, release, entries, lines, totals, invoice_no, note, submitted_at, approved_at, paid_on, paid_amount, waiver, waiver_on'

export interface Billing { available: boolean; sov: SovLine[]; cos: ChangeOrder[]; apps: AppView[] }

/** A job's schedule of values, change orders and applications (computed). */
export async function getBilling(jobId: string, contractAmount: number | null): Promise<Billing> {
  const empty: Billing = { available: false, sov: [], cos: [], apps: [] }
  if (isMock) return { ...empty, available: true }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [s, c, a] = await Promise.all([
      db.from('job_sov').select(SOV_COLS).eq('job_id', jobId).order('sort').limit(500),
      db.from('job_change_orders').select(CO_COLS).eq('job_id', jobId).order('number').limit(500),
      db.from('job_pay_apps').select(APP_COLS).eq('job_id', jobId).order('app_no').limit(300),
    ])
    if (s.error || c.error || a.error) return empty
    const sov = (s.data ?? []).map((r) => sovFromRow(r as Record<string, unknown>))
    const cos = (c.data ?? []).map((r) => coFromRow(r as Record<string, unknown>))
    const apps = computeApps((a.data ?? []).map((r) => appFromRow(r as Record<string, unknown>)), sov, cos, contractAmount)
    return { available: true, sov, cos, apps }
  } catch {
    return empty
  }
}
