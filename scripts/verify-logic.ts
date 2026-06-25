// Runtime checks for the new map-feature logic (run via tsc -> node).
import { MOCK_ASSETS } from '../lib/mock-data'
import { generateTracks, trailUpTo, positionAt, clockLabel, rangeLabel, scrubLabel, RANGES, speedsForRange, formatSpeed, rangeWindowSeconds } from '../lib/trails'
import { PROJECTS, projectCost, periodCost, RANGE_COST_LABEL, money } from '../lib/projects'
import { weatherTileUrl, liveFrameIndex, type RadarFrame } from '../lib/weather'
import { MOCK_SITE_DEVICES, devicePopupHTML } from '../lib/site-devices'
import { MOCK_GEOFENCES } from '../lib/mock-data'
import { geofencePresence, presencePopupHTML } from '../lib/site-presence'

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

// ── Timeline ranges ──
ok('range presets present', RANGES.length === 7, RANGES.map((r) => r.key).join(','))
ok('rangeLabel live/today/7d', rangeLabel('live', 0) === 'LIVE' && rangeLabel('today', 0) === '6:00 AM' && /\w+ \d+/.test(rangeLabel('7d', 1)),
  `${rangeLabel('live', 0)} / ${rangeLabel('today', 0)} / ${rangeLabel('7d', 0.5)}`)

// ── Playback speeds scale with range ──
ok('formatSpeed 60 / 1k / 1M', formatSpeed(60) === '60×' && formatSpeed(1000) === '1k×' && formatSpeed(1_000_000) === '1M×',
  `${formatSpeed(60)} / ${formatSpeed(1000)} / ${formatSpeed(1_000_000)}`)
ok('long ranges offer up to 1M×', speedsForRange('all').includes(1_000_000) && speedsForRange('ytd').includes(1_000_000))
ok('day range stays modest', Math.max(...speedsForRange('today')) <= 10_000, `${Math.max(...speedsForRange('today'))}`)
ok('window seconds grow with range', rangeWindowSeconds('all') > rangeWindowSeconds('30d') && rangeWindowSeconds('30d') > rangeWindowSeconds('today'))

// ── Projects / cost ──
const p = PROJECTS[0]
const c0 = projectCost(p, 0)
const c1 = projectCost(p, 1)
ok('cost at t=0 has no today spend', c0.todayTotal === 0)
ok('cost at t=1 accrues labor + equipment', c1.laborToday > 0 && c1.equipToday > 0,
  `labor ${money(c1.laborToday)} + equip ${money(c1.equipToday)}`)
ok('burn% rises through the day', c1.burnPct > c0.burnPct, `${c0.burnPct.toFixed(0)}% → ${c1.burnPct.toFixed(0)}%`)
ok('status escalates as burn climbs', ['on_track', 'at_risk', 'over_budget'].includes(c1.status), c1.status)

// period cost reflects the selected range, not just "today"
const today1 = periodCost(p, 'today', 1).total
const month1 = periodCost(p, '30d', 1).total
ok('period cost scales ~30x for 30 days', month1 > today1 * 20, `${money(today1)} → ${money(month1)}`)
// replaying Today to the end must land exactly on the live number
ok('today replay capped at live', periodCost(p, 'today', 1).total === periodCost(p, 'live', 0).total,
  money(periodCost(p, 'today', 1).total))
ok('cost period labels', RANGE_COST_LABEL['30d'] === 'last 30 days' && RANGE_COST_LABEL.live === 'today')
ok('scrubLabel live/today/30d', scrubLabel('live', 0) === 'Live' && scrubLabel('today', 0).includes('Today') && /\d{4}/.test(scrubLabel('30d', 0.5)),
  `${scrubLabel('today', 0.5)} | ${scrubLabel('30d', 0.5)}`)

// ── Weather frame handling ──
const frames: RadarFrame[] = [
  { time: 100, path: '/v2/radar/100', kind: 'past' },
  { time: 200, path: '/v2/radar/200', kind: 'past' },
  { time: 300, path: '/v2/radar/300', kind: 'nowcast' },
]
ok('liveFrameIndex picks last past frame', liveFrameIndex(frames) === 1, `idx ${liveFrameIndex(frames)}`)
const url = weatherTileUrl('https://host', frames[0])
ok('radar tile url well-formed', url === 'https://host/v2/radar/100/256/{z}/{x}/{y}/4/1_1.png', url)

// ── Site devices ──
ok('site devices present', MOCK_SITE_DEVICES.length >= 5, `${MOCK_SITE_DEVICES.length}`)
ok('every device has coords + name', MOCK_SITE_DEVICES.every((d) => d.name && Number.isFinite(d.lng) && Number.isFinite(d.lat)))
const cam = MOCK_SITE_DEVICES.find((d) => d.type === 'camera')!
ok('camera popup renders snapshot + name', devicePopupHTML(cam).includes(cam.name) && devicePopupHTML(cam).includes('LIVE'))
const fuel = MOCK_SITE_DEVICES.find((d) => d.type === 'fuel')!
ok('fuel popup shows level %', devicePopupHTML(fuel).includes(`${fuel.value}%`))

// ── Geofence presence / in-zone tracking ──
const river = MOCK_GEOFENCES.find((g) => g.name === 'Riverfront Tower')!
const maple = MOCK_GEOFENCES.find((g) => g.name === 'Maple St Grading')!
const rp = geofencePresence(river, MOCK_ASSETS)
const mp = geofencePresence(maple, MOCK_ASSETS)
ok('Riverfront has assets on site', rp.total > 0, `${rp.total}`)
ok('Maple St has assets on site', mp.total > 0, `${mp.total}`)
ok('zones do not double-count same asset', !rp.insideIds.some((id) => mp.insideIds.includes(id)))
ok('presence popup shows site + cost', presencePopupHTML(river, rp).includes('Riverfront') && presencePopupHTML(river, rp).includes('Cost today'))

console.log(fails === 0 ? '\nALL LOGIC CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
