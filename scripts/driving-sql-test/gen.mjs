// Two steps of the driving-scores SQL harness (run.sh):
//   node gen.mjs data  <dir>   → <dir>/data.sql (companies, people, trucks, a day of fixes)
//   node gen.mjs build <dir>   → reads <dir>/fixes.json (driving_day_fixes' answer),
//                                runs the TS engine on it, writes <dir>/put.sql + <dir>/expected.json
//   node gen.mjs sums  <dir> [rollup file] [visible ids | *]
//                              → reads <dir>/days.json + the rollup file (driving_rollup's answer,
//                                default rollup.json) and prints "ok" when the SQL sums = the TS
//                                fold of the days: the vehicle's totals whole (attributed miles
//                                included), each visible person's slice exact, nobody else's there
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [, , step, dir] = process.argv
const require = createRequire(import.meta.url)

export const ID = {
  coA: '00000000-0000-4000-8000-00000000000a',
  coB: '00000000-0000-4000-8000-00000000000b',
  associate: '00000000-0000-4000-8000-0000000000a1',
  foreman: '00000000-0000-4000-8000-0000000000f1',
  manager: '00000000-0000-4000-8000-0000000000b2',
  admin: '00000000-0000-4000-8000-0000000000b3',
  // On the team when their day was built, removed since (run.sh deletes the profile).
  gone: '00000000-0000-4000-8000-0000000000b4',
  prospect: '00000000-0000-4000-8000-0000000000e1',
  truck: '00000000-0000-4000-8000-0000000000c1',
  hidden: '00000000-0000-4000-8000-0000000000c2',
  truckB: '00000000-0000-4000-8000-0000000000c3',
  truck2: '00000000-0000-4000-8000-0000000000c4',
  zoneA: '00000000-0000-4000-8000-0000000000d1',
  zoneB: '00000000-0000-4000-8000-0000000000d2',
}
const DAY = '2026-10-06'
const T0 = Date.parse('2026-10-06T14:00:00Z') // 10:00 AM EDT

if (step === 'data') {
  const lines = []
  const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
  lines.push(`INSERT INTO companies (id, name, digest_prefs) VALUES (${q(ID.coA)}, 'A', '{"tz":"America/New_York"}'), (${q(ID.coB)}, 'B', NULL);`)
  for (const u of [ID.coA, ID.coB, ID.associate, ID.foreman, ID.manager, ID.admin, ID.gone, ID.prospect]) lines.push(`INSERT INTO auth.users (id) VALUES (${q(u)});`)
  lines.push(`INSERT INTO profiles (id, company_id, role, name) VALUES
    (${q(ID.coA)}, ${q(ID.coA)}, 'admin', 'Owner A'), (${q(ID.coB)}, ${q(ID.coB)}, 'admin', 'Owner B'),
    (${q(ID.associate)}, ${q(ID.coA)}, 'associate', 'Crew'), (${q(ID.foreman)}, ${q(ID.coA)}, 'foreman', 'Lead'),
    (${q(ID.manager)}, ${q(ID.coA)}, 'manager', 'Ops'), (${q(ID.admin)}, ${q(ID.coA)}, 'admin', 'Office'),
    (${q(ID.gone)}, ${q(ID.coA)}, 'associate', 'Left'), (${q(ID.prospect)}, ${q(ID.coA)}, 'prospect', 'Visitor');`)
  lines.push(`INSERT INTO assets (id, company_id, name, type, tracker_id, metadata) VALUES
    (${q(ID.truck)}, ${q(ID.coA)}, 'Truck 1', 'vehicle', '350612070000001', '{}'),
    (${q(ID.hidden)}, ${q(ID.coA)}, 'Owner truck', 'vehicle', '350612070000002', '{"visibility":"master"}'),
    (${q(ID.truckB)}, ${q(ID.coB)}, 'Other co truck', 'vehicle', '350612070000003', '{}'),
    (${q(ID.truck2)}, ${q(ID.coA)}, 'Truck 2', 'vehicle', '350612070000004', '{}');`)
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
} else {
  const ts = require('typescript')
  const transpile = (p) => ts.transpileModule(readFileSync(new URL(p, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  const asData = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  let js = transpile('../../lib/driving-score.ts')
  for (const [spec, file] of [['./alerts-engine', 'alerts-engine.ts'], ['./power-loss', 'power-loss.ts'], ['./dates', 'dates.ts']]) {
    js = js.replace(new RegExp(`from ['"]${spec.replace('.', '\\.')}['"]`, 'g'), `from '${asData(transpile('../../lib/' + file))}'`)
  }
  const D = await import(asData(js))
  if (step === 'sums') {
    // driving_rollup (one row per vehicle-month, summed in SQL) must read
    // exactly like the day rows it summed: totals, each rider's slice, the
    // score — and since 134, only the riders this caller may see, while the
    // vehicle's own totals (miles tied to a named driver included) stay whole.
    const [, , , , file = 'rollup.json', vis = '*'] = process.argv
    const days = JSON.parse(readFileSync(`${dir}/days.json`, 'utf8'))
    const sums = (JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) ?? []).map((r) => ({ ...r, day: `${r.month}-01` }))
    const everyone = Array.from(new Set(days.flatMap((d) => Object.keys(d.drivers ?? {}))))
    const visible = vis === '*' ? everyone : vis.split(',').filter(Boolean)
    const bad = []
    const same = (label, a, b) => {
      for (const k of Object.keys(a)) {
        const x = a[k], y = b[k]
        if (typeof x === 'number' ? Math.abs(x - y) > Math.max(0.02, Math.abs(x) * 1e-5) : JSON.stringify(x) !== JSON.stringify(y)) bad.push(`${label}.${k}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`)
      }
    }
    same('fleet', D.sumDaily(days, 61), D.sumDaily(sums, 61))
    for (const pid of visible) {
      same(`driver ${pid.slice(-2)}`, D.driverTotals(days, [], pid), D.driverTotals(sums, [], pid))
      if (!sums.some((r) => Object.prototype.hasOwnProperty.call(r.drivers ?? {}, pid))) bad.push(`driver ${pid.slice(-2)} missing`)
    }
    for (const r of sums) for (const pid of Object.keys(r.drivers ?? {})) if (!visible.includes(pid)) bad.push(`driver ${pid.slice(-2)} leaked (${r.month})`)
    const s1 = D.scoreTotals(D.sumDaily(days, 61)), s2 = D.scoreTotals(D.sumDaily(sums, 61))
    if (s1.score !== s2.score || s1.credible !== s2.credible) bad.push(`score ${s1.score} vs ${s2.score}`)
    if (!days.length || sums.length !== new Set(days.map((d) => d.day.slice(0, 7))).size) bad.push(`rows: ${days.length} days → ${sums.length} months`)
    console.log(bad.length ? bad.join('; ') : 'ok')
    process.exit(0)
  }
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
  const put = (asset, r, list, day = DAY) => `SELECT driving_put_day('${asset}', '${day}', ${lit(r)}, ${lit(list)});`
  // Truck 2: three months of days with riders, for driving_rollup — a solo
  // day with the accelerometer on, a two-phone day, a parked day, a day
  // in another month; then a day each driven alone by the owner (plus a key
  // that is no person at all), by an Admin, and by someone since removed
  // from the team; events charged to each for driving_person_events and the
  // 134 ladder.
  const empty = D.analyzeDay({ fixes: [], dayKey: DAY, tz: 'America/New_York' }).row
  const P = (o) => ({ s: 0, mi: 0, ss: 0, smi: 0, ns: 0, zm: 0, zh: 0, zs: 0, ...o })
  const t2 = [
    ['2026-08-31', { miles: 18.75, moving_s: 2000, engine_s: 3000, accel_on: true, accel_seen: true, brake_mod: 1, max_mph: 64, night_s: 120, drivers: { [ID.foreman]: P({ s: 2000, mi: 18.75, ss: 2000, smi: 18.75, ns: 120 }) } }],
    ['2026-09-28', { miles: 40.25, moving_s: 3600, engine_s: 5000, accel_on: true, accel_seen: true, brake_mod: 1, brake_sev: 1, zone_mod_s: 30, max_mph: 72, limit_miles: 3.5, drivers: { [ID.associate]: P({ s: 3600, mi: 40.25, ss: 3600, smi: 40.25, zm: 30 }) } }],
    ['2026-09-30', { miles: 12.5, moving_s: 1500, engine_s: 2400, accel_on: false, gap_s: 600, longest_gap_s: 600, unplug_n: 1, max_sev_s: 25, max_speed_n: 1, drivers: { [ID.associate]: P({ s: 1500, mi: 12.5 }), [ID.foreman]: P({ s: 1500, mi: 12.5 }) } }],
    ['2026-09-29', { miles: 0, moving_s: 0, accel_on: true, fixes: 24 }],
    ['2026-10-01', { miles: 22.5, moving_s: 2400, engine_s: 3000, accel_on: true, accel_seen: true, brake_mod: 1, max_mph: 58, drivers: { [ID.coA]: P({ s: 2340, mi: 22, ss: 2340, smi: 22 }), 'not-a-person': P({ s: 60, mi: 0.5, ss: 60, smi: 0.5 }) } }],
    ['2026-10-02', { miles: 15.25, moving_s: 1800, engine_s: 2400, accel_on: true, corner_mod: 1, night_s: 60, drivers: { [ID.admin]: P({ s: 1800, mi: 15.25, ss: 1800, smi: 15.25, ns: 60 }) } }],
    ['2026-10-03', { miles: 9.5, moving_s: 1200, engine_s: 1500, accel_on: false, zone_mod_s: 20, zone_speed_n: 1, limit_miles: 1, drivers: { [ID.gone]: P({ s: 1200, mi: 9.5, ss: 1200, smi: 9.5, zm: 20 }) } }],
  ]
  const t2e = (at, kind, severity, o) => ({ at, kind, severity, source: 'device', confirmed: true, value: 0.4, speed_mph: 40, lat: 34.9, lng: -82.3, version: 1, ...o })
  const t2ev = {
    '2026-08-31': [t2e('2026-08-31T14:00:00Z', 'harsh_brake', 'moderate', { person_id: ID.foreman })],
    '2026-09-28': [
      t2e('2026-09-28T14:00:00Z', 'harsh_brake', 'moderate', { value: 0.36, speed_mph: 40, person_id: ID.associate }),
      t2e('2026-09-28T15:00:00Z', 'harsh_brake', 'severe', { value: 0.52, speed_mph: 44, person_id: ID.associate }),
    ],
    // two phones aboard: charged to nobody
    '2026-09-30': [t2e('2026-09-30T15:00:00Z', 'max_speed', 'severe', { source: 'gps', confirmed: null, value: 82, speed_mph: 82, duration_s: 25, person_id: null })],
    '2026-10-01': [t2e('2026-10-01T14:00:00Z', 'harsh_brake', 'moderate', { person_id: ID.coA })],
    '2026-10-02': [t2e('2026-10-02T14:00:00Z', 'harsh_corner', 'moderate', { person_id: ID.admin })],
    '2026-10-03': [t2e('2026-10-03T14:00:00Z', 'zone_speeding', 'moderate', { source: 'gps', confirmed: null, value: 23, speed_mph: 23, duration_s: 70, limit_mph: 15, person_id: ID.gone })],
  }
  writeFileSync(`${dir}/put.sql`, [
    put(ID.truck, bogus, ev), put(ID.truck, bogus, ev), // twice: a rebuild never doubles
    put(ID.hidden, { ...row, miles: 1, vclass: 'heavy' }, []), put(ID.truckB, { ...row, miles: 2, vclass: 'semi' }, []),
    ...t2.map(([day, o]) => put(ID.truck2, { ...empty, day, ...o }, t2ev[day] ?? [], day)),
  ].join('\n') + '\n')
  writeFileSync(`${dir}/expected.json`, JSON.stringify({
    fixes: fixes.length, row, events: events.length,
    kinds: events.map((e) => `${e.kind}:${e.source}:${e.confirmed ? 'confirmed' : 'unconfirmed'}`),
    obd: fixes.filter((f) => f.obd != null).length,
    headings: fixes.filter((f) => f.heading != null).length,
  }))
}
