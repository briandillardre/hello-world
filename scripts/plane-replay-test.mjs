/**
 * The searched plane's timeline math, asserted (run: node scripts/plane-replay-test.mjs).
 *
 * lib/plane-replay.ts turns the flight log's flights into one timed trail and
 * answers "where was it at this moment". The moments that matter are the
 * awkward ones — before the first fix, in the gap between two flights, past
 * the last — because each of those used to be where a replay lied.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/plane-replay.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const { buildReplayTrail, replayPositionAt, upperBound, bearingDeg, agoWords } = mod

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

// Two flights: 10:00–10:03 east along the 35th parallel, then a 30-minute
// stop, then 10:33–10:35 back west. Second flight first in the input, to
// prove the order comes from the times, not the wire.
const T = 1_700_000_000
const f1 = {
  id: 'a', startedAt: T, endedAt: T + 180, fromLabel: 'Greenville Downtown (GMU)', toLabel: 'Anderson (AND)',
  pts: [[-82.0, 35.0, 0, 20, null], [-81.9, 35.0, 300, 100, 500], [-81.8, 35.0, 600, 120, 0], [-81.7, 35.0, 0, 30, -400]],
  ts: [T, T + 60, T + 120, T + 180],
}
const f2 = {
  id: 'b', startedAt: T + 1980, endedAt: T + 2100, fromLabel: 'Anderson (AND)', toLabel: 'Greenville Downtown (GMU)',
  pts: [[-81.7, 35.0, 0, null, null], [-81.8, 35.0, 400, 110, 300], [-81.9, 35.0, 0, 25, null], [NaN, 35.0, 0, 0, 0]],
  ts: [T + 1980, T + 2040, T + 2100, T + 2160],
}
const rt = buildReplayTrail('abc123', [f2, f1])

// ── Building the trail ─────────────────────────────────────────────────────
ok('flights come out in time order', rt.flights.length === 2 && rt.flights[0].fromLabel === 'Greenville Downtown (GMU)')
ok('a point with no position is dropped', rt.ts.length === 7, `got ${rt.ts.length}`)
ok('index ranges tile the trail', rt.flights[0].i0 === 0 && rt.flights[0].i1 === 4 && rt.flights[1].i0 === 4 && rt.flights[1].i1 === 7)
ok('null on the wire lands as NaN, never 0', Number.isNaN(rt.flat[4]) && rt.flat[3] === 20)
ok('times are monotonic', rt.ts.every((t, i) => i === 0 || t >= rt.ts[i - 1]))
const back = buildReplayTrail('x', [{ ...f1, ts: [T, T + 60, T + 30, T + 180] }])
ok('a fix that runs backwards in time is dropped', back.ts.length === 3 && back.ts[2] === T + 180)

// ── upperBound ─────────────────────────────────────────────────────────────
ok('upperBound before the first', upperBound([1, 2, 3], 0) === 0)
ok('upperBound at a value is past it', upperBound([1, 2, 3], 2) === 2)
ok('upperBound past the last', upperBound([1, 2, 3], 9) === 3)

// ── Positions ──────────────────────────────────────────────────────────────
const before = replayPositionAt(rt, T - 3600)
ok('before the first fix: waiting where the first flight begins', before.state === 'before' && before.lon === -82.0 && before.cut === 0 && before.flight === 0)

const mid = replayPositionAt(rt, T + 90)
ok('mid-leg: flying', mid.state === 'flying' && mid.flight === 0)
ok('mid-leg: position interpolated', near(mid.lon, -81.85) && near(mid.lat, 35.0), `lon ${mid.lon}`)
ok('mid-leg: altitude interpolated (m → ft)', near(mid.altFt, 450 / 0.3048, 1e-3), `alt ${mid.altFt}`)
ok('mid-leg: speed interpolated', near(mid.gsKt, 110), `gs ${mid.gsKt}`)
ok('mid-leg: heading is the leg being flown (east)', near(mid.track, 90, 0.5), `track ${mid.track}`)
ok('mid-leg: the trail is cut after the fix behind the aircraft', mid.cut === 2)

const exact = replayPositionAt(rt, T + 60)
ok('exactly on a fix: that fix', exact.state === 'flying' && exact.lon === -81.9 && exact.cut === 2)

const noVs = replayPositionAt(rt, T + 30)
ok('a value only one end sent is carried, not invented', noVs.vsFpm === 500 && noVs.gsKt === 60, `vs ${noVs.vsFpm} gs ${noVs.gsKt}`)
const noBoth = replayPositionAt(rt, T + 2010)
ok('a value neither end sent stays null', noBoth.vsFpm === 300 && noBoth.gsKt === 110)

const gap = replayPositionAt(rt, T + 900)
ok('between flights: parked where the earlier one landed', gap.state === 'between' && gap.flight === 0 && gap.lon === -81.7 && gap.cut === 4)
ok('between flights: heading is the last leg flown', near(gap.track, 90, 0.5))

const after = replayPositionAt(rt, T + 9999)
ok('after the last fix: parked where it landed, whole trail flown', after.state === 'after' && after.flight === 1 && after.lon === -81.9 && after.cut === 7)
ok('the last leg flew west', near(after.track, 270, 0.5), `track ${after.track}`)

ok('an empty trail answers null', replayPositionAt(buildReplayTrail('e', []), T) === null)

// ── Words and headings ─────────────────────────────────────────────────────
ok('bearing east', near(bearingDeg(-82, 35, -81, 35), 90, 0.5))
ok('bearing north', near(bearingDeg(-82, 35, -82, 36), 0, 1e-6))
const now = 10_000_000_000
ok('ago: seconds', agoWords(now - 40_000, now) === '40 s ago')
ok('ago: minutes', agoWords(now - 12 * 60_000, now) === '12 min ago')
ok('ago: hours', agoWords(now - 3 * 3_600_000, now) === '3 h ago')
ok('ago: days', agoWords(now - 5 * 86_400_000, now) === '5 days ago')
ok('ago: never negative', agoWords(now + 60_000, now) === '0 s ago')

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
