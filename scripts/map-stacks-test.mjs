/**
 * Map stacks, asserted (run: node scripts/map-stacks-test.mjs).
 *
 * lib/map-stacks.ts decides what a tapped count circle does — glide to fit
 * the members, fan a stacked pair out in place, or list a big stack — and
 * where fanned members sit. Brian, Sep 24: the F350 and the trailer it tows
 * drawn as one puck with two names until 20 ft. Run it after ANY change there.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/map-stacks.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const S = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log('  FAIL', name, extra) }

// Charleston, where the F350 and the dump trailer park (1° lat ≈ 111,195 m).
const BASE = { lat: 32.989, lng: -80.067 }
const at = (id, north, east = 0) => ({ id, lat: BASE.lat + north / 111_195, lng: BASE.lng + east / 93_300 })

// 1) The F350 and the trailer it tows: ~15 m apart — zooming can't part them.
{
  const pts = [at('f350', 0), at('trailer', 12, 9)]
  const m = S.stackMove(pts)
  ok('truck + trailer fan out', m.kind === 'fan', JSON.stringify(m))
  ok('truck + trailer span ~15 m', Math.abs(m.spanM - 15) < 2, String(m.spanM))
}
// 2) A crew phone in the cab: the same spot exactly.
{
  const m = S.stackMove([at('truck', 0), at('phone', 0)])
  ok('co-located fan out', m.kind === 'fan' && m.spanM === 0)
}
// 3) Two trucks at a site 300 m apart: zoom in and they split.
{
  const pts = [at('a', 0), at('b', 300)]
  const m = S.stackMove(pts)
  ok('spread pair fits', m.kind === 'fit', JSON.stringify(m))
  ok('fit bounds hold both', m.bounds[0][1] <= pts[0].lat && m.bounds[1][1] >= pts[1].lat)
}
// 4) The Upstate at state zoom: one circle, counties apart — fit.
{
  const pts = [at('greenville', 0), at('spartanburg', 30000, 40000), at('anderson', -20000, -35000)]
  const m = S.stackMove(pts)
  ok('region fits', m.kind === 'fit')
  ok('region bounds are west/south → east/north', m.bounds[0][0] < m.bounds[1][0] && m.bounds[0][1] < m.bounds[1][1])
}
// 5) The yard: 20 machines parked nose to tail within 30 m — the list, not a fan.
{
  const pts = Array.from({ length: 20 }, (_, i) => at(`m${i}`, (i % 5) * 6, Math.floor(i / 5) * 6))
  const m = S.stackMove(pts)
  ok('big stack at one spot lists', m.kind === 'list', JSON.stringify(m))
  const m8 = S.stackMove(pts.slice(0, 8))
  ok('eight at one spot still fan', m8.kind === 'fan')
  const m9 = S.stackMove(pts.slice(0, 9))
  ok('nine list', m9.kind === 'list')
}
// 6) The 40 m line.
{
  ok('35 m fans', S.stackMove([at('a', 0), at('b', 35)]).kind === 'fan')
  ok('45 m fits', S.stackMove([at('a', 0), at('b', 45)]).kind === 'fit')
}
// 7) Bad coordinates never decide anything.
{
  const pts = [at('a', 0), { id: 'x', lat: NaN, lng: NaN }, at('b', 10)]
  ok('NaN ignored in span', Math.abs(S.spanMetres(pts) - 10) < 1)
  ok('NaN ignored in centroid', Math.abs(S.centroidOf(pts)[1] - (BASE.lat + 5 / 111_195)) < 1e-9)
  ok('one point spans nothing', S.spanMetres([at('a', 0)]) === 0)
  ok('no points, no centroid', S.centroidOf([]) === null)
}
// 8) The layout: a pair opens above and below with names above and below;
//    three or more open as a column beside the circle, names outward, rows
//    far enough apart for a two-line name; nothing sits on the circle.
{
  const two = S.fanLayout(2)
  ok('pair above/below', two.length === 2 && two[0].x === 0 && two[1].x === 0 && two[0].y < 0 && two[1].y > 0, JSON.stringify(two))
  ok('pair names above/below', two[0].anchor === 'bottom' && two[1].anchor === 'top')
  const right = S.fanLayout(5, 1)
  ok('column right, names to the right', right.every((o) => o.x > 0 && o.anchor === 'left'), JSON.stringify(right))
  const left = S.fanLayout(5, -1)
  ok('column left, names to the left', left.every((o) => o.x < 0 && o.anchor === 'right'))
  ok('column centred on the circle', right[0].y === -right[4].y && right[2].y === 0)
  for (const n of [2, 3, 5, 8]) {
    const o = S.fanLayout(n)
    let minGap = Infinity
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minGap = Math.min(minGap, Math.hypot(o[i].x - o[j].x, o[i].y - o[j].y))
    ok(`${n}: rows ≥ 36 px apart (a two-line name fits)`, minGap >= 36, String(minGap))
    ok(`${n}: pucks clear of the circle (≥ 44 px out)`, o.every((p) => Math.hypot(p.x, p.y) >= 44))
  }
  ok('nothing to fan', S.fanLayout(0).length === 0)
}
// 9) An open fan folds when the stack breaks — measured at the zoom it
//    opened at: a member that pulled off, or a newcomer that came within
//    reach. A neighbour that was already parked nearby never "joins".
{
  const members = [at('f350', 0), at('trailer', 7)]
  ok('stack holds', S.fanStillHolds(members, [at('far', 5000)]))
  ok('member drove off → fold', !S.fanStillHolds([at('f350', 0), at('trailer', 400)], []))
  ok('newcomer parked in it → fold', !S.fanStillHolds(members, [at('newcomer', 8, 3)]))
  ok('one member left → fold', !S.fanStillHolds([at('f350', 0)], []))
  // z17 at Charleston: one stack ≈ 20 m. The RAM parked 25 m off the pair.
  const j17 = S.stackRadiusMetres(17, BASE.lat)
  ok('z17 reach ≈ 20 m', j17 > 18 && j17 < 22, String(j17))
  ok('z18 reach ≈ 10 m', Math.abs(S.stackRadiusMetres(18, BASE.lat) - j17 / 2) < 0.01)
  const ram = at('ram', 25)
  ok('neighbour 25 m off at z17 is not a newcomer', S.fanStillHolds(members, [ram], j17))
  const near = S.nearbyIds(members, [at('ram', 15)], j17)
  ok('a neighbour already within reach at open is remembered', near.has('ram'))
  ok('…and never folds the fan', S.fanStillHolds(members, [at('ram', 15)], j17, near))
  ok('someone new within reach still folds it', !S.fanStillHolds(members, [at('ram', 15), at('phone', 3, 2)], j17, near))
  const j18 = S.stackRadiusMetres(18, BASE.lat)
  ok('at z18 a truck 15 m off its trailer is its own puck → fold', !S.fanStillHolds([at('f350', 0), at('trailer', 15)], [], j18))
  ok('at z18 a pair 6 m apart holds', S.fanStillHolds([at('f350', 0), at('trailer', 6)], [], j18))
}
// 10) It fits a phone, and slides fully into view.
{
  const names = ['2016 Ford F350 — Charleston', 'Kaufman Dump Trailer — Charleston']
  const e = S.fanExtent(names)
  // The phone map's clear area: 390 wide, LAYERS tab 36, buttons + a name 120.
  const safe = { left: 36, right: 270, top: 110, bottom: 520 }
  ok('truck + trailer fit a phone across', e.maxX - e.minX <= safe.right - safe.left, JSON.stringify(e))
  ok('long names wrap, never widen past the cap', S.nameBox('Kaufman Dump Trailer — Charleston').w === S.FAN_NAME_W && S.nameBox('F350').h === 14)
  const col = S.fanExtent(Array.from({ length: 8 }, () => 'Takeuchi TB235 Mini-Ex'), 1)
  ok('a column of eight fits a phone', col.maxX - col.minX <= safe.right - safe.left && col.maxY - col.minY <= safe.bottom - safe.top, JSON.stringify(col))
  const at2 = (x, y, b) => ({ minX: x + b.minX, maxX: x + b.maxX, minY: y + b.minY, maxY: y + b.maxY })
  ok('centred pair stays put', JSON.stringify(S.nudgeInto(at2(153, 300, e), safe)) === '[0,0]')
  const [dx] = S.nudgeInto(at2(40, 300, e), safe)
  ok('pair at the left edge slides right (pan −x)', dx < 0 && 40 + e.minX - dx >= 36, String(dx))
  const [dx2] = S.nudgeInto(at2(220, 300, col), safe)
  ok('column under the buttons slides left (pan +x)', dx2 > 0 && 220 + col.maxX - dx2 <= 270, String(dx2))
  const [, dy] = S.nudgeInto(at2(153, 120, e), safe)
  ok('pair under the top bar slides down (pan −y)', dy < 0 && 120 + e.minY - dy >= 110, String(dy))
  const [cx] = S.nudgeInto({ minX: 0, maxX: 400, minY: 200, maxY: 220 }, safe)
  ok('too wide to fit: centred', cx === 200 - (36 + 270) / 2, String(cx))
}

console.log(`map-stacks: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
