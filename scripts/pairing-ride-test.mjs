/**
 * "Rode with" vs "seen by", asserted (run: node scripts/pairing-ride-test.mjs).
 *
 * lib/pairing-ride.ts decides whether a tool actually travelled with the
 * truck that heard it — from WHERE the truck was each time it heard the tag
 * (the ingest folds every sighting in; migration 122 stores the result).
 * Brian, Sep 24: "Rode with should require it to be moving like more than a
 * half mile with a hub." A false "rode with" puts a roller on a truck it
 * never left the site with; a false "seen by" hides the one ride that answers
 * "who took it". The scenarios below are the shapes of real episodes in the
 * live data. Run it after ANY change there — and mirror a change to the fold
 * into 122's SQL (ht_pairing_summarize), which backfilled the old episodes.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/pairing-ride.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const R = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log('  FAIL', name, extra) }

// A yard near Greenville; 1° lat ≈ 111,195 m, 1° lng ≈ 91,300 m here.
const BASE = { lat: 34.8526, lng: -82.394 }
const north = (m, east = 0) => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng + east / 91_300 })
let seed = 7
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const jitter = (p, m) => ({ lat: p.lat + (rnd() - 0.5) * 2 * m / 111_195, lng: p.lng + (rnd() - 0.5) * 2 * m / 91_300 })
const MI = 1609.344

/** The ingest's view of an episode: opened by the first sighting, every
 *  later sighting folded in (lib/ble-sightings.ts does exactly this). */
function run(sightings) {
  let ep = R.newEpisodePlaces(sightings[0])
  for (const f of sightings.slice(1)) {
    const next = R.foldSighting(ep, f)
    if (next) ep = next
  }
  return ep
}
const kindOf = (ep) => R.rideKind(ep.span_m)

// 1) The 85A roller beside the F650 overnight: 5,148 sightings wandering ±6 m.
{
  const s = Array.from({ length: 5148 }, () => jitter(BASE, 6))
  const ep = run(s)
  ok('parked 36 h: seen by', kindOf(ep) === 'seen')
  ok('parked 36 h: no distance', ep.moved_m === 0, String(ep.moved_m))
  ok('parked 36 h: every sighting counted', ep.heard_n === 5148, String(ep.heard_n))
}

// 2) The F650 + HAMM roller, Sep 22: a dump truck hauling loads all day and
//    coming back to the roller each time — 703 sightings, all within 45 m of
//    the first. The truck's own 60 miles are not in the input at all: that is
//    the whole fix (#158 measured them and called it a ride).
{
  const s = Array.from({ length: 703 }, () => jitter(BASE, 45))
  const ep = run(s)
  ok('leave-and-return: seen by', kindOf(ep) === 'seen', String(ep.span_m))
  ok('leave-and-return: no distance', ep.moved_m === 0, String(ep.moved_m))
}

// 3) The F750 at a site, Sep 23: parks in two spots 160 m apart, hearing the
//    roller from both, back and forth 30 times. The roller never moved.
{
  const a = north(0), b = north(160)
  const s = Array.from({ length: 30 }, (_, i) => jitter(i % 2 ? b : a, 4))
  const ep = run(s)
  ok('re-parking around a parked machine: seen by', kindOf(ep) === 'seen')
  ok('re-parking around a parked machine: no distance', ep.moved_m === 0, String(ep.moved_m))
}

// 4) The real haul — the RAM 3500 with the TL8 and the roller, Jul 14:
//    heard at the yard, along the road out to 8.1 km, back to 2.2 km, out to
//    12.3 km, then parked overnight at 4.2 km. Sightings every ~400 m while
//    moving (the scanner reports a tag some of the time on the move).
{
  const legs = [[0, 8100], [8100, 2200], [2200, 12300], [12300, 4200]]
  const s = [...Array.from({ length: 20 }, () => jitter(north(0), 8))]
  for (const [from, to] of legs) {
    const n = Math.round(Math.abs(to - from) / 400)
    for (let i = 1; i <= n; i++) s.push(jitter(north(from + (to - from) * i / n), 8))
    for (let k = 0; k < 15; k++) s.push(jitter(north(to), 8)) // parked there a while
  }
  const ep = run(s)
  const drove = 8100 + 5900 + 10100 + 8100
  ok('real haul: rode with', kindOf(ep) === 'rode')
  ok('real haul: span = farthest from the yard', Math.abs(ep.span_m - 12300) < 60, String(ep.span_m))
  ok('real haul: miles ≈ the legs driven', Math.abs(ep.moved_m - drove) < drove * 0.05, `${ep.moved_m} vs ${drove}`)
  ok('real haul: reads ~20 mi', R.rideMiles(R.rideMetres(ep)) === '20 mi', R.rideMiles(R.rideMetres(ep)))
}

// 5) The F750 + TL8, Sep 8: heard twice at the yard, then four times 5.6 km
//    away (a trailer haul; the scanner heard nothing on the road). Sparse
//    sightings still see both ends — the miles are the straight-line floor.
{
  const s = [jitter(BASE, 5), jitter(BASE, 5), ...Array.from({ length: 4 }, () => jitter(north(5593), 5))]
  const ep = run(s)
  ok('trailer haul, ends only: rode with', kindOf(ep) === 'rode')
  ok('trailer haul, ends only: 3.5 mi', R.rideMiles(R.rideMetres(ep)) === '3.5 mi', R.rideMiles(R.rideMetres(ep)))
}

// 6) Out and back with the tag aboard, heard only while parked at each end:
//    the round trip counts both ways.
{
  const site = north(1.2 * MI)
  const s = [...Array(3)].map(() => jitter(BASE, 5)).concat([...Array(3)].map(() => jitter(site, 5)), [...Array(3)].map(() => jitter(BASE, 5)))
  const ep = run(s)
  ok('round trip: rode with', kindOf(ep) === 'rode')
  ok('round trip: both ways', Math.abs(ep.moved_m - 2.4 * MI) < 60, String(ep.moved_m))
  ok('round trip: span is one way', Math.abs(ep.span_m - 1.2 * MI) < 30, String(ep.span_m))
}

// 7) Half a mile is the line.
{
  ok('0.45 mi: seen by', kindOf(run([BASE, north(0.45 * MI)])) === 'seen')
  ok('0.55 mi: rode with', kindOf(run([BASE, north(0.55 * MI)])) === 'rode')
  ok('exactly ½ mi: rode with', R.rideKind(R.RIDE_MIN_M) === 'rode')
  ok('just under: seen by', R.rideKind(R.RIDE_MIN_M - 1) === 'seen')
  // A ride shows at least how far the tag got, even when the anchor lags.
  ok('miles never under the span', R.rideMetres({ span_m: 900, moved_m: 700 }) === 900)
}

// 8) A phone gateway walking a site with a tool in reach: stays one place.
{
  const s = Array.from({ length: 200 }, (_, i) => jitter(north((i % 20) * 6, (i % 7) * 8), 10))
  const ep = run(s)
  ok('phone walking a site: seen by', kindOf(ep) === 'seen', String(ep.span_m))
}

// 9) Positions that must never fold: no fix (0,0), NaN, off the globe, strings.
{
  const ep0 = R.newEpisodePlaces(BASE)
  for (const bad of [{ lat: 0, lng: 0 }, { lat: NaN, lng: 1 }, { lat: 91, lng: 0 }, { lat: 10, lng: 181 }, { lat: '34.8', lng: '-82.3' }, null, undefined]) {
    ok(`bad fix ${JSON.stringify(bad)} changes nothing`, R.foldSighting(ep0, bad) === null)
  }
  // An episode opened by a fix without a position starts at the first real one.
  const blind = R.newEpisodePlaces({ lat: 0, lng: 0 })
  ok('blind open: summarized but empty', blind.heard_n === 0 && blind.first_lat === null && blind.span_m === 0)
  const next = R.foldSighting(blind, north(1000))
  ok('blind open: first real fix becomes the first place', next.heard_n === 1 && Math.abs(next.first_lat - north(1000).lat) < 1e-9 && next.span_m === 0)
}

// 10) Episodes recorded before 122 (heard_n NULL) are the backfill's job —
//     folding here would call the latest sighting the first one.
{
  const legacy = { first_lat: null, first_lng: null, anchor_lat: null, anchor_lng: null, span_m: null, moved_m: null, heard_n: null }
  ok('legacy episode is left alone', R.foldSighting(legacy, BASE) === null)
  ok('missing row is left alone', R.foldSighting(null, BASE) === null)
  ok('unmeasured verdict is seen by', R.rideKind(null) === 'seen' && R.rideKind(undefined) === 'seen' && R.rideKind(NaN) === 'seen')
}

// 11) The fold is incremental: folding in two batches equals one pass.
{
  const s = Array.from({ length: 60 }, (_, i) => jitter(north(i * 90), 5))
  const whole = run(s)
  let ep = run(s.slice(0, 25))
  for (const f of s.slice(25)) ep = R.foldSighting(ep, f) ?? ep
  ok('two batches = one pass', JSON.stringify(ep) === JSON.stringify(whole))
}

// 12) Words.
{
  ok('0.6 mi', R.rideMiles(0.6 * MI) === '0.6 mi')
  ok('8.8 mi', R.rideMiles(8.8 * MI) === '8.8 mi')
  ok('22 mi', R.rideMiles(22.4 * MI) === '22 mi')
  ok('never negative', R.rideMiles(-5) === '0.0 mi')
  ok('tool side verbs', R.rideVerb('rode', 'tool') === 'rode with' && R.rideVerb('seen', 'tool') === 'seen by')
  ok('carrier side verbs', R.rideVerb('rode', 'carrier') === 'carried' && R.rideVerb('seen', 'carrier') === 'saw')
  const t = '2026-09-24T12:00:00Z'
  ok('one passing sighting is instant', R.isInstant({ started_at: t, last_seen: '2026-09-24T12:00:10Z', ended_at: null }))
  ok('a minute is not instant', !R.isInstant({ started_at: t, last_seen: '2026-09-24T12:01:00Z', ended_at: null }))
  ok('closed episode without last_seen uses ended_at', !R.isInstant({ started_at: t, last_seen: null, ended_at: '2026-09-24T13:00:00Z' }))
}

// 13) Back-to-back sightings by the same partner collapse; rides stand alone.
{
  const rows = [
    { p: 'F650', k: 'seen' }, { p: 'F650', k: 'seen' }, { p: 'F650', k: 'rode' },
    { p: 'F650', k: 'seen' }, { p: 'F750', k: 'seen' }, { p: 'F750', k: 'seen' }, { p: 'F750', k: 'rode' }, { p: 'F750', k: 'rode' },
  ]
  const g = R.groupSightings(rows, (r) => r.p, (r) => r.k)
  ok('groups', JSON.stringify(g.map((x) => x.length)) === '[2,1,1,2,1,1]', JSON.stringify(g.map((x) => x.length)))
  ok('group order kept, newest first', g[0][0] === rows[0] && g[3][1] === rows[5])
}

console.log(`pairing-ride: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
