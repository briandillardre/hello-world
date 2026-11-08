'use server'

/**
 * The job's writes (migration 152). Members hold SELECT only on the job
 * tables, so every write runs on the service client AFTER the edit and Jobs
 * checks and an explicit company check on every row it touches — the 138
 * pattern. Dollars also need the costs ability; the checklist template is a
 * Manager's.
 */
import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { parseJobName } from '@/lib/job-code'
import {
  cleanContact, cleanJobPatch, cleanMoney, cleanTemplate, datesOnMove, DEFAULT_CHECKLIST, isCheckStage, isStage,
  JOB_COLUMNS, nextJobNumber, type CheckStage, type JobFields, type Stage,
} from '@/lib/jobs/job'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

async function writer(opts: { costs?: boolean; managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('jobs')) throw new Error('Jobs aren’t open for your login.')
  if (opts.costs && !perms.canViewCosts) throw new Error('Contract dollars are for logins that can see costs.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('That’s for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}

const today = () => new Date().toISOString().slice(0, 10)

function refresh(zoneId?: string | null) {
  revalidatePath('/jobs')
  if (zoneId) { revalidatePath(`/jobs/${zoneId}`); revalidatePath(`/zones/${zoneId}`) }
}

/** A company site of the caller's company: never a personal zone, a boundary, a supplier stop or a yard. */
async function ownSite(svc: Svc, companyId: string, zoneId: string): Promise<{ id: string; name: string } | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('geofences').select('id, name, kind, owner_id').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  if (!data || data.owner_id || data.kind === 'boundary' || data.kind === 'vendor' || data.kind === 'yard') return null
  return { id: String(data.id), name: String(data.name) }
}

async function jobOf(svc: Svc, companyId: string, zoneId: string): Promise<{ id: string; stage: Stage; award_date: string | null; start_date: string | null; actual_completion: string | null } | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('jobs').select('id, stage, award_date, start_date, actual_completion').eq('geofence_id', zoneId).eq('company_id', companyId).maybeSingle()
  return data ? { id: String(data.id), stage: (isStage(data.stage) ? data.stage : 'estimating'), award_date: data.award_date as string | null, start_date: data.start_date as string | null, actual_completion: data.actual_completion as string | null } : null
}

/** Every job number the company has used: the jobs' own and the codes at the front of zone names. */
async function usedNumbers(svc: Svc, companyId: string): Promise<string[]> {
  const [{ data: js }, { data: zs }] = await Promise.all([
    svc.from('jobs').select('number').eq('company_id', companyId).limit(5000),
    svc.from('geofences').select('name').eq('company_id', companyId).limit(5000),
  ])
  return [
    ...(js ?? []).map((j) => (j.number as string | null) ?? ''),
    ...(zs ?? []).map((z) => parseJobName(String(z.name)).code ?? ''),
  ]
}

/** The company's template (or the built-in one) as the new job's own checklist. */
async function seedChecklist(svc: Svc, companyId: string, jobId: string, userId: string | null): Promise<void> {
  const { data } = await svc.from('job_templates').select('checklist').eq('company_id', companyId).maybeSingle()
  const items = cleanTemplate(data?.checklist)
  const list = items.length ? items : DEFAULT_CHECKLIST
  const now = new Date().toISOString()
  await svc.from('job_checklist').insert(list.map((t, i) => ({
    company_id: companyId, job_id: jobId, stage: t.stage, sort: i, text: t.text, link: t.link, required: t.required,
    // "On the project log" is true the moment the job exists.
    ...(t.link === 'log' ? { done_at: now, done_by: userId } : {}),
  })))
}

/** Put a site on the project log. The job number comes from the zone name ("26-084 …") when it has one. */
export async function createJobAction(zoneId: string, opts: { stage?: Stage } = {}): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const site = await ownSite(svc, companyId, zoneId)
  if (!site) return { ok: false, error: 'That site wasn’t found — a job goes on a company site (not a personal zone, a yard or a supplier).' }
  const existing = await jobOf(svc, companyId, site.id)
  if (existing) return { ok: true, id: existing.id }
  const stage: Stage = opts.stage && isStage(opts.stage) ? opts.stage : 'estimating'
  const { data, error } = await svc.from('jobs').insert({
    company_id: companyId, geofence_id: site.id, stage, number: parseJobName(site.name).code,
    ...(stage === 'awarded' ? { award_date: today() } : {}), created_by: userId,
  }).select('id').single()
  if (error || !data) {
    if (error?.code === '23505') { const j = await jobOf(svc, companyId, site.id); if (j) return { ok: true, id: j.id } }
    return { ok: false, error: 'Couldn’t start the job — try again.' }
  }
  await seedChecklist(svc, companyId, String(data.id), userId)
  refresh(site.id)
  return { ok: true, id: String(data.id) }
}

/** Save some of the job's fields. */
export async function saveJobAction(zoneId: string, raw: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const job = await jobOf(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { patch, error } = cleanJobPatch(raw)
  if (error) return { ok: false, error }
  // The PM and the superintendent are people on this company's team.
  for (const k of ['pmId', 'superId'] as const) {
    const id = patch[k]
    if (!id) continue
    const { data } = await svc.from('profiles').select('id, role').eq('id', id).eq('company_id', companyId).maybeSingle()
    if (!data || data.role === 'prospect') return { ok: false, error: 'Pick someone from the team.' }
  }
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(patch)) row[JOB_COLUMNS[k as keyof JobFields]] = v
  const { error: e2 } = await svc.from('jobs').update(row).eq('id', job.id).eq('company_id', companyId)
  if (e2) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(zoneId)
  return { ok: true }
}

/** Move the job along (or off) the road. Blank dates the move implies are filled in; typed ones never change. */
export async function setStageAction(zoneId: string, stage: string, lostReason?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!isStage(stage)) return { ok: false, error: 'Unknown stage.' }
  const job = await jobOf(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const d = datesOnMove(stage, { awardDate: job.award_date, startDate: job.start_date, actualCompletion: job.actual_completion }, today())
  const row: Record<string, unknown> = { stage, updated_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(d)) row[JOB_COLUMNS[k as keyof JobFields]] = v
  if (stage === 'lost' || stage === 'no_bid' || stage === 'cancelled') {
    const why = typeof lostReason === 'string' ? lostReason.trim().slice(0, 300) : ''
    if (why) row.lost_reason = why
  }
  const { error } = await svc.from('jobs').update(row).eq('id', job.id).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t move it — try again.' }
  refresh(zoneId)
  return { ok: true }
}

/** The contract dollars: bid, contract, retainage, bonded. Costs ability. */
export async function saveJobMoneyAction(zoneId: string, raw: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ costs: true })
  const job = await jobOf(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { money, error } = cleanMoney(raw)
  if (!money) return { ok: false, error: error ?? 'Nothing to save.' }
  const { error: e2 } = await svc.from('job_money').upsert({
    job_id: job.id, company_id: companyId, bid_amount: money.bidAmount, contract_amount: money.contractAmount,
    retainage_pct: money.retainagePct, stored_retainage_pct: money.storedRetainagePct, bonded: money.bonded,
    updated_by: userId, updated_at: new Date().toISOString(),
  })
  if (e2) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(zoneId)
  return { ok: true }
}

/**
 * The next job number, put on the job AND at the front of the zone name —
 * DCG's one name for zone, folder and QuickBooks customer ("26-085 Name").
 */
export async function assignNumberAction(zoneId: string): Promise<Res<{ number: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const site = await ownSite(svc, companyId, zoneId)
  const job = site ? await jobOf(svc, companyId, site.id) : null
  if (!site || !job) return { ok: false, error: 'That job wasn’t found.' }
  const parsed = parseJobName(site.name)
  const number = parsed.code ?? nextJobNumber(await usedNumbers(svc, companyId), new Date().getFullYear())
  const { error } = await svc.from('jobs').update({ number, updated_at: new Date().toISOString() }).eq('id', job.id).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  if (!parsed.code) {
    const name = `${parsed.done ? 'Z' : ''}${number} ${parsed.activeName}`.slice(0, 200)
    await svc.from('geofences').update({ name }).eq('id', site.id).eq('company_id', companyId)
    revalidatePath('/zones'); revalidatePath('/map')
  }
  refresh(site.id)
  return { ok: true, number }
}

// ── The checklist ───────────────────────────────────────────────────────────

async function itemOf(svc: Svc, companyId: string, itemId: string): Promise<{ id: string; job_id: string; zoneId: string } | null> {
  if (!UUID.test(itemId)) return null
  const { data } = await svc.from('job_checklist').select('id, job_id').eq('id', itemId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!data) return null
  const { data: j } = await svc.from('jobs').select('geofence_id').eq('id', data.job_id).eq('company_id', companyId).maybeSingle()
  return j ? { id: String(data.id), job_id: String(data.job_id), zoneId: String(j.geofence_id) } : null
}

export async function checkItemAction(itemId: string, done: boolean): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const it = await itemOf(svc, companyId, itemId)
  if (!it) return { ok: false, error: 'That item wasn’t found.' }
  const { error } = await svc.from('job_checklist').update(done ? { done_at: new Date().toISOString(), done_by: userId } : { done_at: null, done_by: null })
    .eq('id', it.id).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(it.zoneId)
  return { ok: true }
}

export async function noteItemAction(itemId: string, note: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const it = await itemOf(svc, companyId, itemId)
  if (!it) return { ok: false, error: 'That item wasn’t found.' }
  const text = typeof note === 'string' ? note.trim().slice(0, 500) : ''
  const { error } = await svc.from('job_checklist').update({ note: text || null }).eq('id', it.id).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(it.zoneId)
  return { ok: true }
}

export async function addItemAction(zoneId: string, stage: string, text: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!isCheckStage(stage)) return { ok: false, error: 'Pick a section.' }
  const t = typeof text === 'string' ? text.trim().slice(0, 300) : ''
  if (!t) return { ok: false, error: 'Say what needs doing.' }
  const job = await jobOf(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { count } = await svc.from('job_checklist').select('id', { count: 'exact', head: true }).eq('job_id', job.id).is('deleted_at', null)
  if ((count ?? 0) >= 300) return { ok: false, error: 'That checklist is full.' }
  const { error } = await svc.from('job_checklist').insert({ company_id: companyId, job_id: job.id, stage: stage as CheckStage, sort: 1000 + (count ?? 0), text: t })
  if (error) return { ok: false, error: 'Couldn’t add it — try again.' }
  refresh(zoneId)
  return { ok: true }
}

export async function removeItemAction(itemId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const it = await itemOf(svc, companyId, itemId)
  if (!it) return { ok: false, error: 'That item wasn’t found.' }
  const { error } = await svc.from('job_checklist').update({ deleted_at: new Date().toISOString() }).eq('id', it.id).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t remove it — try again.' }
  refresh(it.zoneId)
  return { ok: true }
}

/** The company's checklist template — what every NEW job starts with. Managers and above. */
export async function saveTemplateAction(raw: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ managers: true })
  const items = cleanTemplate(raw)
  if (!items.length) return { ok: false, error: 'A checklist needs at least one item.' }
  const { error } = await svc.from('job_templates').upsert({ company_id: companyId, checklist: items, updated_by: userId, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  revalidatePath('/jobs')
  return { ok: true }
}

// ── Contacts ────────────────────────────────────────────────────────────────

export async function saveContactAction(zoneId: string, raw: unknown, id?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const job = await jobOf(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { contact, error } = cleanContact(raw)
  if (!contact) return { ok: false, error: error ?? 'Nothing to save.' }
  const row = { role: contact.role, company_name: contact.companyName, name: contact.name, email: contact.email, phone: contact.phone, note: contact.note }
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Bad contact' }
    const { data, error: e } = await svc.from('job_contacts').update(row).eq('id', id).eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (e || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  } else {
    const { count } = await svc.from('job_contacts').select('id', { count: 'exact', head: true }).eq('job_id', job.id).is('deleted_at', null)
    if ((count ?? 0) >= 150) return { ok: false, error: 'That’s a lot of contacts for one job.' }
    const { error: e } = await svc.from('job_contacts').insert({ ...row, company_id: companyId, job_id: job.id })
    if (e) return { ok: false, error: 'Couldn’t save — try again.' }
  }
  refresh(zoneId)
  return { ok: true }
}

export async function deleteContactAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(id)) return { ok: false, error: 'Bad contact' }
  const { data } = await svc.from('job_contacts').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId).is('deleted_at', null).select('job_id').maybeSingle()
  if (data) {
    const { data: j } = await svc.from('jobs').select('geofence_id').eq('id', data.job_id).maybeSingle()
    refresh(j ? String(j.geofence_id) : null)
  }
  return { ok: true }
}

// ── From the estimate ───────────────────────────────────────────────────────

/**
 * The estimate was won: the site's job moves to Awarded (made if it wasn't on
 * the log), remembers the estimate, and takes the bid total — and the contract
 * amount too while none is typed in. The figure is the one the estimate page
 * computed and showed; every number on the job stays editable.
 */
export async function winEstimateAction(zoneId: string, estimateId: string, bidTotal: number | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, userId, svc } = await writer()
  if (!UUID.test(estimateId)) return { ok: false, error: 'Bad estimate' }
  const site = await ownSite(svc, companyId, zoneId)
  if (!site) return { ok: false, error: 'That site wasn’t found.' }
  const { data: est } = await svc.from('estimates').select('id').eq('id', estimateId).eq('company_id', companyId).eq('geofence_id', site.id).is('deleted_at', null).maybeSingle()
  if (!est) return { ok: false, error: 'That estimate wasn’t found.' }
  let job = await jobOf(svc, companyId, site.id)
  if (!job) {
    const made = await createJobAction(site.id, { stage: 'awarded' })
    if (!made.ok) return made
    job = await jobOf(svc, companyId, site.id)
    if (!job) return { ok: false, error: 'Couldn’t start the job — try again.' }
  }
  const before = ['estimating', 'submitted', 'lost', 'no_bid'].includes(job.stage)
  const row: Record<string, unknown> = { estimate_id: est.id, updated_at: new Date().toISOString() }
  if (before) {
    row.stage = 'awarded'
    if (!job.award_date) row.award_date = today()
  }
  await svc.from('jobs').update(row).eq('id', job.id).eq('company_id', companyId)
  if (perms.canViewCosts && typeof bidTotal === 'number' && Number.isFinite(bidTotal) && bidTotal >= 0 && bidTotal <= 1e9) {
    const { data: m } = await svc.from('job_money').select('contract_amount').eq('job_id', job.id).maybeSingle()
    const amt = Math.round(bidTotal * 100) / 100
    await svc.from('job_money').upsert({
      job_id: job.id, company_id: companyId, bid_amount: amt,
      contract_amount: m?.contract_amount ?? amt, updated_by: userId, updated_at: new Date().toISOString(),
    })
  }
  refresh(site.id)
  return { ok: true }
}
