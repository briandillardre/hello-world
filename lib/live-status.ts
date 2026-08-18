/**
 * One place that answers "what is this asset doing RIGHT NOW" from its latest
 * fix — moving / idling / parked / no-signal — so the map popup and the asset
 * page always say the same thing. Pure + framework-free (used server + client).
 *
 * Freshness matters: a moving truck pings every few seconds, but a parked one
 * sleeps and checks in ~hourly (docs/TRACKER-DATA.md). So a 40-min-old fix at
 * 0 mph is a normal nap, not a fault — only silence past OFFLINE_MS is "no
 * signal". "Idling" needs engine-on proof (OBD voltage); without it a fresh
 * 0-mph fix is just "Stopped".
 */

export type LiveKey = 'moving' | 'idling' | 'stopped' | 'parked' | 'offline' | 'nodata'

export interface LiveStatus {
  key: LiveKey
  label: string
  detail: string
  color: string       // dot / accent hex
  live: boolean       // pulse the dot (moving or idling now)
}

const FRESH_MS = 8 * 60_000        // within this, the fix reflects "now"
const OFFLINE_MS = 6 * 3_600_000   // silence past the hourly nap = a problem
const MOVE_MPH = 2

const COLOR = {
  moving: '#34d399',
  idling: '#f5a623',
  stopped: '#2dd4bf',
  parked: '#8fa3b8',
  offline: '#64748b',
  nodata: '#64748b',
}

/** "1h 12m", "9m", "just now". */
export function shortDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export function deriveLiveStatus(opts: {
  speedMph: number | null | undefined
  lastFixMs: number | null | undefined
  /** true/false from OBD voltage; null when unknown (equipment, no OBD). */
  engineOn?: boolean | null
  /** ms of the newest fix that was actually moving (for "parked Xh ago"). */
  lastMovedMs?: number | null
  /** Asset type; tools/personnel have no engine, so "· engine off" is dropped
   *  from their labels. Omitted = machine wording (back-compat). */
  assetType?: string | null
  nowMs?: number
}): LiveStatus {
  const { speedMph, lastFixMs, engineOn = null, lastMovedMs = null, assetType = null, nowMs = Date.now() } = opts
  const hasEngine = assetType == null || assetType === 'vehicle' || assetType === 'equipment'
  const stationaryLabel = hasEngine ? 'Stationary · engine off' : 'Stationary'
  if (lastFixMs == null) {
    return { key: 'nodata', label: 'No data', detail: 'never reported', color: COLOR.nodata, live: false }
  }
  const age = nowMs - lastFixMs
  const moving = (speedMph ?? 0) >= MOVE_MPH
  const movedAgo = lastMovedMs != null ? `stopped ${shortDuration(nowMs - lastMovedMs)} ago` : `last fix ${shortDuration(age)} ago`

  if (age <= FRESH_MS) {
    if (moving) return { key: 'moving', label: `Moving ${Math.round(speedMph as number)} mph`, detail: 'live', color: COLOR.moving, live: true }
    if (engineOn === true) return { key: 'idling', label: 'Engine idle', detail: 'stationary, engine running', color: COLOR.idling, live: true }
    // fresh, stopped, engine off/unknown — just pulled up somewhere
    return engineOn === false
      ? { key: 'stopped', label: stationaryLabel, detail: movedAgo, color: COLOR.parked, live: false }
      : { key: 'stopped', label: 'Stationary', detail: movedAgo, color: COLOR.stopped, live: false }
  }
  if (age >= OFFLINE_MS) {
    return { key: 'offline', label: 'No signal', detail: `last seen ${shortDuration(age)} ago`, color: COLOR.offline, live: false }
  }
  // stale-but-normal: device asleep between hourly check-ins = parked, engine off
  return { key: 'parked', label: stationaryLabel, detail: movedAgo, color: COLOR.parked, live: false }
}
