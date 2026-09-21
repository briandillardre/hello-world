/**
 * Truck readings — the master list of what a Teltonika OBD / battery unit CAN
 * report, in contractor words, with the units a US crew reads.
 *
 * Brian, Sep 21: "make sure every data point that is being sent is captured …
 * dials on the asset pop-up and on the main asset page … useful data in a
 * format that contractors would understand. Think RPMs, battery level etc.
 * Similar to what they would see on a truck. There needs to be a full master
 * list of what the Teltonika OBD device CAN do, then show what is being
 * received for a particular truck."
 *
 * Three facts this file is built on (all checked against the live DB):
 *  • flespi hands every Teltonika I/O element to us under a NAME
 *    (`can.engine.rpm`, `can.fuel.level`, `external.powersource.voltage`…),
 *    in METRIC (°C, km, km/h, L). The names below are the ones the pilot
 *    trucks actually send; `aliases` cover the other spellings flespi uses
 *    for the same element on other firmware, and a `match` pattern catches a
 *    whole family (BLE sensors, Dallas probes) so nothing arrives unlabelled.
 *  • Every truck serves a DIFFERENT subset. The F350 and the RAM 3500 answer
 *    the full OBD set (RPM, coolant, load, fuel, check-engine count, VIN,
 *    odometer); the RAM 2500 only fuel + VIN; the F650/F750 (J1939 trucks)
 *    give the unit nothing over the OBD port at all. So the catalog is one
 *    list and the UI shows RECEIVED vs NOT REPORTED per truck.
 *  • A battery unit (TAT141) has no engine to read — its "readings" are its
 *    own health: battery, cell signal, modem uptime (IDs 25015–25017 are
 *    Teltonika's TAT141 list: modem uptime, LTE RSRP, LTE RSRQ).
 *
 * Pure module — no React, no DB. `scripts/telemetry-test.mjs` asserts the
 * conversions, the health verdicts and the fold; run it after ANY change.
 */

import { POWERED_MIN_V } from './power-loss'

export type Tone = 'ok' | 'warn' | 'bad' | 'off' | 'info'
export type ReadingGroup =
  | 'engine' | 'fuel' | 'check-engine' | 'electrical' | 'distance' | 'driving'
  | 'tracker' | 'gps' | 'cellular' | 'sensors' | 'events'
export type ReadingSource = 'obd' | 'device' | 'gnss' | 'cell' | 'ble' | 'event'
export type ReadingKind = 'number' | 'flag' | 'text' | 'enum' | 'list' | 'duration'

/** Which tracker family can report a reading (lib/devices trackerKind keys). */
export type DeviceFamily = 'obd' | 'wired' | 'battery' | 'phone' | 'tag' | 'gps' | 'none'

export interface GaugeSpec {
  min: number
  max: number
  /** Dashboard order — lower first. Only gauge-worthy readings carry one. */
  order: number
  /** Colour bands in DISPLAY units, ascending `to`. */
  bands: { to: number; tone: Tone }[]
}

export interface AssessCtx {
  engineOn?: boolean | null
  family?: DeviceFamily
}

export interface Assessment {
  tone: Tone
  /** Plain words for the flag line and the AI ("Fuel low", "Overheating"). */
  words?: string
}

export interface ReadingDef {
  /** The flespi name the pilot trucks send (or the most likely one). */
  key: string
  aliases?: string[]
  /** Family pattern (BLE sensors, Dallas probes…) — `$1` is the sensor index. */
  match?: RegExp
  /** Teltonika AVL I/O id(s), for the reference table. */
  io?: string
  label: string
  /** Short form for a gauge face. */
  short?: string
  group: ReadingGroup
  source: ReadingSource
  kind: ReadingKind
  /** Display unit AFTER `convert`. */
  unit?: string
  convert?: (v: number) => number
  decimals?: number
  gauge?: GaugeSpec
  assess?: (v: unknown, ctx: AssessCtx) => Assessment | null
  /** One line a foreman reads: what it is, when to worry. */
  explain: string
  enumLabels?: Record<string, string>
  /** [true, false] words for a flag. */
  flagWords?: [string, string]
  /** Which tracker families can report it (absent = any). */
  families?: DeviceFamily[]
  /** Plumbing — real, kept, but hidden behind "show device plumbing". */
  internal?: boolean
}

// ── Unit conversions (flespi is metric; the crew is not) ────────────────────
export const cToF = (c: number) => c * 9 / 5 + 32
export const kmToMi = (km: number) => km * 0.621371
export const kmhToMph = kmToMi
export const kpaToPsi = (kpa: number) => kpa * 0.145038
export const kpaToInHg = (kpa: number) => kpa * 0.2953
export const lToGal = (l: number) => l * 0.264172
export const kmPerLToMpg = (kml: number) => kml * 2.35215
export const mToFt = (m: number) => m * 3.28084

/** Seconds → "2h 05m" / "45s". */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

// ── Verdict helpers ─────────────────────────────────────────────────────────
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const ladder = (v: unknown, okAt: number, warnAt: number, words: [string, string, string], higherIsBetter = true): Assessment | null => {
  const n = num(v)
  if (n == null) return null
  if (higherIsBetter) {
    if (n >= okAt) return { tone: 'ok', words: words[0] }
    if (n >= warnAt) return { tone: 'warn', words: words[1] }
    return { tone: 'bad', words: words[2] }
  }
  if (n <= okAt) return { tone: 'ok', words: words[0] }
  if (n <= warnAt) return { tone: 'warn', words: words[1] }
  return { tone: 'bad', words: words[2] }
}

/** US carriers by MCC+MNC — the SuperSIM roams across all three majors. */
const CARRIERS: Record<string, string> = {
  '310410': 'AT&T', '310280': 'AT&T', '310150': 'AT&T', '310170': 'AT&T', '310380': 'AT&T', '310560': 'AT&T', '310680': 'AT&T', '310030': 'AT&T', '313100': 'FirstNet (AT&T)',
  '310260': 'T-Mobile', '310200': 'T-Mobile', '310210': 'T-Mobile', '310220': 'T-Mobile', '310230': 'T-Mobile', '310240': 'T-Mobile', '310250': 'T-Mobile', '310270': 'T-Mobile', '310310': 'T-Mobile', '310490': 'T-Mobile', '310660': 'T-Mobile', '310800': 'T-Mobile', '310120': 'Sprint (T-Mobile)', '312530': 'Sprint (T-Mobile)',
  '311480': 'Verizon', '311270': 'Verizon', '311280': 'Verizon', '311290': 'Verizon', '311390': 'Verizon', '311110': 'Verizon', '310004': 'Verizon', '310012': 'Verizon',
  '311580': 'US Cellular', '311220': 'US Cellular',
}
export function carrierName(code: unknown): string | null {
  const c = String(code ?? '').replace(/\D/g, '')
  return c ? CARRIERS[c] ?? null : null
}

/** Teltonika event I/O ids as they arrive in `event.enum`. */
export const EVENT_LABELS: Record<string, string> = {
  '0': 'Scheduled report', '239': 'Ignition changed', '240': 'Movement changed', '246': 'Towing detected', '247': 'Crash detected',
  '249': 'Jamming', '250': 'Trip start / stop', '251': 'Idling', '252': 'Unplugged', '253': 'Harsh driving', '254': 'Harsh driving',
  '255': 'Over speed limit', '236': 'Alarm', '385': 'Tag scan (BLE beacons)', '175': 'Auto geofence', '390': 'Power event', '449': 'Ignition counter',
  '155': 'Geofence', '156': 'Geofence', '157': 'Geofence', '158': 'Geofence', '159': 'Geofence',
}

// ── The master list ─────────────────────────────────────────────────────────
const OBD: DeviceFamily[] = ['obd', 'wired']

export const TELEMETRY_CATALOG: ReadingDef[] = [
  // ENGINE ──────────────────────────────────────────────────────────────────
  {
    key: 'can.engine.rpm', aliases: ['obd.rpm', 'engine.rpm', 'obd.engine.rpm'], io: '36', label: 'Engine RPM', short: 'RPM',
    group: 'engine', source: 'obd', kind: 'number', unit: 'rpm', decimals: 0, families: OBD,
    gauge: { min: 0, max: 6000, order: 1, bands: [{ to: 3500, tone: 'ok' }, { to: 4500, tone: 'warn' }, { to: 6000, tone: 'bad' }] },
    assess: (v, ctx) => {
      const n = num(v); if (n == null) return null
      if (n === 0 || ctx.engineOn === false) return { tone: 'off', words: 'Engine off' }
      if (n > 4500) return { tone: 'bad', words: 'Revving very hard' }
      if (n > 3500) return { tone: 'warn', words: 'Revving hard' }
      return { tone: 'ok', words: n < 1000 ? 'Idling' : 'Running' }
    },
    explain: 'How fast the engine is turning. Idle is about 600–900; working hard is 2,000–3,500. Zero means the engine is off.',
  },
  {
    key: 'can.engine.coolant.temperature', aliases: ['can.engine.temperature', 'engine.coolant.temperature', 'obd.coolant.temperature', 'engine.temperature'], io: '32',
    label: 'Coolant temp', short: 'COOLANT', group: 'engine', source: 'obd', kind: 'number', unit: '°F', convert: cToF, decimals: 0, families: OBD,
    gauge: { min: 100, max: 260, order: 3, bands: [{ to: 160, tone: 'off' }, { to: 225, tone: 'ok' }, { to: 240, tone: 'warn' }, { to: 260, tone: 'bad' }] },
    assess: (v, ctx) => {
      const c = num(v); if (c == null) return null
      const f = cToF(c)
      if (f > 240) return { tone: 'bad', words: 'Overheating' }
      if (f > 225) return { tone: 'warn', words: 'Running hot' }
      if (f < 140) return { tone: ctx.engineOn ? 'info' : 'off', words: ctx.engineOn ? 'Warming up' : 'Cold (engine off)' }
      return { tone: 'ok', words: 'Normal' }
    },
    explain: 'Engine temperature. Normal is about 180–220 °F once warm. Over 225 it is running hot; over 240, shut it down and check the coolant.',
  },
  {
    key: 'can.engine.load.level', aliases: ['can.engine.load', 'engine.load.level', 'obd.engine.load', 'engine.load'], io: '31', label: 'Engine load', short: 'LOAD',
    group: 'engine', source: 'obd', kind: 'number', unit: '%', decimals: 0, families: OBD,
    gauge: { min: 0, max: 100, order: 6, bands: [{ to: 85, tone: 'ok' }, { to: 95, tone: 'warn' }, { to: 100, tone: 'bad' }] },
    assess: (v, ctx) => { const n = num(v); if (n == null) return null; if (ctx.engineOn === false) return { tone: 'off', words: 'Engine off' }; return n > 95 ? { tone: 'warn', words: 'Working flat out' } : { tone: 'ok' } },
    explain: 'How hard the engine is working right now, as a share of what it can do. High load at low speed is towing, pushing or a plugged filter.',
  },
  {
    key: 'can.throttle.pedal.level', aliases: ['can.throttle.position', 'obd.throttle.position', 'throttle.position', 'can.pedal.position'], io: '41', label: 'Throttle', short: 'THROTTLE',
    group: 'engine', source: 'obd', kind: 'number', unit: '%', decimals: 0, families: OBD,
    explain: 'How far the throttle is open, 0–100 %.',
  },
  {
    key: 'can.engine.oil.temperature', aliases: ['engine.oil.temperature', 'obd.oil.temperature'], io: '58', label: 'Oil temp', short: 'OIL',
    group: 'engine', source: 'obd', kind: 'number', unit: '°F', convert: cToF, decimals: 0, families: OBD,
    gauge: { min: 100, max: 300, order: 7, bands: [{ to: 160, tone: 'off' }, { to: 250, tone: 'ok' }, { to: 275, tone: 'warn' }, { to: 300, tone: 'bad' }] },
    assess: (v) => { const c = num(v); if (c == null) return null; const f = cToF(c); return f > 275 ? { tone: 'bad', words: 'Oil very hot' } : f > 250 ? { tone: 'warn', words: 'Oil hot' } : { tone: 'ok' } },
    explain: 'Engine oil temperature. Fine up to about 250 °F; over 275 the oil is breaking down.',
  },
  {
    key: 'can.engine.runtime', aliases: ['engine.runtime', 'obd.engine.runtime', 'can.engine.run.time'], io: '42', label: 'Running since start',
    group: 'engine', source: 'obd', kind: 'duration', families: OBD,
    explain: 'How long the engine has been running since it was last started.',
  },
  {
    key: 'can.engine.motorhours', aliases: ['engine.motorhours', 'can.engine.hours', 'engine.hours'], io: '—', label: 'Engine hours',
    group: 'engine', source: 'obd', kind: 'number', unit: 'h', decimals: 1, families: OBD,
    explain: 'Total hours the engine has run, as the truck\'s computer counts them.',
  },
  {
    key: 'can.intake.air.temperature', aliases: ['can.engine.intake.air.temperature', 'intake.air.temperature', 'obd.intake.air.temperature'], io: '39', label: 'Intake air temp',
    group: 'engine', source: 'obd', kind: 'number', unit: '°F', convert: cToF, decimals: 0, families: OBD,
    explain: 'Temperature of the air going into the engine. Much hotter than outside means a heat-soaked or dirty intake.',
  },
  {
    key: 'can.ambient.air.temperature', aliases: ['ambient.air.temperature', 'obd.ambient.air.temperature'], io: '53', label: 'Outside air temp',
    group: 'engine', source: 'obd', kind: 'number', unit: '°F', convert: cToF, decimals: 0, families: OBD,
    explain: 'Outside temperature as the truck measures it.',
  },
  {
    key: 'can.intake.manifold.pressure', aliases: ['can.engine.intake.manifold.pressure', 'intake.manifold.pressure', 'obd.intake.map'], io: '35', label: 'Intake pressure',
    group: 'engine', source: 'obd', kind: 'number', unit: 'psi', convert: kpaToPsi, decimals: 1, families: OBD,
    explain: 'Air pressure in the intake — on a turbo diesel this is boost.',
  },
  {
    key: 'can.barometric.pressure', aliases: ['barometric.pressure', 'obd.barometric.pressure'], io: '50', label: 'Barometric pressure',
    group: 'engine', source: 'obd', kind: 'number', unit: 'inHg', convert: kpaToInHg, decimals: 2, families: OBD,
    explain: 'Air pressure outside, as the engine computer reads it.',
  },
  {
    key: 'can.air.flow.rate', aliases: ['can.engine.maf', 'engine.maf', 'air.flow.rate', 'obd.maf'], io: '40', label: 'Air flow',
    group: 'engine', source: 'obd', kind: 'number', unit: 'g/s', decimals: 1, families: OBD,
    explain: 'How much air the engine is breathing (mass air flow). Diagnostic detail.',
  },
  {
    key: 'can.engine.timing.advance', aliases: ['timing.advance', 'obd.timing.advance'], io: '38', label: 'Timing advance',
    group: 'engine', source: 'obd', kind: 'number', unit: '°', decimals: 1, families: OBD, explain: 'Ignition timing. Diagnostic detail.',
  },
  {
    key: 'can.fuel.trim.short', aliases: ['short.fuel.trim', 'obd.short.fuel.trim', 'can.fuel.trim.short.bank1'], io: '33', label: 'Fuel trim (short)',
    group: 'engine', source: 'obd', kind: 'number', unit: '%', decimals: 1, families: OBD, explain: 'How much the computer is correcting the fuel mix. Big numbers either way point at a sensor or a leak.',
  },
  {
    key: 'can.egr.level', aliases: ['commanded.egr', 'obd.commanded.egr', 'can.egr.commanded'], io: '46', label: 'EGR commanded',
    group: 'engine', source: 'obd', kind: 'number', unit: '%', decimals: 0, families: OBD, explain: 'Exhaust gas recirculation command. Diagnostic detail.',
  },
  {
    key: 'can.egr.error', aliases: ['egr.error', 'obd.egr.error'], io: '47', label: 'EGR error',
    group: 'engine', source: 'obd', kind: 'number', unit: '%', decimals: 0, families: OBD, explain: 'How far the EGR valve is from where it was told to be.',
  },
  {
    key: 'can.engine.load.absolute', aliases: ['absolute.load', 'obd.absolute.load'], io: '52', label: 'Absolute load',
    group: 'engine', source: 'obd', kind: 'number', unit: '%', decimals: 0, families: OBD, explain: 'Engine load against its full airflow capacity. Diagnostic detail.',
  },
  {
    key: 'can.fuel.injection.timing', aliases: ['fuel.injection.timing'], io: '59', label: 'Injection timing',
    group: 'engine', source: 'obd', kind: 'number', unit: '°', decimals: 1, families: OBD, explain: 'Fuel injection timing. Diagnostic detail.',
  },

  // FUEL ────────────────────────────────────────────────────────────────────
  {
    key: 'can.fuel.level', aliases: ['fuel.level', 'obd.fuel.level', 'can.fuel.level.percent'], io: '48', label: 'Fuel level', short: 'FUEL',
    group: 'fuel', source: 'obd', kind: 'number', unit: '%', decimals: 0, families: OBD,
    gauge: { min: 0, max: 100, order: 4, bands: [{ to: 10, tone: 'bad' }, { to: 20, tone: 'warn' }, { to: 100, tone: 'ok' }] },
    assess: (v) => { const n = num(v); if (n == null) return null; return n < 10 ? { tone: 'bad', words: 'Fuel very low' } : n < 20 ? { tone: 'warn', words: 'Fuel low' } : { tone: 'ok' } },
    explain: 'Fuel in the tank, as the truck\'s own gauge sees it. Not every truck answers this over the port.',
  },
  {
    key: 'can.fuel.volume', aliases: ['fuel.volume', 'obd.fuel.volume'], io: '390', label: 'Fuel in tank',
    group: 'fuel', source: 'obd', kind: 'number', unit: 'gal', convert: lToGal, decimals: 1, families: OBD,
    explain: 'Gallons in the tank, where the truck reports a volume rather than a percent.',
  },
  {
    key: 'can.fuel.consumption', aliases: ['fuel.rate', 'can.fuel.rate', 'obd.fuel.rate'], io: '60', label: 'Fuel rate',
    group: 'fuel', source: 'obd', kind: 'number', unit: 'gal/h', convert: lToGal, decimals: 2, families: OBD,
    explain: 'Fuel burn right now, per hour, as the truck\'s computer reports it. On the pilot trucks this reads far too low to trust — compare it against the dash before using it.',
  },
  {
    key: 'can.fuel.consumed', aliases: ['fuel.consumed', 'obd.fuel.consumed'], io: '—', label: 'Fuel used (total)',
    group: 'fuel', source: 'obd', kind: 'number', unit: 'gal', convert: lToGal, decimals: 1, families: OBD,
    explain: 'Total fuel the truck says it has burned.',
  },
  {
    key: 'can.fuel.economy', aliases: ['fuel.economy', 'obd.fuel.economy'], io: '—', label: 'Fuel economy (now)',
    group: 'fuel', source: 'obd', kind: 'number', unit: 'mpg', convert: kmPerLToMpg, decimals: 1, families: OBD,
    explain: 'Instant miles per gallon.',
  },
  {
    key: 'fuel.used.gps', aliases: ['fuel.consumed.gps', 'can.fuel.used.gps'], io: '12', label: 'Fuel used (tracker estimate)',
    group: 'fuel', source: 'device', kind: 'number', unit: 'gal', convert: lToGal, decimals: 1,
    explain: 'The tracker\'s own estimate of fuel used, from distance driven. An estimate, not a measurement.',
  },
  {
    key: 'fuel.rate.gps', aliases: ['can.fuel.rate.gps'], io: '13', label: 'Fuel rate (tracker estimate)',
    group: 'fuel', source: 'device', kind: 'number', unit: 'L/100km', decimals: 1,
    explain: 'The tracker\'s estimated burn rate from distance driven. An estimate, not a measurement.',
  },
  {
    key: 'can.fuel.type', aliases: ['fuel.type', 'obd.fuel.type'], io: '759', label: 'Fuel type',
    group: 'fuel', source: 'obd', kind: 'enum', families: OBD,
    enumLabels: { '0': 'Not available', '1': 'Gasoline', '2': 'Methanol', '3': 'Ethanol', '4': 'Diesel', '5': 'LPG', '6': 'CNG', '7': 'Propane', '8': 'Electric', '9': 'Bi-fuel gasoline', '17': 'Hybrid gasoline', '18': 'Hybrid ethanol', '19': 'Hybrid diesel', '20': 'Hybrid electric', '23': 'Hybrid' },
    explain: 'What the truck runs on, per its computer.',
  },

  // CHECK ENGINE ────────────────────────────────────────────────────────────
  {
    key: 'can.dtc.number', aliases: ['obd.dtc.number', 'dtc.number', 'faults.count', 'can.dtc.count'], io: '30', label: 'Check-engine codes', short: 'CODES',
    group: 'check-engine', source: 'obd', kind: 'number', unit: '', decimals: 0, families: OBD,
    assess: (v) => { const n = num(v); if (n == null) return null; return n > 0 ? { tone: 'bad', words: `Check engine: ${n} code${n === 1 ? '' : 's'}` } : { tone: 'ok', words: 'No trouble codes' } },
    explain: 'How many trouble codes the truck\'s computer is holding. Anything above zero means the check-engine light is on or was on — read the codes before it becomes a breakdown.',
  },
  {
    key: 'can.dtc', aliases: ['can.dtc.codes', 'can.dtc.list', 'obd.dtc.codes', 'dtc.codes', 'faults.codes'], io: '281', label: 'Trouble codes',
    group: 'check-engine', source: 'obd', kind: 'list', families: OBD,
    explain: 'The codes themselves (P0xxx…). Look them up, or hand them to the shop.',
  },
  {
    key: 'can.mil.mileage', aliases: ['distance.mil.on', 'obd.mil.distance', 'can.mil.distance'], io: '43', label: 'Driven with the light on',
    group: 'check-engine', source: 'obd', kind: 'number', unit: 'mi', convert: kmToMi, decimals: 0, families: OBD,
    assess: (v) => { const n = num(v); if (n == null) return null; return n > 0 ? { tone: 'warn', words: `Driven ${Math.round(kmToMi(n)).toLocaleString()} mi with the check-engine light on` } : { tone: 'ok' } },
    explain: 'Miles driven since the check-engine light came on. A big number means it has been ignored for a while.',
  },
  {
    key: 'can.mil.time', aliases: ['time.mil.on', 'obd.mil.time'], io: '54', label: 'Time with the light on',
    group: 'check-engine', source: 'obd', kind: 'duration', convert: (min) => min * 60, families: OBD,
    explain: 'How long the check-engine light has been on.',
  },
  {
    key: 'can.dtc.cleared.mileage', aliases: ['distance.since.codes.cleared', 'can.clear.dtc.mileage', 'obd.dtc.cleared.distance'], io: '49', label: 'Since codes cleared',
    group: 'check-engine', source: 'obd', kind: 'number', unit: 'mi', convert: kmToMi, decimals: 0, families: OBD,
    explain: 'Miles driven since the codes were last cleared. Small numbers right after a shop visit are normal.',
  },
  {
    key: 'can.dtc.cleared.time', aliases: ['time.since.codes.cleared', 'obd.dtc.cleared.time'], io: '55', label: 'Time since codes cleared',
    group: 'check-engine', source: 'obd', kind: 'duration', convert: (min) => min * 60, families: OBD,
    explain: 'How long since the codes were last cleared.',
  },
  {
    key: 'can.mil.status', aliases: ['mil.status', 'obd.mil.status', 'can.check.engine.status'], io: '—', label: 'Check-engine light',
    group: 'check-engine', source: 'obd', kind: 'flag', flagWords: ['On', 'Off'], families: OBD,
    assess: (v) => (v === true || v === 1 ? { tone: 'bad', words: 'Check-engine light on' } : v === false || v === 0 ? { tone: 'ok' } : null),
    explain: 'Whether the check-engine light is lit right now.',
  },

  // ELECTRICAL ──────────────────────────────────────────────────────────────
  {
    key: 'external.powersource.voltage', aliases: ['external.battery.voltage', 'external.voltage', 'vehicle.battery.voltage'], io: '66', label: 'Truck battery', short: '12V',
    group: 'electrical', source: 'device', kind: 'number', unit: 'V', decimals: 1,
    gauge: { min: 8, max: 16, order: 5, bands: [{ to: 11.9, tone: 'bad' }, { to: 12.4, tone: 'warn' }, { to: 15.2, tone: 'ok' }, { to: 16, tone: 'bad' }] },
    assess: (v, ctx) => {
      const n = num(v); if (n == null) return null
      if (n < POWERED_MIN_V) return { tone: 'bad', words: 'No truck power — the plug is out or the port is dead' }
      if (ctx.engineOn) {
        if (n > 15.3) return { tone: 'bad', words: 'Overcharging — alternator or regulator' }
        if (n < 13.0) return { tone: 'warn', words: 'Running but not charging well' }
        return { tone: 'ok', words: 'Charging' }
      }
      if (n >= 12.4) return { tone: 'ok', words: 'Battery healthy' }
      if (n >= 11.9) return { tone: 'warn', words: 'Battery getting weak' }
      return { tone: 'bad', words: 'Battery low — may not start' }
    },
    explain: 'The truck\'s 12-volt battery. Engine off, 12.4 V or more is healthy and under 11.9 V may not start tomorrow. Running, the alternator should hold it around 13.5–14.8 V.',
  },
  {
    key: 'can.vehicle.battery.voltage', aliases: ['control.module.voltage', 'obd.control.module.voltage'], io: '51', label: 'Battery (per computer)',
    group: 'electrical', source: 'obd', kind: 'number', unit: 'V', decimals: 1, families: OBD,
    explain: 'The 12-volt reading the engine computer itself sees. Should track the truck battery reading.',
  },
  {
    key: 'can.vehicle.battery.level', aliases: ['hybrid.battery.level', 'obd.hybrid.battery.life'], io: '57', label: 'Hybrid / EV battery',
    group: 'electrical', source: 'obd', kind: 'number', unit: '%', decimals: 0, families: OBD,
    explain: 'High-voltage battery charge on a hybrid or electric truck.',
  },
  {
    key: 'battery.voltage', io: '67', label: 'Tracker battery', short: 'TRACKER',
    group: 'tracker', source: 'device', kind: 'number', unit: 'V', decimals: 2,
    assess: (v, ctx) => {
      const n = num(v); if (n == null) return null
      // A truck unit runs one small lithium cell (~4.1 V full); a battery unit
      // runs two big ones (~7.2 V full). Same key, different ladders.
      if (ctx.family === 'battery' || n > 5.5) return ladder(n, 6.8, 6.2, ['Battery good', 'Battery getting low', 'Battery low — replace soon'])
      return ladder(n, 3.8, 3.6, ['Backup cell charged', 'Backup cell low — has it been unplugged?', 'Backup cell nearly flat'])
    },
    explain: 'The tracker\'s own battery. On a truck unit it only matters when the plug is out; on a battery unit it is the whole power supply.',
  },
  {
    key: 'battery.level', io: '113', label: 'Tracker battery',
    group: 'tracker', source: 'device', kind: 'number', unit: '%', decimals: 0,
    assess: (v) => ladder(v, 40, 20, ['Battery good', 'Battery getting low', 'Battery low']),
    explain: 'The tracker\'s own battery as a percentage.',
  },
  {
    key: 'battery.current', io: '68', label: 'Tracker charge current',
    group: 'tracker', source: 'device', kind: 'number', unit: 'A', decimals: 2,
    explain: 'Positive means the tracker is charging from the truck.',
  },
  {
    key: 'battery.charging.status', aliases: ['charger.connected'], io: '116', label: 'Tracker charging',
    group: 'tracker', source: 'device', kind: 'flag', flagWords: ['Charging', 'Not charging'], explain: 'Whether the tracker is taking a charge from the truck.',
  },
  {
    key: 'analog.input.1', aliases: ['ain.1', 'analog.input'], io: '9', label: 'Analog input 1',
    group: 'electrical', source: 'device', kind: 'number', unit: 'V', decimals: 2, explain: 'A wired sensor voltage, if one is connected.',
  },
  { key: 'din.1', aliases: ['digital.input.1'], io: '1', label: 'Digital input 1', group: 'electrical', source: 'device', kind: 'flag', flagWords: ['On', 'Off'], explain: 'A wired switch input, if one is connected.' },
  { key: 'din.2', aliases: ['digital.input.2'], io: '2', label: 'Digital input 2', group: 'electrical', source: 'device', kind: 'flag', flagWords: ['On', 'Off'], explain: 'A wired switch input, if one is connected.' },
  { key: 'dout.1', aliases: ['digital.output.1'], io: '179', label: 'Digital output 1', group: 'electrical', source: 'device', kind: 'flag', flagWords: ['On', 'Off'], explain: 'A relay the tracker controls, if one is wired.' },

  // DISTANCE ────────────────────────────────────────────────────────────────
  {
    key: 'can.vehicle.mileage', aliases: ['obd.odometer', 'can.odometer', 'vehicle.odometer', 'obd.vehicle.mileage'], io: '389', label: 'Odometer (truck)',
    group: 'distance', source: 'obd', kind: 'number', unit: 'mi', convert: kmToMi, decimals: 0, families: OBD,
    explain: 'The truck\'s own odometer, converted from kilometers. Only some trucks give this up over the port.',
  },
  {
    key: 'vehicle.mileage', aliases: ['tracker.odometer', 'total.odometer', 'device.mileage'], io: '16', label: 'Tracker odometer',
    group: 'distance', source: 'device', kind: 'number', unit: 'mi', convert: kmToMi, decimals: 0,
    explain: 'Miles the tracker itself has counted since it was installed. Not the dash odometer.',
  },
  {
    key: 'trip.mileage', aliases: ['vehicle.mileage.trip', 'trip.odometer', 'can.trip.mileage'], io: '199', label: 'This trip',
    group: 'distance', source: 'device', kind: 'number', unit: 'mi', convert: kmToMi, decimals: 1,
    explain: 'Miles on the current trip, as the tracker counts them.',
  },
  {
    key: 'can.vehicle.speed', aliases: ['obd.speed', 'obd.vehicle.speed', 'can.speed'], io: '37', label: 'Speed (per truck)', short: 'MPH',
    group: 'distance', source: 'obd', kind: 'number', unit: 'mph', convert: kmhToMph, decimals: 0, families: OBD,
    gauge: { min: 0, max: 100, order: 2, bands: [{ to: 70, tone: 'ok' }, { to: 80, tone: 'warn' }, { to: 100, tone: 'bad' }] },
    assess: (v) => { const n = num(v); if (n == null) return null; const mph = kmhToMph(n); return mph > 80 ? { tone: 'bad', words: 'Over 80 mph' } : mph > 70 ? { tone: 'warn', words: 'Over 70 mph' } : { tone: 'ok' } },
    explain: 'Speed from the truck\'s own speedometer feed. The map dot uses GPS speed; the two should agree within a mile or two.',
  },

  // DRIVING / MOTION ────────────────────────────────────────────────────────
  {
    key: 'engine.ignition.status', aliases: ['ignition.status', 'ignition'], io: '239', label: 'Ignition',
    group: 'driving', source: 'device', kind: 'flag', flagWords: ['On', 'Off'],
    explain: 'Key on or off, as the tracker judges it from voltage, RPM and movement.',
  },
  {
    key: 'movement.status', aliases: ['movement', 'instant.movement'], io: '240', label: 'Moving',
    group: 'driving', source: 'device', kind: 'flag', flagWords: ['Moving', 'Still'],
    explain: 'Whether the tracker\'s motion sensor feels the truck moving. This is what wakes it up.',
  },
  { key: 'x.acceleration', aliases: ['axis.x', 'acceleration.x'], io: '17', label: 'Accel X', group: 'driving', source: 'device', kind: 'number', unit: 'g', decimals: 2, explain: 'Side-to-side g-force. Harsh cornering shows here.' },
  { key: 'y.acceleration', aliases: ['axis.y', 'acceleration.y'], io: '18', label: 'Accel Y', group: 'driving', source: 'device', kind: 'number', unit: 'g', decimals: 2, explain: 'Front-to-back g-force. Hard braking and hard launches show here.' },
  { key: 'z.acceleration', aliases: ['axis.z', 'acceleration.z'], io: '19', label: 'Accel Z', group: 'driving', source: 'device', kind: 'number', unit: 'g', decimals: 2, explain: 'Up-and-down g-force. Rough ground and jolts.' },
  {
    key: 'harsh.acceleration.event', aliases: ['green.driving.acceleration'], io: '253', label: 'Harsh acceleration',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['Yes', 'No'],
    assess: (v) => (v === true ? { tone: 'warn', words: 'Harsh acceleration' } : null),
    explain: 'The tracker flagged a hard launch.',
  },
  {
    key: 'harsh.braking.event', aliases: ['green.driving.braking'], io: '253', label: 'Harsh braking',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['Yes', 'No'],
    assess: (v) => (v === true ? { tone: 'warn', words: 'Harsh braking' } : null),
    explain: 'The tracker flagged a hard stop.',
  },
  {
    key: 'harsh.cornering.event', aliases: ['green.driving.cornering'], io: '253', label: 'Harsh cornering',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['Yes', 'No'],
    assess: (v) => (v === true ? { tone: 'warn', words: 'Harsh cornering' } : null),
    explain: 'The tracker flagged a hard corner.',
  },
  {
    key: 'green.driving.value', aliases: ['green.driving.type'], io: '254', label: 'Harsh driving value',
    group: 'driving', source: 'event', kind: 'number', decimals: 2, explain: 'How hard the last flagged maneuver was.',
  },
  {
    key: 'crash.event', aliases: ['crash.detection', 'crash'], io: '247', label: 'Crash detected',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['YES', 'No'],
    assess: (v) => (v === true ? { tone: 'bad', words: 'Crash detected' } : null),
    explain: 'The tracker\'s motion sensor saw an impact.',
  },
  {
    key: 'towing.event', aliases: ['towing.detection.event', 'towing', 'towing.status'], io: '246', label: 'Towing detected',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['YES', 'No'],
    assess: (v) => (v === true ? { tone: 'bad', words: 'Moving with the key off — towed or stolen?' } : null),
    explain: 'Movement with the ignition off. The theft signal.',
  },
  {
    key: 'engine.idle.status', aliases: ['idling.event', 'idling', 'idle.status'], io: '251', label: 'Idling',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['Idling', 'Not idling'],
    explain: 'Engine running, truck not moving, past the idle timer.',
  },
  {
    key: 'trip.status', aliases: ['trip.event', 'trip'], io: '250', label: 'Trip',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['Started', 'Stopped'], explain: 'Trip start or stop, as the tracker counts trips.',
  },
  {
    key: 'overspeeding.event', aliases: ['vehicle.speed.limit.exceeded', 'over.speeding', 'overspeed'], io: '255', label: 'Over speed limit',
    group: 'driving', source: 'event', kind: 'number', unit: 'mph', convert: kmhToMph, decimals: 0,
    assess: (v) => (num(v) ? { tone: 'warn', words: 'Over the configured speed limit' } : null),
    explain: 'Speed at the moment the tracker\'s own speed limit was crossed.',
  },
  {
    key: 'battery.unplug.event', aliases: ['unplug.event', 'unplug', 'unplug.status'], io: '252', label: 'Unplugged',
    group: 'driving', source: 'event', kind: 'flag', flagWords: ['YES', 'No'],
    assess: (v) => (v === true ? { tone: 'bad', words: 'Tracker unplugged' } : null),
    explain: 'The tracker says it was pulled from the port.',
  },
  { key: 'alarm.event', aliases: ['alarm'], io: '236', label: 'Alarm', group: 'driving', source: 'event', kind: 'flag', flagWords: ['YES', 'No'], explain: 'A tracker alarm fired.' },

  // TRACKER (device health) ─────────────────────────────────────────────────
  {
    key: 'sleep.mode.enum', aliases: ['sleep.mode.status', 'sleep.mode'], io: '200', label: 'Sleep mode',
    group: 'tracker', source: 'device', kind: 'enum',
    enumLabels: { '0': 'Awake', '1': 'GPS sleep', '2': 'Deep sleep', '3': 'Online deep sleep', '4': 'Ultra deep sleep' },
    explain: 'What the tracker does between reports. Asleep is normal for a parked truck; it wakes on movement or the hourly check-in.',
  },
  { key: 'gnss.sleep.mode.status', io: '—', label: 'GPS asleep', group: 'tracker', source: 'device', kind: 'flag', flagWords: ['Yes', 'No'], explain: 'The GPS receiver is powered down between reports to save the battery.' },
  {
    key: 'custom.param.25015', aliases: ['modem.uptime', 'custom.param.20015'], io: '25015', label: 'Modem uptime',
    group: 'tracker', source: 'device', kind: 'duration', families: ['battery'],
    explain: 'How long the cellular modem has been up since the tracker last woke.',
  },
  {
    key: 'custom.param.25016', aliases: ['lte.rsrp', 'gsm.signal.rsrp', 'custom.param.20016'], io: '25016', label: 'Cell signal (RSRP)',
    group: 'cellular', source: 'cell', kind: 'number', unit: 'dBm', decimals: 0,
    assess: (v) => ladder(v, -105, -115, ['Good signal', 'Fair signal', 'Weak signal — reports may lag']),
    explain: 'LTE signal power at the tracker. −80 is excellent, −100 is everyday service, under −115 the reports start to lag.',
  },
  {
    key: 'custom.param.25017', aliases: ['lte.rsrq', 'gsm.signal.rsrq', 'custom.param.20017'], io: '25017', label: 'Cell signal quality (RSRQ)',
    group: 'cellular', source: 'cell', kind: 'number', unit: 'dB', decimals: 0,
    assess: (v) => ladder(v, -15, -19, ['Clean signal', 'Noisy signal', 'Poor signal quality']),
    explain: 'LTE signal quality. −3 to −15 is everyday service on these narrow-band units; below −19 the connection is fighting interference.',
  },
  {
    key: 'gsm.signal.level', aliases: ['gsm.signal', 'signal.level'], io: '21', label: 'Cell signal',
    group: 'cellular', source: 'cell', kind: 'number', unit: '%', decimals: 0,
    assess: (v) => ladder(v, 60, 40, ['Good signal', 'Fair signal', 'Weak signal — reports may lag']),
    explain: 'Cell signal at the tracker, 0–100. Under 40 and reports may lag or buffer until the truck moves.',
  },
  { key: 'gsm.signal.dbm', io: '—', label: 'Cell signal', group: 'cellular', source: 'cell', kind: 'number', unit: 'dBm', decimals: 0, explain: 'Cell signal power.' },
  { key: 'gsm.network.type', aliases: ['network.type'], io: '237', label: 'Network', group: 'cellular', source: 'cell', kind: 'text', explain: 'Which kind of network the tracker is on (LTE-M, 2G…).' },
  {
    key: 'gsm.operator.code', aliases: ['gsm.operator', 'active.gsm.operator'], io: '241', label: 'Carrier',
    group: 'cellular', source: 'cell', kind: 'text',
    explain: 'The cell network the tracker is using right now. The SIM roams across the major carriers, so this changes with the truck\'s location.',
  },
  { key: 'gsm.mcc', io: '—', label: 'Country code', group: 'cellular', source: 'cell', kind: 'number', decimals: 0, internal: true, explain: 'Mobile country code (part of the carrier id).' },
  { key: 'gsm.mnc', io: '—', label: 'Network code', group: 'cellular', source: 'cell', kind: 'number', decimals: 0, internal: true, explain: 'Mobile network code (part of the carrier id).' },
  { key: 'gsm.cellid', aliases: ['gsm.cell.id', 'lte.cellid'], io: '205', label: 'Cell tower', group: 'cellular', source: 'cell', kind: 'number', decimals: 0, internal: true, explain: 'Which cell tower the tracker is talking to.' },
  { key: 'gsm.lac', aliases: ['gsm.area.code'], io: '206', label: 'Cell area', group: 'cellular', source: 'cell', kind: 'number', decimals: 0, internal: true, explain: 'Cell tower area code.' },
  {
    key: 'event.enum', aliases: ['event.code'], io: '—', label: 'Last event',
    group: 'events', source: 'event', kind: 'enum', enumLabels: EVENT_LABELS,
    explain: 'What made the tracker send its latest report — a scheduled check-in, movement, ignition, a tag scan…',
  },
  { key: 'event.priority.enum', io: '—', label: 'Event priority', group: 'events', source: 'event', kind: 'enum', enumLabels: { '0': 'Routine', '1': 'High', '2': 'Panic' }, internal: true, explain: 'How urgently the tracker sent the report.' },
  { key: 'device.temperature', aliases: ['battery.temperature'], io: '—', label: 'Tracker temp', group: 'tracker', source: 'device', kind: 'number', unit: '°F', convert: cToF, decimals: 0, explain: 'Temperature inside the tracker.' },
  { key: 'sd.status', io: '10', label: 'Memory card', group: 'tracker', source: 'device', kind: 'flag', flagWords: ['Present', 'Absent'], internal: true, explain: 'Whether the tracker has a memory card.' },
  { key: 'ibutton.code', aliases: ['ibutton', 'rfid', 'driver.id'], io: '78', label: 'Driver ID', group: 'driving', source: 'device', kind: 'text', explain: 'Driver key fob (iButton / RFID), if the truck uses one.' },
  { key: 'vehicle.vin', aliases: ['can.vehicle.vin', 'vin', 'obd.vin'], io: '256', label: 'VIN', group: 'distance', source: 'obd', kind: 'text', families: OBD, explain: 'The truck\'s vehicle identification number, read from its computer.' },

  // GPS ─────────────────────────────────────────────────────────────────────
  {
    key: 'position.satellites', aliases: ['gnss.satellites', 'satellites'], io: '—', label: 'Satellites',
    group: 'gps', source: 'gnss', kind: 'number', decimals: 0,
    assess: (v) => { const n = num(v); if (n == null) return null; if (n === 0) return { tone: 'off', words: 'GPS asleep or no view of the sky' }; return ladder(n, 6, 4, ['Good GPS fix', 'Weak GPS fix', 'Poor GPS fix']) },
    explain: 'How many GPS satellites the tracker can see. Six or more is a solid fix; zero usually means it is asleep or indoors.',
  },
  {
    key: 'position.hdop', aliases: ['gnss.hdop'], io: '182', label: 'GPS accuracy (HDOP)',
    group: 'gps', source: 'gnss', kind: 'number', decimals: 1,
    assess: (v) => { const n = num(v); if (n == null || n === 0) return null; return ladder(n, 2, 5, ['Sharp position', 'Rough position', 'Position may be off by a lot'], false) },
    explain: 'GPS accuracy figure — lower is better. Under 2 the dot is within a few yards; over 5 it can wander.',
  },
  { key: 'position.pdop', aliases: ['gnss.pdop'], io: '181', label: 'GPS accuracy (PDOP)', group: 'gps', source: 'gnss', kind: 'number', decimals: 1, internal: true, explain: 'Another GPS accuracy figure — lower is better.' },
  { key: 'position.valid', io: '—', label: 'GPS fix valid', group: 'gps', source: 'gnss', kind: 'flag', flagWords: ['Yes', 'No'], explain: 'Whether the last position was a real fix.' },
  { key: 'gnss.status', aliases: ['gnss.receiver.status'], io: '69', label: 'GPS on', group: 'gps', source: 'gnss', kind: 'flag', flagWords: ['On', 'Off'], explain: 'Whether the GPS receiver is powered right now.' },
  { key: 'gnss.state.enum', io: '69', label: 'GPS state', group: 'gps', source: 'gnss', kind: 'enum', enumLabels: { '0': 'Off', '1': 'Fix', '2': 'On, no fix', '3': 'Sleep' }, explain: 'Off, fixed, searching, or asleep.' },
  { key: 'gnss.jamming.state', aliases: ['gnss.jamming.status', 'jamming.event', 'gsm.jamming.status'], io: '249', label: 'Jamming', group: 'gps', source: 'event', kind: 'flag', flagWords: ['DETECTED', 'None'], assess: (v) => (v === true || v === 1 ? { tone: 'bad', words: 'Signal jamming detected' } : null), explain: 'Someone may be blocking the tracker\'s GPS or cell signal.' },
  { key: 'gnss.first.fix.duration', aliases: ['time.to.first.fix'], io: '399', label: 'Time to GPS fix', group: 'gps', source: 'gnss', kind: 'duration', internal: true, explain: 'How long the receiver took to find itself after waking.' },

  // SENSORS (BLE / wired probes) ────────────────────────────────────────────
  { key: 'ble.sensor.temperature', match: /^ble\.sensor\.temperature\.(\d+)$/, io: '25–28 / 10800+', label: 'Sensor $1 temp', group: 'sensors', source: 'ble', kind: 'number', unit: '°F', convert: cToF, decimals: 0, explain: 'Temperature from a Bluetooth sensor near the truck (a reefer box, a tank, a cab).' },
  { key: 'ble.sensor.humidity', match: /^ble\.sensor\.humidity\.(\d+)$/, io: '86+ / 10804+', label: 'Sensor $1 humidity', group: 'sensors', source: 'ble', kind: 'number', unit: '%', decimals: 0, explain: 'Humidity from a Bluetooth sensor.' },
  { key: 'ble.sensor.battery', match: /^ble\.sensor\.battery(?:\.level)?\.(\d+)$/, io: '29+ / 10824+', label: 'Sensor $1 battery', group: 'sensors', source: 'ble', kind: 'number', unit: '%', decimals: 0, explain: 'Battery in a Bluetooth sensor.' },
  { key: 'ble.sensor.magnet', match: /^ble\.sensor\.magnet(?:\.status)?\.(\d+)$/, io: '10808+', label: 'Sensor $1 door', group: 'sensors', source: 'ble', kind: 'flag', flagWords: ['Open', 'Closed'], explain: 'A magnet (door) sensor.' },
  { key: 'ble.sensor.movement', match: /^ble\.sensor\.movement(?:\.status)?\.(\d+)$/, io: '10812+', label: 'Sensor $1 movement', group: 'sensors', source: 'ble', kind: 'flag', flagWords: ['Moving', 'Still'], explain: 'A Bluetooth sensor\'s own motion flag.' },
  { key: 'dallas.temperature', match: /^(?:dallas|onewire)\.temperature\.(\d+)$/, io: '72–75', label: 'Probe $1 temp', group: 'sensors', source: 'device', kind: 'number', unit: '°F', convert: cToF, decimals: 0, explain: 'A wired temperature probe.' },

  // PLUMBING ────────────────────────────────────────────────────────────────
  { key: 'source', label: 'Data source', group: 'tracker', source: 'device', kind: 'text', internal: true, explain: 'Which pipe the report came through.' },
  { key: 'peer', label: 'Device address', group: 'tracker', source: 'device', kind: 'text', internal: true, explain: 'Network address the report came from.' },
  { key: 'server.timestamp', label: 'Received at', group: 'tracker', source: 'device', kind: 'number', internal: true, explain: 'When the server received the report.' },
  { key: 'channel.id', label: 'Channel', group: 'tracker', source: 'device', kind: 'number', internal: true, explain: 'Ingest channel id.' },
  { key: 'codec.id', label: 'Codec', group: 'tracker', source: 'device', kind: 'number', internal: true, explain: 'Teltonika codec (142 = Codec 8 Extended).' },
  { key: 'protocol.id', label: 'Protocol', group: 'tracker', source: 'device', kind: 'number', internal: true, explain: 'Protocol id.' },
  { key: '_buffered', label: 'Buffered while unassigned', group: 'tracker', source: 'device', kind: 'flag', flagWords: ['Yes', 'No'], internal: true, explain: 'This fix arrived while the tracker sat in the drawer and was pulled onto the machine later.' },
]

// Lookup by exact key, then alias, then family pattern.
const BY_KEY = new Map<string, ReadingDef>()
for (const d of TELEMETRY_CATALOG) {
  if (!d.match) BY_KEY.set(d.key, d)
  for (const a of d.aliases ?? []) if (!BY_KEY.has(a)) BY_KEY.set(a, d)
}
const FAMILIES = TELEMETRY_CATALOG.filter((d) => d.match)

export interface Resolved { def: ReadingDef; label: string }

/** The catalog entry for a reported key, with `$1` filled in for families. */
export function resolveKey(key: string): Resolved | null {
  const d = BY_KEY.get(key)
  if (d) return { def: d, label: d.label }
  for (const f of FAMILIES) {
    const m = f.match!.exec(key)
    if (m) return { def: f, label: f.label.replace('$1', m[1] ?? '') }
  }
  return null
}

/** `can.fuel.rail.pressure` → "Fuel rail pressure" for keys the catalog has never met. */
export function humanizeKey(key: string): string {
  const words = key.replace(/[._]/g, ' ').replace(/\bstatus\b/gi, '').trim().split(/\s+/).filter(Boolean)
  if (words.length > 1 && /^(position|gnss|engine|battery|external|gsm|movement|network|obd|can|custom)$/i.test(words[0])) words.shift()
  const label = words.join(' ') || key
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// ── Readings: the per-truck map ─────────────────────────────────────────────
export interface Reading {
  /** The value as the tracker sent it (metric, raw). */
  v: unknown
  /** When it was reported (ISO). */
  t: string
  /** How many reports carried it (since `since`). */
  n?: number
  /** First time we saw it (ISO). */
  since?: string
}
export type Readings = Record<string, Reading>

/** Keys that never belong in the readings map: lifted columns, arrays, bags. */
const SKIP_KEYS = new Set(['ident', 'device.id', 'device.name', 'device.type.id', 'timestamp', 'position.latitude', 'position.longitude', 'position.speed', 'position.direction', 'position.altitude', 'ble.beacons'])
const LIST_KEYS = new Set(['can.dtc', 'can.dtc.codes', 'can.dtc.list', 'obd.dtc.codes', 'dtc.codes', 'faults.codes'])

function usable(key: string, v: unknown): boolean {
  if (SKIP_KEYS.has(key)) return false
  if (v === null || v === undefined || v === '') return false
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string' || typeof v === 'boolean') return true
  if (Array.isArray(v)) return LIST_KEYS.has(key) && v.length <= 40
  return false
}

/**
 * Fold a batch of reports into ONE readings map — newest value per key,
 * count, first-seen. This is what ingest hands `telemetry_merge`, and what
 * the map panel does with the single newest fix.
 */
export function foldReadings(rows: { timestamp: string; params: Record<string, unknown> }[]): Readings {
  const out: Readings = {}
  for (const r of rows) {
    const t = r.timestamp
    for (const [k, v] of Object.entries(r.params ?? {})) {
      if (!usable(k, v)) continue
      const cur = out[k]
      if (!cur) { out[k] = { v, t, n: 1, since: t }; continue }
      cur.n = (cur.n ?? 1) + 1
      // Compare as instants: the stored map may carry "+00:00" where the
      // fresh fix carries "Z" — never let a string compare decide time.
      if (Date.parse(t) > Date.parse(cur.t)) { cur.v = v; cur.t = t }
      if (cur.since && Date.parse(t) < Date.parse(cur.since)) cur.since = t
    }
  }
  return out
}

/** One fix → readings (the panel's instant render before the API answers). */
export function readingsFromRaw(raw: unknown, timestamp: string | null | undefined): Readings {
  if (!raw || typeof raw !== 'object' || !timestamp) return {}
  return foldReadings([{ timestamp, params: raw as Record<string, unknown> }])
}

/** Overlay `fresh` (a newer fix) on `base` (the stored map): newer time wins, counts kept. */
export function mergeReadings(base: Readings, fresh: Readings): Readings {
  const out: Readings = { ...base }
  for (const [k, r] of Object.entries(fresh)) {
    const cur = out[k]
    if (!cur) { out[k] = r; continue }
    out[k] = Date.parse(r.t) > Date.parse(cur.t) ? { ...cur, v: r.v, t: r.t } : cur
  }
  return out
}

// ── Describing a reading for people ─────────────────────────────────────────
export interface Described {
  key: string
  label: string
  group: ReadingGroup
  /** Formatted for display, unit included ("194 °F", "On", "Verizon"). */
  text: string
  /** Numeric display value (converted), when the reading is a number. */
  value: number | null
  unit: string
  tone: Tone
  words: string | null
  /** True when the catalog knows this key (false = humanized guess). */
  known: boolean
  internal: boolean
  t: string
  n?: number
  since?: string
  def: ReadingDef | null
}

const fmtNum = (n: number, decimals: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

export function formatReading(def: ReadingDef | null, v: unknown): { text: string; value: number | null; unit: string } {
  if (!def) {
    if (typeof v === 'boolean') return { text: v ? 'Yes' : 'No', value: null, unit: '' }
    if (typeof v === 'number') return { text: Number.isInteger(v) ? v.toLocaleString('en-US') : String(Math.round(v * 1000) / 1000), value: v, unit: '' }
    if (Array.isArray(v)) return { text: v.map(String).join(', '), value: null, unit: '' }
    return { text: String(v), value: null, unit: '' }
  }
  switch (def.kind) {
    case 'flag': {
      const on = v === true || v === 1 || v === '1' || v === 'true'
      const [a, b] = def.flagWords ?? ['Yes', 'No']
      return { text: on ? a : b, value: on ? 1 : 0, unit: '' }
    }
    case 'enum': {
      const label = def.enumLabels?.[String(v)] ?? `${def.label} ${String(v)}`
      return { text: label, value: typeof v === 'number' ? v : null, unit: '' }
    }
    case 'text': {
      if (def.key === 'gsm.operator.code') { const c = carrierName(v); return { text: c ? c : String(v), value: null, unit: '' } }
      return { text: String(v), value: null, unit: '' }
    }
    case 'list': {
      const arr = Array.isArray(v) ? v.map(String) : String(v).split(/[,\s;]+/).filter(Boolean)
      return { text: arr.length ? arr.join(', ') : 'none', value: arr.length, unit: '' }
    }
    case 'duration': {
      const n = num(v); if (n == null) return { text: String(v), value: null, unit: '' }
      const sec = def.convert ? def.convert(n) : n
      return { text: fmtDuration(sec), value: sec, unit: '' }
    }
    default: {
      const n = num(v)
      if (n == null) return { text: String(v), value: null, unit: def.unit ?? '' }
      const d = def.convert ? def.convert(n) : n
      const decimals = def.decimals ?? (Number.isInteger(d) ? 0 : 1)
      const unit = def.unit ?? ''
      return { text: unit ? `${fmtNum(d, decimals)} ${unit}`.replace(/ (°F|°|%)$/, '$1') : fmtNum(d, decimals), value: d, unit }
    }
  }
}

export function describeReading(key: string, r: Reading, ctx: AssessCtx = {}): Described {
  const res = resolveKey(key)
  const def = res?.def ?? null
  const f = formatReading(def, r.v)
  const a = def?.assess ? def.assess(r.v, ctx) : null
  return {
    key,
    label: res?.label ?? humanizeKey(key),
    group: def?.group ?? 'tracker',
    text: f.text,
    value: f.value,
    unit: f.unit,
    tone: a?.tone ?? 'info',
    words: a?.words ?? null,
    known: !!def,
    internal: !!def?.internal,
    t: r.t,
    n: r.n,
    since: r.since,
    def,
  }
}

export const GROUP_LABELS: Record<ReadingGroup, string> = {
  engine: 'Engine', fuel: 'Fuel', 'check-engine': 'Check engine', electrical: 'Electrical', distance: 'Distance & speed',
  driving: 'Driving', tracker: 'Tracker', gps: 'GPS', cellular: 'Cell service', sensors: 'Sensors', events: 'Events',
}
export const GROUP_ORDER: ReadingGroup[] = ['check-engine', 'engine', 'fuel', 'electrical', 'distance', 'driving', 'sensors', 'tracker', 'cellular', 'gps', 'events']

/** Every reading described, grouped, plumbing last. */
export function describeAll(readings: Readings, ctx: AssessCtx = {}): Described[] {
  return Object.entries(readings)
    .map(([k, r]) => describeReading(k, r, ctx))
    .sort((a, b) => {
      if (a.internal !== b.internal) return a.internal ? 1 : -1
      const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
      if (g) return g
      return a.label.localeCompare(b.label)
    })
}

/** The context every verdict needs: is the engine running, which tracker family. */
export function assessCtx(readings: Readings, family?: DeviceFamily): AssessCtx {
  const ign = readings['engine.ignition.status']?.v
  const rpm = num(readings['can.engine.rpm']?.v ?? readings['obd.rpm']?.v)
  const volts = num(readings['external.powersource.voltage']?.v)
  const engineOn =
    typeof ign === 'boolean' ? ign
    : ign === 1 || ign === 0 ? ign === 1
    : rpm != null ? rpm > 300
    : volts != null && volts >= POWERED_MIN_V ? volts >= 13.2
    : null
  return { engineOn, family }
}

// ── The dashboard ───────────────────────────────────────────────────────────
export interface GaugeReading extends Described {
  gauge: GaugeSpec
  short: string
}

/** Gauge-worthy readings present in the map, dashboard order. */
export function pickGauges(readings: Readings, ctx: AssessCtx, limit = 6): GaugeReading[] {
  const out: GaugeReading[] = []
  const seen = new Set<string>()
  for (const [k, r] of Object.entries(readings)) {
    const res = resolveKey(k)
    const def = res?.def
    if (!def?.gauge || seen.has(def.key)) continue
    if (typeof r.v !== 'number') continue
    seen.add(def.key)
    out.push({ ...describeReading(k, r, ctx), gauge: def.gauge, short: def.short ?? def.label })
  }
  return out.sort((a, b) => a.gauge.order - b.gauge.order).slice(0, limit)
}

// ── Health: the words that matter ───────────────────────────────────────────
export interface HealthFlag { key: string; tone: Tone; text: string }

/**
 * Plain-English problems from the readings, worst first — the line under the
 * gauges, the Today card material, and what the AI is told. Verdicts older
 * than `staleMs` are dropped: yesterday's overheating is not tonight's.
 */
export function truckHealth(readings: Readings, ctx: AssessCtx, opts: { nowMs?: number; staleMs?: number } = {}): HealthFlag[] {
  const now = opts.nowMs ?? Date.now()
  const stale = opts.staleMs ?? 36 * 3_600_000
  const rank: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3, off: 4 }
  const flags: HealthFlag[] = []
  for (const [k, r] of Object.entries(readings)) {
    const res = resolveKey(k)
    if (!res?.def.assess) continue
    if (now - Date.parse(r.t) > stale) continue
    const a = res.def.assess(r.v, ctx)
    if (!a || !a.words || (a.tone !== 'bad' && a.tone !== 'warn')) continue
    // An engine-off truck's voltage verdict is the one that matters; skip the
    // "engine off" gauge words, they are state, not trouble.
    flags.push({ key: res.def.key, tone: a.tone, text: a.words })
  }
  // The check-engine pair reads better as one line.
  const codes = flags.find((f) => f.key === 'can.dtc.number')
  const mil = flags.findIndex((f) => f.key === 'can.mil.mileage')
  if (codes && mil >= 0) { codes.text = `${codes.text} · ${flags[mil].text.replace(/^Driven /, 'driven ')}`; flags.splice(mil, 1) }
  // Same tone: what ends the tracking (plug out, towed, crash, jamming) is
  // said before what ends the truck (check engine, overheating), then fuel.
  const URGENCY = ['external.powersource.voltage', 'towing.event', 'crash.event', 'gnss.jamming.state', 'battery.unplug.event', 'can.dtc.number', 'can.mil.status', 'can.engine.coolant.temperature', 'can.engine.oil.temperature', 'can.fuel.level']
  const urgency = (k: string) => { const i = URGENCY.indexOf(k); return i < 0 ? URGENCY.length : i }
  return flags.sort((a, b) => (rank[a.tone] - rank[b.tone]) || (urgency(a.key) - urgency(b.key))).slice(0, 6)
}

// ── What this truck could report but does not ───────────────────────────────
/**
 * Catalog entries a tracker of this family CAN send that never appeared in
 * the readings. For an OBD unit that is the OBD list — the honest answer to
 * "why is there no fuel gauge on the F650" is that its computer does not
 * answer for it over the port.
 */
export function notReported(readings: Readings, family: DeviceFamily): ReadingDef[] {
  const present = new Set<string>()
  for (const k of Object.keys(readings)) { const r = resolveKey(k); if (r) present.add(r.def.key) }
  return TELEMETRY_CATALOG.filter((d) =>
    !d.match && !d.internal && !present.has(d.key)
    && (family === 'obd' || family === 'wired' ? d.source === 'obd' : d.families?.includes(family) === true && d.source !== 'obd'))
}

/** Compact facts for the AI / MCP doors — numbers in display units, nulls when absent. */
export function readingsSummary(readings: Readings, family?: DeviceFamily) {
  const ctx = assessCtx(readings, family)
  const get = (k: string) => { const r = readings[k]; return r ? formatReading(resolveKey(k)?.def ?? null, r.v) : null }
  const n = (k: string) => get(k)?.value ?? null
  return {
    engineOn: ctx.engineOn,
    rpm: n('can.engine.rpm'),
    speedMphPerTruck: n('can.vehicle.speed'),
    coolantF: n('can.engine.coolant.temperature'),
    engineLoadPct: n('can.engine.load.level'),
    fuelPct: n('can.fuel.level'),
    truckBatteryV: n('external.powersource.voltage'),
    checkEngineCodes: n('can.dtc.number'),
    milesWithLightOn: n('can.mil.mileage'),
    odometerMiPerTruck: n('can.vehicle.mileage'),
    trackerOdometerMi: n('vehicle.mileage'),
    vin: typeof readings['vehicle.vin']?.v === 'string' ? (readings['vehicle.vin'].v as string) : null,
    cellSignalPct: n('gsm.signal.level'),
    carrier: get('gsm.operator.code')?.text ?? null,
    trackerBatteryV: n('battery.voltage'),
    health: truckHealth(readings, ctx).map((f) => f.text),
  }
}
