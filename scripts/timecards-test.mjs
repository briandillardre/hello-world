/**
 * Time card integrity, asserted (run: node scripts/timecards-test.mjs).
 *
 * lib/timecards.ts reads a shift's phone record against the clock and says,
 * in one sentence, what a manager should look at; lib/clock-policy.ts is the
 * rule that refuses a clock-in away from the site. Both are payroll and
 * accusations, so the false positives are asserted as hard as the catches:
 * a yard start is not "clocked in away", a slow first fix is not "arrived
 * late", a phone that went dark is not "left early". Run after ANY change to
 * either file.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
function transpile(rel, deps = {}) {
  let src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [spec, url] of Object.entries(deps)) src = src.replaceAll(`from '${spec}'`, `from '${url}'`)
  return dataUrl(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}
const datesUrl = transpile('../lib/dates.ts')
const policyUrl = transpile('../lib/clock-policy.ts')
const policy = await import(policyUrl)
const tc = await import(transpile('../lib/timecards.ts', { './dates': datesUrl, './clock-policy': policyUrl }))
const { buildTimeCards, summarizeCards, reviewItems, timeCardsCsv, INTEGRITY_FLAGS, FLAG_LABEL, fmtMinutes } = tc
const { resolveClockPolicy, nextClockPolicy, distanceToRingM, pointInRing, clockInPlaceCheck, fmtDistanceM, CLOCK_POLICY_DEFAULTS } = policy

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => Math.abs(a - b) <= eps

// ── Fixtures ──────────────────────────────────────────────────────────────
const TZ = 'America/New_York'
const DAY = '2026-09-21' // a Monday
const at = (hhmm, day = DAY) => new Date(`${day}T${hhmm}:00-04:00`).toISOString()
const plus = (iso, min) => new Date(Date.parse(iso) + min * 60_000).toISOString()
const NOW = Date.parse(at('20:00'))
let n = 0
const entry = (o) => ({
  id: `e${++n}`, userId: 'u1', personName: 'Crew One', category: 'project', zoneId: 'z1', zoneName: 'Maple Ridge',
  plan: '', inAt: at('06:00'), outAt: at('15:00'), breakMinutes: 0, inLat: 34.85, inLng: -82.39, outLat: 34.85, outLng: -82.39,
  inPlace: null, outPlace: null, edited: null, gps: null, ...o,
})
/** A clean full-day record: on site from the first fix to the last. */
const cleanGps = (e, extra = {}) => ({
  fixes: 300, onSite: 290, firstFix: e.inAt, lastFix: e.outAt ?? plus(e.inAt, 60),
  firstOnSite: e.inAt, lastOnSite: e.outAt ?? plus(e.inAt, 60), spreadM: 400, inDistM: 0, outDistM: 0, inAtYard: false, outAtYard: false, ...extra,
})
const build = (entries, opts = {}) => buildTimeCards(entries, { tz: TZ, nowMs: NOW, ...opts })
const rows = (cards) => cards.flatMap((c) => c.days.flatMap((d) => d.entries))
const flagsOf = (r) => r.flags.filter((f) => INTEGRITY_FLAGS.includes(f))

// ── A clean shift raises nothing ──────────────────────────────────────────
{
  const e = entry({}); e.gps = cleanGps(e)
  const [r] = rows(build([e]))
  ok('clean shift: no integrity flags', flagsOf(r).length === 0 && r.review === false && r.findings.length === 0, r.findings)
  ok('clean shift: 9.0 paid hours, 97% on site', r.hours === 9 && r.onSitePct === 97, [r.hours, r.onSitePct])
  ok('summary: nothing flagged', summarizeCards(build([e])).flagged === 0)
}

// ── Buddy punch: two people, one phone ────────────────────────────────────
{
  const a = entry({ userId: 'u1', personName: 'Crew One', deviceId: 'phone-abc-123' }); a.gps = cleanGps(a)
  const b = entry({ userId: 'u2', personName: 'Crew Two', deviceId: 'phone-abc-123', inAt: at('06:20'), outAt: at('15:00') }); b.gps = cleanGps(b)
  const c = entry({ userId: 'u3', personName: 'Crew Three', deviceId: 'phone-xyz-999' }); c.gps = cleanGps(c)
  const cards = build([a, b, c])
  const rs = rows(cards)
  const ra = rs.find((r) => r.userId === 'u1'), rb = rs.find((r) => r.userId === 'u2'), rc = rs.find((r) => r.userId === 'u3')
  ok('shared phone: both entries flagged', ra.flags.includes('shared_device') && rb.flags.includes('shared_device'))
  ok('shared phone: names the teammate, never an id', ra.findings.includes('Same phone as Crew Two') && rb.findings.includes('Same phone as Crew One') && !JSON.stringify(ra.findings).includes('abc-123'), ra.findings)
  ok('shared phone: an own phone is not flagged', !rc.flags.includes('shared_device') && rc.review === false)
  ok('shared phone: the clock-out device counts too', rows(build([
    Object.assign(entry({ userId: 'u1', outDeviceId: 'd-shared-1' }), { gps: null }),
    Object.assign(entry({ userId: 'u2', personName: 'Crew Two', deviceId: 'd-shared-1' }), { gps: null }),
  ])).every((r) => r.flags.includes('shared_device')))
  ok('review counts per person', cards.find((x) => x.userId === 'u1').review === 1 && cards.find((x) => x.userId === 'u3').review === 0)
}

// ── Ghost shift, phone dark: 14 hours, no fixes ───────────────────────────
{
  const e = entry({ inAt: at('05:17'), outAt: at('19:15') })
  e.gps = { fixes: 0, onSite: 0, firstFix: null, lastFix: null }
  const [r] = rows(build([e]))
  ok('no fixes all day: No GPS with the hours in the sentence', r.flags.includes('no_gps') && r.findings.includes('14.0 h clocked with no phone fixes at all'), r.findings)
  ok('13 h 58 min is not yet a long shift', !r.flags.includes('long'))
  const lng = entry({ inAt: at('05:00'), outAt: at('19:30') }); lng.gps = cleanGps(lng)
  ok('14.5 h is a long shift, in words', rows(build([lng]))[0].flags.includes('long') && rows(build([lng]))[0].findings.includes('14.5 h shift'))
  ok('worst flag is No GPS', reviewItems(build([e]))[0].worst === 'no_gps')
  const fresh = entry({ inAt: plus(new Date(NOW).toISOString(), -5), outAt: null }); fresh.gps = { fixes: 0, onSite: 0, firstFix: null, lastFix: null }
  ok('a shift five minutes old is not "No GPS" yet', !rows(build([fresh]))[0].flags.includes('no_gps'))
}

// ── Ghost shift, phone on: every fix somewhere else ───────────────────────
{
  const e = entry({ inAt: at('06:11'), outAt: at('13:22') })
  e.gps = cleanGps(e, { fixes: 200, onSite: 0, firstOnSite: null, lastOnSite: null, spreadM: 900, inDistM: 12_070, outDistM: 12_070 })
  const [r] = rows(build([e]))
  ok('never on site', r.flags.includes('never_on_site') && r.findings.includes('Never on Maple Ridge: 200 phone fixes during the shift, none inside the site'), r.findings)
  ok('never on site replaces mostly off-site', !r.flags.includes('off_site'))
  ok('clocked in and out 7.5 mi away', r.findings.includes('Clocked in 7.5 mi from Maple Ridge') && r.findings.includes('Clocked out 7.5 mi from Maple Ridge'), r.findings)
  ok('no "arrived late" without an on-site fix', !r.flags.includes('arrived_late') && !r.flags.includes('left_early'))
  ok('worst of the week sorts first', reviewItems(build([e]))[0].worst === 'never_on_site')
}

// ── The prospect's case: clocked in at 5:20, on site at 5:39 ──────────────
{
  const e = entry({ inAt: at('05:20'), outAt: at('15:00') })
  e.gps = cleanGps(e, { inDistM: 3_000, firstFix: e.inAt, firstOnSite: at('05:39') })
  const [r] = rows(build([e]))
  ok('on site 19 min after clocking in', r.flags.includes('arrived_late') && r.findings.includes('On site 19 min after clocking in'), r.findings)
  ok('and the tap itself was away from the site', r.flags.includes('in_away') && r.findings.includes('Clocked in 1.9 mi from Maple Ridge'), r.findings)
  ok('one entry, one review row, two sentences', reviewItems(build([e])).length === 1 && r.findings.length === 2)
}

// ── Not a doubt: a yard start ─────────────────────────────────────────────
{
  const e = entry({})
  e.gps = cleanGps(e, { inDistM: 3_000, inAtYard: true, firstFix: e.inAt, firstOnSite: plus(e.inAt, 25) })
  const [r] = rows(build([e]))
  ok('yard start: neither "away" nor "arrived late"', !r.flags.includes('in_away') && !r.flags.includes('arrived_late') && r.review === false, r.findings)
  const f = entry({}); f.gps = cleanGps(f, { outDistM: 2_500, outAtYard: true, lastOnSite: plus(f.outAt, -30), lastFix: f.outAt })
  ok('yard finish: neither "clocked out away" nor "left early"', rows(build([f]))[0].review === false)
}

// ── Not a doubt: the tracker's first fix took a while ─────────────────────
{
  const e = entry({})
  e.gps = cleanGps(e, { inDistM: 0, firstFix: plus(e.inAt, 12), firstOnSite: plus(e.inAt, 12) })
  ok('slow first fix on site is not an arrival', !rows(build([e]))[0].flags.includes('arrived_late'))
  const g = entry({})
  g.gps = cleanGps(g, { inDistM: 40, firstFix: g.inAt, firstOnSite: plus(g.inAt, 15) })
  ok('a tap at the fence line (40 m) is not "away" and not "late"', rows(build([g]))[0].review === false, rows(build([g]))[0].findings)
}

// ── Left early vs the phone going dark ────────────────────────────────────
{
  const e = entry({ inAt: at('06:00'), outAt: at('15:00') })
  e.gps = cleanGps(e, { lastOnSite: at('14:15'), lastFix: e.outAt, outDistM: 5_000 })
  const [r] = rows(build([e]))
  ok('left 45 min before clocking out', r.flags.includes('left_early') && r.findings.includes('Left the site 45 min before clocking out'), r.findings)
  ok('and clocked out 3.1 mi away', r.findings.includes('Clocked out 3.1 mi from Maple Ridge'), r.findings)
  const d = entry({ inAt: at('06:00'), outAt: at('15:00') })
  d.gps = cleanGps(d, { lastOnSite: at('12:00'), lastFix: at('12:00'), outDistM: null })
  ok('phone went dark at noon: not "left early"', !rows(build([d]))[0].flags.includes('left_early'))
  const o = entry({ outAt: null }); o.gps = cleanGps(o, { lastOnSite: plus(o.inAt, 60), lastFix: plus(o.inAt, 120), outDistM: null })
  ok('an open shift is never "left early" or "clocked out away"', !rows(build([o]))[0].flags.includes('left_early') && !rows(build([o]))[0].flags.includes('out_away'))
}

// ── The phone that never moved ────────────────────────────────────────────
{
  const e = entry({ inAt: at('07:00'), outAt: at('15:00') })
  e.gps = cleanGps(e, { fixes: 400, onSite: 400, spreadM: 12 })
  const [r] = rows(build([e]))
  ok('phone still all shift', r.flags.includes('phone_still') && r.findings.includes("Phone didn't move all shift (40 ft across 8.0 h)"), r.findings)
  const s = entry({ inAt: at('07:00'), outAt: at('08:30') }); s.gps = cleanGps(s, { fixes: 100, onSite: 100, spreadM: 12 })
  ok('a 90-minute shift is too short to call', !rows(build([s]))[0].flags.includes('phone_still'))
  const w = entry({ inAt: at('07:00'), outAt: at('15:00') }); w.gps = cleanGps(w, { fixes: 400, onSite: 400, spreadM: 80 })
  ok('80 m of movement is a person working', !rows(build([w]))[0].flags.includes('phone_still'))
}

// ── Photo policy ──────────────────────────────────────────────────────────
{
  const pol = { photoIn: true, photoOut: true, photoInSince: '2020-01-01T00:00:00Z', photoOutSince: '2020-01-01T00:00:00Z' }
  const e = entry({}); e.gps = cleanGps(e)
  ok('both photos missing: one sentence', rows(build([e], { policy: pol }))[0].findings.includes('No clock-in or clock-out photo'))
  const i = entry({ inPhoto: true }); i.gps = cleanGps(i)
  ok('clock-out photo missing', rows(build([i], { policy: pol }))[0].findings.includes('No clock-out photo'))
  const o = entry({ outAt: null }); o.gps = cleanGps(o)
  ok('open shift: only the clock-in photo is due', rows(build([o], { policy: pol }))[0].findings.includes('No clock-in photo'))
  const both = entry({ inPhoto: true, outPhoto: true }); both.gps = cleanGps(both)
  ok('both present: nothing', rows(build([both], { policy: pol }))[0].review === false)
  ok('policy off: nothing', rows(build([e], { policy: { photoIn: false, photoOut: false } }))[0].review === false && rows(build([e]))[0].review === false)
  // The switch went on AFTER the shift: nobody asked for a photo then (ship-check P1).
  const later = { photoIn: true, photoOut: true, photoInSince: plus(e.outAt, 60), photoOutSince: plus(e.outAt, 60) }
  ok('a switch flipped after the shift accuses nobody', rows(build([e], { policy: later }))[0].review === false, rows(build([e], { policy: later }))[0].findings)
  const undated = { photoIn: true, photoOut: true }
  ok('a switch on with no date accuses nobody', rows(build([e], { policy: undated }))[0].review === false)
  const mid = { photoIn: true, photoOut: false, photoInSince: plus(e.inAt, -1) }
  ok('a switch on a minute before clock-in applies', rows(build([e], { policy: mid }))[0].findings.includes('No clock-in photo'))
}

// ── The stored policy stamps its switches (ship-check P1) ─────────────────
{
  const off = CLOCK_POLICY_DEFAULTS
  const on = nextClockPolicy(off, { ...off, photoIn: true }, '2026-09-23T12:00:00.000Z')
  ok('off → on stamps now', on.photoInSince === '2026-09-23T12:00:00.000Z' && on.photoOutSince === null, on)
  const still = nextClockPolicy(on, { ...on, atSite: true }, '2026-09-24T12:00:00.000Z')
  ok('on → on keeps the original stamp', still.photoInSince === '2026-09-23T12:00:00.000Z', still)
  const back = nextClockPolicy(still, { ...still, photoIn: false }, '2026-09-25T12:00:00.000Z')
  ok('on → off drops the stamp', back.photoInSince === null && back.photoIn === false, back)
  ok('resolve keeps a stamp only with its switch', resolveClockPolicy({ photoIn: false, photoInSince: '2026-01-01T00:00:00Z' }).photoInSince === null && resolveClockPolicy({ photoIn: true, photoInSince: '2026-01-01T00:00:00Z' }).photoInSince === '2026-01-01T00:00:00.000Z')
  ok('resolve drops a garbage stamp', resolveClockPolicy({ photoIn: true, photoInSince: 'yesterday' }).photoInSince === null)
}

// ── An open shift gets an hour before "never on site" (ship-check P1) ─────
{
  const drivingIn = entry({ inAt: plus(new Date(NOW).toISOString(), -4), outAt: null })
  drivingIn.gps = cleanGps(drivingIn, { fixes: 8, onSite: 0, firstOnSite: null, lastOnSite: null, inDistM: 6_000, lastFix: new Date(NOW).toISOString() })
  const r1 = rows(build([drivingIn]))[0]
  ok('4 min into a shift, driving in: not "never on site", not "mostly off-site"', !r1.flags.includes('never_on_site') && !r1.flags.includes('off_site'), r1.findings)
  ok('… the tap itself 3.7 mi away is still noted', r1.flags.includes('in_away'))
  const twoHours = entry({ inAt: plus(new Date(NOW).toISOString(), -120), outAt: null })
  twoHours.gps = cleanGps(twoHours, { fixes: 200, onSite: 0, firstOnSite: null, lastOnSite: null, inDistM: 6_000 })
  ok('two hours in with no on-site fix: never on site', rows(build([twoHours]))[0].flags.includes('never_on_site'))
  const yardOpen = entry({ inAt: plus(new Date(NOW).toISOString(), -120), outAt: null })
  yardOpen.gps = cleanGps(yardOpen, { fixes: 200, onSite: 0, firstOnSite: null, lastOnSite: null, inDistM: 6_000, inAtYard: true })
  ok('an open yard start says nothing yet', rows(build([yardOpen]))[0].review === false, rows(build([yardOpen]))[0].findings)
  const yardClosed = entry({}); yardClosed.gps = cleanGps(yardClosed, { fixes: 200, onSite: 0, firstOnSite: null, lastOnSite: null, inDistM: 6_000, inAtYard: true })
  ok('a closed yard-start shift that never reached the site is called', rows(build([yardClosed]))[0].flags.includes('never_on_site'))
}

// ── A shop day stands still on purpose (ship-check P2) ────────────────────
{
  const shop = entry({ category: 'shop', zoneId: null, zoneName: null, inAt: at('07:00'), outAt: at('16:00') })
  shop.gps = { fixes: 1000, onSite: 0, firstFix: shop.inAt, lastFix: shop.outAt, spreadM: 22, inDistM: null, outDistM: null, inAtYard: false, outAtYard: false }
  ok('shop day: no "phone never moved"', !rows(build([shop]))[0].flags.includes('phone_still') && rows(build([shop]))[0].review === false, rows(build([shop]))[0].findings)
}

// ── Minutes read as hours past sixty ──────────────────────────────────────
{
  ok('fmtMinutes', fmtMinutes(45) === '45 min' && fmtMinutes(60) === '1 h' && fmtMinutes(2490) === '41 h 30 min', [fmtMinutes(45), fmtMinutes(60), fmtMinutes(2490)])
  const e = entry({ inAt: at('06:00'), outAt: at('15:00') })
  e.gps = cleanGps(e, { lastOnSite: at('12:30'), lastFix: e.outAt, outDistM: 5_000 })
  ok('left 2 h 30 min before clocking out', rows(build([e]))[0].findings.includes('Left the site 2 h 30 min before clocking out'), rows(build([e]))[0].findings)
}

// ── Above the viewer: hours only ──────────────────────────────────────────
{
  const boss = entry({ userId: 'owner', personName: 'Owner', aboveViewer: true, inAt: at('06:00'), outAt: at('15:00') })
  boss.gps = { fixes: 0, onSite: 0, firstFix: null, lastFix: null }
  const r = rows(build([boss]))[0]
  ok('no reads for a person above the viewer', r.review === false && r.findings.length === 0 && !r.flags.includes('no_gps'), r.flags)
  const bossLong = entry({ userId: 'owner', personName: 'Owner', aboveViewer: true, inAt: at('05:00'), outAt: at('20:00'), deviceId: 'd-x' })
  const peer = entry({ userId: 'u2', personName: 'Crew Two', deviceId: 'd-x' }); peer.gps = cleanGps(peer)
  const rs = rows(build([bossLong, peer]))
  ok('… a long shift still reads as a state, never as a doubt', rs.find((x) => x.userId === 'owner').flags.join(',') === 'long' && rs.find((x) => x.userId === 'owner').review === false)
  ok('… and the peer still hears about the shared phone', rs.find((x) => x.userId === 'u2').flags.includes('shared_device'))
}

// ── A pre-120 database (the 103 shape) still works ────────────────────────
{
  const e = entry({}); e.gps = { fixes: 20, onSite: 4, firstFix: e.inAt, lastFix: e.outAt }
  const [r] = rows(build([e]))
  ok('old shape: mostly off-site at 20%', r.flags.includes('off_site') && r.findings.includes("Only 20% of the shift's fixes on Maple Ridge"), r.findings)
  ok('old shape: none of the 120 flags', !['in_away', 'out_away', 'arrived_late', 'left_early', 'phone_still'].some((f) => r.flags.includes(f)))
  const nul = entry({}); nul.gps = null
  ok('no GPS numbers at all: no flags, no crash', rows(build([nul]))[0].review === false)
}

// ── The list, the summary, the CSV ────────────────────────────────────────
{
  const ghost = entry({ userId: 'u1', inAt: at('06:11'), outAt: at('13:22') }); ghost.gps = cleanGps(ghost, { fixes: 200, onSite: 0, firstOnSite: null, lastOnSite: null, inDistM: 12_070, outDistM: 12_070 })
  const dark = entry({ userId: 'u2', personName: 'Crew Two', inAt: at('05:17', '2026-09-22'), outAt: at('19:15', '2026-09-22') }); dark.gps = { fixes: 0, onSite: 0, firstFix: null, lastFix: null }
  const late = entry({ userId: 'u3', personName: 'Crew Three', inAt: at('05:20', '2026-09-23'), outAt: at('15:00', '2026-09-23') }); late.gps = cleanGps(late, { inDistM: 250, firstFix: late.inAt, firstOnSite: at('05:39', '2026-09-23') })
  const clean = entry({ userId: 'u4', personName: 'Crew Four' }); clean.gps = cleanGps(clean)
  const cards = build([clean, late, ghost, dark])
  const list = reviewItems(cards)
  ok('list: three entries, worst first', list.map((x) => x.worst).join(',') === 'never_on_site,no_gps,arrived_late', list.map((x) => x.worst))
  ok('list: the clean entry is not on it', !list.some((x) => x.row.userId === 'u4'))
  ok('a tap 250 m out reads "arrived late" but not "away"', list[2].row.flags.includes('arrived_late') && !list[2].row.flags.includes('in_away'))
  ok('summary: flagged counts entries, not flags', summarizeCards(cards).flagged === 3 && cards.find((c) => c.userId === 'u1').flags.never_on_site === 1)
  const csv = timeCardsCsv(cards, TZ)
  const head = csv.split('\r\n')[0]
  ok('csv: Findings column after Flags', head.includes('Flags,Findings,Edited by'), head)
  ok('csv: the sentence rides along', csv.includes('Never on Maple Ridge: 200 phone fixes during the shift, none inside the site; Clocked in 7.5 mi from Maple Ridge'), csv.split('\r\n')[1])
  const evil = entry({ userId: 'u9', personName: '=HYPERLINK("x")' }); evil.gps = cleanGps(evil)
  ok('csv: a formula-shaped name is still defused', timeCardsCsv(build([evil]), TZ).includes(`"'=HYPERLINK(""x"")"`))
  ok('every flag has a label', Object.keys(FLAG_LABEL).length === 14 && INTEGRITY_FLAGS.every((f) => FLAG_LABEL[f]))
}

// ── Clock policy: the stored blob ─────────────────────────────────────────
{
  ok('garbage → defaults', JSON.stringify(resolveClockPolicy(null)) === JSON.stringify(CLOCK_POLICY_DEFAULTS) && JSON.stringify(resolveClockPolicy('x')) === JSON.stringify(CLOCK_POLICY_DEFAULTS) && JSON.stringify(resolveClockPolicy([1])) === JSON.stringify(CLOCK_POLICY_DEFAULTS))
  ok('defaults are all off, 150 m', !CLOCK_POLICY_DEFAULTS.photoIn && !CLOCK_POLICY_DEFAULTS.photoOut && !CLOCK_POLICY_DEFAULTS.atSite && CLOCK_POLICY_DEFAULTS.siteRadiusM === 150)
  const p = resolveClockPolicy({ photoIn: true, atSite: 'yes', siteRadiusM: '9000', junk: 1 })
  ok('booleans only, radius clamped high, unknown keys dropped', p.photoIn === true && p.atSite === false && p.siteRadiusM === 2000 && !('junk' in p), p)
  ok('radius clamped low', resolveClockPolicy({ siteRadiusM: 5 }).siteRadiusM === 50)
  ok('a stored policy round-trips', JSON.stringify(resolveClockPolicy({ photoIn: true, photoOut: true, atSite: true, siteRadiusM: 300, photoInSince: '2026-09-23T12:00:00.000Z', photoOutSince: '2026-09-23T12:00:00.000Z' })) === JSON.stringify({ photoIn: true, photoOut: true, atSite: true, siteRadiusM: 300, photoInSince: '2026-09-23T12:00:00.000Z', photoOutSince: '2026-09-23T12:00:00.000Z' }))
}

// ── Clock policy: geometry ────────────────────────────────────────────────
// A 100 m square near Greenville, SC.
const LAT = 34.85, LNG = -82.39
const dLat = 100 / 111_320, dLng = 100 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const square = [[LNG, LAT], [LNG + dLng, LAT], [LNG + dLng, LAT + dLat], [LNG, LAT + dLat], [LNG, LAT]]
{
  const inside = [LNG + dLng / 2, LAT + dLat / 2]
  ok('inside the ring', pointInRing(inside, square) && distanceToRingM(inside, square) === 0)
  const east50 = [LNG + dLng * 1.5, LAT + dLat / 2]
  ok('50 m east of the east edge', near(distanceToRingM(east50, square), 50, 2), distanceToRingM(east50, square))
  const corner = [LNG + dLng * 1.5, LAT + dLat * 1.5]
  ok('diagonal off the corner ≈ 70.7 m', near(distanceToRingM(corner, square), 70.7, 2), distanceToRingM(corner, square))
  ok('a degenerate ring is infinitely far', distanceToRingM(inside, [[0, 0], [1, 1]]) === Infinity)
  ok('feet under a quarter mile, miles above', fmtDistanceM(12) === '40 ft' && fmtDistanceM(300) === '980 ft' && fmtDistanceM(1609) === '1.0 mi' && fmtDistanceM(20_000) === '12 mi', [fmtDistanceM(12), fmtDistanceM(300), fmtDistanceM(1609), fmtDistanceM(20_000)])
}

// ── Clock policy: the rule ────────────────────────────────────────────────
{
  const site = { name: 'Maple Ridge', ring: square }
  const on = { atSite: true, siteRadiusM: 150, photoIn: false, photoOut: false }
  const off = { ...on, atSite: false }
  const fixAt = (mEast) => ({ lat: LAT + dLat / 2, lng: LNG + dLng + (mEast / 100) * dLng })
  ok('policy off: not required', clockInPlaceCheck(off, fixAt(5_000), site).ok === true && clockInPlaceCheck(off, fixAt(5_000), site).where === 'not_required')
  ok('no site (shop clock-in): not required', clockInPlaceCheck(on, fixAt(5_000), null).ok === true)
  ok('inside: at the site', clockInPlaceCheck(on, { lat: LAT + dLat / 2, lng: LNG + dLng / 2 }, site).where === 'site')
  ok('120 m out, radius 150: at the site', clockInPlaceCheck(on, fixAt(120), site).ok === true && clockInPlaceCheck(on, fixAt(120), site).where === 'site')
  const far = clockInPlaceCheck(on, fixAt(300), site)
  ok('300 m out, radius 150: refused with the distance', far.ok === false && far.distanceM === 300 && far.reason === "You're 980 ft from Maple Ridge — clock in when you get there.", far)
  const yard = square.map(([x, y]) => [x + dLng * 30, y]) // a yard 3 km east
  const atYard = clockInPlaceCheck(on, { lat: LAT + dLat / 2, lng: LNG + dLng * 30.5 }, site, [yard])
  ok('inside a yard: allowed, says yard', atYard.ok === true && atYard.where === 'yard')
  const farWithYard = clockInPlaceCheck(on, fixAt(5_000), site, [yard])
  ok('refusal mentions the yard when one exists', farWithYard.ok === false && farWithYard.reason.endsWith(', or from the yard.'), farWithYard.reason)
  const noRing = clockInPlaceCheck(on, fixAt(10), { name: 'Sketch', ring: [] })
  ok('a site without an outline refuses honestly', noRing.ok === false && noRing.distanceM === -1 && noRing.reason.includes('has no outline'), noRing)
}

console.log(`timecards-test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
