/**
 * A searched plane on the timeline (Brian, Sep 21: "when I click a plane from
 * search bar it should match trails with timeline slider selection or show
 * last known location with a popup").
 *
 * Pure: the flight log's flights inside a window become ONE timed trail, and
 * the aircraft's position at any moment of it is decided here — flying
 * (interpolated between the two fixes around that moment), parked between
 * two flights, before the first flight, after the last. The map draws the
 * answer; this file only decides it. Harness: node scripts/plane-replay-test.mjs
 * — run it after ANY change here.
 */

/** One flight as /api/plane-track?from&to serves it: five numbers a point
 *  (lon, lat, altitude m, ground speed kt, vertical speed fpm — null where
 *  the aircraft sent none) and the epoch SECOND of each point. */
export interface WindowFlight {
  id: string
  startedAt: number
  endedAt: number
  fromLabel: string | null
  toLabel: string | null
  pts: (number | null)[][]
  ts: number[]
}

export interface ReplayFlight {
  startedAt: number
  endedAt: number
  fromLabel: string | null
  toLabel: string | null
  /** Point index range [i0, i1) inside the trail. */
  i0: number
  i1: number
}

export interface ReplayTrail {
  hex: string
  /** Five numbers a point, oldest first; NaN for a value never sent (never
   *  0 — the ramp would paint a measurement nobody took). */
  flat: number[]
  /** Epoch seconds, one per point, non-decreasing. */
  ts: number[]
  flights: ReplayFlight[]
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

/**
 * Every flight inside the window, in time order, as one trail. A point with
 * no position, or one that runs backwards in time (a trace glitch), is
 * dropped — the position search below binary-searches the times and needs
 * them monotonic.
 */
export function buildReplayTrail(hex: string, flights: WindowFlight[]): ReplayTrail {
  const sorted = flights.slice().sort((a, b) => a.startedAt - b.startedAt)
  const flat: number[] = []
  const ts: number[] = []
  const out: ReplayFlight[] = []
  let lastT = -Infinity
  for (const f of sorted) {
    const i0 = ts.length
    for (let k = 0; k < f.pts.length; k++) {
      const p = f.pts[k]
      const t = f.ts[k]
      if (!p || typeof t !== 'number' || !Number.isFinite(t) || t < lastT) continue
      const lon = p[0], lat = p[1]
      if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) continue
      flat.push(lon, lat, num(p[2]), num(p[3]), num(p[4]))
      ts.push(t)
      lastT = t
    }
    if (ts.length > i0) out.push({ startedAt: f.startedAt, endedAt: f.endedAt, fromLabel: f.fromLabel, toLabel: f.toLabel, i0, i1: ts.length })
  }
  return { hex, flat, ts, flights: out }
}

/** First index whose time is AFTER x (binary search; ts non-decreasing). */
export function upperBound(ts: ArrayLike<number>, x: number): number {
  let lo = 0, hi = ts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ts[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Initial bearing from one point to another, degrees clockwise from north. */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const dλ = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(dλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

export type ReplayState = 'before' | 'flying' | 'between' | 'after'

export interface ReplayPosition {
  state: ReplayState
  lon: number
  lat: number
  altFt: number
  gsKt: number | null
  vsFpm: number | null
  /** Heading of the leg being flown, or of the last leg flown; null when the
   *  trail has one point. */
  track: number | null
  /** Index into trail.flights: the flight the moment falls in — the one just
   *  finished for 'between' / 'after', the first for 'before'. */
  flight: number
  /** Points of the trail flown by this moment — the trail is cut here. */
  cut: number
}

const finiteOr = (v: number, alt: number) => (Number.isFinite(v) ? v : Number.isFinite(alt) ? alt : NaN)
const orNull = (v: number) => (Number.isFinite(v) ? v : null)

/**
 * Where the aircraft was at `simSec`. Between two fixes of one flight the
 * position is interpolated straight across — a coverage hole inside a flight
 * is still flight (the log already cut flights at real ground stops).
 * Between two flights it is parked where the earlier one ended; before the
 * first fix it waits where the first flight begins; after the last it stays
 * where the last one landed. Null only for an empty trail.
 */
export function replayPositionAt(trail: ReplayTrail, simSec: number): ReplayPosition | null {
  const { ts, flat, flights } = trail
  const n = ts.length
  if (!n || !flights.length) return null
  const at = (i: number, state: ReplayState, flight: number, cut: number): ReplayPosition => {
    const f = flights[flight]
    // Heading from the leg INTO this fix when the flight has one, else the
    // leg out of it (its first fix).
    let track: number | null = null
    if (i > f.i0) track = bearingDeg(flat[(i - 1) * 5], flat[(i - 1) * 5 + 1], flat[i * 5], flat[i * 5 + 1])
    else if (i + 1 < f.i1) track = bearingDeg(flat[i * 5], flat[i * 5 + 1], flat[(i + 1) * 5], flat[(i + 1) * 5 + 1])
    const altM = flat[i * 5 + 2]
    return {
      state, lon: flat[i * 5], lat: flat[i * 5 + 1],
      altFt: Number.isFinite(altM) ? altM / 0.3048 : 0,
      gsKt: orNull(flat[i * 5 + 3]), vsFpm: orNull(flat[i * 5 + 4]),
      track, flight, cut,
    }
  }
  const cut = upperBound(ts, simSec)
  if (cut === 0) return at(0, 'before', 0, 0)
  if (cut >= n) return at(n - 1, 'after', flights.length - 1, n)
  // ts[i] <= simSec < ts[cut], i = cut - 1
  const i = cut - 1
  let fi = 0
  for (let k = 0; k < flights.length; k++) if (i >= flights[k].i0 && i < flights[k].i1) { fi = k; break }
  const f = flights[fi]
  // The fix is the flight's last: the next point belongs to the next flight,
  // so the aircraft is on the ground between the two.
  if (cut >= f.i1) return at(i, 'between', fi, cut)
  const t0 = ts[i], t1 = ts[cut]
  const u = t1 > t0 ? Math.min(1, Math.max(0, (simSec - t0) / (t1 - t0))) : 0
  const a = i * 5, b = cut * 5
  const lon = flat[a] + (flat[b] - flat[a]) * u
  const lat = flat[a + 1] + (flat[b + 1] - flat[a + 1]) * u
  const altM = finiteOr(flat[a + 2], flat[b + 2]) + (finiteOr(flat[b + 2], flat[a + 2]) - finiteOr(flat[a + 2], flat[b + 2])) * u
  const gs = finiteOr(flat[a + 3], flat[b + 3]) + (finiteOr(flat[b + 3], flat[a + 3]) - finiteOr(flat[a + 3], flat[b + 3])) * u
  const vs = finiteOr(flat[a + 4], flat[b + 4]) + (finiteOr(flat[b + 4], flat[a + 4]) - finiteOr(flat[a + 4], flat[b + 4])) * u
  return {
    state: 'flying', lon, lat,
    altFt: Number.isFinite(altM) ? altM / 0.3048 : 0,
    gsKt: orNull(gs), vsFpm: orNull(vs),
    track: bearingDeg(flat[a], flat[a + 1], flat[b], flat[b + 1]),
    flight: fi, cut,
  }
}

/** "40 s ago" · "12 min ago" · "3 h ago" · "2 days ago" — plain words for
 *  how long since a moment; never a future tense. */
export function agoWords(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
