import type { Asset, AssetType } from './types'

/**
 * Real job-cost accrual from observed telemetry + per-asset rates.
 *
 * Replaces the demo PROJECTS math on live accounts: cost accrues only from
 * (a) time an asset was actually active (hourly_rate × observed active time),
 * (b) distance actually driven (mileage_rate × GPS distance), and
 * (c) ownership cost that accrues with wall-clock time (daily_cost).
 * No rates set → zero — the map chip says "no rates set" instead of lying.
 */

export interface CostInput {
  id: string
  type?: AssetType
  hourly_rate?: number | null
  mileage_rate?: number | null
  daily_cost?: number | null
}

/**
 * How each asset type accrues cost INSIDE a zone:
 *   vehicle   — operating only (hourly while moving + $/mile). Pickups come and
 *               go; a parked truck isn't a site cost.
 *   equipment — operating (hourly while moving) + ownership prorated across ALL
 *               time on site. An idle excavator on a job still costs you.
 *   personnel — labor: hourly_rate × ALL time present (a worker is paid whether
 *               moving or not). No mileage, no ownership.
 *   tool      — no time-based cost (value is theft/replacement, not job hours).
 */
interface ZonePolicy { operatingWhileMoving: boolean; laborAllPresent: boolean; mileage: boolean; ownership: boolean }
const ZONE_POLICY: Record<AssetType, ZonePolicy> = {
  vehicle:   { operatingWhileMoving: true,  laborAllPresent: false, mileage: true,  ownership: false },
  equipment: { operatingWhileMoving: true,  laborAllPresent: false, mileage: false, ownership: true },
  personnel: { operatingWhileMoving: false, laborAllPresent: true,  mileage: false, ownership: false },
  tool:      { operatingWhileMoving: false, laborAllPresent: false, mileage: false, ownership: false },
}

export interface HistoryPoint {
  asset_id: string
  lat: number
  lng: number
  speed: number | null
  timestamp: string
}

export interface CostCurve {
  /** Cumulative $ at N evenly spaced positions across the window (t=0..1). */
  curve: number[]
  /** False when no asset has any rate — UI should prompt instead of showing $0. */
  hasRates: boolean
}

const BUCKETS = 96
// A gap longer than this between two pings means the asset was asleep/off —
// don't bill the gap as active time.
const MAX_ACTIVE_GAP_MS = 10 * 60_000
// Below ~1 mph and ~25 m the "movement" is GPS jitter, not work.
const MIN_ACTIVE_SPEED = 1
const MIN_MOVE_METERS = 25

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function buildCostCurve(
  assets: (Asset | CostInput)[],
  rows: HistoryPoint[],
  windowFromMs: number,
  windowToMs: number
): CostCurve {
  const span = Math.max(1, windowToMs - windowFromMs)
  const perBucket = new Array<number>(BUCKETS).fill(0)
  const rates = new Map(assets.map((a) => [a.id, a]))
  const hasRates = assets.some(
    (a) => (a.hourly_rate ?? 0) > 0 || (a.mileage_rate ?? 0) > 0 || (a.daily_cost ?? 0) > 0
  )

  // Ownership: accrues linearly across the whole window for every rated asset.
  for (const a of assets) {
    const daily = a.daily_cost ?? 0
    if (daily > 0) {
      const total = (daily * span) / 86_400_000
      for (let i = 0; i < BUCKETS; i++) perBucket[i] += total / BUCKETS
    }
  }

  // Activity: walk consecutive pings per asset (rows are oldest-first).
  const last = new Map<string, HistoryPoint & { ms: number }>()
  for (const r of rows) {
    const ms = new Date(r.timestamp).getTime()
    if (!Number.isFinite(ms)) continue
    const prev = last.get(r.asset_id)
    last.set(r.asset_id, { ...r, ms })
    if (!prev) continue

    const a = rates.get(r.asset_id)
    if (!a) continue
    const dt = ms - prev.ms
    if (dt <= 0 || dt > MAX_ACTIVE_GAP_MS) continue

    const dist = haversineMeters(prev.lat, prev.lng, r.lat, r.lng)
    const moving = (r.speed ?? 0) > MIN_ACTIVE_SPEED || dist > MIN_MOVE_METERS
    if (!moving) continue

    let cost = 0
    if ((a.hourly_rate ?? 0) > 0) cost += (a.hourly_rate! * dt) / 3_600_000
    if ((a.mileage_rate ?? 0) > 0) cost += a.mileage_rate! * (dist / 1609.34)
    if (cost <= 0) continue

    const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((ms - windowFromMs) / span) * BUCKETS)))
    perBucket[bucket] += cost
  }

  // Cumulative sum → cost "builds" as the scrubber moves, like a real ledger.
  const curve: number[] = new Array(BUCKETS)
  let acc = 0
  for (let i = 0; i < BUCKETS; i++) {
    acc += perBucket[i]
    curve[i] = acc
  }
  return { curve, hasRates }
}


// ── Per-zone job cost from history ──────────────────────────────────────────

export interface ZoneCost {
  total: number
  /** Hours of observed ACTIVE (moving) time inside the zone. */
  activeHours: number
  /** Hours observed parked/idle inside the zone (engine-off check-ins count). */
  idleHours: number
}

/** Cumulative per-zone curves so the zone popup can read cost AT the scrub
 *  position, exactly like the timeline's hard-hat chip. */
export interface ZoneCostCurve {
  cost: number[]  // cumulative $ per bucket (t = i / (BUCKETS-1))
  hours: number[] // cumulative active hours inside the zone
  idle: number[]  // cumulative idle/parked hours inside the zone
}

export function zoneCostAt(curve: ZoneCostCurve, t: number): ZoneCost {
  const idx = Math.min(curve.cost.length - 1, Math.max(0, Math.floor(t * (curve.cost.length - 1))))
  return { total: curve.cost[idx] ?? 0, activeHours: curve.hours[idx] ?? 0, idleHours: curve.idle[idx] ?? 0 }
}

import { pointInPolygon } from './alerts-engine'

/**
 * Real cost accrued INSIDE each geofence over the window: walks consecutive
 * point pairs per asset and only counts pairs whose current fix is inside the
 * zone — so the meter stops the moment an asset leaves. Two components:
 *   - operating: hourly rate while actually MOVING + $/mile driven (work done)
 *   - ownership: daily_cost prorated across ALL time present in the zone
 *     (moving OR idle) — an asset tied up on a site costs its ownership share.
 * So a truck parked on a job all day accrues ownership even at 0 mph.
 */
export function zoneCostsFromHistory(
  geofences: { id: string; geometry: { coordinates: unknown[] } }[],
  assets: (Asset | CostInput)[],
  rows: HistoryPoint[],
  windowFromMs?: number,
  windowToMs?: number
): Record<string, ZoneCostCurve> {
  const from = windowFromMs ?? (rows.length ? new Date(rows[0].timestamp).getTime() : 0)
  const to = windowToMs ?? (rows.length ? new Date(rows[rows.length - 1].timestamp).getTime() : 1)
  const span = Math.max(1, to - from)
  const out: Record<string, ZoneCostCurve> = {}
  const perBucket: Record<string, { cost: number[]; hours: number[]; idle: number[] }> = {}
  const rings = geofences.map((g) => ({
    id: g.id,
    ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][],
  })).filter((g) => g.ring.length >= 3)
  for (const g of rings) perBucket[g.id] = { cost: new Array(BUCKETS).fill(0), hours: new Array(BUCKETS).fill(0), idle: new Array(BUCKETS).fill(0) }
  if (!rings.length) return out

  const rates = new Map(assets.map((a) => [a.id, a]))
  const last = new Map<string, HistoryPoint & { ms: number }>()
  for (const r of rows) {
    const ms = new Date(r.timestamp).getTime()
    if (!Number.isFinite(ms)) continue
    const prev = last.get(r.asset_id)
    last.set(r.asset_id, { ...r, ms })
    if (!prev) continue
    const a = rates.get(r.asset_id)
    if (!a) continue
    const dt = ms - prev.ms
    // Idle counts across engine-off hourly check-ins (device sleeps ~1h between
    // pings while parked); active billing keeps the tight gap cap.
    const IDLE_GAP_MS = 2 * 3_600_000
    if (dt <= 0 || dt > IDLE_GAP_MS) continue

    const dist = haversineMeters(prev.lat, prev.lng, r.lat, r.lng)
    const moving = (r.speed ?? 0) > MIN_ACTIVE_SPEED || dist > MIN_MOVE_METERS
    const billable = moving && dt <= MAX_ACTIVE_GAP_MS
    const pol = ZONE_POLICY[a.type ?? 'vehicle']

    let cost = 0
    if (pol.laborAllPresent) {
      // Personnel: pay the loaded hourly rate for all time present on site.
      if ((a.hourly_rate ?? 0) > 0) cost += (a.hourly_rate! * dt) / 3_600_000
    } else if (billable && pol.operatingWhileMoving) {
      if ((a.hourly_rate ?? 0) > 0) cost += (a.hourly_rate! * dt) / 3_600_000
      if (pol.mileage && (a.mileage_rate ?? 0) > 0) cost += a.mileage_rate! * (dist / 1609.34)
    }
    if (pol.ownership && (a.daily_cost ?? 0) > 0) cost += (a.daily_cost! * dt) / 86_400_000

    const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((ms - from) / span) * BUCKETS)))
    for (const g of rings) {
      if (!pointInPolygon([r.lng, r.lat], g.ring)) continue
      perBucket[g.id].cost[bucket] += cost
      // Personnel count all present time as "active" (they're working/paid);
      // vehicles/equipment split active (moving) vs idle (parked).
      if (pol.laborAllPresent || billable) perBucket[g.id].hours[bucket] += dt / 3_600_000
      else if (!moving) perBucket[g.id].idle[bucket] += dt / 3_600_000
      break // zones rarely overlap; attribute to the first hit
    }
  }
  for (const g of rings) {
    const c: number[] = new Array(BUCKETS)
    const h: number[] = new Array(BUCKETS)
    const idl: number[] = new Array(BUCKETS)
    let ca = 0, ha = 0, ia = 0
    for (let i = 0; i < BUCKETS; i++) {
      ca += perBucket[g.id].cost[i]
      ha += perBucket[g.id].hours[i]
      ia += perBucket[g.id].idle[i]
      c[i] = ca
      h[i] = ha
      idl[i] = ia
    }
    out[g.id] = { cost: c, hours: h, idle: idl }
  }
  return out
}
