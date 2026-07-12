/**
 * Per-asset activity math — miles, moving/idle/parked time, starts, fuel
 * estimate — computed from raw ping streams. Shared by the asset panel's
 * range table (/api/asset-stats) and the AI assistant's asset_activity tool
 * so both always report identical numbers.
 */

export interface StatPoint { lat: number; lng: number; speed: number | null; ms: number }

export interface RangeStats {
  miles: number
  maxMph: number
  movingMin: number
  idleMin: number
  parkedMin: number
  starts: number
  fuelGalEst: number
}

// Ignore distance across silence — the truck was towed/parked, not driving.
export const MAX_SEG_GAP_MS = 15 * 60_000
// Speed at/above this = moving; awake below it = idling (engine on, parked
// trackers sleep and check in ~hourly, so tight ping cadence means running).
export const MOVE_MPH = 2
// A new moving run after this much non-movement counts as a fresh start.
export const START_GAP_MS = 5 * 60_000
// Fuel estimate: distance at a work-truck 15 mpg + idle burn ~0.6 gal/h.
export const EST_MPG = 15
export const IDLE_GAL_PER_H = 0.6

export const haversineMi = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Per-vehicle fuel-burn guess from the VIN-decoded specs. Still an estimate
 *  (until OBD fuel data is wired), but "SUV at 19" beats "everything at 15". */
export function estMpgForSpecs(specs: unknown): number {
  const sp = (specs ?? {}) as Record<string, unknown>
  const body = String(sp.body ?? '').toLowerCase()
  const fuel = String(sp.fuel ?? '').toLowerCase()
  const diesel = fuel.includes('diesel')
  if (/pickup|truck/.test(body)) return diesel ? 14 : 15
  if (/van/.test(body)) return 16
  if (/suv|sport utility|mpv|multi-purpose|crossover/.test(body)) return 19
  if (/sedan|coupe|hatch|wagon|convertible|car/.test(body)) return 25
  return EST_MPG
}

/** Stats for chronological points within [from, to). `earliestMs` bounds the
 *  "existed" span so parked time doesn't accrue before the tracker's first
 *  ever fix; `nowMs` bounds it on the live end. */
export function computeRangeStats(
  pts: StatPoint[],
  from: number,
  to: number,
  earliestMs: number | null,
  nowMs = Date.now(),
  estMpg = EST_MPG
): RangeStats {
  // Window slice up front so top-speed corroboration can peek at neighbors.
  const win = pts.filter((p) => p.ms >= from && p.ms < to)
  let miles = 0
  let maxMph = 0
  let movingMs = 0
  let idleMs = 0
  let starts = 0
  let lastMovingMs: number | null = null
  for (let i = 0; i < win.length; i++) {
    const p = win[i]
    const prev = i > 0 ? win[i - 1] : null
    const mph = p.speed ?? 0
    const dt = prev ? p.ms - prev.ms : Infinity
    if (mph > maxMph) {
      // Top-speed trust ladder. GPS glitches come in CLUSTERS (multipath
      // bursts corroborate each other), and a km/h-as-mph unit error
      // inflates by exactly 1.61x — so above 80 mph only physics votes:
      // the fixes must actually be that far apart. 50–80 may also pass on
      // a similar neighbor; under 50 nobody fakes it.
      let trusted = mph < 50
      if (!trusted && prev && dt > 0 && dt <= 90_000) {
        const impliedMph = haversineMi(prev.lat, prev.lng, p.lat, p.lng) / (dt / 3_600_000)
        if (impliedMph * 1.25 + 8 >= mph) trusted = true
      }
      if (!trusted && mph < 80) {
        const nb = [prev?.speed ?? 0, win[i + 1]?.speed ?? 0]
        if (nb.some((s) => s >= mph * 0.6)) trusted = true
      }
      if (trusted) maxMph = mph
    }
    if (prev && dt <= MAX_SEG_GAP_MS) {
      miles += haversineMi(prev.lat, prev.lng, p.lat, p.lng)
      // Awake time splits into moving vs idling; sleep gaps (>15 min
      // between pings, engine off) fall through to "parked".
      if ((prev.speed ?? 0) >= MOVE_MPH || mph >= MOVE_MPH) movingMs += dt
      else idleMs += dt
    }
    if (mph >= MOVE_MPH) {
      if (lastMovingMs === null || p.ms - lastMovingMs > START_GAP_MS) starts++
      lastMovingMs = p.ms
    }
  }
  // Stationary = the part of the window the asset existed but wasn't
  // moving or idling (device asleep, engine off).
  const spanFrom = earliestMs === null ? null : Math.max(from, earliestMs)
  const spanTo = Math.min(to, nowMs)
  const spanMs = spanFrom !== null && spanTo > spanFrom ? spanTo - spanFrom : 0
  const parkedMs = Math.max(0, spanMs - movingMs - idleMs)
  const fuelGal = miles / estMpg + (idleMs / 3_600_000) * IDLE_GAL_PER_H
  return {
    miles: Math.round(miles * 10) / 10,
    maxMph: Math.round(maxMph),
    movingMin: Math.round(movingMs / 60_000),
    idleMin: Math.round(idleMs / 60_000),
    parkedMin: Math.round(parkedMs / 60_000),
    starts,
    fuelGalEst: Math.round(fuelGal * 10) / 10,
  }
}
