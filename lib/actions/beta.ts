'use server'

/**
 * The Beta section's writes (migration 162). Members hold SELECT only; every
 * write runs on the service client after the session checks. Who may write
 * what is by kind (WRITE_RULE): the crew files inspections and their own
 * cards; foremen log 811 tickets and haul tickets; managers keep the lien
 * sheets, wage decisions and payroll classes; dollars need the costs ability.
 * A linked site / machine / person must be the caller's company's — never a
 * personal zone, never another company's machine.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK, type Permissions } from '@/lib/permissions'
import { BETA_KINDS, COSTS_ONLY_KINDS, KINDS, cleanRecord, type BetaKind } from '@/lib/beta/registers'
import { cleanDvir, dvirStatus, itemLabel, type Dvir } from '@/lib/beta/dvir'
import { toolByKey, type ToolKey } from '@/lib/beta/tools'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

const PAGE: Record<BetaKind, string> = {
  locate: '/beta/locates', rental: '/beta/rentals', credential: '/beta/credentials', lien: '/beta/liens', owning: '/beta/owning',
  haul_ticket: '/beta/haul', wage_rate: '/beta/payroll', worker_class: '/beta/payroll', dvir: '/beta/dvir',
}

/** The Beta tool each kind belongs to — a write needs that tool open for the
 *  login (lib/beta/tools.ts), the same rule as the tool's page. */
const TOOL_OF: Record<BetaKind, ToolKey> = {
  locate: 'locates', rental: 'rentals', credential: 'credentials', lien: 'liens', owning: 'owning',
  haul_ticket: 'haul', wage_rate: 'payroll', worker_class: 'payroll', dvir: 'dvir',
}
const toolOpen = (kind: BetaKind, p: Permissions) => toolByKey(TOOL_OF[kind]).canOpen(p, false)

/** Who may write each kind (beyond Beta being open for them). */
function mayWrite(kind: BetaKind, p: Permissions): string | null {
  const rank = rankOf(p)
  if (!toolOpen(kind, p)) return 'That tool isn’t open for your login.'
  if (COSTS_ONLY_KINDS.includes(kind) && !p.canViewCosts) return 'This one carries dollar figures — your login doesn’t see them.'
  switch (kind) {
    case 'dvir': case 'credential': return null // the crew's own; credentials re-check the person below
    case 'locate': case 'haul_ticket': return p.canEdit && rank >= RANK.foreman ? null : 'Foreman and up log these.'
    case 'rental': return p.canEdit && rank >= RANK.foreman ? null : 'Foreman and up keep the rentals.'
    case 'lien': case 'wage_rate': case 'worker_class': case 'owning': return p.canEdit && rank >= RANK.manager ? null : 'Managers and up keep these.'
  }
}

type PersonRef = { id: string; role: string | null; isMaster: boolean }
/** A person's cards and pay follow the ladder: cards — your own, or Foreman+
 *  for the people below you; pay — strictly below you (the owner: anyone). A
 *  person no longer on the roster is the owner's business alone (164's SQL). */
async function ladderRefusal(kind: BetaKind, person: PersonRef | null | 'gone', p: Permissions, userId: string): Promise<string | null> {
  if (kind !== 'credential' && kind !== 'worker_class') return null
  if (!person) return null
  if (person === 'gone') return p.isMaster ? null : 'That person isn’t on the team any more — only the owner can change this.'
  const { outranks, normalizeRole } = await import('@/lib/permissions')
  const target = { role: normalizeRole(person.role, 'associate'), isMaster: person.isMaster }
  const self = person.id === userId
  if (kind === 'credential' && !self && !(rankOf(p) >= RANK.foreman && outranks(p, target)))
    return 'You can add your own cards; Foreman and up add them for the people below them.'
  if (kind === 'worker_class' && !p.isMaster && !outranks(p, target)) return 'Pay is set by someone above that person.'
  return null
}
/** The stored person of a record, for the ladder check: none, gone from the team, or their profile. */
async function storedPerson(svc: Svc, companyId: string, personId: unknown): Promise<PersonRef | null | 'gone'> {
  if (!personId) return null
  const r = await personOf(svc, companyId, personId)
  return r && r !== 'bad' ? r : 'gone'
}
/** May this login see the record's machine (111's ladder on the effective role)? */
async function storedAssetVisible(svc: Svc, companyId: string, assetId: unknown, p: Permissions): Promise<boolean> {
  if (!assetId) return true
  const { data } = await svc.from('assets').select('metadata, type').eq('id', String(assetId)).eq('company_id', companyId).maybeSingle()
  if (!data) return false
  const { canSeeAsset } = await import('@/lib/permissions')
  return canSeeAsset(p, data.metadata, data.type as string)
}

async function caller() {
  const perms = await getMyPermissions()
  if (perms.viewingAs) throw new Error('You’re previewing another login — exit the preview to write.')
  if (isProspect(perms) || !perms.features.includes('beta')) throw new Error('Beta isn’t open for your login.')
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const sb = createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: profile } = await sb.from('profiles').select('company_id, name').eq('id', user.id).single()
  if (!profile?.company_id) throw new Error('Not signed in')
  return { perms, userId: user.id, companyId: String(profile.company_id), name: (profile.name as string | null) || user.email || 'Crew', svc: createServiceClient() }
}

async function siteOf(svc: Svc, companyId: string, raw: unknown): Promise<{ id: string; name: string } | null | 'bad'> {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string' || !UUID.test(raw)) return 'bad'
  const { data } = await svc.from('geofences').select('id, name, owner_id, kind').eq('id', raw).eq('company_id', companyId).maybeSingle()
  if (!data || data.owner_id || data.kind === 'boundary' || data.kind === 'vendor') return 'bad'
  return { id: String(data.id), name: String(data.name) }
}
async function assetOf(svc: Svc, companyId: string, raw: unknown, perms: Permissions): Promise<{ id: string; name: string } | null | 'bad'> {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string' || !UUID.test(raw)) return 'bad'
  const { data } = await svc.from('assets').select('id, name, metadata, type, active').eq('id', raw).eq('company_id', companyId).maybeSingle()
  if (!data || !data.active) return 'bad'
  const { canSeeAsset } = await import('@/lib/permissions')
  if (!canSeeAsset(perms, data.metadata, data.type as string)) return 'bad'
  return { id: String(data.id), name: String(data.name) }
}
async function personOf(svc: Svc, companyId: string, raw: unknown): Promise<{ id: string; name: string; role: string | null; isMaster: boolean } | null | 'bad'> {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string' || !UUID.test(raw)) return 'bad'
  const { data } = await svc.from('profiles').select('id, name, role').eq('id', raw).eq('company_id', companyId).maybeSingle()
  if (!data || data.role === 'prospect') return 'bad'
  return { id: String(data.id), name: (data.name as string | null) || 'Teammate', role: (data.role as string | null) ?? null, isMaster: String(data.id) === companyId }
}

/** Save (insert or update) a record of a kind from its form. */
export async function saveBetaRecordAction(raw: { kind?: unknown; id?: unknown; siteId?: unknown; assetId?: unknown; personId?: unknown; data?: unknown }): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in to save.' }
  const kind = typeof raw?.kind === 'string' && (BETA_KINDS as string[]).includes(raw.kind) ? (raw.kind as BetaKind) : null
  if (!kind || kind === 'dvir') return { ok: false, error: 'Unknown record.' }
  const { perms, userId, companyId, svc } = await caller()
  const refused = mayWrite(kind, perms)
  if (refused) return { ok: false, error: refused }
  const def = KINDS[kind]
  const site = await siteOf(svc, companyId, raw.siteId)
  const asset = await assetOf(svc, companyId, raw.assetId, perms)
  const person = await personOf(svc, companyId, raw.personId)
  if (site === 'bad' || asset === 'bad' || person === 'bad') return { ok: false, error: 'That site, machine or person wasn’t found.' }
  if (def.links.site === 'required' && !site) return { ok: false, error: 'Pick the site.' }
  if (def.links.asset === 'required' && !asset) return { ok: false, error: 'Pick the machine.' }
  if (def.links.person === 'required' && !person) return { ok: false, error: 'Pick the person.' }
  // only the links the kind takes
  const siteId = def.links.site ? site?.id ?? null : null
  const assetId = def.links.asset ? asset?.id ?? null : null
  const personId = def.links.person ? person?.id ?? null : null
  // a crew member's cards: their own, or Foreman+ for people below them; pay: strictly below (or the Master)
  const ladder = await ladderRefusal(kind, person, perms, userId)
  if (ladder) return { ok: false, error: ladder }

  const id = typeof raw.id === 'string' && UUID.test(raw.id) ? raw.id : null
  let prior: Record<string, unknown> | null = null
  if (id) {
    const { data } = await svc.from('beta_records').select('id, kind, data, person_id, asset_id').eq('id', id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
    if (!data || data.kind !== kind) return { ok: false, error: 'That record wasn’t found.' }
    // a record stays with its person: an edit can't move a card or a pay class to someone else
    if (def.links.person && (data.person_id ?? null) !== personId) return { ok: false, error: 'A record can’t be moved to another person — add a new one for them.' }
    // the STORED person passes the ladder too (the form's person could be anyone)
    const storedLadder = await ladderRefusal(kind, await storedPerson(svc, companyId, data.person_id), perms, userId)
    if (storedLadder) return { ok: false, error: storedLadder }
    if (!(await storedAssetVisible(svc, companyId, data.asset_id, perms))) return { ok: false, error: 'That record wasn’t found.' }
    prior = (data.data as Record<string, unknown>) ?? {}
  }
  const cleaned = cleanRecord(kind, raw.data, { site: site?.name, asset: asset?.name, person: person?.name }, perms.canViewCosts)
  if (!cleaned.ok) return cleaned
  // a save without the costs ability keeps the dollar fields it can't see
  const data = prior && !perms.canViewCosts
    ? { ...Object.fromEntries(Object.entries(prior).filter(([k]) => def.fields.some((f) => f.key === k && f.money))), ...cleaned.value.data }
    : cleaned.value.data
  const row = {
    company_id: companyId, kind, geofence_id: siteId, asset_id: assetId, person_id: personId,
    title: cleaned.value.title, data, due_on: cleaned.value.dueOn, costs_only: COSTS_ONLY_KINDS.includes(kind), updated_at: new Date().toISOString(),
  }
  if (id) {
    const { error } = await svc.from('beta_records').update(row).eq('id', id).eq('company_id', companyId)
    if (error) return { ok: false, error: error.code === '23505' ? 'There’s already one of these for that.' : 'Couldn’t save — try again.' }
    revalidatePath(PAGE[kind])
    return { ok: true, id }
  }
  // a company can't flood a table: 2,000 new records a day is far past any real one
  const { count } = await svc.from('beta_records').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if ((count ?? 0) >= 2000) return { ok: false, error: 'That’s a lot for one day — try again tomorrow.' }
  const { data: ins, error } = await svc.from('beta_records').insert({ ...row, created_by: userId }).select('id').single()
  if (error || !ins) return { ok: false, error: error?.code === '23505' ? 'There’s already one of these for that — edit it instead.' : 'Couldn’t save — try again.' }
  revalidatePath(PAGE[kind])
  revalidatePath('/beta')
  return { ok: true, id: String(ins.id) }
}

/** Remove a record (soft). Its author, or Manager and up; a dollar row needs costs. */
export async function deleteBetaRecordAction(raw: { id?: unknown }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode.' }
  const id = typeof raw?.id === 'string' && UUID.test(raw.id) ? raw.id : null
  if (!id) return { ok: false, error: 'Nothing to remove.' }
  const { perms, userId, companyId, svc } = await caller()
  const { data } = await svc.from('beta_records').select('id, kind, created_by, person_id, asset_id, data').eq('id', id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!data) return { ok: false, error: 'That record wasn’t found.' }
  const kind = data.kind as BetaKind
  if (!toolOpen(kind, perms)) return { ok: false, error: 'That record wasn’t found.' }
  if (COSTS_ONLY_KINDS.includes(kind) && !perms.canViewCosts) return { ok: false, error: 'That record wasn’t found.' }
  if (!(await storedAssetVisible(svc, companyId, data.asset_id, perms))) return { ok: false, error: 'That record wasn’t found.' }
  const mine = data.created_by === userId || (kind === 'credential' && data.person_id === userId)
  if (!mine && rankOf(perms) < RANK.manager) return { ok: false, error: 'Only whoever added it, or a Manager, can remove it.' }
  // a person's cards and pay: that person, or someone above them
  if (kind === 'credential' || kind === 'worker_class') {
    const who = await storedPerson(svc, companyId, data.person_id)
    if (who && who !== 'gone' && who.id !== userId) {
      const { outranks, normalizeRole } = await import('@/lib/permissions')
      if (!outranks(perms, { role: normalizeRole(who.role, 'associate'), isMaster: who.isMaster })) return { ok: false, error: 'Only that person, or someone above them, can remove it.' }
    } else if (who === 'gone' && !perms.isMaster) return { ok: false, error: 'That person isn’t on the team any more — only the owner can remove this.' }
  }
  // an inspection that found defects is a safety record: only a Manager removes it, never its author alone
  if (kind === 'dvir' && Array.isArray((data.data as Dvir | null)?.defects) && (data.data as Dvir).defects.length && rankOf(perms) < RANK.manager)
    return { ok: false, error: 'An inspection with defects stays on file — a Manager can remove it.' }
  await svc.from('beta_records').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId)
  revalidatePath(PAGE[kind])
  revalidatePath('/beta')
  return { ok: true }
}

// ── Inspections (DVIR) ──────────────────────────────────────────────────────

/** File a driver's inspection. Each defect opens a work order on the machine. */
export async function fileDvirAction(raw: { assetId?: unknown; report?: unknown }): Promise<Res<{ id: string; unsafe: boolean; workOrders: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in to file an inspection.' }
  const { perms, userId, companyId, name, svc } = await caller()
  if (!toolOpen('dvir', perms)) return { ok: false, error: 'Inspections aren’t open for your login.' }
  const asset = await assetOf(svc, companyId, raw?.assetId, perms)
  if (!asset || asset === 'bad') return { ok: false, error: 'Pick the vehicle.' }
  const c = cleanDvir(raw?.report, new Date().toISOString())
  if (!c.ok) return c
  const { count } = await svc.from('beta_records').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('kind', 'dvir').eq('created_by', userId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if ((count ?? 0) >= 40) return { ok: false, error: 'That’s a lot of inspections for one day.' }
  const report: Dvir = { ...c.value, driverName: name.slice(0, 80) }
  const status = dvirStatus(report)
  const { data: ins, error } = await svc.from('beta_records').insert({
    company_id: companyId, kind: 'dvir', asset_id: asset.id, title: KINDS.dvir.title(report as unknown as Record<string, unknown>, { asset: asset.name }),
    data: report, status: report.defects.length ? 'open' : 'closed', costs_only: false, created_by: userId,
  }).select('id').single()
  if (error || !ins) return { ok: false, error: 'Couldn’t file it — try again.' }
  // every defect is a work order, so it can't be signed and forgotten
  const woIds: string[] = []
  for (const d of report.defects) {
    const { data: wo } = await svc.from('work_orders').insert({
      company_id: companyId, asset_id: asset.id, title: `DVIR: ${itemLabel(d.item)}${d.severity === 'oos' ? ' — OUT OF SERVICE' : ''}`.slice(0, 160),
      detail: [`${report.when === 'post' ? 'Post-trip' : 'Pre-trip'} inspection by ${report.driverName}.`, d.note].filter(Boolean).join(' ').slice(0, 2000),
      source: 'manual', source_ref: `dvir:${ins.id}:${d.item}`, priority: d.severity === 'oos' ? 'urgent' : 'normal', status: 'open', created_by: userId,
    }).select('id').single()
    if (wo) woIds.push(String(wo.id))
  }
  if (woIds.length) await svc.from('beta_records').update({ data: { ...report, workOrderIds: woIds } }).eq('id', ins.id)
  revalidatePath('/beta/dvir')
  revalidatePath('/maintenance')
  return { ok: true, id: String(ins.id), unsafe: status.state === 'unsafe', workOrders: woIds.length }
}

/** A mechanic certifies the defects repaired (or that repair isn't needed) — Foreman and up with edit. */
export async function certifyDvirAction(raw: { id?: unknown; outcome?: unknown; note?: unknown }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode.' }
  const { perms, companyId, name, svc } = await caller()
  if (!toolOpen('dvir', perms)) return { ok: false, error: 'Inspections aren’t open for your login.' }
  if (!perms.canEdit || rankOf(perms) < RANK.foreman) return { ok: false, error: 'A foreman, mechanic lead or manager signs this off.' }
  const id = typeof raw?.id === 'string' && UUID.test(raw.id) ? raw.id : null
  if (!id) return { ok: false, error: 'Nothing to certify.' }
  const { data } = await svc.from('beta_records').select('id, data, asset_id').eq('id', id).eq('company_id', companyId).eq('kind', 'dvir').is('deleted_at', null).maybeSingle()
  if (!data || !(await storedAssetVisible(svc, companyId, data.asset_id, perms))) return { ok: false, error: 'That inspection wasn’t found.' }
  const report = data.data as Dvir
  if (!report.defects?.length) return { ok: false, error: 'No defects to certify.' }
  if (report.repair) return { ok: false, error: 'Already certified.' }
  const outcome = raw?.outcome === 'not_needed' ? 'not_needed' : 'repaired'
  const note = typeof raw?.note === 'string' ? raw.note.trim().slice(0, 400) : undefined
  await svc.from('beta_records').update({ data: { ...report, repair: { by: name.slice(0, 80), at: new Date().toISOString(), outcome, note } }, status: 'closed', updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/beta/dvir')
  return { ok: true }
}

/** The next driver signs that they saw the certification (396.11(a)(3)). */
export async function reviewDvirAction(raw: { id?: unknown }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode.' }
  const { perms, companyId, name, svc } = await caller()
  if (!toolOpen('dvir', perms)) return { ok: false, error: 'Inspections aren’t open for your login.' }
  const id = typeof raw?.id === 'string' && UUID.test(raw.id) ? raw.id : null
  if (!id) return { ok: false, error: 'Nothing to review.' }
  const { data } = await svc.from('beta_records').select('id, data, asset_id').eq('id', id).eq('company_id', companyId).eq('kind', 'dvir').is('deleted_at', null).maybeSingle()
  if (!data || !(await storedAssetVisible(svc, companyId, data.asset_id, perms))) return { ok: false, error: 'That inspection wasn’t found.' }
  const report = data.data as Dvir
  if (!report.repair) return { ok: false, error: 'Nothing certified yet to review.' }
  if (report.reviewedBy) return { ok: false, error: 'Already reviewed.' }
  await svc.from('beta_records').update({ data: { ...report, reviewedBy: { name: name.slice(0, 80), at: new Date().toISOString() } }, updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/beta/dvir')
  return { ok: true }
}

// ── Weather-delay packet ────────────────────────────────────────────────────

export interface WeatherPacket {
  site: { id: string; name: string; lat: number; lng: number }
  job: { number: string | null; customer: string | null; contractNo: string | null }
  companyName: string
  from: string; to: string
  days: { day: string; precipIn: number | null; gustMph: number | null; tMinF: number | null; tMaxF: number | null; hours: number }[]
}

/** Read the site's daily weather (Open-Meteo archive, keyless) and its daily hours for a window. */
export async function weatherPacketAction(raw: { siteId?: unknown; from?: unknown; to?: unknown }): Promise<Res<{ packet: WeatherPacket }>> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in to build a packet.' }
  const { perms, companyId, svc } = await caller()
  if (!toolByKey('weather').canOpen(perms, false)) return { ok: false, error: 'Weather packets aren’t open for your login.' }
  if (rankOf(perms) < RANK.foreman) return { ok: false, error: 'Foreman and up build these.' }
  if (!perms.features.includes('jobs') && !perms.features.includes('zones')) return { ok: false, error: 'Sites aren’t open for your login.' }
  const { isDay } = await import('@/lib/beta/registers')
  const from = isDay(raw?.from) ? raw.from : null, to = isDay(raw?.to) ? raw.to : null
  if (!from || !to || to < from) return { ok: false, error: 'Pick a from and to date.' }
  const span = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000
  if (span > 366) return { ok: false, error: 'A year at most per packet.' }
  const { keyRateLimited } = await import('@/lib/rate-limit')
  if (keyRateLimited(companyId, 'beta-weather', 30, 10 * 60_000)) return { ok: false, error: 'That’s a lot of packets in a few minutes — try again shortly.' }
  const site = await siteOf(svc, companyId, raw?.siteId)
  if (!site || site === 'bad') return { ok: false, error: 'Pick the site.' }
  const { companySites, siteHoursByDay, companyToday, jobsBySite } = await import('@/lib/db/beta')
  const [sites, { tz, today }, jobs, co] = await Promise.all([
    companySites(companyId), companyToday(companyId), jobsBySite(companyId),
    svc.from('companies').select('name').eq('id', companyId).maybeSingle(),
  ])
  if (to >= today) return { ok: false, error: 'End the window yesterday or earlier — today isn’t finished.' }
  const s = sites.find((x) => x.id === site.id)
  if (!s || s.lat === null || s.lng === null) return { ok: false, error: 'That site has no outline to read weather at.' }
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${s.lat.toFixed(4)}&longitude=${s.lng.toFixed(4)}&start_date=${from}&end_date=${to}` +
    `&daily=precipitation_sum,wind_gusts_10m_max,temperature_2m_min,temperature_2m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${encodeURIComponent(tz)}`
  let wx: { time?: string[]; precipitation_sum?: (number | null)[]; wind_gusts_10m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; temperature_2m_max?: (number | null)[] } = {}
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 15_000)
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, error: `The weather archive didn’t answer (${res.status}) — try again in a minute.` }
    wx = ((await res.json()) as { daily?: typeof wx }).daily ?? {}
  } catch {
    return { ok: false, error: 'The weather archive didn’t answer — try again in a minute.' }
  }
  const hours = await siteHoursByDay(companyId, site.id, from, to, tz)
  const days = (wx.time ?? []).map((day, i) => ({
    day, precipIn: wx.precipitation_sum?.[i] ?? null, gustMph: wx.wind_gusts_10m_max?.[i] ?? null,
    tMinF: wx.temperature_2m_min?.[i] ?? null, tMaxF: wx.temperature_2m_max?.[i] ?? null, hours: Math.round((hours.get(day) ?? 0) * 10) / 10,
  }))
  const j = jobs.get(site.id)
  return { ok: true, packet: { site: { id: site.id, name: site.name, lat: s.lat, lng: s.lng }, job: { number: j?.number ?? null, customer: j?.customer ?? null, contractNo: j?.contractNo ?? null }, companyName: String(co.data?.name ?? 'Our company'), from, to, days } }
}
