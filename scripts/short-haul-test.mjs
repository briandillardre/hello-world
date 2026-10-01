/**
 * DOT short-haul time records, asserted (run: node scripts/short-haul-test.mjs).
 *
 * lib/short-haul.ts decides, per commercial driver per day, whether the day
 * met the federal short-haul exception (49 CFR 395.1(e)) or needs a log, and
 * counts log days toward the 8-in-30 ELD line. These are compliance records
 * a carrier shows an auditor, so the edges are asserted both ways: exactly
 * 150 air-miles is inside, exactly 14 hours is inside, a forgotten clock-out
 * is not a long day, a missing GPS is "can't verify", never a violation.
 * Run after ANY change to lib/short-haul.ts.
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
const tcUrl = transpile('../lib/timecards.ts', { './dates': datesUrl, './clock-policy': policyUrl })
const sh = await import(transpile('../lib/short-haul.ts', { './dates': datesUrl, './timecards': tcUrl }))
const { buildShortHaul, reportingPoints, shortHaulCsv, eldWords, metresBetween, AIR_MILE_M, LOG_ISSUES } = sh

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => a != null && Math.abs(a - b) <= eps

// ── Fixtures ──────────────────────────────────────────────────────────────
const TZ = 'America/New_York'
const YARD = { lat: 34.8526, lng: -82.394 } // Greenville
const iso = (day, hhmm) => new Date(`${day}T${hhmm}:00-04:00`).toISOString()
let seq = 0
/** A shift: day key, clock-in, clock-out (null = open), reach in air-miles. */
function shift(userId, day, inHm, outHm, o = {}) {
  const outDay = o.outDay ?? day
  return {
    id: `e${++seq}`, userId, personName: o.name ?? (userId === 'cdl1' ? 'Dump Driver' : userId === 'cmv1' ? 'Crew Lead' : 'Laborer'),
    inAt: iso(day, inHm), outAt: outHm ? iso(outDay, outHm) : null, breakMinutes: o.breakMin ?? 0,
    inLat: o.noIn ? null : (o.inLat ?? YARD.lat), inLng: o.noIn ? null : (o.inLng ?? YARD.lng),
    outLat: outHm ? (o.outLat ?? YARD.lat) : null, outLng: outHm ? (o.outLng ?? YARD.lng) : null,
    reachM: o.reachMi === undefined ? 30 * AIR_MILE_M : o.reachMi == null ? null : o.reachMi * AIR_MILE_M,
    fixes: o.fixes ?? 120,
  }
}
const CLASSES = { cdl1: 'cdl', cmv1: 'cmv' }
const NOW = Date.parse('2026-10-01T20:00:00-04:00')
const build = (shifts, o = {}) => buildShortHaul(shifts, o.classes ?? CLASSES, {
  tz: TZ, fromKey: o.fromKey ?? '2026-09-02', toKey: o.toKey ?? '2026-10-01', nowMs: o.nowMs ?? NOW, gpsHidden: o.gpsHidden,
})
const dayOf = (records, userId, key) => records.find((r) => r.userId === userId)?.days.find((d) => d.dayKey === key)

// ── A clean CDL day ─────────────────────────────────────────────────────────
{
  const r = build([shift('cdl1', '2026-09-21', '06:00', '16:00', { breakMin: 30, reachMi: 40 })])
  const d = dayOf(r, 'cdl1', '2026-09-21')
  ok('clean day: present', !!d, r)
  ok('clean day: no issues', d && d.issues.length === 0, d)
  ok('clean day: not a log day', d && !d.logNeeded)
  ok('clean day: on duty = clocked hours minus the unpaid break', near(d?.onDutyH, 9.5, 0.01), d?.onDutyH)
  ok('clean day: span 10 h', near(d?.spanH, 10, 0.01), d?.spanH)
  ok('clean day: farthest 40 air-mi', near(d?.reachAirMi, 40, 0.05), d?.reachAirMi)
  ok('clean day: released at the start', near(d?.releaseAirMi, 0, 0.05), d?.releaseAirMi)
  ok('clean day: ELD fine', r[0].eld === 'ok' && r[0].logDays30 === 0)
}

// ── 150 air-miles ───────────────────────────────────────────────────────────
{
  const r = build([
    shift('cdl1', '2026-09-21', '06:00', '16:00', { reachMi: 150 }),
    shift('cdl1', '2026-09-22', '06:00', '16:00', { reachMi: 150.4 }),
  ])
  ok('exactly 150 air-miles is inside the radius', !dayOf(r, 'cdl1', '2026-09-21').issues.includes('radius'))
  const d = dayOf(r, 'cdl1', '2026-09-22')
  ok('150.4 air-miles is outside', d.issues.includes('radius') && d.logNeeded, d)
  ok('…says how far', d.notes[0] === 'Went 150.4 air-miles from where the day started — past the 150-mile short-haul radius.', d.notes)
  // Greenville → Charleston is ~175 statute miles by road but the rule is AIR
  // miles from the reporting point: 1 air-mile = 1,852 m.
  ok('an air-mile is a nautical mile', AIR_MILE_M === 1852)
  const chs = metresBetween(YARD, { lat: 32.7765, lng: -79.9311 }) / AIR_MILE_M
  ok('Greenville → Charleston ≈ 174 air-miles: outside the radius from a Greenville yard', near(chs, 174, 3), chs)
}

// ── Back at the reporting location ──────────────────────────────────────────
{
  const r = build([
    shift('cdl1', '2026-09-21', '06:00', '16:00', { outLat: YARD.lat + 0.005 }), // ~550 m
    shift('cdl1', '2026-09-22', '06:00', '16:00', { outLat: YARD.lat + 0.25 }), // ~28 km
  ])
  ok('released ~550 m from the start = back', !dayOf(r, 'cdl1', '2026-09-21').issues.includes('not_back'))
  const d = dayOf(r, 'cdl1', '2026-09-22')
  ok('released ~15 air-mi away = not back, log needed', d.issues.includes('not_back') && d.logNeeded, d)
  ok('…words the distance', /Released 15 air-mi from where the day started/.test(d.notes.join(' ')), d.notes)
}

// ── CDL: 14 hours, 10 hours off ─────────────────────────────────────────────
{
  const r = build([
    shift('cdl1', '2026-09-21', '05:00', '19:00'),            // exactly 14 h
    shift('cdl1', '2026-09-23', '05:00', '19:30'),            // 14.5 h
    shift('cdl1', '2026-09-24', '05:30', '15:00'),            // 10 h after 19:30 — OK
    shift('cdl1', '2026-09-25', '05:00', '14:00', { outDay: '2026-09-25' }), // 14 h after 15:00 — OK
    shift('cdl1', '2026-09-25', '15:00', '22:00'),             // same day, second shift → released 22:00
    shift('cdl1', '2026-09-26', '06:00', '12:00'),            // only 8 h off after 22:00
  ])
  ok('exactly 14 h = inside', !dayOf(r, 'cdl1', '2026-09-21').issues.includes('release_14'))
  const long = dayOf(r, 'cdl1', '2026-09-23')
  ok('14.5 h = past 14, log needed', long.issues.includes('release_14') && long.logNeeded, long)
  ok('…sentence', /Released 14\.5 h after coming on duty/.test(long.notes.join(' ')), long.notes)
  ok('exactly 10 h off = enough', !dayOf(r, 'cdl1', '2026-09-24').issues.includes('rest_10'), dayOf(r, 'cdl1', '2026-09-24'))
  const two = dayOf(r, 'cdl1', '2026-09-25')
  ok('two shifts in a day: start = first clock-in', two.startAt === iso('2026-09-25', '05:00'))
  ok('…release = last clock-out', two.releaseAt === iso('2026-09-25', '22:00'))
  ok('…span covers the gap (17 h) → past 14', near(two.spanH, 17, 0.01) && two.issues.includes('release_14'), two)
  ok('…on duty = the two shifts only (16 h)', near(two.onDutyH, 16, 0.01), two.onDutyH)
  ok('…2 shifts', two.shifts === 2)
  const rest = dayOf(r, 'cdl1', '2026-09-26')
  ok('8 h off before a CDL shift = under 10, log needed', rest.issues.includes('rest_10') && rest.logNeeded, rest)
  ok('…rest hours reported', near(rest.restH, 8, 0.05), rest.restH)
}

// ── Non-CDL: 2 long days in any 7, never past 16 ────────────────────────────
{
  const r = build([
    shift('cmv1', '2026-09-21', '05:00', '20:00'), // 15 h — long day 1
    shift('cmv1', '2026-09-22', '06:00', '14:00'),
    shift('cmv1', '2026-09-23', '05:00', '20:00'), // long day 2
    shift('cmv1', '2026-09-24', '05:00', '20:00'), // long day 3 in 7 → log
    shift('cmv1', '2026-09-26', '04:00', '20:30'), // 16.5 h → log
    shift('cmv1', '2026-09-29', '05:00', '20:00'), // window 23–29 holds 23, 24 (26 is > 16, also long) → log
    shift('cmv1', '2026-10-01', '06:00', '07:00', { reachMi: 2 }),
  ])
  ok('non-CDL long day 1 is fine', !dayOf(r, 'cmv1', '2026-09-21').logNeeded, dayOf(r, 'cmv1', '2026-09-21'))
  ok('non-CDL long day 2 is fine', !dayOf(r, 'cmv1', '2026-09-23').logNeeded, dayOf(r, 'cmv1', '2026-09-23'))
  const third = dayOf(r, 'cmv1', '2026-09-24')
  ok('third day past 14 h in 7 = log needed', third.issues.includes('long_days') && third.logNeeded, third)
  ok('…says which day', /Day 3 past 14 hours in 7 days/.test(third.notes.join(' ')), third.notes)
  const over = dayOf(r, 'cmv1', '2026-09-26')
  ok('past 16 h = log needed', over.issues.includes('over_16') && over.logNeeded, over)
  ok('non-CDL: no 10-hour rest check', !r[0].days.some((d) => d.issues.includes('rest_10')))
  ok('non-CDL: no 14-hour release check', !r[0].days.some((d) => d.issues.includes('release_14')))
  const late = dayOf(r, 'cmv1', '2026-09-29')
  ok('a later long day with 3 long days in its 7 = log needed', late.issues.includes('long_days'), late)
  ok('log days counted for the 30', r[0].logDays30 === 3, r[0].logDays30)
}

// ── Can't verify ≠ violation ────────────────────────────────────────────────
{
  const r = build([
    shift('cdl1', '2026-09-21', '06:00', '16:00', { noIn: true }),
    shift('cdl1', '2026-09-22', '06:00', '16:00', { reachMi: null, fixes: 0 }),
  ])
  const a = dayOf(r, 'cdl1', '2026-09-21')
  ok('no clock-in location: says so', a.issues.includes('no_start') && !a.logNeeded, a)
  ok('…radius and return unknown', a.reachAirMi == null && a.releaseAirMi == null)
  const b = dayOf(r, 'cdl1', '2026-09-22')
  ok('no phone GPS: says so, not a log day', b.issues.includes('no_fixes') && !b.logNeeded, b)
  ok('can’t-verify issues are not log issues', !LOG_ISSUES.includes('no_start') && !LOG_ISSUES.includes('no_fixes'))
}

// ── Still on duty ───────────────────────────────────────────────────────────
{
  const now = Date.parse('2026-10-01T21:00:00-04:00')
  const r = build([
    shift('cdl1', '2026-10-01', '06:00', null),
    shift('cmv1', '2026-09-30', '08:00', null), // forgotten clock-out, 37 h ago
    shift('cmv1', '2026-10-01', '06:00', '15:00'),
  ], { nowMs: now })
  const open = dayOf(r, 'cdl1', '2026-10-01')
  ok('open day: no release yet', open.open && open.releaseAt == null)
  ok('open day: span runs to now (15 h) → past 14 already', near(open.spanH, 15, 0.01) && open.issues.includes('release_14') && open.logNeeded, open)
  ok('open day: no extra "still clocked in" issue — the verdict says on duty', !open.issues.includes('no_release'), open.issues)
  const stale = dayOf(r, 'cmv1', '2026-09-30')
  ok('forgotten clock-out: says fix the time card', stale.issues.includes('no_release') && /fix the time card/.test(stale.notes.join(' ')), stale.notes)
  ok('forgotten clock-out: no 14/16-hour verdict', !stale.issues.includes('over_16') && !stale.issues.includes('long_days') && !stale.logNeeded, stale)
  ok('next day after an open day: no rest verdict', dayOf(r, 'cmv1', '2026-10-01').restH == null)
}

// ── 7-day totals and the 8-in-30 ELD line ───────────────────────────────────
{
  const days = []
  for (let i = 0; i < 12; i++) {
    const day = new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10)
    // 9 days over the radius from Sep 21 on.
    days.push(shift('cdl1', day, '07:00', '15:00', { breakMin: 30, reachMi: i >= 3 ? 170 : 20 }))
  }
  const r = build(days, { fromKey: '2026-09-22' })
  const rec = r[0]
  ok('window: days before fromKey are not listed', rec.days.every((d) => d.dayKey >= '2026-09-22'), rec.days.map((d) => d.dayKey))
  ok('…but count toward the 30-day line (Sep 21 is a log day)', rec.logDays30 === 9, rec.logDays30)
  ok('9 log days in 30 = ELD needed', rec.eld === 'needed', rec.eld)
  ok('ELD words say so', /needs an ELD/.test(eldWords(rec)), eldWords(rec))
  const d = dayOf(r, 'cdl1', '2026-09-25')
  ok('prior 7 days = the 7 days before (7 × 7.5 h)', near(d.prior7H, 52.5, 0.01), d.prior7H)
  const first = dayOf(r, 'cdl1', '2026-09-22')
  ok('prior 7 days at the window start counts days before it (4 × 7.5 h)', near(first.prior7H, 30, 0.01), first.prior7H)
  ok('newest first', rec.days[0].dayKey > rec.days[rec.days.length - 1].dayKey)
  const six = buildShortHaul(days.slice(0, 9), CLASSES, { tz: TZ, fromKey: '2026-09-18', toKey: '2026-10-01', nowMs: NOW })[0]
  ok('6 log days = warn', six.logDays30 === 6 && six.eld === 'warn', { n: six.logDays30, eld: six.eld })
  const old = buildShortHaul(days, CLASSES, { tz: TZ, fromKey: '2026-10-20', toKey: '2026-10-31', nowMs: Date.parse('2026-10-31T20:00:00-04:00') })
  ok('log days older than 30 do not count', old.length === 0 || old[0].logDays30 === 0, old)
}

// ── Who gets a record ───────────────────────────────────────────────────────
{
  const r = build([
    shift('cdl1', '2026-09-21', '06:00', '16:00'),
    shift('crew9', '2026-09-21', '06:00', '16:00'),
  ])
  ok('only commercial drivers get a record', r.length === 1 && r[0].userId === 'cdl1', r.map((x) => x.userId))
  ok('class carried', r[0].driverClass === 'cdl')
  const both = build([
    shift('cmv1', '2026-09-21', '06:00', '16:00', { name: 'Aaron' }),
    shift('cdl1', '2026-09-21', '06:00', '16:00', { name: 'Zed', reachMi: 200 }),
  ])
  ok('a driver with log days sorts first', both[0].userId === 'cdl1' && both[1].userId === 'cmv1', both.map((x) => x.personName))
}

// ── A shift across midnight belongs to the day it started ───────────────────
{
  const r = build([shift('cdl1', '2026-09-21', '22:00', '07:00', { outDay: '2026-09-22' })])
  const d = dayOf(r, 'cdl1', '2026-09-21')
  ok('overnight shift: the start day', !!d && near(d.spanH, 9, 0.01), d)
  ok('…no record on the next day', !dayOf(r, 'cdl1', '2026-09-22'))
}

// ── GPS above the viewer ────────────────────────────────────────────────────
{
  const r = build([shift('cdl1', '2026-09-21', '06:00', '16:00', { reachMi: 400 })], { gpsHidden: new Set(['cdl1']) })
  const d = dayOf(r, 'cdl1', '2026-09-21')
  ok('hidden GPS: no radius verdict', !d.issues.includes('radius') && d.reachAirMi == null, d)
  ok('…says hours only', d.issues.includes('gps_hidden'))
}

// ── Reporting points ────────────────────────────────────────────────────────
{
  const a = shift('cdl1', '2026-09-21', '06:00', '10:00', { inLat: 34.8, inLng: -82.4 })
  const b = shift('cdl1', '2026-09-21', '11:00', '16:00', { inLat: 35.1, inLng: -82.0 })
  const c = shift('cdl1', '2026-09-22', '06:00', '16:00', { inLat: 34.9, inLng: -82.3 })
  const d = shift('cdl1', '2026-09-23', '06:00', '16:00', { noIn: true })
  const pts = reportingPoints([b, c, a, d], TZ)
  ok('every shift of a day is measured from its first clock-in', pts.get(a.id)?.lat === 34.8 && pts.get(b.id)?.lat === 34.8, Object.fromEntries(pts))
  ok('the next day has its own point', pts.get(c.id)?.lat === 34.9)
  ok('a day without a clock-in location has none', pts.get(d.id) === null)
}

// ── The CSV an auditor reads ────────────────────────────────────────────────
{
  const r = build([
    shift('cdl1', '2026-09-21', '06:00', '16:00', { name: 'Smith, J.' }),
    shift('cdl1', '2026-09-22', '06:00', '16:00', { name: 'Smith, J.', reachMi: 180 }),
  ])
  const csv = shortHaulCsv(r, TZ)
  const lines = csv.trim().split('\n')
  ok('csv: header + one row per day', lines.length === 3, lines.length)
  ok('csv: header names the record fields', lines[0].startsWith('Driver,Driver type,Date,Reported for duty,Released,Hours on duty'), lines[0])
  ok('csv: a name with a comma is quoted', lines[1].startsWith('"Smith, J.",CDL driver,2026-09-21,6:00'), lines[1])
  ok('csv: oldest day first', lines[1].includes('2026-09-21') && lines[2].includes('2026-09-22'))
  ok('csv: verdicts', lines[1].includes(',Met,') && lines[2].includes(',Log needed,'), lines)
}

console.log(`short-haul: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
