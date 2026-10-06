/**
 * Driver safety scores — the math (migration 129, docs/DRIVER-SCORES.md).
 *
 * Brian, Oct 2026: "We need driver scores for any OBD devices. Look around at
 * how this is done with a keen eye for insurance providers as this will be a
 * future source of revenue for us."
 *
 * HammerTrack Safety Score v1 — the method the insurance research settled on
 * (docs/INSURANCE-TELEMATICS.md §3): the industry shape (Samsara, Motive) of
 * risky EVENTS per 1,000 miles plus SHARES of driving time spent speeding
 * and late at night, subtracted from 100, refused until there is enough
 * driving to mean something, and blended toward the fleet when there is
 * only a little. Every score carries its data-quality block, because an
 * underwriter discounts what it cannot trust.
 *
 * What counts and what is only shown:
 *  • SCORED harsh events are the truck's own accelerometer events (Teltonika
 *    Green Driving), each CONFIRMED by a matching speed change (or turn) in
 *    the OBD / GPS stream within ±3 s. A pothole spikes an accelerometer; it
 *    does not slow the truck.
 *  • GPS-ESTIMATED hard stops and launches are kept for coaching, labelled
 *    "estimated", and never scored — on Oct 3–6 every "hard brake" a plain
 *    speed-delta query found on the six OBD trucks was a tag-scan record
 *    stamped a second off, a movement-change record reading 0 mph at 30 km/h,
 *    or a GNSS speed still settling after an outage. The guards below remove
 *    all of those; what survives is still only an estimate.
 *  • Until a truck's accelerometer is switched on its score is speeding plus
 *    late night, and its data-quality block says harsh events are not
 *    measured yet.
 *  • Crashes (the device's ≥ 1.5 g impact detection) are listed, never
 *    scored automatically.
 *  • Cornering is never estimated from GPS heading — far too noisy.
 *
 * Pure module: no DB, no React. `node scripts/driving-score-test.mjs` drives
 * it — run it after ANY change here.
 */

import { metresToEdge, pointInPolygon, speedEdgeMargin } from './alerts-engine'
import { PERSIST_MS, POWERED_MIN_V } from './power-loss'
import { addDaysKey, tzOffsetMs, zonedMidnightMs } from './dates'

/** Bump when the math changes: the hourly builder re-banks older rows. */
export const ENGINE_VERSION = 1

/** One g in mph per second (9.80665 m/s² ÷ 0.44704 m/s per mph). */
export const G_MPH_PER_S = 9.80665 / 0.44704
const KMH_TO_MPH = 0.621371

export type VehicleClass = 'light' | 'heavy'
export type HarshKind = 'harsh_brake' | 'harsh_accel' | 'harsh_corner'
export type EventKind = HarshKind | 'crash' | 'max_speed' | 'zone_speeding'
export type Severity = 'moderate' | 'heavy' | 'severe'
export type EventSource = 'device' | 'gps'
export type SpeedTier = 'moderate' | 'heavy' | 'severe'

/**
 * THE METHOD — every threshold and weight, in one place, with where it came
 * from (numbers in [] are docs/INSURANCE-TELEMATICS.md's source list).
 * Starting values copied from published defaults; recalibrate once there are
 * 12+ months of claims-linked data.
 */
export const SAFETY_METHOD = {
  version: ENGINE_VERSION,
  /** Harsh-event thresholds in g, by vehicle class; at or above = an event.
   *  Light (pickups, vans, ≤ 10,000 lb GVWR): braking 0.32 g ≈ 7 mph lost
   *  per second — Progressive Snapshot's hard-brake line [82]; acceleration
   *  0.28 g — Geotab's light-duty-truck rule [29]; cornering 0.35 g —
   *  Teltonika's FMM00A default (3.4 m/s²) [28]. Medium/heavy (dump trucks,
   *  F-650/750, tractors): 0.20 / 0.20 / 0.24 g — Geotab's heavy-duty rules
   *  [29]. The tracker is configured to the same numbers. */
  thresholds: {
    light: { harsh_brake: 0.32, harsh_accel: 0.28, harsh_corner: 0.35 },
    heavy: { harsh_brake: 0.20, harsh_accel: 0.20, harsh_corner: 0.24 },
  },
  /** Severe at 1.5× the threshold, counting double (our choice). */
  severeFactor: 1.5,
  severeMultiplier: 2,
  /** Cornering counts only at 30 km/h or more (Teltonika's own floor) [32]. */
  cornerMinMph: 30 * KMH_TO_MPH,
  /** A device event is scored only when the speed stream agrees within ±3 s:
   *  ≥ 3 mph slower (braking) or faster (launch), or ≥ 10° of turn
   *  (cornering) — accelerometer trigger confirmed by OBD/GPS. */
  confirm: { windowS: 3, minMph: 3, minTurnDeg: 10 },
  /** Points off per event per 1,000 miles — Motive's dual-facing defaults
   *  (brake 4, corner 2, accel 1) [74]. */
  eventWeights: { harsh_brake: 4, harsh_corner: 2, harsh_accel: 1 },
  /** Speeding against a POSTED limit — Samsara's tiers and weights [72], [73]:
   *  6–10 mph over for 60 s, 11–15 over for 60 s, more than 15 over for 20 s,
   *  weighted 1 / 4 / 6 per 1% of moving time. We hold no road limits yet,
   *  so the tiers apply against a site's OWN limit (alert rule `speeding`). */
  speedTiers: [
    { tier: 'moderate' as SpeedTier, minOver: 6, minS: 60, weight: 1 },
    { tier: 'heavy' as SpeedTier, minOver: 11, minS: 60, weight: 4 },
    { tier: 'severe' as SpeedTier, minOver: 16, minS: 20, weight: 6 },
  ],
  /** Limit known or not: at or over this for 20 s = severe speeding, counted
   *  once (our choice; Geotab's example "excessive" line is 85 mph [76]). */
  maxSpeed: { light: 80, heavy: 75, minS: 20 },
  /** Late night: midnight–4 AM company time, 1 point per 1% of moving time —
   *  Snapshot's window [83]. 4–6 AM crew starts are never punished. */
  lateNight: { fromMin: 0, toMin: 240, weightPerPct: 1 },
  /** Shown, not scored: 10 PM to midnight. */
  evening: { fromMin: 22 * 60, toMin: 24 * 60 },
  /** No score under 250 miles AND 10 driving hours; under 3,000 miles the
   *  score is blended toward the fleet: Z = √(miles ÷ 3,000) [86]. */
  credibility: { minMiles: 250, minHours: 10, fullMiles: 3000 },
  /** An insurer report needs ≥ 90 days and ≥ 3 scored vehicles; "low
   *  credibility" under 10,000 fleet miles [26], [10]. */
  insurer: { minDays: 90, minVehicles: 3, lowCredibilityMiles: 10_000 },
  /** Grades A ≥ 90 … F < 60; insurer bands as Geotab's [76]. */
  grades: { A: 90, B: 80, C: 70, D: 60 },
  /** Icons that mean medium/heavy when the GVWR is not in the specs. */
  heavyIcons: ['dump-truck', 'day-cab', 'semi', 'mixer', 'box-truck', 'water-truck'],
} as const

/** The speed-stream ESTIMATE's guards (coaching only — never scored). */
export const GPS_RULES = {
  /** A pair of fixes closer than this is one GNSS epoch read twice. */
  minDtS: 0.8,
  /** Wider than this, the average over the gap hides the peak — no estimate. */
  maxDtS: 3,
  /** Below 10 mph on both sides it is a parking lot, not a road. */
  minMph: 10,
  /** Past 1 g a truck is not braking, the GPS is lying. */
  maxG: 1.0,
  /** Qualifying readings of one kind this close together are one maneuver. */
  mergeMs: 5_000,
  /** A fix this far off BOTH neighbours, the same way, is a spike… */
  spikeMph: 6,
  /** …when both neighbours are this close in time. */
  spikeWindowS: 5,
  /** Worse than this, the position (and its speed) is not trusted. */
  maxHdop: 5,
  /** Above this a work truck's reading is a glitch. */
  maxMph: 110,
  /** The speed field must agree with the ground actually covered (± the
   *  larger of these): after a GNSS outage the speed ramps up from a stale
   *  value while the truck is already at speed — the F350 "launched" 39 → 47
   *  mph at a steady 65 mph on Sep 29 (its speedometer: 103 → 105 km/h). */
  settleMph: 6,
  settleShare: 0.3,
} as const

/** Consecutive fixes further apart than this are not "tracked driving". */
export const TRACKED_GAP_S = 120

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface DrivingFix {
  ms: number
  lat: number
  lng: number
  /** mph as stored (asset_locations.speed, GPS); null = not reported. */
  speed: number | null
  ignition?: boolean | null
  /** flespi `position.valid` — false = no GPS fix (the record repeats the last place). */
  valid?: boolean | null
  sats?: number | null
  hdop?: number | null
  /** Teltonika event IO id (flespi `event.enum`); 0/absent = a periodic record. */
  event?: number | null
  /** Volts on the tracker's power pin. */
  volts?: number | null
  /** The event keys of the raw bag (harsh.*, crash.*, green.driving.*, unplug, jamming, towing). */
  harsh?: Record<string, unknown> | null
  /** Degrees, as stored. */
  heading?: number | null
  /** The truck's own speedometer (OBD), mph; null when it did not answer. */
  obd?: number | null
}

export interface DrivingEvent {
  at: number
  kind: EventKind
  severity: Severity
  source: EventSource
  /** Device harsh events: did the speed stream confirm it? (null otherwise). */
  confirmed?: boolean | null
  /** g for harsh events and crashes; peak mph for speeding. */
  value: number | null
  /** Harsh: the speed going in. Speeding: the peak. */
  speedMph: number | null
  lat: number
  lng: number
  durationS?: number | null
  zoneId?: string | null
  limitMph?: number | null
  /** The one clocked-in phone riding along, when exactly one was. */
  personId?: string | null
}

/** A site's own speed limit (alert rule `speeding`, migration 043). */
export interface ZoneLimit {
  id: string
  name: string
  ring: [number, number][]
  limitMph: number
  /** Rule scoped to one asset; null/absent = every asset. */
  assetId?: string | null
}

/** A crew phone's track for one day plus the shifts it was clocked in for. */
export interface RiderTrack {
  personId: string
  fixes: { ms: number; lat: number; lng: number; speed: number | null }[]
  shifts: [number, number][]
}

/** Per-person exposure for one vehicle-day. Everything but `s`/`mi` counts
 *  only the time the person was the ONLY phone aboard — the time a score can
 *  fairly charge them. */
export interface RiderDay {
  /** Seconds / miles aboard while the vehicle moved (with anyone). */
  s: number
  mi: number
  /** Solo: seconds, miles, late-night seconds, speeding seconds by tier. */
  ss: number
  smi: number
  ns: number
  zm: number
  zh: number
  zs: number
  /** Only on a period SUM (driving_rollup), never on a day: days aboard,
   *  days driving alone, of those with the accelerometer on, and the solo
   *  miles on them. */
  nd?: number
  dd?: number
  ad?: number
  a?: number
}

/** One vehicle-day — the driving_daily row (snake_case = the column names). */
export interface DailyRow {
  day: string
  tz: string
  vclass: VehicleClass
  miles: number
  moving_s: number
  engine_s: number
  night_s: number
  evening_s: number
  max_mph: number
  /** Miles driven where a posted limit was known (inside a site with its own limit). */
  limit_miles: number
  zone_mod_s: number
  zone_heavy_s: number
  zone_sev_s: number
  /** Severe by the absolute catch (80 / 75 mph for 20 s), never double-counted with zone_sev_s. */
  max_sev_s: number
  zone_speed_n: number
  max_speed_n: number
  /** Confirmed accelerometer events — the scored ones. */
  brake_mod: number
  brake_sev: number
  accel_mod: number
  accel_sev: number
  corner_mod: number
  corner_sev: number
  /** Accelerometer events the speed stream did not confirm (shown, not scored). */
  unconfirmed_n: number
  /** GPS-estimated hard stops / launches (coaching only). */
  brake_est: number
  accel_est: number
  crashes: number
  fixes: number
  /** Moving seconds whose fix carried the truck's own (OBD) speed. */
  obd_s: number
  /** Moving seconds sampled ≤ 3 s apart — what a GPS estimate can see. */
  dense_s: number
  gap_s: number
  longest_gap_s: number
  power_lost: number
  unplug_n: number
  jamming_n: number
  towing_n: number
  rejects_n: number
  /** Harsh events counted as MEASURED this day: Green Driving records seen
   *  today, or within the builder's 30-day look-back (accel_seen). */
  accel_on: boolean
  /** This day's own fixes carried Green Driving keys — the raw evidence the
   *  look-back reads (never inherited, so a switched-off unit ages out). */
  accel_seen: boolean
  drivers: Record<string, RiderDay>
  version: number
}

// ── Small helpers ───────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}
const truthy = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true'
const round1 = (x: number) => Math.round(x * 10) / 10
const round2 = (x: number) => Math.round(x * 100) / 100
const MPS_TO_MPH = 2.236936

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Epoch ms of a local wall-clock time (minutes after midnight) on a day key.
 *  Same one-refinement trick as zonedMidnightMs, so DST days come out right
 *  (04:00 on spring-forward day is three real hours after midnight). */
export function zonedLocalMs(key: string, minutes: number, tz: string): number {
  if (minutes <= 0) return zonedMidnightMs(key, tz)
  if (minutes >= 1440) return zonedMidnightMs(addDaysKey(key, 1), tz)
  const [y, m, d] = key.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  return guess - tzOffsetMs(tz, guess - tzOffsetMs(tz, guess))
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** Decode one element of the builder RPC's compact array:
 *  [ms, lat, lng, speed, ignition, valid, sats, hdop, event, volts, {event keys}, heading, obd km/h]. */
export function decodeFix(a: unknown): DrivingFix | null {
  if (!Array.isArray(a)) return null
  const ms = num(a[0]); const lat = num(a[1]); const lng = num(a[2])
  if (ms == null || lat == null || lng == null) return null
  const harsh = a[10] && typeof a[10] === 'object' && !Array.isArray(a[10]) ? (a[10] as Record<string, unknown>) : null
  const obdKmh = num(a[12])
  return {
    ms, lat, lng,
    speed: num(a[3]),
    ignition: typeof a[4] === 'boolean' ? a[4] : null,
    valid: typeof a[5] === 'boolean' ? a[5] : null,
    sats: num(a[6]),
    hdop: num(a[7]),
    event: num(a[8]),
    volts: num(a[9]),
    harsh,
    heading: num(a[11]),
    obd: obdKmh != null && obdKmh >= 0 && obdKmh < 250 ? obdKmh * KMH_TO_MPH : null,
  }
}

/**
 * Models that are over 10,000 lb GVWR as built — a one-ton pickup and up
 * (F-350, Ram/Silverado/Sierra 3500: Class 3) and the commercial makes —
 * read from the specs' make + model, else the asset's own name ("F750 Tool
 * Truck", "2016 Ford F350 — Charleston"). Three-quarter-tons (F-250, 2500)
 * stay light: their GVWR tops out at 10,000 lb. A GVWR in the specs (the VIN
 * decoder writes it) always wins over this guess.
 */
const HEAVY_MODELS: RegExp[] = [
  /\bf[- ]?(350|450|550|650|750)\b/i,
  /\b(ram|silverado|sierra|chevy|chevrolet|gmc)\b[^0-9]{0,12}(3500|4500|5500|6500)\b/i,
  /\b(peterbilt|kenworth|mack|freightliner|international|navistar|western star|autocar|sterling|hino|isuzu|fuso)\b/i,
  /\b(dump truck|tri-?axle|tandem|day ?cab|semi|tractor[- ]trailer|box truck|water truck|mixer)\b/i,
]

/** Light or medium/heavy: the GVWR in the specs when known (VIN decode
 *  stores "Class 3: 10,001 - 14,000 lb"), else the model (specs, then the
 *  asset's name), else the map icon, else light. */
export function vehicleClassOf(meta: Record<string, unknown> | null | undefined, name?: string | null): VehicleClass {
  const lb = gvwrLb(meta?.gvwr ?? meta?.GVWR)
  if (lb != null) return lb > 10_000 ? 'heavy' : 'light'
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
  const model = `${str(meta?.make)} ${str(meta?.model)}`.trim()
  for (const text of [model, name ?? '']) {
    if (text && HEAVY_MODELS.some((re) => re.test(text))) return 'heavy'
  }
  const icon = meta?.icon
  if (typeof icon === 'string' && (SAFETY_METHOD.heavyIcons as readonly string[]).includes(icon)) return 'heavy'
  return 'light'
}

/** Pounds from a GVWR spec ("Class 2E: 6,001 - 7,000 lb", "11,500", "5200 kg"). */
export function gvwrLb(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const cls = /class\s*([1-8])/i.exec(v)
  if (cls) return Number(cls[1]) <= 2 ? 10_000 : 14_000
  const nums = Array.from(v.matchAll(/\d[\d,]*(?:\.\d+)?/g)).map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 0)
  if (!nums.length) return null
  const max = Math.max(...nums)
  return /kg/i.test(v) && !/lb/i.test(v) ? max * 2.20462 : max
}

/** Sorted, one fix per instant (a duplicate keeps the one that says more). */
function normalise(fixes: DrivingFix[]): DrivingFix[] {
  const sorted = fixes.filter((f) => Number.isFinite(f.ms) && Number.isFinite(f.lat) && Number.isFinite(f.lng)).sort((a, b) => a.ms - b.ms)
  const out: DrivingFix[] = []
  for (const f of sorted) {
    const last = out[out.length - 1]
    if (last && last.ms === f.ms) {
      // Keep the periodic GPS record over an event record at the same instant,
      // but never lose the event's keys.
      const keepNew = (last.event ?? 0) !== 0 && (f.event ?? 0) === 0
      const merged = keepNew ? { ...f } : { ...last }
      if (f.harsh || last.harsh) merged.harsh = { ...(last.harsh ?? {}), ...(f.harsh ?? {}) }
      out[out.length - 1] = merged
      continue
    }
    out.push(f)
  }
  return out
}

/** A position the receiver itself vouches for. */
function trusted(f: DrivingFix): boolean {
  if (f.valid === false) return false
  if (f.sats != null && f.sats <= 0) return false
  if (f.hdop != null && f.hdop > GPS_RULES.maxHdop) return false
  return true
}

interface KinFix extends DrivingFix { v: number; spike: boolean }

/**
 * The kinematic stream: trusted periodic GPS records with a speed, spikes
 * marked. Event records (tag scans, movement changes…) are left out — their
 * speeds are stamped a second off or stale (see the header). If a unit puts
 * an event id on most of its records, the event records are kept rather
 * than throwing the day away.
 */
function kinematic(fixes: DrivingFix[]): KinFix[] {
  const usable = fixes.filter((f) => trusted(f) && f.speed != null && f.speed >= 0 && f.speed <= GPS_RULES.maxMph)
  const periodic = usable.filter((f) => (f.event ?? 0) === 0)
  const base = periodic.length >= usable.length * 0.5 ? periodic : usable
  const kin: KinFix[] = base.map((f) => ({ ...f, v: f.speed as number, spike: false }))
  // A fix far off BOTH close neighbours, the same way, is a spike (40, 25, 40
  // in two seconds is not a truck). Its speed is replaced by the neighbours'
  // average for time-in-band, and it never anchors an estimate.
  for (let i = 1; i < kin.length - 1; i++) {
    const h = kin[i - 1], f = kin[i], j = kin[i + 1]
    if ((f.ms - h.ms) / 1000 > GPS_RULES.spikeWindowS || (j.ms - f.ms) / 1000 > GPS_RULES.spikeWindowS) continue
    const d1 = f.v - h.v, d2 = f.v - j.v
    if (Math.sign(d1) === Math.sign(d2) && Math.min(Math.abs(d1), Math.abs(d2)) >= GPS_RULES.spikeMph) {
      f.spike = true
      f.v = (h.v + j.v) / 2
    }
  }
  return kin
}

/** Event severity in g against the vehicle class; null = under the threshold. */
export function harshSeverity(kind: HarshKind, g: number | null, vclass: VehicleClass): Severity | null {
  const t = SAFETY_METHOD.thresholds[vclass][kind]
  if (g == null) return 'moderate' // the device fired but did not say how hard
  // 1e-9: 0.20 × 1.5 is 0.30000000000000004 in floating point; 0.30 g is severe.
  if (g + 1e-9 >= t * SAFETY_METHOD.severeFactor) return 'severe'
  if (g + 1e-9 >= t) return 'moderate'
  return null
}

/** The g the device reported. AVL 254 is g × 100 on the wire; flespi hands
 *  it over as `absolute.acceleration` (g), and some firmware paths keep the
 *  raw `green.driving.value` — over 1.5 that can only be the ×100 integer
 *  (a 0.25–1.0 g event is 25–100). */
export function deviceG(h: Record<string, unknown>): number | null {
  for (const k of ['absolute.acceleration', 'crash.impact.acceleration', 'crash.max.acceleration']) {
    const a = num(h[k])
    if (a != null && a > 0 && a < 16) return round2(a)
  }
  const v = num(h['green.driving.value'])
  if (v != null && v > 0) return round2(v > 1.5 ? v / 100 : v)
  return null
}

/** Green Driving (AVL 253/254): harsh braking / launch / cornering. */
const GREEN_KEYS = [
  'harsh.braking.event', 'harsh.acceleration.event', 'harsh.cornering.event',
  'green.driving.braking', 'green.driving.acceleration', 'green.driving.cornering',
  'green.driving.type', 'green.driving.type.enum', 'green.driving.value',
]
/** Crash detection (AVL 247) — its own scenario (11400), so a crash record
 *  is NOT evidence that harsh-event detection is on. */
const CRASH_KEYS = ['crash.event', 'crash.detection', 'crash.event.enum', 'crash']
const ACCEL_KEYS = [...GREEN_KEYS, ...CRASH_KEYS]
const UNPLUG_KEYS = ['battery.unplug.event', 'unplug.event', 'unplug', 'unplug.status']
const JAMMING_KEYS = ['gnss.jamming.state', 'gnss.jamming.status', 'jamming.event', 'gsm.jamming.status']
const TOWING_KEYS = ['towing.event', 'towing.detection.event', 'towing', 'towing.status']
/** Every key the builder's read keeps from the raw bag (migration 129). */
export const EVENT_KEYS = [...ACCEL_KEYS, ...UNPLUG_KEYS, ...JAMMING_KEYS, ...TOWING_KEYS]

/** True when a record carries a Green Driving key — evidence the device's
 *  harsh-event scenario is switched on, so harsh events are MEASURED (a
 *  quiet stretch then means none happened). Crash keys alone do not count:
 *  crash detection is a separate scenario. */
export function hasDeviceKeys(h: Record<string, unknown> | null | undefined): boolean {
  if (!h) return false
  return GREEN_KEYS.some((k) => h[k] !== undefined && h[k] !== null)
}

/** What one record's event keys say happened. */
export function deviceHits(h: Record<string, unknown> | null | undefined): { kind: HarshKind | 'crash'; g: number | null }[] {
  if (!h) return []
  const out: { kind: HarshKind | 'crash'; g: number | null }[] = []
  const type = num(h['green.driving.type']) ?? num(h['green.driving.type.enum'])
  const g = deviceG(h)
  if (truthy(h['harsh.braking.event']) || truthy(h['green.driving.braking']) || type === 2) out.push({ kind: 'harsh_brake', g })
  if (truthy(h['harsh.acceleration.event']) || truthy(h['green.driving.acceleration']) || type === 1) out.push({ kind: 'harsh_accel', g })
  if (truthy(h['harsh.cornering.event']) || truthy(h['green.driving.cornering']) || type === 3) out.push({ kind: 'harsh_corner', g })
  // AVL 247: 1 / 6 = a real crash; 2–5 are trace records around one.
  const crashEnum = num(h['crash.detection']) ?? num(h['crash.event.enum']) ?? (typeof h.crash === 'boolean' ? null : num(h.crash))
  if ((truthy(h['crash.event']) || h.crash === true) && (crashEnum == null || crashEnum === 1 || crashEnum === 6)) out.push({ kind: 'crash', g })
  else if (crashEnum === 1 || crashEnum === 6) out.push({ kind: 'crash', g })
  return out
}

const SEV_RANK: Record<Severity, number> = { moderate: 0, heavy: 1, severe: 2 }
const worse = (a: Severity, b: Severity): Severity => (SEV_RANK[a] >= SEV_RANK[b] ? a : b)

/** Keep the strongest of each run of same-kind events closer than `windowMs`. */
function mergeRuns(events: DrivingEvent[], windowMs: number, keepFirstSpeed = false): DrivingEvent[] {
  const byKind = new Map<string, DrivingEvent[]>()
  for (const e of events) {
    const k = `${e.kind}|${e.source}`
    let list = byKind.get(k)
    if (!list) byKind.set(k, (list = []))
    list.push(e)
  }
  const out: DrivingEvent[] = []
  for (const list of Array.from(byKind.values())) {
    list.sort((a, b) => a.at - b.at)
    let cur: DrivingEvent | null = null
    let lastAt = -Infinity
    for (const e of list) {
      if (cur && e.at - lastAt <= windowMs) {
        const c: DrivingEvent = cur
        const peak: DrivingEvent = (e.value ?? 0) > (c.value ?? 0) ? e : c
        cur = {
          ...peak,
          speedMph: keepFirstSpeed ? c.speedMph : (peak.speedMph ?? c.speedMph),
          severity: worse(c.severity, e.severity),
          confirmed: c.confirmed === true || e.confirmed === true ? true : (c.confirmed ?? e.confirmed ?? null),
        }
      } else {
        if (cur) out.push(cur)
        cur = e
      }
      lastAt = e.at
    }
    if (cur) out.push(cur)
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Count rising edges of an on/off event key, one per `gapMs`. */
function countFlags(fixes: DrivingFix[], keys: string[], from: number, to: number, gapMs = 10 * 60_000): number {
  let n = 0, last = -Infinity
  for (const f of fixes) {
    if (!f.harsh || f.ms < from || f.ms >= to) continue
    if (!keys.some((k) => truthy(f.harsh?.[k]))) continue
    if (f.ms - last > gapMs) n++
    last = f.ms
  }
  return n
}

// ── Confirmation ────────────────────────────────────────────────────────────

/** Did the speed stream (the truck's own OBD speed, else GPS) move the way
 *  the accelerometer says, within ±3 s? Braking: ≥ 3 mph slower across the
 *  event; launch: ≥ 3 mph faster; cornering: ≥ 10° of turn at 30 km/h+. */
export function confirmHarsh(kind: HarshKind, at: number, fixes: DrivingFix[]): boolean {
  const C = SAFETY_METHOD.confirm
  const w = fixes.filter((f) => Math.abs(f.ms - at) <= C.windowS * 1000 && trusted(f))
  if (kind !== 'harsh_corner') {
    const changed = (pick: (f: DrivingFix) => number | null | undefined) => {
      const s = w.map((f) => ({ ms: f.ms, v: pick(f) })).filter((p): p is { ms: number; v: number } => p.v != null && Number.isFinite(p.v))
      const before = s.filter((p) => p.ms <= at), after = s.filter((p) => p.ms >= at)
      if (!before.length || !after.length || s.length < 2) return false
      return kind === 'harsh_brake'
        ? Math.max(...before.map((p) => p.v)) - Math.min(...after.map((p) => p.v)) >= C.minMph
        : Math.max(...after.map((p) => p.v)) - Math.min(...before.map((p) => p.v)) >= C.minMph
    }
    return changed((f) => f.obd) || changed((f) => f.speed)
  }
  const fast = w.some((f) => Math.max(f.obd ?? 0, f.speed ?? 0) >= SAFETY_METHOD.cornerMinMph)
  const h = w.map((f) => f.heading).filter((x): x is number => x != null && Number.isFinite(x))
  if (!fast || h.length < 2) return false
  let turn = 0
  for (let i = 1; i < h.length; i++) turn = Math.max(turn, Math.abs(((h[i] - h[0] + 540) % 360) - 180))
  return turn >= C.minTurnDeg
}

// ── Detection ───────────────────────────────────────────────────────────────

export interface DetectOpts {
  vehicleClass?: VehicleClass
  /** The truck's accelerometer events are on (seen in the last 30 days): the
   *  speed-stream estimate stands down entirely. */
  accelerometerOn?: boolean
  /** Sites with their own posted limits (already filtered to this asset). */
  zones?: ZoneLimit[]
}

/** Every driving event in a stream of fixes (any span; the builder trims to the day). */
export function detectEvents(input: DrivingFix[], opts: DetectOpts = {}): DrivingEvent[] {
  const vclass = opts.vehicleClass ?? 'light'
  const fixes = normalise(input)
  const events: DrivingEvent[] = []

  // 1. The truck's own accelerometer, each event checked against the speed stream.
  const device: DrivingEvent[] = []
  for (const f of fixes) {
    for (const hit of deviceHits(f.harsh)) {
      if (hit.kind === 'crash') {
        device.push({ at: f.ms, kind: 'crash', severity: 'severe', source: 'device', confirmed: null, value: hit.g, speedMph: f.speed ?? null, lat: f.lat, lng: f.lng })
        continue
      }
      const sev = harshSeverity(hit.kind, hit.g, vclass)
      if (!sev) continue // gentler than our standard (the device is set more sensitive)
      const speed = f.obd ?? f.speed ?? null
      if (hit.kind === 'harsh_corner' && speed != null && speed < SAFETY_METHOD.cornerMinMph) continue
      device.push({
        at: f.ms, kind: hit.kind, severity: sev, source: 'device', confirmed: confirmHarsh(hit.kind, f.ms, fixes),
        value: hit.g, speedMph: speed == null ? null : Math.round(speed), lat: f.lat, lng: f.lng,
      })
    }
  }
  const deviceHarsh = mergeRuns(device.filter((e) => e.kind !== 'crash'), GPS_RULES.mergeMs)
  events.push(...mergeRuns(device.filter((e) => e.kind === 'crash'), 120_000), ...deviceHarsh)

  const kin = kinematic(fixes)

  // 2. The speed-stream ESTIMATE of hard stops and launches — coaching only.
  if (!opts.accelerometerOn) {
    const cand: DrivingEvent[] = []
    const pairs = kin.filter((f) => !f.spike)
    for (let i = 1; i < pairs.length; i++) {
      const a = pairs[i - 1], b = pairs[i]
      const dt = (b.ms - a.ms) / 1000
      if (dt < GPS_RULES.minDtS || dt > GPS_RULES.maxDtS) continue
      if (Math.max(a.v, b.v) < GPS_RULES.minMph) continue
      const dv = b.v - a.v
      const g = dv / dt / G_MPH_PER_S
      if (Math.abs(g) > GPS_RULES.maxG) continue
      const kind: HarshKind = g < 0 ? 'harsh_brake' : 'harsh_accel'
      const sev = harshSeverity(kind, Math.abs(g), vclass)
      if (!sev) continue
      // A launch measured from exactly 0 mph is Teltonika's static
      // navigation: the speed is held at 0 until the unit decides it is
      // moving, then jumps to the real speed (Oct 2: 0 → 14 mph in a second
      // while the truck's own speedometer read 33 km/h throughout).
      if (kind === 'harsh_accel' && a.v === 0) continue
      if (!settled(pairs, i)) continue
      // A change undone by the next or the previous step is a glitch.
      const reverses = (p: KinFix | undefined, q: KinFix | undefined) => {
        if (!p || !q || (q.ms - p.ms) / 1000 > GPS_RULES.maxDtS) return false
        const d = q.v - p.v
        return Math.sign(d) === -Math.sign(dv) && Math.abs(d) >= Math.max(4, Math.abs(dv) * 0.5)
      }
      if (reverses(b, pairs[i + 1]) || reverses(pairs[i - 2], a)) continue
      cand.push({ at: b.ms, kind, severity: sev, source: 'gps', confirmed: null, value: round2(Math.abs(g)), speedMph: Math.round(a.v), lat: b.lat, lng: b.lng })
    }
    // One maneuver = one event at its peak, with the speed it started from;
    // where the device saw it, the device's event stands.
    for (const e of mergeRuns(cand, GPS_RULES.mergeMs, true)) {
      if (deviceHarsh.some((d) => d.kind === e.kind && Math.abs(d.at - e.at) <= GPS_RULES.mergeMs)) continue
      events.push(e)
    }
  }

  // 3. Speeding: over a site's own limit, and the absolute catch.
  events.push(...speedingPlan(kin, opts.zones ?? [], vclass).events)

  return events.sort((a, b) => a.at - b.at)
}

/**
 * Does the speed field agree with the ground covered? Over the pair (i−1, i)
 * plus one neighbour each side (when within 5 s), the distance the fixes
 * actually moved must match the reported speeds' time-average within
 * max(6 mph, 30%). A real hard stop passes (Sep 30: 46 mph moved vs 46
 * reported); a GNSS solution still settling after an outage, a frozen
 * static-navigation position, or a lone bad speed does not.
 */
function settled(k: KinFix[], i: number): boolean {
  const lo = i - 2 >= 0 && (k[i - 1].ms - k[i - 2].ms) <= 5_000 ? i - 2 : i - 1
  const hi = i + 1 < k.length && (k[i + 1].ms - k[i].ms) <= 5_000 ? i + 1 : i
  let metresMoved = 0, mphSeconds = 0
  for (let j = lo + 1; j <= hi; j++) {
    const dt = (k[j].ms - k[j - 1].ms) / 1000
    metresMoved += metres(k[j - 1], k[j])
    mphSeconds += ((k[j - 1].v + k[j].v) / 2) * dt
  }
  const span = (k[hi].ms - k[lo].ms) / 1000
  if (!(span > 0)) return false
  const moved = (metresMoved / span) * MPS_TO_MPH
  const reported = mphSeconds / span
  return Math.abs(moved - reported) <= Math.max(GPS_RULES.settleMph, reported * GPS_RULES.settleShare)
}

// ── Speeding ────────────────────────────────────────────────────────────────

/** The tier for `over` mph over the limit, or null under 6. */
export function tierFor(over: number): SpeedTier | null {
  let t: SpeedTier | null = null
  for (const s of SAFETY_METHOD.speedTiers) if (over >= s.minOver) t = s.tier
  return t
}

interface SpeedPlan {
  /** Per interval i (kin[i−1] → kin[i]): the scored tier, or null. */
  tier: (SpeedTier | null)[]
  /** Per interval: the absolute catch (80 / 75 mph for 20 s+). */
  max: boolean[]
  /** Per interval: inside a site with a posted limit ("% of miles with a known limit"). */
  limited: boolean[]
  events: DrivingEvent[]
}

/**
 * Speeding, Samsara-style, against the only posted limits we hold — a site's
 * own (alert rule `speeding`) — plus the absolute catch where no limit is
 * known. An interval between two fixes takes the LOWER of its two ends'
 * tiers (both ends must be over); a run of over-limit intervals in one site
 * is an episode, and an episode earns a tier only if it spent that tier's
 * minimum time at or above it (6–10 over: 60 s; 11–15 over: 60 s; 16+: 20 s).
 * Time that did not earn its own tier counts at the highest one it did earn.
 * The fence rule is the alert engine's: well inside, never the road along it.
 * An 80 mph (75 heavy) stretch of 20 s+ is severe, counted once.
 */
function speedingPlan(kin: KinFix[], zones: ZoneLimit[], vclass: VehicleClass): SpeedPlan {
  const n = kin.length
  const tier: (SpeedTier | null)[] = new Array(n).fill(null)
  const max: boolean[] = new Array(n).fill(false)
  const limited: boolean[] = new Array(n).fill(false)
  const events: DrivingEvent[] = []

  for (const z of zones) {
    if (!(z.limitMph > 0) || z.ring.length < 3) continue
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of z.ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    const margin = speedEdgeMargin(z.ring)
    const inside = kin.map((f) => f.lng >= minX && f.lng <= maxX && f.lat >= minY && f.lat <= maxY && pointInPolygon([f.lng, f.lat], z.ring))
    const deep = kin.map((f, i) => inside[i] && metresToEdge([f.lng, f.lat], z.ring) >= margin)
    const pairTier: (SpeedTier | null)[] = new Array(n).fill(null)
    for (let i = 1; i < n; i++) {
      if (inside[i] && inside[i - 1]) limited[i] = true
      if (!deep[i] || !deep[i - 1] || kin[i].ms - kin[i - 1].ms > TRACKED_GAP_S * 1000) continue
      pairTier[i] = tierFor(Math.round(Math.min(kin[i].v, kin[i - 1].v)) - z.limitMph)
    }
    // Episodes: consecutive over-limit intervals.
    for (let i = 1; i < n; i++) {
      if (!pairTier[i]) continue
      let j = i
      while (j + 1 < n && pairTier[j + 1]) j++
      const secsAtLeast = (t: SpeedTier) => {
        let s = 0
        for (let k = i; k <= j; k++) if (SEV_RANK[pairTier[k] as SpeedTier] >= SEV_RANK[t]) s += (kin[k].ms - kin[k - 1].ms) / 1000
        return s
      }
      const earned = SAFETY_METHOD.speedTiers.filter((s) => secsAtLeast(s.tier) >= s.minS).map((s) => s.tier)
      if (earned.length) {
        let peak = kin[i]
        for (let k = i; k <= j; k++) {
          const own = pairTier[k] as SpeedTier
          const got = earned.filter((t) => SEV_RANK[t] <= SEV_RANK[own]).pop() ?? null
          if (got && (!tier[k] || SEV_RANK[got] > SEV_RANK[tier[k] as SpeedTier])) tier[k] = got
          if (kin[k].v > peak.v) peak = kin[k]
        }
        events.push({
          at: kin[i - 1].ms, kind: 'zone_speeding', severity: earned[earned.length - 1], source: 'gps', confirmed: null,
          value: Math.round(peak.v), speedMph: Math.round(peak.v), lat: peak.lat, lng: peak.lng,
          durationS: Math.round((kin[j].ms - kin[i - 1].ms) / 1000), zoneId: z.id, limitMph: z.limitMph,
        })
      }
      i = j
    }
  }

  // The absolute catch: no limit needed.
  const line = SAFETY_METHOD.maxSpeed[vclass]
  const fast = (k: number) => Math.min(kin[k].v, kin[k - 1].v) >= line && kin[k].ms - kin[k - 1].ms <= 60_000
  for (let i = 1; i < n; i++) {
    if (!fast(i)) continue
    let j = i
    while (j + 1 < n && fast(j + 1)) j++
    const dur = (kin[j].ms - kin[i - 1].ms) / 1000
    if (dur >= SAFETY_METHOD.maxSpeed.minS) {
      let peak = kin[i]
      for (let k = i; k <= j; k++) { max[k] = true; if (kin[k].v > peak.v) peak = kin[k] }
      events.push({
        at: kin[i - 1].ms, kind: 'max_speed', severity: 'severe', source: 'gps', confirmed: null,
        value: Math.round(peak.v), speedMph: Math.round(peak.v), lat: peak.lat, lng: peak.lng, durationS: Math.round(dur),
      })
    }
    i = j
  }
  return { tier, max, limited, events }
}

// ── Who was aboard ──────────────────────────────────────────────────────────

const BIN_MS = 60_000
/** A phone this close to the truck at the same instant is riding in it… */
const ABOARD_M = 150
/** …for at least this many minutes of a run (a truck passing a parked
 *  phone is one minute, not five)… */
const ABOARD_MIN_BINS = 5
/** …with holes in the run no longer than this. */
const ABOARD_MAX_GAP_BINS = 3

/** The truck's position at `ms`, interpolated between fixes ≤ 30 s apart. */
function vehicleAt(kin: KinFix[], ms: number): { lat: number; lng: number; v: number } | null {
  let lo = 0, hi = kin.length - 1
  if (hi < 0 || ms < kin[0].ms - 10_000 || ms > kin[hi].ms + 10_000) return null
  while (lo < hi) { const mid = (lo + hi) >> 1; if (kin[mid].ms < ms) lo = mid + 1; else hi = mid }
  const b = kin[lo]
  const a = lo > 0 ? kin[lo - 1] : null
  if (a && a.ms <= ms && b.ms >= ms && b.ms - a.ms <= 30_000) {
    const t = b.ms === a.ms ? 0 : (ms - a.ms) / (b.ms - a.ms)
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, v: a.v + (b.v - a.v) * t }
  }
  const near = [a, b].filter((f): f is KinFix => !!f).sort((x, y) => Math.abs(x.ms - ms) - Math.abs(y.ms - ms))[0]
  return near && Math.abs(near.ms - ms) <= 10_000 ? { lat: near.lat, lng: near.lng, v: near.v } : null
}

/**
 * Minute bins → the clocked-in people riding in the vehicle. A phone fix
 * inside one of its person's shifts, within 150 m of the moving truck at the
 * same instant, marks its minute; runs of 5+ such minutes (holes ≤ 3) are
 * "aboard" from their first minute to their last. Passengers ride too — the
 * caller charges events only to a lone rider.
 */
export function ridersAboard(fixes: DrivingFix[], riders: RiderTrack[]): Map<number, string[]> {
  const kin = kinematic(normalise(fixes))
  const out = new Map<number, string[]>()
  if (!kin.length) return out
  for (const r of riders) {
    const bins = new Set<number>()
    for (const p of r.fixes) {
      if (!r.shifts.some(([s, e]) => p.ms >= s && p.ms <= e)) continue
      const veh = vehicleAt(kin, p.ms)
      if (!veh || veh.v < 5) continue
      if (metres(p, veh) <= ABOARD_M) bins.add(Math.floor(p.ms / BIN_MS))
    }
    const sorted = Array.from(bins).sort((a, b) => a - b)
    let start = 0
    for (let i = 1; i <= sorted.length; i++) {
      if (i === sorted.length || sorted[i] - sorted[i - 1] > ABOARD_MAX_GAP_BINS + 1) {
        const run = sorted.slice(start, i)
        if (run.length >= ABOARD_MIN_BINS) {
          for (let b = run[0]; b <= run[run.length - 1]; b++) {
            const list = out.get(b) ?? []
            if (!list.includes(r.personId)) list.push(r.personId)
            out.set(b, list)
          }
        }
        start = i
      }
    }
  }
  return out
}

// ── Power ───────────────────────────────────────────────────────────────────

/** Times the truck stopped feeding the unit (plug out / port dead) and it
 *  stayed that way ≥ 60 s of device time — the lost-power detector's rule
 *  (lib/power-loss.ts). Only drops that START inside [from, to) count. */
export function powerDrops(fixes: DrivingFix[], from: number, to: number): number {
  let n = 0
  let powered: boolean | null = null
  let dropAt: number | null = null
  let counted = false
  for (const f of normalise(fixes)) {
    if (f.volts == null || !Number.isFinite(f.volts) || f.volts < 0) continue
    const on = f.volts >= POWERED_MIN_V
    if (on) { powered = true; dropAt = null; counted = false; continue }
    if (powered === true && dropAt == null) { dropAt = f.ms; counted = false }
    if (dropAt != null && !counted && f.ms - dropAt >= PERSIST_MS) {
      if (dropAt >= from && dropAt < to) n++
      counted = true
    }
    if (powered === null) powered = false
  }
  return n
}

// ── One day ─────────────────────────────────────────────────────────────────

export interface RollupInput {
  /** Fixes covering the day, plus a little either side (the builder reads
   *  10 minutes past each edge so a drive across midnight is whole). */
  fixes: DrivingFix[]
  dayKey: string
  tz: string
  /** Events detected over the same fixes (detectEvents). */
  events: DrivingEvent[]
  vehicleClass?: VehicleClass
  riders?: RiderTrack[]
  zones?: ZoneLimit[]
  /** The detection ran with the accelerometer treated as on. */
  accelOn?: boolean
  /** GPS spikes the ingest refused this day (asset_location_rejects). */
  rejects?: number
}

const emptyRider = (): RiderDay => ({ s: 0, mi: 0, ss: 0, smi: 0, ns: 0, zm: 0, zh: 0, zs: 0 })

/**
 * Fold one company-local day: exposure, time per speeding tier, late night,
 * the day's events counted, data quality, and who rode along. Every interval
 * between two fixes is CLIPPED to the day, so a drive across local midnight
 * lands on both days exactly once — 11:58 PM → 12:03 AM is 2 minutes of
 * Tuesday evening and 3 minutes of Wednesday late night.
 */
export function rollupDay(input: RollupInput): { row: DailyRow; events: DrivingEvent[] } {
  const { dayKey, tz } = input
  const vclass = input.vehicleClass ?? 'light'
  const s0 = zonedMidnightMs(dayKey, tz)
  const s1 = zonedMidnightMs(addDaysKey(dayKey, 1), tz)
  const n1 = zonedLocalMs(dayKey, SAFETY_METHOD.lateNight.toMin, tz)
  const e0 = zonedLocalMs(dayKey, SAFETY_METHOD.evening.fromMin, tz)
  const all = normalise(input.fixes)
  const kin = kinematic(all)
  const plan = speedingPlan(kin, input.zones ?? [], vclass)
  const aboard = input.riders?.length ? ridersAboard(all, input.riders) : new Map<number, string[]>()

  const row: DailyRow = {
    day: dayKey, tz, vclass, miles: 0, moving_s: 0, engine_s: 0, night_s: 0, evening_s: 0, max_mph: 0,
    limit_miles: 0, zone_mod_s: 0, zone_heavy_s: 0, zone_sev_s: 0, max_sev_s: 0, zone_speed_n: 0, max_speed_n: 0,
    brake_mod: 0, brake_sev: 0, accel_mod: 0, accel_sev: 0, corner_mod: 0, corner_sev: 0,
    unconfirmed_n: 0, brake_est: 0, accel_est: 0, crashes: 0,
    fixes: 0, obd_s: 0, dense_s: 0, gap_s: 0, longest_gap_s: 0, power_lost: 0, unplug_n: 0, jamming_n: 0, towing_n: 0,
    rejects_n: Math.max(0, Math.round(input.rejects ?? 0)), accel_on: !!input.accelOn, accel_seen: false,
    drivers: {}, version: ENGINE_VERSION,
  }
  let milesM = 0, limitM = 0
  const riderAcc = new Map<string, RiderDay>()

  for (const f of all) {
    if (f.ms < s0 || f.ms >= s1) continue
    row.fixes++
    if (hasDeviceKeys(f.harsh)) row.accel_on = row.accel_seen = true
  }
  for (const f of kin) if (f.ms >= s0 && f.ms < s1 && f.v > row.max_mph) row.max_mph = Math.round(f.v)

  // Engine time: both ends with the key on, ≤ 10 min apart (idling records less often).
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i]
    if (a.ignition === true && b.ignition === true && b.ms - a.ms <= 600_000) row.engine_s += overlap(a.ms, b.ms, s0, s1) / 1000
  }

  for (let i = 1; i < kin.length; i++) {
    const a = kin[i - 1], b = kin[i]
    const dtMs = b.ms - a.ms
    if (dtMs <= 0) continue
    const c0 = Math.max(a.ms, s0), c1 = Math.min(b.ms, s1)
    const len = c1 - c0
    if (len <= 0) continue
    const share = len / dtMs
    const dist = metres(a, b)
    const lenS = len / 1000
    if (dtMs <= TRACKED_GAP_S * 1000) {
      if ((a.v + b.v) / 2 < 2) continue
      row.moving_s += lenS
      const m = (dist / (dtMs / 1000)) * MPS_TO_MPH <= GPS_RULES.maxMph ? dist * share : 0
      milesM += m
      if (plan.limited[i]) limitM += m
      if (dtMs <= GPS_RULES.maxDtS * 1000) row.dense_s += lenS
      if (b.obd != null) row.obd_s += lenS
      const night = overlap(c0, c1, s0, n1) / 1000
      row.night_s += night
      row.evening_s += overlap(c0, c1, e0, s1) / 1000
      const t = plan.tier[i]
      const isMax = plan.max[i]
      if (isMax) row.max_sev_s += lenS
      else if (t === 'severe') row.zone_sev_s += lenS
      else if (t === 'heavy') row.zone_heavy_s += lenS
      else if (t === 'moderate') row.zone_mod_s += lenS
      const people = aboard.get(Math.floor(b.ms / BIN_MS)) ?? []
      for (const pid of people) {
        const acc = riderAcc.get(pid) ?? emptyRider()
        acc.s += lenS
        acc.mi += m / 1609.344
        if (people.length === 1) {
          acc.ss += lenS
          acc.smi += m / 1609.344
          acc.ns += night
          if (isMax || t === 'severe') acc.zs += lenS
          else if (t === 'heavy') acc.zh += lenS
          else if (t === 'moderate') acc.zm += lenS
        }
        riderAcc.set(pid, acc)
      }
    } else if (dtMs <= 12 * 3_600_000 && dist >= 800 && (dist / (dtMs / 1000)) * MPS_TO_MPH >= 5) {
      // The truck went somewhere with nothing recorded on the way: unplugged,
      // switched off, or no coverage and no buffer. Data quality, not driving.
      row.gap_s += lenS
      row.longest_gap_s = Math.max(row.longest_gap_s, lenS)
    }
  }

  row.power_lost = powerDrops(all, s0, s1)
  row.unplug_n = countFlags(all, UNPLUG_KEYS, s0, s1)
  row.jamming_n = countFlags(all, JAMMING_KEYS, s0, s1)
  row.towing_n = countFlags(all, TOWING_KEYS, s0, s1)
  row.miles = round2(milesM / 1609.344)
  row.limit_miles = round2(limitM / 1609.344)
  for (const k of ['moving_s', 'engine_s', 'night_s', 'evening_s', 'zone_mod_s', 'zone_heavy_s', 'zone_sev_s', 'max_sev_s', 'obd_s', 'dense_s', 'gap_s', 'longest_gap_s'] as const) {
    row[k] = Math.round(row[k])
  }

  // The day's events, stamped with the lone rider when there was one.
  const events: DrivingEvent[] = []
  for (const e of input.events) {
    if (e.at < s0 || e.at >= s1) continue
    const people = aboard.get(Math.floor(e.at / BIN_MS)) ?? []
    const ev = { ...e, personId: people.length === 1 ? people[0] : null }
    events.push(ev)
    countEvent(row, ev)
  }
  for (const [pid, acc] of Array.from(riderAcc.entries())) {
    row.drivers[pid] = {
      s: Math.round(acc.s), mi: round2(acc.mi), ss: Math.round(acc.ss), smi: round2(acc.smi),
      ns: Math.round(acc.ns), zm: Math.round(acc.zm), zh: Math.round(acc.zh), zs: Math.round(acc.zs),
    }
  }
  return { row, events }
}

function countEvent(row: DailyRow, e: DrivingEvent) {
  if (e.kind === 'harsh_brake' || e.kind === 'harsh_accel' || e.kind === 'harsh_corner') {
    const k = e.kind === 'harsh_brake' ? 'brake' : e.kind === 'harsh_accel' ? 'accel' : 'corner'
    if (e.source === 'gps') {
      if (k === 'brake') row.brake_est++
      else if (k === 'accel') row.accel_est++
    } else if (e.confirmed) row[`${k}_${e.severity === 'severe' ? 'sev' : 'mod'}` as 'brake_mod']++
    else row.unconfirmed_n++
  } else if (e.kind === 'crash') row.crashes++
  else if (e.kind === 'zone_speeding') row.zone_speed_n++
  else if (e.kind === 'max_speed') row.max_speed_n++
}

/** detectEvents + rollupDay in one call — what the builder runs per vehicle-day. */
export function analyzeDay(input: Omit<RollupInput, 'events' | 'accelOn'> & { accelerometerOn?: boolean }): { row: DailyRow; events: DrivingEvent[] } {
  const accelOn = !!input.accelerometerOn || input.fixes.some((f) => hasDeviceKeys(f.harsh))
  const events = detectEvents(input.fixes, { vehicleClass: input.vehicleClass, accelerometerOn: accelOn, zones: input.zones })
  return rollupDay({ ...input, events, accelOn })
}

// ── Totals over a period ────────────────────────────────────────────────────

export interface SevPair { moderate: number; severe: number }

export interface DrivingTotals {
  /** Rows (days the tracker reported at all). */
  days: number
  drivingDays: number
  /** Calendar days in the period, for device uptime (set by the caller). */
  periodDays: number | null
  miles: number
  movingS: number
  engineS: number
  nightS: number
  eveningS: number
  maxMph: number
  limitMiles: number
  zoneModS: number
  zoneHeavyS: number
  zoneSevS: number
  maxSevS: number
  zoneSpeedN: number
  maxSpeedN: number
  harsh_brake: SevPair
  harsh_accel: SevPair
  harsh_corner: SevPair
  unconfirmed: number
  estBrake: number
  estAccel: number
  crashes: number
  fixes: number
  obdS: number
  denseS: number
  gapS: number
  longestGapS: number
  powerLost: number
  unplugs: number
  jamming: number
  towing: number
  rejects: number
  /** Driving days on which the accelerometer was on, and the miles on them. */
  accelDays: number
  accelMiles: number
  /** Miles tied to a named driver (the only clocked-in phone aboard). */
  attributedMiles: number
}

export function emptyTotals(): DrivingTotals {
  return {
    days: 0, drivingDays: 0, periodDays: null, miles: 0, movingS: 0, engineS: 0, nightS: 0, eveningS: 0, maxMph: 0,
    limitMiles: 0, zoneModS: 0, zoneHeavyS: 0, zoneSevS: 0, maxSevS: 0, zoneSpeedN: 0, maxSpeedN: 0,
    harsh_brake: { moderate: 0, severe: 0 }, harsh_accel: { moderate: 0, severe: 0 }, harsh_corner: { moderate: 0, severe: 0 },
    unconfirmed: 0, estBrake: 0, estAccel: 0, crashes: 0, fixes: 0, obdS: 0, denseS: 0, gapS: 0, longestGapS: 0,
    powerLost: 0, unplugs: 0, jamming: 0, towing: 0, rejects: 0, accelDays: 0, accelMiles: 0, attributedMiles: 0,
  }
}

/** A day row — or a period already summed in SQL (driving_rollup, one row
 *  per vehicle-month), which carries the counts a day row implies: days
 *  reporting, driving days, accelerometer days and the miles on them. */
export type RowLike = Partial<Omit<DailyRow, 'day' | 'tz' | 'vclass' | 'version'>> & {
  n_days?: number
  n_driving?: number
  n_accel?: number
  accel_miles?: number
}

export function sumDaily(rows: RowLike[], periodDays: number | null = null): DrivingTotals {
  const t = emptyTotals()
  t.periodDays = periodDays
  const n = (x: unknown) => Number(x) || 0
  for (const r of rows) {
    const summed = r.n_days != null
    t.days += summed ? n(r.n_days) : 1
    const driving = n(r.moving_s) > 0
    t.drivingDays += summed ? n(r.n_driving) : driving ? 1 : 0
    const miles = n(r.miles)
    t.miles += miles
    t.movingS += n(r.moving_s)
    t.engineS += n(r.engine_s)
    t.nightS += n(r.night_s)
    t.eveningS += n(r.evening_s)
    t.maxMph = Math.max(t.maxMph, n(r.max_mph))
    t.limitMiles += n(r.limit_miles)
    t.zoneModS += n(r.zone_mod_s)
    t.zoneHeavyS += n(r.zone_heavy_s)
    t.zoneSevS += n(r.zone_sev_s)
    t.maxSevS += n(r.max_sev_s)
    t.zoneSpeedN += n(r.zone_speed_n)
    t.maxSpeedN += n(r.max_speed_n)
    t.harsh_brake.moderate += n(r.brake_mod)
    t.harsh_brake.severe += n(r.brake_sev)
    t.harsh_accel.moderate += n(r.accel_mod)
    t.harsh_accel.severe += n(r.accel_sev)
    t.harsh_corner.moderate += n(r.corner_mod)
    t.harsh_corner.severe += n(r.corner_sev)
    t.unconfirmed += n(r.unconfirmed_n)
    t.estBrake += n(r.brake_est)
    t.estAccel += n(r.accel_est)
    t.crashes += n(r.crashes)
    t.fixes += n(r.fixes)
    t.obdS += n(r.obd_s)
    t.denseS += n(r.dense_s)
    t.gapS += n(r.gap_s)
    t.longestGapS = Math.max(t.longestGapS, n(r.longest_gap_s))
    t.powerLost += n(r.power_lost)
    t.unplugs += n(r.unplug_n)
    t.jamming += n(r.jamming_n)
    t.towing += n(r.towing_n)
    t.rejects += n(r.rejects_n)
    if (summed) { t.accelDays += n(r.n_accel); t.accelMiles += n(r.accel_miles) }
    else if (driving && r.accel_on) { t.accelDays++; t.accelMiles += miles }
    for (const d of Object.values(r.drivers ?? {})) t.attributedMiles += n(d?.smi)
  }
  t.miles = round1(t.miles)
  t.accelMiles = round1(t.accelMiles)
  t.attributedMiles = round1(Math.min(t.attributedMiles, t.miles))
  t.limitMiles = round1(Math.min(t.limitMiles, t.miles))
  return t
}

/** One person's slice: their SOLO time in the vehicles (rows' `drivers`) and
 *  the events charged to them. Time with another phone aboard is context
 *  ("rode along"), never scored — nobody knows which of the two drove. */
export function driverTotals(
  rows: Pick<RowLike, 'drivers' | 'accel_on'>[],
  events: Pick<DrivingEvent, 'kind' | 'severity' | 'source' | 'confirmed' | 'personId'>[],
  personId: string,
): DrivingTotals & { rodeMiles: number } {
  const t = emptyTotals()
  let rode = 0
  for (const r of rows) {
    const d = r.drivers?.[personId]
    if (!d) continue
    rode += Number(d.mi) || 0
    const smi = Number(d.smi) || 0
    if (d.nd != null) {
      // A period summed in SQL: the counts come with it.
      t.days += Number(d.nd) || 0
      t.drivingDays += Number(d.dd) || 0
      t.accelDays += Number(d.ad) || 0
      t.accelMiles += Number(d.a) || 0
    } else {
      t.days++
      if ((d.ss || 0) > 0) {
        t.drivingDays++
        if (r.accel_on) { t.accelDays++; t.accelMiles += smi }
      }
    }
    t.miles += smi
    t.movingS += d.ss || 0
    t.nightS += d.ns || 0
    t.zoneModS += d.zm || 0
    t.zoneHeavyS += d.zh || 0
    t.zoneSevS += d.zs || 0
  }
  for (const e of events) if (e.personId === personId) countTotals(t, e)
  t.miles = round1(t.miles)
  t.accelMiles = round1(t.accelMiles)
  t.attributedMiles = t.miles
  return { ...t, rodeMiles: round1(Math.max(0, rode - t.miles)) }
}

function countTotals(t: DrivingTotals, e: Pick<DrivingEvent, 'kind' | 'severity' | 'source' | 'confirmed'>) {
  if (e.kind === 'harsh_brake' || e.kind === 'harsh_accel' || e.kind === 'harsh_corner') {
    if (e.source === 'gps') { if (e.kind === 'harsh_brake') t.estBrake++; else if (e.kind === 'harsh_accel') t.estAccel++ }
    else if (e.confirmed) t[e.kind][e.severity === 'severe' ? 'severe' : 'moderate']++
    else t.unconfirmed++
  } else if (e.kind === 'crash') t.crashes++
  else if (e.kind === 'zone_speeding') t.zoneSpeedN++
  else if (e.kind === 'max_speed') t.maxSpeedN++
}

/** Group rows by calendar month ("2026-07") — the insurer's 12-month series. */
export function byMonth<T extends { day: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const m = r.day.slice(0, 7)
    const list = out.get(m) ?? []
    list.push(r)
    out.set(m, list)
  }
  return out
}

// ── The score ───────────────────────────────────────────────────────────────

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'
export const gradeFor = (score: number): Grade => {
  const g = SAFETY_METHOD.grades
  return score >= g.A ? 'A' : score >= g.B ? 'B' : score >= g.C ? 'C' : score >= g.D ? 'D' : 'F'
}
/** Geotab-style risk bands for the insurer view. */
export type RiskBand = 'low' | 'mild' | 'medium' | 'high'
export const riskBand = (score: number): RiskBand => (score >= 90 ? 'low' : score >= 75 ? 'mild' : score >= 60 ? 'medium' : 'high')

export type ComponentKey = 'harsh_brake' | 'harsh_corner' | 'harsh_accel' | 'speeding' | 'late_night'

export interface ScoreComponent {
  key: ComponentKey
  label: string
  /** Points taken off the 100 (before credibility blending). */
  points: number
  /** Plain words: what was counted. */
  detail: string
  /** Harsh events without the accelerometer: not measured, no points. */
  measured: boolean
}

export interface DataQuality {
  verdict: 'good' | 'fair' | 'poor'
  /** on = the truck's accelerometer reports harsh events; off = not measured (GPS estimates shown only). */
  accelerometer: 'on' | 'partial' | 'off'
  /** Where the speed came from: the truck's own speedometer (OBD) or GPS. */
  speedSource: 'obd' | 'mixed' | 'gps'
  obdPct: number | null
  /** Share of miles driven where a posted limit was known. */
  limitPct: number | null
  /** Share of days the tracker reported at all. */
  uptimePct: number | null
  /** Share of the driving time actually recorded. */
  coveragePct: number | null
  /** Share of driving sampled ≤ 3 s apart — what a GPS estimate can see. */
  densePct: number | null
  /** Truck power lost + the tracker's own unplug events. */
  unplugged: number
  jamming: number
  towing: number
  /** GPS spikes the ingest refused. */
  rejects: number
  /** Share of miles tied to a named driver. */
  attributedPct: number | null
  confirmed: number
  unconfirmed: number
  estimated: number
  notes: string[]
}

export interface SafetyScore {
  credible: boolean
  /** The score shown (blended toward the fleet under 3,000 mi). */
  score: number | null
  /** 100 − Σ impacts for this slice alone. */
  raw: number | null
  /** Credibility weight 0–1 (1 = fully its own). */
  z: number | null
  grade: Grade | null
  band: RiskBand | null
  /** Why there is no score (credible false). */
  why: string | null
  miles: number
  hours: number
  engineHours: number
  /** Raw rates per 1,000 miles: confirmed accelerometer events (over the miles
   *  it was on — null when not measured); GPS estimates for coaching. */
  per1000: { harsh_brake: number | null; harsh_accel: number | null; harsh_corner: number | null; est_brake: number; est_accel: number }
  /** Confirmed accelerometer events per 100 engine hours (vocational trucks). */
  per100EngineHours: number | null
  counts: { harsh_brake: number; harsh_brake_severe: number; harsh_accel: number; harsh_corner: number; crash: number; zone_speeding: number; max_speed: number; est_brake: number; est_accel: number }
  /** Share of moving time per speeding tier, 0–100. */
  speedPct: { moderate: number; heavy: number; severe: number }
  lateNightPct: number
  eveningPct: number
  components: ScoreComponent[]
  /** The single thing worth saying to the driver. */
  coaching: string
  quality: DataQuality
}

const sumPair = (c: SevPair) => c.moderate + c.severe
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const fmtRate = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1))

export function dataQuality(t: DrivingTotals): DataQuality {
  const accelerometer: DataQuality['accelerometer'] = t.drivingDays === 0 || t.accelDays === 0 ? 'off'
    : t.accelDays >= t.drivingDays * 0.8 ? 'on' : 'partial'
  const share = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
  const obdPct = share(t.obdS, t.movingS)
  const speedSource: DataQuality['speedSource'] = obdPct == null || obdPct < 20 ? 'gps' : obdPct >= 80 ? 'obd' : 'mixed'
  const coveragePct = share(t.movingS, t.movingS + t.gapS)
  const densePct = share(t.denseS, t.movingS)
  const limitPct = share(t.limitMiles, t.miles)
  const uptimePct = t.periodDays ? Math.min(100, share(t.days, t.periodDays) ?? 0) : null
  const attributedPct = share(t.attributedMiles, t.miles)
  const unplugged = t.powerLost + t.unplugs
  const confirmed = sumPair(t.harsh_brake) + sumPair(t.harsh_accel) + sumPair(t.harsh_corner)
  const estimated = t.estBrake + t.estAccel
  const notes: string[] = []
  if (accelerometer === 'off') notes.push(`Harsh braking, launches and cornering are not measured yet — the truck's accelerometer is off.${estimated ? ` ${plural(estimated, 'hard stop or launch', 'hard stops or launches')} estimated from GPS speed ${estimated === 1 ? 'is' : 'are'} shown for coaching, not scored.` : ''}`)
  else if (accelerometer === 'partial') notes.push('The accelerometer was on for only part of the period; harsh events are rated over the miles it was on for.')
  if (t.unconfirmed) notes.push(`${plural(t.unconfirmed, 'accelerometer event')} the speed did not confirm (a pothole, a dropped tool) — listed, not scored.`)
  if (t.movingS > 0 && speedSource !== 'obd') notes.push(speedSource === 'gps' ? 'Speeds are GPS speeds — this truck\'s computer does not report its own speed to the tracker.' : `The truck's own speed was reported for ${obdPct}% of driving; the rest is GPS speed.`)
  if (t.miles > 0) notes.push(limitPct ? `A posted limit was known for ${limitPct}% of the miles (inside sites with their own limit); elsewhere only the top-speed line applies (${SAFETY_METHOD.maxSpeed.light} mph; ${SAFETY_METHOD.maxSpeed.heavy} for medium and heavy trucks).` : `No posted limits are known on these roads yet — speeding counts only over a site's own limit and at ${SAFETY_METHOD.maxSpeed.light} mph and up (${SAFETY_METHOD.maxSpeed.heavy} for medium and heavy trucks).`)
  if (coveragePct != null && coveragePct < 95) notes.push(`${100 - coveragePct}% of the driving time went unrecorded (tracker off, unplugged, or out of coverage).`)
  if (uptimePct != null && uptimePct < 90) notes.push(`The tracker reported on ${uptimePct}% of the days in the period.`)
  if (unplugged) notes.push(`The truck stopped powering the tracker, or it was unplugged, ${plural(unplugged, 'time')}.`)
  if (t.jamming) notes.push(`GPS or cell jamming was detected ${plural(t.jamming, 'time')}.`)
  if (t.towing) notes.push(`The tracker reported being towed ${plural(t.towing, 'time')}.`)
  if (t.rejects) notes.push(`${plural(t.rejects, 'impossible GPS jump')} refused at the door (never counted as driving).`)
  if (attributedPct != null) notes.push(attributedPct ? `${attributedPct}% of the miles are tied to a named driver.` : 'No miles are tied to a named driver yet (a crew phone, clocked in, riding along).')
  const verdict: DataQuality['verdict'] = (coveragePct != null && coveragePct < 85) || unplugged >= 3 || t.jamming >= 3 ? 'poor'
    : (coveragePct != null && coveragePct < 95) || unplugged >= 1 || t.jamming >= 1 || accelerometer !== 'on' || (uptimePct != null && uptimePct < 90) ? 'fair' : 'good'
  return {
    verdict, accelerometer, speedSource, obdPct, limitPct, uptimePct, coveragePct, densePct,
    unplugged, jamming: t.jamming, towing: t.towing, rejects: t.rejects, attributedPct,
    confirmed, unconfirmed: t.unconfirmed, estimated, notes,
  }
}

/**
 * The score for any slice — a vehicle, a driver, the whole fleet:
 *   100 − Σ impacts, clamped 0–100
 *   events: per 1,000 miles × weight (severe ×2) — confirmed accelerometer
 *     events, rated over the miles driven while it was on
 *   speeding, late night: % of moving time × weight
 * Under 3,000 miles it is blended toward `fleetMean` (Z = √(miles/3,000)).
 */
export function scoreTotals(t: DrivingTotals, opts: { fleetMean?: number | null } = {}): SafetyScore {
  const M = SAFETY_METHOD
  const miles = round1(t.miles)
  const hours = round1(t.movingS / 3600)
  const engineHours = round1(t.engineS / 3600)
  const quality = dataQuality(t)
  const measured = t.accelMiles > 0
  const ka = t.accelMiles / 1000
  const per = (n: number) => (measured && ka > 0 ? round2(n / ka) : null)
  const km = miles / 1000
  const counts = {
    harsh_brake: sumPair(t.harsh_brake), harsh_brake_severe: t.harsh_brake.severe,
    harsh_accel: sumPair(t.harsh_accel), harsh_corner: sumPair(t.harsh_corner),
    crash: t.crashes, zone_speeding: t.zoneSpeedN, max_speed: t.maxSpeedN, est_brake: t.estBrake, est_accel: t.estAccel,
  }
  const per1000 = {
    harsh_brake: per(counts.harsh_brake), harsh_accel: per(counts.harsh_accel), harsh_corner: per(counts.harsh_corner),
    est_brake: km > 0 ? round2(t.estBrake / km) : 0, est_accel: km > 0 ? round2(t.estAccel / km) : 0,
  }
  const allHarsh = counts.harsh_brake + counts.harsh_accel + counts.harsh_corner
  const per100EngineHours = measured && engineHours > 0 ? round2(allHarsh / (engineHours / 100)) : null
  const pct = (s: number) => (t.movingS > 0 ? round2((s / t.movingS) * 100) : 0)
  const speedPct = { moderate: pct(t.zoneModS), heavy: pct(t.zoneHeavyS), severe: pct(t.zoneSevS + t.maxSevS) }
  const lateNightPct = pct(t.nightS)
  const eveningPct = pct(t.eveningS)
  const base = { miles, hours, engineHours, per1000, per100EngineHours, counts, speedPct, lateNightPct, eveningPct, quality }

  const C = M.credibility
  if (miles < C.minMiles || hours < C.minHours) {
    return {
      ...base, credible: false, score: null, raw: null, z: null, grade: null, band: null, components: [],
      why: `Not enough driving yet — ${Math.round(miles)} mi and ${hours} h so far; a score needs ${C.minMiles} mi and ${C.minHours} h in the period.`,
      coaching: 'Not enough driving yet to coach on.',
    }
  }

  const harsh = (kind: HarshKind, label: string, noun: string, nouns: string): ScoreComponent => {
    const c = t[kind]
    const n = c.moderate + c.severe
    return measured
      ? {
          key: kind, label, measured: true,
          points: round1(((c.moderate + c.severe * M.severeMultiplier) * M.eventWeights[kind]) / ka),
          detail: `${plural(n, noun, nouns)}${c.severe ? ` (${c.severe} severe)` : ''} · ${fmtRate(n / ka)} per 1,000 mi`,
        }
      : { key: kind, label, measured: false, points: 0, detail: 'Not measured until the accelerometer is on' }
  }
  const tierW = Object.fromEntries(M.speedTiers.map((s) => [s.tier, s.weight])) as Record<SpeedTier, number>
  const comps: ScoreComponent[] = [
    harsh('harsh_brake', 'Hard braking', 'hard stop', 'hard stops'),
    harsh('harsh_corner', 'Hard cornering', 'hard corner', 'hard corners'),
    harsh('harsh_accel', 'Hard launches', 'hard launch', 'hard launches'),
    {
      key: 'speeding', label: 'Speeding', measured: true,
      points: round1(speedPct.moderate * tierW.moderate + speedPct.heavy * tierW.heavy + speedPct.severe * tierW.severe),
      detail: `${speedPct.severe}% of driving severe, ${speedPct.heavy}% heavy, ${speedPct.moderate}% moderate · top ${t.maxMph} mph`,
    },
    {
      key: 'late_night', label: 'Late-night driving', measured: true, points: round1(lateNightPct * M.lateNight.weightPerPct),
      detail: `${lateNightPct}% of driving between midnight and 4 AM`,
    },
  ]
  const total = comps.reduce((s, c) => s + c.points, 0)
  const raw = Math.max(0, Math.min(100, Math.round(100 - total)))
  const z = Math.min(1, Math.sqrt(miles / C.fullMiles))
  const score = opts.fleetMean != null && z < 1 ? Math.max(0, Math.min(100, Math.round(z * raw + (1 - z) * opts.fleetMean))) : raw
  const components = comps.sort((a, b) => b.points - a.points)
  return {
    ...base, credible: true, score, raw, z: round2(z), grade: gradeFor(score), band: riskBand(score), why: null, components,
    coaching: coachingFor(components[0], base, measured),
  }
}

export function scoreFromDaily(rows: RowLike[], opts: { fleetMean?: number | null; periodDays?: number | null } = {}): SafetyScore {
  return scoreTotals(sumDaily(rows, opts.periodDays ?? null), opts)
}

function coachingFor(top: ScoreComponent | undefined, s: Pick<SafetyScore, 'counts' | 'speedPct' | 'lateNightPct' | 'miles'>, measured: boolean): string {
  if (top && top.points >= 1) {
    switch (top.key) {
      case 'harsh_brake': return `Leave more room ahead: ${plural(s.counts.harsh_brake, 'hard stop')} in ${Math.round(s.miles)} mi. Most hard stops follow a too-close gap.`
      case 'harsh_accel': return `Ease onto the gas: ${plural(s.counts.harsh_accel, 'hard launch', 'hard launches')} in ${Math.round(s.miles)} mi. It saves fuel and tires too.`
      case 'harsh_corner': return `Slow down before the turn, not in it: ${plural(s.counts.harsh_corner, 'hard corner')} in ${Math.round(s.miles)} mi.`
      case 'speeding': return s.speedPct.severe > 0
        ? `Ease off: ${s.speedPct.severe}% of driving was severe speeding — a held top-speed run (${SAFETY_METHOD.maxSpeed.light}+ mph, ${SAFETY_METHOD.maxSpeed.heavy}+ in a heavy truck), or ${SAFETY_METHOD.speedTiers[2].minOver}+ over a site's limit.`
        : `Mind the site limits: ${round2(s.speedPct.heavy + s.speedPct.moderate)}% of driving over a site's posted speed.`
      case 'late_night': return `${s.lateNightPct}% of driving was between midnight and 4 AM — the riskiest hours on the road.`
    }
  }
  if (!measured && s.counts.est_brake + s.counts.est_accel > 0) {
    return `Clean on speed and hours. GPS speed suggests ${plural(s.counts.est_brake + s.counts.est_accel, 'hard stop or launch', 'hard stops or launches')} — switch on the accelerometer to measure them for real.`
  }
  return 'Clean driving — nothing to coach this period.'
}

// ── Words ───────────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<EventKind, string> = {
  harsh_brake: 'Hard brake',
  harsh_accel: 'Hard launch',
  harsh_corner: 'Hard corner',
  crash: 'Possible impact',
  max_speed: 'Top-speed run',
  zone_speeding: 'Over site limit',
}

/** "Severe hard brake · 0.52 g from 41 mph", "Hard brake · 0.36 g from 38 mph (GPS estimate, not scored)". */
export function eventWords(e: Pick<DrivingEvent, 'kind' | 'severity' | 'source' | 'confirmed' | 'value' | 'speedMph' | 'durationS' | 'limitMph'>, zoneName?: string | null): string {
  const label = KIND_LABEL[e.kind]
  const dur = e.durationS ? ` for ${fmtDur(e.durationS)}` : ''
  switch (e.kind) {
    case 'harsh_brake':
    case 'harsh_accel':
    case 'harsh_corner': {
      const head = e.severity === 'severe' ? `Severe ${label.toLowerCase()}` : label
      const tail = e.source === 'gps' ? ' (GPS estimate, not scored)' : e.confirmed === false ? ' (speed did not confirm it, not scored)' : ''
      return `${head}${e.value != null ? ` · ${e.value.toFixed(2)} g` : ''}${e.speedMph != null ? ` ${e.kind === 'harsh_corner' ? 'at' : 'from'} ${e.speedMph} mph` : ''}${tail}`
    }
    case 'crash':
      return `${label}${e.value != null ? ` · ${e.value.toFixed(1)} g` : ''}${e.speedMph != null ? ` at ${e.speedMph} mph` : ''} (listed, not scored)`
    case 'zone_speeding':
      return `${e.speedMph ?? e.value} mph in a ${e.limitMph} mph site${zoneName ? ` (${zoneName})` : ''}${dur} — ${e.severity}`
    default:
      return `${label} · ${e.speedMph ?? e.value} mph${dur}`
  }
}

export function fmtDur(s: number): string {
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`
}

// ── CSV (insurer exports) ───────────────────────────────────────────────────

/** A spreadsheet cell: text that starts like a formula is neutralised (it
 *  lands in Excel at the agent's office); numbers stay numbers. */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(head: string[], rows: unknown[][]): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
