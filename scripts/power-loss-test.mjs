/**
 * The lost-truck-power detector, asserted (run: node scripts/power-loss-test.mjs).
 *
 * Each case is a shape the real fleet produced in the week this shipped:
 * Truck 4's plug coming out at 16 mph, the Charleston RAM's one-minute
 * flicker at 43 mph, a parked unplug that shows as one low fix and then a
 * long gap, a battery TAT141 that never has truck power at all. Run it after
 * ANY change to lib/power-loss.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Run the TS through the same transpile Next uses, so the test exercises the
// shipped source rather than a hand-kept copy.
const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/power-loss.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const { externalVolts, powerState, assessPower, powerLostReason, silenceDiagnosis, clockLabel, shortName, POWERED_MIN_V, PERSIST_MS, PLUG_HINT, NAME_MAX } = mod

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`)
}

const T0 = Date.parse('2026-09-17T21:31:20Z') // Thu 5:31:20 PM EDT — Truck 4's last powered fix
const iso = (offsetSec) => new Date(T0 + offsetSec * 1000).toISOString()
const fix = (offsetSec, volts, speed = 16) => ({ timestamp: iso(offsetSec), volts, speed })
const TZ = 'America/New_York'

// ── externalVolts / powerState ────────────────────────────────────────────
ok('volts from raw', externalVolts({ 'external.powersource.voltage': 13.442 }) === 13.442)
ok('millivolt devices normalised', externalVolts({ 'external.powersource.voltage': 13442 }) === 13.442)
ok('missing key is null, never 0', externalVolts({ 'battery.voltage': 3.6 }) === null)
ok('negative is null', externalVolts({ 'external.powersource.voltage': -1 }) === null)
ok('non-object is null', externalVolts(null) === null && externalVolts('x') === null)
ok('13.4 V is powered', powerState(13.4) === 'powered')
ok('1.7 V is battery', powerState(1.745) === 'battery')
ok('0 V is battery', powerState(0) === 'battery')
ok('threshold is inclusive', powerState(POWERED_MIN_V) === 'powered' && powerState(POWERED_MIN_V - 0.01) === 'battery')
ok('null stays null', powerState(null) === null && powerState(undefined) === null)

// ── Truck 4, Sep 17: powered → plug out at 16 mph → battery run ──────────
const truck4 = (lastOffset) => [
  fix(-8, 13.44), fix(-4, 13.45), fix(0, 13.442),
  fix(2, 1.745, 16), fix(6, 4.07, 18), fix(10, 3.9, 22),
  fix(lastOffset, 3.8, 30),
]
{
  const v = assessPower(truck4(30))
  ok('fresh loss: battery state but too soon to call', v.state === 'battery' && v.change === null, v)
  ok('fresh loss still names its start', v.since === iso(2), v)
}
{
  const v = assessPower(truck4(2 + PERSIST_MS / 1000))
  ok('loss called once it has held PERSIST_MS', v.change === 'lost', v)
  ok('since = first battery fix, not the last powered one', v.since === iso(2), v)
  ok('the moment carries its speed (16 mph → moving)', v.at?.speed === 16, v)
}
{
  // Same data delivered newest-first, with beacon-event rows (no voltage)
  // sprinkled in — they are ignored, never read as 0 V.
  const rows = [...truck4(70)].reverse()
  rows.splice(2, 0, { timestamp: iso(1), volts: null, speed: 16 }, { timestamp: iso(40), volts: null, speed: 20 })
  const v = assessPower(rows)
  ok('order-independent and null-voltage rows ignored', v.change === 'lost' && v.since === iso(2), v)
}

// ── Charleston RAM: 7.03 → 4.05 → 13.75 inside one minute at 43 mph ────
{
  const flicker = [fix(-60, 13.7, 43), fix(-30, 7.03, 43), fix(-26, 4.05, 43), fix(0, 13.751, 42), fix(4, 13.72, 42)]
  const v = assessPower(flicker)
  ok('flicker ends powered → restored, not lost', v.state === 'powered' && v.change === 'restored', v)
  ok('restored since = first powered fix after the dip', v.since === iso(0), v)
  const midDip = assessPower(flicker.slice(0, 3))
  ok('mid-flicker (26 s on battery) is not yet a loss', midDip.change === null && midDip.state === 'battery', midDip)
}

// ── parked unplug: one low fix, then a five-minute gap ───────────────────
{
  const parked = [fix(-3600, 12.9, 0), fix(-5, 13.886, 0), fix(0, 1.12, 0)]
  const v1 = assessPower(parked)
  ok('a single low fix is not a loss yet', v1.change === null, v1)
  const v2 = assessPower([...parked, fix(300, 4.0, 0)])
  ok('the next fix five minutes later makes it one', v2.change === 'lost' && v2.since === iso(0), v2)
  ok('reason says parked', powerLostReason('Truck 4', v2.since, v2.at.speed, TZ, T0 + 400_000).includes('while parked'))
}

// ── units that never have truck power ────────────────────────────────────
{
  const tat = [fix(-7200, null, 0), fix(-3600, null, 0), fix(0, null, 0)]
  const v = assessPower(tat)
  ok('battery unit: no state, no change', v.state === null && v.change === null && v.since === null, v)
  const allLow = [fix(-7200, 0, 0), fix(-3600, 0, 0), fix(0, 0, 0)]
  const w = assessPower(allLow)
  ok('window entirely on battery: change unknown, not re-fired', w.state === 'battery' && w.change === null && w.since === null, w)
  const allHigh = [fix(-7200, 12.6, 0), fix(-3600, 12.7, 0), fix(0, 14.1, 5)]
  const x = assessPower(allHigh)
  ok('steady truck power: nothing to say', x.state === 'powered' && x.change === null, x)
  ok('empty input is safe', assessPower([]).state === null)
}

// ── wording ───────────────────────────────────────────────────────────────
{
  const r = powerLostReason('Truck 4', iso(2), 16, TZ, T0 + 60_000)
  ok('reason names the unit, the time and the motion', r.startsWith('Truck 4 lost truck power at 5:31 PM while moving (16 mph)'), r)
  ok('reason carries the plug hint', r.endsWith(PLUG_HINT), r)
  ok('reason says what happens next', /go dark within the hour/.test(r), r)
  ok('clock label fresh = time only', clockLabel(T0, TZ, T0 + 3_600_000) === '5:31 PM', clockLabel(T0, TZ, T0 + 3_600_000))
  ok('clock label a day later carries the weekday', /^Thu/.test(clockLabel(T0, TZ, T0 + 30 * 3_600_000)), clockLabel(T0, TZ, T0 + 30 * 3_600_000))
  ok('bad tz does not throw', typeof clockLabel(T0, 'Not/AZone', T0) === 'string')
  ok('unparsable stamp does not throw', clockLabel(NaN, TZ) === 'an unknown time')
  ok('long names are cut for a push body', shortName('x'.repeat(200)).length <= NAME_MAX && shortName('x'.repeat(200)).endsWith('…'))
  ok('short names pass through, blank becomes Tracker', shortName(' Truck 4 ') === 'Truck 4' && shortName('   ') === 'Tracker' && shortName(null) === 'Tracker')
  ok('the reason uses the short name', powerLostReason('y'.repeat(300), iso(2), 0, TZ, T0 + 60_000).length < 400)
}
{
  const now = T0 + 26 * 3_600_000
  const base = { lastFixIso: iso(24 * 60), tz: TZ, nowMs: now, lastSpeed: 52, battery: 41 }
  const a = silenceDiagnosis({ ...base, lastVolts: 0, powerLostAtIso: iso(2) })
  ok('diagnosis: a recorded loss leads with it', /^Lost truck power at Thu 5:31 PM/.test(a) && a.includes(PLUG_HINT), a)
  const b = silenceDiagnosis({ ...base, lastVolts: 0, powerLostAtIso: null })
  ok('diagnosis: on battery at last fix, no event (pre-feature history)', /already on its own battery/.test(b) && b.includes(PLUG_HINT), b)
  const c = silenceDiagnosis({ ...base, lastVolts: 12.745, lastSpeed: 0, powerLostAtIso: null })
  ok('diagnosis: had power, parked → coverage/SIM, no plug talk', /Had truck power/.test(c) && /parked/.test(c) && !c.includes(PLUG_HINT), c)
  const d = silenceDiagnosis({ ...base, lastVolts: null, powerLostAtIso: null })
  ok('diagnosis: battery unit names its battery', /^Battery unit, 41%/.test(d) && /KORE One/.test(d), d)
  // A cleared key-off event from yesterday must not outrank a last fix that
  // plainly had truck power — that unit lost coverage, not its plug.
  const e = silenceDiagnosis({ ...base, lastVolts: 14.1, lastSpeed: 45, powerLostAtIso: iso(-20 * 3600) })
  ok('diagnosis: a powered last fix outranks an older event', /^Had truck power/.test(e) && /moving/.test(e) && !e.includes(PLUG_HINT), e)
  ok('no Hologram anywhere in the wording', ![a, b, c, d].some((s) => /hologram/i.test(s)))
}

console.log(`power-loss: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
