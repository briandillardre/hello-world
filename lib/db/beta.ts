/**
 * The Beta section's reads (migration 162). Records come through the caller's
 * RLS — a dollar row (rental / owning / payroll class) is unreadable without
 * the costs ability, a crew member reads only their own cards. The facts the
 * tools lay those records against (site days, machine hours, trips, time
 * cards) are read the same way, under the caller's own policies.
 */
import type { BetaKind } from '@/lib/beta/registers'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface BetaRecord {
  id: string; kind: BetaKind; siteId: string | null; assetId: string | null; personId: string | null
  title: string; data: Record<string, unknown>; dueOn: string | null; status: 'open' | 'closed'; createdAt: string; updatedAt: string
}
export interface Named { id: string; name: string }
export interface AssetLite extends Named { type: string; icon: string | null; metadata?: unknown }

const rec = (r: Record<string, unknown>): BetaRecord => ({
  id: String(r.id), kind: r.kind as BetaKind, siteId: (r.geofence_id as string | null) ?? null, assetId: (r.asset_id as string | null) ?? null,
  personId: (r.person_id as string | null) ?? null, title: String(r.title), data: (r.data as Record<string, unknown>) ?? {},
  dueOn: (r.due_on as string | null) ?? null, status: r.status === 'closed' ? 'closed' : 'open', createdAt: String(r.created_at), updatedAt: String(r.updated_at),
})

async function db() {
  const { createClient } = await import('@/lib/supabase-server')
  return createClient()
}

/** The company's tz + today (YYYY-MM-DD in it). */
export async function companyToday(companyId: string): Promise<{ tz: string; today: string }> {
  const { dayKey, safeTz, DEFAULT_TZ } = await import('@/lib/dates')
  if (isMock) return { tz: DEFAULT_TZ, today: dayKey(Date.now(), DEFAULT_TZ) }
  try {
    const sb = await db()
    const { data } = await sb.from('companies').select('digest_prefs').eq('id', companyId).maybeSingle()
    const raw = (data?.digest_prefs as { tz?: unknown } | null)?.tz
    const tz = safeTz(typeof raw === 'string' ? raw : null)
    return { tz, today: dayKey(Date.now(), tz) }
  } catch {
    return { tz: DEFAULT_TZ, today: dayKey(Date.now(), DEFAULT_TZ) }
  }
}

export async function listRecords(companyId: string, kinds: BetaKind[], opts: { siteId?: string; limit?: number } = {}): Promise<{ available: boolean; rows: BetaRecord[] }> {
  if (isMock) return { available: false, rows: [] }
  try {
    const sb = await db()
    let q = sb.from('beta_records').select('id, kind, geofence_id, asset_id, person_id, title, data, due_on, status, created_at, updated_at')
      .eq('company_id', companyId).in('kind', kinds).order('created_at', { ascending: false }).limit(opts.limit ?? 1000)
    if (opts.siteId) q = q.eq('geofence_id', opts.siteId)
    const { data, error } = await q
    if (error) return { available: false, rows: [] }
    return { available: true, rows: (data ?? []).map(rec) }
  } catch {
    return { available: false, rows: [] }
  }
}

/** Company sites (no personal zones, boundaries, vendors) with a centre point. */
export async function companySites(companyId: string): Promise<(Named & { lat: number | null; lng: number | null })[]> {
  const { getGeofences } = await import('@/lib/db/zones')
  const fences = await getGeofences(companyId).catch(() => [])
  return fences
    .filter((f) => !f.owner_id && ((f.kind ?? 'site') === 'site' || f.kind === 'yard'))
    .map((f) => {
      const ring = (f.geometry as { type?: string; coordinates?: number[][][] } | null)?.coordinates?.[0] ?? []
      const n = ring.length || 1
      const lng = ring.length ? ring.reduce((t, p) => t + p[0], 0) / n : null
      const lat = ring.length ? ring.reduce((t, p) => t + p[1], 0) / n : null
      return { id: String(f.id), name: String(f.name), lat, lng }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Active machines and vehicles the caller may see (RLS + 111). */
export async function companyAssets(companyId: string): Promise<AssetLite[]> {
  if (isMock) {
    const { MOCK_ASSETS } = await import('@/lib/mock-data')
    return MOCK_ASSETS.filter((a) => a.type === 'vehicle' || a.type === 'equipment').map((a) => ({ id: a.id, name: a.name, type: a.type, icon: null }))
  }
  try {
    const sb = await db()
    const { data } = await sb.from('assets').select('id, name, type, metadata').eq('company_id', companyId).eq('active', true).in('type', ['vehicle', 'equipment']).order('name').limit(2000)
    return (data ?? []).map((a) => ({ id: String(a.id), name: String(a.name), type: String(a.type), icon: ((a.metadata as { icon?: string } | null)?.icon) ?? null, metadata: a.metadata }))
  } catch {
    return []
  }
}

/** The company's people (names only) — the roster the caller's RLS shows. */
export async function companyPeople(companyId: string): Promise<(Named & { role: string | null })[]> {
  if (isMock) return [{ id: 'demo-1', name: 'Foreman', role: 'foreman' }, { id: 'demo-2', name: 'Operator 1', role: 'associate' }, { id: 'demo-3', name: 'Laborer 2', role: 'associate' }]
  try {
    const sb = await db()
    const { data } = await sb.from('profiles').select('id, name, role').eq('company_id', companyId).neq('role', 'prospect').order('name').limit(1000)
    return (data ?? []).map((p) => ({ id: String(p.id), name: (p.name as string | null) || 'Teammate', role: (p.role as string | null) ?? null }))
  } catch {
    return []
  }
}

/** First and last day (company-local) our machines or crew were on each site: zone sessions + time cards. */
export async function siteDays(companyId: string, siteIds: string[], tz: string): Promise<Map<string, { first: string | null; last: string | null; liveNow: boolean }>> {
  const out = new Map<string, { first: string | null; last: string | null; liveNow: boolean }>()
  if (isMock || !siteIds.length) return out
  const { dayKey } = await import('@/lib/dates')
  const sb = await db()
  const put = (id: string, iso: string | null, which: 'first' | 'last') => {
    if (!iso) return
    const d = dayKey(Date.parse(iso), tz)
    const cur = out.get(id) ?? { first: null, last: null, liveNow: false }
    if (which === 'first' && (!cur.first || d < cur.first)) cur.first = d
    if (which === 'last' && (!cur.last || d > cur.last)) cur.last = d
    out.set(id, cur)
  }
  // a few cheap ordered reads per site (sites are few; 40 max)
  await Promise.all(siteIds.slice(0, 40).map(async (id) => {
    const [f, l, open, tf, tl] = await Promise.all([
      sb.from('zone_sessions').select('entered_at').eq('company_id', companyId).eq('geofence_id', id).order('entered_at', { ascending: true }).limit(1),
      sb.from('zone_sessions').select('exited_at, entered_at').eq('company_id', companyId).eq('geofence_id', id).order('entered_at', { ascending: false }).limit(1),
      sb.from('zone_sessions').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('geofence_id', id).is('exited_at', null),
      sb.from('time_entries').select('clock_in_at').eq('company_id', companyId).eq('project_geofence_id', id).order('clock_in_at', { ascending: true }).limit(1),
      sb.from('time_entries').select('clock_in_at').eq('company_id', companyId).eq('project_geofence_id', id).order('clock_in_at', { ascending: false }).limit(1),
    ])
    put(id, (f.data?.[0]?.entered_at as string | undefined) ?? null, 'first')
    put(id, (tf.data?.[0]?.clock_in_at as string | undefined) ?? null, 'first')
    const lastS = l.data?.[0]
    put(id, (lastS?.exited_at as string | null) ?? (lastS?.entered_at as string | undefined) ?? null, 'last')
    put(id, (tl.data?.[0]?.clock_in_at as string | undefined) ?? null, 'last')
    if ((open.count ?? 0) > 0) { const cur = out.get(id) ?? { first: null, last: null, liveNow: false }; cur.liveNow = true; out.set(id, cur) }
  }))
  return out
}

/** Jobs on the books (stage + number + customer) by site. */
export async function jobsBySite(companyId: string): Promise<Map<string, { stage: string; number: string | null; customer: string | null; contractNo: string | null }>> {
  const out = new Map<string, { stage: string; number: string | null; customer: string | null; contractNo: string | null }>()
  if (isMock) return out
  try {
    const sb = await db()
    const { data } = await sb.from('jobs').select('geofence_id, stage, number, customer, contract_no').eq('company_id', companyId).limit(2000)
    for (const j of data ?? []) out.set(String(j.geofence_id), { stage: String(j.stage), number: (j.number as string | null) ?? null, customer: (j.customer as string | null) ?? null, contractNo: (j.contract_no as string | null) ?? null })
  } catch { /* no jobs table yet */ }
  return out
}

/** Last day each machine worked: the hours ledger (≥ 10 active minutes) or a moving fix, whichever is later. */
export async function lastWorked(companyId: string, assetIds: string[], tz: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (isMock || !assetIds.length) return out
  const { dayKey } = await import('@/lib/dates')
  const sb = await db()
  await Promise.all(assetIds.slice(0, 100).map(async (id) => {
    const [u, m] = await Promise.all([
      sb.from('usage_daily').select('day').eq('company_id', companyId).eq('asset_id', id).gte('active_secs', 600).order('day', { ascending: false }).limit(1),
      sb.from('asset_locations').select('timestamp').eq('asset_id', id).gt('speed', 2).order('timestamp', { ascending: false }).limit(1),
    ])
    const a = (u.data?.[0]?.day as string | undefined) ?? null
    const b = m.data?.[0]?.timestamp ? dayKey(Date.parse(String(m.data[0].timestamp)), tz) : null
    const best = a && b ? (a > b ? a : b) : a ?? b
    if (best) out.set(id, best)
  }))
  return out
}

/** Active hours over the last 365 days (the ledger), repairs over the last 12 months, and the rate on each machine. */
export async function machineFacts(companyId: string, assetIds: string[], withMoney: boolean): Promise<Map<string, { hoursYear: number | null; repairs12: number | null; rate: number | null }>> {
  const out = new Map<string, { hoursYear: number | null; repairs12: number | null; rate: number | null }>()
  if (isMock || !assetIds.length) return out
  const sb = await db()
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const sinceTs = new Date(Date.now() - 365 * 86_400_000).toISOString()
  await Promise.all(assetIds.slice(0, 200).map(async (id) => {
    const [u, s, w, a] = await Promise.all([
      sb.from('usage_daily').select('active_secs').eq('company_id', companyId).eq('asset_id', id).gte('day', since).limit(5000),
      withMoney ? sb.from('service_records').select('cost').eq('asset_id', id).gte('service_date', sinceTs).limit(2000) : Promise.resolve({ data: null }),
      withMoney ? sb.from('work_orders').select('parts_cost, labor_hours, labor_rate, status, service_record_id').eq('asset_id', id).gte('created_at', sinceTs).limit(2000) : Promise.resolve({ data: null }),
      withMoney ? sb.from('assets').select('hourly_rate').eq('id', id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const secs = (u.data ?? []).reduce((t, r) => t + (Number(r.active_secs) || 0), 0)
    let repairs: number | null = null
    if (s.data || w.data) {
      repairs = (s.data ?? []).reduce((t: number, r: { cost?: unknown }) => t + (Number(r.cost) || 0), 0)
      // a completed work order already wrote its service record — count only the ones that didn't
      for (const r of (w.data ?? []) as { parts_cost?: unknown; labor_hours?: unknown; labor_rate?: unknown; status?: unknown; service_record_id?: unknown }[]) {
        if (r.service_record_id || r.status === 'canceled') continue
        repairs += (Number(r.parts_cost) || 0) + (Number(r.labor_hours) || 0) * (Number(r.labor_rate) || 0)
      }
    }
    const rate = a.data ? Number((a.data as { hourly_rate?: unknown }).hourly_rate) || null : null
    out.set(id, { hoursYear: secs ? Math.round(secs / 3600) : null, repairs12: repairs, rate })
  }))
  return out
}

/** Our trucks' arrivals into a site, per truck per company-local day, in a window. */
export async function siteTrips(companyId: string, siteId: string, assetIds: string[], fromIso: string, toIso: string, tz: string): Promise<{ assetId: string; day: string; arrivals: number }[]> {
  if (isMock || !assetIds.length) return []
  const { dayKey } = await import('@/lib/dates')
  const sb = await db()
  const { data } = await sb.from('zone_sessions').select('asset_id, entered_at').eq('company_id', companyId).eq('geofence_id', siteId)
    .in('asset_id', assetIds.slice(0, 200)).gte('entered_at', fromIso).lt('entered_at', toIso).limit(10000)
  const m = new Map<string, number>()
  for (const r of data ?? []) {
    const k = `${r.asset_id}|${dayKey(Date.parse(String(r.entered_at)), tz)}`
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return Array.from(m.entries()).map(([k, n]) => { const [assetId, day] = k.split('|'); return { assetId, day, arrivals: n } })
}

/** Closed time entries in a window (every site) — the payroll's hours. */
export async function timeEntries(companyId: string, fromIso: string, toIso: string): Promise<{ userId: string; zoneId: string | null; inAt: string; outAt: string | null; breakMinutes: number; name: string }[]> {
  if (isMock) return []
  const sb = await db()
  const { data } = await sb.from('time_entries').select('user_id, person_name, project_geofence_id, clock_in_at, clock_out_at, break_minutes')
    .eq('company_id', companyId).gte('clock_in_at', fromIso).lt('clock_in_at', toIso).order('clock_in_at').limit(20000)
  return (data ?? []).map((r) => ({
    userId: String(r.user_id), zoneId: (r.project_geofence_id as string | null) ?? null, inAt: String(r.clock_in_at), outAt: (r.clock_out_at as string | null) ?? null,
    breakMinutes: Number(r.break_minutes) || 0, name: String(r.person_name || ''),
  }))
}

/** Hours on a site per company-local day: machines (the ledger's active hours) + crew (paid time-card hours). */
export async function siteHoursByDay(companyId: string, siteId: string, from: string, to: string, tz: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (isMock) return out
  const { dayKey, zonedMidnightMs, addDaysKey } = await import('@/lib/dates')
  const { shiftHours } = await import('@/lib/timecards')
  const sb = await db()
  const [u, t] = await Promise.all([
    sb.from('usage_daily').select('day, active_secs').eq('company_id', companyId).eq('geofence_id', siteId).gte('day', from).lte('day', to).limit(20000),
    sb.from('time_entries').select('clock_in_at, clock_out_at, break_minutes').eq('company_id', companyId).eq('project_geofence_id', siteId)
      .gte('clock_in_at', new Date(zonedMidnightMs(from, tz)).toISOString()).lt('clock_in_at', new Date(zonedMidnightMs(addDaysKey(to, 1), tz)).toISOString()).limit(20000),
  ])
  for (const r of u.data ?? []) out.set(String(r.day), (out.get(String(r.day)) ?? 0) + (Number(r.active_secs) || 0) / 3600)
  for (const r of t.data ?? []) {
    if (!r.clock_out_at) continue
    const d = dayKey(Date.parse(String(r.clock_in_at)), tz)
    out.set(d, (out.get(d) ?? 0) + shiftHours(String(r.clock_in_at), String(r.clock_out_at), Number(r.break_minutes) || 0, Date.now()).paid)
  }
  return out
}
