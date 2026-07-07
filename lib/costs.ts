import type { Asset } from './types'

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
  hourly_rate?: number | null
  mileage_rate?: number | null
  daily_cost?: number | null
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
