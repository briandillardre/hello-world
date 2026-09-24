/**
 * "Rode with" vs "seen by" — what a pairing episode actually was.
 *
 * A pairing episode (pairing_log, migration 021) opens the first time a
 * gateway — a truck's OBD box, a battery unit, a crew phone — hears a tool's
 * Bluetooth tag, and stays open while it keeps hearing it. That is all it
 * says: the two were NEAR each other. A roller parked beside the dump truck
 * in the yard for a day and a half, and a truck driving past it at 6 AM,
 * both came out as "rode with" (Brian, Sep 24, of the 85A roller: every row
 * on its page said "rode with", and none of them went anywhere). His rule:
 * "Rode with should require it to be moving like more than a half mile with
 * a hub."
 *
 * So the episode is measured by the CARRIER's own track between the first
 * and the last time it heard the tag: the distance it covered while moving.
 *   • ≥ ½ mile → rode with (the tag travelled with it)
 *   • less     → seen by   (the gateway heard it nearby; it went nowhere)
 * The window ends at the LAST sighting, never later: a truck that drives off
 * without the tag stops hearing it within a few hundred feet, so its drive
 * away is never counted as a ride.
 *
 * Parked GPS wander must never add up to a ride — a truck sitting in the
 * yard for 36 h sent 5,148 fixes that jitter a few metres each, and their
 * straight sum would be most of a mile. A step counts only when the carrier
 * says it is moving (speed ≥ 3 mph; the Teltonika boxes report 0 when
 * parked). A gateway that reports no speed at all (some phones) is thinned
 * to steps at least a minute apart that imply ≥ 5 mph — a walk across a site
 * or a bad fix bouncing around does not.
 *
 * Pure module: the asset page, the map's custody card, the custody API and
 * the AI's find_tool all read episodes through it. Harness:
 * `node scripts/pairing-ride-test.mjs` — run it after ANY change here.
 */

export interface CarrierFix {
  lat: number
  lng: number
  /** mph as stored in asset_locations; null when the gateway sends none. */
  speed: number | null
  timestamp: string
}

export type RideKind = 'rode' | 'seen'

const MILE_M = 1609.344
/** Brian's threshold: half a mile with the hub. */
export const RIDE_MIN_M = 0.5 * MILE_M
/** A reported speed above this (whole mph) is the carrier moving. */
export const MOVING_MPH = 2
/** No-speed gateways: a thinned step must span this long… */
const THIN_MS = 60_000
/** …and imply at least this speed to count as driving. */
const THIN_MIN_MPH = 5
/** An episode shorter than this is a single passing sighting — nothing to
 *  measure (at highway speed a truck covers half a mile in ~30 s, but one
 *  sighting says nothing about where the tag went). */
export const INSTANT_MS = 30_000

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const moving = (s: number | null) => typeof s === 'number' && Number.isFinite(s) && s > MOVING_MPH
const valid = (f: CarrierFix) =>
  Number.isFinite(f.lat) && Number.isFinite(f.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 &&
  !(f.lat === 0 && f.lng === 0) && Number.isFinite(Date.parse(f.timestamp))

/**
 * Metres the carrier covered WHILE MOVING across these fixes (any order —
 * they are sorted here). Parked fixes never add distance; a stop in the
 * middle of a drive costs nothing either, because the anchor carries across
 * it and the next moving fix measures from where the truck actually stood.
 */
export function movingPathM(fixes: CarrierFix[]): number {
  const pts = fixes.filter(valid).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  let total = 0
  let anchor: CarrierFix | null = null
  for (const f of pts) {
    if (!anchor) { anchor = f; continue }
    if (moving(f.speed) || moving(anchor.speed)) {
      // The gateway itself says it is driving (either end of the step).
      total += metres(anchor, f)
      anchor = f
    } else if (f.speed != null && anchor.speed != null) {
      // Both ends report parked: wander, never distance. Re-anchor so the
      // next drive measures from the latest parked spot.
      anchor = f
    } else {
      // A gateway without a speed: thin to steps ≥ 1 min and keep only the
      // ones that imply driving.
      const dt = Date.parse(f.timestamp) - Date.parse(anchor.timestamp)
      if (dt < THIN_MS) continue
      const d = metres(anchor, f)
      const mph = (d / MILE_M) / (dt / 3_600_000)
      if (mph >= THIN_MIN_MPH) total += d
      anchor = f
    }
  }
  return total
}

export function rideKind(movedM: number): RideKind {
  return movedM >= RIDE_MIN_M ? 'rode' : 'seen'
}

/** "0.6 mi", "8.8 mi", "22 mi" — "22+ mi" when the read was capped. */
export function rideMiles(movedM: number, capped = false): string {
  const mi = movedM / MILE_M
  const n = mi >= 10 ? String(Math.round(mi)) : (Math.round(mi * 10) / 10).toFixed(1)
  return `${n}${capped ? '+' : ''} mi`
}

/** The window a ride is measured over: first to LAST sighting. A closed
 *  episode's ended_at is its last sighting already (the arbitration writes
 *  ended_at = last_seen); an open one ends at last_seen until heard again. */
export function rideWindow(ep: { started_at: string; last_seen: string | null; ended_at: string | null }): { from: string; to: string; instant: boolean } {
  const to = ep.last_seen ?? ep.ended_at ?? ep.started_at
  const span = Date.parse(to) - Date.parse(ep.started_at)
  return { from: ep.started_at, to, instant: !(span >= INSTANT_MS) }
}

/** The words for each side of an episode, from the page being read. */
export function rideVerb(kind: RideKind, side: 'tool' | 'carrier'): string {
  if (side === 'tool') return kind === 'rode' ? 'rode with' : 'seen by'
  return kind === 'rode' ? 'carried' : 'saw'
}
