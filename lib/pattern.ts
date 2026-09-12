
/**
 * Touch-and-goes and traffic-pattern work (Brian, Sep 12, a pilot describing
 * his own flight: "yesterday I went gmu to grd and did a bunch of touch and
 * gos then back to gmu … need a way to show how many touch and gos were done
 * etc. Vs categorizing as multiple flights. Would be a nice feature to show
 * traffic pattern consistency").
 *
 * Splitting that into separate flights would be wrong — it is one trip — and
 * the log already keeps it as one. What was missing is SAYING what happened
 * in the middle of it.
 *
 * WHAT A TOUCH-AND-GO LOOKS LIKE IN ADS-B, from that exact flight (N575LD at
 * Greenwood County, 11 Sep): the aircraft comes down the pattern to a few
 * hundred feet above the field, VANISHES for two or three minutes — small
 * fields have no receiver coverage at runway height — and reappears climbing
 * back to circuit altitude. The touchdown itself is almost never in the data.
 * So the detectable event is the DIP, not the wheels, and everything here is
 * built around that.
 *
 * Pure, and deliberately dependency-free — it declares its own fix shape and
 * its own distance helper rather than importing from `aircraft-log`, which
 * imports THIS. The airport lookup is injected too, so the harness drives it
 * with a stub and `./scripts/flightlog-test/run.sh` needs no data file.
 */

/** Structurally what `Fix` in aircraft-log is; kept local to avoid a cycle. */
export interface PatternFix {
  t: number
  lat: number
  lon: number
  altFt: number | null
}

/** Great-circle nautical miles. Same maths as aircraft-log's, kept local. */
function nm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3440.065
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Just enough about a field to measure a circuit against it. */
export interface Field {
  ident: string
  name: string
  lat: number
  lon: number
  elevationFt: number
}

/** Somewhere the aircraft came down to the runway and went around again. */
export interface Approach {
  /** Epoch seconds of the lowest fix in the dip. */
  at: number
  /** Lowest height above the field, feet. */
  lowestAgl: number
  /**
   * True when the aircraft climbed away afterwards — a touch-and-go, a
   * stop-and-go or a low pass. False for the one that ends the flight, which
   * is the landing.
   */
  wentAround: boolean
  /**
   * Seconds spent below the threshold and out of sight — from the lowest fix
   * to the next one clear of the field. Named for what it measures: with
   * continuous coverage this is just how long the aircraft was low.
   */
  secondsLow: number
}

/** One lap of the pattern: the climb-out, the circuit, the next approach. */
export interface Circuit {
  startedAt: number
  endedAt: number
  durationSec: number
  /** Highest point of the lap above field elevation — the pattern altitude. */
  patternAgl: number
  /** How far the downwind got from the field, nautical miles. */
  widthNm: number
  /** The lap's ground track, for drawing circuits on top of each other. */
  path: { lat: number; lon: number }[]
}

export interface PatternWork {
  field: Field
  /** Every arrival at the runway, in order. */
  approaches: Approach[]
  /** The ones the aircraft flew away from — what a pilot counts. */
  touchAndGoes: number
  circuits: Circuit[]
  /** Spread across the laps. Null until there are at least two to compare. */
  consistency: {
    patternAglMean: number
    patternAglSpread: number
    durationMeanSec: number
    durationSpreadSec: number
    widthMeanNm: number
    widthSpreadNm: number
  } | null
}

export interface PatternOpts {
  /** Below this above the field, the aircraft is arriving, not passing over. */
  lowAgl?: number
  /** …and it has to climb back through this before the next one counts. */
  clearAgl?: number
  /** Only fixes this close to the field are pattern work. */
  withinNm?: number
  /** Fewer than this and it is a visit, not pattern work worth summarising. */
  minApproaches?: number
  /**
   * Feet to subtract from every altitude before comparing it to a field.
   *
   * Trace altitudes are `alt_baro` — PRESSURE altitude against 29.92 — while
   * field elevations are true MSL. A tenth of an inch of mercury is about a
   * hundred feet, so on a 30.1 day every height above the field reads ~200 ft
   * high. The real flight this was built from bottoms out at 419 ft AGL
   * against a 500 ft threshold: 81 feet of headroom, i.e. one ordinary
   * high-pressure morning away from detecting nothing at all. The caller
   * measures the offset where the aircraft is known to be ON a field.
   */
  baroOffsetFt?: number
  /**
   * A dip also ends once the aircraft has climbed this far above its own
   * lowest point, not just above `clearAgl`. A helicopter or ultralight
   * circuit flown at 600 ft AGL never reaches 800, so every lap of it used to
   * merge into one endless dip and vanish.
   */
  climbOutFt?: number
  /**
   * A lap that strays further than this from the field is not a lap — it is
   * a departure and a return with a cross-country in between. Without it,
   * "GMU → Greenwood → GMU" reported the whole 78-minute trip as one circuit
   * with a 42 nm downwind.
   */
  lapMaxNm?: number
}

const DEFAULTS: Required<PatternOpts> = {
  // Generous on purpose: coverage dies before the wheels do, so the lowest
  // fix of a real touch-and-go is often still 300-400 ft up.
  lowAgl: 500,
  clearAgl: 800,
  withinNm: 3,
  minApproaches: 2,
  lapMaxNm: 5,
  baroOffsetFt: 0,
  climbOutFt: 300,
}

/** Evenly thin a path, always keeping its first and last point. */
function thin<T>(xs: T[], max: number): T[] {
  if (xs.length <= max || max < 2) return xs
  const out: T[] = []
  const step = (xs.length - 1) / (max - 1)
  for (let i = 0; i < max - 1; i++) out.push(xs[Math.round(i * step)])
  out.push(xs[xs.length - 1])
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
/** Population standard deviation — "how much do these laps differ". */
const spread = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

/**
 * Find the pattern work in one flight.
 *
 * `fieldAt` resolves a position to the airfield it is over (null when it is
 * over nothing) — injected so this file stays pure and testable.
 *
 * Returns one entry per field the aircraft worked, busiest first. A flight
 * that just goes A to B returns an empty array.
 */
export function findPatternWork(
  track: PatternFix[],
  fieldAt: (lat: number, lon: number) => Field | null,
  opts: PatternOpts = {},
): PatternWork[] {
  const o = { ...DEFAULTS, ...opts }
  const pts = track.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
  if (pts.length < 6) return []

  // Which field is each fix near? Resolved once per fix and reused for the
  // dip detection, the circuit split and the stats.
  const fieldOf = new Map<number, Field>()
  for (let i = 0; i < pts.length; i++) {
    const f = fieldAt(pts[i].lat, pts[i].lon)
    if (f) fieldOf.set(i, f)
  }
  if (!fieldOf.size) return []

  const aglAt = (i: number, field: Field): number | null => {
    const alt = pts[i].altFt
    // A feed-reported ground fix IS the runway.
    if (alt == null) return 0
    if (nm(pts[i].lat, pts[i].lon, field.lat, field.lon) > o.withinNm) return null
    return alt - o.baroOffsetFt - field.elevationFt
  }

  // ── Dips, with hysteresis so a wobble on final is not two arrivals ──────
  const byField = new Map<string, { field: Field; approaches: Approach[] }>()
  let low: { field: Field; bestIdx: number; bestAgl: number; fromIdx: number } | null = null

  const closeDip = (nextIdx: number | null) => {
    if (!low) return
    // The flight STARTS low over its departure field. That is a take-off, not
    // an arrival, and counting it turned every A-to-B trip into a phantom
    // touch-and-go at the airport it left from.
    if (low.fromIdx === 0) { low = null; return }
    const entry = byField.get(low.field.ident) ?? { field: low.field, approaches: [] }
    entry.approaches.push({
      at: pts[low.bestIdx].t,
      lowestAgl: Math.round(low.bestAgl),
      // No next fix means the track ends here: that is the landing.
      wentAround: nextIdx != null,
      secondsLow: nextIdx != null ? Math.round(pts[nextIdx].t - pts[low.bestIdx].t) : 0,
    })
    byField.set(low.field.ident, entry)
    low = null
  }

  for (let i = 0; i < pts.length; i++) {
    const field = fieldOf.get(i)
    const agl = field ? aglAt(i, field) : null
    if (field && agl != null && agl < o.lowAgl) {
      if (!low || low.field.ident !== field.ident) { closeDip(i); low = { field, bestIdx: i, bestAgl: agl, fromIdx: i } }
      else if (agl < low.bestAgl) { low.bestIdx = i; low.bestAgl = agl }
      continue
    }
    // Climbed clear (or left the field): that dip is over. "Clear" is
    // whichever comes first — a fixed circuit height, or 300 ft above this
    // dip's own bottom, so a low pattern still separates into laps.
    if (low && (agl == null || agl > o.clearAgl || agl > low.bestAgl + o.climbOutFt)) closeDip(i)
  }
  // A dip still open at the end of the track is the landing, not a go-around
  // — but it goes through the same door, so it cannot skip the take-off rule
  // (a fragment that starts low and never climbs was logging its DEPARTURE
  // as a landing).
  closeDip(null)

  // ── Turn the dips into laps, and the laps into a consistency read ───────
  const out: PatternWork[] = []
  for (const { field, approaches } of Array.from(byField.values())) {
    if (approaches.length < o.minApproaches) continue

    const circuits: Circuit[] = []
    for (let k = 0; k < approaches.length - 1; k++) {
      const from = approaches[k].at
      const to = approaches[k + 1].at
      const lap = pts.filter((f) => f.t >= from && f.t <= to)
      if (lap.length < 3) continue
      const widthNm = Math.max(...lap.map((f) => nm(f.lat, f.lon, field.lat, field.lon)))
      // Left the circuit: these two arrivals are separate visits, not laps.
      if (widthNm > o.lapMaxNm) continue
      const alts = lap.map((f) => (f.altFt ?? field.elevationFt) - o.baroOffsetFt - field.elevationFt)
      const patternAgl = Math.round(Math.max(...alts))
      // Nor is going away to do airwork at 3,000 ft and coming back. One
      // excursion between two landings used to drag the whole consistency
      // line with it — "1,500 ft ± 866" for a pattern flown at a rock-steady
      // 1,000.
      if (patternAgl > 2500) continue
      circuits.push({
        startedAt: from,
        endedAt: to,
        durationSec: to - from,
        patternAgl,
        widthNm: Math.round(widthNm * 100) / 100,
        // Thinned before it is ever stored: this is drawn in a 260 px box, and
        // a flight school doing ten 1 Hz laps would otherwise bank ~120 KB of
        // path per flight and drag it through every list query.
        path: thin(lap.map((f) => ({ lat: f.lat, lon: f.lon })), 64),
      })
    }

    // Drop a lap that took far longer than its siblings — the same excursion
    // seen from the clock rather than the altimeter.
    if (circuits.length >= 3) {
      const sorted = circuits.map((c) => c.durationSec).sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      for (let i = circuits.length - 1; i >= 0; i--) {
        if (circuits[i].durationSec > median * 2.5) circuits.splice(i, 1)
      }
    }

    out.push({
      field,
      approaches,
      touchAndGoes: approaches.filter((a: Approach) => a.wentAround).length,
      circuits,
      consistency: summarise(circuits),
    })
  }
  return out.sort((a, b) => b.approaches.length - a.approaches.length)
}

/** "4 touch-and-goes at Greenwood County" — the one-line version. */
export function patternSummary(p: PatternWork): string {
  const n = p.touchAndGoes
  const where = p.field.name || p.field.ident
  if (n <= 0) return `Pattern work at ${where}`
  // One approach that climbed away, with no lap after it, is a balked landing
  // or a missed approach — not pattern work, and this is somebody's logbook.
  if (n === 1 && p.circuits.length === 0) return `1 go-around at ${where}`
  return `${n} touch-and-go${n === 1 ? '' : 'es'} at ${where}`
}

/** True when this is worth showing as pattern work at all. */
export const isPatternWork = (p: PatternWork): boolean => p.touchAndGoes >= 2 || p.circuits.length > 0

/**
 * How tight the laps were, in words. Deliberately not a grade out of ten —
 * a number invites arguing with it; "within 50 ft" is just a fact.
 */
export function consistencyNote(p: PatternWork): string | null {
  const c = p.consistency
  if (!c) return null
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  return `Pattern altitude held within ${c.patternAglSpread} ft of ${c.patternAglMean.toLocaleString()} ft AGL · laps ${mm(c.durationMeanSec)} ± ${Math.round(c.durationSpreadSec)}s · downwind ${c.widthMeanNm.toFixed(1)} ± ${c.widthSpreadNm.toFixed(1)} nm`
}


/**
 * Join the pattern work of two halves of one flight.
 *
 * `stitchFlights` merges every other field of a midnight-crossing flight
 * semantically — distance re-added across the seam, altitudes maxed — but
 * pattern work was concatenated blind, so the same airfield appeared twice in
 * one flight: two rows reading "1 touch-and-go at Greenwood County" and
 * "2 touch-and-goes at Greenwood County", duplicate React keys, and a count
 * short by the approach that fell on the seam.
 *
 * 00:00 UTC is 8 PM Eastern — the exact hour a pilot flies night landings for
 * currency, so this is the normal case for night pattern work.
 */
export function mergePatternWork(a: PatternWork[], b: PatternWork[]): PatternWork[] {
  const byField = new Map<string, PatternWork>()
  for (const w of [...a, ...b]) {
    const prev = byField.get(w.field.ident)
    if (!prev) { byField.set(w.field.ident, { ...w, approaches: [...w.approaches], circuits: [...w.circuits] }); continue }
    const approaches = [...prev.approaches, ...w.approaches].sort((x, y) => x.at - y.at)
    // The last approach of the earlier half is not a landing — the flight
    // demonstrably carried on into the later half.
    for (let i = 0; i < approaches.length - 1; i++) approaches[i] = { ...approaches[i], wentAround: true }
    const circuits = [...prev.circuits, ...w.circuits].sort((x, y) => x.startedAt - y.startedAt)
    byField.set(w.field.ident, {
      ...prev,
      approaches,
      circuits,
      touchAndGoes: approaches.filter((x) => x.wentAround).length,
      consistency: summarise(circuits),
    })
  }
  return Array.from(byField.values()).sort((x, y) => y.approaches.length - x.approaches.length)
}

/** The spread across a set of laps — shared by detection and merging. */
export function summarise(circuits: Circuit[]): PatternWork['consistency'] {
  if (circuits.length < 2) return null
  const agl = circuits.map((c) => c.patternAgl)
  const dur = circuits.map((c) => c.durationSec)
  const wid = circuits.map((c) => c.widthNm)
  return {
    patternAglMean: Math.round(mean(agl)),
    patternAglSpread: Math.round(spread(agl)),
    durationMeanSec: Math.round(mean(dur)),
    durationSpreadSec: Math.round(spread(dur)),
    widthMeanNm: Math.round(mean(wid) * 100) / 100,
    widthSpreadNm: Math.round(spread(wid) * 100) / 100,
  }
}
