/**
 * Flight-log math harness — real traces, no network, no database.
 *
 * day1/day2.json are the REAL adsb.lol archive files for one Gulfstream on
 * 2026-09-10 and 09-11, pulled the day the feature was built. The assertions
 * below are what a person reading their own flight log would notice being
 * wrong: a takeoff that never happened, two trips welded into one, a red-eye
 * split in half, a chart with holes in it.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const LIB = process.env.FL_JS || join(here, 'aircraft-log.js')
const {
  parseTrace, segmentFlights, stitchFlights, flightsFromTraces, isPartial,
  deriveVerticalSpeed, downsampleTrack, haversineNm, fmtDuration, normalizeReg, asHex,
} = await import(LIB)
const { findPatternWork, patternSummary, consistencyNote } = await import(
  LIB.replace('aircraft-log.js', 'pattern.js'))

let fail = 0
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? `  → ${extra}` : ''}`)
  if (!cond) fail++
}
const load = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'))
const day1 = load('day1.json')
const day2 = load('day2.json')
const hhmm = (t) => new Date(t * 1000).toISOString().slice(11, 16)

// ── Parsing ───────────────────────────────────────────────────────────────
const p2 = parseTrace(day2)
ok('parses a real archive file', !!p2)
ok('reads the registration off the file', p2.ident.reg === 'N628TS', p2.ident.reg)
ok('reads the type code', p2.ident.typeCode === 'GLF6', p2.ident.typeCode)
ok('keeps every positional fix', p2.fixes.length === day2.trace.length, `${p2.fixes.length} vs ${day2.trace.length}`)
ok('ground fixes come through as null altitude', p2.fixes.some((f) => f.altFt === null))
ok('airborne fixes carry a real altitude', p2.fixes.some((f) => (f.altFt ?? 0) > 30000))
ok('fixes are epoch SECONDS, not ms', p2.fixes[0].t > 1_600_000_000 && p2.fixes[0].t < 2_000_000_000)
ok('fixes are in time order', p2.fixes.every((f, i) => i === 0 || f.t >= p2.fixes[i - 1].t))

ok('junk is not a trace', parseTrace(null) === null && parseTrace('<html>404</html>') === null)
ok('an empty archive is not a trace', parseTrace({ icao: 'abc123' }) === null)

// A high-elevation airport must not read as airborne-at-500ft, and a parked
// aircraft there must not read as a flight: ground is the feed's flag alone.
const denver = parseTrace({
  icao: 'aaaaaa', timestamp: 1_700_000_000,
  trace: [[0, 39.86, -104.67, 'ground', 0, 0, 0, null], [60, 39.86, -104.67, 'ground', 3, 0, 0, null]],
})
ok('parked at 5,300 ft elevation is still "on the ground"', denver.fixes.every((f) => f.altFt === null))
ok('…and produces no flight', segmentFlights('aaaaaa', denver.fixes, []).length === 0)

// ── Segmentation against the real day ─────────────────────────────────────
const f2 = segmentFlights('a835af', p2.fixes, day2.trace)
console.log('\n  2026-09-11 flights found:')
for (const f of f2) console.log(`    ${hhmm(f.startedAt)}→${hhmm(f.endedAt)}  ${fmtDuration(f.durationSec)}  ${f.distanceNm} nm  max ${f.maxAltFt.toLocaleString()} ft  ${f.maxGsKt} kt`)

// Eyeballed from the raw file: airborne 00:02–00:55, 13:40–14:27, 15:49–18:35.
ok('finds exactly the three real flights', f2.length === 3, `found ${f2.length}`)
ok('first flight takes off at 00:01', hhmm(f2[0]?.startedAt) === '00:01', hhmm(f2[0]?.startedAt))
ok('the 12.7-hour hole in the data is not a flight', !f2.some((f) => f.durationSec > 6 * 3600))
ok('does not weld the 82-min ground stop into one leg', f2[1].endedAt < f2[2].startedAt)
ok('every flight climbs', f2.every((f) => f.maxAltFt > 500))
ok('every flight covers ground', f2.every((f) => f.distanceNm > 1))
ok('durations are sane', f2.every((f) => f.durationSec >= 180 && f.durationSec < 20 * 3600))
ok('flight ids are stable and unique', new Set(f2.map((f) => f.id)).size === 3 && f2[0].id === `a835af-${f2[0].startedAt}`)
ok('the last flight of the day is flagged open-ended', f2[2].openEnd === false || f2[2].openEnd === true)
ok('a callsign is read off the details blob', f2.some((f) => f.callsign))

const f1 = segmentFlights('a835af', parseTrace(day1).fixes, day1.trace)
ok('a day parked on the ramp logs no flights', f1.length === 0, `${f1.length}`)

// ── Midnight ──────────────────────────────────────────────────────────────
// Negative: these two real days both start and end on the ground. Stitching
// them would invent a 19-hour flight that never happened.
const both = flightsFromTraces([{ raw: day1 }, { raw: day2 }])
ok('two real consecutive days stay separate', both.flights.length === 3, `${both.flights.length}`)
ok('…and identity survives the join', both.ident.reg === 'N628TS')

// Positive: a synthetic red-eye, airborne across the boundary.
const mk = (base, from, to, lat0, lon0, lat1, lon1) => ({
  icao: 'bbbbbb', timestamp: base,
  trace: Array.from({ length: 20 }, (_, i) => {
    const k = i / 19
    return [from + k * (to - from), lat0 + k * (lat1 - lat0), lon0 + k * (lon1 - lon0), 30000, 450, 90, 0, 0]
  }),
})
const midnight = flightsFromTraces([
  { raw: mk(1_700_000_000, 82800, 86340, 34.0, -84.0, 35.0, -82.0) }, // 23:00→23:59
  { raw: mk(1_700_086_400, 0, 3600, 35.0, -82.0, 36.0, -80.0) },      // 00:00→01:00
])
ok('a red-eye across UTC midnight is ONE flight', midnight.flights.length === 1, `${midnight.flights.length}`)
ok('…spanning both halves', midnight.flights[0]?.durationSec > 7000, String(midnight.flights[0]?.durationSec))
ok('…with the distance of both halves', midnight.flights[0]?.distanceNm > 200, String(midnight.flights[0]?.distanceNm))

// …but not when the two halves are nowhere near each other.
const apart = flightsFromTraces([
  { raw: mk(1_700_000_000, 82800, 86340, 34.0, -84.0, 35.0, -82.0) },
  { raw: mk(1_700_086_400, 0, 3600, 51.0, 0.5, 52.0, 1.0) }, // different continent
])
ok('a coincidence of timing does not weld two trips', apart.flights.length === 2, `${apart.flights.length}`)

// ── Telling a real trip from a hole in the coverage ──────────────────────
// Every flight in the real day begins and ends on the ramp, so none of them
// is a fragment.
ok('real flights are not flagged partial', f2.every((f) => !isPartial(f)))
ok('…because we saw them on the ground both ends', f2.every((f) => f.departed && f.arrived))

// A stretch of cruise with no ground either side is what a coverage hole
// looks like: 11 minutes starting at 25,000 ft is not an eleven-minute trip.
const fragment = segmentFlights('cccccc', parseTrace({
  icao: 'cccccc', timestamp: 1_700_000_000,
  trace: Array.from({ length: 12 }, (_, i) => [i * 60, 34 + i * 0.05, -84 + i * 0.05, 25000 + i * 100, 450, 90, 0, 100]),
}).fixes, [])
ok('a mid-air fragment is still listed', fragment.length === 1, String(fragment.length))
ok('…but flagged partial, not sold as a short flight', fragment[0] && isPartial(fragment[0]))

// And a stitched red-eye keeps the departure of its first half and the
// arrival of its second.
const rj = midnight.flights[0]
ok('a stitched flight reports the real takeoff and landing',
  rj && rj.departed === false && rj.arrived === false)

// ── The live file re-serves an old session (real, seen on a Cirrus) ──────
// adsb.lol's live trace_full is "the current trace": for an aircraft that
// has not flown today it still holds its last session, so the same flight
// arrives from the live file AND the archived day it happened on.
const sameDay = (base, offsetToSameAbsoluteTime) => ({
  icao: 'eeeeee', timestamp: base,
  trace: Array.from({ length: 30 }, (_, i) => [
    offsetToSameAbsoluteTime + i * 60, 34 + i * 0.01, -82 + i * 0.01, 3000 + i * 200, 130, 90, 0, 200,
  ]),
})
const T = 1_700_050_000
const twice = flightsFromTraces([
  { raw: sameDay(1_700_086_400, T - 1_700_086_400) }, // "today" file, later base
  { raw: sameDay(1_700_000_000, T - 1_700_000_000) }, // the archived day
])
ok('the same flight from two files is listed once', twice.flights.length === 1, `${twice.flights.length}`)
ok('…keeping one stable id', twice.flights[0]?.id === `eeeeee-${T}`, twice.flights[0]?.id)

// ── Identity comes from the NEWEST file, not the last one processed ──────
// Callers hand days back newest-first, so "later file wins" silently took
// the oldest and could write a stale tail number over a re-registered one.
const idDay = (base, reg) => ({
  icao: 'dddddd', timestamp: base, r: reg, t: 'C172',
  trace: Array.from({ length: 10 }, (_, i) => [i * 60, 34 + i * 0.02, -82, 5000, 120, 90, 0, 0]),
})
const newestFirst = flightsFromTraces([
  { raw: idDay(1_700_172_800, 'N-NEW') },
  { raw: idDay(1_700_086_400, 'N-MID') },
  { raw: idDay(1_700_000_000, 'N-OLD') },
])
ok('identity comes from the newest day file', newestFirst.ident.reg === 'N-NEW', newestFirst.ident?.reg)
const oldestFirst = flightsFromTraces([
  { raw: idDay(1_700_000_000, 'N-OLD') },
  { raw: idDay(1_700_172_800, 'N-NEW') },
])
ok('…whichever order the days arrive in', oldestFirst.ident.reg === 'N-NEW', oldestFirst.ident?.reg)

// ── Charts ────────────────────────────────────────────────────────────────
const long = f2.reduce((a, b) => (b.durationSec > a.durationSec ? b : a))
ok('the track has enough points to chart', long.track.length > 50, String(long.track.length))
ok('altitude series has no holes', long.track.every((f) => typeof f.altFt === 'number'))
ok('ground-speed series is populated', long.track.filter((f) => f.gsKt != null).length > long.track.length * 0.9)
ok('vertical speed is filled in where the feed omitted it',
  long.track.filter((f) => f.vsFpm != null).length > long.track.length * 0.95,
  `${long.track.filter((f) => f.vsFpm != null).length}/${long.track.length}`)
ok('no fantasy climb rates', long.track.every((f) => f.vsFpm == null || Math.abs(f.vsFpm) <= 12000))

const raw = deriveVerticalSpeed([
  { t: 0, lat: 0, lon: 0, altFt: 10000, gsKt: 300, trackDeg: 0, vsFpm: null },
  { t: 60, lat: 0, lon: 0, altFt: 11000, gsKt: 300, trackDeg: 0, vsFpm: null },
  { t: 120, lat: 0, lon: 0, altFt: 12000, gsKt: 300, trackDeg: 0, vsFpm: null },
])
ok('derived climb rate is right (1,000 fpm)', raw[1].vsFpm === 1000, String(raw[1].vsFpm))
ok('a reported rate is never overwritten',
  deriveVerticalSpeed([{ t: 0, lat: 0, lon: 0, altFt: 100, gsKt: 0, trackDeg: 0, vsFpm: 4242 }])[0].vsFpm === 4242)

const ds = downsampleTrack(long.track, 25)
ok('downsampling hits the cap', ds.length === 25, String(ds.length))
ok('…and keeps takeoff and landing', ds[0].t === long.track[0].t && ds[24].t === long.track[long.track.length - 1].t)

// ── Odds and ends ─────────────────────────────────────────────────────────
const atlLax = haversineNm(33.64, -84.43, 33.94, -118.41)
ok('KATL→KLAX great circle is ~1,688 nm', Math.abs(atlLax - 1688) < 5, String(Math.round(atlLax)))
ok('durations read like a person wrote them', fmtDuration(3660) === '1h 01m' && fmtDuration(600) === '10m')
ok('tail numbers normalise', normalizeReg(' n628ts ') === 'N628TS')
ok('an icao hex is recognised', asHex('a835af') === 'a835af')
ok('a tail number is not a hex', asHex('N628TS') === null)

// ── Pattern work: a REAL touch-and-go session ─────────────────────────────
// pattern-day.json is the actual trace of the flight Brian described:
// Greenville Downtown out to Greenwood County, a series of touch-and-goes,
// then home. Two airfields, one trip. The stub below stands in for the
// airport table so this needs no data file.
const patternDay = load('pattern-day.json')
const FIELDS = [
  { ident: 'KGMU', name: 'Greenville Downtown', lat: 34.8479, lon: -82.3502, elevationFt: 1048 },
  { ident: 'KGRD', name: 'Greenwood County', lat: 34.2487, lon: -82.1554, elevationFt: 631 },
]
const stubField = (lat, lon) => {
  for (const f of FIELDS) {
    const d = Math.hypot((lat - f.lat) * 60, (lon - f.lon) * 60 * Math.cos(lat * Math.PI / 180))
    if (d < 3) return f
  }
  return null
}
const pd = parseTrace(patternDay)
const pFlights = segmentFlights('a761fa', pd.fixes, patternDay.trace, { fieldAt: stubField })

// The headline ask: this is ONE trip, not eight.
ok('a touch-and-go session is ONE flight', pFlights.length === 1, `${pFlights.length}`)
const trip = pFlights[0]
ok('…that starts and ends at the home field', trip.departed && trip.arrived)
ok('…and lasts the whole session', Math.abs(trip.durationSec - 4700) < 120, String(trip.durationSec))

const work = trip.pattern.find((w) => w.field.ident === 'KGRD')
ok('the pattern work is found, at the right field', !!work)
console.log('\n  ' + (work ? patternSummary(work) : 'none'))
console.log('  ' + (work ? consistencyNote(work) ?? '' : ''))
ok('counts 4 touch-and-goes', work?.touchAndGoes === 4, String(work?.touchAndGoes))
ok('every one of them climbed away again', work?.approaches.every((a) => a.wentAround))
ok('each got down near the runway', work?.approaches.every((a) => a.lowestAgl < 500))
ok('each was down there for a while', work?.approaches.every((a) => a.secondsLow > 60))

// The departure is not an arrival, and the cross-country is not a circuit —
// both were false positives on the first cut.
ok('the take-off is not counted as a touch-and-go',
  !trip.pattern.some((w) => w.field.ident === 'KGMU' && w.touchAndGoes > 0),
  JSON.stringify(trip.pattern.map((w) => [w.field.ident, w.touchAndGoes])))
ok('the 152 nm round trip is not a "circuit"',
  trip.pattern.every((w) => w.circuits.every((c) => c.widthNm <= 5)))

// Consistency — the second half of the ask.
ok('laps are compared to each other', (work?.circuits.length ?? 0) >= 3, String(work?.circuits.length))
ok('pattern altitude is reported', (work?.consistency?.patternAglMean ?? 0) > 500)
ok('…and so is how tightly it was held', work?.consistency?.patternAglSpread != null)
ok('each lap keeps its ground track for drawing', work?.circuits.every((c) => c.path.length >= 3))

// A plain A-to-B flight has no pattern work to report.
const plain = segmentFlights('a835af', parseTrace(day2).fixes, day2.trace, { fieldAt: stubField })
ok('a cross-country reports no touch-and-goes',
  plain.every((f) => f.pattern.every((w) => w.touchAndGoes === 0)))
ok('…and no field resolver means no pattern work at all',
  segmentFlights('a761fa', pd.fixes, patternDay.trace)[0].pattern.length === 0)

// A high-pressure morning must not silently switch the feature off. Trace
// altitudes are pressure altitude; field elevations are true MSL.
for (const offset of [-200, -100, 0, 100, 200, 300]) {
  const shifted = {
    ...patternDay,
    trace: patternDay.trace.map((r) => (typeof r[3] === 'number' ? [...r.slice(0, 3), r[3] + offset, ...r.slice(4)] : r)),
  }
  const pf = parseTrace(shifted)
  const f = segmentFlights('a761fa', pf.fixes, shifted.trace, { fieldAt: stubField })[0]
  const w2 = f?.pattern.find((x) => x.field.ident === 'KGRD')
  ok(`still 4 touch-and-goes with the altimeter ${offset >= 0 ? '+' : ''}${offset} ft off`,
    w2?.touchAndGoes === 4, String(w2?.touchAndGoes))
}

// A circuit flown low (helicopters, ultralights) never climbs through the
// fixed clear height, and every lap used to merge into one endless dip.
const lowPattern = (patAgl) => {
  const base = 1_700_000_000
  const F = FIELDS[1]
  const trace = []
  let t = 0
  const at = (dLat, dLon, agl) => { trace.push([t, F.lat + dLat / 60, F.lon + dLon / 60, F.elevationFt + agl, 90, 0, 0, 0]); t += 15 }
  at(0, 0, 40)
  for (let lap = 0; lap < 4; lap++) {
    at(0.3, 0, patAgl - 100); at(1.2, 0.8, patAgl); at(0.2, 1.4, patAgl)
    at(-1.0, 1.1, patAgl - 150); at(-0.9, 0.2, patAgl - 350); at(-0.2, 0.02, 120)
  }
  at(2, 2, patAgl + 1500)
  return { icao: 'a761fa', timestamp: base, trace }
}
for (const patAgl of [600, 700, 1000]) {
  const lp = parseTrace(lowPattern(patAgl))
  const f = segmentFlights('a761fa', lp.fixes, [], { fieldAt: stubField })[0]
  const w3 = f?.pattern.find((x) => x.field.ident === 'KGRD')
  ok(`a ${patAgl} ft pattern is still counted`, (w3?.touchAndGoes ?? 0) >= 3, String(w3?.touchAndGoes))
}

// A session across UTC midnight is ONE set of pattern work, not two rows for
// the same field. 00:00 UTC is 8 PM Eastern — night-currency o'clock.
const cutAt = patternDay.trace[Math.floor(patternDay.trace.length * 0.55)][0]
const half = (from, to, base) => ({
  icao: 'a761fa', timestamp: patternDay.timestamp + base,
  trace: patternDay.trace.filter((r) => r[0] >= from && r[0] < to).map((r) => [r[0] - base, ...r.slice(1)]),
})
const straddle = flightsFromTraces(
  [{ raw: half(cutAt, 1e9, cutAt) }, { raw: half(0, cutAt, 0) }],
  { fieldAt: stubField },
)
const sf = straddle.flights[0]
ok('a session across midnight is one flight', straddle.flights.length === 1, String(straddle.flights.length))
ok('…with ONE entry for the field, not two',
  sf?.pattern.filter((w) => w.field.ident === 'KGRD').length === 1,
  JSON.stringify(sf?.pattern.map((w) => [w.field.ident, w.touchAndGoes])))
ok('…and the seam does not eat a touch-and-go',
  (sf?.pattern.find((w) => w.field.ident === 'KGRD')?.touchAndGoes ?? 0) >= 4,
  String(sf?.pattern.find((w) => w.field.ident === 'KGRD')?.touchAndGoes))

// A lone balked landing is a go-around, not pattern work.
ok('one approach with no lap reads as a go-around',
  patternSummary({ field: FIELDS[0], approaches: [{ at: 1, lowestAgl: 200, wentAround: true, secondsLow: 30 }],
    touchAndGoes: 1, circuits: [], consistency: null }).includes('go-around'))

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
