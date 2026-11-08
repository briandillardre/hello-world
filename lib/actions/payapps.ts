'use server'

/**
 * Pay apps' writes (migration 154): the schedule of values, change orders and
 * applications for payment. Members hold SELECT only (and only with costs), so
 * every write runs on the service client AFTER the edit + Jobs + costs checks
 * and an explicit company check on every row — the 138 pattern. Sending an
 * application (it freezes) and voiding one are a Manager's. A sent
 * application's numbers are computed HERE from the stored rows, never taken
 * from the device.
 */
import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import {
  cleanChangeOrder, cleanEntries, cleanSovLine, computeApps, counts, linesFor, sovFromSections, type AppRow,
} from '@/lib/jobs/payapp'
import { APP_COLS, CO_COLS, SOV_COLS, appFromRow, coFromRow, sovFromRow } from '@/lib/db/payapps'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('jobs')) throw new Error('Jobs aren’t open for your login.')
  if (!perms.canViewCosts) throw new Error('Pay apps are for logins that can see costs.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('That’s for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}

function refresh(zoneId: string) {
  revalidatePath(`/jobs/${zoneId}/billing`)
  revalidatePath(`/jobs/${zoneId}`)
  revalidatePath('/jobs')
}

interface JobRef { id: string; zoneId: string; contract: number | null; retPct: number; storedRetPct: number; estimateId: string | null }

async function jobByZone(svc: Svc, companyId: string, zoneId: string): Promise<JobRef | null> {
  if (!UUID.test(zoneId)) return null
  const { data: j } = await svc.from('jobs').select('id, geofence_id, estimate_id').eq('geofence_id', zoneId).eq('company_id', companyId).maybeSingle()
  if (!j) return null
  const { data: m } = await svc.from('job_money').select('contract_amount, retainage_pct, stored_retainage_pct').eq('job_id', j.id).maybeSingle()
  return {
    id: String(j.id), zoneId: String(j.geofence_id), estimateId: (j.estimate_id as string | null) ?? null,
    contract: m?.contract_amount === null || m?.contract_amount === undefined ? null : Number(m.contract_amount),
    retPct: Number(m?.retainage_pct ?? 10), storedRetPct: Number(m?.stored_retainage_pct ?? 10),
  }
}

async function jobById(svc: Svc, companyId: string, jobId: string): Promise<JobRef | null> {
  const { data } = await svc.from('jobs').select('geofence_id').eq('id', jobId).eq('company_id', companyId).maybeSingle()
  return data ? jobByZone(svc, companyId, String(data.geofence_id)) : null
}

/** Everything an application is computed from, read fresh on the server. */
async function chain(svc: Svc, companyId: string, job: JobRef) {
  const [s, c, a] = await Promise.all([
    svc.from('job_sov').select(SOV_COLS).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).order('sort').limit(500),
    svc.from('job_change_orders').select(CO_COLS).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).order('number').limit(500),
    svc.from('job_pay_apps').select(APP_COLS).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).order('app_no').limit(300),
  ])
  const sov = (s.data ?? []).map((r) => sovFromRow(r as Record<string, unknown>))
  const cos = (c.data ?? []).map((r) => coFromRow(r as Record<string, unknown>))
  const rows = (a.data ?? []).map((r) => appFromRow(r as Record<string, unknown>))
  return { sov, cos, rows, views: computeApps(rows, sov, cos, job.contract) }
}

// ── The schedule of values ──────────────────────────────────────────────────

export async function saveSovLineAction(zoneId: string, raw: unknown, id?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const job = await jobByZone(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { line, error } = cleanSovLine(raw)
  if (!line) return { ok: false, error: error ?? 'Nothing to save.' }
  const row = { item_no: line.itemNo, area: line.area, description: line.description, scheduled_value: line.scheduled, retainage_pct: line.retPct }
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Bad line' }
    const { data, error: e } = await svc.from('job_sov').update(row).eq('id', id).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (e || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  } else {
    const { count } = await svc.from('job_sov').select('id', { count: 'exact', head: true }).eq('job_id', job.id).is('deleted_at', null)
    if ((count ?? 0) >= 400) return { ok: false, error: 'That’s a long schedule — 400 lines at most.' }
    const { error: e } = await svc.from('job_sov').insert({ ...row, company_id: companyId, job_id: job.id, sort: (count ?? 0) + 1 })
    if (e) return { ok: false, error: 'Couldn’t save — try again.' }
  }
  refresh(zoneId)
  return { ok: true }
}

export async function deleteSovLineAction(zoneId: string, id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const job = await jobByZone(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That line wasn’t found.' }
  // A line billed on a sent application stays on every later one anyway (history can't vanish) — say so first.
  const { views } = await chain(svc, companyId, job)
  const billed = views.some((v) => v.frozen && v.status !== 'void' && v.lines.some((l) => l.key === `sov:${id}` && (l.prev + l.thisPeriod + l.stored) !== 0))
  if (billed) return { ok: false, error: 'That line has been billed on a sent application — change its value instead (a credit change order takes money off).' }
  await svc.from('job_sov').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('job_id', job.id).eq('company_id', companyId)
  refresh(zoneId)
  return { ok: true }
}

/**
 * The schedule of values from the won estimate: one line per section, priced
 * to the contract (each section's share of the direct cost). Only on an empty
 * schedule — it never overwrites lines someone typed.
 */
export async function sovFromEstimateAction(zoneId: string): Promise<Res<{ lines: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await writer()
  const job = await jobByZone(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  if (!(job.contract && job.contract > 0)) return { ok: false, error: 'Enter the contract amount on the job first — the schedule is priced to it.' }
  const { count } = await svc.from('job_sov').select('id', { count: 'exact', head: true }).eq('job_id', job.id).is('deleted_at', null)
  if (count) return { ok: false, error: 'The schedule already has lines.' }
  const [{ getEstimate, getCostBook }, E] = await Promise.all([import('@/lib/db/estimate'), import('@/lib/estimate/engine')])
  const admin = rankOf(perms) >= RANK.admin
  const [{ estimate, distances }, book] = await Promise.all([getEstimate(zoneId, admin), getCostBook(admin)])
  if (!estimate) return { ok: false, error: 'This site has no estimate to build it from.' }
  const dist = new Map(Object.entries(distances))
  const shopSrc = book.sources.find((x) => x.kind === 'shop' && dist.has(x.id))
  const ctx = { materials: book.materials, prices: book.prices, sources: book.sources, distances: dist, settings: book.settings, shop: shopSrc ? dist.get(shopSrc.id)! : null }
  const t = E.totals(estimate.lines.map((line) => ({ line, cost: E.lineCost(line, ctx) })), E.NO_MARKUPS)
  const lines = sovFromSections(t.bySection, job.contract)
  if (!lines.length) return { ok: false, error: 'The estimate has no priced sections yet.' }
  const { error } = await svc.from('job_sov').insert(lines.map((l, i) => ({ company_id: companyId, job_id: job.id, item_no: l.itemNo, description: l.description.slice(0, 200), scheduled_value: l.scheduled, sort: i + 1 })))
  if (error) return { ok: false, error: 'Couldn’t build it — try again.' }
  refresh(zoneId)
  return { ok: true, lines: lines.length }
}

// ── Change orders ───────────────────────────────────────────────────────────

export async function saveChangeOrderAction(zoneId: string, raw: unknown, id?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const job = await jobByZone(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { co, error } = cleanChangeOrder(raw)
  if (!co) return { ok: false, error: error ?? 'Nothing to save.' }
  const row = {
    customer_no: co.customerNo, title: co.title, description: co.description, type: co.type, status: co.status,
    identified_on: co.identifiedOn, submitted_on: co.submittedOn, approved_on: co.status === 'approved' ? (co.approvedOn ?? new Date().toISOString().slice(0, 10)) : co.approvedOn,
    requested_amount: co.requested, approved_amount: co.approved, cost_impact: co.costImpact, schedule_days: co.scheduleDays, note: co.note,
    cost_pcat: co.costPcat ?? null,
    updated_at: new Date().toISOString(),
  }
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Bad change order' }
    // An approved change order already billed on a sent application keeps its amount — it is history.
    const { data: cur } = await svc.from('job_change_orders').select('status, approved_amount').eq('id', id).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
    if (!cur) return { ok: false, error: 'That change order wasn’t found.' }
    if (cur.status === 'approved') {
      const { views } = await chain(svc, companyId, job)
      const billed = views.some((v) => v.frozen && v.status !== 'void' && v.lines.some((l) => l.key === `co:${id}`))
      if (billed && (row.status !== 'approved' || Number(row.approved_amount) !== Number(cur.approved_amount))) {
        return { ok: false, error: 'This change order is on a sent application — its approved amount stands. Write a new change order for the difference.' }
      }
    }
    const { data, error: e } = await svc.from('job_change_orders').update(row).eq('id', id).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (e || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  } else {
    const { data: top } = await svc.from('job_change_orders').select('number').eq('job_id', job.id).is('deleted_at', null).order('number', { ascending: false }).limit(1).maybeSingle()
    const number = Number(top?.number ?? 0) + 1
    if (number > 999) return { ok: false, error: 'That’s a lot of change orders.' }
    const { error: e } = await svc.from('job_change_orders').insert({ ...row, company_id: companyId, job_id: job.id, number, created_by: userId })
    if (e) return { ok: false, error: e.code === '23505' ? 'Someone just added one — try again.' : 'Couldn’t save — try again.' }
  }
  refresh(zoneId)
  return { ok: true }
}

export async function deleteChangeOrderAction(zoneId: string, id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const job = await jobByZone(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That change order wasn’t found.' }
  const { data: cur } = await svc.from('job_change_orders').select('status').eq('id', id).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!cur) return { ok: false, error: 'That change order wasn’t found.' }
  if (cur.status === 'approved') return { ok: false, error: 'An approved change order isn’t deleted — mark it Void instead, so the record stays.' }
  await svc.from('job_change_orders').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('job_id', job.id).eq('company_id', companyId)
  refresh(zoneId)
  return { ok: true }
}

// ── Applications ────────────────────────────────────────────────────────────

const endOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)

/** The next application — a draft, numbered after the last, at the job's retainage. One draft at a time. */
export async function newPayAppAction(zoneId: string): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const job = await jobByZone(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { sov, rows } = await chain(svc, companyId, job)
  if (!sov.length) return { ok: false, error: 'Set up the schedule of values first.' }
  if (rows.some((r) => r.status === 'draft')) return { ok: false, error: 'Finish (or delete) the draft application first.' }
  // A voided application frees its number (the resubmission keeps it).
  const appNo = Math.max(0, ...rows.filter((r) => r.status !== 'void').map((r) => r.appNo)) + 1
  const last = [...rows].filter((r) => counts(r.status)).sort((a, b) => b.appNo - a.appNo)[0]
  const { data, error } = await svc.from('job_pay_apps').insert({
    company_id: companyId, job_id: job.id, app_no: appNo, app_date: new Date().toISOString().slice(0, 10), period_to: endOfMonth(),
    retainage_pct: last?.retPct ?? job.retPct, stored_retainage_pct: last?.storedRetPct ?? job.storedRetPct, created_by: userId,
  }).select('id').single()
  if (error || !data) return { ok: false, error: error?.code === '23505' ? 'Someone just started one — refresh.' : 'Couldn’t start it — try again.' }
  refresh(zoneId)
  return { ok: true, id: String(data.id) }
}

async function ownApp(svc: Svc, companyId: string, appId: string): Promise<{ row: AppRow; job: JobRef } | null> {
  if (!UUID.test(appId)) return null
  const { data } = await svc.from('job_pay_apps').select(`${APP_COLS}, job_id`).eq('id', appId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!data) return null
  const job = await jobById(svc, companyId, String((data as Record<string, unknown>).job_id))
  return job ? { row: appFromRow(data as Record<string, unknown>), job } : null
}

export interface DraftPatch {
  appDate?: string; periodTo?: string; retPct?: number; storedRetPct?: number; release?: boolean
  entries?: unknown; invoiceNo?: string | null; note?: string | null
}

/** Save a draft's header and entries. */
export async function savePayAppAction(appId: string, patch: DraftPatch): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const own = await ownApp(svc, companyId, appId)
  if (!own) return { ok: false, error: 'That application wasn’t found.' }
  if (own.row.status !== 'draft') return { ok: false, error: 'A sent application doesn’t change — void it and start the next one.' }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['appDate', 'periodTo'] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || !DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { ok: false, error: 'A date there isn’t a real date.' }
    row[k === 'appDate' ? 'app_date' : 'period_to'] = v
  }
  for (const [k, col] of [['retPct', 'retainage_pct'], ['storedRetPct', 'stored_retainage_pct']] as const) {
    const v = patch[k]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 50) return { ok: false, error: 'Retainage runs 0–50%.' }
    row[col] = Math.round(v * 100) / 100
  }
  if (patch.release !== undefined) row.release = patch.release === true
  if (patch.invoiceNo !== undefined) row.invoice_no = typeof patch.invoiceNo === 'string' ? patch.invoiceNo.trim().slice(0, 40) || null : null
  if (patch.note !== undefined) row.note = typeof patch.note === 'string' ? patch.note.trim().slice(0, 1000) || null : null
  if (patch.entries !== undefined) {
    // Entries only for the lines this application bills against.
    const { sov, cos, rows } = await chain(svc, companyId, own.job)
    const prior = rows.filter((r) => counts(r.status) && r.appNo < own.row.appNo).sort((a, b) => b.appNo - a.appNo)[0]
    const keys = linesFor({ sov, cos, periodTo: (row.period_to as string | undefined) ?? own.row.periodTo, prior: prior?.lines ?? null }).map((l) => l.key)
    const { entries, error } = cleanEntries(patch.entries, keys)
    if (!entries) return { ok: false, error: error ?? 'Couldn’t read the lines.' }
    row.entries = entries
  }
  const { error } = await svc.from('job_pay_apps').update(row).eq('id', appId).eq('company_id', companyId).eq('status', 'draft')
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(own.job.zoneId)
  return { ok: true }
}

/** Send it: the lines and G702 totals are computed here and frozen. Managers and above. */
export async function submitPayAppAction(appId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  const own = await ownApp(svc, companyId, appId)
  if (!own) return { ok: false, error: 'That application wasn’t found.' }
  if (own.row.status !== 'draft') return { ok: false, error: 'It has already been sent.' }
  const { views } = await chain(svc, companyId, own.job)
  const v = views.find((x) => x.id === appId)
  if (!v) return { ok: false, error: 'That application wasn’t found.' }
  if (views.some((x) => x.appNo > v.appNo && x.status !== 'void')) return { ok: false, error: 'A later application exists — this one can’t be sent now.' }
  const { data, error } = await svc.from('job_pay_apps').update({
    status: 'submitted', lines: v.lines, totals: v.totals, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', appId).eq('company_id', companyId).eq('status', 'draft').select('id').maybeSingle()
  if (error || !data) return { ok: false, error: 'Couldn’t send it — try again.' }
  refresh(own.job.zoneId)
  return { ok: true }
}

/** After it is sent: approved, paid (date and amount), lien waiver. */
export async function payAppStatusAction(appId: string, patch: { approved?: boolean; paidOn?: string | null; paidAmount?: number | null; waiver?: 'none' | 'partial' | 'final'; waiverOn?: string | null }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const own = await ownApp(svc, companyId, appId)
  if (!own) return { ok: false, error: 'That application wasn’t found.' }
  if (!counts(own.row.status)) return { ok: false, error: 'Send it first.' }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.approved === true && own.row.status === 'submitted') { row.status = 'approved'; row.approved_at = new Date().toISOString() }
  if (patch.paidOn !== undefined || patch.paidAmount !== undefined) {
    const on = patch.paidOn ?? null, amt = patch.paidAmount ?? null
    if (on !== null && (!DAY.test(on) || Number.isNaN(Date.parse(`${on}T00:00:00Z`)))) return { ok: false, error: 'The paid date isn’t a real date.' }
    if (amt !== null && !(Number.isFinite(amt) && Math.abs(amt) <= 1e9)) return { ok: false, error: 'The paid amount can’t be read.' }
    row.paid_on = on
    row.paid_amount = amt === null ? null : Math.round(amt * 100) / 100
    if (on && amt !== null) row.status = 'paid'
    else if (own.row.status === 'paid') row.status = own.row.approvedAt ? 'approved' : 'submitted'
  }
  if (patch.waiver !== undefined) {
    if (!['none', 'partial', 'final'].includes(patch.waiver)) return { ok: false, error: 'Unknown waiver.' }
    row.waiver = patch.waiver
    const on = patch.waiverOn ?? null
    if (on !== null && (!DAY.test(on) || Number.isNaN(Date.parse(`${on}T00:00:00Z`)))) return { ok: false, error: 'The waiver date isn’t a real date.' }
    row.waiver_on = patch.waiver === 'none' ? null : on
  }
  const { error } = await svc.from('job_pay_apps').update(row).eq('id', appId).eq('company_id', companyId).neq('status', 'void')
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(own.job.zoneId)
  return { ok: true }
}

/** Void the LAST sent application (the next builds on the one before it). Managers and above. */
export async function voidPayAppAction(appId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  const own = await ownApp(svc, companyId, appId)
  if (!own) return { ok: false, error: 'That application wasn’t found.' }
  if (!counts(own.row.status)) return { ok: false, error: own.row.status === 'draft' ? 'A draft is deleted, not voided.' : 'It is already void.' }
  const { rows } = await chain(svc, companyId, own.job)
  if (rows.some((r) => r.appNo > own.row.appNo && r.status !== 'void')) return { ok: false, error: 'Only the last application can be voided — a later one builds on it.' }
  const { error } = await svc.from('job_pay_apps').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', appId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t void it — try again.' }
  refresh(own.job.zoneId)
  return { ok: true }
}

export async function deleteDraftAction(appId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const own = await ownApp(svc, companyId, appId)
  if (!own) return { ok: false, error: 'That application wasn’t found.' }
  if (own.row.status !== 'draft') return { ok: false, error: 'Only a draft is deleted — a sent one is voided.' }
  await svc.from('job_pay_apps').update({ deleted_at: new Date().toISOString() }).eq('id', appId).eq('company_id', companyId).eq('status', 'draft')
  refresh(own.job.zoneId)
  return { ok: true }
}
