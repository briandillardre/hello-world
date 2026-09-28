/**
 * Per-asset activity math — miles, moving/idle/parked time, starts, fuel
 * estimate — computed from raw ping streams. Shared by the asset panel's
 * range table (/api/asset-stats) and the AI assistant's asset_activity tool
 * so both always report identical numbers. Also the truck's OWN fuel gauge
 * read over a window (fuelFromLevels) — `scripts/ask-activity-test.mjs`
 * asserts it against the shapes the real gauges send.
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

// ── Fuel from the truck's own gauge ─────────────────────────────────────────
// What a real OBD gauge sends (the Charleston RAM 2500, Sep 24–28): a level
// on nearly every fix while the engine runs, bouncing ±15% inside a minute as
// the fuel sloshes (brakes, corners, grades), 0 whenever the sender bottoms
// out, and nothing at all with the key off. So one fix is never "the level" —
// a median over minutes of readings is — and a fill is a step up across a
// stop: nobody fills a truck while it is rolling.

/** One gauge reading: when, and percent of the tank. */
export interface FuelSample {
  ms: number
  pct: number
  /** Speed at the fix — a vehicle's level is only trusted on the move. */
  mph?: number | null
}

export interface FuelRefuel {
  /** First reading after the fill. */
  atMs: number
  /** Last reading before it — a long gap means "sometime in between". */
  beforeMs: number
  fromPct: number
  toPct: number
  addedPct: number
}

export interface FuelGauge {
  /** Tank used across the window with the fills taken out, in percent of
   *  the tank — past 100 when it was refilled along the way. */
  usedPct: number
  startPct: number
  endPct: number
  refuels: FuelRefuel[]
  firstMs: number
  lastMs: number
  /** Readings that counted. */
  samples: number
}

/** A drop smaller than this between two fills is the sensor, not fuel. */
export const FUEL_NOISE_PCT = 2
/** A climb at least this big is a fill. The RAM's real ones ran +11% to +73%;
 *  a smoothed gauge wanders a few percent on its own. */
export const FUEL_REFUEL_MIN_PCT = 8
/** Readings this far apart are two stretches — a stop, or the key off. */
export const FUEL_RUN_GAP_MS = 2 * 60_000
/** A stretch's level at either end: the median of this much of it. */
export const FUEL_EDGE_MS = 5 * 60_000
const FUEL_EDGE_MIN_N = 12
/** A machine's level inside one stretch: five-minute medians. */
const FUEL_BUCKET_MS = 5 * 60_000
/** Gauge silent this long = whatever was driven meanwhile went unmeasured. */
export const FUEL_GAP_MS = 15 * 60_000
/** Climbs this close together are one fill, read in steps. */
const FUEL_FILL_MERGE_MS = 30 * 60_000

/** Readings that count, oldest first. 0 is the sender bottoming out (slosh
 *  in a low tank) or no value at all — never a level to measure from. A
 *  vehicle's level is only read on the move: parked on a slope it reads
 *  several percent off for as long as it sits, and a pump running with the
 *  key on reads its way up mid-fill. */
export function usableFuelSamples(samples: FuelSample[], movingOnly = false): FuelSample[] {
  return samples
    .filter((s) => Number.isFinite(s.ms) && Number.isFinite(s.pct) && s.pct > 0 && s.pct <= 100 &&
      (!movingOnly || (s.mph ?? 0) >= MOVE_MPH))
    .sort((a, b) => a.ms - b.ms)
}

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** A stretch's level at one end: the median of its first (or last) five
 *  minutes of readings — at least a dozen, reaching up to fifteen minutes in
 *  to find them. */
function edgeLevel(run: FuelSample[], side: 'head' | 'tail'): number {
  const at = (i: number) => (side === 'head' ? run[i] : run[run.length - 1 - i])
  const t0 = at(0).ms
  const pick: number[] = []
  for (let i = 0; i < run.length; i++) {
    const dt = Math.abs(at(i).ms - t0)
    if (dt > 3 * FUEL_EDGE_MS || (dt > FUEL_EDGE_MS && pick.length >= FUEL_EDGE_MIN_N)) break
    pick.push(at(i).pct)
  }
  return median(pick)
}

/** A step in the level: across a stop between two stretches, or a climb
 *  inside one. */
interface FuelStep { beforeMs: number; atMs: number; from: number; to: number }

/** Climbs inside one unbroken stretch — only a machine has them: filled with
 *  the key on, it reads its way up without a gap. Five-minute medians, then
 *  a median of three neighbours so one odd five minutes is neither a fill
 *  nor a burn, then each valley-to-peak climb. */
function climbsInside(run: FuelSample[]): FuelStep[] {
  const buckets: { firstMs: number; lastMs: number; pct: number }[] = []
  let cur: FuelSample[] = []
  const flush = () => {
    if (cur.length) buckets.push({ firstMs: cur[0].ms, lastMs: cur[cur.length - 1].ms, pct: median(cur.map((s) => s.pct)) })
    cur = []
  }
  for (const s of run) {
    if (cur.length && Math.floor(s.ms / FUEL_BUCKET_MS) !== Math.floor(cur[0].ms / FUEL_BUCKET_MS)) flush()
    cur.push(s)
  }
  flush()
  const lvl = buckets.map((b, i) =>
    i > 0 && i < buckets.length - 1 ? median([buckets[i - 1].pct, b.pct, buckets[i + 1].pct]) : b.pct)
  const out: FuelStep[] = []
  for (let i = 1; i < lvl.length; i++) {
    if (lvl[i] <= lvl[i - 1]) continue
    let j = i
    while (j + 1 < lvl.length && lvl[j + 1] >= lvl[j]) j++
    out.push({ beforeMs: buckets[i - 1].lastMs, atMs: buckets[i].firstMs, from: lvl[i - 1], to: lvl[j] })
    i = j
  }
  return out
}

/**
 * Fuel used over a window, read off the gauge. The readings split into
 * unbroken stretches (a drive; for a machine, a key-on spell). A fill is a
 * climb of FUEL_REFUEL_MIN_PCT or more across a stop — for a vehicle only
 * there, since its level is read on the move — or, for a machine, inside a
 * stretch too. What burned is counted fill to fill (the level after one
 * fill − the level before the next), never fix by fix: slosh up and slosh
 * down cancel inside a stretch, where summing every little drop counts the
 * same fuel a hundred times. Null when no reading counts.
 */
export function fuelFromLevels(samples: FuelSample[], opts: { movingOnly?: boolean } = {}): FuelGauge | null {
  const use = usableFuelSamples(samples, opts.movingOnly)
  if (!use.length) return null
  const runs: FuelSample[][] = []
  for (const s of use) {
    const run = runs[runs.length - 1]
    if (run && s.ms - run[run.length - 1].ms < FUEL_RUN_GAP_MS) run.push(s)
    else runs.push([s])
  }
  const steps: FuelStep[] = []
  runs.forEach((run, i) => {
    if (i > 0) {
      const prev = runs[i - 1]
      steps.push({ beforeMs: prev[prev.length - 1].ms, atMs: run[0].ms, from: edgeLevel(prev, 'tail'), to: edgeLevel(run, 'head') })
    }
    if (!opts.movingOnly) steps.push(...climbsInside(run))
  })

  const startPct = edgeLevel(runs[0], 'head')
  const endPct = edgeLevel(runs[runs.length - 1], 'tail')
  const refuels: FuelRefuel[] = []
  let used = 0
  let level = startPct
  let lastFillMs = -Infinity
  for (const st of steps) {
    if (st.to - st.from < FUEL_REFUEL_MIN_PCT) continue // the gauge wandering, not a fill
    const last = refuels[refuels.length - 1]
    if (last && st.atMs - lastFillMs < FUEL_FILL_MERGE_MS) {
      // Climbs this close are one fill read in steps (a pump running with the
      // key on); the "burn" between them is a level caught mid-rise.
      last.toPct = st.to
      last.addedPct = last.toPct - last.fromPct
    } else {
      if (level - st.from >= FUEL_NOISE_PCT) used += level - st.from
      refuels.push({ atMs: st.atMs, beforeMs: st.beforeMs, fromPct: st.from, toPct: st.to, addedPct: st.to - st.from })
    }
    level = st.to
    lastFillMs = st.atMs
  }
  if (level - endPct >= FUEL_NOISE_PCT) used += level - endPct
  return {
    usedPct: Math.round(used * 10) / 10,
    startPct,
    endPct,
    refuels,
    firstMs: use[0].ms,
    lastMs: use[use.length - 1].ms,
    samples: use.length,
  }
}

/** Miles driven while the gauge said nothing — before its first reading,
 *  after its last, and across any silence longer than `gapMs`. A gauge
 *  figure cannot include them. `sampleMs` oldest first; same miles math as
 *  the stats. */
export function gaugeSilentMiles(pts: StatPoint[], sampleMs: number[], from: number, to: number, gapMs = FUEL_GAP_MS): number {
  const ts = sampleMs.filter((ms) => ms >= from && ms < to)
  const holes: [number, number][] = []
  if (!ts.length) holes.push([from, to])
  else {
    if (ts[0] - from > gapMs) holes.push([from, ts[0]])
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > gapMs) holes.push([ts[i - 1], ts[i]])
    if (to - ts[ts.length - 1] > gapMs) holes.push([ts[ts.length - 1], to])
  }
  let miles = 0
  for (const [a, b] of holes) miles += computeRangeStats(pts, a, b, a, b).miles
  return Math.round(miles * 10) / 10
}

// Tank size: nothing decodes it (the VIN decoder has no such field), so it
// comes from what the owner wrote down — a fuel-tank spec key, or a note
// like "36 gal tank" / "fuel tank: 36 gal". A water truck's "3000 gal water
// tank" is not its fuel.
const TANK_KEYS = ['fuel_tank', 'fuel_tank_gal', 'fuel_tank_size', 'fuel_tank_capacity', 'fuel_capacity']
const TANK_UNIT = '(gal(?:lon)?s?|l|liters?|litres?)'
// Never two optional whitespace runs side by side (`\\s*-?\\s*`): on a long
// run of spaces that backtracks cubically, and the owner writes these fields
// — 8 KB of spaces in a spec pinned a server for minutes (sec-check, Sep 28).
// Values are trimmed and capped too, notes read to 4,000 characters.
const TANK_VALUE = new RegExp(`^(\\d{1,3}(?:\\.\\d+)?)\\s*(?:-\\s*)?(?:${TANK_UNIT}\\.?)?$`, 'i')
const TANK_VALUE_MAX = 24
const TANK_NOTES_MAX = 4000
const TANK_NOTE = [
  new RegExp(`\\b(\\d{1,3}(?:\\.\\d+)?)\\s*(?:-\\s*)?${TANK_UNIT}\\.?\\s+(?:fuel\\s+|diesel\\s+|gas\\s+)?tank\\b`, 'i'),
  new RegExp(`\\b(?:fuel|diesel|gas)\\s+tank\\b[\\s:=-]*(?:is\\s+|holds\\s+|of\\s+)?(\\d{1,3}(?:\\.\\d+)?)\\s*(?:-\\s*)?${TANK_UNIT}(?![a-z])`, 'i'),
]

/** Gallons from 32 / "32 gal" / "32 gallons" / "120 L"; null for anything
 *  else, or for a size no truck or machine carries (under 3 or over 400). */
function tankGallons(v: unknown, unitRequired: boolean): number | null {
  let gal: number | null = null
  if (typeof v === 'number' && !unitRequired) gal = v
  else if (typeof v === 'string') {
    const t = v.trim()
    const m = t.length <= TANK_VALUE_MAX ? TANK_VALUE.exec(t) : null
    if (m && (m[2] || !unitRequired)) gal = Number(m[1]) * (m[2] && /^l/i.test(m[2]) ? 0.264172 : 1)
  }
  return gal != null && Number.isFinite(gal) && gal >= 3 && gal <= 400 ? Math.round(gal * 10) / 10 : null
}

/** The asset's fuel tank in gallons, when the owner has written it down. */
export function tankGallonsFrom(meta: unknown): { gallons: number; source: 'specs' | 'notes' } | null {
  const md = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  const nested = (md.specs && typeof md.specs === 'object' ? md.specs : {}) as Record<string, unknown>
  for (const src of [md, nested]) {
    for (const k of TANK_KEYS) {
      const g = tankGallons(src[k], false)
      if (g != null) return { gallons: g, source: 'specs' }
    }
  }
  const notes = typeof md.notes === 'string' ? md.notes.slice(0, TANK_NOTES_MAX) : ''
  for (const re of TANK_NOTE) {
    const m = re.exec(notes)
    const g = m ? tankGallons(`${m[1]} ${m[2]}`, true) : null
    if (g != null) return { gallons: g, source: 'notes' }
  }
  return null
}
