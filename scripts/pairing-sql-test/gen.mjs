/**
 * Synthetic pairing episodes for the SQL parity harness (run.sh). Writes
 * data.sql (companies/assets/fixes/episodes) and expected.json — each
 * episode's places computed by the SHIPPED TypeScript: the ingest's matcher
 * (beaconCandidates, lib/ble-sightings.ts) picks the sightings and the
 * ingest's fold (lib/pairing-ride.ts) folds them. run.sh then asks 122's
 * ht_pairing_summarize for the same episodes and diffs the two.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const toJs = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const asUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const rideUrl = asUrl(toJs('../../lib/pairing-ride.ts'))
const R = await import(rideUrl)
const B = await import(asUrl(toJs('../../lib/ble-sightings.ts').replace(/from '\.\/pairing-ride'/, `from '${rideUrl}'`)))

const out = process.argv[2] || '.'
let seed = 11
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const BASE = { lat: 34.8526, lng: -82.394 }
const at = (m, e = 0) => ({ lat: BASE.lat + m / 111_195, lng: BASE.lng + e / 91_300 })
const jit = (p, m) => ({ lat: p.lat + (rnd() - 0.5) * 2 * m / 111_195, lng: p.lng + (rnd() - 0.5) * 2 * m / 91_300 })
const T0 = Date.parse('2026-09-20T12:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const q = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const CO = uuid(1)
const sql = [`INSERT INTO companies VALUES (${q(CO)});`]
let nextId = 100
const asset = (name, type, tracker) => {
  const id = uuid(nextId++)
  sql.push(`INSERT INTO assets (id, company_id, name, type, tracker_id) VALUES (${q(id)}, ${q(CO)}, ${q(name)}, ${q(type)}, ${q(tracker)});`)
  return { id, tracker }
}
const fixes = new Map() // carrier id → [{ t, lat, lng, speed, beacons }]
const addFix = (carrier, t, p, beacons = null, speed = 0) => {
  if (!fixes.has(carrier.id)) fixes.set(carrier.id, [])
  fixes.get(carrier.id).push({ t, lat: p.lat, lng: p.lng, speed, beacons })
}
const beacon = (id, rssi = -80) => ({ id, rssi, battery: null })
const episodes = []
const episode = (name, tool, carrier, startMs, lastMs, ended = true) => episodes.push({ name, tool, carrier, startMs, lastMs, ended })

// The tags, registered the ways the fleet registers them; the trucks report
// them the way a Teltonika box does (hex major/minor, zero-UUID MACs).
const EYE = '00000000-0000-0000-0000-7CD9F408B56C'
const roller = asset('85A roller', 'tool', EYE)
const hamm = asset('HAMM roller', 'tool', 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:10065:1')
const HAMM_HEX = 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:2751:0001'
const tb235 = asset('TB235', 'tool', 'fda50693a4e24fb1afcfc6eb07647825:3')
const TB_HEX = 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825:2751:0003'
const trailer = asset('Trailer', 'tool', '7CD9F408B573')
const TRAILER_REPORTED = '00000000-0000-0000-0000-7CD9F408B573'
const f650 = asset('F650', 'vehicle', '350000000000001')
const f750 = asset('F750', 'vehicle', '350000000000002')
const ram = asset('RAM 3500', 'vehicle', '350000000000003')
const phone = asset('phone', 'personnel', 'phone-abc')

// A) Leave-and-return: the F650 hears the roller at the yard, hauls loads
//    (fixes miles away WITHOUT the tag), comes back and hears it again.
{
  let t = T0
  const s0 = t
  for (let loop = 0; loop < 6; loop++) {
    for (let i = 0; i < 12; i++) { addFix(f650, t, jit(BASE, 20), [beacon(EYE), beacon(HAMM_HEX, -95)]); t += 30_000 }
    for (let i = 1; i <= 20; i++) { addFix(f650, t, at(i * 400, 300), [], 35); t += 20_000 }
    for (let i = 20; i >= 1; i--) { addFix(f650, t, at(i * 400, 300), [], 35); t += 20_000 }
  }
  addFix(f650, t, jit(BASE, 20), [beacon(EYE)]); const s1 = t; t += 30_000
  episode('A leave-and-return (EYE zero-UUID)', roller, f650, s0, s1)
}
// B) The real-haul shape with an iBeacon registered in DECIMAL, reported in
//    HEX: heard at the yard, along the road, and parked at the far end.
{
  let t = T0 + 3 * 86_400_000
  const s0 = t
  for (let i = 0; i < 10; i++) { addFix(ram, t, jit(BASE, 8), [beacon(HAMM_HEX)]); t += 60_000 }
  for (let i = 1; i <= 30; i++) { addFix(ram, t, at(i * 300), i % 3 ? [] : [beacon(HAMM_HEX)], 40); t += 20_000 }
  for (let i = 0; i < 15; i++) { addFix(ram, t, jit(at(9000), 8), [beacon(HAMM_HEX)]); t += 120_000 }
  const s1 = t - 120_000
  // A fix with the tag AFTER the episode's last sighting: outside the window.
  addFix(ram, t + 3_600_000, at(20000), [beacon(HAMM_HEX)], 50)
  episode('B real haul (decimal iBeacon, hex report)', hamm, ram, s0, s1)
}
// C) Owner shorthand uuid:minor (no dashes) on a truck re-parking 160 m
//    apart around a parked machine; another tool's tag shares every list.
{
  let t = T0 + 5 * 86_400_000
  const s0 = t
  for (let i = 0; i < 30; i++) { addFix(f750, t, jit(i % 2 ? at(160) : BASE, 4), [beacon(EYE, -99), beacon(TB_HEX)]); t += 300_000 }
  episode('C re-parking, shorthand id', tb235, f750, s0, t - 300_000)
}
// D) A bare-MAC registration heard in the zero-UUID form, carried out and
//    back (parked sightings only), with a no-fix (0,0) record in the middle.
{
  let t = T0 + 7 * 86_400_000
  const s0 = t
  for (let i = 0; i < 3; i++) { addFix(f750, t, jit(BASE, 5), [beacon(TRAILER_REPORTED)]); t += 60_000 }
  for (let i = 1; i <= 10; i++) { addFix(f750, t, at(i * 200), [], 30); t += 30_000 }
  addFix(f750, t, { lat: 0, lng: 0 }, [beacon(TRAILER_REPORTED)]); t += 30_000
  for (let i = 0; i < 3; i++) { addFix(f750, t, jit(at(2000), 5), [beacon(TRAILER_REPORTED)]); t += 60_000 }
  for (let i = 10; i >= 1; i--) { addFix(f750, t, at(i * 200), [], 30); t += 30_000 }
  for (let i = 0; i < 3; i++) { addFix(f750, t, jit(BASE, 5), [beacon(TRAILER_REPORTED)]); t += 60_000 }
  episode('D out and back (bare MAC)', trailer, f750, s0, t - 60_000)
}
// E) A phone carrier: phones never stored their beacon lists, so the
//    episode's ends are all there is — the nearest fix within 10 min.
{
  const s0 = T0 + 9 * 86_400_000
  addFix(phone, s0 - 7 * 60_000, at(-500))  // farther than the next one
  addFix(phone, s0 + 2 * 60_000, at(0))      // nearest to the start
  addFix(phone, s0 + 40 * 60_000, at(600))
  const s1 = s0 + 90 * 60_000
  addFix(phone, s1 - 3 * 60_000, at(1400))   // nearest to the end
  addFix(phone, s1 + 9 * 60_000, at(3000))
  episode('E phone, ends only', roller, phone, s0, s1)
}
// F) One passing sighting.
{
  const s0 = T0 + 11 * 86_400_000
  addFix(f650, s0, at(5000), [beacon(EYE)], 30)
  episode('F one sighting', roller, f650, s0, s0)
}

// ── SQL ──────────────────────────────────────────────────────────────────────
for (const [carrier, list] of fixes) {
  const rows = list.map((f) => `(${q(carrier)}, ${q(CO)}, ${f.lat}, ${f.lng}, ${f.speed}, ${q(iso(f.t))}, ${f.beacons == null ? 'NULL' : q(JSON.stringify({ 'ble.beacons': f.beacons, 'position.speed': f.speed }))})`)
  for (let i = 0; i < rows.length; i += 500) sql.push(`INSERT INTO asset_locations (asset_id, company_id, lat, lng, speed, "timestamp", raw) VALUES\n${rows.slice(i, i + 500).join(',\n')};`)
}
const expected = []
for (const [i, e] of episodes.entries()) {
  const id = uuid(900 + i)
  sql.push(`INSERT INTO pairing_log (id, company_id, member_asset_id, carrier_asset_id, started_at, last_seen, ended_at) VALUES (${q(id)}, ${q(CO)}, ${q(e.tool.id)}, ${q(e.carrier.id)}, ${q(iso(e.startMs))}, ${q(iso(e.lastMs))}, ${e.ended ? q(iso(e.lastMs)) : 'NULL'});`)
  // The sightings exactly as the shipped TS sees them.
  const strip = (s) => s.replace(/[^0-9a-z]/gi, '').toLowerCase()
  const key = strip(e.tool.tracker)
  const hears = (f) => (f.beacons ?? []).some((b) => B.beaconCandidates(b.id, 'hex').some((c) => strip(c) === key))
  const list = fixes.get(e.carrier.id) ?? []
  const nearest = (ms) => list
    .filter((f) => Math.abs(f.t - ms) <= 600_000)
    .sort((a, b) => Math.abs(a.t - ms) - Math.abs(b.t - ms))[0]
  const byT = new Map()
  for (const f of list) if (f.t >= e.startMs && f.t <= e.lastMs && hears(f)) byT.set(f.t, f)
  for (const f of [nearest(e.startMs), nearest(e.lastMs)]) if (f) byT.set(f.t, f)
  const sightings = [...byT.values()].sort((a, b) => a.t - b.t).filter((f) => R.validFix(f))
  let ep = sightings.length ? R.newEpisodePlaces(sightings[0]) : { heard_n: 0, span_m: 0, moved_m: 0, first_lat: null, first_lng: null, anchor_lat: null, anchor_lng: null }
  for (const f of sightings.slice(1)) ep = R.foldSighting(ep, f) ?? ep
  expected.push({ id, name: e.name, heard_n: ep.heard_n, span_m: ep.span_m, moved_m: ep.moved_m, kind: R.rideKind(ep.span_m), first_lat: ep.first_lat, anchor_lat: ep.anchor_lat })
}
writeFileSync(`${out}/data.sql`, sql.join('\n') + '\n')
writeFileSync(`${out}/expected.json`, JSON.stringify(expected, null, 1))
console.log(`gen: ${episodes.length} episodes, ${[...fixes.values()].reduce((n, l) => n + l.length, 0)} fixes`)
