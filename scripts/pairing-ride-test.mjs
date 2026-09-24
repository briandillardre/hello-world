/**
 * "Rode with" vs "seen by", asserted (run: node scripts/pairing-ride-test.mjs).
 *
 * lib/pairing-ride.ts decides whether a tool actually travelled with the
 * truck that heard it. Brian, Sep 24: "Rode with should require it to be
 * moving like more than a half mile with a hub." A false "rode with" puts a
 * roller on a truck it never left the yard with; a false "seen by" hides the
 * one ride that answers "who took it". Run it after ANY change there.
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

// A yard near Greenville; 1° lat ≈ 111,195 m.
const BASE = { lat: 34.8526, lng: -82.394 }
const T0 = Date.parse('2026-09-22T21:43:00Z')
const at = (ms) => new Date(T0 + ms).toISOString()
const north = (m) => BASE.lat + m / 111_195
// Deterministic jitter.
let seed = 7
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

// 1) The F650 parked in the yard for 36 h, 5,148 fixes wandering ±6 m, speed 0.
{
  const fixes = []
  for (let i = 0; i < 5148; i++) fixes.push({ lat: BASE.lat + (rnd() - 0.5) * 12 / 111_195, lng: BASE.lng + (rnd() - 0.5) * 12 / 91_000, speed: 0, timestamp: at(i * 25_000) })
  const m = R.movingPathM(fixes)
  ok('parked 36 h (speed 0) adds nothing', m === 0, String(m))
  ok('parked = seen by', R.rideKind(m) === 'seen')
  // The same wander with an occasional 1–2 mph noise reading still adds nothing.
  const noisy = fixes.map((f, i) => (i % 97 === 0 ? { ...f, speed: 2 } : f))
  ok('1–2 mph noise is not driving', R.movingPathM(noisy) === 0)
}

// 2) A real drive: 9 miles north at ~30 mph, a fix every 5 s, speed reported.
{
  const fixes = []
  const stepM = 30 * 1609.344 / 3600 * 5 // ≈ 67 m per 5 s
  const n = Math.round(9 * 1609.344 / stepM)
  for (let i = 0; i <= n; i++) fixes.push({ lat: north(i * stepM), lng: BASE.lng, speed: 30, timestamp: at(i * 5000) })
  const m = R.movingPathM(fixes)
  ok('9-mile drive measures ~9 mi', Math.abs(m / 1609.344 - 9) < 0.1, (m / 1609.344).toFixed(2))
  ok('9-mile drive = rode with', R.rideKind(m) === 'rode')
  ok('miles label under 10 has one decimal', R.rideMiles(m) === '9.0 mi', R.rideMiles(m))
  // Order does not matter.
  const shuffled = [...fixes].reverse()
  ok('unsorted input sorts itself', Math.abs(R.movingPathM(shuffled) - m) < 1)
}

// 3) Drive, a long stop, drive again: the stop costs nothing, both legs count.
{
  const fixes = []
  let t = 0
  // leg 1: 0.4 mi north at 20 mph
  for (let d = 0; d <= 0.4 * 1609.344; d += 45) { fixes.push({ lat: north(d), lng: BASE.lng, speed: 20, timestamp: at(t) }); t += 5000 }
  const stopAt = north(0.4 * 1609.344)
  // stop: 2 h parked, jittering
  for (let i = 0; i < 240; i++) { fixes.push({ lat: stopAt + (rnd() - 0.5) * 10 / 111_195, lng: BASE.lng, speed: 0, timestamp: at(t) }); t += 30_000 }
  // leg 2: another 0.4 mi north
  for (let d = 0.4 * 1609.344; d <= 0.8 * 1609.344; d += 45) { fixes.push({ lat: north(d), lng: BASE.lng, speed: 20, timestamp: at(t) }); t += 5000 }
  const m = R.movingPathM(fixes)
  ok('two 0.4-mi legs around a stop ≈ 0.8 mi', Math.abs(m / 1609.344 - 0.8) < 0.05, (m / 1609.344).toFixed(3))
  ok('0.8 mi across a stop = rode with', R.rideKind(m) === 'rode')
  // Only the moving rows (what the page fetches: speed > 2 or null) give the same answer.
  const movingOnly = fixes.filter((f) => f.speed == null || f.speed > 2)
  ok('moving rows alone measure the same', Math.abs(R.movingPathM(movingOnly) - m) < 20, `${R.movingPathM(movingOnly)} vs ${m}`)
}

// 4) Pulling away without the tag: the truck heard it for the first 150 m only.
{
  const fixes = []
  for (let d = 0; d <= 150; d += 30) fixes.push({ lat: north(d), lng: BASE.lng, speed: 12, timestamp: at(d * 200) })
  ok('a 150 m pull-away is seen by', R.rideKind(R.movingPathM(fixes)) === 'seen')
}

// 5) Just under and just over half a mile.
{
  const drive = (miles) => {
    const fixes = []
    for (let d = 0; d <= miles * 1609.344 + 0.01; d += 20) fixes.push({ lat: north(d), lng: BASE.lng, speed: 15, timestamp: at(d * 150) })
    return R.movingPathM(fixes)
  }
  ok('0.45 mi = seen by', R.rideKind(drive(0.45)) === 'seen', String(drive(0.45)))
  ok('0.55 mi = rode with', R.rideKind(drive(0.55)) === 'rode', String(drive(0.55)))
  ok('threshold is half a mile', Math.abs(R.RIDE_MIN_M - 804.672) < 0.01)
}

// 6) A phone gateway with no speed: jitter never adds up, a real drive does.
{
  const still = []
  for (let i = 0; i < 1200; i++) still.push({ lat: BASE.lat + (rnd() - 0.5) * 40 / 111_195, lng: BASE.lng + (rnd() - 0.5) * 40 / 91_000, speed: null, timestamp: at(i * 30_000) })
  const m = R.movingPathM(still)
  ok('no-speed phone jitter (±20 m, 10 h) = seen by', R.rideKind(m) === 'seen', String(Math.round(m)))
  const drive = []
  // 3 miles at 35 mph, a fix every 3 s (the shift recorder's "sooner on a 40 m move").
  const stepM = 35 * 1609.344 / 3600 * 3
  for (let i = 0; i * stepM <= 3 * 1609.344; i++) drive.push({ lat: north(i * stepM), lng: BASE.lng, speed: null, timestamp: at(i * 3000) })
  const d = R.movingPathM(drive)
  ok('no-speed phone drive of 3 mi is measured', Math.abs(d / 1609.344 - 3) < 0.15, (d / 1609.344).toFixed(2))
  ok('no-speed phone drive = rode with', R.rideKind(d) === 'rode')
  // A walk across a site (3 mph for 20 min ≈ 1 mi of steps) is not a ride.
  const walk = []
  for (let i = 0; i < 40; i++) walk.push({ lat: north(i * 40), lng: BASE.lng, speed: null, timestamp: at(i * 30_000) })
  ok('a 3 mph walk with no speed is not driving', R.movingPathM(walk) === 0, String(R.movingPathM(walk)))
}

// 7) Bad rows are ignored.
{
  const fixes = [
    { lat: 0, lng: 0, speed: 40, timestamp: at(0) },
    { lat: NaN, lng: BASE.lng, speed: 40, timestamp: at(1000) },
    { lat: BASE.lat, lng: BASE.lng, speed: 40, timestamp: 'garbage' },
    { lat: BASE.lat, lng: BASE.lng, speed: 40, timestamp: at(2000) },
  ]
  ok('null island, NaN and bad timestamps are dropped', R.movingPathM(fixes) === 0)
  ok('empty input = 0', R.movingPathM([]) === 0)
}

// 8) Windows, verbs, labels.
{
  const w1 = R.rideWindow({ started_at: at(0), last_seen: at(0), ended_at: null })
  ok('one sighting is instant', w1.instant === true)
  const w2 = R.rideWindow({ started_at: at(0), last_seen: at(10 * 60_000), ended_at: at(10 * 60_000) })
  ok('10 minutes is measured', w2.instant === false && w2.to === at(10 * 60_000))
  const w3 = R.rideWindow({ started_at: at(0), last_seen: at(5 * 60_000), ended_at: null })
  ok('an open episode ends at its last sighting', w3.to === at(5 * 60_000))
  ok('tool side verbs', R.rideVerb('rode', 'tool') === 'rode with' && R.rideVerb('seen', 'tool') === 'seen by')
  ok('carrier side verbs', R.rideVerb('rode', 'carrier') === 'carried' && R.rideVerb('seen', 'carrier') === 'saw')
  ok('22.4 mi rounds to 22', R.rideMiles(22.4 * 1609.344) === '22 mi')
  ok('capped reads say +', R.rideMiles(40 * 1609.344, true) === '40+ mi')
  ok('0.55 mi reads 0.6 mi', R.rideMiles(0.55 * 1609.344) === '0.6 mi', R.rideMiles(0.55 * 1609.344))
}

console.log(`${pass}/${pass + fail} assertions passed`)
process.exit(fail ? 1 : 0)
