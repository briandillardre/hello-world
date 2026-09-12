/**
 * Drives a real route past lib/navigation.ts and checks what a driver notices.
 *
 * Run through run.sh (it compiles the TS first). The route in route.json is a
 * genuine OSRM answer for a 6.5-mile Greenville drive — 422 points, 7
 * maneuvers, including a slight-right and two closely spaced turns, which is
 * exactly where a guidance bug shows up.
 *
 * What it proves:
 *   · our distance spine matches OSRM's own total
 *   · progress never runs backwards under GPS noise
 *   · a fix on the road never reads as off-route
 *   · every maneuver is announced in order, once per rung, ending with the
 *     call AT the corner (the rung bug this harness caught on day one: the
 *     ladder fired each turn once, a mile out, and never said "turn now")
 *   · a real detour re-routes; one wild fix does not
 *   · arrival fires
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const N = await import(process.env.NAV_JS)
const here = dirname(fileURLToPath(import.meta.url))
const R = JSON.parse(readFileSync(join(here, 'route.json'), 'utf8'))

const coords = R.geometry.coordinates
const steps = R.steps
const cum = N.cumulativeDistances(coords)
const anchors = N.stepAnchors(steps, coords, cum)
const total = cum[cum.length - 1]

let fails = 0
const check = (cond, label) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}`)
  if (!cond) fails++
}

console.log(`route: ${coords.length} points · ${(total / 1609.344).toFixed(2)} mi · ${steps.length} maneuvers\n`)

check(Math.abs(total - R.distanceM) / R.distanceM < 0.01, 'distance spine within 1% of OSRM')
check(anchors.every((a, i) => i === 0 || a >= anchors[i - 1]), 'maneuver anchors are in order')
check(Math.abs(anchors.at(-1) - total) < 60, 'the last maneuver lands at the destination')

// ── drive it: a fix every 25 m, 8 m of jitter (a phone in a truck cab) ──
// Deterministic noise so a failure is reproducible.
let seed = 12345
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2
const jitter = (m) => (rand() * m) / 111320

let lastIdx = 0, lastAlong = -1, backwards = false, maxOff = 0, arrived = false
const said = new Map()
const heard = []
for (let d = 0; d <= total; d += 25) {
  let i = cum.findIndex((c) => c >= d)
  if (i < 1) i = 1
  const t = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1])
  const pos = [
    coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t + jitter(8),
    coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t + jitter(8),
  ]
  const snap = N.snapToRoute(coords, cum, pos, lastIdx)
  maxOff = Math.max(maxOff, snap.offRouteM)
  if (snap.alongM + 1 < lastAlong) backwards = true
  lastAlong = snap.alongM
  lastIdx = snap.index

  const g = N.guidanceAt(steps, anchors, total, R.durationSec, snap.alongM)
  if (g.arrived) { arrived = true; break }
  const rung = N.rungFor(g.toManeuverM)
  if (rung == null) continue
  let rungs = said.get(g.stepIndex)
  if (!rungs) { rungs = new Set(); said.set(g.stepIndex, rungs) }
  if (rungs.has(rung)) continue
  for (const r of N.RUNGS) if (r >= rung) rungs.add(r)
  heard.push({ step: g.stepIndex, rung, phrase: N.phraseFor(steps[g.stepIndex], rung, g.toManeuverM) })
}

check(!backwards, 'progress never runs backwards under 8 m of GPS noise')
check(maxOff < 15, `a fix on the road never reads as off-route (worst ${maxOff.toFixed(1)} m)`)
check(arrived, 'arrival fires at the destination')
check(heard.every((h, i) => i === 0 || h.step >= heard[i - 1].step), 'announcements come in maneuver order')
check(
  new Set(heard.map((h) => `${h.step}:${h.rung}`)).size === heard.length,
  'no announcement is repeated',
)
// The one that matters: every real turn gets its call at the corner.
const turns = steps.map((s, i) => i).filter((i) => i > 0 && steps[i].type !== 'depart')
const atCorner = turns.filter((i) => heard.some((h) => h.step === i && h.rung === 60))
check(atCorner.length === turns.length, `every maneuver is called AT the corner (${atCorner.length}/${turns.length})`)

// ── a real detour re-routes; one wild fix does not ──
let strikes = 0, tripped = false
for (let k = 0; k < 6 && !tripped; k++) {
  const off = [coords[40][0] + 0.004, coords[40][1] + 0.004] // ~550 m off
  strikes = N.snapToRoute(coords, cum, off, 40).offRouteM > N.OFF_ROUTE_M ? strikes + 1 : 0
  tripped = strikes >= N.OFF_ROUTE_STRIKES
}
check(tripped, 'a real detour trips the re-route')

strikes = 0
for (const d of [800, 825, 850]) {
  const i = cum.findIndex((c) => c >= d)
  const pos = d === 825 ? [coords[i][0] + 0.003, coords[i][1]] : coords[i]
  strikes = N.snapToRoute(coords, cum, pos, Math.max(0, i - 3)).offRouteM > N.OFF_ROUTE_M ? strikes + 1 : 0
}
check(strikes < N.OFF_ROUTE_STRIKES, 'one wild fix does not trigger a re-route')

console.log(`\n${heard.length} announcements on this drive:`)
for (const h of heard) console.log(`   step ${h.step} @${String(h.rung).padStart(4)}m  "${h.phrase}"`)

console.log(fails === 0 ? '\nPASS — guidance math is sound.' : `\nFAIL — ${fails} check(s) failed.`)
process.exit(fails === 0 ? 0 : 1)
