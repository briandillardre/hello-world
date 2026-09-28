/**
 * Ask AI's time windows and fuel-gauge math, asserted
 * (run: node scripts/ask-activity-test.mjs).
 *
 * lib/ask-activity.ts turns "from Friday morning until now" into a window in
 * the company's zone, bounds it, and says it back in words; lib/asset-stats.ts
 * reads fuel used off the truck's own gauge. A wrong window answers a
 * different question than the one asked; a wrong gauge read is a crew lead
 * quoting gallons that never went through the truck. The long gauge case is
 * the Charleston RAM 2500's Fri Sep 25 → Mon Sep 28 (levels and drive times
 * from the live data, slosh re-made with a seeded generator). Run it after ANY
 * change to either file.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Run the TS through the same transpile Next uses, so the test exercises the
// shipped source rather than a hand-kept copy.
const require = createRequire(import.meta.url)
const ts = require('typescript')
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
function transpile(rel, deps = {}) {
  let src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [spec, url] of Object.entries(deps)) src = src.replaceAll(`from '${spec}'`, `from '${url}'`)
  return dataUrl(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText)
}
const datesUrl = transpile('../lib/dates.ts')
const statsUrl = transpile('../lib/asset-stats.ts')
const stats = await import(statsUrl)
const ask = await import(transpile('../lib/ask-activity.ts', { './dates': datesUrl, './asset-stats': statsUrl }))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`)
}
const near = (a, b, eps) => Math.abs(a - b) <= eps
const NY = 'America/New_York'
const t = (s) => Date.parse(s)
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString())
const HOUR = 3_600_000
const DAY = 24 * HOUR

// ── Phrase → window ─────────────────────────────────────────────────────────
const SUN = t('2026-09-27T14:00:00-04:00')      // Sunday 2 PM, Eastern daylight time
const FRI_PM = t('2026-09-25T15:30:00-04:00')   // Friday 3:30 PM
const FRI_EARLY = t('2026-09-25T05:00:00-04:00') // Friday 5 AM — before "morning"
const MON = t('2026-09-28T10:00:00-04:00')
const Q1 = 'How many miles from Friday morning until now did the ram 2500 drive'
const w = (q, now, tz = NY) => ask.resolveWindowPhrase(q, now, tz)
const is = (name, got, fromIso, toIso) =>
  ok(name, got && iso(got.from) === iso(t(fromIso)) && iso(got.to) === iso(t(toIso)), got ? { from: iso(got.from), to: iso(got.to), match: got.match } : null)

is('Friday morning → now, asked on a Sunday', w(Q1, SUN), '2026-09-25T06:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('Friday morning, asked Friday afternoon = today 6 AM', w(Q1, FRI_PM), '2026-09-25T06:00:00-04:00', '2026-09-25T15:30:00-04:00')
is('Friday morning, asked Friday 5 AM = last Friday', w('since friday morning', FRI_EARLY), '2026-09-18T06:00:00-04:00', '2026-09-25T05:00:00-04:00')
ok('the matched words are the window words', w(Q1, SUN)?.match === 'from friday morning until now', w(Q1, SUN)?.match)
is('since Friday = Friday 12:00 AM', w('since friday', SUN), '2026-09-25T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('since Monday, asked Sunday', w('miles since Monday?', SUN), '2026-09-21T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('since Monday, asked Monday = today', w('since monday', MON), '2026-09-28T00:00:00-04:00', '2026-09-28T10:00:00-04:00')
is('this week = Monday → now', w('fuel this week', SUN), '2026-09-21T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('this week on a Monday', w('this week', MON), '2026-09-28T00:00:00-04:00', '2026-09-28T10:00:00-04:00')
is('last week = the Monday–Sunday before', w('How far did it go last week', SUN), '2026-09-14T00:00:00-04:00', '2026-09-21T00:00:00-04:00')
is('since last week runs to now', w('since last week', SUN), '2026-09-14T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('in the last week = 7 days', w('in the last week', SUN), '2026-09-20T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('since yesterday', w('since yesterday', SUN), '2026-09-26T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('yesterday = the whole day', w('what did it do yesterday', SUN), '2026-09-26T00:00:00-04:00', '2026-09-27T00:00:00-04:00')
is('last 3 days = 12 AM three days ago (the panel\'s convention)', w('last 3 days', SUN), '2026-09-24T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('last two days, in words', w('over the last two days', SUN), '2026-09-25T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('past 6 hours', w('in the past 6 hours', SUN), '2026-09-27T08:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('this morning = 6 AM → noon', w('this morning', SUN), '2026-09-27T06:00:00-04:00', '2026-09-27T12:00:00-04:00')
is('since this morning runs to now', w('since this morning', SUN), '2026-09-27T06:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('bare Friday = that whole day', w('miles friday', SUN), '2026-09-25T00:00:00-04:00', '2026-09-26T00:00:00-04:00')
is('Friday afternoon = noon → 5 PM', w('friday afternoon', SUN), '2026-09-25T12:00:00-04:00', '2026-09-25T17:00:00-04:00')
is('since Friday at 7:30 am', w('since friday at 7:30 am', SUN), '2026-09-25T07:30:00-04:00', '2026-09-27T14:00:00-04:00')
is('since 6am = today', w('since 6am', SUN), '2026-09-27T06:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('since 6 p.m. (still ahead today) = yesterday', w('since 6 p.m.', SUN), '2026-09-26T18:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('between Friday and Sunday = through Sunday', w('between friday and sunday', MON), '2026-09-25T00:00:00-04:00', '2026-09-28T00:00:00-04:00')
is('Monday to Friday, asked midweek, runs to now', w('from monday to friday', t('2026-09-23T12:00:00-04:00')), '2026-09-21T00:00:00-04:00', '2026-09-23T12:00:00-04:00')
is('last night = 5 PM → 6 AM', w('did it move last night', SUN), '2026-09-26T17:00:00-04:00', '2026-09-27T06:00:00-04:00')
is('until Saturday morning = until it begins', w('from friday morning until saturday morning', SUN), '2026-09-25T06:00:00-04:00', '2026-09-26T06:00:00-04:00')
is('since 9/20', w('since 9/20', SUN), '2026-09-20T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('since Sep 20th', w('since Sep 20th', SUN), '2026-09-20T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('this month', w('this month', SUN), '2026-09-01T00:00:00-04:00', '2026-09-27T14:00:00-04:00')
is('last month', w('last month', SUN), '2026-08-01T00:00:00-04:00', '2026-09-01T00:00:00-04:00')
is('over the weekend, asked Monday', w('over the weekend', MON), '2026-09-26T00:00:00-04:00', '2026-09-28T00:00:00-04:00')
ok('no window: where is', w('where is the ram', SUN) === null)
ok('"sat" the verb is not Saturday', w('how long has the truck sat at the yard', SUN) === null)
ok('"after sunrise" is not Sunday', w('did it leave after sunrise', SUN) === null)
ok('"1/2 tank" is not January 2', w('is it at 1/2 tank', SUN) === null)
ok('"since the truck parked" names no window', w('since the truck parked', SUN) === null)
ok('a window still ahead is none', w('tonight', SUN) === null)
// Clocks change on Sun Nov 1 2026 (2 AM EDT → 1 AM EST).
is('last week across the clock change', w('last week', t('2026-11-04T12:00:00-05:00')), '2026-10-26T00:00:00-04:00', '2026-11-02T00:00:00-05:00')
is('Sunday morning on the change day is 6 AM EST', w('since sunday morning', t('2026-11-02T10:00:00-05:00')), '2026-11-01T06:00:00-05:00', '2026-11-02T10:00:00-05:00')
is('another zone: Friday morning in Chicago', w(Q1, SUN, 'America/Chicago'), '2026-09-25T06:00:00-05:00', '2026-09-27T14:00:00-04:00')
// A week back across a clock change is a calendar week, never 7 × 24 h
// (ship-check, Sep 28: this read 7:00 AM in the fall and 5:00 AM in spring).
const FRI_NOV6_EARLY = t('2026-11-06T05:00:00-05:00')
is('since Friday morning, asked Friday 5 AM after fall-back', w('since friday morning', FRI_NOV6_EARLY), '2026-10-30T06:00:00-04:00', '2026-11-06T05:00:00-05:00')
is('Friday morning, asked Friday 5 AM after fall-back', w('friday morning', FRI_NOV6_EARLY), '2026-10-30T06:00:00-04:00', '2026-10-30T12:00:00-04:00')
is('since Friday morning, asked Friday 5 AM after spring-forward', w('since friday morning', t('2026-03-13T05:00:00-04:00')), '2026-03-06T06:00:00-05:00', '2026-03-13T05:00:00-04:00')

// A follow-up keeps the window the last question meant, read when it was
// asked (ship-check, Sep 28: "miles today" at 11:50 PM, then "how many
// gallons" at 12:05 AM answered for 12:00–12:05 AM).
{
  const asked = t('2026-09-28T23:50:00-04:00')
  const later = t('2026-09-29T00:05:00-04:00')
  const today = ask.priorIntent({ text: 'miles today on the ram 2500', atMs: asked }, later, NY)
  ok('follow-up after midnight: "today" is still the day it was asked, to now',
    today && iso(today.window.from) === iso(t('2026-09-28T00:00:00-04:00')) && iso(today.window.to) === iso(later), today?.window)
  const y = ask.priorIntent({ text: 'miles yesterday on the ram 2500', atMs: asked }, later, NY)
  ok('…"yesterday" stays that yesterday, closed', y && iso(y.window.from) === iso(t('2026-09-27T00:00:00-04:00')) && iso(y.window.to) === iso(t('2026-09-28T00:00:00-04:00')), y?.window)
  const two = ask.priorIntent({ text: 'miles in the last 2 hours', atMs: asked }, later, NY)
  ok('…"last 2 hours" keeps its start', two && iso(two.window.from) === iso(asked - 2 * HOUR) && iso(two.window.to) === iso(later), two?.window)
  ok('…no window stays no window', ask.priorIntent({ text: 'how many miles did the ram drive', atMs: asked }, later, NY)?.window === null)
}

// ── Tool input → one end of a window ────────────────────────────────────────
const pw = (v, end = 'start', tz = NY) => iso(ask.parseWhen(v, end, SUN, tz))
ok('ISO with an offset is exact', pw('2026-09-25T06:00:00-04:00') === '2026-09-25T10:00:00.000Z')
ok('ISO Z', pw('2026-09-25T10:00:00.000Z') === '2026-09-25T10:00:00.000Z')
ok('offset without a colon', pw('2026-09-25T06:00-0400') === '2026-09-25T10:00:00.000Z')
ok('local time is read in the company zone', pw('2026-09-25T06:00') === '2026-09-25T10:00:00.000Z')
ok('…in Chicago too', pw('2026-09-25T06:00', 'start', 'America/Chicago') === '2026-09-25T11:00:00.000Z')
ok('bare date as a start = that midnight', pw('2026-09-25') === '2026-09-25T04:00:00.000Z')
ok('bare date as an end = the end of that day', pw('2026-09-25', 'end') === '2026-09-26T04:00:00.000Z')
ok('"now"', pw('now', 'end') === iso(SUN))
ok('a phrase is read as a phrase', pw('friday morning') === '2026-09-25T10:00:00.000Z')
ok('garbage is null', pw('whenever') === null && pw('') === null && pw(42) === null)
ok('an impossible date is null', pw('2026-02-30') === null && pw('2026-09-25T25:00') === null)

// ── Clamp ───────────────────────────────────────────────────────────────────
const cw = (f, to, o = {}) => ask.clampWindow(f, to, { nowMs: SUN, tz: NY, ...o })
{
  const c = cw(SUN - 45 * DAY, SUN)
  ok('45 days → the last 31', c.from === SUN - 31 * DAY && c.to === SUN, c)
  ok('…and says so', /31 days/.test(c.notes?.[0] ?? ''), c.notes)
  const f = cw(SUN - HOUR, SUN + 5 * HOUR)
  ok('a future end stops at now', f.to === SUN && f.notes.length === 0, f)
  ok('a window not started yet is refused', /hasn't started/.test(cw(SUN + HOUR, SUN + 2 * HOUR).error ?? ''))
  ok('an end before the start is refused', !!cw(SUN - HOUR, SUN - 2 * HOUR).error)
  const e = cw(SUN - 3 * DAY, SUN, { earliestMs: SUN - DAY })
  ok('starts at the first report', e.from === SUN - DAY && /first report/.test(e.notes.join(' ')), e)
  const n = cw(SUN - 3 * DAY, SUN, { earliestMs: SUN - 3 * DAY + 5 * 60_000 })
  ok('five minutes short is not worth a sentence', n.from === SUN - 3 * DAY + 5 * 60_000 && n.notes.length === 0, n)
  ok('no reports inside the window', /No reports/.test(cw(SUN - 3 * DAY, SUN - 2 * DAY, { earliestMs: SUN - DAY }).error ?? ''))
  ok('named ranges keep their reach', cw(SUN - 200 * DAY, SUN, { maxDays: Infinity }).from === SUN - 200 * DAY)
}

// ── Window words + the clock ────────────────────────────────────────────────
const ww = (f, to, now = SUN) => ask.windowWords(t(f), t(to), now, NY)
ok('→ now', ww('2026-09-25T06:00:00-04:00', '2026-09-27T14:00:00-04:00') === 'Fri Sep 25 6:00 AM → now', ww('2026-09-25T06:00:00-04:00', '2026-09-27T14:00:00-04:00'))
ok('whole days', ww('2026-09-21T00:00:00-04:00', '2026-09-28T00:00:00-04:00', MON) === 'Mon Sep 21 – Sun Sep 27', ww('2026-09-21T00:00:00-04:00', '2026-09-28T00:00:00-04:00', MON))
ok('one whole day', ww('2026-09-26T00:00:00-04:00', '2026-09-27T00:00:00-04:00') === 'Sat Sep 26 (all day)')
ok('two instants', ww('2026-09-25T06:00:00-04:00', '2026-09-26T17:00:00-04:00') === 'Fri Sep 25 6:00 AM → Sat Sep 26 5:00 PM')
{
  const c = ask.askClock(SUN, NY)
  ok('clock names the day, the zone and the offset', c.includes('Sunday, Sep 27, 2026') && c.includes('America/New_York (UTC-04:00)'), c)
  ok('clock lists the week by name', c.includes('Fri Sep 25') && c.includes('Sun Sep 27 (today)') && c.includes('Mon Sep 21'), c)
  ok('half-hour zones', ask.askClock(SUN, 'Asia/Kolkata').includes('(UTC+05:30)'))
}

// ── Which activity question ─────────────────────────────────────────────────
{
  const i1 = ask.activityIntent(Q1, SUN, NY)
  ok('Q1 is a miles question with a window', i1?.focus === 'miles' && i1.window?.from === t('2026-09-25T06:00:00-04:00'), i1)
  ok('Q1 leaves the machine\'s words', i1?.rest.includes('ram 2500') && !/friday|miles|drive/.test(i1.rest), i1?.rest)
  const i2 = ask.activityIntent('How many gallons of diesel did it burn', SUN, NY)
  ok('the fuel follow-up is fuel, with no window of its own', i2?.focus === 'fuel' && i2.window === null && !/diesel|gallons/.test(i2.rest), i2)
  const f = (q) => ask.activityIntent(q, SUN, NY)?.focus ?? null
  ok('fuel left in the tank is the gauge now, not fuel used', f('How much fuel does the RAM have left') === null)
  ok('a gas-station stop is a stops question', f('Did the RAM stop at a gas station since Friday?') === null)
  ok('diesel used last week', f('How much diesel did the F350 use last week') === 'fuel')
  ok('top speed', f('What was the top speed of the F350 this week') === 'speed')
  ok('idling over a window', f('How long did the RAM idle today') === 'idle')
  ok('idling right now is not a window question', f('Is the RAM idling?') === null)
  ok('distance from a place is not miles driven', f('How far is the RAM from the yard') === null)
  ok('how far did it go', f('How far did the chevy go yesterday') === 'miles')
  ok('what did it do since Friday', f('What did the RAM do since Friday') === 'summary')
  ok('how many hours did it run', f('How many hours did the excavator run yesterday') === 'time')
  ok('crew hours are not machine hours', f('How many hours did the crew work this week') === null)
  ok('a fuel level at a time is not a summary', f('What was the fuel level yesterday') === null)
  ok('where is — not an activity question', f('Where is the ram 2500') === null)
  const before = ask.activityIntent(Q1, SUN, NY)
  const fo = ask.followOnIntent('And the F350?', before, SUN, NY)
  ok('"and the F350?" keeps the focus', fo?.focus === 'miles' && fo.window === null && fo.rest.includes('f350'), fo)
  const fy = ask.followOnIntent('what about yesterday', before, SUN, NY)
  ok('"what about yesterday" changes the window', fy?.window?.from === t('2026-09-26T00:00:00-04:00'), fy)
  ok('no follow-on without a question before it', ask.followOnIntent('and the F350?', null, SUN, NY) === null)
  ok('"the trucks" is the fleet — nothing to borrow', ask.asksWholeFleet('What did the trucks do today?') && !ask.asksWholeFleet('How many gallons of diesel did it burn'))
}

// ── Fuel off the gauge ──────────────────────────────────────────────────────
function rng(seed) { // mulberry32 — the same slosh every run
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
/** A stretch of driving: a reading every `step` s, the level sliding a → b.
 *  The slosh is shaped like the real gauge's — most readings within a couple
 *  of points, one in five thrown up to ±15 (less near empty) — and 0 now and
 *  then as the sender bottoms out. `harsh`: every reading a ±15 throw. */
function drive(out, rnd, from, to, a, b, { mph = 40, step = 5, zero = 0.03, harsh = false } = {}) {
  const t0 = t(from), t1 = t(to)
  for (let ms = t0; ms <= t1; ms += step * 1000) {
    const lvl = a + ((b - a) * (ms - t0)) / Math.max(1, t1 - t0)
    const amp = Math.min(15, 0.35 * lvl + 2)
    const slosh = harsh || rnd() < 0.2 ? (rnd() * 2 - 1) * amp : (rnd() + rnd() - 1) * Math.min(3, amp)
    let pct = Math.round(lvl + slosh)
    if (rnd() < zero) pct = 0
    out.push({ ms, pct: Math.max(0, Math.min(100, pct)), mph })
  }
  return out
}
{
  const r = rng(1)
  const a = drive([], r, '2026-09-21T08:00:00-04:00', '2026-09-21T11:00:00-04:00', 60, 40)
  const g = stats.fuelFromLevels(a, { movingOnly: true })
  ok('steady burn through the slosh', g && near(g.usedPct, 20, 2) && g.refuels.length === 0, g && { used: g.usedPct, fills: g.refuels.length })
  const h = stats.fuelFromLevels(drive([], r, '2026-09-21T08:00:00-04:00', '2026-09-21T11:00:00-04:00', 60, 40, { harsh: true }), { movingOnly: true })
  ok('…and through ±15% on every reading', h && near(h.usedPct, 20, 3) && h.refuels.length === 0, h && { used: h.usedPct, fills: h.refuels.length })
  const flat = drive([], r, '2026-09-21T08:00:00-04:00', '2026-09-21T10:00:00-04:00', 50, 50)
  const gf = stats.fuelFromLevels(flat, { movingOnly: true })
  ok('slosh alone burns nothing', gf && gf.usedPct < stats.FUEL_NOISE_PCT && gf.refuels.length === 0, gf && gf.usedPct)
  // Summing every drop fix by fix — what the gauge must NOT be read as.
  let naive = 0
  for (let i = 1; i < flat.length; i++) if (flat[i].pct > 0 && flat[i - 1].pct > flat[i].pct) naive += flat[i - 1].pct - flat[i].pct
  ok('(fix-by-fix drops would claim hundreds of percent)', naive > 300, naive)
}
{
  const r = rng(2)
  const s = drive([], r, '2026-09-21T08:00:00-04:00', '2026-09-21T10:00:00-04:00', 60, 30)
  drive(s, r, '2026-09-21T10:12:00-04:00', '2026-09-21T12:12:00-04:00', 85, 70)
  const g = stats.fuelFromLevels(s, { movingOnly: true })
  ok('a fill between two drives', g?.refuels.length === 1 && near(g.refuels[0].addedPct, 55, 3), g?.refuels)
  ok('burn on both sides of it', g && near(g.usedPct, 45, 3), g?.usedPct)
  ok('the fill is timed at the first reading after it', g && g.refuels[0].atMs >= t('2026-09-21T10:12:00-04:00') && g.refuels[0].atMs < t('2026-09-21T10:17:00-04:00'), iso(g?.refuels[0].atMs))
  ok('…and the last one before it', g && near(g.refuels[0].beforeMs, t('2026-09-21T10:00:00-04:00'), 5 * 60_000), iso(g?.refuels[0].beforeMs))
}
{
  const r = rng(3)
  const s = drive([], r, '2026-09-21T08:00:00-04:00', '2026-09-21T09:30:00-04:00', 60, 52.5)
  drive(s, r, '2026-09-21T09:30:05-04:00', '2026-09-21T09:34:00-04:00', 64, 64, { zero: 0 }) // a long grade: +12 for four minutes
  drive(s, r, '2026-09-21T09:34:05-04:00', '2026-09-21T11:00:00-04:00', 52.5, 45)
  const g = stats.fuelFromLevels(s, { movingOnly: true })
  ok('four odd minutes are neither a fill nor a burn', g && g.refuels.length === 0 && near(g.usedPct, 15, 2), g && { used: g.usedPct, fills: g.refuels })
}
{
  // A machine: works standing still, filled from a pump with the key on.
  const r = rng(4)
  const s = drive([], r, '2026-09-21T07:00:00-04:00', '2026-09-21T09:00:00-04:00', 40, 20, { mph: 0 })
  for (let k = 0; k <= 12; k++) s.push({ ms: t('2026-09-21T09:02:00-04:00') + k * 30_000, pct: 20 + k * 5, mph: 0 })
  drive(s, r, '2026-09-21T09:10:00-04:00', '2026-09-21T11:10:00-04:00', 80, 70, { mph: 0 })
  const g = stats.fuelFromLevels(s)
  ok('a pump reading its way up is one fill', g?.refuels.length === 1 && near(g.refuels[0].addedPct, 60, 5), g?.refuels)
  ok('…with the burn either side', g && near(g.usedPct, 30, 3), g?.usedPct)
  // …and one that never stopped reporting through the fill.
  const c = drive([], r, '2026-09-21T07:00:00-04:00', '2026-09-21T09:00:00-04:00', 40, 20, { mph: 0 })
  drive(c, r, '2026-09-21T09:00:05-04:00', '2026-09-21T09:06:00-04:00', 20, 80, { mph: 0, zero: 0 })
  drive(c, r, '2026-09-21T09:06:05-04:00', '2026-09-21T11:06:00-04:00', 80, 70, { mph: 0 })
  const gc = stats.fuelFromLevels(c)
  ok('a fill with no gap in the readings is still one fill', gc?.refuels.length === 1 && near(gc.refuels[0].addedPct, 60, 6), gc?.refuels)
  ok('…burn either side', gc && near(gc.usedPct, 30, 3), gc?.usedPct)
}
{
  // A truck parked on a slope reads high for as long as it sits.
  const r = rng(5)
  const s = drive([], r, '2026-09-21T08:00:00-04:00', '2026-09-21T09:00:00-04:00', 50, 45)
  drive(s, r, '2026-09-21T09:01:00-04:00', '2026-09-21T09:40:00-04:00', 57, 57, { mph: 0, step: 60, zero: 0 })
  drive(s, r, '2026-09-21T09:41:00-04:00', '2026-09-21T10:41:00-04:00', 45, 40)
  const moving = stats.fuelFromLevels(s, { movingOnly: true })
  ok('a vehicle\'s level is read on the move: no fill on the slope', moving && moving.refuels.length === 0 && near(moving.usedPct, 10, 2), moving && { used: moving.usedPct, fills: moving.refuels })
  const all = stats.fuelFromLevels(s)
  ok('(read parked too, the slope would pass for a fill)', all && all.refuels.length === 1, all && all.refuels)
}
ok('all zeros = no gauge', stats.fuelFromLevels([{ ms: 1, pct: 0, mph: 40 }, { ms: 2, pct: 0, mph: 40 }], { movingOnly: true }) === null)
ok('nothing = no gauge', stats.fuelFromLevels([]) === null)
ok('zeros and nonsense never count', stats.usableFuelSamples([{ ms: 1, pct: 0 }, { ms: 2, pct: 104 }, { ms: 3, pct: NaN }, { ms: 4, pct: 51 }]).length === 1)

// The RAM 2500, Fri Sep 25 6 AM → Mon Sep 28 4:50 PM: three fills (Sat
// 10:39 AM from ~4%, Sun 3:05 PM from ~1%, Mon 7:41 AM from ~1% after the
// tank ran dry overnight), the gauge silent with the key off.
const ram = (() => {
  const r = rng(2500)
  const s = []
  const d = (from, to, a, b) => drive(s, r, `${from}-04:00`, `${to}-04:00`, a, b)
  d('2026-09-25T06:00', '2026-09-25T07:10', 50, 43)
  d('2026-09-25T08:00', '2026-09-25T08:40', 43, 43)
  d('2026-09-25T11:30', '2026-09-25T16:40', 43, 18)
  d('2026-09-25T19:30', '2026-09-25T21:10', 17, 8)
  d('2026-09-26T05:30', '2026-09-26T06:20', 8, 6)
  d('2026-09-26T09:30', '2026-09-26T10:28', 5, 4)
  d('2026-09-26T10:39', '2026-09-26T12:40', 31, 23)
  d('2026-09-26T13:45', '2026-09-26T14:20', 22, 16)
  d('2026-09-26T15:30', '2026-09-26T20:50', 16, 1)
  d('2026-09-27T14:45', '2026-09-27T14:58', 1, 1)
  d('2026-09-27T15:05', '2026-09-27T15:40', 12, 10)
  d('2026-09-27T17:15', '2026-09-27T17:40', 8, 6)
  d('2026-09-27T19:30', '2026-09-27T20:50', 6, 1)
  d('2026-09-27T20:50', '2026-09-27T21:15', 0, 0) // bone dry: every reading 0
  d('2026-09-28T07:41', '2026-09-28T08:45', 74, 65)
  d('2026-09-28T09:15', '2026-09-28T10:20', 64, 50)
  d('2026-09-28T11:00', '2026-09-28T11:40', 48, 48)
  d('2026-09-28T15:00', '2026-09-28T16:50', 46, 27)
  return s
})()
const ramGauge = stats.fuelFromLevels(ram, { movingOnly: true })
{
  const g = ramGauge
  ok('RAM: 46 + 30 + 11 + 47 = 134% of the tank', g && near(g.usedPct, 134, 8), g?.usedPct)
  ok('RAM: three fills', g?.refuels.length === 3, g?.refuels.map((x) => ({ at: iso(x.atMs), added: x.addedPct })))
  ok('RAM: +27, +10, +72', g && [27, 10, 72].every((v, i) => near(g.refuels[i]?.addedPct ?? -99, v, 5)), g?.refuels.map((x) => x.addedPct))
  ok('RAM: Saturday\'s fill at 10:39 AM', g && g.refuels[0].atMs >= t('2026-09-26T10:39:00-04:00') && g.refuels[0].atMs < t('2026-09-26T10:45:00-04:00'), iso(g?.refuels[0].atMs))
  ok('RAM: Monday\'s fill came after a night of silence', g && g.refuels[2].atMs - g.refuels[2].beforeMs > 8 * HOUR, g && [iso(g.refuels[2].beforeMs), iso(g.refuels[2].atMs)])
}

// ── Miles the gauge could not see ───────────────────────────────────────────
{
  // Due north at 60 mph for two hours, a fix every 10 s.
  const t0 = t('2026-09-21T08:00:00-04:00')
  const pts = Array.from({ length: 721 }, (_, i) => ({ lat: 34.8 + (i / 6) / 69.05, lng: -82.4, speed: 60, ms: t0 + i * 10_000 }))
  const firstHour = pts.filter((p) => p.ms < t0 + HOUR).map((p) => p.ms)
  ok('gauge silent for the second hour = 60 mi unmeasured', near(stats.gaugeSilentMiles(pts, firstHour, t0, t0 + 2 * HOUR + 1), 60, 1), stats.gaugeSilentMiles(pts, firstHour, t0, t0 + 2 * HOUR + 1))
  ok('gauge heard throughout = none', stats.gaugeSilentMiles(pts, pts.map((p) => p.ms), t0, t0 + 2 * HOUR + 1) === 0)
}

// ── Tank size ───────────────────────────────────────────────────────────────
{
  const tk = (m) => stats.tankGallonsFrom(m)
  ok('a note: "32 gal tank"', JSON.stringify(tk({ notes: 'V8 diesel · 32 gal tank · spare key in office' })) === '{"gallons":32,"source":"notes"}', tk({ notes: 'V8 diesel · 32 gal tank · spare key in office' }))
  ok('a note: "fuel tank: 26 gal"', tk({ notes: 'fuel tank: 26 gal' })?.gallons === 26)
  ok('a note: "36-gallon diesel tank"', tk({ notes: 'has the 36-gallon diesel tank' })?.gallons === 36)
  ok('a spec key', JSON.stringify(tk({ fuel_tank: '36 gallons' })) === '{"gallons":36,"source":"specs"}')
  ok('a nested spec number', tk({ specs: { fuel_capacity: 48 } })?.gallons === 48)
  ok('litres convert', tk({ fuel_tank: '200 L' })?.gallons === 52.8)
  ok('a water tank is not the fuel', tk({ notes: 'water truck, 3000 gal water tank' }) === null && tk({ notes: 'water tank 300 gal' }) === null)
  ok('"tank: 26 gal" alone could be any tank', tk({ notes: 'tank: 26 gal' }) === null)
  ok('cans are not a tank', tk({ notes: 'carries two 20 gal cans' }) === null)
  ok('nonsense and toys refused', tk({ fuel_tank: 'big' }) === null && tk({ fuel_tank: '2 gal' }) === null && tk(null) === null)
  ok('padded values still read', tk({ fuel_tank: '  32 gal  ' })?.gallons === 32 && tk({ fuel_tank: '32 - gal' })?.gallons === 32)
  // The owner writes these fields: a run of spaces used to backtrack
  // cubically and pin a server for minutes (sec-check, Sep 28).
  const pad = ' '.repeat(20_000)
  const started = Date.now()
  const spun = [
    tk({ fuel_tank: `1${pad}x` }), tk({ specs: { fuel_capacity: `1${pad}-${pad}gal${pad}x` } }),
    tk({ notes: `1${pad}-${pad}gal x` }), tk({ notes: `fuel tank${pad}1${pad}-${pad}x` }), tk({ notes: '1 '.repeat(10_000) }),
  ]
  const tookMs = Date.now() - started
  ok('long runs of spaces answer at once', spun.every((v) => v === null) && tookMs < 200, { tookMs, spun })
}

// ── The answer, in words ────────────────────────────────────────────────────
{
  const FRI6 = t('2026-09-25T06:00:00-04:00')
  const NOW = t('2026-09-28T16:50:00-04:00')
  const base = {
    asset: 'RAM 2500', fromMs: FRI6, toMs: NOW, nowMs: NOW, tz: NY, notes: [], fixes: 21000, truncated: false,
    stats: { miles: 412.3, maxMph: 74, movingMin: 640, idleMin: 95, parkedMin: 3300, starts: 28, fuelGalEst: 28.4 },
    lastReportMs: NOW,
    fuel: { gauge: ramGauge, reportsFuel: true, silentMiles: 8, tankGallons: null, tankSource: null, estMpg: 15 },
  }
  const miles = ask.activityAnswer(base, 'miles')
  ok('miles answer says the window', miles.startsWith('RAM 2500, Fri Sep 25 6:00 AM → now: 412.3 mi driven'), miles)
  const fuel = ask.activityAnswer(base, 'fuel')
  ok('fuel answer leads with the gauge', /its own fuel gauge shows 1[23]\d% of the tank used — about 1\.[34] tanks/.test(fuel), fuel)
  ok('…lists the fills', fuel.includes('3 fill-ups') && fuel.includes('Sat Sep 26 10:3') && fuel.includes('between Sun Sep 27'), fuel)
  ok('…gallons only as a labeled estimate', fuel.includes('about 28.4 gal by distance') && fuel.includes('an estimate, not a measurement'), fuel)
  ok('…and says how to get real gallons', fuel.includes('tank size'), fuel)
  ok('…never talks down', !/as i (just )?told you|same as before|like i said/i.test(fuel))
  const tanked = ask.activityAnswer({ ...base, fuel: { ...base.fuel, tankGallons: 32, tankSource: 'notes' } }, 'fuel')
  ok('with a tank size: gallons off the gauge', /of the 32-gal tank used — about 1\.[34] tanks: about 4[0-5](\.\d)? gal/.test(tanked) && !tanked.includes('by distance'), tanked)
  const silent = ask.activityAnswer({ ...base, fuel: { ...base.fuel, silentMiles: 120 } }, 'fuel')
  ok('a gauge that missed miles says the figure is low', silent.includes('silent for 120 of the 412.3 mi'), silent)
  const noGauge = ask.activityAnswer({ ...base, fuel: { ...base.fuel, gauge: null, reportsFuel: false, silentMiles: null } }, 'fuel')
  ok('no gauge: the estimate, and why', noGauge.includes('about 28.4 gal by distance (412.3 mi at ~15 mpg plus 1 h 35 min idling)') && noGauge.includes('doesn\'t report a fuel level'), noGauge)
  const nothing = ask.activityAnswer({ ...base, fixes: 0, stats: { ...base.stats, miles: 0 } }, 'miles')
  ok('no reports: says so', nothing.startsWith('No reports from RAM 2500 for Fri Sep 25 6:00 AM → now'), nothing)
  const noted = ask.activityAnswer({ ...base, notes: ['Ask AI reads at most 31 days at a time.'] }, 'miles')
  ok('cuts to the window are passed along', noted.endsWith('Ask AI reads at most 31 days at a time.'), noted)

  const tool = ask.activityToolResult(base)
  ok('tool: the window text', tool.window === 'Fri Sep 25 6:00 AM → now', tool.window)
  ok('tool: gauge first', tool.fuel.measuredBy.includes('gauge') && near(tool.fuel.gaugeUsedPctOfTank, 134, 8) && tool.fuel.refuels.length === 3, tool.fuel)
  ok('tool: no gallons without a tank size', !('gaugeUsedGallons' in tool.fuel) && tool.fuel.tankGallons === null)
  ok('tool: a long gap is marked', 'sometimeAfter' in tool.fuel.refuels[2] && !('sometimeAfter' in tool.fuel.refuels[0]), tool.fuel.refuels)
  ok('tool: the estimate is labeled', tool.fuel.estimateGallons === 28.4 && tool.fuel.estimateBasis.includes('not a measurement'))
  const tool32 = ask.activityToolResult({ ...base, fuel: { ...base.fuel, tankGallons: 32, tankSource: 'notes' } })
  ok('tool: gallons with a tank size', near(tool32.fuel.gaugeUsedGallons, 0.32 * ramGauge.usedPct, 0.1) && tool32.fuel.tankFrom === 'the asset\'s notes', tool32.fuel)
}

console.log(`ask-activity: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
