/**
 * Turn-by-turn guidance math (Brian, Sep 12: "I want turn by turn navigation").
 *
 * Pure functions, no React and no map — the driving screen is a thin shell over
 * this file, so the part that decides "you are 400 feet from the turn, say it
 * now" can be reasoned about and tested without a phone in a truck.
 *
 * The shape of the problem: OSRM hands back a route as a polyline plus a list
 * of maneuvers. A phone hands us a fix every second or so. Guidance is three
 * questions asked of those two things —
 *   1. where am I ON the line (not near it — on it), and how far along?
 *   2. which maneuver is next, and how far to it?
 *   3. have I said that yet?
 * — plus a fourth that matters more than the rest: have I left the route?
 *
 * Everything is imperial. Crews in the Upstate do not think in metres.
 */

export interface NavStep {
  instruction: string
  distanceM: number
  name: string | null
  type: string
  modifier: string | null
  /** The maneuver point itself (lng, lat) — added to /api/route for guidance. */
  at?: [number, number] | null
  durationSec?: number
}

export type LngLat = [number, number]

/* ── geometry ───────────────────────────────────────────────────────────── */

const R = 6371000

/** Equirectangular metres — exact enough under a few hundred km, and cheap
 *  enough to run over a whole route on every GPS fix. */
export function metresBetween(a: LngLat, b: LngLat): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const x = (b[0] - a[0]) * (Math.PI / 180) * Math.cos(lat)
  const y = (b[1] - a[1]) * (Math.PI / 180)
  return Math.sqrt(x * x + y * y) * R
}

/** Compass bearing a→b, degrees clockwise from north. */
export function bearingBetween(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * (Math.PI / 180)
  const φ2 = b[1] * (Math.PI / 180)
  const Δλ = (b[0] - a[0]) * (Math.PI / 180)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360
}

/** Closest point on segment a→b to p, as a fraction t plus the point itself. */
function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { t: number; point: LngLat } {
  const lat = a[1] * (Math.PI / 180)
  const kx = Math.cos(lat)
  const ax = a[0] * kx, ay = a[1]
  const bx = b[0] * kx, by = b[1]
  const px = p[0] * kx, py = p[1]
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { t: 0, point: a }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { t, point: [(ax + t * dx) / kx, ay + t * dy] }
}

/** Metres along the line at each vertex — the spine every other answer uses. */
export function cumulativeDistances(coords: LngLat[]): number[] {
  const cum = new Array<number>(coords.length)
  cum[0] = 0
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + metresBetween(coords[i - 1], coords[i])
  return cum
}

export interface Snap {
  /** Index of the segment start vertex. */
  index: number
  /** Metres travelled along the route at the snapped point. */
  alongM: number
  /** How far the fix is FROM the route — the off-route signal. */
  offRouteM: number
  snapped: LngLat
}

/**
 * Put a fix onto the route.
 *
 * Searched forward from the last known position rather than over the whole
 * line: a long route crosses itself (a cloverleaf, an out-and-back to a pit)
 * and a global nearest-point search will happily teleport you to the return
 * leg. `window` bounds how far ahead a single fix may advance — a dropped
 * signal for a mile still catches up, a wrong answer cannot.
 */
export function snapToRoute(
  coords: LngLat[],
  cum: number[],
  pos: LngLat,
  fromIndex = 0,
  window = 400,
): Snap {
  const start = Math.max(0, fromIndex - 5)
  const end = Math.min(coords.length - 1, fromIndex + window)
  let best: Snap = { index: start, alongM: cum[start], offRouteM: Infinity, snapped: coords[start] }
  for (let i = start; i < end; i++) {
    const { t, point } = projectOnSegment(pos, coords[i], coords[i + 1])
    const d = metresBetween(pos, point)
    if (d < best.offRouteM) {
      best = {
        index: i,
        alongM: cum[i] + (cum[i + 1] - cum[i]) * t,
        offRouteM: d,
        snapped: point,
      }
    }
  }
  return best
}

/** Where each maneuver sits along the route, in metres. Steps are in order,
 *  so the search walks forward and never matches an earlier crossing. */
export function stepAnchors(steps: NavStep[], coords: LngLat[], cum: number[]): number[] {
  const out: number[] = []
  let from = 0
  for (const st of steps) {
    const at = st.at
    if (!at) { out.push(out.length ? out[out.length - 1] : 0); continue }
    let bestI = from
    let bestD = Infinity
    for (let i = from; i < coords.length; i++) {
      const d = metresBetween(at, coords[i])
      if (d < bestD) { bestD = d; bestI = i }
      // Once we are walking away from it, the nearest vertex is behind us.
      if (d > bestD + 500) break
    }
    out.push(cum[bestI])
    from = bestI
  }
  return out
}

/* ── guidance state ─────────────────────────────────────────────────────── */

/** Off the line by more than this and we start counting strikes. */
export const OFF_ROUTE_M = 45
/** Consecutive bad fixes before a re-route — one wild fix is not a wrong turn. */
export const OFF_ROUTE_STRIKES = 3
/** Inside this of the destination, the drive is over. */
export const ARRIVE_M = 35

export interface Guidance {
  /** Index into steps of the maneuver being driven toward. */
  stepIndex: number
  /** Metres from here to that maneuver. */
  toManeuverM: number
  remainingM: number
  remainingSec: number
  arrived: boolean
}

export function guidanceAt(
  steps: NavStep[],
  anchors: number[],
  totalM: number,
  totalSec: number,
  alongM: number,
): Guidance {
  let stepIndex = anchors.findIndex((a) => a > alongM + 1)
  if (stepIndex === -1) stepIndex = Math.max(0, steps.length - 1)
  const remainingM = Math.max(0, totalM - alongM)
  // Remaining time scales with remaining distance: OSRM gives one duration for
  // the whole route, and pretending to a per-step ETA we did not measure would
  // be the same lie as pretending the ETA knows about traffic.
  const remainingSec = totalM > 0 ? Math.round(totalSec * (remainingM / totalM)) : 0
  return {
    stepIndex,
    toManeuverM: Math.max(0, anchors[stepIndex] - alongM),
    remainingM,
    remainingSec,
    arrived: remainingM <= ARRIVE_M,
  }
}

/* ── words ──────────────────────────────────────────────────────────────── */

export const feet = (m: number) => Math.round((m * 3.28084) / 10) * 10
export const miles = (m: number) => m / 1609.344

/** The distance as a navigator says it out loud. */
export function sayDistance(m: number): string {
  if (m < 30) return 'now'
  if (m < 160) return `in ${feet(m)} feet`
  const mi = miles(m)
  if (mi < 0.3) return `in ${feet(m)} feet`
  if (mi < 0.4) return 'in a quarter mile'
  if (mi < 0.6) return 'in a half mile'
  if (mi < 0.85) return 'in three quarters of a mile'
  if (mi < 1.4) return 'in one mile'
  return `in ${mi < 10 ? mi.toFixed(1) : Math.round(mi)} miles`
}

/** The same distance on screen, where digits beat words. */
export function showDistance(m: number): string {
  if (m < 160) return `${Math.max(10, feet(m))} ft`
  const mi = miles(m)
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

export function showDuration(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} hr ${min % 60} min`
}

/** Clock time of arrival, in the driver's own locale. */
export function arrivalClock(remainingSec: number, now = Date.now()): string {
  return new Date(now + remainingSec * 1000)
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * The announcement ladder. Each rung fires once per step, on the way down —
 * far, near, and the call at the turn itself. Rungs already passed when a step
 * becomes current are skipped rather than fired late (you do not want "in one
 * mile, turn right" spoken 200 feet from the turn because the route just
 * re-calculated).
 */
export const RUNGS = [1600, 800, 300, 60] as const
export type Rung = (typeof RUNGS)[number]

export function rungFor(toManeuverM: number): Rung | null {
  // The TIGHTEST rung the distance still fits in: 85 metres is a "300" call,
  // not a "1600" one. RUNGS reads far→near for humans, so walk it backwards —
  // taking the first match forwards fires every step once, a mile out, and
  // never says "turn right now" at the corner (caught by scratchpad/navtest).
  for (let i = RUNGS.length - 1; i >= 0; i--) if (toManeuverM <= RUNGS[i]) return RUNGS[i]
  return null
}

/** What to say for a step at a given rung. The 60 m rung drops the distance —
 *  "turn right onto Woodruff Road" is what a person says at the corner. */
export function phraseFor(step: NavStep, rung: Rung, toManeuverM: number): string {
  // The last call of a drive is the one people remember; "in 1000 feet,
  // arrive at your destination" is not how anyone says it.
  if (step.type === 'arrive') {
    return rung === 60 ? 'You have arrived.' : `Your destination is ${sayDistance(toManeuverM)}`
  }
  const what = step.instruction
  if (rung === 60) return what
  return `${sayDistance(toManeuverM)}, ${what.charAt(0).toLowerCase()}${what.slice(1)}`
}
