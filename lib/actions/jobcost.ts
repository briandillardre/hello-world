'use server'

/**
 * Job cost's writes (migration 155): the budget lines, the costs entered or
 * pasted from accounting, the PM's estimate at completion. Members hold
 * SELECT only (with costs); every write runs on the service client after the
 * edit + Jobs + costs checks — the 138 pattern. The budget is a Manager's
 * (the ORIGINAL budget is set once from the awarded scope; after that the
 * current budget moves by approved change orders).
 */
import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { budgetFromEstimate, isBudgetPcat, isPcat, parseCosts, toIso } from '@/lib/jobs/cost'
import { readDollars } from '@/lib/jobs/payapp'
import { MAX_JOB_COSTS } from '@/lib/db/jobcost'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('jobs')) throw new Error('Jobs aren’t open for your login.')
  if (!perms.canViewCosts) throw new Error('Job cost is for logins that can see costs.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('The budget is for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}

const refresh = (zoneId: string) => { revalidatePath(`/jobs/${zoneId}/cost`); revalidatePath(`/jobs/${zoneId}`) }
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null)

async function jobId(svc: Svc, companyId: string, zoneId: string): Promise<string | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('jobs').select('id').eq('geofence_id', zoneId).eq('company_id', companyId).maybeSingle()
  return data ? String(data.id) : null
}

async function costCount(svc: Svc, job: string): Promise<number> {
  const { count } = await svc.from('job_costs').select('id', { count: 'exact', head: true }).eq('job_id', job).is('deleted_at', null)
  return count ?? 0
}

// ── The budget ──────────────────────────────────────────────────────────────

export async function saveBudgetLineAction(zoneId: string, raw: { costCode?: string; description?: string; pcat?: string; original?: unknown }, id?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const description = clip(raw?.description, 200)
  if (!description) return { ok: false, error: 'A budget line needs a description.' }
  if (!isBudgetPcat(raw?.pcat)) return { ok: false, error: 'Pick its cost type — labor, material, subcontract, equipment or other.' }
  const original = readDollars(raw?.original)
  if (original === 'bad' || original === null) return { ok: false, error: 'Give it an amount.' }
  const row = { cost_code: clip(raw?.costCode, 40), description, pcat: raw.pcat, original }
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Bad line' }
    const { data, error } = await svc.from('job_budget_lines').update(row).eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  } else {
    const { count } = await svc.from('job_budget_lines').select('id', { count: 'exact', head: true }).eq('job_id', job).is('deleted_at', null)
    if ((count ?? 0) >= 800) return { ok: false, error: 'That’s a long budget — 800 lines at most.' }
    const { error } = await svc.from('job_budget_lines').insert({ ...row, company_id: companyId, job_id: job, sort: (count ?? 0) + 1 })
    if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  }
  refresh(zoneId)
  return { ok: true }
}

export async function deleteBudgetLineAction(zoneId: string, id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That line wasn’t found.' }
  await svc.from('job_budget_lines').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('job_id', job).eq('company_id', companyId)
  refresh(zoneId)
  return { ok: true }
}

/**
 * The original budget from the site's estimate: its DIRECT cost by section and
 * type (the markups never), the crew's cost split labor / equipment by
 * `laborSharePct`. Only on an empty budget.
 */
export async function budgetFromEstimateAction(zoneId: string, laborSharePct: number): Promise<Res<{ lines: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  if (!(Number.isFinite(laborSharePct) && laborSharePct >= 0 && laborSharePct <= 100)) return { ok: false, error: 'The labor share runs 0–100%.' }
  const { count } = await svc.from('job_budget_lines').select('id', { count: 'exact', head: true }).eq('job_id', job).is('deleted_at', null)
  if (count) return { ok: false, error: 'The budget already has lines.' }
  const [{ getEstimate, getCostBook }, E] = await Promise.all([import('@/lib/db/estimate'), import('@/lib/estimate/engine')])
  const admin = rankOf(perms) >= RANK.admin
  const [{ estimate, distances }, book] = await Promise.all([getEstimate(zoneId, admin), getCostBook(admin)])
  if (!estimate) return { ok: false, error: 'This site has no estimate to build it from.' }
  const dist = new Map(Object.entries(distances))
  const shopSrc = book.sources.find((x) => x.kind === 'shop' && dist.has(x.id))
  const ctx = { materials: book.materials, prices: book.prices, sources: book.sources, distances: dist, settings: book.settings, shop: shopSrc ? dist.get(shopSrc.id)! : null }
  const lines = budgetFromEstimate(estimate.lines.map((line) => {
    const k = E.lineCost(line, ctx)
    return { section: line.section, material: k.material, haul: k.haul, install: k.install, sub: k.sub, lowboy: k.lowboy }
  }), laborSharePct / 100)
  if (!lines.length) return { ok: false, error: 'The estimate has no costs yet.' }
  const { error } = await svc.from('job_budget_lines').insert(lines.map((l, i) => ({ company_id: companyId, job_id: job, cost_code: l.costCode, description: l.description, pcat: l.pcat, original: l.original, sort: i + 1 })))
  if (error) return { ok: false, error: 'Couldn’t build it — try again.' }
  refresh(zoneId)
  return { ok: true, lines: lines.length }
}

/** The PM's estimate at completion (null = the current budget, or the cost so far when that is more). */
export async function saveEacAction(zoneId: string, value: number | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  if (value !== null && !(Number.isFinite(value) && value >= 0 && value <= 1e9)) return { ok: false, error: 'That amount can’t be read.' }
  const { error } = await svc.from('job_money').upsert({ job_id: job, company_id: companyId, estimate_at_completion: value === null ? null : Math.round(value * 100) / 100, updated_by: userId, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(zoneId)
  return { ok: true }
}

// ── Costs entered or pasted ─────────────────────────────────────────────────

export async function saveCostAction(zoneId: string, raw: { spentOn?: string; pcat?: string; amount?: unknown; vendor?: string; reference?: string; description?: string }, id?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const spentOn = toIso(String(raw?.spentOn ?? ''))
  if (!spentOn) return { ok: false, error: 'Give it a date.' }
  if (!isPcat(raw?.pcat)) return { ok: false, error: 'Pick its cost type.' }
  const amount = readDollars(raw?.amount)
  if (amount === 'bad' || amount === null) return { ok: false, error: 'Give it an amount.' }
  const row = { spent_on: spentOn, pcat: raw.pcat, amount, vendor: clip(raw?.vendor, 120), reference: clip(raw?.reference, 60), description: clip(raw?.description, 300) }
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Bad cost' }
    const { data, error } = await svc.from('job_costs').update(row).eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  } else {
    if (await costCount(svc, job) >= MAX_JOB_COSTS) return { ok: false, error: `That job already holds ${MAX_JOB_COSTS.toLocaleString()} entered costs.` }
    const { error } = await svc.from('job_costs').insert({ ...row, company_id: companyId, job_id: job, source: 'manual', created_by: userId })
    if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  }
  refresh(zoneId)
  return { ok: true }
}

export async function deleteCostAction(zoneId: string, id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const job = await jobId(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That cost wasn’t found.' }
  await svc.from('job_costs').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('job_id', job).eq('company_id', companyId)
  refresh(zoneId)
  return { ok: true }
}

/** Paste from accounting: date, type (L M S E F R O), amount, vendor, reference, description. */
export async function importCostsAction(zoneId: string, text: string): Promise<Res<{ added: number; skipped: { line: number; why: string }[] }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const { rows, skipped } = parseCosts(String(text ?? ''))
  if (rows.length && (await costCount(svc, job)) + rows.length > MAX_JOB_COSTS) return { ok: false, error: `That would take the job past ${MAX_JOB_COSTS.toLocaleString()} entered costs.` }
  if (!rows.length) return { ok: false, error: skipped.length ? `Nothing could be read — ${skipped.slice(0, 3).map((s) => `line ${s.line}: ${s.why}`).join(' · ')}` : 'Paste the costs first.' }
  const { error } = await svc.from('job_costs').insert(rows.map((r) => ({
    company_id: companyId, job_id: job, spent_on: r.spentOn, pcat: r.pcat, amount: r.amount, vendor: r.vendor, reference: r.reference, description: r.description, source: 'import', created_by: userId,
  })))
  if (error) return { ok: false, error: 'Couldn’t add them — try again.' }
  refresh(zoneId)
  return { ok: true, added: rows.length, skipped }
}
