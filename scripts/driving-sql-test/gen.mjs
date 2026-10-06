// Two steps of the driving-scores SQL harness (run.sh):
//   node gen.mjs data  <dir>   → <dir>/data.sql (companies, people, trucks, a day of fixes)
//   node gen.mjs build <dir>   → reads <dir>/fixes.json (driving_day_fixes' answer),
//                                runs the TS engine on it, writes <dir>/put.sql + <dir>/expected.json
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [, , step, dir] = process.argv
const require = createRequire(import.meta.url)

export const ID = {
  coA: '00000000-0000-4000-8000-00000000000a',
  coB: '00000000-0000-4000-8000-00000000000b',
  associate: '00000000-0000-4000-8000-0000000000a1',
  foreman: '00000000-0000-4000-8000-0000000000f1',
  prospect: '00000000-0000-4000-8000-0000000000e1',
  truck: '00000000-0000-4000-8000-0000000000c1',
  hidden: '00000000-0000-4000-8000-0000000000c2',
  truckB: '00000000-0000-4000-8000-0000000000c3',
  zoneA: '00000000-0000-4000-8000-0000000000d1',
  zoneB: '00000000-0000-4000-8000-0000000000d2',
}
const DAY = '2026-10-06'
const T0 = Date.parse('2026-10-06T14:00:00Z') // 10:00 AM EDT

if (step === 'data') {
  const lines = []
  const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
  lines.push(`INSERT INTO companies (id, name, digest_prefs) VALUES (${q(ID.coA)}, 'A', '{"tz":"America/New_York"}'), (${q(ID.coB)}, 'B', NULL);`)
  for (const u of [ID.coA, ID.coB, ID.associate, ID.foreman, ID.prospect]) lines.push(`INSERT INTO auth.users (id) VALUES (${q(u)});`)
  lines.push(`INSERT INTO profiles (id, company_id, role, name) VALUES
    (${q(ID.coA)}, ${q(ID.coA)}, 'admin', 'Owner A'), (${q(ID.coB)}, ${q(ID.coB)}, 'admin', 'Owner B'),
    (${q(ID.associate)}, ${q(ID.coA)}, 'associate', 'Crew'), (${q(ID.foreman)}, ${q(ID.coA)}, 'foreman', 'Lead'),
    (${q(ID.prospect)}, ${q(ID.coA)}, 'prospect', 'Visitor');`)
  lines.push(`INSERT INTO assets (id, company_id, name, type, tracker_id, metadata) VALUES
    (${q(ID.truck)}, ${q(ID.coA)}, 'Truck 1', 'vehicle', '350612070000001', '{}'),
    (${q(ID.hidden)}, ${q(ID.coA)}, 'Owner truck', 'vehicle', '350612070000002', '{"visibility":"master"}'),
    (${q(ID.truckB)}, ${q(ID.coB)}, 'Other co truck', 'vehicle', '350612070000003', '{}');`)
  lines.push(`INSERT INTO geofences (id, company_id, name) VALUES (${q(ID.zoneA)}, ${q(ID.coA)}, 'Site A'), (${q(ID.zoneB)}, ${q(ID.coB)}, 'Site B');`)
  // Truck 1, Oct 6: cruise 45 mph, a hard stop (45 → 35 → 26 mph), a tag-scan
  // record a second early, a device harsh-braking record, then a stop.
  let lat = 34.85
  const rows = []
  const push = (s, v, raw) => rows.push({ ms: T0 + s * 1000, v, raw })
  // The truck's own speedometer rides along as can.vehicle.speed (km/h).
  for (let s = 0; s <= 10; s++) push(s, 45, { 'position.valid': true, 'position.satellites': 12, 'position.hdop': 0.8, 'external.powersource.voltage': 13.9, 'can.vehicle.speed': 72 })
  push(11, 35, { 'position.valid': true, 'position.satellites': 12, 'position.hdop': 0.8, 'harsh.braking.event': true, 'absolute.acceleration': 0.47, 'event.enum': 253, 'can.vehicle.speed': 56 })
  push(12, 26, { 'position.valid': true, 'position.satellites': 12, 'can.vehicle.speed': 42 })
  push(12.4, 21, { 'event.enum': 385, 'position.satellites': 11, 'ble.beacons': [] })
  for (let s = 13; s <= 40; s++) push(s, Math.max(0, 26 - (s - 12) * 2), { 'position.valid': true, 'position.satellites': 12 })
  // a check-in on Oct 4 (a day for the backfill to find) and one late on Oct 5 local
  rows.push({ ms: Date.parse('2026-10-04T15:00:00Z'), v: 0, raw: { 'position.valid': true } })
  rows.push({ ms: Date.parse('2026-10-06T03:30:00Z'), v: 0, raw: { 'position.valid': true } }) // 11:30 PM Oct 5 EDT
  let prev = null
  for (const r of rows.sort((a, b) => a.ms - b.ms)) {
    if (prev && r.ms > prev.ms && r.ms - prev.ms < 60_000) lat += (((prev.v + r.v) / 2) * 0.44704 * ((r.ms - prev.ms) / 1000)) / 110_574
    lines.push(`INSERT INTO asset_locations (asset_id, company_id, lat, lng, speed, heading, ignition, "timestamp", raw) VALUES (${q(ID.truck)}, ${q(ID.coA)}, ${lat}, -82.4, ${r.v}, 0, true, to_timestamp(${r.ms / 1000}), ${q(JSON.stringify(r.raw))}::jsonb);`)
    prev = r
  }
  for (const a of [ID.hidden, ID.truckB]) lines.push(`INSERT INTO asset_locations (asset_id, company_id, lat, lng, speed, "timestamp", raw) VALUES (${q(a)}, NULL, 34.9, -82.3, 30, to_timestamp(${T0 / 1000}), '{}');`)
  writeFileSync(`${dir}/data.sql`, lines.join('\n') + '\n')
} else if (step === 'build') {
  const ts = require('typescript')
  const transpile = (p) => ts.transpileModule(readFileSync(new URL(p, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  const asData = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  let js = transpile('../../lib/driving-score.ts')
  for (const [spec, file] of [['./alerts-engine', 'alerts-engine.ts'], ['./power-loss', 'power-loss.ts'], ['./dates', 'dates.ts']]) {
    js = js.replace(new RegExp(`from ['"]${spec.replace('.', '\\.')}['"]`, 'g'), `from '${asData(transpile('../../lib/' + file))}'`)
  }
  const D = await import(asData(js))
  const raw = JSON.parse(readFileSync(`${dir}/fixes.json`, 'utf8'))
  const fixes = raw.map(D.decodeFix).filter(Boolean)
  const { row, events } = D.analyzeDay({ fixes, dayKey: DAY, tz: 'America/New_York', vehicleClass: 'light' })
  const toDb = (e, i) => ({
    at: new Date(e.at).toISOString(), kind: e.kind, severity: e.severity, source: e.source, confirmed: e.confirmed ?? null,
    value: e.value, speed_mph: e.speedMph,
    duration_s: e.durationS ?? null, limit_mph: e.limitMph ?? null,
    // the first event claims another company's site and person — both must come out NULL
    zone_id: i === 0 ? ID.zoneB : null, person_id: i === 0 ? ID.coB : ID.associate,
    lat: e.lat, lng: e.lng, version: 1,
  })
  const ev = events.map(toDb)
  const lit = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`
  const bogus = { ...row, company_id: ID.coB } // the payload's company is never trusted
  const put = (asset, r, list) => `SELECT driving_put_day('${asset}', '${DAY}', ${lit(r)}, ${lit(list)});`
  writeFileSync(`${dir}/put.sql`, [
    put(ID.truck, bogus, ev), put(ID.truck, bogus, ev), // twice: a rebuild never doubles
    put(ID.hidden, { ...row, miles: 1, vclass: 'heavy' }, []), put(ID.truckB, { ...row, miles: 2, vclass: 'semi' }, []),
  ].join('\n') + '\n')
  writeFileSync(`${dir}/expected.json`, JSON.stringify({
    fixes: fixes.length, row, events: events.length,
    kinds: events.map((e) => `${e.kind}:${e.source}:${e.confirmed ? 'confirmed' : 'unconfirmed'}`),
    obd: fixes.filter((f) => f.obd != null).length,
    headings: fixes.filter((f) => f.heading != null).length,
  }))
}
