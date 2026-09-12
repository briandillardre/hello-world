
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
  /** Seconds of missing data across the touchdown, if any. */
  gapSec: number
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
    return alt - field.elevationFt
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
    const gapSec = nextIdx != null ? pts[nextIdx].t - pts[low.bestIdx].t : 0
    entry.approaches.push({
      at: pts[low.bestIdx].t,
      lowestAgl: Math.round(low.bestAgl),
      // Filled in below, once we know whether the flight continued.
      wentAround: nextIdx != null,
      gapSec: Math.round(gapSec),
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
    // Climbed clear (or left the field): that dip is over.
    if (low && (agl == null || agl > o.clearAgl)) closeDip(i)
  }
  // A dip still open at the end of the track is the landing, not a go-around.
  if (low) {
    const entry = byField.get(low.field.ident) ?? { field: low.field, approaches: [] }
    entry.approaches.push({ at: pts[low.bestIdx].t, lowestAgl: Math.round(low.bestAgl), wentAround: false, gapSec: 0 })
    byField.set(low.field.ident, entry)
    low = null
  }

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
      const alts = lap.map((f) => (f.altFt ?? field.elevationFt) - field.elevationFt)
      circuits.push({
        startedAt: from,
        endedAt: to,
        durationSec: to - from,
        patternAgl: Math.round(Math.max(...alts)),
        widthNm: Math.round(widthNm * 100) / 100,
        path: lap.map((f) => ({ lat: f.lat, lon: f.lon })),
      })
    }

    const aglList = circuits.map((c) => c.patternAgl)
    const durList = circuits.map((c) => c.durationSec)
    const widthList = circuits.map((c) => c.widthNm)
    out.push({
      field,
      approaches,
      touchAndGoes: approaches.filter((a: Approach) => a.wentAround).length,
      circuits,
      consistency: circuits.length >= 2 ? {
        patternAglMean: Math.round(mean(aglList)),
        patternAglSpread: Math.round(spread(aglList)),
        durationMeanSec: Math.round(mean(durList)),
        durationSpreadSec: Math.round(spread(durList)),
        widthMeanNm: Math.round(mean(widthList) * 100) / 100,
        widthSpreadNm: Math.round(spread(widthList) * 100) / 100,
      } : null,
    })
  }
  return out.sort((a, b) => b.approaches.length - a.approaches.length)
}

/** "4 touch-and-goes at Greenwood County" — the one-line version. */
export function patternSummary(p: PatternWork): string {
  const n = p.touchAndGoes
  const where = p.field.name || p.field.ident
  if (n <= 0) return `Pattern work at ${where}`
  return `${n} touch-and-go${n === 1 ? '' : 'es'} at ${where}`
}

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
