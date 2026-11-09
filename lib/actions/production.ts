'use server'

/**
 * Production's writes (migration 160). Members hold SELECT only (never the bid
 * unit cost); every write runs on the service client after the edit + Jobs
 * checks. The day's quantities are anyone who can edit with Jobs open — the
 * foreman. The item list is a Manager's; the bid unit cost is written only by
 * a login that can see costs (a Manager without costs keeps what is there).
 */
import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dayKey, safeTz } from '@/lib/dates'
import { isProdUnit, itemsFromEstimate, readQty } from '@/lib/jobs/production'
import { readDollars } from '@/lib/jobs/payapp'
import { MAX_ITEMS } from '@/lib/db/production'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('jobs')) throw new Error('Jobs aren’t open for your login.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('The item list is for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}

const refresh = (zoneId: string) => { revalidatePath(`/jobs/${zoneId}/production`); revalidatePath(`/jobs/${zoneId}`) }
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null)

/** The job on this site — never a personal zone's (a job's site is always a company site, 151/152). */
async function jobId(svc: Svc, companyId: string, zoneId: string): Promise<string | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('jobs').select('id').eq('geofence_id', zoneId).eq('company_id', companyId).maybeSingle()
  return data ? String(data.id) : null
}

async function itemCount(svc: Svc, job: string) {
  const { count } = await svc.from('job_items').select('id', { count: 'exact', head: true }).eq('job_id', job).is('deleted_at', null)
  return count ?? 0
}

// ── The day's quantities (the foreman) ──────────────────────────────────────

/**
 * One day's numbers for any of the items: a number replaces that day's,
 * blank removes it. A day in the future is refused; so is one more than two
 * years back.
 */
export async function saveDayAction(zoneId: string, day: string, rows: { itemId: string; qty: unknown; note?: unknown }[]): Promise<Res<{ saved: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in to log quantities.' }
  const { companyId, userId, svc } = await writer()
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  if (typeof day !== 'string' || !DAY.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return { ok: false, error: 'Pick the day.' }
  const { data: co } = await svc.from('companies').select('digest_prefs').eq('id', companyId).maybeSingle()
  const tzRaw = (co?.digest_prefs as { tz?: unknown } | null)?.tz
  const today = dayKey(Date.now(), safeTz(typeof tzRaw === 'string' ? tzRaw : null))
  if (day > today) return { ok: false, error: 'That day hasn’t happened yet.' }
  if (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`) > 731 * 86_400_000) return { ok: false, error: 'That day is more than two years back.' }
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ITEMS) return { ok: false, error: 'Nothing to save.' }

  const { data: own } = await svc.from('job_items').select('id').eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).limit(MAX_ITEMS)
  const ids = new Set((own ?? []).map((r) => String(r.id)))
  const put: { company_id: string; job_id: string; item_id: string; day: string; qty: number; note: string | null; entered_by: string | null; updated_at: string }[] = []
  const drop: string[] = []
  const at = new Date().toISOString()
  for (const r of rows) {
    if (!r || typeof r.itemId !== 'string' || !ids.has(r.itemId)) return { ok: false, error: 'One of those items is no longer on the job — refresh and try again.' }
    const q = readQty(r.qty)
    if (q === 'bad') return { ok: false, error: 'One of the numbers can’t be read — numbers only, no minus.' }
    if (q === null) { drop.push(r.itemId); continue }
    if (q > 100_000_000) return { ok: false, error: 'One of the numbers is too big.' }
    put.push({ company_id: companyId, job_id: job, item_id: r.itemId, day, qty: Math.round(q * 1000) / 1000, note: clip(r.note, 300), entered_by: userId, updated_at: at })
  }
  if (put.length) {
    const { error } = await svc.from('job_quantities').upsert(put, { onConflict: 'item_id,day' })
    if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  }
  if (drop.length) await svc.from('job_quantities').delete().eq('job_id', job).eq('company_id', companyId).eq('day', day).in('item_id', drop)
  refresh(zoneId)
  return { ok: true, saved: put.length }
}

// ── The item list (Managers) ────────────────────────────────────────────────

export async function saveItemAction(zoneId: string, raw: { code?: unknown; name?: unknown; unit?: unknown; budgetQty?: unknown; bidPerDay?: unknown; bidUnitCost?: unknown; crew?: unknown }, id?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  const name = clip(raw?.name, 120)
  if (!name) return { ok: false, error: 'Name the item.' }
  if (!isProdUnit(raw?.unit)) return { ok: false, error: 'Pick its unit.' }
  const qty = readQty(raw?.budgetQty)
  if (qty === 'bad' || qty === null || !(qty > 0) || qty > 100_000_000) return { ok: false, error: 'Give it the bid quantity.' }
  const per = readQty(raw?.bidPerDay)
  if (per === 'bad' || (per !== null && (!(per > 0) || per > 100_000_000))) return { ok: false, error: 'The bid production per day can’t be read.' }
  const row: Record<string, unknown> = { code: clip(raw?.code, 40), name, unit: raw.unit, budget_qty: Math.round(qty * 1000) / 1000, bid_per_day: per, crew_name: clip(raw?.crew, 80) }
  if (perms.canViewCosts && raw && 'bidUnitCost' in raw) {
    const c = readDollars(raw.bidUnitCost, false)
    if (c === 'bad') return { ok: false, error: 'The bid unit cost can’t be read.' }
    row.bid_unit_cost = c
  }
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Bad item' }
    const { data, error } = await svc.from('job_items').update(row).eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  } else {
    const n = await itemCount(svc, job)
    if (n >= MAX_ITEMS) return { ok: false, error: `${MAX_ITEMS} items at most.` }
    // after the last item, deleted ones included (a live count can repeat a number)
    const { data: last } = await svc.from('job_items').select('sort').eq('job_id', job).order('sort', { ascending: false }).limit(1).maybeSingle()
    const { error } = await svc.from('job_items').insert({ ...row, company_id: companyId, job_id: job, sort: Number(last?.sort ?? 0) + 1 })
    if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  }
  refresh(zoneId)
  return { ok: true }
}

export async function deleteItemAction(zoneId: string, id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That item wasn’t found.' }
  await svc.from('job_items').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('job_id', job).eq('company_id', companyId)
  refresh(zoneId)
  return { ok: true }
}

/** The item list from the site's estimate — every line with a quantity, its direct unit cost and production rate. Only on an empty list. */
export async function itemsFromEstimateAction(zoneId: string): Promise<Res<{ items: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await writer({ managers: true })
  if (!perms.canViewCosts) return { ok: false, error: 'Building from the estimate needs a login that can see costs.' }
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  if (await itemCount(svc, job)) return { ok: false, error: 'The job already has items.' }
  const [{ getEstimate, getCostBook }, E] = await Promise.all([import('@/lib/db/estimate'), import('@/lib/estimate/engine')])
  const admin = rankOf(perms) >= RANK.admin
  const [{ estimate, distances }, book] = await Promise.all([getEstimate(zoneId, admin), getCostBook(admin)])
  if (!estimate) return { ok: false, error: 'This site has no estimate to build it from.' }
  const dist = new Map(Object.entries(distances))
  const shopSrc = book.sources.find((x) => x.kind === 'shop' && dist.has(x.id))
  const ctx = { materials: book.materials, prices: book.prices, sources: book.sources, distances: dist, settings: book.settings, shop: shopSrc ? dist.get(shopSrc.id)! : null }
  const costs = new Map<string, { total: number; unitCost: number | null }>()
  for (const line of estimate.lines) {
    const k = E.lineCost(line, ctx)
    costs.set(line.id, { total: k.total, unitCost: k.unitCost })
  }
  const items = itemsFromEstimate(estimate.lines, costs, (key) => book.settings.crews.find((c) => c.key === key)?.name ?? null).slice(0, MAX_ITEMS)
  if (!items.length) return { ok: false, error: 'The estimate has no quantities yet.' }
  const { error } = await svc.from('job_items').insert(items.map((it) => ({
    company_id: companyId, job_id: job, code: it.code, name: it.name, unit: it.unit, budget_qty: it.budgetQty,
    bid_per_day: it.bidPerDay, bid_unit_cost: it.bidUnitCost, crew_name: it.crew, sort: it.sort,
  })))
  if (error) return { ok: false, error: 'Couldn’t build it — try again.' }
  refresh(zoneId)
  return { ok: true, items: items.length }
}
