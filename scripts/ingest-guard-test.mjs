/**
 * The tracker-stream guards, asserted (run: node scripts/ingest-guard-test.mjs).
 *
 * GPS spikes: the Charleston dump trailer's real Sep 28 sequence (one
 * "valid" fix in the Gulf of Mexico between two Charleston fixes), plus the
 * shapes the guard must never touch — highway driving, jitter, a machine that
 * moved while dark, a tracker moved to another machine (one fix held, the
 * second confirms), a buffered late record.
 *
 * Parked tag chatter: a synthetic day shaped like the F650's (tag scans every
 * ~11 s while parked, a flickering tag, an idle with the engine on, a drive, a
 * new tag appearing mid-run), processed whole and in random webhook batches.
 * The proof that thinning is safe is that the SAME stats come out: the
 * asset page's moving / idle / parked / miles / starts (lib/asset-stats) and
 * the trip log (lib/trips) are computed from the full stream and from the
 * stored one and must match exactly. Run it after ANY change to
 * lib/ingest-guard.ts, lib/asset-stats.ts or lib/trips.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Run the TS through the same transpile Next uses, so the test exercises the
// shipped source rather than a hand-kept copy.
const require = createRequire(import.meta.url)
const ts = require('typescript')
const load = async (file, patch = (s) => s) => {
  const src = patch(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
}
const G = await load('ingest-guard.ts')
const S = await load('asset-stats.ts')
// No zones in these streams — the trip segmenter never asks the polygon test.
const T = await load('trips.ts', (s) => s.replace(/import \{ pointInPolygon \} from '\.\/alerts-engine'/, 'const pointInPolygon = () => false'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}

// ── 1. GPS spikes ───────────────────────────────────────────────────────────
{
  const at = (iso) => Date.parse(iso)
  // The real fixes, Sep 28 (UTC).
  const before = { ms: at('2026-09-28T19:35:38Z'), lat: 32.809092, lng: -79.876548, speed: 17 }
  const gulf = { ms: at('2026-09-28T19:42:20Z'), lat: 27.656342, lng: -89.283555, speed: 48 }
  const after = { ms: at('2026-09-28T19:48:44Z'), lat: 32.84486, lng: -79.959082, speed: 0 }
  ok('Gulf fix is rejected', G.jumpVerdict(before, gulf, null) === 'reject')
  ok('…and the next Charleston fix is fine (compared with the last stored one)', G.jumpVerdict(before, after, gulf) === 'ok')
  ok('reason names the jump', G.jumpReason(before, gulf) === 'jump 1069 km in 402 s (5,950 mph)', G.jumpReason(before, gulf))

  const min = 60_000
  const highway = { ms: before.ms + 6 * min, lat: before.lat + 0.1, lng: before.lng + 0.06, speed: 75 } // ~12 km in 6 min
  ok('highway driving is fine', G.jumpVerdict(before, highway, null) === 'ok')
  ok('30 m of jitter is fine', G.jumpVerdict(before, { ...before, ms: before.ms + 1000, lat: before.lat + 0.0003 }, null) === 'ok')
  ok('a far fix after 3 h dark is a machine that moved', G.jumpVerdict(before, { ...gulf, ms: before.ms + 3 * 3_600_000 }, null) === 'ok')
  ok('a late (older) record is not judged', G.jumpVerdict(before, { ...gulf, ms: before.ms - min }, null) === 'ok')
  ok('same-second record is not judged', G.jumpVerdict(before, { ...gulf, ms: before.ms }, null) === 'ok')
  ok('no history: nothing to judge against', G.jumpVerdict(null, gulf, null) === 'ok')

  // A tracker moved onto a machine ~480 km away: the first fix is held
  // back, the second agrees with it and both go in.
  const yard = { ms: before.ms, lat: 34.78, lng: -82.61, speed: 0 }
  const moved1 = { ms: yard.ms + 5 * min, lat: 30.5, lng: -81.7, speed: 0 }
  const moved2 = { ms: moved1.ms + 60_000, lat: 30.5003, lng: -81.7002, speed: 0 }
  ok('moved tracker: first far fix held', G.jumpVerdict(yard, moved1, null) === 'reject')
  ok('moved tracker: second fix confirms it', G.jumpVerdict(yard, moved2, moved1) === 'confirmed')
  ok('a confirmation older than 30 min does not count', G.jumpVerdict(yard, { ...moved2, ms: moved1.ms + 31 * min }, moved1) === 'reject')
  // Two glitches in different bogus places do not confirm each other.
  const glitch2 = { ms: gulf.ms + 6 * min, lat: 40.1, lng: -100.2, speed: 30 }
  ok('scattered glitches stay rejected', G.jumpVerdict(before, glitch2, gulf) === 'reject')

  // The same wrong area twice in 30 min, good fixes between (ship-check,
  // Sep 28): the good fixes answered the first glitch, so the second one
  // cannot vouch for it — two out-and-backs to the Gulf otherwise.
  const homeA = { ...before, ms: gulf.ms + 2 * min, lat: before.lat + 0.0002 }
  const homeB = { ...before, ms: gulf.ms + 3 * min, lat: before.lat + 0.0003 }
  const gulf2 = { ...gulf, ms: gulf.ms + 5 * min, lat: gulf.lat + 0.01 }
  ok('a glitch answered by good fixes cannot be confirmed', G.jumpVerdict(homeB, gulf2, gulf) === 'reject')
  ok('…nor with the first good fix as the basis', G.jumpVerdict(homeA, gulf2, gulf) === 'reject')
  // With only no-fix records since (they repeat it, they don't answer it) a
  // real fix there still confirms — the unit really may be there.
  ok('a reject followed only by no-fix records can still be confirmed',
    G.jumpVerdict({ ...before, ms: gulf.ms + 2 * min, valid: false }, gulf2, gulf) === 'confirmed')

  // ── No GPS fix (sec-check, Sep 28) ──
  ok('position.valid false = no fix', G.fixIsValid({ 'position.valid': false, 'position.satellites': 7 }) === false)
  ok('0 satellites = no fix', G.fixIsValid({ 'position.satellites': 0 }) === false)
  ok('"0" satellites = no fix', G.fixIsValid({ 'position.satellites': '0' }) === false)
  ok('4 satellites = a fix (the Gulf spike was one)', G.fixIsValid({ 'position.valid': true, 'position.satellites': 4 }) === true)
  ok('no satellite count = a fix', G.fixIsValid({ 'event.enum': 385 }) === true)
  ok('null satellites = a fix', G.fixIsValid({ 'position.satellites': null }) === true)
  ok('no params = a fix', G.fixIsValid(null) === true)

  // A no-fix record repeats the last place the unit knew — after a spike,
  // the spike itself. It must never confirm it.
  const repeat = { ...gulf, ms: gulf.ms + min, speed: 0, valid: false }
  ok('a no-fix repeat of a spike does not confirm it', G.jumpVerdict(before, repeat, gulf) === 'reject')
  ok('…while a real fix there would', G.jumpVerdict(before, { ...repeat, valid: true }, gulf) === 'confirmed')

  // Jammed / boxed-in haul: the unit repeats the yard under fresh times while
  // it travels 60 km; the first real fix is measured from the last REAL one.
  const yardReal = { ms: at('2026-09-28T02:00:00Z'), lat: 34.78, lng: -82.61, speed: 0 }
  const yardNoFix = { ...yardReal, ms: yardReal.ms + 50 * min, valid: false }
  const q = { ms: yardNoFix.ms + 30_000, lat: 34.78 + 0.54, lng: -82.61, speed: 55 } // ~60 km north
  ok('haul: measured from the no-fix record it reads as a spike', G.jumpVerdict(yardNoFix, q, null) === 'reject')
  const basis = G.jumpBasis(yardNoFix, yardReal, q)
  ok('haul: the basis is the last real fix', basis === yardReal)
  ok('haul: at its real age it is road speed', G.jumpVerdict(basis, q, null) === 'ok')
  // Parked with the GPS asleep for 6 h (every Sep 28 no-fix run was parked,
  // 6–19 h long): a cold-start spike is still measured from the parked record.
  const parkedReal = { ms: yardReal.ms, lat: 34.78, lng: -82.61, speed: 0 }
  const parkedNoFix = { ...parkedReal, ms: parkedReal.ms + 6 * 3_600_000, valid: false }
  const coldSpike = { ms: parkedNoFix.ms + 20_000, lat: 27.65, lng: -89.28, speed: 0 }
  ok('cold start after 6 h asleep: basis stays the parked record', G.jumpBasis(parkedNoFix, parkedReal, coldSpike) === parkedNoFix)
  ok('…and the spike is caught', G.jumpVerdict(G.jumpBasis(parkedNoFix, parkedReal, coldSpike), coldSpike, null) === 'reject')
  ok('newest is a real fix: it is the basis', G.jumpBasis(yardReal, null, q) === yardReal)
  ok('no real fix known: the newest is the basis', G.jumpBasis(yardNoFix, null, q) === yardNoFix)
  ok('a "real fix" newer than the newest is ignored', G.jumpBasis(yardNoFix, { ...yardReal, ms: q.ms }, q) === yardNoFix)
  ok('no history: no basis', G.jumpBasis(null, yardReal, q) === null)
}

// ── 2. Parked tag chatter ───────────────────────────────────────────────────
const PLUMB = { peer: '1.2.3.4:5', 'server.timestamp': 0, 'channel.id': 1401177, 'protocol.id': 14, 'codec.id': 142, 'event.priority.enum': 0, 'position.satellites': 0 }
{
  const scan = { ...PLUMB, 'event.enum': 385, 'ble.beacons': [{ id: '00000000-0000-0000-0000-7cd9f408b56b', rssi: -90 }] }
  ok('a parked tag scan is chatter', G.isTagChatter(scan, 0))
  ok('…with our stored source key too', G.isTagChatter({ source: 'flespi', ...scan }, 0))
  ok('…and with an empty list', G.isTagChatter({ ...PLUMB, 'event.enum': 385 }, null))
  ok('a moving tag scan is not', !G.isTagChatter(scan, 12))
  ok('a tag scan carrying the ignition is not', !G.isTagChatter({ ...scan, 'engine.ignition.status': false }, 0))
  ok('a tag scan carrying a voltage is not', !G.isTagChatter({ ...scan, 'external.powersource.voltage': 12.7 }, 0))
  ok('any other event is not', !G.isTagChatter({ ...scan, 'event.enum': 240 }, 0))
  ok('no params, not chatter', !G.isTagChatter(null, 0))
  ok('tag ids upper-cased', G.tagIdsOf(scan)[0] === '00000000-0000-0000-0000-7CD9F408B56B')
  ok('no list, no ids', G.tagIdsOf(PLUMB).length === 0)
}

// A synthetic day for one truck at the yard (34.78, -82.61), 11-s tag scans.
const YARD = { lat: 34.780898, lng: -82.611738 }
const T0 = Date.parse('2026-09-28T10:00:00Z')
const s = (sec) => T0 + sec * 1000
const TAG_A = '00000000-0000-0000-0000-7CD9F408B56B'
const TAG_B = '00000000-0000-0000-0000-7CD9F408B573'
function dayStream() {
  const out = []
  const io = (sec, ign, extra = {}) => out.push({ ms: s(sec), ...YARD, speed: 0, ign, params: { ...PLUMB, 'engine.ignition.status': ign, 'external.powersource.voltage': ign ? 14.2 : 12.7 }, ...extra })
  const chat = (sec, tags) => out.push({ ms: s(sec), ...YARD, speed: 0, ign: null, params: { ...PLUMB, 'event.enum': 385, ...(tags.length ? { 'ble.beacons': tags.map((id) => ({ id, rssi: -95 })) } : {}) } })
  // 1. Parked, engine off, tag A flickering — 40 min.
  io(0, false)
  let t = 7
  for (let i = 0; t < 2400; i++, t += 11) chat(t, i % 2 ? [] : [TAG_A])
  // 2. Engine on, idling 4 min with the scans still going.
  io(2410, true)
  for (t = 2421; t < 2650; t += 11) chat(t, [TAG_A])
  // 3. Drives away: 10 min at ~30 mph, 5-s records (a tag scan on the move too).
  let lat = YARD.lat
  for (t = 2655; t < 3255; t += 5) {
    lat += 0.0006
    out.push({ ms: s(t), lat, lng: YARD.lng, speed: 30, ign: true, params: { ...PLUMB, 'engine.ignition.status': true } })
    if (t % 60 === 0) out.push({ ms: s(t + 1), lat, lng: YARD.lng, speed: 30, ign: null, params: { ...PLUMB, 'event.enum': 385, 'ble.beacons': [{ id: TAG_A, rssi: -80 }] } })
  }
  // 4. Parks at the site, engine off; tag B shows up at minute 7.
  const SITE = { lat, lng: YARD.lng }
  out.push({ ms: s(3260), ...SITE, speed: 0, ign: false, params: { ...PLUMB, 'engine.ignition.status': false } })
  for (t = 3271; t < 4500; t += 11) {
    const tags = t > 3700 ? [TAG_A, TAG_B] : [TAG_A]
    out.push({ ms: s(t), ...SITE, speed: 0, ign: null, params: { ...PLUMB, 'event.enum': 385, 'ble.beacons': tags.map((id) => ({ id, rssi: -90 })) } })
  }
  // 5. Engine on and away again.
  out.push({ ms: s(4510), ...SITE, speed: 0, ign: true, params: { ...PLUMB, 'engine.ignition.status': true } })
  for (t = 4515, lat = SITE.lat; t < 4800; t += 5) { lat -= 0.0006; out.push({ ms: s(t), lat, lng: YARD.lng, speed: 30, ign: true, params: { ...PLUMB, 'engine.ignition.status': true } }) }
  return out
}

/** Run a stream through the guard the way the route does: batches of the
 *  given sizes, `last` re-read from what was stored, the tail carried in a
 *  "table" between batches. Returns the stored records in time order. */
function runGuard(stream, batchSizes) {
  const stored = []
  let tailTable = null
  let tailTags = []
  let i = 0
  let b = 0
  while (i < stream.length) {
    const size = batchSizes[b++ % batchSizes.length]
    const batch = stream.slice(i, i + size)
    i += size
    const lastRow = stored.reduce((a, r) => (!a || r.ms > a.ms ? r : a), null)
    const toFix = (r) => ({ ms: r.ms, lat: r.lat, lng: r.lng, speed: r.speed, chatter: G.isTagChatter(r.params, r.speed), tags: G.tagIdsOf(r.params), rec: r })
    const loadedTail = tailTable ? toFix(tailTable) : null
    const st = G.chatterState(lastRow ? toFix(lastRow) : null, loadedTail, tailTags)
    for (const r of batch) {
      const f = toFix(r)
      const step = G.chatterStep(st, f)
      if (step.flush) stored.push(step.flush.rec)
      if (step.store) stored.push(r)
    }
    if (st.tail && st.tail !== loadedTail) { tailTable = st.tail.rec; tailTags = Array.from(st.runTags) }
  }
  return stored.slice().sort((a, b) => a.ms - b.ms)
}

const full = dayStream()
const chatterIdx = full.map((r, i) => (G.isTagChatter(r.params, r.speed) ? i : -1)).filter((i) => i >= 0)
const statsOf = (rows) => S.computeRangeStats(rows.map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, ms: r.ms, ign: r.ign })), full[0].ms, full[full.length - 1].ms + 1, full[0].ms, full[full.length - 1].ms + 1)
const tripsOf = (rows) => T.segmentTrips(rows.map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, timestamp: new Date(r.ms).toISOString() })))
const fullStats = statsOf(full)
const fullTrips = tripsOf(full)
ok('the synthetic day has idle time to protect', fullStats.idleMin >= 3, fullStats)

const plans = [[full.length], [1], [7], [3, 50, 2, 17], [13, 1, 1, 40]]
for (const plan of plans) {
  const tag = `batches ${plan.join('/')}`
  const kept = runGuard(full, plan)
  const keptSet = new Set(kept)
  // Nothing but chatter is ever dropped.
  ok(`${tag}: every non-chatter record kept`, full.every((r, i) => keptSet.has(r) || chatterIdx.includes(i)))
  // …and every non-chatter record keeps its true neighbours.
  const nbOk = full.every((r, i) => chatterIdx.includes(i) || ((i === 0 || keptSet.has(full[i - 1])) && (i === full.length - 1 || keptSet.has(full[i + 1]))))
  ok(`${tag}: neighbours of every engine/moving record kept`, nbOk)
  // Gaps inside a parked run stay under the idle cadence.
  let maxGap = 0
  for (let k = 1; k < kept.length; k++) if (G.isTagChatter(kept[k].params, kept[k].speed) && G.isTagChatter(kept[k - 1].params, kept[k - 1].speed)) maxGap = Math.max(maxGap, kept[k].ms - kept[k - 1].ms)
  ok(`${tag}: no gap over 2.5 min inside a run`, maxGap <= G.MAX_PIECE_MS, maxGap)
  // Tag B's first scan is stored (the drawer's "heard by" reads stored rows).
  const firstB = full.find((r) => G.tagIdsOf(r.params).includes(TAG_B))
  ok(`${tag}: a new tag's first scan is stored`, keptSet.has(firstB))
  // The point of it: most of the chatter is gone.
  const keptChatter = kept.filter((r) => G.isTagChatter(r.params, r.speed)).length
  ok(`${tag}: at least 80% of the parked tag scans skipped`, keptChatter <= chatterIdx.length * 0.2, { keptChatter, of: chatterIdx.length })
  // And the asset page / trip log read exactly the same day.
  const st = statsOf(kept)
  for (const k of ['miles', 'maxMph', 'movingMin', 'idleMin', 'parkedMin', 'starts', 'fuelGalEst']) {
    ok(`${tag}: ${k} unchanged`, st[k] === fullStats[k], { full: fullStats[k], kept: st[k] })
  }
  ok(`${tag}: trips unchanged`, JSON.stringify(tripsOf(kept)) === JSON.stringify(fullTrips), { full: fullTrips.length, kept: tripsOf(kept).length })
}

// Out of order: engine records sent ahead of / behind their queue arrive a
// few seconds late (1–4% of truck records, Sep 28). Idling with tag scans,
// engine-on records every 5 min, engine off; two of them 20 s late. The
// held stretch goes in with a late record, so the idle math reads the same
// day (it read 12 min of idle for 10 before — ship-check, Sep 28).
{
  const out = []
  const eng = (sec, on) => ({ ms: s(sec), ...YARD, speed: 0, ign: on, params: { ...PLUMB, 'engine.ignition.status': on } })
  out.push(eng(0, false))
  for (let t = 7; t < 2400; t += 11) out.push({ ms: s(t), ...YARD, speed: 0, ign: null, params: { ...PLUMB, 'event.enum': 385, 'ble.beacons': [{ id: TAG_A, rssi: -90 }] } })
  const engines = []
  for (let t = 600; t < 1500; t += 300) { const e = eng(t, true); out.push(e); engines.push(e) }
  out.push(eng(1500, false))
  let lat = YARD.lat
  for (let t = 2400; t < 2700; t += 5) { lat += 0.0005; out.push({ ms: s(t), lat, lng: YARD.lng, speed: 30, ign: true, params: { ...PLUMB, 'engine.ignition.status': true } }) }
  out.sort((a, b) => a.ms - b.ms)
  const late = new Set(engines.slice(1, 3))
  const arrival = out.filter((r) => !late.has(r))
  for (const e of late) arrival.splice(arrival.findIndex((r) => r.ms > e.ms + 20_000), 0, e)
  const statsOfDay = (rows) => S.computeRangeStats(rows.map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, ms: r.ms, ign: r.ign })), out[0].ms, out[out.length - 1].ms + 1, out[0].ms, out[out.length - 1].ms + 1)
  const want = statsOfDay(out)
  ok('out-of-order day has idle to protect', want.idleMin >= 8, want)
  for (const plan of [[arrival.length], [1], [7]]) {
    const kept = runGuard(arrival, plan)
    const got = statsOfDay(kept)
    for (const k of ['idleMin', 'parkedMin', 'movingMin']) ok(`late records, batches ${plan.join('/')}: ${k} unchanged`, got[k] === want[k], { want: want[k], got: got[k] })
    ok(`late records, batches ${plan.join('/')}: every engine record kept`, [...late].every((e) => kept.includes(e)))
  }
}

// Moving tag scans are never skipped; a late record is stored and changes nothing.
{
  const st = G.chatterState(null, null)
  const mk = (sec, speed, tags = [TAG_A]) => ({ ms: s(sec), ...YARD, speed, chatter: G.isTagChatter({ ...PLUMB, 'event.enum': 385 }, speed), tags })
  ok('first record stored', G.chatterStep(st, mk(0, 0)).store)
  ok('second parked scan skipped', !G.chatterStep(st, mk(11, 0)).store)
  const late = G.chatterStep(st, mk(5, 0))
  ok('late record stored, nothing flushed', late.store && late.flush === null)
  ok('late record leaves the held one in place', st.tail && st.tail.ms === s(11))
  const moving = G.chatterStep(st, mk(22, 9))
  ok('a moving scan is stored', moving.store)
  ok('…after the held parked one', moving.flush && moving.flush.ms === s(11))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
