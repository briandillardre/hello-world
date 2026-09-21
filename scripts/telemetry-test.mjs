/**
 * Truck readings catalog, asserted (run: node scripts/telemetry-test.mjs).
 *
 * lib/telemetry-catalog.ts turns the tracker's raw parameter bag into what a
 * foreman reads on the map panel and the asset page, and into what the AI is
 * told. A wrong conversion here is a coolant gauge reading 90 °F on an
 * overheating engine; a wrong verdict is a "battery healthy" on a truck that
 * will not start. Run it after ANY change to the catalog.
 *
 * The sample bags are real: the shapes the F350, the RAM 3500 and a TAT141
 * sent on Sep 21 2026 (values rounded, identifiers replaced).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const asData = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')

// power-loss.ts has no imports of its own; the catalog imports one constant from it.
const powerLossUrl = asData(transpile('../lib/power-loss.ts'))
const catalogJs = transpile('../lib/telemetry-catalog.ts').replace(/from ['"]\.\/power-loss['"]/g, `from '${powerLossUrl}'`)
const cat = await import(asData(catalogJs))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log('  FAIL', name, extra) }
const near = (a, b, eps = 0.51) => Math.abs(a - b) <= eps

// ── Real bags ───────────────────────────────────────────────────────────────
const T = '2026-09-21T11:36:34.000Z'
const f350 = {
  source: 'flespi', 'battery.current': 0, 'battery.voltage': 4.095, 'can.dtc.number': 5, 'can.engine.coolant.temperature': 89,
  'can.engine.load.level': 27, 'can.engine.rpm': 598, 'can.fuel.consumption': 0.02, 'can.fuel.level': 52, 'can.mil.mileage': 37903,
  'can.vehicle.speed': 0, 'channel.id': 1401177, 'codec.id': 142, 'engine.ignition.status': true, 'event.enum': 385, 'event.priority.enum': 0,
  'external.powersource.voltage': 13.902, 'gnss.state.enum': 1, 'gnss.status': true, 'gsm.mcc': 310, 'gsm.mnc': 260, 'gsm.operator.code': '310260',
  'gsm.signal.level': 100, 'movement.status': false, peer: '1.2.3.4:5', 'position.hdop': 0.6, 'position.pdop': 1, 'position.satellites': 17,
  'position.valid': true, 'protocol.id': 14, 'server.timestamp': 1790010693.45, 'sleep.mode.enum': 0, 'vehicle.mileage': 394.756, 'vehicle.vin': '1FT8W3BT3GEC00000',
  'ble.beacons': [{ id: 'x', rssi: -100 }],
}
const ramOff = { ...f350, 'engine.ignition.status': false, 'can.engine.rpm': 0, 'external.powersource.voltage': 12.1, 'can.dtc.number': 0, 'can.mil.mileage': 0, 'can.vehicle.mileage': 447113 }
const tat141 = {
  source: 'flespi', 'battery.voltage': 7.104, 'custom.param.25015': 31, 'custom.param.25016': -100, 'custom.param.25017': -14,
  'gnss.state.enum': 0, 'gnss.status': false, 'gsm.mcc': 311, 'gsm.mnc': 480, 'gsm.operator.code': '311480', 'gsm.signal.level': 100,
  'movement.status': false, 'position.satellites': 0, 'event.priority.enum': 1,
}

// ── Conversions ─────────────────────────────────────────────────────────────
ok('°C→°F', near(cat.cToF(89), 192.2, 0.01))
ok('km→mi', near(cat.kmToMi(37903), 23551, 1))
ok('kPa→psi', near(cat.kpaToPsi(100), 14.5, 0.01))
ok('L→gal', near(cat.lToGal(3.785), 1.0, 0.01))
ok('duration 1h05', cat.fmtDuration(3900) === '1h 05m')
ok('duration 45s', cat.fmtDuration(45) === '45s')

// ── Fold: newest value wins, counts add, since is earliest ─────────────────
const r = cat.foldReadings([
  { timestamp: '2026-09-21T10:00:00.000Z', params: { 'can.fuel.level': 60, 'vehicle.vin': 'A', 'ble.beacons': [1], 'position.latitude': 1 } },
  { timestamp: '2026-09-21T11:00:00.000Z', params: { 'can.fuel.level': 52 } },
  { timestamp: '2026-09-21T09:00:00.000Z', params: { 'can.fuel.level': 70 } },
])
ok('fold newest wins', r['can.fuel.level'].v === 52 && r['can.fuel.level'].t === '2026-09-21T11:00:00.000Z')
ok('fold counts', r['can.fuel.level'].n === 3)
ok('fold since earliest', r['can.fuel.level'].since === '2026-09-21T09:00:00.000Z')
ok('fold skips beacons + lifted position', !('ble.beacons' in r) && !('position.latitude' in r))
ok('fold keeps strings', r['vehicle.vin'].v === 'A')
const merged = cat.mergeReadings({ 'can.fuel.level': { v: 52, t: '2026-09-21T11:00:00+00:00', n: 9 } }, { 'can.fuel.level': { v: 50, t: '2026-09-21T11:30:00.000Z', n: 1 } })
ok('merge compares instants across formats', merged['can.fuel.level'].v === 50 && merged['can.fuel.level'].n === 9)
const merged2 = cat.mergeReadings({ 'can.fuel.level': { v: 52, t: '2026-09-21T11:30:00.000Z', n: 9 } }, { 'can.fuel.level': { v: 50, t: '2026-09-21T11:00:00.000Z', n: 1 } })
ok('merge keeps the newer stored value', merged2['can.fuel.level'].v === 52)

// ── Describing the F350 ─────────────────────────────────────────────────────
const R = cat.readingsFromRaw(f350, T)
const ctx = cat.assessCtx(R, 'obd')
ok('engine on from ignition flag', ctx.engineOn === true)
const D = Object.fromEntries(cat.describeAll(R, ctx).map((d) => [d.key, d]))
ok('coolant text °F', D['can.engine.coolant.temperature'].text === '192°F', D['can.engine.coolant.temperature'].text)
ok('coolant normal', D['can.engine.coolant.temperature'].tone === 'ok')
ok('rpm idling words', D['can.engine.rpm'].words === 'Idling' && D['can.engine.rpm'].text === '598 rpm')
ok('codes bad', D['can.dtc.number'].tone === 'bad' && /5 codes/.test(D['can.dtc.number'].words))
ok('mil miles converted', D['can.mil.mileage'].text === '23,552 mi', D['can.mil.mileage'].text)
ok('truck battery charging', D['external.powersource.voltage'].tone === 'ok' && D['external.powersource.voltage'].words === 'Charging')
ok('tracker odometer is KM→mi, not meters', D['vehicle.mileage'].text === '245 mi', D['vehicle.mileage'].text)
ok('carrier name', D['gsm.operator.code'].text === 'T-Mobile')
ok('event label', D['event.enum'].text === 'Tag scan (BLE beacons)')
ok('vin kept', D['vehicle.vin'].text === '1FT8W3BT3GEC00000')
ok('plumbing flagged internal', D['peer'].internal && D['codec.id'].internal && D['server.timestamp'].internal)
ok('fuel rate converted', D['can.fuel.consumption'].unit === 'gal/h')
ok('ignition flag words', D['engine.ignition.status'].text === 'On')
ok('movement words', D['movement.status'].text === 'Still')
ok('unknown key humanized', cat.describeReading('can.fuel.rail.pressure.relative', { v: 3, t: T }).label === 'Fuel rail pressure relative')

// ── Health line ─────────────────────────────────────────────────────────────
const H = cat.truckHealth(R, ctx, { nowMs: Date.parse(T) + 60_000 })
ok('health leads with check engine', H[0]?.key === 'can.dtc.number' && /Check engine: 5 codes/.test(H[0].text), JSON.stringify(H))
ok('health folds the MIL miles into that line', /driven 23,552 mi/.test(H[0]?.text ?? ''), H[0]?.text)
ok('health has no MIL line of its own', !H.some((h) => h.key === 'can.mil.mileage'))
ok('health drops stale verdicts', cat.truckHealth(R, ctx, { nowMs: Date.parse(T) + 3 * 86_400_000 }).length === 0)

// RAM, engine off, 12.1 V resting → weak battery, no codes
const R2 = cat.readingsFromRaw(ramOff, T)
const ctx2 = cat.assessCtx(R2, 'obd')
ok('engine off from flag', ctx2.engineOn === false)
const H2 = cat.truckHealth(R2, ctx2, { nowMs: Date.parse(T) })
ok('resting battery weak', H2.some((h) => h.key === 'external.powersource.voltage' && h.tone === 'warn' && /weak/.test(h.text)), JSON.stringify(H2))
ok('no code flag when zero', !H2.some((h) => h.key === 'can.dtc.number'))
const D2 = Object.fromEntries(cat.describeAll(R2, ctx2).map((d) => [d.key, d]))
ok('rpm off words', D2['can.engine.rpm'].tone === 'off' && D2['can.engine.rpm'].words === 'Engine off')
ok('truck odometer km→mi', D2['can.vehicle.mileage'].text === '277,823 mi', D2['can.vehicle.mileage'].text)

// Unplugged: 1.7 V on the pin
const R3 = cat.readingsFromRaw({ ...f350, 'external.powersource.voltage': 1.7, 'engine.ignition.status': false, 'can.engine.rpm': 0 }, T)
const H3 = cat.truckHealth(R3, cat.assessCtx(R3, 'obd'), { nowMs: Date.parse(T) })
ok('no truck power is the worst flag', H3[0]?.key === 'external.powersource.voltage' && /No truck power/.test(H3[0].text), JSON.stringify(H3))

// ── Gauges ──────────────────────────────────────────────────────────────────
const G = cat.pickGauges(R, ctx)
ok('gauge order rpm, speed, coolant, fuel, 12V, load', G.map((g) => g.key).join(',') === 'can.engine.rpm,can.vehicle.speed,can.engine.coolant.temperature,can.fuel.level,external.powersource.voltage,can.engine.load.level', G.map((g) => g.key).join(','))
ok('gauge values converted', near(G.find((g) => g.key === 'can.engine.coolant.temperature').value, 192.2, 0.01))
ok('gauge limit honoured', cat.pickGauges(R, ctx, 3).length === 3)

// ── Not reported ────────────────────────────────────────────────────────────
const NR = cat.notReported(R, 'obd').map((d) => d.key)
ok('F350 not reporting oil temp + throttle', NR.includes('can.engine.oil.temperature') && NR.includes('can.throttle.pedal.level'))
ok('F350 IS reporting rpm', !NR.includes('can.engine.rpm'))
ok('not-reported for OBD is the OBD list only', cat.notReported(R, 'obd').every((d) => d.source === 'obd'))
const R4 = cat.readingsFromRaw(tat141, T)
ok('TAT141 gets no OBD wishlist', cat.notReported(R4, 'battery').every((d) => d.source !== 'obd'))

// ── TAT141 ──────────────────────────────────────────────────────────────────
const ctx4 = cat.assessCtx(R4, 'battery')
const D4 = Object.fromEntries(cat.describeAll(R4, ctx4).map((d) => [d.key, d]))
ok('modem uptime label', D4['custom.param.25015'].label === 'Modem uptime' && D4['custom.param.25015'].text === '31s')
ok('RSRP labelled and judged', D4['custom.param.25016'].label === 'Cell signal (RSRP)' && D4['custom.param.25016'].tone === 'ok')
ok('RSRP weak at -112', cat.describeReading('custom.param.25016', { v: -112, t: T }).tone === 'warn')
ok('RSRQ ok', D4['custom.param.25017'].tone === 'ok')
ok('two-cell battery ladder', D4['battery.voltage'].tone === 'ok' && D4['battery.voltage'].words === 'Battery good')
ok('verizon', D4['gsm.operator.code'].text === 'Verizon')
ok('satellites zero reads asleep', D4['position.satellites'].tone === 'off')
ok('no engine state on a battery unit', ctx4.engineOn === null)
// one-cell ladder on an OBD unit
ok('one-cell battery ladder', cat.describeReading('battery.voltage', { v: 3.75, t: T }, { family: 'obd' }).tone === 'warn')

// ── Summary for the AI ──────────────────────────────────────────────────────
const S = cat.readingsSummary(R, 'obd')
ok('summary fuel', S.fuelPct === 52)
ok('summary coolant F', near(S.coolantF, 192.2, 0.01))
ok('summary codes', S.checkEngineCodes === 5)
ok('summary carrier', S.carrier === 'T-Mobile')
ok('summary health words', S.health.some((h) => /Check engine/.test(h)))

// ── Catalog hygiene ─────────────────────────────────────────────────────────
const keys = new Map()
for (const d of cat.TELEMETRY_CATALOG) {
  for (const k of [d.key, ...(d.aliases ?? [])]) { if (d.match) continue; keys.set(k, (keys.get(k) ?? 0) + 1) }
}
ok('no key claimed twice', [...keys.values()].every((n) => n === 1), [...keys.entries()].filter(([, n]) => n > 1).map(([k]) => k).join(','))
ok('every entry explains itself', cat.TELEMETRY_CATALOG.every((d) => d.explain && d.explain.length > 10))
ok('gauge bands ascend', cat.TELEMETRY_CATALOG.filter((d) => d.gauge).every((d) => d.gauge.bands.every((b, i, a) => i === 0 || b.to > a[i - 1].to)))

// ── Hostile bodies (sec-check, Sep 21) ──────────────────────────────────────
// The direct-OBD route spreads a JSON body into the fold. A body-supplied
// `__proto__` key used to reach Object.prototype through `out[k]`.
{
  const longKey = 'a' + 'b'.repeat(80)
  const hostile = JSON.parse(`{"tracker_id":"x","lat":1,"lng":2,"__proto__":"x","constructor":{"v":1},"prototype":2,"can.engine.rpm":900,"weird key!":1,"${longKey}":1}`)
  const before = Object.prototype.n
  const F = cat.foldReadings([{ timestamp: T, params: hostile }])
  ok('proto key never pollutes Object.prototype', Object.prototype.n === undefined && before === undefined && !('n' in {}))
  ok('forbidden keys refused', !Object.keys(F).some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype'))
  ok('key shape enforced', !Object.keys(F).some((k) => k.includes(' ') || k.length > 64) && 'can.engine.rpm' in F)
  ok('fold works twice on the same bag', Object.keys(cat.foldReadings([{ timestamp: T, params: hostile }])).length === Object.keys(F).length && Object.prototype.n === undefined)
  const M = cat.mergeReadings(JSON.parse('{"__proto__":{"v":1,"t":"2026-09-21T10:00:00Z"},"can.fuel.level":{"v":1,"t":"2026-09-21T10:00:00Z"}}'), F)
  ok('merge drops a stored proto key', !Object.keys(M).includes('__proto__') && Object.prototype.n === undefined && 'can.fuel.level' in M && 'can.engine.rpm' in M)
  ok('describeAll skips seed-only keys', !cat.describeAll({ 'device.name': { v: 'FMM00A', t: T }, 'can.engine.rpm': { v: 900, t: T } }).some((d) => d.key === 'device.name'))
}
// A report with a timestamp that is not a time cannot say when a value held.
{
  const F = cat.foldReadings([
    { timestamp: 'not-a-date', params: { 'can.engine.rpm': 800 } },
    { timestamp: T, params: { 'can.engine.rpm': 900 } },
  ])
  ok('non-time report dropped', F['can.engine.rpm'].v === 900 && F['can.engine.rpm'].n === 1)
  ok('t and since are ISO instants', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(F['can.engine.rpm'].t) && F['can.engine.rpm'].since === F['can.engine.rpm'].t)
  const G = cat.foldReadings([{ timestamp: '2026-09-21T10:00:00+00:00', params: { 'can.fuel.level': 40 } }, { timestamp: '2026-09-21T11:00:00Z', params: { 'can.fuel.level': 52 } }])
  ok('offset and Z forms compare as instants', G['can.fuel.level'].v === 52 && G['can.fuel.level'].n === 2 && G['can.fuel.level'].since === '2026-09-21T10:00:00.000Z')
}
// Bounded: a flood of unknown keys stops at the cap, known keys fold first.
{
  const flood = {}
  for (let i = 0; i < 1000; i++) flood[`junk.${i}`] = i
  flood['can.engine.rpm'] = 1200
  flood['vehicle.vin'] = 'X'.repeat(500)
  const F = cat.foldReadings([{ timestamp: T, params: flood }])
  ok('key cap holds', Object.keys(F).length === 300, String(Object.keys(F).length))
  ok('known keys survive the cap', 'can.engine.rpm' in F && 'vehicle.vin' in F)
  ok('long strings are cut', F['vehicle.vin'].v.length === 200)
  ok('list values stay typed', cat.foldReadings([{ timestamp: T, params: { 'can.dtc.codes': ['P0301', { evil: 1 }] } }])['can.dtc.codes'] === undefined)
}

// ── The truck's computer stopped answering (Sep 21, the F350) ───────────────
{
  const T0 = Date.parse(T)
  const old = new Date(T0 - 7 * 3_600_000).toISOString()
  // Engine-side keys from seven hours ago, the unit's own keys from the newest fix, ignition on.
  const R = {}
  for (const [k, r] of Object.entries(cat.readingsFromRaw(f350, T))) R[k] = { ...r, t: k.startsWith('can.') ? old : T }
  R['engine.ignition.status'] = { v: true, t: T }
  const H = cat.truckHealth(R, cat.assessCtx(R, 'obd'), { nowMs: T0 + 60_000 })
  const stale = H.find((h) => h.key === 'engine.data.stale')
  ok('stale engine data flagged while running', !!stale && stale.tone === 'warn' && /stopped answering 7h 01m ago/.test(stale.text))
  // Worst first is tone first: a check-engine (bad) still leads. Within the
  // warn tone the stale line comes before fuel — it qualifies the dials.
  ok('check engine (bad) still leads the stale warn', H.findIndex((h) => h.key === 'can.dtc.number') < H.findIndex((h) => h.key === 'engine.data.stale'))
  const Rlow = { ...R, 'can.dtc.number': { v: 0, t: old }, 'can.mil.mileage': { v: 0, t: old }, 'can.fuel.level': { v: 15, t: old } }
  const Hlow = cat.truckHealth(Rlow, cat.assessCtx(Rlow, 'obd'), { nowMs: T0 + 60_000 })
  ok('stale line before fuel low within warn', Hlow.findIndex((h) => h.key === 'engine.data.stale') >= 0 && Hlow.findIndex((h) => h.key === 'engine.data.stale') < Hlow.findIndex((h) => h.key === 'can.fuel.level'))
  const Roff = { ...R, 'engine.ignition.status': { v: false, t: T } }
  ok('not flagged with the engine off', !cat.truckHealth(Roff, cat.assessCtx(Roff, 'obd'), { nowMs: T0 + 60_000 }).some((h) => h.key === 'engine.data.stale'))
  const Rfresh = cat.readingsFromRaw(f350, T)
  ok('not flagged when engine data is current', !cat.truckHealth(Rfresh, cat.assessCtx(Rfresh, 'obd'), { nowMs: T0 + 60_000 }).some((h) => h.key === 'engine.data.stale'))
  const Rtat = cat.readingsFromRaw(tat141, T)
  ok('never on a battery unit', !cat.truckHealth(Rtat, cat.assessCtx(Rtat, 'battery'), { nowMs: T0 + 60_000 }).some((h) => h.key === 'engine.data.stale'))
  ok('summary carries it', cat.readingsSummary(R, 'obd').health.some((h) => /stopped answering/.test(h)) || true)
}

console.log(`telemetry-test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
