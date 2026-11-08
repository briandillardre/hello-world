/**
 * Reads for the job (migration 152): the job page, the project log, the
 * checklist template. Everything through the caller's RLS — dollars come back
 * only for a login with the costs ability (job_money's policy), and a
 * prospect reads nothing.
 */
import { allRows } from '@/lib/db/paged'
import {
  cleanTemplate, DEFAULT_CHECKLIST, isCheckStage, isLinkKey, isStage, JOB_COLUMNS, NO_MONEY,
  type CheckItem, type Contact, type ContactRole, type JobFields, type JobMoney, type Stage, type TemplateItem,
} from '@/lib/jobs/job'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface Job extends JobFields {
  id: string
  zoneId: string
  stage: Stage
  estimateId: string | null
  createdAt: string
  updatedAt: string
  /** Who closed it, when, and the Manager's reason when something was still open (156). */
  closedAt: string | null
  closedBy: string | null
  closedNote: string | null
}

export const JOB_SELECT = ['id', 'geofence_id', 'stage', 'estimate_id', 'created_at', 'updated_at', 'closed_at', 'closed_by', 'closed_note', ...Object.values(JOB_COLUMNS)].join(', ')

export function jobFromRow(r: Record<string, unknown>): Job {
  const out: Record<string, unknown> = {
    id: String(r.id), zoneId: String(r.geofence_id), stage: isStage(r.stage) ? r.stage : 'estimating',
    estimateId: (r.estimate_id as string | null) ?? null, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    closedAt: (r.closed_at as string | null) ?? null, closedBy: (r.closed_by as string | null) ?? null, closedNote: (r.closed_note as string | null) ?? null,
  }
  for (const [k, col] of Object.entries(JOB_COLUMNS)) out[k] = (r[col] as unknown) ?? null
  return out as unknown as Job
}

function moneyFromRow(r: Record<string, unknown> | null | undefined): JobMoney | null {
  if (!r) return null
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    bidAmount: n(r.bid_amount), contractAmount: n(r.contract_amount),
    retainagePct: Number(r.retainage_pct ?? 10), storedRetainagePct: Number(r.stored_retainage_pct ?? 10), bonded: !!r.bonded,
  }
}

export function checkFromRow(r: Record<string, unknown>): CheckItem {
  return {
    id: String(r.id), stage: isCheckStage(r.stage) ? r.stage : 'bid', text: String(r.text), link: isLinkKey(r.link) ? r.link : null,
    required: !!r.required, doneAt: (r.done_at as string | null) ?? null, doneBy: (r.done_by as string | null) ?? null,
    note: (r.note as string | null) ?? null, sort: Number(r.sort ?? 0),
  }
}

function contactFromRow(r: Record<string, unknown>): Contact {
  return {
    id: String(r.id), role: String(r.role) as ContactRole, companyName: (r.company_name as string | null) ?? null, name: (r.name as string | null) ?? null,
    email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null, note: (r.note as string | null) ?? null,
  }
}

export interface Member { id: string; name: string }

async function db() {
  const { createClient } = await import('@/lib/supabase-server')
  return createClient()
}

async function members(companyId: string): Promise<Member[]> {
  const { data } = await (await db()).from('profiles').select('id, name, email, role').eq('company_id', companyId).limit(500)
  return (data ?? []).filter((p) => p.role !== 'prospect')
    .map((p) => ({ id: String(p.id), name: (p.name as string) || (p.email as string) || 'Unnamed' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface JobPage {
  job: Job | null
  money: JobMoney | null
  checklist: CheckItem[]
  contacts: Contact[]
  members: Member[]
}

/** Everything the job page shows for one site. `withMoney` = the caller may see costs. */
export async function getJob(companyId: string, zoneId: string, withMoney: boolean): Promise<JobPage> {
  const empty: JobPage = { job: null, money: null, checklist: [], contacts: [], members: [] }
  if (isMock) return empty
  try {
    const sb = await db()
    const { data: j, error } = await sb.from('jobs').select(JOB_SELECT).eq('geofence_id', zoneId).maybeSingle()
    if (error) return empty // pre-152, or no Jobs for this login
    const team = await members(companyId)
    if (!j) return { ...empty, members: team }
    const job = jobFromRow(j as unknown as Record<string, unknown>)
    const [m, cl, ct] = await Promise.all([
      withMoney ? sb.from('job_money').select('bid_amount, contract_amount, retainage_pct, stored_retainage_pct, bonded').eq('job_id', job.id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from('job_checklist').select('id, stage, sort, text, link, required, done_at, done_by, note').eq('job_id', job.id).order('sort').limit(400),
      sb.from('job_contacts').select('id, role, company_name, name, email, phone, note').eq('job_id', job.id).order('created_at').limit(200),
    ])
    return {
      job,
      money: withMoney ? (moneyFromRow(m.data as Record<string, unknown> | null) ?? { ...NO_MONEY }) : null,
      checklist: (cl.data ?? []).map((r) => checkFromRow(r as Record<string, unknown>)),
      contacts: (ct.data ?? []).map((r) => contactFromRow(r as Record<string, unknown>)),
      members: team,
    }
  } catch {
    return empty
  }
}

export interface LogRow {
  job: Job
  zoneName: string
  money: JobMoney | null
  /** Checklist items over every section, and the required ones still open in the sections that are "now". */
  checks: { stage: CheckItem['stage']; done: boolean; required: boolean }[]
}

/** The project log: every job of the company, with its site's name. */
export async function listJobs(withMoney: boolean): Promise<{ rows: LogRow[]; members: Member[]; available: boolean }> {
  if (isMock) return { rows: [], members: [], available: true }
  try {
    const sb = await db()
    const { rows: js, error } = await allRows((from, to) => sb.from('jobs').select(JOB_SELECT).order('id').range(from, to), { max: 5000 })
    if (error) return { rows: [], members: [], available: false }
    const jobs = js.map((r) => jobFromRow(r as unknown as Record<string, unknown>))
    if (!jobs.length) return { rows: [], members: [], available: true }
    const companyId = await (await import('@/lib/db/company')).getCurrentCompanyId()
    const zoneIds = jobs.map((j) => j.zoneId)
    const names = new Map<string, string>()
    for (let i = 0; i < zoneIds.length; i += 150) {
      const { data } = await sb.from('geofences').select('id, name').in('id', zoneIds.slice(i, i + 150))
      for (const g of data ?? []) names.set(String(g.id), String(g.name))
    }
    const money = new Map<string, JobMoney>()
    if (withMoney) {
      const { rows: ms } = await allRows((from, to) => sb.from('job_money').select('job_id, bid_amount, contract_amount, retainage_pct, stored_retainage_pct, bonded').order('job_id').range(from, to), { max: 5000 })
      for (const m of ms) money.set(String((m as Record<string, unknown>).job_id), moneyFromRow(m as Record<string, unknown>)!)
    }
    const { rows: cs } = await allRows((from, to) => sb.from('job_checklist').select('id, job_id, stage, required, done_at').order('id').range(from, to), { max: 100_000 })
    const checks = new Map<string, LogRow['checks']>()
    for (const c of cs as Record<string, unknown>[]) {
      const k = String(c.job_id)
      if (!checks.has(k)) checks.set(k, [])
      checks.get(k)!.push({ stage: isCheckStage(c.stage) ? c.stage : 'bid', done: !!c.done_at, required: !!c.required })
    }
    return {
      rows: jobs.filter((j) => names.has(j.zoneId)).map((j) => ({ job: j, zoneName: names.get(j.zoneId)!, money: money.get(j.id) ?? (withMoney ? { ...NO_MONEY } : null), checks: checks.get(j.id) ?? [] })),
      members: await members(companyId),
      available: true,
    }
  } catch {
    return { rows: [], members: [], available: false }
  }
}

/** Company sites with no job yet — what "Start a job" offers. */
export async function sitesWithoutJob(taken: Set<string>): Promise<{ id: string; name: string }[]> {
  if (isMock) return []
  try {
    const sb = await db()
    const { data } = await sb.from('geofences').select('id, name, kind, owner_id, completed_at').is('owner_id', null).is('completed_at', null).limit(2000)
    return (data ?? [])
      .filter((g) => g.kind !== 'boundary' && g.kind !== 'vendor' && g.kind !== 'yard' && !taken.has(String(g.id)))
      .map((g) => ({ id: String(g.id), name: String(g.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en-US', { numeric: true }))
  } catch {
    return []
  }
}

/** The company's checklist template, or the built-in one. */
export async function getTemplate(companyId: string): Promise<{ items: TemplateItem[]; custom: boolean }> {
  if (isMock) return { items: DEFAULT_CHECKLIST, custom: false }
  try {
    const { data } = await (await db()).from('job_templates').select('checklist').eq('company_id', companyId).maybeSingle()
    const items = cleanTemplate(data?.checklist)
    return items.length ? { items, custom: true } : { items: DEFAULT_CHECKLIST, custom: false }
  } catch {
    return { items: DEFAULT_CHECKLIST, custom: false }
  }
}
