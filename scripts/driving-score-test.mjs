/**
 * Driver safety scores (HammerTrack Safety Score v1), asserted
 * (run: node scripts/driving-score-test.mjs).
 *
 * lib/driving-score.ts is invoice-grade for a different customer: an
 * underwriter reads these numbers. A pothole counted as a hard stop, a GPS
 * glitch counted as speeding, or a drive across local midnight counted
 * twice is a driver wrongly coached and a fleet wrongly priced. Run it after
 * ANY change to lib/driving-score.ts (or the alert engine's zone rules it
 * borrows).
 *
 * The artefact cases are real: on Oct 3–6 every "hard brake" a plain
 * speed-delta query found on the six OBD trucks was a tag-scan record (event
 * 385) stamped a second before the GPS record whose speed it carries, a
 * movement-change record (240) reading 0 mph at 30 km/h, or a GNSS speed
 * still ramping up after an outage.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const asData = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')

const deps = {
  './alerts-engine': asData(transpile('../lib/alerts-engine.ts')),
  './power-loss': asData(transpile('../lib/power-loss.ts')),
  './dates': asData(transpile('../lib/dates.ts')),
}
let js = transpile('../lib/driving-score.ts')
for (const [spec, url] of Object.entries(deps)) js = js.replace(new RegExp(`from ['"]${spec.replace('.', '\\.')}['"]`, 'g'), `from '${url}'`)
const D = await import(asData(js))
const M = D.SAFETY_METHOD

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`) }
const near = (a, b, eps) => Math.abs(a - b) <= eps

// ── Stream builders ─────────────────────────────────────────────────────────
const NY = 'America/New_York'
const LAT0 = 34.85, LNG0 = -82.4
const M_PER_DEG_LAT = 110_574
/** A drive due north: [seconds-from-start, mph] keyframes, sampled every
 *  `step` s, positions integrated from the speeds so miles agree with mph. */
function drive(startMs, keys, step = 1, extra = {}) {
  const out = []
  let lat = LAT0, prevV = keys[0][1]
  const end = keys[keys.length - 1][0]
  const vAt = (s) => {
    for (let i = 1; i < keys.length; i++) {
      const [s0, v0] = keys[i - 1], [s1, v1] = keys[i]
      if (s <= s1) return s1 === s0 ? v1 : v0 + (v1 - v0) * ((s - s0) / (s1 - s0))
    }
    return keys[keys.length - 1][1]
  }
  for (let t = 0; t <= end + 1e-9; t += step) {
    const v = vAt(t)
    if (t > 0) lat += (((prevV + v) / 2) * 0.44704 * step) / M_PER_DEG_LAT
    out.push({ ms: startMs + Math.round(t * 1000), lat, lng: LNG0, speed: Math.round(v), valid: true, sats: 12, hdop: 0.8, heading: 0, ...extra })
    prevV = v
  }
  return out
}
const at = (iso) => Date.parse(iso)
const T0 = at('2026-10-06T14:00:00Z') // 10:00 AM EDT, a Tuesday
const cruise = (mph, secs, step = 1, start = T0) => drive(start, [[0, mph], [secs, mph]], step)
const kinds = (evs) => evs.map((e) => `${e.kind}:${e.severity}:${e.source}${e.confirmed === false ? ':unconfirmed' : ''}`)
const day = (fixes, o = {}) => D.analyzeDay({ fixes, dayKey: '2026-10-06', tz: NY, ...o })
const withKeys = (fixes, s, h) => fixes.map((f) => (f.ms === T0 + s * 1000 ? { ...f, harsh: h } : f))

// ── Units, decoding, vehicle class ──────────────────────────────────────────
ok('1 g is 21.94 mph per second', near(D.G_MPH_PER_S, 21.937, 0.01), D.G_MPH_PER_S)
{
  const f = D.decodeFix([T0, 34.8, -82.4, 41, true, true, 13, 0.7, null, 13.9, { 'harsh.braking.event': true }, 182, 66])
  ok('decodeFix reads the builder\'s compact array', f && f.ms === T0 && f.speed === 41 && f.valid === true && f.sats === 13 && f.volts === 13.9 && f.harsh['harsh.braking.event'] === true, f)
  ok('…heading, and the OBD speed in mph', f.heading === 182 && near(f.obd, 41.0, 0.1), f)
  ok('decodeFix refuses a row without a position', D.decodeFix([T0, null, -82.4]) === null)
}
ok('GVWR Class 2E (6,001–7,000 lb) = light', D.vehicleClassOf({ gvwr: 'Class 2E: 6,001 - 7,000 lb' }) === 'light')
ok('GVWR Class 3 (10,001–14,000 lb) = medium/heavy', D.vehicleClassOf({ gvwr: 'Class 3: 10,001 - 14,000 lb' }) === 'heavy')
ok('GVWR typed as "11,500 lb" = heavy; "9,900" = light', D.vehicleClassOf({ gvwr: '11,500 lb' }) === 'heavy' && D.vehicleClassOf({ gvwr: '9,900' }) === 'light')
ok('GVWR in kg is converted (5,200 kg = 11,464 lb)', D.vehicleClassOf({ gvwr: '5200 kg' }) === 'heavy')
ok('no GVWR: a dump-truck icon = heavy, a pickup = light, nothing = light', D.vehicleClassOf({ icon: 'dump-truck' }) === 'heavy' && D.vehicleClassOf({ icon: 'pickup' }) === 'light' && D.vehicleClassOf(null) === 'light')
ok('the GVWR outranks the icon', D.vehicleClassOf({ gvwr: 'Class 2H: 9,001 - 10,000 lb', icon: 'dump-truck' }) === 'light')

// ── Thresholds by class ─────────────────────────────────────────────────────
ok('light braking: 0.32 g is an event, 0.31 is not', D.harshSeverity('harsh_brake', 0.32, 'light') === 'moderate' && D.harshSeverity('harsh_brake', 0.31, 'light') === null)
ok('light braking: severe at 1.5× (0.48 g)', D.harshSeverity('harsh_brake', 0.47, 'light') === 'moderate' && D.harshSeverity('harsh_brake', 0.48, 'light') === 'severe')
ok('heavy braking: 0.20 g is an event, 0.30 severe', D.harshSeverity('harsh_brake', 0.20, 'heavy') === 'moderate' && D.harshSeverity('harsh_brake', 0.30, 'heavy') === 'severe')
ok('light launch 0.28 g, heavy corner 0.24 g', D.harshSeverity('harsh_accel', 0.28, 'light') === 'moderate' && D.harshSeverity('harsh_corner', 0.24, 'heavy') === 'moderate' && D.harshSeverity('harsh_corner', 0.23, 'heavy') === null)

// ── The GPS estimate (coaching only) ────────────────────────────────────────
{
  // 45 → 0 in 2 s, fixes each second: the first second is 0.91 g; the second
  // (25 → 0 = 1.14 g) is past what a truck can do and is dropped, but the
  // maneuver is still one estimated severe hard stop.
  const evs = D.detectEvents(drive(T0, [[0, 45], [10, 45], [11, 25], [12, 0]], 1))
  const brakes = evs.filter((e) => e.kind === 'harsh_brake')
  ok('hard stop 45 → 0 in 2 s = one estimated hard brake', brakes.length === 1 && brakes[0].source === 'gps', kinds(evs))
  ok('…severe, from 45 mph, 0.91 g', brakes[0]?.severity === 'severe' && brakes[0]?.speedMph === 45 && near(brakes[0]?.value ?? 0, 0.91, 0.02), brakes[0])
  const r = day(drive(T0, [[0, 45], [10, 45], [11, 25], [12, 0]], 1))
  ok('…banked as an ESTIMATE, never as a scored hard stop', r.row.brake_est === 1 && r.row.brake_mod + r.row.brake_sev === 0, r.row)
}
ok('an ordinary 8-second stop is not harsh', D.detectEvents(drive(T0, [[0, 40], [5, 40], [13, 0]], 1)).length === 0)
{
  const evs = D.detectEvents(drive(T0, [[0, 50], [5, 50], [6, 41], [7, 32], [8, 25], [12, 20]], 1)).filter((e) => e.kind === 'harsh_brake')
  ok('a 3-second hard brake is one event at its peak (0.41 g, moderate for a pickup)', evs.length === 1 && evs[0].severity === 'moderate' && near(evs[0].value, 0.41, 0.02), evs)
  const heavy = D.detectEvents(drive(T0, [[0, 30], [5, 30], [6, 25], [7, 20], [12, 18]], 1), { vehicleClass: 'heavy' }).filter((e) => e.kind === 'harsh_brake')
  const light = D.detectEvents(drive(T0, [[0, 30], [5, 30], [6, 25], [7, 20], [12, 18]], 1), { vehicleClass: 'light' }).filter((e) => e.kind === 'harsh_brake')
  ok('a 0.23 g stop is an event for a dump truck, not for a pickup', heavy.length === 1 && light.length === 0, [heavy, light])
}
{
  const yard = [0, 6, 2, 9, 1, 8, 0, 7, 3, 9, 0].map((v, i) => ({ ms: T0 + i * 1000, lat: LAT0 + i * 1e-5, lng: LNG0, speed: v, valid: true, sats: 9 }))
  ok('yard jitter under 10 mph = no events', D.detectEvents(yard).length === 0)
  const town = [12, 9, 13, 8, 12, 10, 13].map((v, i) => ({ ms: T0 + i * 1000, lat: LAT0 + i * 5e-5, lng: LNG0, speed: v, valid: true, sats: 9 }))
  ok('±4 mph wobble at town speed = no events', D.detectEvents(town).length === 0, kinds(D.detectEvents(town)))
}
{
  const down = cruise(40, 6); down[3].speed = 20
  ok('a one-fix spike is not a hard brake', D.detectEvents(down).length === 0, kinds(D.detectEvents(down)))
  const up = cruise(30, 6); up[3].speed = 52
  ok('a one-fix upward spike is not a launch', D.detectEvents(up).length === 0, kinds(D.detectEvents(up)))
  const gap = [{ ms: T0, lat: LAT0, lng: LNG0, speed: 45, valid: true, sats: 12 }, { ms: T0 + 10_000, lat: LAT0 + 0.001, lng: LNG0, speed: 0, valid: true, sats: 12 }]
  ok('a 10-second gap hides the peak — no event', D.detectEvents(gap).length === 0)
  ok('fixes 0.3 s apart are never an event', D.detectEvents([{ ms: T0, lat: LAT0, lng: LNG0, speed: 40, valid: true }, { ms: T0 + 300, lat: LAT0, lng: LNG0, speed: 30, valid: true }]).length === 0)
  ok('a jump past 1 g is a glitch', D.detectEvents(drive(T0, [[0, 12], [3, 12], [4, 40], [7, 40]], 1)).filter((e) => e.kind === 'harsh_accel').length === 0)
  const launch = D.detectEvents(drive(T0, [[0, 0], [2, 10], [4, 26], [9, 30]], 1)).filter((e) => e.kind === 'harsh_accel')
  ok('a hard launch from a light is estimated (0.36 g, moderate for a pickup)', launch.length === 1 && launch[0].severity === 'moderate' && launch[0].source === 'gps', launch)
}
{
  const bad = (patch) => { const f = cruise(45, 6); f[3] = { ...f[3], speed: 20, ...patch }; return D.detectEvents(f).length === 0 }
  ok('a no-fix record (position.valid false) is ignored', bad({ valid: false }))
  ok('a zero-satellite record is ignored', bad({ sats: 0 }))
  ok('a poor-HDOP record is ignored', bad({ hdop: 9 }))
}
{
  // d3cc14, Oct 3: GPS records at −1.011 s (24 mph) and +0.989 s (17 mph), a
  // tag-scan record at 0.000 s already reading 17 mph. Real: 3.5 mph/s.
  const fixes = [
    { ms: T0 - 3011, lat: LAT0, lng: LNG0, speed: 31, valid: true, sats: 13 },
    { ms: T0 - 1011, lat: LAT0 + 1e-4, lng: LNG0, speed: 24, valid: true, sats: 13 },
    { ms: T0, lat: LAT0 + 1.4e-4, lng: LNG0, speed: 17, event: 385, sats: 15 },
    { ms: T0 + 989, lat: LAT0 + 1.8e-4, lng: LNG0, speed: 17, valid: true, sats: 15 },
    { ms: T0 + 2989, lat: LAT0 + 2.3e-4, lng: LNG0, speed: 11, valid: true, sats: 17 },
  ]
  ok('a tag-scan record stamped a second early is not a hard brake', D.detectEvents(fixes).length === 0, kinds(D.detectEvents(fixes)))
  const mv = [
    { ms: T0 - 5000, lat: LAT0, lng: LNG0, speed: 7, valid: true, sats: 13 },
    { ms: T0 - 4000, lat: LAT0 + 3e-5, lng: LNG0, speed: 0, valid: true, sats: 13, event: 240 },
    { ms: T0 - 1000, lat: LAT0 + 1e-4, lng: LNG0, speed: 0, valid: true, sats: 13, event: 240 },
    { ms: T0, lat: LAT0 + 1.4e-4, lng: LNG0, speed: 16, valid: true, sats: 13 },
    { ms: T0 + 4000, lat: LAT0 + 3e-4, lng: LNG0, speed: 22, valid: true, sats: 13 },
  ]
  ok('stale 0 mph on movement-change records is not a launch', D.detectEvents(mv).length === 0, kinds(D.detectEvents(mv)))
  const reported = (truth, said) => truth.map((f, i) => ({ ...f, speed: said[i] }))
  const ramp = reported(drive(T0, [[0, 63], [8, 66]], 2), [28, 39, 47, 55, 61])
  ok('a speed field still settling after a GNSS outage is not a launch', D.detectEvents(ramp).length === 0, kinds(D.detectEvents(ramp)))
  const stat = reported(drive(T0, [[0, 20], [4, 20]], 1), [0, 0, 14, 14, 14])
  ok('a launch measured from a static-navigation 0 is not a launch', D.detectEvents(stat).length === 0, kinds(D.detectEvents(stat)))
  const lone = reported(drive(T0, [[0, 40], [8, 40]], 1).filter((_, i) => i <= 3 || i === 7), [40, 40, 40, 20, 40])
  ok('a lone low reading with the next fix 4 s later is still a spike', D.detectEvents(lone).length === 0, kinds(D.detectEvents(lone)))
}

// ── The truck's accelerometer: scored only when the speed agrees ────────────
{
  const stop = drive(T0, [[0, 45], [10, 45], [11, 36], [12, 28], [16, 20]], 1)
  const dev = withKeys(stop, 11, { 'harsh.braking.event': true, 'absolute.acceleration': 0.42 })
  const r = day(dev)
  const brake = r.events.find((e) => e.kind === 'harsh_brake')
  ok('a device hard brake the speed confirms is scored', brake?.source === 'device' && brake?.confirmed === true && r.row.brake_mod === 1, [brake, r.row.brake_mod])
  ok('…and the GPS estimate of the same stop stands down', r.events.filter((e) => e.kind === 'harsh_brake').length === 1 && r.row.brake_est === 0)
  ok('…and the day is marked accelerometer-on', r.row.accel_on === true && r.row.accel_seen === true)
  const inherited = day(cruise(45, 20), { accelerometerOn: true }).row
  ok('on by the look-back alone: measured, but not SEEN (a switched-off unit ages out)', inherited.accel_on === true && inherited.accel_seen === false)
  const crashOnly = day(withKeys(cruise(45, 20), 10, { 'crash.detection': 3 })).row
  ok('a crash-detection record alone does not switch harsh events to measured', crashOnly.accel_on === false && crashOnly.accel_seen === false)
  const pothole = withKeys(cruise(45, 20), 10, { 'harsh.braking.event': true, 'absolute.acceleration': 0.55 })
  const p = day(pothole)
  ok('a device "hard brake" at a steady 45 mph (a pothole) is unconfirmed, not scored', p.row.unconfirmed_n === 1 && p.row.brake_mod + p.row.brake_sev === 0 && p.events[0]?.confirmed === false, [p.row.unconfirmed_n, p.events])
  // GPS lags the truck's own speedometer by seconds: the OBD speed confirms.
  const lag = cruise(45, 20).map((f) => ({ ...f, obd: f.ms < T0 + 10_000 ? 45 : f.ms <= T0 + 13_000 ? 45 - ((f.ms - T0 - 10_000) / 1000) * 8 : 21 }))
  const l = day(withKeys(lag, 11, { 'harsh.braking.event': true, 'absolute.acceleration': 0.4 }))
  ok('the truck\'s own speedometer confirms when GPS speed lags', l.row.brake_mod === 1 && l.row.unconfirmed_n === 0, l.row)
  ok('accelerometer on → no GPS estimates at all', D.detectEvents(stop, { accelerometerOn: true }).filter((e) => e.kind === 'harsh_brake').length === 0)
}
{
  const rec = (h) => [{ ms: T0 - 2000, lat: LAT0, lng: LNG0, speed: 40, valid: true, heading: 0 }, { ms: T0, lat: LAT0 + 2e-4, lng: LNG0, speed: 34, valid: true, heading: 0, harsh: h }, { ms: T0 + 2000, lat: LAT0 + 4e-4, lng: LNG0, speed: 28, valid: true, heading: 0 }]
  const one = (h, o = {}) => D.detectEvents(rec(h), o).find((e) => e.source === 'device')
  ok('green.driving.value 47 (g × 100 on the wire) = 0.47 g, moderate for a pickup', (() => { const e = one({ 'green.driving.type': 2, 'green.driving.value': 47 }); return e?.kind === 'harsh_brake' && e.value === 0.47 && e.severity === 'moderate' })())
  ok('…the same 0.47 g is severe for a dump truck', one({ 'green.driving.type': 2, 'green.driving.value': 47 }, { vehicleClass: 'heavy' })?.severity === 'severe')
  ok('a device event gentler than our standard is not counted', one({ 'harsh.acceleration.event': true, 'absolute.acceleration': 0.25 }) === undefined)
  ok('a device event with no value counts as moderate', one({ 'harsh.braking.event': true })?.severity === 'moderate')
  const turn = (deg, mph) => D.detectEvents([0, 1, 2, 3].map((i) => ({ ms: T0 + (i - 1) * 1000, lat: LAT0 + i * 1e-4, lng: LNG0, speed: mph, valid: true, heading: i * deg, harsh: i === 1 ? { 'harsh.cornering.event': true, 'absolute.acceleration': 0.4 } : null })))
  ok('a hard corner at speed with a real turn is confirmed', turn(15, 28)[0]?.confirmed === true, turn(15, 28))
  ok('a hard corner with no turn in the heading is unconfirmed', turn(0, 28)[0]?.confirmed === false)
  ok('cornering under 30 km/h is not counted', turn(15, 15).length === 0)
  const crash = D.detectEvents([{ ms: T0, lat: LAT0, lng: LNG0, speed: 30, valid: true, harsh: { 'crash.event': true, 'crash.impact.acceleration': 2.4 } }])
  ok('crash.event = a possible impact, listed', crash[0]?.kind === 'crash' && crash[0].value === 2.4)
  ok('a crash TRACE record (247 = 3) is not a crash', D.detectEvents([{ ms: T0, lat: LAT0, lng: LNG0, speed: 30, harsh: { 'crash.detection': 3 } }]).length === 0)
  ok('the bare `crash` alias (the catalog\'s) is read too: true, or 247 = 1', D.detectEvents([{ ms: T0, lat: LAT0, lng: LNG0, speed: 30, harsh: { crash: true } }])[0]?.kind === 'crash'
    && D.detectEvents([{ ms: T0, lat: LAT0, lng: LNG0, speed: 30, harsh: { crash: 1 } }])[0]?.kind === 'crash'
    && D.detectEvents([{ ms: T0, lat: LAT0, lng: LNG0, speed: 30, harsh: { crash: 4 } }]).length === 0)
  const twice = D.detectEvents([0, 40].map((s) => ({ ms: T0 + s * 1000, lat: LAT0, lng: LNG0, speed: 30, harsh: { 'crash.event': true } })))
  ok('one impact reported twice in 40 s is one', twice.filter((e) => e.kind === 'crash').length === 1)
}

// ── Speeding: 70 on the interstate is legal; 80 for 20 s is not ─────────────
{
  const i70 = day(cruise(70, 600, 2))
  ok('70 mph on the interstate for 10 minutes is not speeding', i70.row.max_sev_s === 0 && i70.events.length === 0 && i70.row.zone_mod_s === 0, i70.row)
  const fast = day(cruise(82, 30, 2))
  ok('82 mph for 30 s = one top-speed run, severe', fast.events.length === 1 && fast.events[0].kind === 'max_speed' && fast.events[0].severity === 'severe', fast.events)
  ok('…its 30 s banked as severe speeding time', near(fast.row.max_sev_s, 30, 0.5), fast.row)
  ok('82 mph for 15 s is not a run', day(cruise(82, 15, 1)).row.max_sev_s === 0 && day(cruise(82, 15, 1)).events.length === 0)
  ok('a dump truck\'s line is 75 mph', day(cruise(76, 25, 1), { vehicleClass: 'heavy' }).events[0]?.kind === 'max_speed' && day(cruise(76, 25, 1)).events.length === 0)
}
{
  const mLng = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180))
  const pt = (e, n) => [LNG0 + e * mLng, LAT0 + n / M_PER_DEG_LAT]
  const ring = [[-100, -100], [400, -100], [400, 2000], [-100, 2000], [-100, -100]].map(([e, n]) => pt(e, n))
  const zone = { id: 'z1', name: 'Creekside', ring, limitMph: 15 }
  const z = (keys, step = 2) => day(drive(T0, keys, step), { zones: [zone] })
  const mod = z([[0, 23], [70, 23]])
  ok('8 over a site\'s 15 mph for 70 s = moderate speeding', near(mod.row.zone_mod_s, 70, 1) && mod.events[0]?.kind === 'zone_speeding' && mod.events[0]?.severity === 'moderate', [mod.row.zone_mod_s, mod.events])
  ok('8 over for 40 s is not (moderate needs 60 s)', z([[0, 23], [40, 23]]).row.zone_mod_s === 0 && z([[0, 23], [40, 23]]).events.length === 0)
  const heavy = z([[0, 28], [70, 28]])
  ok('13 over for 70 s = heavy', near(heavy.row.zone_heavy_s, 70, 1) && heavy.events[0]?.severity === 'heavy', heavy.row)
  const sev = z([[0, 33], [24, 33]])
  ok('18 over for 24 s = severe', near(sev.row.zone_sev_s, 24, 1) && sev.events[0]?.severity === 'severe', sev.row)
  ok('18 over for 14 s is nothing', z([[0, 33], [14, 33]]).row.zone_sev_s === 0)
  const mixed = z([[0, 23], [50, 23], [50.01, 33], [76, 33]])
  ok('50 s at 8 over then 26 s at 18 over: the 50 s moderate, the 26 s severe', near(mixed.row.zone_mod_s, 50, 2) && near(mixed.row.zone_sev_s, 26, 2), mixed.row)
  ok('…one episode, scored at its worst', mixed.events.length === 1 && mixed.events[0].severity === 'severe', mixed.events)
  const edge = day(drive(T0, [[0, 40], [90, 40]], 2).map((f) => ({ ...f, lng: LNG0 + 398 * mLng })), { zones: [zone] })
  ok('a road along the fence is never site speeding', edge.events.length === 0 && edge.row.zone_mod_s + edge.row.zone_heavy_s + edge.row.zone_sev_s === 0, edge.row)
  ok('miles inside a site with a limit are "miles with a known limit"', mod.row.limit_miles > 0 && near(mod.row.limit_miles, mod.row.miles, 0.01), mod.row)
}

// ── Local midnight, late night, DST ─────────────────────────────────────────
{
  const fixes = drive(at('2026-10-07T03:55:00Z'), [[0, 40], [900, 40]], 2) // 11:55 PM → 12:10 AM EDT
  const d6 = D.analyzeDay({ fixes, dayKey: '2026-10-06', tz: NY }).row
  const d7 = D.analyzeDay({ fixes, dayKey: '2026-10-07', tz: NY }).row
  ok('across local midnight: 5 min land on the evening of the 6th', near(d6.moving_s, 300, 2) && near(d6.evening_s, 300, 2) && d6.night_s === 0, d6)
  ok('…and 10 min on the late night of the 7th', near(d7.moving_s, 600, 2) && near(d7.night_s, 600, 2) && d7.evening_s === 0, d7)
  ok('…every second exactly once', near(d6.moving_s + d7.moving_s, 900, 1))
  ok('…miles split the same way', near(d6.miles + d7.miles, 10, 0.1) && near(d7.miles / (d6.miles + d7.miles), 2 / 3, 0.01), [d6.miles, d7.miles])
  const den = D.analyzeDay({ fixes, dayKey: '2026-10-06', tz: 'America/Denver' }).row
  ok('the company\'s zone decides: in Denver that drive is 10 min of evening, no late night', near(den.evening_s, 600, 2) && den.night_s === 0 && near(den.moving_s, 900, 2), den)
  ok('spring-forward 4 AM is three hours after midnight', D.zonedLocalMs('2026-03-08', 240, NY) - D.zonedLocalMs('2026-03-08', 0, NY) === 3 * 3_600_000)
  ok('fall-back 4 AM is five hours after midnight', D.zonedLocalMs('2026-11-01', 240, NY) - D.zonedLocalMs('2026-11-01', 0, NY) === 5 * 3_600_000)
  const dst = D.analyzeDay({ fixes: drive(at('2026-03-08T06:30:00Z'), [[0, 35], [7200, 35]], 3), dayKey: '2026-03-08', tz: NY }).row
  ok('DST day: late-night seconds stop at 4 AM local (08:00Z)', near(dst.night_s, 5400, 3) && near(dst.moving_s, 7200, 3), dst)
  const crew = D.analyzeDay({ fixes: drive(at('2026-10-06T09:00:00Z'), [[0, 45], [3600, 45]], 3), dayKey: '2026-10-06', tz: NY }).row
  ok('a 5 AM crew start is not late night', crew.night_s === 0 && near(crew.moving_s, 3600, 3), crew)
}

// ── Data-quality inputs ─────────────────────────────────────────────────────
{
  const a = drive(T0, [[0, 45], [1200, 45]], 5)
  const b = drive(T0 + 2_700_000, [[0, 45], [600, 45]], 5).map((f) => ({ ...f, lat: f.lat + 0.3 }))
  const r = day([...a, ...b]).row
  ok('a drive with no data in it is a gap, not driving', near(r.gap_s, 1500, 1) && near(r.moving_s, 1800, 2) && r.longest_gap_s === 1500, r)
  ok('5-second sampling is not dense enough for a GPS estimate', r.dense_s === 0)
  const v = (secs, volts) => ({ ms: T0 + secs * 1000, lat: LAT0, lng: LNG0, speed: 20, valid: true, volts })
  ok('plug out for 90 s = one power drop', D.powerDrops([v(0, 13.9), v(30, 1.6), v(60, 1.5), v(120, 1.5)], T0 - 1, T0 + 1e6) === 1)
  ok('a 30-second flicker is not', D.powerDrops([v(0, 13.9), v(10, 4.1), v(40, 13.7)], T0 - 1, T0 + 1e6) === 0)
  ok('a battery unit that never had truck power has no drops', D.powerDrops([v(0, 4.0), v(600, 3.9)], T0 - 1, T0 + 1e6) === 0)
  const flags = cruise(30, 1200, 60).map((f, i) => ({ ...f, harsh: i === 2 ? { 'battery.unplug.event': true } : i === 4 || i === 5 ? { 'gnss.jamming.state': 1 } : i === 15 ? { 'towing.event': true } : null }))
  const q = day(flags, { rejects: 2 }).row
  ok('unplug, jamming (deduped) and towing events are counted', q.unplug_n === 1 && q.jamming_n === 1 && q.towing_n === 1, q)
  ok('refused GPS spikes ride along', q.rejects_n === 2)
  const obd = day(cruise(40, 120, 2).map((f) => ({ ...f, obd: 40, ignition: true }))).row
  ok('moving time on the truck\'s own speedometer is counted', near(obd.obd_s, 120, 1), obd)
  ok('engine time comes from the ignition', near(obd.engine_s, 120, 1), obd)
}

// ── Who was aboard ──────────────────────────────────────────────────────────
{
  const truck = drive(T0, [[0, 35], [400, 35], [402, 23], [900, 23]], 2)
  const phoneOf = (offsetM, every = 30) => truck.filter((_, i) => i % (every / 2) === 0).map((f) => ({ ms: f.ms, lat: f.lat + offsetM / M_PER_DEG_LAT, lng: f.lng, speed: f.speed }))
  const shift = [[T0 - 3_600_000, T0 + 3_600_000]]
  const withBrake = withKeys(truck, 402, { 'harsh.braking.event': true, 'absolute.acceleration': 0.5 })
  const solo = day(withBrake, { riders: [{ personId: 'p1', fixes: phoneOf(20), shifts: shift }] })
  ok('a clocked-in phone riding along is aboard', solo.row.drivers.p1 && near(solo.row.drivers.p1.ss, 900, 70), solo.row.drivers)
  ok('…and the lone rider is charged the confirmed event', solo.events.find((e) => e.kind === 'harsh_brake')?.personId === 'p1' && solo.row.brake_sev === 1, solo.events)
  const two = day(withBrake, { riders: [{ personId: 'p1', fixes: phoneOf(20), shifts: shift }, { personId: 'p2', fixes: phoneOf(-25), shifts: shift }] })
  ok('two phones aboard: both rode, neither is charged', two.row.drivers.p1?.ss === 0 && two.row.drivers.p2?.s > 800 && two.events.every((e) => e.personId == null), two.row.drivers)
  ok('a phone that was not clocked in is never attributed', Object.keys(day(truck, { riders: [{ personId: 'p1', fixes: phoneOf(20), shifts: [[T0 + 7_200_000, T0 + 9_000_000]] }] }).row.drivers).length === 0)
  ok('a phone near the truck for one minute is not aboard', Object.keys(day(truck, { riders: [{ personId: 'p3', fixes: phoneOf(20).filter((p) => p.ms < T0 + 60_000), shifts: shift }] }).row.drivers).length === 0)
  ok('a phone 600 m away is not aboard', Object.keys(day(truck, { riders: [{ personId: 'p4', fixes: phoneOf(600), shifts: shift }] }).row.drivers).length === 0)
  const dt = D.driverTotals([solo.row], solo.events, 'p1')
  ok('driverTotals charges solo miles and the lone rider\'s confirmed events', dt.harsh_brake.severe === 1 && near(dt.miles, 6.7, 0.6) && dt.accelMiles > 0, dt)
  ok('the miles tied to a named driver are counted', near(D.sumDaily([solo.row]).attributedMiles, solo.row.miles, 0.6))
}

// ── The score ───────────────────────────────────────────────────────────────
const H = 40 * 3600
const totals = (over) => ({ ...D.emptyTotals(), days: 30, periodDays: 30, drivingDays: 22, accelDays: 22, miles: 1500, accelMiles: 1500, movingS: H, ...over })
const pair = (moderate, severe = 0) => ({ moderate, severe })
{
  ok('249 mi = not enough driving yet', D.scoreTotals(totals({ miles: 249, accelMiles: 249 })).credible === false)
  ok('…9 hours = not enough either', D.scoreTotals(totals({ movingS: 9 * 3600 })).credible === false)
  ok('…250 mi and 10 h = scored', D.scoreTotals(totals({ miles: 250, accelMiles: 250, movingS: 10 * 3600 })).credible === true && /Not enough driving/.test(D.scoreTotals(totals({ miles: 20, accelMiles: 20 })).why))
  ok('a clean month reads A', D.scoreTotals(totals({})).grade === 'A' && D.scoreTotals(totals({})).score === 100)
  ok('one confirmed hard stop per 1,000 mi costs 4 points', D.scoreTotals(totals({ miles: 1000, accelMiles: 1000, harsh_brake: pair(1) })).raw === 96)
  ok('…a severe one counts double (8)', D.scoreTotals(totals({ miles: 1000, accelMiles: 1000, harsh_brake: pair(0, 1) })).raw === 92)
  ok('a hard corner costs 2, a hard launch 1', D.scoreTotals(totals({ miles: 1000, accelMiles: 1000, harsh_corner: pair(1) })).raw === 98 && D.scoreTotals(totals({ miles: 1000, accelMiles: 1000, harsh_accel: pair(1) })).raw === 99)
  ok('events are rated over the miles the accelerometer was on', D.scoreTotals(totals({ miles: 3000, accelMiles: 1000, harsh_brake: pair(2) })).per1000.harsh_brake === 2)
  ok('1% of driving at each speeding tier costs 1 / 4 / 6', D.scoreTotals(totals({ zoneModS: H / 100 })).raw === 99 && D.scoreTotals(totals({ zoneHeavyS: H / 100 })).raw === 96 && D.scoreTotals(totals({ maxSevS: H / 100 })).raw === 94)
  ok('1% of driving between midnight and 4 AM costs 1', D.scoreTotals(totals({ nightS: H / 100 })).raw === 99)
  ok('a possible impact is listed, never scored', D.scoreTotals(totals({ crashes: 2 })).score === 100 && D.scoreTotals(totals({ crashes: 2 })).counts.crash === 2)
  ok('estimated hard stops are never scored', D.scoreTotals(totals({ estBrake: 30 })).score === 100)
  let prev = 101, mono = true, strict = true
  for (let n = 0; n <= 40; n += 2) {
    const s = D.scoreTotals(totals({ harsh_brake: pair(n) })).raw
    if (s > prev) mono = false
    if (n > 0 && n <= 20 && s >= prev) strict = false
    prev = s
  }
  ok('the score never rises with more hard stops', mono)
  ok('…and falls with each one until the floor', strict)
  ok('scores stay inside 0–100', D.scoreTotals(totals({ harsh_brake: pair(500, 500), maxSevS: H, nightS: H })).raw === 0)
  const rough = D.scoreTotals(totals({ harsh_brake: pair(6, 2), harsh_accel: pair(5), zoneHeavyS: H * 0.01, maxSevS: H * 0.02, nightS: H * 0.03 }))
  ok('the conversation truck reads D or F', rough.grade === 'D' || rough.grade === 'F', [rough.score, rough.components])
  ok('…its coaching names its worst habit (braking)', /hard stop/.test(rough.coaching), rough.coaching)
  ok('…components sorted worst-first', rough.components[0].points >= rough.components[1].points)
  const off = D.scoreTotals(totals({ accelDays: 0, accelMiles: 0, estBrake: 4, maxSevS: H * 0.01 }))
  ok('accelerometer off: harsh events are "not measured", the score is speeding + late night', off.per1000.harsh_brake === null && off.components.filter((c) => !c.measured).length === 3 && off.raw === 94, off)
  ok('…and the data-quality block says so', off.quality.accelerometer === 'off' && /not measured yet/.test(off.quality.notes[0]), off.quality.notes)
  ok('…coaching still mentions the estimates as estimates', /accelerometer/.test(D.scoreTotals(totals({ accelDays: 0, accelMiles: 0, estBrake: 4 })).coaching))
  const thin = D.scoreTotals(totals({ miles: 1000, accelMiles: 1000, nightS: H * 0.3 }), { fleetMean: 90 })
  ok('under 3,000 mi the score is blended toward the fleet (Z = √(mi/3000))', thin.raw === 70 && near(thin.z, Math.sqrt(1 / 3), 0.01) && thin.score === Math.round(Math.sqrt(1 / 3) * 70 + (1 - Math.sqrt(1 / 3)) * 90), thin)
  ok('…at 3,000 mi it is its own', D.scoreTotals(totals({ miles: 3000, accelMiles: 3000, nightS: H * 0.1 }), { fleetMean: 100 }).score === 90)
  ok('the vocational line: confirmed events per 100 engine hours', D.scoreTotals(totals({ engineS: 200 * 3600, harsh_brake: pair(4) })).per100EngineHours === 2)
  ok('risk bands for the insurer view', D.riskBand(92) === 'low' && D.riskBand(80) === 'mild' && D.riskBand(61) === 'medium' && D.riskBand(59) === 'high')
}
{
  const q = (o) => D.dataQuality(totals(o))
  ok('accelerometer on, full coverage, never unplugged = good', q({ obdS: H }).verdict === 'good', q({ obdS: H }))
  ok('three unplugs = poor', q({ powerLost: 2, unplugs: 1 }).verdict === 'poor')
  ok('one jamming event = fair at best', q({ jamming: 1, obdS: H }).verdict === 'fair')
  ok('coverage = the share of driving actually recorded', q({ movingS: 9000, gapS: 1000 }).coveragePct === 90)
  ok('device uptime = days reporting ÷ days in the period', q({ days: 27 }).uptimePct === 90 && q({ days: 20, obdS: H }).verdict === 'fair')
  ok('speed source: OBD vs GPS', q({ obdS: H }).speedSource === 'obd' && q({ obdS: 0 }).speedSource === 'gps' && q({ obdS: H / 2 }).speedSource === 'mixed')
  ok('% of miles with a known limit and % tied to a driver', q({ limitMiles: 150, attributedMiles: 750 }).limitPct === 10 && q({ limitMiles: 150, attributedMiles: 750 }).attributedPct === 50)
  ok('unconfirmed accelerometer events are reported', q({ unconfirmed: 3 }).unconfirmed === 3 && q({ unconfirmed: 3 }).notes.some((n) => /did not confirm/.test(n)))
}

// ── Rolling up rows ─────────────────────────────────────────────────────────
{
  const base = D.analyzeDay({ fixes: [], dayKey: '2026-10-06', tz: NY }).row
  const r = (o) => ({ ...base, ...o })
  const t = D.sumDaily([r({ miles: 40.5, moving_s: 3600, brake_est: 1 }), r({ miles: 60, moving_s: 5400, brake_sev: 2, accel_on: true, max_mph: 77 }), r({ moving_s: 0 })], 30)
  ok('sumDaily adds the days', t.days === 3 && t.drivingDays === 2 && t.miles === 100.5 && t.movingS === 9000 && t.maxMph === 77 && t.periodDays === 30, t)
  ok('…accelerometer miles only from accelerometer days', t.accelDays === 1 && t.accelMiles === 60 && t.harsh_brake.severe === 2 && t.estBrake === 1, t)
  const months = D.byMonth([{ day: '2026-09-30' }, { day: '2026-10-01' }, { day: '2026-10-06' }])
  ok('byMonth groups the insurer\'s 12-month series', months.get('2026-09').length === 1 && months.get('2026-10').length === 2)
}

// ── Words + CSV + the one constant ──────────────────────────────────────────
ok('event words: a confirmed device hard brake', D.eventWords({ kind: 'harsh_brake', severity: 'severe', source: 'device', confirmed: true, value: 0.52, speedMph: 41 }) === 'Severe hard brake · 0.52 g from 41 mph')
ok('event words: a GPS estimate says it is not scored', D.eventWords({ kind: 'harsh_brake', severity: 'moderate', source: 'gps', value: 0.36, speedMph: 38 }).endsWith('(GPS estimate, not scored)'))
ok('event words: site speeding', D.eventWords({ kind: 'zone_speeding', severity: 'heavy', source: 'gps', value: 28, speedMph: 28, durationS: 74, limitMph: 15 }, 'Creekside') === '28 mph in a 15 mph site (Creekside) for 1m 14s — heavy')
ok('CSV: a formula-looking name is neutralised', D.csvCell('=HYPERLINK("x")') === `"'=HYPERLINK(""x"")"`)
ok('CSV: numbers stay numbers', D.toCsv(['a', 'b'], [[1.5, 'x,y']]) === 'a,b\r\n1.5,"x,y"\r\n')
ok('the method is one constant: weights 4 / 2 / 1, tiers 1 / 4 / 6, floor 250 mi + 10 h', M.eventWeights.harsh_brake === 4 && M.eventWeights.harsh_corner === 2 && M.eventWeights.harsh_accel === 1
  && M.speedTiers.map((s) => s.weight).join() === '1,4,6' && M.credibility.minMiles === 250 && M.credibility.minHours === 10)

console.log(`driving-score: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
