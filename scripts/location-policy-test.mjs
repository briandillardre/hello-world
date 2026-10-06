/**
 * Location privacy by place and shift, asserted (run: node scripts/location-policy-test.mjs).
 *
 * `lib/location-policy.ts` decides what a worker's phone may leave behind —
 * its own trail, custody of the tags it hears, or nothing but a tag's rough
 * area — and where such a tag is put. A wrong answer here is either a
 * person's evening drawn on the company map or a tool nobody can find. Run
 * it after ANY change to that file (migration 132, docs/LOCATION-PRIVACY.md).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/location-policy.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const lp = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`) }

// A deterministic pseudo-random walk (no Math.random — a failure must replay).
let seed = 20261006
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

// ── The 250 m snap ──────────────────────────────────────────────────────────
const HALF_DIAG = (lp.OFF_SHIFT_GRID_M * Math.SQRT2) / 2 // ~177 m
{
  let worst = 0, idem = true, stable = true
  for (let i = 0; i < 4000; i++) {
    const lat = -60 + rnd() * 120
    const lng = -179.5 + rnd() * 359
    const s = lp.snapToGrid(lat, lng)
    worst = Math.max(worst, lp.metresBetween({ lat, lng }, s))
    const again = lp.snapToGrid(s.lat, s.lng)
    if (again.lat !== s.lat || again.lng !== s.lng) idem = false
    const twice = lp.snapToGrid(lat, lng)
    if (twice.lat !== s.lat || twice.lng !== s.lng) stable = false
  }
  ok('snap: never more than half a cell diagonal (~177 m) from the true spot, anywhere from 60°S to 60°N', worst <= HALF_DIAG + 1, Math.round(worst))
  ok('snap: a real point moves (the cell centre is not the spot)', worst > 100, Math.round(worst))
  ok('snap: the same spot always lands in the same cell', stable)
  ok('snap: snapping a snapped point changes nothing', idem)
}
{
  // Greenville, SC. A cell centre and its neighbours are ~250 m apart.
  const c = lp.snapToGrid(34.8526, -82.394)
  const north = lp.snapToGrid(c.lat + 250 / 111_320, c.lng)
  const east = lp.snapToGrid(c.lat, c.lng + 250 / (111_320 * Math.cos((c.lat * Math.PI) / 180)))
  // Each row sizes its own columns, so the row to the north is one cell up
  // but its columns need not line up with this one's.
  ok('snap: the row to the north is one cell (~250 m) up', Math.abs(lp.metresBetween(c, { lat: north.lat, lng: c.lng }) - 250) < 2, lp.metresBetween(c, { lat: north.lat, lng: c.lng }))
  ok('snap: the cell to the east is ~250 m away', Math.abs(lp.metresBetween(c, east) - 250) < 2, lp.metresBetween(c, east))
  // Two fixes 10 m apart near a cell's middle are the same rough place.
  const a = lp.snapToGrid(c.lat + 3 / 111_320, c.lng)
  const b = lp.snapToGrid(c.lat - 7 / 111_320, c.lng)
  ok('snap: GPS wander inside a cell is one place', a.lat === b.lat && a.lng === b.lng)
  ok('snap: coordinates are rounded to 6 decimals', String(c.lat).split('.')[1].length <= 6 && String(c.lng).split('.')[1].length <= 6, c)
  ok('snap: southern and eastern hemispheres too', lp.metresBetween({ lat: -33.8688, lng: 151.2093 }, lp.snapToGrid(-33.8688, 151.2093)) <= HALF_DIAG + 1)
}

// ── Zones: inside, centre, radius, overlap ─────────────────────────────────
const lat0 = 34.85, lng0 = -82.4
const mLat = 1 / 110_574, mLng = 1 / (111_320 * Math.cos((lat0 * Math.PI) / 180))
const at = (east, north) => ({ lng: lng0 + east * mLng, lat: lat0 + north * mLat })
const ringOf = (pts) => [...pts, pts[0]].map(([e, n]) => { const p = at(e, n); return [p.lng, p.lat] })
const hall = { id: 'z-hall', name: 'Union hall', ring: ringOf([[0, 0], [200, 0], [200, 120], [0, 120]]) }
const clinic = { id: 'z-clinic', name: 'Clinic', ring: ringOf([[50, 40], [90, 40], [90, 80], [50, 80]]) }
{
  const c = lp.ringCentre(hall.ring)
  ok('centre: a 200 × 120 m box is centred at (100, 60)', lp.metresBetween(c, at(100, 60)) < 1, lp.metresBetween(c, at(100, 60)))
  const hit = lp.privacyZoneAt(at(20, 20), [hall])
  ok('zone: a fix inside is found', hit && hit.id === 'z-hall')
  ok('zone: radius = the far corner from the centre (~117 m)', hit && Math.abs(hit.radiusM - Math.hypot(100, 60)) < 2, hit && hit.radiusM)
  ok('zone: a fix outside is not', lp.privacyZoneAt(at(-10, 20), [hall]) === null)
  ok('zone: no zones, no hit', lp.privacyZoneAt(at(20, 20), []) === null)
  const both = lp.privacyZoneAt(at(70, 60), [hall, clinic])
  ok('zone: overlapping zones → the smaller, more specific one', both && both.id === 'z-clinic', both && both.id)
  // An L-shaped (concave) zone: the centre is inside its bounding box and the radius covers every corner.
  const ell = { id: 'z-l', name: 'L', ring: ringOf([[0, 0], [300, 0], [300, 60], [60, 60], [60, 240], [0, 240]]) }
  const lc = lp.ringCentre(ell.ring)
  ok('centre: an L-shaped zone centres inside its box', lc.lat > at(0, 0).lat && lc.lat < at(0, 240).lat && lc.lng > at(0, 0).lng && lc.lng < at(300, 0).lng, lc)
  ok('centre: a sliver falls back to the corners\' mean', !!lp.ringCentre([[lng0, lat0], [lng0 + 1e-9, lat0], [lng0 + 2e-9, lat0], [lng0, lat0]]))
  ok('centre: fewer than three corners → none', lp.ringCentre([[lng0, lat0], [lng0 + 1, lat0]]) === null)
}

// ── Which rows are privacy zones ───────────────────────────────────────────
{
  const geo = { type: 'Polygon', coordinates: [hall.ring] }
  const rows = [
    { id: 'b', name: 'Hall', kind: 'boundary', privacy_zone: true, geometry: geo },
    { id: 'v', name: 'Clinic', kind: 'vendor', privacy_zone: true, geometry: geo },
    { id: 's', name: 'Creekside', kind: 'site', privacy_zone: true, geometry: geo },
    { id: 'y', name: 'Yard', kind: 'yard', privacy_zone: true, geometry: geo },
    { id: 'off', name: 'Plain', kind: 'boundary', privacy_zone: false, geometry: geo },
    { id: 'bad', name: 'Broken', kind: 'boundary', privacy_zone: true, geometry: { type: 'Polygon', coordinates: [[[1, 2]]] } },
    { id: 'none', name: 'No shape', kind: 'boundary', privacy_zone: true, geometry: null },
  ]
  const ids = lp.privacyZonesFromRows(rows).map((z) => z.id).sort().join(',')
  ok('rows: boundary and vendor zones can be private; a flag on a site or yard is inert; off, broken and shapeless rows are skipped', ids === 'b,v', ids)
}

// ── Every combination: source × shift × privacy zone × recovery ────────────
const zoneHit = lp.privacyZoneAt(at(20, 20), [hall])
const fix = at(20, 20)
for (const source of ['shift', 'gateway', 'live']) {
  for (const onShift of [true, false]) {
    for (const inZone of [true, false]) {
      for (const inRecovery of [true, false]) {
        const label = `${source} · ${onShift ? 'on' : 'off'} the clock · ${inZone ? 'in a privacy zone' : 'outside zones'} · ${inRecovery ? 'tag in recovery' : 'plain tag'}`
        const p = lp.phoneFixPolicy({ source, onShift, privacyZone: inZone ? zoneHit : null })
        const expectKeep = !inZone && (source === 'live' || onShift)
        const expectCustody = !inZone && onShift && source === 'gateway'
        const expectWithheld = inZone ? 'privacy_zone' : expectKeep ? null : 'off_shift'
        ok(`policy ${label}: keepTrail=${expectKeep}`, p.keepTrail === expectKeep, p)
        ok(`policy ${label}: custody=${expectCustody}`, p.custody === expectCustody, p)
        ok(`policy ${label}: withheld=${expectWithheld}`, p.withheld === expectWithheld, p)
        ok(`policy ${label}: custody only ever rides a kept trail`, !p.custody || p.keepTrail, p)
        if (!p.custody) {
          const t = lp.placeTag(fix, { privacyZone: inZone ? zoneHit : null, inRecovery })
          if (inZone) {
            ok(`placement ${label}: the zone's centre`, t.reason === 'privacy_zone' && t.lat === zoneHit.centre.lat && t.lng === zoneHit.centre.lng && t.precisionM === zoneHit.radiusM, t)
          } else if (inRecovery) {
            ok(`placement ${label}: the exact spot`, t.reason === 'recovery' && t.precisionM === null && lp.metresBetween(t, fix) < 0.2, t)
          } else {
            const cell = lp.snapToGrid(fix.lat, fix.lng)
            ok(`placement ${label}: the 250 m cell, never the fix`, t.reason === 'off_shift' && t.precisionM === 250 && t.lat === cell.lat && t.lng === cell.lng && (t.lat !== fix.lat || t.lng !== fix.lng), t)
          }
        }
      }
    }
  }
}

// ── Folding anonymous sightings ────────────────────────────────────────────
{
  const t0 = Date.parse('2026-10-05T21:00:00Z')
  const rough = lp.placeTag(fix, { privacyZone: null, inRecovery: false })
  const last = { lat: rough.lat, lng: rough.lng, reason: rough.reason, lastSeenMs: t0, rank: 0 }
  ok('fold: first sighting of a tool starts a row', lp.anonFold(null, { ...rough, atMs: t0, rank: 0 }) === 'insert')
  ok('fold: same cell 5 min later extends it', lp.anonFold(last, { ...rough, atMs: t0 + 300_000, rank: 0 }) === 'extend')
  const next = lp.placeTag(at(20, 600), { privacyZone: null, inRecovery: false })
  ok('fold: a different cell starts a new row', lp.anonFold(last, { ...next, atMs: t0 + 300_000, rank: 0 }) === 'insert')
  ok('fold: the same cell after a 7 h gap starts a new row', lp.anonFold(last, { ...rough, atMs: t0 + 7 * 3_600_000, rank: 0 }) === 'insert')
  ok('fold: an older or replayed report changes nothing', lp.anonFold(last, { ...rough, atMs: t0 - 60_000, rank: 0 }) === 'skip' && lp.anonFold(last, { ...rough, atMs: t0, rank: 0 }) === 'skip')
  ok('fold: the owner\'s hidden phone never extends a row the crew can read (nor the reverse)', lp.anonFold(last, { ...rough, atMs: t0 + 300_000, rank: 4 }) === 'insert' && lp.anonFold({ ...last, rank: 4 }, { ...rough, atMs: t0 + 300_000, rank: 0 }) === 'insert')
  const exact = lp.placeTag(fix, { privacyZone: null, inRecovery: true })
  const lastExact = { lat: exact.lat, lng: exact.lng, reason: 'recovery', lastSeenMs: t0, rank: 0 }
  ok('fold: recovery — GPS wander within 30 m is the same place', lp.anonFold(lastExact, { ...lp.placeTag(at(40, 20), { privacyZone: null, inRecovery: true }), atMs: t0 + 60_000, rank: 0 }) === 'extend')
  ok('fold: recovery — 60 m on is a move, a new row', lp.anonFold(lastExact, { ...lp.placeTag(at(80, 20), { privacyZone: null, inRecovery: true }), atMs: t0 + 60_000, rank: 0 }) === 'insert')
  ok('fold: same spot, different reason (recovery started) → a new row', lp.anonFold(last, { lat: rough.lat, lng: rough.lng, precisionM: null, reason: 'recovery', atMs: t0 + 60_000, rank: 0 }) === 'insert')
}

// ── Who may see an anonymous sighting: the reporting phone's level ─────────
{
  ok('rank: a phone on record keeps its own level (owner only = 4)', lp.reporterRank(4, { isMaster: false, role: 'associate' }) === 4)
  ok('rank: a crew phone on record that was widened to everyone = 0', lp.reporterRank(0, { isMaster: true, role: 'admin' }) === 0)
  ok('rank: the owner with no phone on record yet = owner only', lp.reporterRank(null, { isMaster: true, role: 'admin' }) === 4)
  ok('rank: an Admin with no phone on record yet = Admins', lp.reporterRank(null, { isMaster: false, role: 'admin' }) === 3)
  ok('rank: crew with no phone on record = everyone', lp.reporterRank(null, { isMaster: false, role: 'foreman' }) === 0 && lp.reporterRank(null, { isMaster: false, role: null }) === 0)
  ok('rank: clamped to the ladder', lp.reporterRank(9, { isMaster: false, role: null }) === 4 && lp.reporterRank(-2, { isMaster: false, role: null }) === 0)
  const t = Date.parse('2026-10-05T21:00:00Z')
  ok('rank: a tag still kept by an owner-only truck stays owner-only when a crew phone hears it', lp.anonRank(0, { rank: 4, seenMs: t - 3_600_000 }, t) === 4)
  ok('rank: …until the truck has not heard it for 3 h (the arbitration window)', lp.anonRank(0, { rank: 4, seenMs: t - 3 * 3_600_000 }, t) === 0)
  ok('rank: an everyone-level holder never lowers the reporter\'s level', lp.anonRank(3, { rank: 0, seenMs: t - 60_000 }, t) === 3)
  ok('rank: no holder → the reporter\'s level', lp.anonRank(2, null, t) === 2)
}

// ── Custody vs anonymous: which place the map shows ────────────────────────
{
  const t0 = Date.parse('2026-10-05T17:00:00Z')
  const rough = { ...lp.placeTag(fix, { privacyZone: null, inRecovery: false }) }
  ok('pick: no custody at all → the anonymous sighting', lp.anonymousWins(null, { ...rough, seenMs: t0 }))
  ok('pick: custody newer → custody', !lp.anonymousWins({ seenMs: t0 + 60_000, lat: fix.lat, lng: fix.lng }, { ...rough, seenMs: t0 }))
  ok('pick: anonymous 4 h after the last custody sighting → anonymous', lp.anonymousWins({ seenMs: t0, lat: fix.lat, lng: fix.lng }, { ...rough, seenMs: t0 + 4 * 3_600_000 }))
  ok('pick: a truck parked there heard it 4 min before → the truck\'s exact spot stays', !lp.anonymousWins({ seenMs: t0, lat: fix.lat, lng: fix.lng }, { ...rough, seenMs: t0 + 240_000 }))
  const far = lp.placeTag(at(3000, 0), { privacyZone: null, inRecovery: false })
  ok('pick: fresh custody but the tag is plainly 3 km away now → anonymous', lp.anonymousWins({ seenMs: t0, lat: fix.lat, lng: fix.lng }, { ...far, seenMs: t0 + 240_000 }))
  ok('pick: fresh custody with no stored spot → custody', !lp.anonymousWins({ seenMs: t0, lat: null, lng: null }, { ...rough, seenMs: t0 + 240_000 }))
  ok('pick: a broken anonymous time never wins', !lp.anonymousWins(null, { ...rough, seenMs: NaN }))
}

// ── Words ──────────────────────────────────────────────────────────────────
{
  ok('words: off the clock names the precision and says not whose phone', /250 m/.test(lp.anonPlaceWords('off_shift', 250).long) && /not whose phone/.test(lp.anonPlaceWords('off_shift', 250).long))
  ok('words: a privacy zone says the middle of the zone', /middle of the zone/.test(lp.anonPlaceWords('privacy_zone', 120).long))
  ok('words: recovery says exact', /exact/.test(lp.anonPlaceWords('recovery', null).short))
}

console.log(`location-policy: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
