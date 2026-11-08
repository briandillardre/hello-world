'use server'

/**
 * Issues & actions writes (migration 156). Members hold SELECT only; every
 * write runs on the service client after the edit + Jobs checks and an
 * explicit company + job check — the 138 pattern. An issue's dollars need
 * costs; deleting one is a Manager's; turning one into a change order needs
 * costs (a change order is money).
 */
import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { changeOrderFromIssue, cleanIssue } from '@/lib/jobs/issues'
import { ISSUE_COLS, issueFromRow } from '@/lib/db/jobwork'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

async function writer(opts: { costs?: boolean; managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('jobs')) throw new Error('Jobs aren’t open for your login.')
  if (opts.costs && !perms.canViewCosts) throw new Error('That’s for logins that can see costs.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('That’s for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}

const today = () => new Date().toISOString().slice(0, 10)
const refresh = (zoneId: string) => { revalidatePath(`/jobs/${zoneId}/issues`); revalidatePath(`/jobs/${zoneId}`) }

async function jobId(svc: Svc, companyId: string, zoneId: string): Promise<string | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('jobs').select('id').eq('geofence_id', zoneId).eq('company_id', companyId).maybeSingle()
  return data ? String(data.id) : null
}

/** An owner must be on the caller's company (never a prospect). */
async function ownMember(svc: Svc, companyId: string, userId: string | null): Promise<boolean> {
  if (!userId) return true
  const { data } = await svc.from('profiles').select('id, role').eq('id', userId).eq('company_id', companyId).maybeSingle()
  return !!data && data.role !== 'prospect'
}

export async function saveIssueAction(zoneId: string, raw: unknown, id?: string | null): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, userId, svc } = await writer()
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { issue, error } = cleanIssue(raw, { money: perms.canViewCosts })
  if (!issue) return { ok: false, error: error ?? 'Nothing to save.' }
  if (!(await ownMember(svc, companyId, issue.ownerId))) return { ok: false, error: 'That owner isn’t on your team.' }
  const row: Record<string, unknown> = {
    title: issue.title, category: issue.category, priority: issue.priority, status: issue.status, owner_id: issue.ownerId,
    decision_from: issue.decisionFrom, due_on: issue.dueOn, schedule_days: issue.scheduleDays, detail: issue.detail, resolution: issue.resolution,
    updated_at: new Date().toISOString(),
  }
  let issueId: string
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Bad issue' }
    const { data: cur } = await svc.from('job_issues').select('status, resolved_on').eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
    if (!cur) return { ok: false, error: 'That issue wasn’t found.' }
    // The day it was resolved: set when it is resolved, cleared when it opens again.
    row.resolved_on = issue.status === 'resolved' ? (cur.status === 'resolved' ? cur.resolved_on ?? today() : today()) : null
    const { data, error: e } = await svc.from('job_issues').update(row).eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (e || !data) return { ok: false, error: 'Couldn’t save — try again.' }
    issueId = id
  } else {
    const { data: top } = await svc.from('job_issues').select('number').eq('job_id', job).is('deleted_at', null).order('number', { ascending: false }).limit(1).maybeSingle()
    const number = Number(top?.number ?? 0) + 1
    if (number > 9999) return { ok: false, error: 'That’s a lot of issues for one job.' }
    row.resolved_on = issue.status === 'resolved' ? today() : null
    const { data, error: e } = await svc.from('job_issues').insert({ ...row, company_id: companyId, job_id: job, number, opened_on: today(), created_by: userId }).select('id').single()
    if (e || !data) return { ok: false, error: e?.code === '23505' ? 'Someone just added one — try again.' : 'Couldn’t save — try again.' }
    issueId = String(data.id)
  }
  if (issue.costExposure !== undefined) {
    const { error: e } = await svc.from('job_issue_money').upsert({ issue_id: issueId, company_id: companyId, job_id: job, cost_exposure: issue.costExposure, updated_at: new Date().toISOString() })
    if (e) return { ok: false, error: 'Saved, but the dollars didn’t — try again.' }
  }
  refresh(zoneId)
  return { ok: true, id: issueId }
}

export async function deleteIssueAction(zoneId: string, id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That issue wasn’t found.' }
  const { data } = await svc.from('job_issues').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).select('id')
  if (!data?.length) return { ok: false, error: 'That issue wasn’t found.' }
  refresh(zoneId)
  return { ok: true }
}

/**
 * The issue is extra work: start a change order from it (potential — priced
 * and sent from Pay apps) and point the issue at it. Once per issue.
 */
export async function issueToChangeOrderAction(zoneId: string, id: string): Promise<Res<{ number: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ costs: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That issue wasn’t found.' }
  const { data: r } = await svc.from('job_issues').select(ISSUE_COLS).eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!r) return { ok: false, error: 'That issue wasn’t found.' }
  const { data: m } = await svc.from('job_issue_money').select('cost_exposure').eq('issue_id', id).eq('company_id', companyId).maybeSingle()
  const issue = issueFromRow(r as Record<string, unknown>, m?.cost_exposure === null || m?.cost_exposure === undefined ? null : Number(m.cost_exposure))
  if (issue.changeOrderId) {
    const { data: live } = await svc.from('job_change_orders').select('number').eq('id', issue.changeOrderId).is('deleted_at', null).maybeSingle()
    if (live) return { ok: false, error: `It is already change order ${live.number}.` }
  }
  const co = changeOrderFromIssue(issue, today())
  const { data: top } = await svc.from('job_change_orders').select('number').eq('job_id', job).is('deleted_at', null).order('number', { ascending: false }).limit(1).maybeSingle()
  const number = Number(top?.number ?? 0) + 1
  if (number > 999) return { ok: false, error: 'That’s a lot of change orders.' }
  const { data: made, error } = await svc.from('job_change_orders').insert({
    company_id: companyId, job_id: job, number, title: co.title, description: co.description, status: co.status,
    identified_on: co.identifiedOn, cost_impact: co.costImpact, schedule_days: co.scheduleDays, created_by: userId,
  }).select('id').single()
  if (error || !made) return { ok: false, error: error?.code === '23505' ? 'Someone just added a change order — try again.' : 'Couldn’t start the change order — try again.' }
  // Compare-and-set: only an issue that still points at nothing live takes it.
  const { data: linked } = await svc.from('job_issues').update({ change_order_id: made.id, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId).or(issue.changeOrderId ? `change_order_id.is.null,change_order_id.eq.${issue.changeOrderId}` : 'change_order_id.is.null').select('id')
  if (!linked?.length) {
    await svc.from('job_change_orders').update({ deleted_at: new Date().toISOString() }).eq('id', made.id).eq('company_id', companyId)
    return { ok: false, error: 'Someone just made it a change order — refresh.' }
  }
  refresh(zoneId)
  revalidatePath(`/jobs/${zoneId}/billing`)
  return { ok: true, number }
}
