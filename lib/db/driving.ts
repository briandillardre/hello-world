import type { SupabaseClient } from '@supabase/supabase-js'
import {
  analyzeDay, byMonth, decodeFix, driverTotals, emptyTotals, ENGINE_VERSION, eventWords, SAFETY_METHOD, scoreTotals, sumDaily,
  vehicleClassOf, type DailyRow, type DrivingEvent, type DrivingFix, type DrivingTotals, type EventKind, type RiderTrack,
  type RowLike, type SafetyScore, type Severity, type VehicleClass, type ZoneLimit,
} from '../driving-score'
import { addDaysKey, dayKey, zonedMidnightMs } from '../dates'
import { trackerKind } from '../devices'
import { pointInPolygon } from '../alerts-engine'
import { MASTER_RANK, RANK, type Role } from '../permissions'

/**
 * Driver safety scores — the database half (migration 129). Two jobs:
 *
 *  1. BUILD (service role, the hourly /api/cron/driving): one vehicle-day at
 *     a time — read its fixes slimmed in SQL, its company's site limits, the
 *     clocked-in crew phones and the GPS spikes the ingest refused, run
 *     lib/driving-score, replace the day whole with driving_put_day.
 *  2. READ (the caller's client — RLS decides, 111 + 119 included — or the
 *     service role scoped by company for the MCP door): the period's rows
 *     summed into fleet / vehicle / driver scores, plus the events in words.
 *
 * The math lives in lib/driving-score.ts; this file only fetches and writes.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Read this far either side of a day, so a drive across midnight is whole. */
const EDGE_MS = 10 * 60_000
/** Look-back for "this truck's accelerometer events are on". */
const ACCEL_LOOKBACK_DAYS = 30

/** What gets a score: ROAD vehicles with a cellular hardware tracker
 *  (Safety Score v1 — machines and tools never enter a driving score;
 *  phones and tags are not vehicles). */
export function isScoredAsset(a: { type?: string | null; tracker_id?: string | null }): boolean {
  return a.type === 'vehicle' && /^\d{15}$/.test((a.tracker_id ?? '').trim())
}

// ── 1. Build ────────────────────────────────────────────────────────────────

interface GeofenceRow { id: string; name: string; kind: string | null; geometry: { type?: string; coordinates?: unknown[] } | null }

/** Everything one company's builds share within one cron run. */
export interface CompanyBuildCtx {
  companyId: string
  tz: string
  zones: ZoneLimit[]
  /** phone asset id → user id (tracker `phone-<uid>`). */
  phones: Map<string, string>
  /** Vehicles whose accelerometer events showed up in the last 30 days. */
  accelOn: Set<string>
  /** Per day: the clocked-in phones' tracks (loaded once, shared by every truck). */
  riders: Map<string, RiderTrack[]>
}

export async function loadCompanyCtx(db: SupabaseClient, companyId: string, tz: string, todayKey: string): Promise<CompanyBuildCtx> {
  const [rulesRes, phonesRes, accelRes] = await Promise.all([
    db.from('alert_rules').select('geofence_id, asset_id, params').eq('company_id', companyId).eq('trigger', 'speeding').eq('active', true).limit(500),
    db.from('assets').select('id, tracker_id').eq('company_id', companyId).like('tracker_id', 'phone-%').limit(2000),
    // accel_SEEN, never accel_on: the look-back must read raw evidence, or a
    // unit switched off would keep itself "measured" forever.
    db.from('driving_daily').select('asset_id').eq('company_id', companyId).eq('accel_seen', true)
      .gte('day', addDaysKey(todayKey, -ACCEL_LOOKBACK_DAYS)).limit(5000),
  ])
  const rules = ((rulesRes.data ?? []) as { geofence_id: string | null; asset_id: string | null; params: { max_mph?: unknown } | null }[])
    .filter((r) => r.geofence_id && Number(r.params?.max_mph) > 0)
  let zones: ZoneLimit[] = []
  if (rules.length) {
    const { data: fences } = await db.from('geofences_json').select('id, name, kind, geometry')
      .eq('company_id', companyId).in('id', Array.from(new Set(rules.map((r) => r.geofence_id as string))))
    const byId = new Map(((fences ?? []) as GeofenceRow[]).map((g) => [g.id, g]))
    zones = rules.flatMap((r) => {
      const g = byId.get(r.geofence_id as string)
      const ring = (g?.geometry?.type === 'Polygon' ? g.geometry.coordinates?.[0] : null) as [number, number][] | null
      return g && Array.isArray(ring) && ring.length >= 3
        ? [{ id: g.id, name: g.name, ring, limitMph: Number(r.params?.max_mph), assetId: r.asset_id }]
        : []
    })
  }
  const phones = new Map<string, string>()
  for (const p of (phonesRes.data ?? []) as { id: string; tracker_id: string }[]) {
    const uid = p.tracker_id.slice('phone-'.length)
    if (/^[0-9a-f-]{36}$/i.test(uid)) phones.set(p.id, uid)
  }
  return {
    companyId, tz, zones, phones,
    accelOn: new Set(((accelRes.data ?? []) as { asset_id: string }[]).map((r) => r.asset_id)),
    riders: new Map(),
  }
}

/** The clocked-in crew phones for one company-day — loaded once per run. */
async function ridersFor(db: SupabaseClient, ctx: CompanyBuildCtx, day: string, s0: number, s1: number): Promise<RiderTrack[]> {
  const cached = ctx.riders.get(day)
  if (cached) return cached
  let riders: RiderTrack[] = []
  if (ctx.phones.size) {
    const { data: entries } = await db.from('time_entries').select('user_id, clock_in_at, clock_out_at')
      .eq('company_id', ctx.companyId)
      .lt('clock_in_at', new Date(s1).toISOString())
      .or(`clock_out_at.is.null,clock_out_at.gt.${new Date(s0).toISOString()}`)
      .limit(2000)
    const shifts = new Map<string, [number, number][]>()
    for (const e of (entries ?? []) as { user_id: string; clock_in_at: string; clock_out_at: string | null }[]) {
      const from = Date.parse(e.clock_in_at)
      // An open entry counts to the end of the day (or now) — a forgotten
      // clock-out is never a reason to charge someone with a night's driving.
      const to = e.clock_out_at ? Date.parse(e.clock_out_at) : Math.min(s1, Date.now())
      if (!Number.isFinite(from) || !(to > from)) continue
      const list = shifts.get(e.user_id) ?? []
      list.push([from, Math.min(to, from + 18 * 3_600_000)])
      shifts.set(e.user_id, list)
    }
    const phoneIds = Array.from(ctx.phones.entries()).filter(([, uid]) => shifts.has(uid)).map(([id]) => id)
    if (phoneIds.length) {
      const { data } = await db.rpc('driving_phone_fixes', {
        p_assets: phoneIds, p_from: new Date(s0 - EDGE_MS).toISOString(), p_to: new Date(s1 + EDGE_MS).toISOString(),
      })
      const tracks = new Map<string, RiderTrack>()
      for (const row of (Array.isArray(data) ? data : []) as unknown[]) {
        if (!Array.isArray(row)) continue
        const [assetId, ms, lat, lng, speed] = row as [string, number, number, number, number | null]
        const uid = ctx.phones.get(assetId)
        if (!uid || !Number.isFinite(ms) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
        let t = tracks.get(uid)
        if (!t) tracks.set(uid, (t = { personId: uid, fixes: [], shifts: shifts.get(uid) ?? [] }))
        t.fixes.push({ ms, lat, lng, speed: typeof speed === 'number' ? speed : null })
      }
      riders = Array.from(tracks.values())
    }
  }
  ctx.riders.set(day, riders)
  return riders
}

const eventToDb = (e: DrivingEvent) => ({
  at: new Date(e.at).toISOString(), kind: e.kind, severity: e.severity, source: e.source, confirmed: e.confirmed ?? null,
  value: e.value, speed_mph: e.speedMph == null ? null : Math.round(e.speedMph),
  duration_s: e.durationS ?? null, limit_mph: e.limitMph ?? null, zone_id: e.zoneId ?? null,
  lat: e.lat, lng: e.lng, person_id: e.personId ?? null, version: ENGINE_VERSION,
})

export interface DayBuild {
  ok: boolean
  /** False when the day held no fixes of its own (nothing written). */
  wrote: boolean
  events: DrivingEvent[]
  error?: string
}

/** Rebuild one vehicle's company-local day. Idempotent. */
export async function buildVehicleDay(db: SupabaseClient, ctx: CompanyBuildCtx, assetId: string, day: string, vehicleClass: VehicleClass): Promise<DayBuild> {
  const s0 = zonedMidnightMs(day, ctx.tz)
  const s1 = zonedMidnightMs(addDaysKey(day, 1), ctx.tz)
  const { data, error } = await db.rpc('driving_day_fixes', {
    p_asset: assetId, p_from: new Date(s0 - EDGE_MS).toISOString(), p_to: new Date(s1 + EDGE_MS).toISOString(),
  })
  if (error) return { ok: false, wrote: false, events: [], error: error.message }
  const fixes = (Array.isArray(data) ? data : []).map(decodeFix).filter((f): f is DrivingFix => !!f)
  if (!fixes.some((f) => f.ms >= s0 && f.ms < s1)) return { ok: true, wrote: false, events: [] }
  const moved = fixes.some((f) => f.ms >= s0 && f.ms < s1 && (f.speed ?? 0) >= 5)
  const [riders, rejects] = await Promise.all([
    moved ? ridersFor(db, ctx, day, s0, s1) : Promise.resolve([] as RiderTrack[]),
    // GPS spikes the ingest refused (124) — a data-quality line, never driving.
    db.from('asset_location_rejects').select('id', { count: 'exact', head: true }).eq('asset_id', assetId)
      .gte('timestamp', new Date(s0).toISOString()).lt('timestamp', new Date(s1).toISOString())
      .then((r) => (r.error ? 0 : r.count ?? 0), () => 0),
  ])
  const zones = ctx.zones.filter((z) => !z.assetId || z.assetId === assetId)
  const { row, events } = analyzeDay({
    fixes, dayKey: day, tz: ctx.tz, riders, zones, rejects, vehicleClass, accelerometerOn: ctx.accelOn.has(assetId),
  })
  const put = await db.rpc('driving_put_day', { p_asset: assetId, p_day: day, p_row: row, p_events: events.map(eventToDb) })
  if (put.error) return { ok: false, wrote: false, events: [], error: put.error.message }
  return { ok: true, wrote: true, events }
}

/** Company-local days touched by an instant range, oldest first, capped. */
export function daysBetween(fromMs: number, toMs: number, tz: string, cap = 31): string[] {
  const first = dayKey(fromMs, tz)
  const last = dayKey(toMs, tz)
  const out: string[] = []
  for (let k = first; k <= last && out.length < cap; k = addDaysKey(k, 1)) out.push(k)
  return out
}

// ── 2. Read ─────────────────────────────────────────────────────────────────

export interface SafetyAsset {
  id: string
  name: string
  type: string
  tracker_id?: string | null
  metadata?: Record<string, unknown> | null
}

export interface SafetyVehicle {
  assetId: string
  name: string
  type: string
  trackerKind: string
  vehicleClass: VehicleClass
  score: SafetyScore
  /** Score change vs the period before (both credible), else null. */
  trend: number | null
  totals: DrivingTotals
  ident: { year: string | null; make: string | null; model: string | null; plate: string | null; vin: string | null }
}

export interface SafetyDriver {
  personId: string
  name: string
  score: SafetyScore
  /** Miles in the trucks with another phone aboard too — context, not scored. */
  rodeMiles: number
  isSelf: boolean
}

export interface SafetyEvent {
  id: string
  assetId: string
  assetName: string
  at: number
  kind: EventKind
  severity: Severity
  source: 'device' | 'gps'
  confirmed: boolean | null
  value: number | null
  speedMph: number | null
  durationS: number | null
  limitMph: number | null
  zoneName: string | null
  /** "at Riverfront Tower" / "near 123 Main St, Greenville" / null. */
  place: string | null
  lat: number | null
  lng: number | null
  personName: string | null
  words: string
}

export interface SafetyMonth {
  /** "2026-07" */
  month: string
  totals: DrivingTotals
  score: SafetyScore
  vehicles: number
}

export interface SafetyReport {
  /** False when the 129 tables did not answer (an older database). */
  ready: boolean
  demo: boolean
  days: number
  fromKey: string
  toKey: string
  /** The oldest day with a row for these vehicles (an insurer report needs 90). */
  firstDay: string | null
  fleet: SafetyScore
  fleetTotals: DrivingTotals
  fleetTrend: number | null
  vehicles: SafetyVehicle[]
  drivers: SafetyDriver[]
  events: SafetyEvent[]
  /** Per calendar month, oldest first (withMonths). */
  months: SafetyMonth[]
  /** When the newest row was built. */
  builtAt: string | null
}

export const SAFETY_PERIODS = [30, 90, 365] as const
export const safetyDays = (raw: unknown, fallback = 30): number => {
  const n = Number(raw)
  return (SAFETY_PERIODS as readonly number[]).includes(n) ? n : fallback
}

export type DriverScope = 'all' | 'none' | { viewerRank: number; viewerId: string | null }

export interface SafetyOpts {
  companyId: string
  /** The company's zone — the one the days were cut in. */
  tz: string
  days: number
  /** The assets this viewer may see (RLS-read, view-as filtered). Unscored ones are ignored. */
  assets: SafetyAsset[]
  drivers?: DriverScope
  /** Events for one vehicle; null = the fleet's newest. */
  eventsFor?: string | null
  eventLimit?: number
  withPrior?: boolean
  withPlaces?: boolean
  withVin?: boolean
  withMonths?: boolean
  /** Override "today" (tests, demo). */
  todayKey?: string
}

const DAILY_COLS = 'asset_id, day, vclass, miles, moving_s, engine_s, night_s, evening_s, max_mph, limit_miles, zone_mod_s, zone_heavy_s, zone_sev_s, max_sev_s, zone_speed_n, max_speed_n, brake_mod, brake_sev, accel_mod, accel_sev, corner_mod, corner_sev, unconfirmed_n, brake_est, accel_est, crashes, fixes, obd_s, dense_s, gap_s, longest_gap_s, power_lost, unplug_n, jamming_n, towing_n, rejects_n, accel_on, drivers, updated_at'

export type DbDaily = RowLike & { asset_id: string; day: string; vclass?: VehicleClass; updated_at?: string }
interface DbEvent {
  id: number | string; asset_id: string; at: string; kind: EventKind; severity: Severity; source: 'device' | 'gps'; confirmed: boolean | null
  value: number | null; speed_mph: number | null; duration_s: number | null; limit_mph: number | null; zone_id: string | null
  lat: number | null; lng: number | null; person_id: string | null
}

/** Who may see whose driving: themselves, and people they outrank. */
function driverVisible(scope: DriverScope, person: { id: string; role: Role; isMaster: boolean }): boolean {
  if (scope === 'all') return true
  if (scope === 'none') return false
  if (scope.viewerId && scope.viewerId === person.id) return true
  const rank = person.isMaster ? MASTER_RANK : (RANK[person.role] ?? 0)
  return scope.viewerRank > rank
}

/** Days between two day keys, inclusive. */
const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1

export async function getSafetyReport(db: SupabaseClient | null, opts: SafetyOpts): Promise<SafetyReport> {
  const todayKey = opts.todayKey ?? dayKey(Date.now(), opts.tz)
  const days = Math.max(1, Math.min(365, Math.round(opts.days)))
  const toKey = todayKey
  const fromKey = addDaysKey(toKey, -(days - 1))
  const priorFrom = addDaysKey(fromKey, -days)
  const scored = opts.assets.filter(isScoredAsset)

  if (isMock || !db) {
    const { demoSafety } = await import('../driving-demo')
    return demoSafety({ ...opts, days, fromKey, toKey, priorFrom })
  }

  const ids = scored.map((a) => a.id)
  const empty = (ready: boolean): SafetyReport => ({
    ready, demo: false, days, fromKey, toKey, firstDay: null, fleet: scoreTotals(emptyTotals()), fleetTotals: emptyTotals(), fleetTrend: null,
    vehicles: scored.map((a) => vehicleRow(a, [], [], false, null, days, null)), drivers: [], events: [], months: [], builtAt: null,
  })
  if (!ids.length) return empty(true)

  // The period (and the one before, for the trend) — paged past the API's row cap.
  const rows: DbDaily[] = []
  const from = opts.withPrior ? priorFrom : fromKey
  for (let page = 0; page < 60; page++) {
    const { data, error } = await db.from('driving_daily').select(DAILY_COLS)
      .eq('company_id', opts.companyId).in('asset_id', ids)
      .gte('day', from).lte('day', toKey)
      .order('day', { ascending: true }).order('asset_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) return empty(false)
    rows.push(...((data ?? []) as DbDaily[]))
    if (!data || data.length < 1000) break
  }
  const { data: firstRow } = await db.from('driving_daily').select('day').eq('company_id', opts.companyId).in('asset_id', ids)
    .order('day', { ascending: true }).limit(1).maybeSingle()
  const cur = rows.filter((r) => r.day >= fromKey)
  const prior = rows.filter((r) => r.day < fromKey)
  const builtAt = rows.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null)
  const firstDay = (firstRow as { day?: string } | null)?.day ?? null
  // Uptime is judged over the days each vehicle could have reported.
  const periodFor = () => (firstDay ? Math.min(days, spanDays(firstDay > fromKey ? firstDay : fromKey, toKey)) : days)

  // Identity for the insurer: year / make / model / plate from the asset, the
  // VIN from what the truck's own computer reported (115).
  const vins = new Map<string, string>()
  if (opts.withVin) {
    const { data } = await db.from('asset_telemetry_latest').select('asset_id, readings').in('asset_id', ids)
    for (const r of (data ?? []) as { asset_id: string; readings: Record<string, { v?: unknown }> | null }[]) {
      const v = r.readings?.['vehicle.vin']?.v
      if (typeof v === 'string' && /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(v.trim())) vins.set(r.asset_id, v.trim().toUpperCase())
    }
  }

  // The fleet first: its raw score is the mean a thin vehicle is blended toward.
  const fleetTotals = sumDaily(cur, periodFor() * Math.max(1, scored.length))
  const fleet = scoreTotals(fleetTotals)
  const fleetMean = fleet.credible ? fleet.raw : null
  const priorFleet = opts.withPrior ? scoreTotals(sumDaily(prior)) : null
  const fleetTrend = fleet.credible && priorFleet?.credible && fleet.score != null && priorFleet.score != null ? fleet.score - priorFleet.score : null
  const vehicles = scored.map((a) => vehicleRow(
    a, cur.filter((r) => r.asset_id === a.id), prior.filter((r) => r.asset_id === a.id), !!opts.withPrior, vins.get(a.id) ?? null, periodFor(), fleetMean))
  sortVehicles(vehicles)

  const months: SafetyMonth[] = opts.withMonths
    ? Array.from(byMonth(cur).entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => {
        const t = sumDaily(list)
        return { month, totals: t, score: scoreTotals(t), vehicles: new Set(list.filter((r) => (r.moving_s ?? 0) > 0).map((r) => r.asset_id)).size }
      })
    : []

  const fromMs = zonedMidnightMs(fromKey, opts.tz)
  const toMs = zonedMidnightMs(addDaysKey(toKey, 1), opts.tz)

  // Drivers: the people this viewer may see, scored on their SOLO time.
  const scope = opts.drivers ?? 'none'
  const people = new Map<string, { id: string; name: string; role: Role; isMaster: boolean }>()
  let drivers: SafetyDriver[] = []
  const riderIds = new Set<string>()
  for (const r of cur) for (const pid of Object.keys(r.drivers ?? {})) riderIds.add(pid)
  if (scope !== 'none' && riderIds.size) {
    const { data: profs } = await db.from('profiles').select('id, name, email, role').eq('company_id', opts.companyId).in('id', Array.from(riderIds).slice(0, 1000))
    for (const p of (profs ?? []) as { id: string; name: string | null; email?: string | null; role: string | null }[]) {
      if (p.role === 'prospect') continue
      const isMaster = p.id === opts.companyId
      people.set(p.id, { id: p.id, name: p.name || p.email?.split('@')[0] || 'Teammate', role: (isMaster ? 'admin' : (p.role as Role | null) ?? 'associate'), isMaster })
    }
    const visible = Array.from(people.values()).filter((p) => driverVisible(scope, p))
    if (visible.length) {
      const evRows: { kind: EventKind; severity: Severity; source: 'device' | 'gps'; confirmed: boolean | null; person_id: string }[] = []
      for (let page = 0; page < 10; page++) {
        const { data } = await db.from('driving_events').select('kind, severity, source, confirmed, person_id')
          .eq('company_id', opts.companyId).in('person_id', visible.map((p) => p.id)).in('asset_id', ids)
          .gte('at', new Date(fromMs).toISOString()).lt('at', new Date(toMs).toISOString())
          .range(page * 1000, page * 1000 + 999)
        evRows.push(...((data ?? []) as typeof evRows))
        if (!data || data.length < 1000) break
      }
      const evs = evRows.map((e) => ({ kind: e.kind, severity: e.severity, source: e.source, confirmed: e.confirmed, personId: e.person_id }))
      const selfId = typeof scope === 'object' ? scope.viewerId : null
      drivers = visible.map((p) => {
        const t = driverTotals(cur, evs, p.id)
        return { personId: p.id, name: p.name, score: scoreTotals(t, { fleetMean }), rodeMiles: t.rodeMiles, isSelf: p.id === selfId }
      }).filter((d) => d.score.miles > 0 || d.rodeMiles > 0)
      drivers.sort((a, b) => (a.score.credible === b.score.credible ? (a.score.score ?? 0) - (b.score.score ?? 0) || b.score.miles - a.score.miles : a.score.credible ? -1 : 1))
    }
  }

  // Events in words — one vehicle's only when this viewer may see it.
  let events: SafetyEvent[] = []
  const limit = Math.max(0, Math.min(200, opts.eventLimit ?? 0))
  const evAssets = opts.eventsFor ? (ids.includes(opts.eventsFor) ? [opts.eventsFor] : []) : ids
  if (limit && evAssets.length) {
    const { data } = await db.from('driving_events').select('id, asset_id, at, kind, severity, source, confirmed, value, speed_mph, duration_s, limit_mph, zone_id, lat, lng, person_id')
      .eq('company_id', opts.companyId).in('asset_id', evAssets)
      .gte('at', new Date(fromMs).toISOString()).lt('at', new Date(toMs).toISOString())
      .order('at', { ascending: false }).limit(limit)
    events = await wordEvents(db, opts.companyId, (data ?? []) as DbEvent[], scored, people, scope, !!opts.withPlaces)
  }

  return { ready: true, demo: false, days, fromKey, toKey, firstDay, fleet, fleetTotals, fleetTrend, vehicles, drivers, events, months, builtAt }
}

function vehicleRow(a: SafetyAsset, cur: RowLike[], prior: RowLike[], withPrior: boolean, vin: string | null, periodDays: number, fleetMean: number | null): SafetyVehicle {
  const totals = sumDaily(cur, periodDays)
  const score = scoreTotals(totals, { fleetMean })
  const before = withPrior ? scoreTotals(sumDaily(prior), { fleetMean }) : null
  const meta = (a.metadata ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)
  return {
    assetId: a.id, name: a.name, type: a.type, trackerKind: trackerKind(a.tracker_id).key, vehicleClass: vehicleClassOf(meta),
    score, totals,
    trend: score.credible && before?.credible && score.score != null && before.score != null ? score.score - before.score : null,
    ident: { year: str(meta.year), make: str(meta.make), model: str(meta.model), plate: str(meta.license ?? meta.plate), vin: vin ?? str(meta.vin) },
  }
}

/** Worst credible score first (who to coach), then the not-yet-scored by miles. */
export function sortVehicles(list: SafetyVehicle[]): void {
  list.sort((a, b) => {
    if (a.score.credible !== b.score.credible) return a.score.credible ? -1 : 1
    if (a.score.credible) return (a.score.score ?? 0) - (b.score.score ?? 0) || b.score.miles - a.score.miles
    return b.score.miles - a.score.miles
  })
}

async function wordEvents(
  db: SupabaseClient, companyId: string, rows: DbEvent[], assets: SafetyAsset[],
  people: Map<string, { id: string; name: string; role: Role; isMaster: boolean }>, scope: DriverScope, withPlaces: boolean,
): Promise<SafetyEvent[]> {
  if (!rows.length) return []
  const { data: fences } = await db.from('geofences_json').select('id, name, kind, geometry').eq('company_id', companyId).limit(500)
  const zones = ((fences ?? []) as GeofenceRow[])
    .filter((g) => g.kind !== 'boundary' && g.geometry?.type === 'Polygon' && Array.isArray(g.geometry.coordinates?.[0]))
    .map((g) => ({ id: g.id, name: g.name, ring: g.geometry!.coordinates![0] as [number, number][] }))
  const zoneName = new Map(((fences ?? []) as GeofenceRow[]).map((g) => [g.id, g.name]))
  let cached: Record<string, import('../place-label').PlaceParts | null> = {}
  const { placeKey, formatPlace } = await import('../place-label')
  if (withPlaces) {
    const keys = rows.filter((r) => r.lat != null && r.lng != null).map((r) => placeKey(r.lat as number, r.lng as number))
    try {
      const { lookupCachedPlaces } = await import('../reverse-geocode')
      cached = await lookupCachedPlaces(keys)
    } catch { /* addresses are garnish */ }
  }
  const nameOf = new Map(assets.map((a) => [a.id, a.name]))
  return rows.map((r) => {
    const inZone = r.lat != null && r.lng != null ? zones.find((z) => pointInPolygon([r.lng as number, r.lat as number], z.ring)) : undefined
    const zn = r.zone_id ? zoneName.get(r.zone_id) ?? null : null
    const person = r.person_id ? people.get(r.person_id) : undefined
    const place = inZone ? `at ${inZone.name}` : r.lat != null && r.lng != null ? formatPlace(cached[placeKey(r.lat, r.lng)]) : null
    const e = {
      kind: r.kind, severity: r.severity, source: r.source, confirmed: r.confirmed, value: r.value == null ? null : Number(r.value),
      speedMph: r.speed_mph, durationS: r.duration_s, limitMph: r.limit_mph,
    }
    return {
      id: String(r.id), assetId: r.asset_id, assetName: nameOf.get(r.asset_id) ?? 'Vehicle', at: Date.parse(r.at),
      ...e, zoneName: zn, place, lat: r.lat, lng: r.lng,
      personName: person && driverVisible(scope, person) ? person.name : null,
      words: eventWords(e, zn),
    }
  })
}

/** One vehicle's score for the asset page (90 days, blended toward the fleet). */
export async function getVehicleSafety(db: SupabaseClient | null, opts: { companyId: string; tz: string; asset: SafetyAsset; fleet: SafetyAsset[]; days?: number }): Promise<SafetyVehicle | null> {
  if (!isMock && !isScoredAsset(opts.asset)) return null
  const rep = await getSafetyReport(db, { companyId: opts.companyId, tz: opts.tz, days: opts.days ?? 90, assets: opts.fleet, drivers: 'none', withPrior: true })
  return rep.vehicles.find((v) => v.assetId === opts.asset.id) ?? null
}

/**
 * Every event in a period for the insurer CSV — paged past the API's row
 * cap, oldest first, no people (the insurer report carries no per-driver
 * data) and no street addresses (the site name is enough). Capped at 20,000.
 */
export async function listSafetyEvents(db: SupabaseClient | null, opts: { companyId: string; tz: string; fromKey: string; toKey: string; assets: SafetyAsset[] }): Promise<SafetyEvent[]> {
  const scored = opts.assets.filter(isScoredAsset)
  if (isMock || !db) {
    const days = spanDays(opts.fromKey, opts.toKey)
    const rep = await getSafetyReport(null, { companyId: opts.companyId, tz: opts.tz, days, assets: opts.assets, drivers: 'none', eventLimit: 200, todayKey: opts.toKey })
    return rep.events.map((e) => ({ ...e, personName: null })).sort((a, b) => a.at - b.at)
  }
  const ids = scored.map((a) => a.id)
  if (!ids.length) return []
  const fromIso = new Date(zonedMidnightMs(opts.fromKey, opts.tz)).toISOString()
  const toIso = new Date(zonedMidnightMs(addDaysKey(opts.toKey, 1), opts.tz)).toISOString()
  const rows: DbEvent[] = []
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db.from('driving_events').select('id, asset_id, at, kind, severity, source, confirmed, value, speed_mph, duration_s, limit_mph, zone_id, lat, lng, person_id')
      .eq('company_id', opts.companyId).in('asset_id', ids)
      .gte('at', fromIso).lt('at', toIso)
      .order('at', { ascending: true }).order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) break
    rows.push(...((data ?? []) as DbEvent[]))
    if (!data || data.length < 1000) break
  }
  return wordEvents(db, opts.companyId, rows.map((r) => ({ ...r, person_id: null })), scored, new Map(), 'none', false)
}

/** Is there enough history for an insurer report (≥ 90 days, ≥ 3 scored vehicles)? */
export function insurerReady(rep: Pick<SafetyReport, 'firstDay' | 'toKey' | 'vehicles' | 'fleet'>): { ok: boolean; daysOfData: number; scoredVehicles: number; lowCredibility: boolean } {
  const I = SAFETY_METHOD.insurer
  const daysOfData = rep.firstDay ? spanDays(rep.firstDay, rep.toKey) : 0
  const scoredVehicles = rep.vehicles.filter((v) => v.score.credible).length
  return {
    ok: daysOfData >= I.minDays && scoredVehicles >= I.minVehicles,
    daysOfData, scoredVehicles,
    lowCredibility: rep.fleet.miles < I.lowCredibilityMiles,
  }
}

/** Used by the cron: a vehicle-class lookup from the asset's specs and icon. */
export function classOfAsset(a: { metadata?: Record<string, unknown> | null }): VehicleClass {
  return vehicleClassOf(a.metadata ?? null)
}

export type { DailyRow }
