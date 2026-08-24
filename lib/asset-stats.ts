/**
 * Per-asset activity math — miles, moving/idle/parked time, starts, fuel
 * estimate — computed from raw ping streams. Shared by the asset panel's
 * range table (/api/asset-stats) and the AI assistant's asset_activity tool
 * so both always report identical numbers.
 */

export interface StatPoint {
  lat: number
  lng: number
  speed: number | null
  ms: number
  /** Engine state at this fix (asset_locations.ignition, 034). null/undefined
   *  = unknown (no OBD on that ping, or pre-migration row). */
  ign?: boolean | null
}

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
// Without an ignition signal, "idle" needs engine-on CADENCE: ignition-on
// trackers report every few seconds to ~1 min; anything slower is a parked
// device checking in, not a running engine. (The old 15-min rule counted a
// parked-but-awake device as idling — 19h of phantom idle in a day, Jul 16.)
export const IDLE_CADENCE_MS = 3 * 60_000
// Unknown-ignition stationary blocks longer than this are PARKING, not idle
// — phones ping tightly all night, which racked 12h of phantom idle on the
// RAM (Brian, Aug 23). Real OBD ignition is unaffected by this cap.
export const IDLE_MAX_UNKNOWN_MS = 45 * 60_000
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

/** Per-vehicle fuel-burn guess. Order of trust: VIN-decoded specs, then the
 *  asset's NAME (a "Chevy 1500" is a pickup whether or not anyone pasted the
 *  VIN), then the work-truck default. Still an estimate until OBD fuel lands. */
export function estMpgForSpecs(specs: unknown, assetName = ''): number {
  const sp = (specs ?? {}) as Record<string, unknown>
  const body = String(sp.body ?? '').toLowerCase()
  const fuel = String(sp.fuel ?? '').toLowerCase()
  const diesel = fuel.includes('diesel')
  if (/pickup|truck/.test(body)) return diesel ? 14 : 15
  if (/van/.test(body)) return 16
  if (/suv|sport utility|mpv|multi-purpose|crossover/.test(body)) return 19
  if (/sedan|coupe|hatch|wagon|convertible|car/.test(body)) return 25

  // No specs — read the name like a person would.
  const n = ` ${assetName.toLowerCase()} `
  if (/(1500|2500|3500|f-?150|f-?250|f-?350|silverado|sierra|tundra|titan|ranger|colorado|tacoma|gladiator|ram|pickup)/.test(n)) {
    return /diesel|duramax|cummins|powerstroke/.test(n) ? 14 : 15
  }
  if (/(sprinter|transit|promaster|savana|express|van)/.test(n)) return 16
  if (/(atlas|tahoe|suburban|yukon|expedition|explorer|4runner|highlander|pilot|traverse|durango|grand cherokee|suv)/.test(n)) return 19
  if (/(camry|accord|civic|corolla|malibu|fusion|altima|sedan)/.test(n)) return 25
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
  // Unknown-ignition idle is BANKED, not committed (see below): it only
  // becomes idle when movement bounds the stop, or the window ends first.
  let pendingIdleMs = 0
  let blockMs = 0
  let blockDead = false
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
      // Teleport guard: when position AND speed glitch together the distance
      // test passes — so implausibly fast samples (95+) also need a neighbor
      // reporting similar speed. A real 95 run has many consecutive samples.
      if (trusted && mph >= 95) {
        const nb = [prev?.speed ?? 0, win[i + 1]?.speed ?? 0]
        if (!nb.some((s) => s >= mph * 0.6)) trusted = false
      }
      if (trusted) maxMph = mph
    }
    if (prev && dt <= MAX_SEG_GAP_MS) {
      miles += haversineMi(prev.lat, prev.lng, p.lat, p.lng)
      if ((prev.speed ?? 0) >= MOVE_MPH || mph >= MOVE_MPH) {
        movingMs += dt
        // Movement vouches for the stop that just ended: an unknown-ignition
        // stationary block bounded by driving on both sides was a truck
        // waiting with the engine running — commit it as idle.
        idleMs += pendingIdleMs
        pendingIdleMs = 0
        blockMs = 0
        blockDead = false
      } else {
        // IDLE = engine ON and not moving. Trust the stored ignition when we
        // have it; explicit engine-off is parked time, never idle.
        const engineOn = p.ign ?? prev.ign
        if (engineOn === true) {
          idleMs += dt + pendingIdleMs // real ignition absorbs any pending
          pendingIdleMs = 0
          // A proven-running engine vouches for the stop like movement does
          // — reset the cap so a unit that intermittently drops the ignition
          // param doesn't get its later banked time written off (ship-check).
          blockMs = 0
          blockDead = false
        } else if (engineOn === false) {
          pendingIdleMs = 0
          blockDead = true
        } else if (!blockDead && dt <= IDLE_CADENCE_MS) {
          // Unknown ignition (phone trackers, GPS-only units): tight cadence
          // alone is NOT proof of a running engine — a phone parked at home
          // pings all night and racked up 12h of phantom idle (Brian,
          // Aug 23). Bank the time and only commit it when the truck MOVES
          // again within the cap; a block that outlives the cap is parking.
          pendingIdleMs += dt
          blockMs += dt
          if (blockMs > IDLE_MAX_UNKNOWN_MS) { pendingIdleMs = 0; blockDead = true }
        }
        // else: parked (accrues via the span remainder below)
      }
    } else if (prev) {
      // Sleep gap — whatever stop was pending was parking, and the wake-up
      // starts a fresh block.
      pendingIdleMs = 0
      blockMs = 0
      blockDead = false
    }
    if (mph >= MOVE_MPH) {
      if (lastMovingMs === null || p.ms - lastMovingMs > START_GAP_MS) starts++
      lastMovingMs = p.ms
    }
  }
  // A short stop still in progress at the window's edge counts — only blocks
  // that already outlived the cap were written off as parking.
  if (!blockDead) idleMs += pendingIdleMs
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
