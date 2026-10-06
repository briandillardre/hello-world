import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLOCK_USE_DAYS, DRIVE_BY_M, PRESENCE_RADIUS_DAY_M, PRESENCE_RADIUS_TIME_M,
  checkWindows, cleanSettings, exceptionWrites, fuelTypeOf, isFuelMerchant, isRealStop, merchantKey, mergeStops,
  metresToRing, missingTelemetry, parseMerchant, pilotMetrics, readStoredChecks, runFuelChecks, samePurchase, storedChecks,
  type CheckAsset, type CheckKind, type CheckTxn, type FixRec, type FuelDraft, type FuelProduct, type GeoPrecision, type LatLng,
  type MetricException, type MetricTxn, type MissingCode, type MissingItem, type PilotMetrics, type PilotSettings,
  type PresenceEvidence, type Severity, type StopRec, type StoredChecks, type Verdict,
} from '@/lib/fuel-check'
import { tankGallonsFrom, type FuelSample } from '@/lib/asset-stats'
import { addDaysKey, dayKey, safeTz } from '@/lib/dates'
import { trackerKind } from '@/lib/devices'
import { TELEMETRY_CATALOG } from '@/lib/telemetry-catalog'
import { PhotonBudget, cleanPoints, fuelStationNear, placeMerchants, type MerchantAsk } from '@/lib/fuel-geocode'
import { canSeeAsset, type Permissions } from '@/lib/permissions'

/**
 * The fuel reconciliation pilot — the loader and the check runner (migration
 * 130). The page reads through the caller's session (RLS: the company, the
 * costs ability, asset visibility). The runner reads and writes through the
 * SERVICE client scoped by company id, because its results are stored and
 * shared: a check run by a Manager must not see less of the fleet than one run
 * by the owner and then write "tracker silent" for everyone. Pure math lives
 * in lib/fuel-check.ts; this file only fetches and stores.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const HOUR = 3_600_000

/** The fuel-level keys a gauge reading arrives under (the catalog's own list). */
export const FUEL_LEVEL_KEYS: string[] = (() => {
  const d = TELEMETRY_CATALOG.find((x) => x.key === 'can.fuel.level')
  return [d?.key ?? 'can.fuel.level', ...(d?.aliases ?? [])].filter((k) => /^[a-z0-9_.]+$/i.test(k))
})()

export interface TxnRow {
  id: string
  company_id: string
  source: 'csv' | 'expense' | 'manual'
  dedupe_key: string
  alt_keys: string[] | null
  expense_id: string | null
  txn_at: string | null
  txn_date: string
  has_time: boolean
  merchant: string
  brand: string | null
  store_no: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  city_candidates: string[] | null
  lat: number | null
  lng: number | null
  merchant_points: unknown
  geocode_source: string | null
  geocode_precision: GeoPrecision | null
  place_label: string | null
  geocoded_at: string | null
  gallons: number | string | null
  gallons_estimated: boolean
  unit_price: number | string | null
  amount: number | string
  product: FuelProduct | null
  card_last4: string | null
  cardholder_user_id: string | null
  driver_text: string | null
  vehicle_text: string | null
  job_text: string | null
  asset_id: string | null
  asset_source: 'row' | 'card' | null
  geofence_id: string | null
  odometer: number | string | null
  excluded: boolean
  excluded_reason: string | null
  checks: unknown
  checked_at: string | null
  created_at: string
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const ms = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : null
}

// ── The page ────────────────────────────────────────────────────────────────

export interface FuelTxnView {
  id: string
  source: string
  txnDate: string
  txnAtMs: number | null
  merchant: string
  placeLabel: string | null
  precision: GeoPrecision | null
  /** The station lookup has run (placed or not). */
  placedTried: boolean
  amount: number
  gallons: number | null
  gallonsEstimated: boolean
  product: FuelProduct | null
  cardLast4: string | null
  assetId: string | null
  assetName: string | null
  assetSource: 'row' | 'card' | null
  vehicleText: string | null
  driverText: string | null
  excluded: boolean
  excludedReason: string | null
  checks: StoredChecks | null
  checkedAtMs: number | null
}
export interface FuelExceptionView {
  id: string
  transactionId: string
  kind: CheckKind
  severity: Severity
  text: string
  dollarsAtRisk: number
  missing: MissingCode[]
  computedAtMs: number
  firstSeenAtMs: number
  clearedAtMs: number | null
  verdict: Verdict | null
  verdictBy: string | null
  verdictAtMs: number | null
  verdictNote: string | null
}
export interface FuelCardView {
  last4: string
  label: string | null
  holder: string | null
  /** The vehicle the card fuels today, and since when. */
  assetId: string | null
  validFrom: string | null
  history: { assetId: string | null; validFrom: string }[]
  purchases: number
  dollars: number
}
export interface FuelVehicleView {
  id: string
  name: string
  type: string
  tankGal: number | null
  tankSource: 'specs' | 'notes' | null
  fuelType: 'diesel' | 'gas' | null
  /** The tracker has sent a fuel level (null = never reported anything). */
  reportsFuel: boolean | null
  hasTracker: boolean
}
export interface FuelPilotSettingsView extends PilotSettings {
  startedOn: string | null
  lastRunAtMs: number | null
}
export interface FuelPilotView {
  ready: boolean
  settings: FuelPilotSettingsView
  txns: FuelTxnView[]
  exceptions: FuelExceptionView[]
  cards: FuelCardView[]
  vehicles: FuelVehicleView[]
  metrics: PilotMetrics
  missing: MissingItem[]
  /** Purchases whose station lookup hasn't run yet. */
  unplaced: number
  /** Purchases never checked. */
  unchecked: number
}

export function emptyPilot(todayKey: string): FuelPilotView {
  return {
    ready: false,
    settings: { ...cleanSettings(null), startedOn: null, lastRunAtMs: null },
    txns: [], exceptions: [], cards: [], vehicles: [],
    metrics: pilotMetrics([], [], { startedOn: null, todayKey }),
    missing: [], unplaced: 0, unchecked: 0,
  }
}

const TXN_COLS = 'id, company_id, source, dedupe_key, alt_keys, expense_id, txn_at, txn_date, has_time, merchant, brand, store_no, address, city, state, zip, city_candidates, lat, lng, merchant_points, geocode_source, geocode_precision, place_label, geocoded_at, gallons, gallons_estimated, unit_price, amount, product, card_last4, cardholder_user_id, driver_text, vehicle_text, job_text, asset_id, asset_source, geofence_id, odometer, excluded, excluded_reason, checks, checked_at, created_at'

/** Everything /receipts/fuel shows, read as the caller (RLS decides what that
 *  is). `viewer` = the EFFECTIVE permissions: a "view app as" preview is
 *  narrowed here too, since RLS only knows the real person (111). */
export async function loadFuelPilot(db: SupabaseClient, companyId: string, opts: { todayKey: string; viewer?: Pick<Permissions, 'role' | 'isMaster'> }): Promise<FuelPilotView> {
  if (isMock) return emptyPilot(opts.todayKey)
  const [pilotRes, txnRes, exRes, cardAssetRes, cardRes, assetRes, peopleRes] = await Promise.all([
    db.from('fuel_pilot').select('*').eq('company_id', companyId).maybeSingle(),
    db.from('fuel_transactions').select(TXN_COLS).eq('company_id', companyId).order('txn_date', { ascending: false }).order('txn_at', { ascending: false, nullsFirst: false }).limit(1500),
    db.from('fuel_exceptions').select('id, transaction_id, kind, severity, evidence, dollars_at_risk, missing, computed_at, first_seen_at, cleared_at, verdict, verdict_by, verdict_at, verdict_note')
      .eq('company_id', companyId).order('computed_at', { ascending: false }).limit(4000),
    db.from('fuel_card_assets').select('last4, asset_id, valid_from').eq('company_id', companyId).order('valid_from', { ascending: true }).limit(2000),
    db.from('company_cards').select('last4, label, user_id').eq('company_id', companyId).limit(500),
    db.from('assets').select('id, name, type, tracker_id, metadata, active').eq('company_id', companyId).in('type', ['vehicle', 'equipment', 'personnel']).limit(2000),
    db.from('profiles').select('id, name, email').eq('company_id', companyId).limit(1000),
  ])
  if (txnRes.error || exRes.error) return emptyPilot(opts.todayKey)
  const p = (pilotRes.data ?? null) as Record<string, unknown> | null
  const settings: FuelPilotSettingsView = {
    ...cleanSettings({ gasPrice: p?.gas_price, dieselPrice: p?.diesel_price, areaMiles: p?.area_miles, runtimeHours: p?.runtime_hours }),
    startedOn: typeof p?.started_on === 'string' ? p.started_on : null,
    lastRunAtMs: ms(p?.last_run_at as string | null),
  }
  const people = new Map(((peopleRes.data ?? []) as { id: string; name: string | null; email: string | null }[])
    .map((x) => [x.id, x.name || x.email?.split('@')[0] || 'Teammate']))
  const allAssets = ((assetRes.data ?? []) as { id: string; name: string; type: string; tracker_id: string | null; metadata: unknown; active: boolean }[])
  const hidden = new Set(opts.viewer ? allAssets.filter((a) => !canSeeAsset(opts.viewer!, a.metadata, a.type)).map((a) => a.id) : [])
  const assets = allAssets.filter((a) => !hidden.has(a.id) && a.type !== 'personnel')
  const assetName = new Map(assets.map((a) => [a.id, a.name]))

  // Which trackers have ever sent a fuel level (115's readings map).
  const reports = new Map<string, boolean>()
  const tracked = assets.filter((a) => a.tracker_id && a.active).map((a) => a.id)
  for (let i = 0; i < tracked.length; i += 100) {
    const cols = ['asset_id', ...FUEL_LEVEL_KEYS.map((k, j) => `f${j}:readings->"${k}"`)].join(', ')
    const { data } = await db.from('asset_telemetry_latest').select(cols).in('asset_id', tracked.slice(i, i + 100))
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      reports.set(String(r.asset_id), FUEL_LEVEL_KEYS.some((_, j) => r[`f${j}`] != null))
    }
  }
  const vehicles: FuelVehicleView[] = assets.filter((a) => a.active).map((a) => {
    const tank = tankGallonsFrom(a.metadata)
    return {
      id: a.id, name: a.name, type: a.type,
      tankGal: tank?.gallons ?? null, tankSource: tank?.source ?? null,
      fuelType: fuelTypeOf(a.metadata, a.name, a.type),
      reportsFuel: reports.has(a.id) ? reports.get(a.id)! : null,
      hasTracker: !!a.tracker_id,
    }
  }).sort((x, y) => x.name.localeCompare(y.name))

  const txRows = ((txnRes.data ?? []) as unknown as TxnRow[]).filter((t) => !t.asset_id || !hidden.has(t.asset_id))
  const txns: FuelTxnView[] = txRows.map((t) => ({
    id: t.id, source: t.source, txnDate: t.txn_date, txnAtMs: t.has_time ? ms(t.txn_at) : null,
    merchant: t.merchant, placeLabel: t.place_label, precision: t.geocode_precision, placedTried: !!t.geocoded_at,
    amount: num(t.amount) ?? 0, gallons: num(t.gallons), gallonsEstimated: !!t.gallons_estimated, product: t.product,
    cardLast4: t.card_last4, assetId: t.asset_id, assetName: t.asset_id ? assetName.get(t.asset_id) ?? null : null, assetSource: t.asset_source,
    vehicleText: t.vehicle_text, driverText: t.driver_text, excluded: !!t.excluded, excludedReason: t.excluded_reason,
    checks: readStoredChecks(t.checks), checkedAtMs: ms(t.checked_at),
  }))
  const visibleTxn = new Set(txns.map((t) => t.id))
  const exceptions: FuelExceptionView[] = ((exRes.data ?? []) as Record<string, unknown>[])
    .filter((e) => visibleTxn.has(String(e.transaction_id)))
    .map((e) => {
      const ev = (e.evidence ?? {}) as { text?: unknown }
      return {
        id: String(e.id), transactionId: String(e.transaction_id), kind: e.kind as CheckKind, severity: e.severity as Severity,
        text: typeof ev.text === 'string' ? ev.text : '', dollarsAtRisk: num(e.dollars_at_risk) ?? 0,
        missing: (Array.isArray(e.missing) ? e.missing : []) as MissingCode[],
        computedAtMs: ms(e.computed_at as string) ?? 0, firstSeenAtMs: ms(e.first_seen_at as string) ?? 0, clearedAtMs: ms(e.cleared_at as string | null),
        verdict: (e.verdict as Verdict | null) ?? null, verdictBy: e.verdict_by ? people.get(String(e.verdict_by)) ?? 'Teammate' : null,
        verdictAtMs: ms(e.verdict_at as string | null), verdictNote: (e.verdict_note as string | null) ?? null,
      }
    })

  // Cards: every card seen on a purchase or set up for the receipt chase.
  const holders = new Map(((cardRes.data ?? []) as { last4: string; label: string | null; user_id: string | null }[]).map((c) => [c.last4, c]))
  const hist = new Map<string, { assetId: string | null; validFrom: string }[]>()
  for (const r of (cardAssetRes.data ?? []) as { last4: string; asset_id: string | null; valid_from: string }[]) {
    const h = hist.get(r.last4) ?? []
    h.push({ assetId: r.asset_id && hidden.has(r.asset_id) ? null : r.asset_id, validFrom: r.valid_from })
    hist.set(r.last4, h)
  }
  const spend = new Map<string, { n: number; d: number }>()
  for (const t of txns) if (t.cardLast4 && !t.excluded) {
    const s = spend.get(t.cardLast4) ?? { n: 0, d: 0 }
    s.n++; s.d += t.amount
    spend.set(t.cardLast4, s)
  }
  const last4s = Array.from(new Set([...Array.from(spend.keys()), ...Array.from(holders.keys()), ...Array.from(hist.keys())])).sort()
  const cards: FuelCardView[] = last4s.map((l4) => {
    const h = hist.get(l4) ?? []
    const cur = h.filter((x) => x.validFrom <= opts.todayKey).pop() ?? null
    const holder = holders.get(l4)
    return {
      last4: l4, label: holder?.label ?? null, holder: holder?.user_id ? people.get(holder.user_id) ?? null : null,
      assetId: cur?.assetId ?? null, validFrom: cur?.validFrom ?? null, history: h,
      purchases: spend.get(l4)?.n ?? 0, dollars: Math.round((spend.get(l4)?.d ?? 0) * 100) / 100,
    }
  }).sort((a, b) => b.dollars - a.dollars || a.last4.localeCompare(b.last4))

  const metricTxns: MetricTxn[] = txns.map((t) => ({
    id: t.id, amount: t.amount, txnDate: t.txnDate, hasTime: t.txnAtMs != null, excluded: t.excluded,
    assetId: t.assetId, cardLast4: t.cardLast4, checks: t.checks,
  }))
  const metricEx: MetricException[] = exceptions.map((e) => ({
    transactionId: e.transactionId, kind: e.kind, dollarsAtRisk: e.dollarsAtRisk, verdict: e.verdict,
    clearedAt: e.clearedAtMs != null ? new Date(e.clearedAtMs).toISOString() : null,
  }))
  return {
    ready: true,
    settings,
    txns,
    exceptions,
    cards,
    vehicles,
    metrics: pilotMetrics(metricTxns, metricEx, { startedOn: settings.startedOn, todayKey: opts.todayKey }),
    missing: missingTelemetry(metricTxns, assets.map((a) => ({ id: a.id, name: a.name }))),
    unplaced: txRows.filter((t) => !t.excluded && !t.geocoded_at).length,
    unchecked: txRows.filter((t) => !t.excluded && !t.checked_at).length,
  }
}

// ── The check runner ────────────────────────────────────────────────────────

interface AssetRow { id: string; name: string; type: string; tracker_id: string | null; metadata: unknown; active: boolean }
interface CompanyRow { work_start: string | null; work_end: string | null; work_days: number[] | null; digest_prefs: { tz?: unknown } | null }

export interface RunResult { checked: number; exceptions: number; remaining: number; placed: number; unplaced: number }

/**
 * Check purchases: place their stations (budgeted), gather each one's
 * evidence (bounded, indexed reads), run the four checks, store the results
 * and the exception rows. Unchecked purchases go first, then the stalest.
 * Never touches a verdict. Stops at `budgetMs` and says how many are left.
 */
export async function runFuelCheck(svc: SupabaseClient, companyId: string, opts: {
  sinceKey?: string
  untilKey?: string
  ids?: string[]
  /** Only purchases never checked (any date) — the nightly backlog pass. */
  uncheckedOnly?: boolean
  budgetMs: number
  geocodeCalls: number
  nowMs?: number
}): Promise<RunResult> {
  const started = Date.now()
  const nowMs = opts.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const res: RunResult = { checked: 0, exceptions: 0, remaining: 0, placed: 0, unplaced: 0 }

  const [coRes, pilotRes] = await Promise.all([
    svc.from('companies').select('work_start, work_end, work_days, digest_prefs').eq('id', companyId).maybeSingle(),
    svc.from('fuel_pilot').select('*').eq('company_id', companyId).maybeSingle(),
  ])
  const co = (coRes.data ?? {}) as CompanyRow
  const tz = safeTz(typeof co.digest_prefs?.tz === 'string' ? co.digest_prefs.tz : null)
  const hours = { tz, workStart: co.work_start || '07:00', workEnd: co.work_end || '17:00', workDays: Array.isArray(co.work_days) && co.work_days.length ? co.work_days : [1, 2, 3, 4, 5, 6] }
  const p = (pilotRes.data ?? null) as Record<string, unknown> | null
  const settings = cleanSettings({ gasPrice: p?.gas_price, dieselPrice: p?.diesel_price, areaMiles: p?.area_miles, runtimeHours: p?.runtime_hours })

  let q = svc.from('fuel_transactions').select(TXN_COLS).eq('company_id', companyId).eq('excluded', false)
  if (opts.ids?.length) q = q.in('id', opts.ids.slice(0, 500))
  if (opts.sinceKey) q = q.gte('txn_date', opts.sinceKey)
  if (opts.untilKey) q = q.lte('txn_date', opts.untilKey)
  if (opts.uncheckedOnly) q = q.is('checked_at', null)
  const { data: txData, error: txErr } = await q.order('checked_at', { ascending: true, nullsFirst: true }).limit(600)
  if (txErr || !txData?.length) return res
  const rows = txData as unknown as TxnRow[]

  const [assetRes, cardAssetRes, cardRes, zoneRes, placeRes] = await Promise.all([
    svc.from('assets').select('id, name, type, tracker_id, metadata, active').eq('company_id', companyId).limit(2000),
    svc.from('fuel_card_assets').select('last4, asset_id, valid_from').eq('company_id', companyId).order('valid_from', { ascending: true }).limit(2000),
    svc.from('company_cards').select('last4, user_id').eq('company_id', companyId).limit(500),
    svc.from('geofences_json').select('id, name, kind, geometry, owner_id').eq('company_id', companyId).limit(500),
    svc.from('places').select('name, lat, lng').eq('company_id', companyId).eq('active', true).limit(500),
  ])
  const assets = (assetRes.data ?? []) as AssetRow[]
  const assetById = new Map(assets.map((a) => [a.id, a]))
  const phoneOf = new Map<string, string>() // user id → their phone asset id
  for (const a of assets) if (a.tracker_id?.startsWith('phone-')) phoneOf.set(a.tracker_id.slice(6), a.id)
  const cardHist = new Map<string, { assetId: string | null; validFrom: string }[]>()
  for (const r of (cardAssetRes.data ?? []) as { last4: string; asset_id: string | null; valid_from: string }[]) {
    const h = cardHist.get(r.last4) ?? []
    h.push({ assetId: r.asset_id, validFrom: r.valid_from })
    cardHist.set(r.last4, h)
  }
  const holderOf = new Map(((cardRes.data ?? []) as { last4: string; user_id: string | null }[]).filter((c) => c.user_id).map((c) => [c.last4, c.user_id!]))
  const zones = ((zoneRes.data ?? []) as { id: string; name: string; kind: string | null; geometry: { coordinates?: unknown[] } | null; owner_id: string | null }[])
    .filter((z) => !z.owner_id)
    .map((z) => ({ id: z.id, name: z.name, kind: z.kind ?? 'site', ring: ((z.geometry?.coordinates?.[0] ?? []) as [number, number][]) }))
    .filter((z) => z.ring.length >= 3)
  const places = ((placeRes.data ?? []) as { name: string; lat: number; lng: number }[]).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng))
  const bias = zoneCentroid(zones)

  // 1. Place the stations nobody has looked up yet.
  const unplacedRows = rows.filter((t) => !t.geocoded_at)
  if (unplacedRows.length) {
    const asks = new Map<string, MerchantAsk>()
    const keyOf = new Map<string, string>()
    for (const t of unplacedRows) {
      const parts = parseMerchant(t.merchant)
      const ask: MerchantAsk = {
        key: merchantKey({ brand: t.brand ?? parts.brand, name: parts.name, city: t.city, cityCandidates: t.city_candidates ?? [], state: t.state, address: t.address }),
        brand: t.brand ?? parts.brand, name: parts.name, address: t.address, city: t.city,
        cityCandidates: t.city_candidates ?? [], state: t.state, zip: t.zip,
      }
      keyOf.set(t.id, ask.key)
      asks.set(ask.key, ask)
    }
    const placed = await placeMerchants(svc, companyId, Array.from(asks.values()), { maxCalls: opts.geocodeCalls, budgetMs: Math.max(5_000, opts.budgetMs * 0.45), bias })
    for (const t of unplacedRows) {
      const k = keyOf.get(t.id)!
      if (!placed.has(k)) { res.unplaced++; continue }
      const m = placed.get(k) ?? null
      const patch = {
        lat: m?.lat ?? null, lng: m?.lng ?? null, merchant_points: m?.points ?? null, geocode_precision: m?.precision ?? null,
        geocode_source: m?.source ?? 'none', place_label: m?.label ?? null, geocoded_at: nowIso,
      }
      Object.assign(t, patch)
      await svc.from('fuel_transactions').update(patch).eq('id', t.id).eq('company_id', companyId)
      res.placed++
    }
  }

  // 2. Which trackers send what.
  const assigned = new Set<string>()
  for (const t of rows) {
    const a = resolveAsset(t, cardHist)
    if (a.assetId) assigned.add(a.assetId)
  }
  const caps = await trackerCaps(svc, Array.from(assigned), assetById)

  // 3. Who was on the clock.
  const holders = new Set<string>()
  for (const t of rows) { const h = t.cardholder_user_id ?? (t.card_last4 ? holderOf.get(t.card_last4) : undefined); if (h) holders.add(h) }
  const shifts = await loadShifts(svc, companyId, Array.from(holders), rows)

  const budget = new PhotonBudget(Math.max(4, Math.round(opts.geocodeCalls / 2)), opts.budgetMs)
  const stationMemo = new Map<string, string>()
  const stopsMemo = new Map<string, StopRec[]>()
  const pathMemo = new Map<string, LatLng[]>()

  for (const t of rows) {
    if (Date.now() - started > opts.budgetMs) { res.remaining++; continue }
    try {
      const { assetId, via } = resolveAsset(t, cardHist)
      const a = assetId ? assetById.get(assetId) ?? null : null
      const cardholder = t.cardholder_user_id ?? (t.card_last4 ? holderOf.get(t.card_last4) ?? null : null)
      const txn = toCheckTxn(t, cardholder)
      const win = checkWindows(txn, settings, tz)
      const cap = a ? caps.get(a.id) : undefined
      const asset: CheckAsset | null = a ? {
        id: a.id, name: a.name, type: a.type,
        hasTracker: !!a.tracker_id && !!cap?.everReported,
        tankGal: tankGallonsFrom(a.metadata)?.gallons ?? null,
        fuelType: fuelTypeOf(a.metadata, a.name, a.type),
        reportsFuelLevel: !!cap?.fuel,
        reportsIgnition: !!cap?.ignition,
      } : null

      const placedPts = txn.points.length && txn.precision !== 'city'
      let presence: PresenceEvidence | null = null
      let gauge: FuelSample[] | null = null
      let runtime = null as { fromMs: number; toMs: number; firstRunMs: number | null; lastFixMs: number | null } | null
      let dayPath: LatLng[] = []
      if (asset?.hasTracker) {
        const radius = txn.txnAtMs != null ? PRESENCE_RADIUS_TIME_M : PRESENCE_RADIUS_DAY_M
        const near = placedPts ? await fuelNear(svc, companyId, asset.id, win.presenceFromMs, win.presenceToMs, txn.points, radius) : []
        const mine = near.find((n) => n.assetId === asset.id) ?? null
        const nearOk = !!mine && (mine.stillN > 0 || mine.minM <= DRIVE_BY_M)
        presence = {
          fromMs: win.presenceFromMs, toMs: win.presenceToMs,
          near: mine ? { firstMs: mine.firstMs, lastMs: mine.lastMs, n: mine.n, stillN: mine.stillN, minM: mine.minM } : null,
          stops: null, before: null, after: null, fixesInWindow: mine ? mine.n : 0, others: null, cardholderPhone: null,
        }
        if (!nearOk) {
          if (!mine) presence.fixesInWindow = await anyFix(svc, asset.id, win.presenceFromMs - HOUR, win.presenceToMs + HOUR)
          if (txn.txnAtMs != null && placedPts) {
            const [b, af] = await Promise.all([fixBefore(svc, asset.id, txn.txnAtMs), fixAfter(svc, asset.id, txn.txnAtMs)])
            presence.before = b
            presence.after = af
          }
          if (txn.txnAtMs == null || !placedPts) {
            const from = txn.txnAtMs != null ? txn.txnAtMs - 45 * 60_000 : win.dayFromMs
            const to = txn.txnAtMs != null ? txn.txnAtMs + 45 * 60_000 : win.dayToMs
            const key = `${asset.id}|${from}|${to}`
            let stops = stopsMemo.get(key)
            if (!stops) {
              stops = await fuelStops(svc, companyId, asset.id, from, to)
              stopsMemo.set(key, stops)
            }
            presence.stops = stops
            if (!placedPts) await lookUpFuelStops(svc, companyId, stops, zones, budget, stationMemo)
          }
          if (placedPts) {
            const others = await fuelNear(svc, companyId, null, win.presenceFromMs, win.presenceToMs, txn.points, radius)
            const phone = cardholder ? phoneOf.get(cardholder) : undefined
            presence.others = others
              .filter((o) => o.assetId !== asset.id && o.assetId !== phone && (o.stillN > 0 || o.minM <= DRIVE_BY_M))
              .map((o) => ({ ...o, a: assetById.get(o.assetId) }))
              .filter((o) => o.a && (o.a.type === 'vehicle' || o.a.type === 'equipment'))
              .map((o) => ({ assetId: o.assetId, name: o.a!.name, firstMs: o.firstMs, minM: o.minM }))
            const ph = phone ? others.find((o) => o.assetId === phone) : undefined
            presence.cardholderPhone = ph ? { firstMs: ph.firstMs, minM: ph.minM } : null
          }
        }
        if (asset.reportsFuelLevel) gauge = await fuelGauge(svc, companyId, asset.id, win.gaugeFromMs, win.gaugeToMs)
        runtime = await runtimeAfter(svc, asset.id, win.runtimeFromMs, win.runtimeToMs)
        const pk = `${asset.id}|${t.txn_date}`
        dayPath = pathMemo.get(pk) ?? await dayTrail(svc, asset.id, win.dayFromMs, win.dayToMs)
        pathMemo.set(pk, dayPath)
      } else if (!asset && placedPts) {
        // No vehicle on the card: who WAS at the pump is the useful answer.
        const others = await fuelNear(svc, companyId, null, win.presenceFromMs, win.presenceToMs, txn.points, txn.txnAtMs != null ? PRESENCE_RADIUS_TIME_M : PRESENCE_RADIUS_DAY_M)
        presence = {
          fromMs: win.presenceFromMs, toMs: win.presenceToMs, near: null, stops: null, before: null, after: null, fixesInWindow: 0, cardholderPhone: null,
          others: others.map((o) => ({ ...o, a: assetById.get(o.assetId) }))
            .filter((o) => o.a && (o.a.type === 'vehicle' || o.a.type === 'equipment') && (o.stillN > 0 || o.minM <= DRIVE_BY_M))
            .map((o) => ({ assetId: o.assetId, name: o.a!.name, firstMs: o.firstMs, minM: o.minM })),
        }
      }

      const results = runFuelChecks({
        txn, asset, assetVia: a ? via : null, presence, gauge, runtime,
        area: { zones, places, dayPath },
        shift: cardholder ? shifts.get(cardholder) ?? { usesClock: false, entries: [] } : null,
        hours, settings, nowMs,
      })
      // Store: the four results, the vehicle it was read against, the gallons
      // figure the tank check used (an estimate is re-made at today's price).
      const tank = results.find((r) => r.kind === 'gallons_exceed_tank')
      const estGal = tank?.facts.estimated === true && typeof tank.facts.gallons === 'number' ? tank.facts.gallons : null
      const patch: Record<string, unknown> = {
        checks: storedChecks(results, nowIso), checked_at: nowIso,
        asset_id: assetId, asset_source: assetId ? via : null,
      }
      if (estGal != null && (t.gallons == null || t.gallons_estimated)) { patch.gallons = estGal; patch.gallons_estimated = true }
      await svc.from('fuel_transactions').update(patch).eq('id', t.id).eq('company_id', companyId)
      const w = exceptionWrites(t.id, companyId, results, nowIso)
      if (w.upserts.length) {
        const { error } = await svc.from('fuel_exceptions').upsert(w.upserts, { onConflict: 'transaction_id,kind' })
        if (error) console.error('fuel_exceptions upsert failed:', error.message)
        res.exceptions += w.upserts.length
      }
      if (w.clear.length) {
        await svc.from('fuel_exceptions').update({ cleared_at: nowIso }).eq('transaction_id', t.id).in('kind', w.clear).is('cleared_at', null)
      }
      res.checked++
    } catch (err) {
      console.error('fuel check failed for', t.id, err instanceof Error ? err.message : err)
      res.remaining++
    }
  }
  await svc.from('fuel_pilot').upsert({ company_id: companyId, last_run_at: nowIso }, { onConflict: 'company_id' })
  return res
}

/** The vehicle a purchase is read against: the row's own, else the card's as of that day. */
export function resolveAsset(t: Pick<TxnRow, 'asset_id' | 'asset_source' | 'card_last4' | 'txn_date'>, cardHist: Map<string, { assetId: string | null; validFrom: string }[]>):
  { assetId: string | null; via: 'row' | 'card' } {
  if (t.asset_source === 'row' && t.asset_id) return { assetId: t.asset_id, via: 'row' }
  const h = t.card_last4 ? cardHist.get(t.card_last4) ?? [] : []
  const cur = h.filter((x) => x.validFrom <= t.txn_date).pop()
  return { assetId: cur?.assetId ?? null, via: 'card' }
}

export function toCheckTxn(t: TxnRow, cardholder: string | null): CheckTxn {
  const pts = cleanPoints(t.merchant_points)
  const points: LatLng[] = pts.length ? pts : t.lat != null && t.lng != null ? [{ lat: Number(t.lat), lng: Number(t.lng) }] : []
  return {
    id: t.id,
    txnDate: t.txn_date,
    txnAtMs: t.has_time ? ms(t.txn_at) : null,
    amount: num(t.amount) ?? 0,
    // An estimate is re-made each run from the current default price.
    gallons: t.gallons_estimated ? null : num(t.gallons),
    unitPrice: num(t.unit_price),
    product: t.product,
    merchant: t.merchant,
    brand: t.brand,
    points,
    precision: points.length ? (t.geocode_precision ?? 'exact') : null,
    placeLabel: t.place_label,
    cityRadiusM: null,
    cardLast4: t.card_last4,
    cardholderUserId: cardholder,
  }
}

function zoneCentroid(zones: { ring: [number, number][] }[]): LatLng | null {
  let n = 0, lat = 0, lng = 0
  for (const z of zones) for (const [x, y] of z.ring) { lat += y; lng += x; n++ }
  return n ? { lat: lat / n, lng: lng / n } : null
}

async function trackerCaps(svc: SupabaseClient, ids: string[], assetById: Map<string, AssetRow>): Promise<Map<string, { everReported: boolean; fuel: boolean; ignition: boolean }>> {
  const out = new Map<string, { everReported: boolean; fuel: boolean; ignition: boolean }>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const cols = ['asset_id', 'ign:readings->"engine.ignition.status"', ...FUEL_LEVEL_KEYS.map((k, j) => `f${j}:readings->"${k}"`)].join(', ')
    const { data } = await svc.from('asset_telemetry_latest').select(cols).in('asset_id', chunk)
    const seen = new Set<string>()
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const id = String(r.asset_id)
      seen.add(id)
      const kind = trackerKind(assetById.get(id)?.tracker_id).key
      out.set(id, {
        everReported: true,
        fuel: FUEL_LEVEL_KEYS.some((_, j) => r[`f${j}`] != null),
        ignition: r.ign != null || kind === 'obd' || kind === 'wired',
      })
    }
    // No readings row (a phone, an OEM machine, a tracker that predates 115):
    // ask for one fix and whether any fix ever carried an engine state.
    for (const id of chunk.filter((x) => !seen.has(x))) {
      const a = assetById.get(id)
      if (!a?.tracker_id) continue
      const { data: last } = await svc.from('asset_locations').select('timestamp, ignition').eq('asset_id', id).order('timestamp', { ascending: false }).limit(1)
      const row = (last ?? [])[0] as { ignition: boolean | null } | undefined
      out.set(id, { everReported: !!row, fuel: false, ignition: !!row && (row.ignition != null || a.tracker_id.startsWith('aemp:')) })
    }
  }
  return out
}

async function loadShifts(svc: SupabaseClient, companyId: string, userIds: string[], rows: TxnRow[]):
  Promise<Map<string, { usesClock: boolean; entries: { inMs: number; outMs: number | null }[] }>> {
  const out = new Map<string, { usesClock: boolean; entries: { inMs: number; outMs: number | null }[] }>()
  if (!userIds.length || !rows.length) return out
  const days = rows.map((r) => r.txn_date).sort()
  const from = addDaysKey(days[0], -CLOCK_USE_DAYS)
  const to = addDaysKey(days[days.length - 1], CLOCK_USE_DAYS + 1)
  const { data } = await svc.from('time_entries').select('user_id, clock_in_at, clock_out_at')
    .eq('company_id', companyId).in('user_id', userIds.slice(0, 200))
    .gte('clock_in_at', `${from}T00:00:00Z`).lt('clock_in_at', `${to}T00:00:00Z`).limit(5000)
  for (const u of userIds) out.set(u, { usesClock: false, entries: [] })
  for (const r of (data ?? []) as { user_id: string; clock_in_at: string; clock_out_at: string | null }[]) {
    const s = out.get(r.user_id)
    const inMs = ms(r.clock_in_at)
    if (!s || inMs == null) continue
    s.usesClock = true
    s.entries.push({ inMs, outMs: ms(r.clock_out_at) })
  }
  return out
}

interface NearRow { assetId: string; firstMs: number; lastMs: number; n: number; stillN: number; minM: number }
async function fuelNear(svc: SupabaseClient, companyId: string, assetId: string | null, fromMs: number, toMs: number, pts: LatLng[], radiusM: number): Promise<NearRow[]> {
  const { data, error } = await svc.rpc('fuel_near', {
    p_company: companyId, p_asset: assetId, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString(),
    p_lat: pts.slice(0, 12).map((p) => p.lat), p_lng: pts.slice(0, 12).map((p) => p.lng), p_radius_m: radiusM,
  })
  if (error) throw new Error(`fuel_near: ${error.message}`)
  return ((data ?? []) as { asset_id: string; first_at: string; last_at: string; n: number; still_n: number; min_m: number }[])
    .map((r) => ({ assetId: r.asset_id, firstMs: ms(r.first_at) ?? fromMs, lastMs: ms(r.last_at) ?? fromMs, n: Number(r.n) || 0, stillN: Number(r.still_n) || 0, minM: Number(r.min_m) || 0 }))
}

async function fuelStops(svc: SupabaseClient, companyId: string, assetId: string, fromMs: number, toMs: number): Promise<StopRec[]> {
  const { data, error } = await svc.rpc('fuel_stops', { p_company: companyId, p_asset: assetId, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString() })
  if (error) throw new Error(`fuel_stops: ${error.message}`)
  return mergeStops(((data ?? []) as { lat: number; lng: number; first_at: string; last_at: string; n: number; engine_off: boolean }[])
    .map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), fromMs: ms(r.first_at) ?? fromMs, toMs: ms(r.last_at) ?? fromMs, n: Number(r.n) || 0, engineOff: !!r.engine_off })))
}

async function fuelGauge(svc: SupabaseClient, companyId: string, assetId: string, fromMs: number, toMs: number): Promise<FuelSample[]> {
  const { data, error } = await svc.rpc('fuel_gauge', { p_company: companyId, p_asset: assetId, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString() })
  if (error) throw new Error(`fuel_gauge: ${error.message}`)
  return ((data ?? []) as { ts: string; speed: number | null; pct: number }[])
    .map((r) => ({ ms: ms(r.ts) ?? 0, pct: Number(r.pct), mph: r.speed }))
    .filter((s) => s.ms > 0 && Number.isFinite(s.pct))
}

/** Off-site stops of 2–90 minutes: is a fuel station there? (≤ 6 per purchase.) */
async function lookUpFuelStops(svc: SupabaseClient, companyId: string, stops: StopRec[], zones: { kind: string; ring: [number, number][] }[], b: PhotonBudget, memo: Map<string, string>) {
  let asked = 0
  for (const s of stops) {
    if (!isRealStop(s) || s.fuelStation !== undefined) continue
    if (zones.some((z) => metresToRing(s, z.ring) === 0)) continue
    if (s.toMs - s.fromMs > 90 * 60_000) { s.fuelStation = ''; continue }
    if (asked >= 6) break
    asked++
    const name = await fuelStationNear(svc, companyId, s, b, memo)
    if (name !== undefined) s.fuelStation = name
  }
}

async function anyFix(svc: SupabaseClient, assetId: string, fromMs: number, toMs: number): Promise<number> {
  const { data } = await svc.from('asset_locations').select('id').eq('asset_id', assetId)
    .gte('timestamp', new Date(fromMs).toISOString()).lt('timestamp', new Date(toMs).toISOString()).limit(1)
  return (data ?? []).length
}

async function fixBefore(svc: SupabaseClient, assetId: string, t: number): Promise<FixRec | null> {
  const { data } = await svc.from('asset_locations').select('lat, lng, speed, timestamp').eq('asset_id', assetId)
    .lte('timestamp', new Date(t).toISOString()).gte('timestamp', new Date(t - 6 * HOUR).toISOString())
    .order('timestamp', { ascending: false }).limit(1)
  const r = (data ?? [])[0] as { lat: number; lng: number; speed: number | null; timestamp: string } | undefined
  return r ? { lat: r.lat, lng: r.lng, speed: r.speed, ms: ms(r.timestamp) ?? t } : null
}
async function fixAfter(svc: SupabaseClient, assetId: string, t: number): Promise<FixRec | null> {
  const { data } = await svc.from('asset_locations').select('lat, lng, speed, timestamp').eq('asset_id', assetId)
    .gte('timestamp', new Date(t).toISOString()).lte('timestamp', new Date(t + 6 * HOUR).toISOString())
    .order('timestamp', { ascending: true }).limit(1)
  const r = (data ?? [])[0] as { lat: number; lng: number; speed: number | null; timestamp: string } | undefined
  return r ? { lat: r.lat, lng: r.lng, speed: r.speed, ms: ms(r.timestamp) ?? t } : null
}

/** The first fix with the engine on or moving inside the window, and the
 *  newest fix up to six hours past it (the tracker was alive to tell). */
async function runtimeAfter(svc: SupabaseClient, assetId: string, fromMs: number, toMs: number) {
  const fromIso = new Date(fromMs).toISOString()
  const [run, last] = await Promise.all([
    svc.from('asset_locations').select('timestamp').eq('asset_id', assetId)
      .gte('timestamp', fromIso).lt('timestamp', new Date(toMs).toISOString())
      .or('ignition.is.true,speed.gt.2').order('timestamp', { ascending: true }).limit(1),
    svc.from('asset_locations').select('timestamp').eq('asset_id', assetId)
      .gte('timestamp', fromIso).lt('timestamp', new Date(toMs + 6 * HOUR).toISOString())
      .order('timestamp', { ascending: false }).limit(1),
  ])
  const r0 = (run.data ?? [])[0] as { timestamp: string } | undefined
  const l0 = (last.data ?? [])[0] as { timestamp: string } | undefined
  return { fromMs, toMs, firstRunMs: r0 ? ms(r0.timestamp) : null, lastFixMs: l0 ? ms(l0.timestamp) : null }
}

/** The vehicle's path that day from the daily trail rollups (077): cheap,
 *  ~5-minute resolution — plenty for "is this station on its route". */
async function dayTrail(svc: SupabaseClient, assetId: string, fromMs: number, toMs: number): Promise<LatLng[]> {
  const days = Array.from(new Set([new Date(fromMs).toISOString().slice(0, 10), new Date(toMs - 1).toISOString().slice(0, 10)]))
  const { data } = await svc.from('trail_daily').select('pts').eq('asset_id', assetId).in('day', days)
  const out: LatLng[] = []
  for (const row of (data ?? []) as { pts: unknown }[]) {
    if (!Array.isArray(row.pts)) continue
    for (const p of row.pts as unknown[]) {
      if (!Array.isArray(p)) continue
      const [lng, lat, sec] = p as [number, number, number]
      if (Number.isFinite(lat) && Number.isFinite(lng) && sec * 1000 >= fromMs && sec * 1000 < toMs) out.push({ lat, lng })
    }
  }
  return out
}

// ── Getting purchases in ────────────────────────────────────────────────────

/** A purchase row from an import line (the vehicle, driver and site already matched). */
export function rowFromDraft(d: FuelDraft, extra: { companyId: string; userId: string | null; assetId: string | null; cardholderUserId: string | null; geofenceId: string | null }): Record<string, unknown> {
  const placed = d.lat != null && d.lng != null
  return {
    company_id: extra.companyId, source: 'csv', dedupe_key: d.dedupeKey,
    txn_at: d.txnAtMs != null ? new Date(d.txnAtMs).toISOString() : null, txn_date: d.txnDate, has_time: d.hasTime,
    merchant: d.merchant, brand: d.brand, store_no: d.storeNo, address: d.address, city: d.city, state: d.state, zip: d.zip,
    city_candidates: d.cityCandidates.slice(0, 3),
    lat: placed ? d.lat : null, lng: placed ? d.lng : null,
    merchant_points: placed ? [{ lat: d.lat, lng: d.lng }] : null,
    geocode_source: placed ? 'export' : null, geocode_precision: placed ? 'exact' : null,
    place_label: placed ? d.merchant.slice(0, 60) : null, geocoded_at: placed ? new Date().toISOString() : null,
    gallons: d.gallons, gallons_estimated: false, unit_price: d.unitPrice, amount: d.amount, product: d.product,
    card_last4: d.cardLast4, cardholder_user_id: extra.cardholderUserId, driver_text: d.driver, vehicle_text: d.vehicle, job_text: d.job,
    asset_id: extra.assetId, asset_source: extra.assetId ? 'row' : null, geofence_id: extra.geofenceId,
    odometer: d.odometer, raw: d.raw, created_by: extra.userId,
  }
}

/** What an import line adds to a purchase that came in another door first
 *  (a card alert has the time; the statement has gallons and the address). */
export function enrichPatch(existing: TxnRow, d: FuelDraft): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (!existing.has_time && d.hasTime && d.txnAtMs != null) { p.txn_at = new Date(d.txnAtMs).toISOString(); p.has_time = true }
  if ((existing.gallons == null || existing.gallons_estimated) && d.gallons != null) { p.gallons = d.gallons; p.gallons_estimated = false }
  if (existing.unit_price == null && d.unitPrice != null) p.unit_price = d.unitPrice
  if (!existing.product && d.product) p.product = d.product
  if (!existing.card_last4 && d.cardLast4) p.card_last4 = d.cardLast4
  if (!existing.driver_text && d.driver) p.driver_text = d.driver
  if (!existing.vehicle_text && d.vehicle) p.vehicle_text = d.vehicle
  if (!existing.job_text && d.job) p.job_text = d.job
  if (existing.odometer == null && d.odometer != null) p.odometer = d.odometer
  if (!existing.address && d.address) {
    // A street address places the station better than the card line did.
    Object.assign(p, { address: d.address, city: d.city ?? existing.city, state: d.state ?? existing.state, zip: d.zip ?? existing.zip, geocoded_at: null })
  }
  if (d.lat != null && d.lng != null && existing.geocode_source !== 'export') {
    Object.assign(p, { lat: d.lat, lng: d.lng, merchant_points: [{ lat: d.lat, lng: d.lng }], geocode_source: 'export', geocode_precision: 'exact', geocoded_at: new Date().toISOString() })
  }
  const alt = new Set(existing.alt_keys ?? [])
  alt.add(d.dedupeKey)
  p.alt_keys = Array.from(alt).slice(0, 20)
  return p
}

/** Lookups a fuel import line is matched against: vehicles by name / unit /
 *  plate / serial, people by name, sites by name. Unique matches only. */
export interface MatchBook {
  vehicle: (text: string | null) => string | null
  person: (text: string | null) => string | null
  site: (text: string | null) => string | null
}
export function matchBook(assets: { id: string; name: string; type: string; serial?: string | null; metadata?: unknown }[], people: { id: string; name: string | null }[], zones: { id: string; name: string }[]): MatchBook {
  const n = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const unique = <T extends { id: string }>(list: T[], keys: (x: T) => string[], text: string | null): string | null => {
    const q = n(text)
    if (q.length < 2) return null
    const exact = list.filter((x) => keys(x).some((k) => k && k === q))
    if (exact.length === 1) return exact[0].id
    if (exact.length > 1) return null
    const loose = list.filter((x) => keys(x).some((k) => k.length >= 3 && q.length >= 3 && (k.includes(q) || q.includes(k))))
    return loose.length === 1 ? loose[0].id : null
  }
  const fleet = assets.filter((a) => a.type === 'vehicle' || a.type === 'equipment')
  const vkeys = (a: (typeof fleet)[number]) => {
    const md = (a.metadata && typeof a.metadata === 'object' ? a.metadata : {}) as Record<string, unknown>
    return [n(a.name), n(a.serial), n(md.license as string), n(md.unit as string), n(md.asset_tag as string), n(md.vin as string)].filter(Boolean)
  }
  return {
    vehicle: (text) => unique(fleet, vkeys, text),
    person: (text) => unique(people.filter((p) => p.name).map((p) => ({ id: p.id, name: p.name! })), (p) => [n(p.name)], text),
    site: (text) => unique(zones, (z) => [n(z.name)], text),
  }
}

/** Fuel card alerts / receipts already in `expenses` → purchases (source
 *  'expense'), so card alerts feed the pilot on their own once they're live.
 *  A purchase the statement already brought in is linked, not doubled. */
export async function mirrorFuelExpenses(svc: SupabaseClient, companyId: string, sinceKey: string): Promise<{ added: number; linked: number }> {
  const out = { added: 0, linked: 0 }
  const { data: exps, error } = await svc.from('expenses')
    .select('id, merchant, amount, txn_date, last4, cardholder_user_id, category, source, created_at, swipe_lat, swipe_lng, swipe_asset_id')
    .eq('company_id', companyId).gte('txn_date', sinceKey).limit(3000)
  if (error || !exps?.length) return out
  const fuel = (exps as Record<string, unknown>[]).filter((e) =>
    String(e.merchant ?? '') !== 'HammerTrack test swipe' && Number(e.amount) > 0 &&
    (/fuel/i.test(String(e.category ?? '')) || isFuelMerchant(String(e.merchant ?? ''))))
  if (!fuel.length) return out
  const { data: have } = await svc.from('fuel_transactions').select(TXN_COLS).eq('company_id', companyId).gte('txn_date', addDaysKey(sinceKey, -1)).limit(5000)
  const existing = (have ?? []) as unknown as TxnRow[]
  const linked = new Set(existing.map((t) => t.expense_id).filter(Boolean))
  for (const e of fuel) {
    const id = String(e.id)
    if (linked.has(id)) continue
    const merchant = String(e.merchant ?? '').slice(0, 160) || 'Fuel'
    const parts = parseMerchant(merchant)
    // A card alert lands within seconds of the swipe — its arrival is the time.
    const timed = e.source === 'card_alert'
    const atMs = timed ? ms(String(e.created_at)) : null
    const me = { txnDate: String(e.txn_date), amount: Number(e.amount), cardLast4: (e.last4 as string | null) ?? null, txnAtMs: atMs, brand: parts.brand }
    const match = existing.find((t) => !t.expense_id && samePurchase(me, {
      txnDate: t.txn_date, amount: Number(t.amount), cardLast4: t.card_last4, txnAtMs: t.has_time ? ms(t.txn_at) : null, brand: t.brand,
    }))
    if (match) {
      const patch: Record<string, unknown> = { expense_id: id, alt_keys: Array.from(new Set([...(match.alt_keys ?? []), `exp:${id}`])).slice(0, 20) }
      if (!match.has_time && atMs != null) { patch.txn_at = new Date(atMs).toISOString(); patch.has_time = true }
      if (!match.cardholder_user_id && e.cardholder_user_id) patch.cardholder_user_id = e.cardholder_user_id
      const { error: upErr } = await svc.from('fuel_transactions').update(patch).eq('id', match.id).eq('company_id', companyId)
      if (!upErr) { out.linked++; match.expense_id = id }
      continue
    }
    const { error: insErr } = await svc.from('fuel_transactions').insert({
      company_id: companyId, source: 'expense', dedupe_key: `exp:${id}`, expense_id: id,
      txn_at: atMs != null ? new Date(atMs).toISOString() : null, txn_date: String(e.txn_date), has_time: atMs != null,
      merchant, brand: parts.brand, store_no: parts.storeNo, state: parts.state, zip: parts.zip, city_candidates: parts.cityCandidates.slice(0, 3),
      amount: Math.round(Number(e.amount) * 100) / 100, product: null, card_last4: /^\d{4}$/.test(String(e.last4 ?? '')) ? e.last4 : null,
      cardholder_user_id: e.cardholder_user_id ?? null,
      raw: { expense: { source: e.source, category: e.category, swipe_lat: e.swipe_lat, swipe_lng: e.swipe_lng, swipe_asset_id: e.swipe_asset_id } },
    })
    if (!insErr) out.added++
    else if (!/duplicate|unique/i.test(insErr.message)) console.error('fuel mirror insert failed:', insErr.message)
  }
  return out
}

/** Local "today" for a company (digest_prefs.tz, else Eastern). */
export function companyToday(digestPrefs: unknown, nowMs = Date.now()): { tz: string; todayKey: string } {
  const tzRaw = digestPrefs && typeof digestPrefs === 'object' ? (digestPrefs as { tz?: unknown }).tz : null
  const tz = safeTz(typeof tzRaw === 'string' ? tzRaw : null)
  return { tz, todayKey: dayKey(nowMs, tz) }
}
