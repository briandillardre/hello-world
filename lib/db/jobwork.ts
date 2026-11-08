/**
 * The job's issues, documents and closeout facts (migration 156). Issues and
 * documents come through the caller's RLS (a money paper and an issue's
 * dollars only with costs). The closeout facts are read on the service role
 * AFTER the page's Jobs check — they span costs-only tables (change orders,
 * applications) that a Foreman's RLS can't see, and only counts and numbers
 * leave here (dollars only when the caller may see costs).
 */
import { counts, type AppStatus } from '@/lib/jobs/payapp'
import { closeoutChecks, type CloseCheck, type CloseoutFacts } from '@/lib/jobs/closeout'
import { isIssueCategory, isIssuePriority, isIssueStatus, issueSummary, type Issue, type IssueSummary } from '@/lib/jobs/issues'
import { costsOnly, expiring, isDocKind, type JobDocument } from '@/lib/jobs/documents'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export const ISSUE_COLS = 'id, number, title, category, priority, status, owner_id, decision_from, due_on, schedule_days, detail, resolution, opened_on, resolved_on, change_order_id'
export const DOC_COLS = 'id, kind, title, doc_date, expires_on, note, filename, size_bytes, pay_app_id, created_by, created_at'

export function issueFromRow(r: Record<string, unknown>, exposure: number | null): Issue {
  return {
    id: String(r.id), number: Number(r.number), title: String(r.title),
    category: isIssueCategory(r.category) ? r.category : 'other',
    priority: isIssuePriority(r.priority) ? r.priority : 'medium',
    status: isIssueStatus(r.status) ? r.status : 'open',
    ownerId: (r.owner_id as string | null) ?? null, decisionFrom: (r.decision_from as string | null) ?? null,
    dueOn: (r.due_on as string | null) ?? null, scheduleDays: r.schedule_days === null || r.schedule_days === undefined ? null : Number(r.schedule_days),
    detail: (r.detail as string | null) ?? null, resolution: (r.resolution as string | null) ?? null,
    openedOn: String(r.opened_on), resolvedOn: (r.resolved_on as string | null) ?? null,
    changeOrderId: (r.change_order_id as string | null) ?? null, costExposure: exposure,
  }
}

export function docFromRow(r: Record<string, unknown>): JobDocument {
  return {
    id: String(r.id), kind: isDocKind(r.kind) ? r.kind : 'other', title: String(r.title),
    docDate: (r.doc_date as string | null) ?? null, expiresOn: (r.expires_on as string | null) ?? null, note: (r.note as string | null) ?? null,
    filename: String(r.filename), sizeBytes: Number(r.size_bytes ?? 0), payAppId: (r.pay_app_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null, createdAt: String(r.created_at),
  }
}

async function userDb() {
  const { createClient } = await import('@/lib/supabase-server')
  return createClient()
}

/** A job's issues; their dollars only when `money` (and RLS agrees). */
export async function getIssues(jobId: string, money: boolean): Promise<{ available: boolean; issues: Issue[] }> {
  if (isMock) return { available: true, issues: [] }
  try {
    const db = await userDb()
    const [a, m] = await Promise.all([
      db.from('job_issues').select(ISSUE_COLS).eq('job_id', jobId).order('number').limit(1000),
      money ? db.from('job_issue_money').select('issue_id, cost_exposure').eq('job_id', jobId).limit(1000) : Promise.resolve({ data: [] as { issue_id: string; cost_exposure: number | null }[], error: null }),
    ])
    if (a.error) return { available: false, issues: [] }
    const exp = new Map((m.data ?? []).map((x) => [String(x.issue_id), x.cost_exposure === null ? null : Number(x.cost_exposure)]))
    return { available: true, issues: (a.data ?? []).map((r) => issueFromRow(r as Record<string, unknown>, money ? exp.get(String(r.id)) ?? null : null)) }
  } catch {
    return { available: false, issues: [] }
  }
}

/** A job's documents (RLS leaves out the money papers for a login without costs). */
export async function getDocuments(jobId: string): Promise<{ available: boolean; docs: JobDocument[] }> {
  if (isMock) return { available: true, docs: [] }
  try {
    const { data, error } = await (await userDb()).from('job_documents').select(DOC_COLS).eq('job_id', jobId)
      .order('kind').order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(1000)
    if (error) return { available: false, docs: [] }
    return { available: true, docs: (data ?? []).map((r) => docFromRow(r as Record<string, unknown>)) }
  } catch {
    return { available: false, docs: [] }
  }
}

/**
 * What closeout checks: read on the SERVICE ROLE with the company and the job
 * pinned on every query. Callers: the job page (after its Jobs check) and
 * setStageAction (after the edit + Jobs checks).
 */
export async function getCloseoutFacts(companyId: string, job: { id: string; zoneId: string }): Promise<CloseoutFacts | null> {
  if (isMock) return null
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
    const [punch, check, cos, iss, apps, clock, ud] = await Promise.all([
      svc.from('project_tasks').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('geofence_id', job.zoneId).eq('status', 'open'),
      svc.from('job_checklist').select('text').eq('company_id', companyId).eq('job_id', job.id).eq('stage', 'closeout').eq('required', true).is('done_at', null).is('deleted_at', null).order('sort').limit(100),
      svc.from('job_change_orders').select('number, title').eq('company_id', companyId).eq('job_id', job.id).in('status', ['potential', 'pricing', 'submitted']).is('deleted_at', null).order('number').limit(200),
      svc.from('job_issues').select('number, title').eq('company_id', companyId).eq('job_id', job.id).in('status', ['open', 'waiting']).is('deleted_at', null).order('number').limit(500),
      svc.from('job_pay_apps').select('app_no, status, release, totals, paid_amount, waiver').eq('company_id', companyId).eq('job_id', job.id).in('status', ['submitted', 'approved', 'paid']).is('deleted_at', null).order('app_no').limit(300),
      svc.from('time_entries').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('project_geofence_id', job.zoneId).is('clock_out_at', null),
      svc.from('usage_daily').select('asset_id').eq('company_id', companyId).eq('geofence_id', job.zoneId).gte('day', since).gte('on_site_secs', 3600).limit(1000),
    ])
    if (punch.error || check.error || cos.error || iss.error || apps.error) return null
    const ids = Array.from(new Set((ud.data ?? []).map((x) => String(x.asset_id)))).slice(0, 500)
    let machines = 0
    if (ids.length) {
      const { data } = await svc.from('assets').select('id').eq('company_id', companyId).in('id', ids).in('type', ['vehicle', 'equipment']).is('deleted_at', null)
      machines = (data ?? []).length
    }
    return {
      punchOpen: punch.count ?? 0,
      mustDos: (check.data ?? []).map((x) => String(x.text)),
      cosPending: (cos.data ?? []).map((x) => ({ number: Number(x.number), title: String(x.title) })),
      issuesOpen: (iss.data ?? []).map((x) => ({ number: Number(x.number), title: String(x.title) })),
      apps: (apps.data ?? []).filter((x) => counts(x.status as AppStatus)).map((x) => ({
        appNo: Number(x.app_no), status: x.status as AppStatus, release: x.release === true,
        currentDue: Number((x.totals as { currentDue?: number } | null)?.currentDue ?? 0),
        paidAmount: x.paid_amount === null || x.paid_amount === undefined ? null : Number(x.paid_amount),
        waiver: x.waiver === 'final' ? 'final' : x.waiver === 'partial' ? 'partial' : 'none',
      })),
      clockedIn: clock.count ?? 0,
      machinesOnSite: machines,
    }
  } catch {
    return null
  }
}

export interface JobExtras {
  issues: IssueSummary
  /** Insurance, permits and bonds that ran out or will within 30 days. */
  expiring: JobDocument[]
  docCount: number
  closeout: { checks: CloseCheck[]; ready: boolean } | null
}

/** The job page's lines about issues, papers and — once the job is closing — closeout. */
export async function getJobExtras(companyId: string, job: { id: string; zoneId: string }, opts: { closing: boolean; money: boolean; today: string }): Promise<JobExtras> {
  const [iss, docs, facts] = await Promise.all([
    getIssues(job.id, opts.money),
    getDocuments(job.id),
    opts.closing ? getCloseoutFacts(companyId, job) : Promise.resolve(null),
  ])
  const c = facts ? closeoutChecks(facts, { money: opts.money }) : null
  // RLS reads as the real login — a view-as preview without costs must not see a money paper (a bond runs out too).
  const papers = opts.money ? docs.docs : docs.docs.filter((d) => !costsOnly(d.kind))
  return {
    issues: issueSummary(iss.issues, opts.today, opts.money),
    expiring: expiring(papers, opts.today).slice(0, 5),
    docCount: papers.length,
    closeout: c ? { checks: c.checks, ready: c.ready } : null,
  }
}

/** The change orders' numbers by id (costs only, through RLS) — an issue shows "→ CO 4". */
export async function getCoNumbers(jobId: string): Promise<Record<string, number>> {
  if (isMock) return {}
  try {
    const { data } = await (await userDb()).from('job_change_orders').select('id, number').eq('job_id', jobId).limit(1000)
    return Object.fromEntries((data ?? []).map((r) => [String(r.id), Number(r.number)]))
  } catch {
    return {}
  }
}

/** The job's sent applications (costs only, through RLS) — a lien waiver or an invoice is filed against one. */
export async function getAppChoices(jobId: string): Promise<{ id: string; appNo: number }[]> {
  if (isMock) return []
  try {
    const { data } = await (await userDb()).from('job_pay_apps').select('id, app_no').eq('job_id', jobId).in('status', ['submitted', 'approved', 'paid']).order('app_no').limit(300)
    return (data ?? []).map((r) => ({ id: String(r.id), appNo: Number(r.app_no) }))
  } catch {
    return []
  }
}
