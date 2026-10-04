/**
 * Zone speeding, said only when plainly true — run after ANY change to
 * lib/alerts-engine.ts. Tenna's reviews: "Speed violations are inaccurate,
 * get them doing 65 in a 20 mph zone" (a highway read as the side road). A
 * site zone with a highway along its fence must never fire on the highway;
 * one fast fix is a glitch, not a habit.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/alerts-engine.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const ae = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`) }

// A 200 m × 120 m site whose south fence runs along a highway (lat0).
const lat0 = 34.85, lng0 = -82.4
const mLat = 1 / 110_574, mLng = 1 / (111_320 * Math.cos((lat0 * Math.PI) / 180))
const at = (east, north) => ({ lng: lng0 + east * mLng, lat: lat0 + north * mLat })
const ring = [[0, 0], [200, 0], [200, 120], [0, 120], [0, 0]].map(([e, n]) => { const p = at(e, n); return [p.lng, p.lat] })
const t0 = Date.parse('2026-10-04T15:00:00Z')
const fix = (east, north, speed, s) => ({ ...at(east, north), speed, timestamp: new Date(t0 + s * 1000).toISOString() })

ok('edge distance: the middle of the site is 60 m from the nearest fence', Math.abs(ae.metresToEdge([at(100, 60).lng, at(100, 60).lat], ring) - 60) < 0.5, ae.metresToEdge([at(100, 60).lng, at(100, 60).lat], ring))
ok('edge distance: 3 m inside the south fence reads 3 m', Math.abs(ae.metresToEdge([at(100, 3).lng, at(100, 3).lat], ring) - 3) < 0.2)

const limit = 15
ok('two fixes in a row, well inside, over the limit → speeding', ae.speedingHolds(ring, limit, fix(110, 60, 31, 10), fix(90, 60, 28, 0)))
ok('the highway along the fence (GPS wanders 6 m inside) → not speeding', !ae.speedingHolds(ring, limit, fix(110, 6, 65, 10), fix(90, 5, 64, 0)))
ok('one fast fix after a slow one → not speeding (a glitch or a truck turning in)', !ae.speedingHolds(ring, limit, fix(110, 60, 40, 10), fix(100, 60, 9, 0)))
ok('no fix before it → not speeding', !ae.speedingHolds(ring, limit, fix(110, 60, 40, 10), null))
ok('the fix before was outside the site → not speeding yet', !ae.speedingHolds(ring, limit, fix(30, 60, 40, 10), at(-40, 60) && { ...at(-40, 60), speed: 45, timestamp: new Date(t0).toISOString() }))
ok('the fix before was 5 minutes earlier → not a run', !ae.speedingHolds(ring, limit, fix(110, 60, 31, 300), fix(90, 60, 28, 0)))
ok('at the limit → not speeding', !ae.speedingHolds(ring, limit, fix(110, 60, 15, 10), fix(90, 60, 15, 0)))
ok('no limit set → never', !ae.speedingHolds(ring, 0, fix(110, 60, 70, 10), fix(90, 60, 70, 0)))

// Small zones: the margin scales with the zone, so a yard limit can fire at all.
const box = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]].map(([e, n]) => { const p = at(e, n); return [p.lng, p.lat] })
ok('margin: the 200 × 120 m site keeps a ~19 m margin', Math.abs(ae.speedEdgeMargin(ring) - 18.75) < 0.3, ae.speedEdgeMargin(ring))
ok('margin: never more than 25 m on a big site', ae.speedEdgeMargin(box(1000, 800)) === 25)
ok('margin: never less than 5 m on a tiny pad', ae.speedEdgeMargin(box(15, 15)) === 5)
ok('a 45 m yard: a run through the middle → speeding', ae.speedingHolds(box(45, 45), 5, fix(25, 22, 14, 6), fix(15, 22, 12, 3)))
ok('a 45 m yard: the road 3 m inside its fence → not speeding', !ae.speedingHolds(box(45, 45), 5, fix(25, 3, 40, 6), fix(15, 3, 40, 3)))
ok('a 40 m-wide haul road: down the middle → speeding', ae.speedingHolds(box(400, 40), 10, fix(200, 20, 25, 6), fix(170, 20, 25, 3)))

// The whole evaluator: the rule only fires with the fix before it.
const rule = { id: 'r1', company_id: 'c', asset_id: null, geofence_id: 'g1', trigger: 'speeding', active: true, params: { max_mph: limit } }
const fence = { id: 'g1', name: 'Creekside', geometry: { type: 'Polygon', coordinates: [ring] } }
const asset = { id: 'a1', name: 'Truck 3' }
const company = { work_start: '07:00', work_end: '17:00', work_days: [1, 2, 3, 4, 5] }
const cur = { id: '', asset_id: 'a1', company_id: 'c', accuracy: null, battery: null, heading: null, raw: null, ...fix(110, 60, 31, 10) }
const fired = ae.evaluateAlerts({ assets: [asset], locations: { a1: cur }, previous: { a1: fix(90, 60, 28, 0) }, rules: [rule], geofences: [fence], company })
ok('evaluator: fires with two fast fixes inside', fired.length === 1 && /31 mph in Creekside \(limit 15\)/.test(fired[0].reason), fired)
const alone = ae.evaluateAlerts({ assets: [asset], locations: { a1: cur }, rules: [rule], geofences: [fence], company })
ok('evaluator: silent on a single fix', alone.length === 0, alone)

console.log(`alerts: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
