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
  ok('zone: a fix well outside is not', lp.privacyZoneAt(at(-80, 20), [hall]) === null)
  ok('zone: a fix 10 m outside the edge is (GPS scatter — 133)', lp.privacyZoneAt(at(-10, 20), [hall])?.id === 'z-hall')
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
  const mine = lp.privacyZonesFromRows([{ ...rows[0], owner_id: 'u-admin' }, rows[1]])
  ok('rows: a personal zone carries its maker; a company-wide one carries none', mine[0].ownerId === 'u-admin' && mine[1].ownerId === null, mine.map((z) => z.ownerId))
  const work = lp.workZonesFromRows(rows).map((z) => z.id).sort().join(',')
  ok('rows: sites and yards are where crews work', work === 's,y', work)
}

// ── 133: the edge of a privacy zone (GPS scatter) ──────────────────────────
{
  // A 30 × 40 m house lot. A phone inside scatters 30–80 m; every stray point
  // outside the lot used to be kept and traced the house.
  const lot = { id: 'z-lot', name: 'Home', ring: ringOf([[0, 0], [30, 0], [30, 40], [0, 40]]) }
  ok('edge: metresToRing is 0 on the edge and the true distance off it', lp.metresToRing(at(15, 0), lot.ring) < 0.5 && Math.abs(lp.metresToRing(at(15, -40), lot.ring) - 40) < 0.5 && Math.abs(lp.metresToRing(at(15, 20), lot.ring) - 15) < 0.5)
  ok('edge: 40 m outside with no accuracy given counts as inside (the 50 m floor)', !!lp.privacyZoneAt(at(15, -40), [lot]))
  ok('edge: 60 m outside with a tight 10 m fix does not', lp.privacyZoneAt(at(15, -60), [lot], { accuracyM: 10 }) === null)
  ok('edge: 60 m outside with a 100 m fix does', !!lp.privacyZoneAt(at(15, -60), [lot], { accuracyM: 100 }))
  ok('edge: a 1,000 m fix reaches no further than 150 m', !!lp.privacyZoneAt(at(15, -140), [lot], { accuracyM: 1000 }) && lp.privacyZoneAt(at(15, -165), [lot], { accuracyM: 1000 }) === null)
  ok('edge: privacyEdgeM clamps to 50–150 m', lp.privacyEdgeM(null) === 50 && lp.privacyEdgeM(10) === 50 && lp.privacyEdgeM(90) === 90 && lp.privacyEdgeM(800) === 150 && lp.privacyEdgeM(NaN) === 50)
  // A ring of points scattered around the lot at 20–45 m out: none is kept.
  let leaked = 0
  for (let i = 0; i < 360; i++) {
    const a = (i * Math.PI) / 180, r = 20 + (i % 26)
    if (!lp.privacyZoneAt(at(15 + Math.cos(a) * (15 + r), 20 + Math.sin(a) * (20 + r)), [lot])) leaked++
  }
  ok('edge: scatter 20–45 m around a house lot keeps nothing', leaked === 0, leaked)
  // A site or yard always wins: crews work there, time cards check it.
  const site = { id: 'z-site', ring: ringOf([[100, 0], [300, 0], [300, 120], [100, 120]]) }
  const set = { zones: [hall], work: [site] }
  ok('work: a fix inside a site that a private boundary overlaps is kept (not in the zone)', lp.privacyZoneAt(at(150, 60), set) === null)
  ok('work: a fix in the private boundary outside the site is still withheld', lp.privacyZoneAt(at(50, 60), set)?.id === 'z-hall')
  ok('work: the bare-array form has no sites (same as before)', lp.privacyZoneAt(at(150, 60), [hall])?.id === 'z-hall')
  ok('visible: a company-wide zone is visible to anyone; a personal one only to its maker',
    lp.privacyZoneVisibleTo({ ownerId: null }, 'u1') && lp.privacyZoneVisibleTo({ ownerId: 'u1' }, 'u1') && !lp.privacyZoneVisibleTo({ ownerId: 'u1' }, 'u2') && !lp.privacyZoneVisibleTo(null, 'u1') && !lp.privacyZoneVisibleTo({ ownerId: 'u1' }, null))
  const personal = lp.privacyZoneAt(at(20, 20), [{ ...hall, ownerId: 'u-admin', ownerRank: 3 }])
  ok('visible: a hit carries the maker and the maker\'s rank', personal.ownerId === 'u-admin' && personal.ownerRank === 3, personal)
  ok('visible: a personal zone with no known rank reads as owner-only (null → 4 at filing)', lp.privacyZoneAt(at(20, 20), [{ ...hall, ownerId: 'u-x' }]).ownerRank === null)
  // What a reply may say: only zones the person may know of.
  const adminsHome = { ...clinic, id: 'z-home', ownerId: 'u-admin', ownerRank: 3 }
  ok('reply: inside an Admin\'s hidden personal zone, the crew member\'s reply sees no zone', !!lp.privacyZoneAt(at(70, 60), [adminsHome]) && lp.privacyZoneAt(at(70, 60), [adminsHome], { onlyVisibleTo: 'u-crew' }) === null)
  ok('reply: … the Admin\'s own reply does', lp.privacyZoneAt(at(70, 60), [adminsHome], { onlyVisibleTo: 'u-admin' })?.id === 'z-home')
  ok('reply: a hidden personal zone inside a company-wide one: the tag goes by the smaller (hidden) zone, the reply by the visible one',
    lp.privacyZoneAt(at(70, 60), [hall, adminsHome])?.id === 'z-home' && lp.privacyZoneAt(at(70, 60), [hall, adminsHome], { onlyVisibleTo: 'u-crew' })?.id === 'z-hall')
  ok('reply: no user → only company-wide zones', lp.privacyZoneAt(at(70, 60), [adminsHome], { onlyVisibleTo: null }) === null)
}

// ── 133: may a zone be private over a site? (ringsIntersect) ───────────────
{
  const sq = (e, n, w, h) => ringOf([[e, n], [e + w, n], [e + w, n + h], [e, n + h]])
  ok('overlap: two crossing squares intersect', lp.ringsIntersect(sq(0, 0, 100, 100), sq(50, 50, 100, 100)))
  ok('overlap: one inside the other intersects (no edge crosses)', lp.ringsIntersect(sq(0, 0, 300, 300), sq(100, 100, 20, 20)) && lp.ringsIntersect(sq(100, 100, 20, 20), sq(0, 0, 300, 300)))
  ok('overlap: a shared edge counts', lp.ringsIntersect(sq(0, 0, 100, 100), sq(100, 0, 100, 100)))
  ok('overlap: apart is apart', !lp.ringsIntersect(sq(0, 0, 100, 100), sq(150, 0, 100, 100)))
  // An L whose bounding box covers a square the L itself never touches.
  const ell = ringOf([[0, 0], [300, 0], [300, 60], [60, 60], [60, 240], [0, 240]])
  ok('overlap: inside an L\'s bounding box but clear of the L is apart', !lp.ringsIntersect(ell, sq(150, 150, 50, 50)))
  ok('overlap: a broken ring never intersects', !lp.ringsIntersect([[0, 0], [1, 1]], sq(0, 0, 10, 10)))
  // Sites near a private zone (its edge reaches 150 m): the server keeps them.
  ok('near: a site 100 m from a private zone is within reach, one 300 m away is not', lp.ringsNear(sq(0, 0, 100, 100), sq(200, 0, 100, 100), 150) && !lp.ringsNear(sq(0, 0, 100, 100), sq(400, 0, 100, 100), 150))
  ok('near: overlapping is near', lp.ringsNear(sq(0, 0, 100, 100), sq(50, 50, 100, 100), 0))
  // …and a fix inside such a site, 40 m from the private zone, is kept.
  const home = { id: 'z-h', name: 'Home', ring: sq(0, 0, 100, 100) }
  const nextDoor = { id: 'z-s', ring: sq(140, 0, 200, 100) }
  ok('near: a 100 m fix inside the site next door, 60 m from the private edge, is kept (without the site it would not be)',
    lp.privacyZoneAt(at(160, 50), { zones: [home], work: [nextDoor] }, { accuracyM: 100 }) === null && !!lp.privacyZoneAt(at(160, 50), [home], { accuracyM: 100 }))
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
            // 133: the 250 m cell of the zone's centre, never the centre itself.
            const cell = lp.snapToGrid(zoneHit.centre.lat, zoneHit.centre.lng)
            ok(`placement ${label}: the 250 m cell of the zone's centre, ≥ 250 m rough`, t.reason === 'privacy_zone' && t.lat === cell.lat && t.lng === cell.lng && t.precisionM === Math.max(250, zoneHit.radiusM) && (t.lat !== zoneHit.centre.lat || t.lng !== zoneHit.centre.lng), t)
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
  // A row that has sat at its cell since 8 PM (settled), last heard at 9 PM.
  const last = { lat: rough.lat, lng: rough.lng, reason: rough.reason, firstSeenMs: t0 - 3_600_000, lastSeenMs: t0, rank: 0 }
  ok('fold: first sighting of a tool starts a row', lp.anonFold(null, { ...rough, atMs: t0, rank: 0 }) === 'insert')
  ok('fold: same cell 5 min later extends it', lp.anonFold(last, { ...rough, atMs: t0 + 300_000, rank: 0 }) === 'extend')
  const next = lp.placeTag(at(20, 600), { privacyZone: null, inRecovery: false })
  ok('fold: leaving a cell it SETTLED at starts a new row (where it sat stays in its history)', lp.anonFold(last, { ...next, atMs: t0 + 300_000, rank: 0 }) === 'insert')
  ok('fold: a different cell while still on the move carries the row along', lp.anonFold({ ...last, firstSeenMs: t0 - 60_000 }, { ...next, atMs: t0 + 20_000, rank: 0 }) === 'move')
  ok('fold: a row that moved settles by its time at the NEW place', lp.anonFold({ ...last, firstSeenMs: t0 - 3_600_000, placeSinceMs: t0 - 60_000 }, { ...next, atMs: t0 + 20_000, rank: 0 }) === 'move'
    && lp.anonFold({ ...last, firstSeenMs: t0 - 3_600_000, placeSinceMs: t0 - 11 * 60_000 }, { ...next, atMs: t0 + 20_000, rank: 0 }) === 'insert')
  ok('fold: a new cell after a long gap (> 10 min) is a new run, a new row', lp.anonFold({ ...last, firstSeenMs: t0 - 60_000 }, { ...next, atMs: t0 + 11 * 60_000, rank: 0 }) === 'insert')
  ok('fold: the same cell after a 7 h gap starts a new row', lp.anonFold(last, { ...rough, atMs: t0 + 7 * 3_600_000, rank: 0 }) === 'insert')
  ok('fold: an older or replayed report changes nothing', lp.anonFold(last, { ...rough, atMs: t0 - 60_000, rank: 0 }) === 'skip' && lp.anonFold(last, { ...rough, atMs: t0, rank: 0 }) === 'skip')
  ok('fold: the owner\'s hidden phone never extends a row the crew can read (nor the reverse)', lp.anonFold(last, { ...rough, atMs: t0 + 300_000, rank: 4 }) === 'insert' && lp.anonFold({ ...last, rank: 4 }, { ...rough, atMs: t0 + 300_000, rank: 0 }) === 'insert')
  const exact = lp.placeTag(fix, { privacyZone: null, inRecovery: true })
  const lastExact = { lat: exact.lat, lng: exact.lng, reason: 'recovery', firstSeenMs: t0 - 3_600_000, lastSeenMs: t0, rank: 3 }
  ok('fold: recovery — GPS wander within 30 m is the same place', lp.anonFold(lastExact, { ...lp.placeTag(at(40, 20), { privacyZone: null, inRecovery: true }), atMs: t0 + 60_000, rank: 3 }) === 'extend')
  ok('fold: recovery — 60 m on from where it sat is a move to a new place, a new row', lp.anonFold(lastExact, { ...lp.placeTag(at(80, 20), { privacyZone: null, inRecovery: true }), atMs: t0 + 60_000, rank: 3 }) === 'insert')
  ok('fold: same spot, different reason (recovery started) → a new row', lp.anonFold(last, { lat: rough.lat, lng: rough.lng, precisionM: null, reason: 'recovery', atMs: t0 + 60_000, rank: 3 }) === 'insert')
  // The insert cap: about one new row per tool per 2 minutes.
  ok('cap: a new row within 2 min of the tool\'s last new row is skipped', lp.anonFold(null, { ...rough, atMs: t0, rank: 0 }, { lastInsertMs: t0 - 60_000 }) === 'skip')
  ok('cap: … and allowed after 2 min', lp.anonFold(null, { ...rough, atMs: t0, rank: 0 }, { lastInsertMs: t0 - 121_000 }) === 'insert')
  ok('cap: extending or moving the row is never capped', lp.anonFold(last, { ...rough, atMs: t0 + 60_000, rank: 0 }, { lastInsertMs: t0 }) === 'extend'
    && lp.anonFold({ ...last, firstSeenMs: t0 - 30_000 }, { ...next, atMs: t0 + 20_000, rank: 0 }, { lastInsertMs: t0 - 30_000 }) === 'move')
  ok('cap: a broken time never writes', lp.anonFold(null, { ...rough, atMs: NaN, rank: 0 }) === 'skip')
}

// ── 133: the fold, end to end (the rows a day of reports leaves behind) ─────
// A small in-memory twin of lib/location-privacy.ts `foldSighting`: per tool,
// fold against the newest row of the SAME (rank, reason), cap new rows.
function simulate(reports) {
  const rows = []
  for (const r of reports) {
    const p = lp.placeTag(r.fix, { privacyZone: r.zone ?? null, inRecovery: !!r.recovery })
    const rank = lp.anonSightingRank({ reporter: r.rank ?? 0, holder: null, atMs: r.atMs, placement: p, zone: r.zone ?? null })
    const same = rows.filter((x) => x.reason === p.reason && x.rank === rank).sort((a, b) => b.lastSeenMs - a.lastSeenMs)[0] ?? null
    const lastInsertMs = rows.reduce((m, x) => (x.firstSeenMs > r.atMs - lp.ANON_INSERT_GAP_MS && x.firstSeenMs > (m ?? -Infinity) ? x.firstSeenMs : m), null)
    const d = lp.anonFold(same, { ...p, atMs: r.atMs, rank }, { lastInsertMs })
    if (d === 'insert') rows.push({ lat: p.lat, lng: p.lng, reason: p.reason, rank, firstSeenMs: r.atMs, lastSeenMs: r.atMs, placeSinceMs: null, heard: 1 })
    else if (d === 'extend') { same.lastSeenMs = r.atMs; same.heard++ }
    else if (d === 'move') Object.assign(same, { lat: p.lat, lng: p.lng, lastSeenMs: r.atMs, placeSinceMs: r.atMs, heard: same.heard + 1 })
  }
  return rows
}
{
  const t0 = Date.parse('2026-10-05T22:00:00Z')
  // A crew member drives home off the clock with a tagged saw in the bed: a
  // report every 20 s for 25 minutes across ~10 km (dozens of 250 m cells).
  const drive = []
  for (let i = 0; i <= 75; i++) drive.push({ fix: at(i * 130, i * 40), atMs: t0 + i * 20_000 })
  const cells = new Set(drive.map((r) => { const c = lp.snapToGrid(r.fix.lat, r.fix.lng); return `${c.lat},${c.lng}` })).size
  const driveRows = simulate(drive)
  ok(`run: a 25-minute drive across ${cells} cells leaves ONE row, ending where the drive ended`, driveRows.length === 1 && driveRows[0].lat === lp.snapToGrid(drive[75].fix.lat, drive[75].fix.lng).lat, driveRows.length)
  // …then the saw sits at the house overnight (heard every minute), and the
  // next morning it leaves again: the overnight place is kept as its own row.
  const night = []
  const home = at(75 * 130, 75 * 40)
  for (let i = 1; i <= 600; i++) night.push({ fix: home, atMs: t0 + 25 * 60_000 + i * 60_000 })
  const morning = []
  for (let i = 1; i <= 30; i++) morning.push({ fix: at(75 * 130 + i * 150, 75 * 40), atMs: t0 + 25 * 60_000 + 601 * 60_000 + i * 20_000 })
  const dayRows = simulate([...drive, ...night, ...morning])
  ok('run: drive → overnight → drive leaves two rows (the first run settled at the house; the morning run is its own)', dayRows.length === 2, dayRows.length)
  ok('run: the first row still says the house, heard all night', dayRows[0].lat === lp.snapToGrid(home.lat, home.lng).lat && dayRows[0].heard >= 600, dayRows[0])
  // Two phones of different levels at one place: one row each, not a row per alternation.
  const both = []
  for (let i = 0; i < 120; i++) both.push({ fix, atMs: t0 + i * 10_000, rank: i % 2 ? 4 : 0 })
  const bothRows = simulate(both)
  ok('run: an owner-only phone and a crew phone hearing one tool alternately leave two rows, not 120', bothRows.length === 2, bothRows.length)
  // A forged report storm: 60 made-up places in 60 seconds → about one row.
  const storm = []
  for (let i = 0; i < 60; i++) storm.push({ fix: at(i * 5000, 0), atMs: t0 + i * 1000 })
  ok('run: a minute of forged far-apart places leaves one row (the cap and the run)', simulate(storm).length === 1, simulate(storm).length)
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
  // 133: two floors on what is stored.
  const company = lp.privacyZoneAt(at(20, 20), [hall])
  const personalAdmin = lp.privacyZoneAt(at(20, 20), [{ ...hall, ownerId: 'u-admin', ownerRank: 3 }])
  const personalUnknown = lp.privacyZoneAt(at(20, 20), [{ ...hall, ownerId: 'u-gone' }])
  const inZone = lp.placeTag(fix, { privacyZone: company, inRecovery: false })
  ok('rank: a crew phone in a company-wide privacy zone files at its own level', lp.anonSightingRank({ reporter: 0, holder: null, atMs: t, placement: inZone, zone: company }) === 0)
  ok('rank: in an Admin\'s personal ("only me") zone, no lower than the Admin', lp.anonSightingRank({ reporter: 0, holder: null, atMs: t, placement: inZone, zone: personalAdmin }) === 3)
  ok('rank: a personal zone whose maker is unknown reads as owner-only', lp.anonSightingRank({ reporter: 0, holder: null, atMs: t, placement: inZone, zone: personalUnknown }) === 4)
  ok('rank: the owner\'s own phone keeps its level in an Admin\'s zone', lp.anonSightingRank({ reporter: 4, holder: null, atMs: t, placement: inZone, zone: personalAdmin }) === 4)
  const exactSpot = lp.placeTag(fix, { privacyZone: null, inRecovery: true })
  ok('rank: a recovery\'s exact spot is for Admins and the owner, whoever reported it', lp.anonSightingRank({ reporter: 0, holder: null, atMs: t, placement: exactSpot, zone: null }) === lp.RECOVERY_MIN_RANK && lp.RECOVERY_MIN_RANK === 3)
  ok('rank: … and never lower than an owner-only reporter', lp.anonSightingRank({ reporter: 4, holder: null, atMs: t, placement: exactSpot, zone: null }) === 4)
  ok('rank: off the clock, outside zones: the reporter (and holder) as before', lp.anonSightingRank({ reporter: 0, holder: { rank: 2, seenMs: t - 60_000 }, atMs: t, placement: lp.placeTag(fix, { privacyZone: null, inRecovery: false }), zone: null }) === 2)
}

// ── 133: a privacy zone places its tags no finer than the grid ─────────────
{
  const lot = { id: 'z-lot', name: 'Home', ring: ringOf([[0, 0], [30, 0], [30, 40], [0, 40]]) }
  const hit = lp.privacyZoneAt(at(10, 10), [lot])
  const t = lp.placeTag(at(10, 10), { privacyZone: hit, inRecovery: false })
  ok('zone place: a 30 × 40 m house lot files its tags ~250 m rough, not ±25 m', t.precisionM === 250 && hit.radiusM < 30, { precisionM: t.precisionM, radius: hit.radiusM })
  ok('zone place: on the grid (snapping it again changes nothing)', (() => { const again = lp.snapToGrid(t.lat, t.lng); return again.lat === t.lat && again.lng === t.lng })())
  ok('zone place: the house is somewhere within ~250 m of it — never at it', lp.metresBetween(t, hit.centre) <= HALF_DIAG + 1)
  const big = { id: 'z-big', name: 'Ranch', ring: ringOf([[0, 0], [2000, 0], [2000, 1500], [0, 1500]]) }
  const bigHit = lp.privacyZoneAt(at(100, 100), [big])
  ok('zone place: a bigger zone keeps its own (bigger) roughness', lp.placeTag(at(100, 100), { privacyZone: bigHit, inRecovery: false }).precisionM === bigHit.radiusM && bigHit.radiusM > 1000)
  ok('zone place: the zone still wins over recovery', lp.placeTag(at(10, 10), { privacyZone: hit, inRecovery: true }).reason === 'privacy_zone')
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
  // 133: a truck HAULING the tag. Its snapshot is where it last heard the tag
  // a minute ago (1.5 km back at 55 mph); the dot is drawn at its live
  // position; a phone riding along hears the tag right there.
  const snap = at(0, 0), liveSpot = at(1500, 0)
  const ridingAlong = { ...lp.placeTag(at(1520, 10), { privacyZone: null, inRecovery: false }), seenMs: t0 + 60_000 }
  ok('pick: a phone riding in the hauling truck no longer pulls the dot off the truck', !lp.anonymousWins({ seenMs: t0, lat: snap.lat, lng: snap.lng, live: liveSpot }, ridingAlong))
  ok('pick: … (without the live position it did — the flicker)', lp.anonymousWins({ seenMs: t0, lat: snap.lat, lng: snap.lng }, ridingAlong))
  ok('pick: far from BOTH the snapshot and the truck → the tag moved', lp.anonymousWins({ seenMs: t0, lat: snap.lat, lng: snap.lng, live: liveSpot }, { ...lp.placeTag(at(-4000, 3000), { privacyZone: null, inRecovery: false }), seenMs: t0 + 60_000 }))
  ok('pick: near the snapshot alone still keeps custody', !lp.anonymousWins({ seenMs: t0, lat: snap.lat, lng: snap.lng, live: liveSpot }, { ...lp.placeTag(at(10, 0), { privacyZone: null, inRecovery: false }), seenMs: t0 + 60_000 }))
  ok('pick: a live position alone (no snapshot) counts', !lp.anonymousWins({ seenMs: t0, lat: null, lng: null, live: liveSpot }, ridingAlong))
  // Drive the whole haul: every 20 s the truck moves 490 m and hears the tag
  // (custody), and the phone in the cab reports 10 s after each.
  let flips = 0, prev = null
  for (let i = 0; i < 60; i++) {
    const truckAt = at(i * 490, 0)
    const phone = { ...lp.placeTag(at(i * 490 + 245, 5), { privacyZone: null, inRecovery: false }), seenMs: t0 + i * 20_000 + 10_000 }
    const truckNow = at(i * 490 + 245, 0)
    const pick = lp.anonymousWins({ seenMs: t0 + i * 20_000, lat: truckAt.lat, lng: truckAt.lng, live: truckNow }, phone) ? 'anon' : 'truck'
    if (prev && pick !== prev) flips++
    prev = pick
  }
  ok('pick: a 20-minute haul with a phone in the cab never flickers off the truck', flips === 0 && prev === 'truck', { flips, prev })
}

// ── Words ──────────────────────────────────────────────────────────────────
{
  ok('words: off the clock names the precision and says not whose phone', /250 m/.test(lp.anonPlaceWords('off_shift', 250).long) && /not whose phone/.test(lp.anonPlaceWords('off_shift', 250).long))
  ok('words: a privacy zone says it, and how rough (never finer than 250 m), never where in the zone', /privacy zone/.test(lp.anonPlaceWords('privacy_zone', 120).long) && /about 250 m/.test(lp.anonPlaceWords('privacy_zone', 120).long) && /about 400 m/.test(lp.anonPlaceWords('privacy_zone', 400).long) && !/middle/.test(lp.anonPlaceWords('privacy_zone', 400).long))
  ok('words: recovery says exact', /exact/.test(lp.anonPlaceWords('recovery', null).short))
}

console.log(`location-policy: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
