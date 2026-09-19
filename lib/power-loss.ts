/**
 * Lost truck power — the alert that fires when an OBD unit's plug comes out.
 *
 * Brian, Sep 18: Truck 4 sat on the map as "No signal · 26h" with "Battery
 * 41%" and "52 mph" beside it and nothing that said WHY. The unit had told
 * us: at 5:31 PM its external voltage fell from 13.4 V to 1.7 V while the
 * truck was doing 16 mph — the plug had come out of the OBD port — and it ran
 * 24 minutes on its own little battery before going dark. The Charleston RAM
 * had done the same thing three times that week. The map showed nothing
 * until the 48-hour dead-gray rule.
 *
 * The signal is the voltage the tracker reads on its power pin
 * (`external.powersource.voltage`). A 12 V system reads 12–14.5 V and never
 * drops under ~9 V even while cranking, so anything under POWERED_MIN_V is
 * "no truck power": the plug is out, or the port has no power (a blown fuse,
 * or a truck whose port is wired to switched power). A unit that has never
 * shown truck power — a battery TAT141 — has no transition and never alerts.
 *
 * Debounced, not edge-triggered: the Charleston RAM's loose plug flickered
 * 7 V → 4 V → 13.7 V inside one minute at 43 mph. A page for every flicker is
 * exactly the spam this exists to replace, so the battery state has to hold
 * for PERSIST_MS of DEVICE time before it fires. Power coming back clears the
 * open alert by itself — nobody should have to acknowledge a problem that
 * fixed itself — and is never pushed.
 *
 * Pure: no imports, so `node scripts/power-loss-test.mjs` can drive it.
 * The database half is lib/power-loss-check.ts.
 */

/** Under this many volts on the power pin, the truck is not feeding the unit. */
export const POWERED_MIN_V = 6
/** How long "no truck power" has to hold (device time) before it is a fact. */
export const PERSIST_MS = 60_000
export const PLUG_HINT = 'The OBD plug is out or the port has no power.'
/** Asset names are free text with no cap in the schema; a push body is not
 *  the place to find out somebody pasted a paragraph (sec-check). */
export const NAME_MAX = 60
export function shortName(name: string | null | undefined): string {
  const s = (name ?? '').trim()
  if (!s) return 'Tracker'
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX - 1).trimEnd() + '…' : s
}

export interface PowerFix {
  /** ISO device time of the fix. */
  timestamp: string
  /** Volts on the power pin; null when the fix carried no reading. */
  volts: number | null
  speed?: number | null
}

export type PowerState = 'powered' | 'battery'

export interface PowerVerdict {
  /** State at the newest fix that carried a voltage; null when none did. */
  state: PowerState | null
  /** 'lost' = on battery for PERSIST_MS after being powered; 'restored' =
   *  powered again after a battery run. Null when nothing changed inside the
   *  window, or the change is too fresh to call. */
  change: 'lost' | 'restored' | null
  /** Device time the current state began — the first fix of the run. Null
   *  when the window never reaches the other state (always-battery unit, or
   *  a change older than the window). */
  since: string | null
  /** The first fix of the current run (its speed says moving vs parked). */
  at: PowerFix | null
  newest: PowerFix | null
}

/** Volts on the tracker's power pin from a fix's raw telemetry. Devices that
 *  report millivolts are normalised; a missing or negative value is null. */
export function externalVolts(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const v = (raw as Record<string, unknown>)['external.powersource.voltage']
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return v > 1000 ? v / 1000 : v
}

export function powerState(volts: number | null | undefined): PowerState | null {
  if (volts == null || !Number.isFinite(volts)) return null
  return volts >= POWERED_MIN_V ? 'powered' : 'battery'
}

/**
 * Read the recent fixes (any order, any mix of with/without voltage) and say
 * what the truck power is doing. Fixes without a voltage — beacon events,
 * bare position records — are ignored rather than read as 0 V.
 */
export function assessPower(fixes: PowerFix[]): PowerVerdict {
  const withV = fixes
    .filter((f) => powerState(f.volts) != null && Number.isFinite(Date.parse(f.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (!withV.length) return { state: null, change: null, since: null, at: null, newest: null }

  const newest = withV[withV.length - 1]
  const state = powerState(newest.volts) as PowerState
  let i = withV.length - 1
  while (i > 0 && powerState(withV[i - 1].volts) === state) i--
  // The run reaches the start of the window: either this unit has only ever
  // been in this state (a battery unit) or the change is older than what we
  // were given. Either way there is no moment to name.
  if (i === 0) return { state, change: null, since: null, at: null, newest }

  const at = withV[i]
  if (state === 'battery') {
    const held = Date.parse(newest.timestamp) - Date.parse(at.timestamp)
    return { state, change: held >= PERSIST_MS ? 'lost' : null, since: at.timestamp, at, newest }
  }
  return { state, change: 'restored', since: at.timestamp, at, newest }
}

/** "5:31 PM", or "Thu 5:31 PM" once the moment is most of a day old. */
export function clockLabel(ms: number, tz: string, nowMs = Date.now()): string {
  // A stored or replayed stamp that does not parse must not throw out of
  // the cron that reads it every hour (sec-check).
  if (!Number.isFinite(ms)) return 'an unknown time'
  const opts: Intl.DateTimeFormatOptions = { timeZone: tz, hour: 'numeric', minute: '2-digit' }
  if (nowMs - ms > 20 * 3_600_000) opts.weekday = 'short'
  try {
    return new Intl.DateTimeFormat('en-US', opts).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

const movingOrParked = (speedMph: number | null | undefined) =>
  speedMph != null && speedMph >= 3 ? `while moving (${Math.round(speedMph)} mph)` : 'while parked'

/** The push / alert line for a fresh loss. */
export function powerLostReason(
  assetName: string,
  sinceIso: string,
  speedMph: number | null | undefined,
  tz: string,
  nowMs = Date.now(),
): string {
  const when = clockLabel(Date.parse(sinceIso), tz, nowMs)
  return `${shortName(assetName)} lost truck power at ${when} ${movingOrParked(speedMph)} — it is running on its own battery and will go dark within the hour. ${PLUG_HINT}`
}

/**
 * Why a hardware tracker is silent, in one sentence, from what it said last.
 * Used by the health cron so the founder's push carries the diagnosis instead
 * of a checklist ("check power/SIM").
 */
export function silenceDiagnosis(input: {
  lastFixIso: string
  lastVolts: number | null
  lastSpeed: number | null | undefined
  /** Internal battery percent at the last fix, when the unit reports one. */
  battery: number | null | undefined
  /** The `power_lost` alert that preceded the silence, if any. */
  powerLostAtIso: string | null
  tz: string
  nowMs?: number
}): string {
  const now = input.nowMs ?? Date.now()
  const last = clockLabel(Date.parse(input.lastFixIso), input.tz, now)
  const state = powerState(input.lastVolts)
  // What the unit said LAST outranks an older event: a truck that had power
  // at its last fix did not die of the plug, whatever happened yesterday
  // (ship-check P2-2).
  if (state === 'powered') {
    return `Had truck power at its last fix (${last}, ${movingOrParked(input.lastSpeed).replace(/^while /, '')}) and has not checked in since — no coverage where it sits, or the SIM. flespi shows the device's last message.`
  }
  if (input.powerLostAtIso) {
    const lost = clockLabel(Date.parse(input.powerLostAtIso), input.tz, now)
    return `Lost truck power at ${lost} and ran its own battery down — last heard ${last}. ${PLUG_HINT}`
  }
  if (state === 'battery') {
    return `Was already on its own battery at its last fix (${last}) — truck power was gone. ${PLUG_HINT}`
  }
  const pct = input.battery != null ? `, ${Math.round(input.battery)}% at its last fix` : ''
  return `Battery unit${pct} (last heard ${last}) — asleep or out of coverage; check the SIM in KORE One.`
}
