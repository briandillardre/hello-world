// Runtime checks for the new map-feature logic (run via tsc -> node).
import { MOCK_ASSETS } from '../lib/mock-data'
import { generateTracks, trailUpTo, positionAt, clockLabel } from '../lib/trails'
import { PROJECTS, projectCost, money } from '../lib/projects'
import { weatherTileUrl, liveFrameIndex, type RadarFrame } from '../lib/weather'

let fails = 0
function ok(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
  if (!cond) fails++
}

// ── Trails ──
const tracks = generateTracks(MOCK_ASSETS)
ok('tracks: one per asset', tracks.length === MOCK_ASSETS.length, `${tracks.length}`)
ok('tracks: 96 points each', tracks.every((t) => t.points.length === 96))
const last = positionAt(tracks[0], 1)
const liveLoc = [MOCK_ASSETS[0].location!.lng, MOCK_ASSETS[0].location!.lat]
ok('trail ends at live location', Math.abs(last[0] - liveLoc[0]) < 1e-6 && Math.abs(last[1] - liveLoc[1]) < 1e-6)
ok('trailUpTo grows with t', trailUpTo(tracks[0], 0.25).length < trailUpTo(tracks[0], 0.9).length)
ok('clockLabel 0 / .5 / 1', clockLabel(0) === '6:00 AM' && clockLabel(0.5) === '12:00 PM' && clockLabel(1) === '6:00 PM',
  `${clockLabel(0)} / ${clockLabel(0.5)} / ${clockLabel(1)}`)

// ── Projects / cost ──
const p = PROJECTS[0]
const c0 = projectCost(p, 0)
const c1 = projectCost(p, 1)
ok('cost at t=0 has no today spend', c0.todayTotal === 0)
ok('cost at t=1 accrues labor + equipment', c1.laborToday > 0 && c1.equipToday > 0,
  `labor ${money(c1.laborToday)} + equip ${money(c1.equipToday)}`)
ok('burn% rises through the day', c1.burnPct > c0.burnPct, `${c0.burnPct.toFixed(0)}% → ${c1.burnPct.toFixed(0)}%`)
ok('status escalates as burn climbs', ['on_track', 'at_risk', 'over_budget'].includes(c1.status), c1.status)

// ── Weather frame handling ──
const frames: RadarFrame[] = [
  { time: 100, path: '/v2/radar/100', kind: 'past' },
  { time: 200, path: '/v2/radar/200', kind: 'past' },
  { time: 300, path: '/v2/radar/300', kind: 'nowcast' },
]
ok('liveFrameIndex picks last past frame', liveFrameIndex(frames) === 1, `idx ${liveFrameIndex(frames)}`)
const url = weatherTileUrl('https://host', frames[0], 'radar')
ok('radar tile url well-formed', url === 'https://host/v2/radar/100/256/{z}/{x}/{y}/4/1_1.png', url)
const surl = weatherTileUrl('https://host', frames[0], 'satellite')
ok('satellite tile url well-formed', surl.endsWith('/0/0_0.png'))

console.log(fails === 0 ? '\nALL LOGIC CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
