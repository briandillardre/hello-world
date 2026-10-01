/**
 * DOT short-haul time records — the ELD answer for most contractor drivers
 * (Oct 1 2026; Brian, of Linxup's $30/vehicle/mo ELD: "Dashcams, eld
 * logbooks, buying online. Let's solve this").
 *
 * A driver of a commercial motor vehicle (10,001 lb+ GVWR/GCWR) needs no
 * logbook and no ELD on a day that meets the federal short-haul exception,
 * 49 CFR 395.1(e) — only time records the carrier keeps for 6 months:
 *
 *   (e)(1) CDL drivers: stays within 150 AIR-miles (172.6 statute miles) of
 *          the normal work reporting location, returns there and is released
 *          within 14 consecutive hours, and (property-carrying) has at least
 *          10 consecutive hours off duty between each 14 hours on duty.
 *   (e)(2) non-CDL drivers: 150 air-miles, returns to the reporting location
 *          at the end of each duty tour, and does not drive after the 14th
 *          hour after coming on duty on 5 days of any 7 consecutive days, or
 *          after the 16th hour on 2 days of any 7 — so at most 2 days in any
 *          7 may run past 14 hours, and none past 16.
 *
 *   Records: when the driver reported for duty, total hours on duty, when
 *   released, and the total for the preceding 7 days (395.8(j)(2), for
 *   drivers used for the first time or intermittently).
 *
 * A day that misses a condition needs a log (record of duty status) for
 * that day; more than 8 such days in any 30 means the driver needs an ELD
 * (395.8(a)(1)(iii)(A)(1)).
 *
 * Our time clock IS the record: clock-in = reported for duty, clock-out =
 * released, the phone's own fixes during the shift give the farthest point
 * from where the day started. The reporting location is where the day's
 * first clock-in happened. On-duty hours are the clocked hours minus unpaid
 * breaks; the 14/16-hour checks use the span from the first clock-in to the
 * last clock-out — a conservative stand-in for "drove after the 14th hour".
 *
 * Federal rule only; South Carolina's intrastate limits can differ. Pure —
 * lib/db/short-haul.ts loads. Harness: scripts/short-haul-test.mjs — run it
 * after ANY change here.
 */
import { addDaysKey, dayKey, fmtTime } from './dates'
import { shiftHours } from './timecards'

export type DriverClass = 'cdl' | 'cmv'

export const DRIVER_CLASS_LABEL: Record<DriverClass, string> = {
  cdl: 'CDL driver',
  cmv: 'Commercial driver, no CDL',
}

export function isDriverClass(v: unknown): v is DriverClass {
  return v === 'cdl' || v === 'cmv'
}

/** One air mile = one nautical mile. */
export const AIR_MILE_M = 1852
export const RADIUS_AIR_MI = 150
/** CDL: returned and released within this many hours of coming on duty. */
export const CDL_RELEASE_H = 14
/** CDL, property-carrying: off duty at least this long between duty periods. */
export const CDL_REST_H = 10
/** Non-CDL: past 14 h on at most 2 days of any 7; never past 16 h. */
export const NONCDL_LONG_H = 14
export const NONCDL_MAX_H = 16
export const NONCDL_LONG_DAYS = 2
/** Released this close to where the day started = back at the reporting location. */
export const RETURN_M = 1609
/** More than this many log days in 30 = an ELD is required. */
export const ELD_LOG_DAYS = 8
/** Say so early — at this many the next few days decide it. */
export const ELD_WARN_DAYS = 6
/** An entry still open after this long is a forgotten clock-out, not a duty day. */
export const STALE_OPEN_H = 24

export interface ShortHaulShift {
  id: string
  userId: string
  personName: string
  inAt: string
  outAt: string | null
  breakMinutes: number
  inLat: number | null
  inLng: number | null
  outLat: number | null
  outLng: number | null
  /** Farthest phone fix from the DAY's reporting point, metres; null = unknown. */
  reachM?: number | null
  /** Phone fixes in the shift; null = not asked (database can't say). */
  fixes?: number | null
}

export type ShortHaulIssue =
  | 'radius' | 'not_back' | 'release_14' | 'rest_10' | 'over_16' | 'long_days'
  | 'no_start' | 'no_fixes' | 'no_release' | 'gps_hidden'

/** Issues that take the day out of the exception (a log is needed). The
 *  rest say the record can't prove the day either way. */
export const LOG_ISSUES: ShortHaulIssue[] = ['radius', 'not_back', 'release_14', 'rest_10', 'over_16', 'long_days']

export const ISSUE_LABEL: Record<ShortHaulIssue, string> = {
  radius: 'Past 150 air-miles',
  not_back: 'Not back at the start',
  release_14: 'Past 14 hours',
  rest_10: 'Under 10 h off',
  over_16: 'Past 16 hours',
  long_days: '3rd long day in 7',
  no_start: 'No clock-in location',
  no_fixes: 'No phone GPS',
  no_release: 'Still clocked in',
  gps_hidden: 'GPS hidden',
}

export interface ShortHaulDay {
  dayKey: string
  /** First clock-in of the day — reported for duty. */
  startAt: string
  /** Last clock-out — released; null while still on duty. */
  releaseAt: string | null
  open: boolean
  /** First clock-in → last clock-out (or now), hours. */
  spanH: number
  /** Clocked hours minus unpaid breaks, hours. */
  onDutyH: number
  /** Farthest the phone went from where the day started, air-miles; null = unknown. */
  reachAirMi: number | null
  /** The release point's distance from where the day started, air-miles; null = unknown. */
  releaseAirMi: number | null
  /** Off duty since the previous duty day's release, hours; null = no earlier day in range. */
  restH: number | null
  /** On-duty total for the 7 days before this one. */
  prior7H: number
  issues: ShortHaulIssue[]
  /** One plain sentence per issue. */
  notes: string[]
  /** The day falls outside the exception — a log (record of duty status) is needed. */
  logNeeded: boolean
  shifts: number
}

export type EldStatus = 'ok' | 'warn' | 'needed'

export interface ShortHaulRecord {
  userId: string
  personName: string
  driverClass: DriverClass
  /** Newest first, inside the asked window. */
  days: ShortHaulDay[]
  /** Log-needed days in the 30 days ending at the window's last day. */
  logDays30: number
  eld: EldStatus
  /** Hours on duty in the window. */
  windowH: number
}

const R_M = 6371008.8

/** Great-circle distance, metres. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

const has = (lat: number | null | undefined, lng: number | null | undefined): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)

const byIn = (a: ShortHaulShift, b: ShortHaulShift) => Date.parse(a.inAt) - Date.parse(b.inAt)

/** Each person's shifts grouped by the local day they clocked in. */
export function groupDays(shifts: ShortHaulShift[], tz: string): Map<string, Map<string, ShortHaulShift[]>> {
  const out = new Map<string, Map<string, ShortHaulShift[]>>()
  for (const s of shifts.slice().sort(byIn)) {
    const ms = Date.parse(s.inAt)
    if (!Number.isFinite(ms)) continue
    const k = dayKey(ms, tz)
    let person = out.get(s.userId)
    if (!person) { person = new Map(); out.set(s.userId, person) }
    const list = person.get(k) ?? []
    list.push(s)
    person.set(k, list)
  }
  return out
}

/**
 * Where each shift's day started — the reporting location its fixes are
 * measured from (the day's first clock-in point). The loader hands these to
 * the database, which measures every phone fix against them.
 */
export function reportingPoints(shifts: ShortHaulShift[], tz: string): Map<string, { lat: number; lng: number } | null> {
  const out = new Map<string, { lat: number; lng: number } | null>()
  groupDays(shifts, tz).forEach((days) => {
    days.forEach((list) => {
      const first = list[0]
      const origin = has(first.inLat, first.inLng) ? { lat: first.inLat as number, lng: first.inLng as number } : null
      for (const s of list) out.set(s.id, origin)
    })
  })
  return out
}

const h1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const mi0 = (n: number) => Math.round(n).toLocaleString('en-US')

/** One day's numbers and verdict. `prev` = the previous duty day (for the
 *  10-hour rest), `recent` = the days before this one in the last 6 (for
 *  non-CDL long days). */
function dayRecord(
  key: string, list: ShortHaulShift[], cls: DriverClass, nowMs: number, tz: string,
  prevRelease: string | null | undefined, recentLongDays: number, prior7H: number, gpsHidden: boolean,
): ShortHaulDay {
  const sorted = list.slice().sort(byIn)
  const first = sorted[0]
  const startMs = Date.parse(first.inAt)
  const open = sorted.some((s) => !s.outAt)
  let releaseAt: string | null = null
  let last: ShortHaulShift | null = null
  if (!open) {
    for (const s of sorted) if (!releaseAt || Date.parse(s.outAt!) > Date.parse(releaseAt)) { releaseAt = s.outAt; last = s }
  }
  const stale = open && nowMs - startMs > STALE_OPEN_H * 3_600_000
  const endMs = releaseAt ? Date.parse(releaseAt) : Math.min(nowMs, startMs + STALE_OPEN_H * 3_600_000)
  const spanH = Math.max(0, (endMs - startMs) / 3_600_000)
  const onDutyH = sorted.reduce((sum, s) => sum + shiftHours(s.inAt, s.outAt, s.breakMinutes, nowMs).paid, 0)

  const origin = has(first.inLat, first.inLng) ? { lat: first.inLat as number, lng: first.inLng as number } : null
  const reaches = sorted.map((s) => s.reachM).filter((m): m is number => typeof m === 'number' && Number.isFinite(m))
  const fixes = sorted.reduce((n, s) => n + (typeof s.fixes === 'number' ? s.fixes : 0), 0)
  const reachAirMi = !gpsHidden && origin && reaches.length && fixes > 0 ? Math.max(...reaches) / AIR_MILE_M : null
  const releaseAirMi = !gpsHidden && origin && last && has(last.outLat, last.outLng)
    ? metresBetween(origin, { lat: last.outLat as number, lng: last.outLng as number }) / AIR_MILE_M
    : null
  const restH = prevRelease ? (startMs - Date.parse(prevRelease)) / 3_600_000 : null

  const issues: ShortHaulIssue[] = []
  const notes: string[] = []
  const say = (i: ShortHaulIssue, s: string) => { issues.push(i); notes.push(s) }

  if (reachAirMi != null && reachAirMi > RADIUS_AIR_MI) {
    say('radius', `Went ${reachAirMi.toFixed(1)} air-miles from where the day started — past the 150-mile short-haul radius.`)
  }
  if (releaseAirMi != null && releaseAirMi * AIR_MILE_M > RETURN_M) {
    say('not_back', `Released ${mi0(Math.max(1, releaseAirMi))} air-mi from where the day started — short-haul needs the driver back at the reporting location.`)
  }
  if (!stale) {
    if (cls === 'cdl') {
      if (spanH > CDL_RELEASE_H) say('release_14', `${open ? 'On duty' : 'Released'} ${h1(spanH)} h after coming on duty — past 14 hours.`)
      if (restH != null && restH >= 0 && restH < CDL_REST_H) say('rest_10', `Only ${h1(restH)} h off duty before this shift — 10 needed.`)
    } else {
      if (spanH > NONCDL_MAX_H) say('over_16', `On duty ${h1(spanH)} h — past the 16-hour limit.`)
      else if (spanH > NONCDL_LONG_H && recentLongDays >= NONCDL_LONG_DAYS) {
        say('long_days', `Day ${recentLongDays + 1} past 14 hours in 7 days — only ${NONCDL_LONG_DAYS} allowed.`)
      }
    }
  }
  if (gpsHidden) say('gps_hidden', 'Hours only — this driver’s GPS is above your role.')
  else if (!origin) say('no_start', 'No location at clock-in — the 150-mile radius can’t be checked.')
  else if (reachAirMi == null) say('no_fixes', 'No phone GPS during the shift — the 150-mile radius can’t be checked.')
  // A shift still running is just "on duty" (the verdict says it); one open
  // for a day or more is a forgotten clock-out the record can't stand on.
  if (stale) say('no_release', `Still clocked in since ${fmtTime(startMs, tz)} the day it started — fix the time card.`)

  return {
    dayKey: key,
    startAt: first.inAt,
    releaseAt,
    open,
    spanH: Math.round(spanH * 100) / 100,
    onDutyH: Math.round(onDutyH * 100) / 100,
    reachAirMi: reachAirMi == null ? null : Math.round(reachAirMi * 10) / 10,
    releaseAirMi: releaseAirMi == null ? null : Math.round(releaseAirMi * 10) / 10,
    restH: restH == null ? null : Math.round(restH * 10) / 10,
    prior7H: Math.round(prior7H * 100) / 100,
    issues,
    notes,
    logNeeded: issues.some((i) => LOG_ISSUES.includes(i)),
    shifts: sorted.length,
  }
}

/**
 * Every commercial driver's days in [fromKey, toKey] (local day keys,
 * inclusive), newest first. Pass shifts from at least 37 days before
 * `toKey` so the 7-day totals, the rest check and the 30-day log count are
 * complete at the window's start. `classes` = who drives what; anyone not
 * in it is not a commercial driver and gets no record. `gpsHidden` = people
 * whose GPS the viewer may not read (they outrank them).
 */
export function buildShortHaul(
  shifts: ShortHaulShift[],
  classes: Record<string, DriverClass>,
  opts: { tz: string; fromKey: string; toKey: string; nowMs?: number; gpsHidden?: Set<string> },
): ShortHaulRecord[] {
  const nowMs = opts.nowMs ?? Date.now()
  const grouped = groupDays(shifts.filter((s) => isDriverClass(classes[s.userId])), opts.tz)
  const records: ShortHaulRecord[] = []
  grouped.forEach((days, userId) => {
    const cls = classes[userId]
    const keys = Array.from(days.keys()).sort()
    const built = new Map<string, ShortHaulDay>()
    let prevRelease: string | null | undefined
    for (const k of keys) {
      if (k > opts.toKey) break
      const list = days.get(k)!
      let prior7H = 0
      let recentLong = 0
      for (let d = 1; d <= 7; d++) {
        const day = built.get(addDaysKey(k, -d))
        if (!day) continue
        prior7H += day.onDutyH
        // An earlier day still open is a forgotten clock-out, not a long day.
        if (d <= 6 && !day.open && day.spanH > NONCDL_LONG_H) recentLong++
      }
      const rec = dayRecord(k, list, cls, nowMs, opts.tz, prevRelease, recentLong, prior7H, !!opts.gpsHidden?.has(userId))
      built.set(k, rec)
      // An open day has no release yet: the next day's rest can't be measured.
      prevRelease = rec.open ? null : rec.releaseAt
    }
    const from30 = addDaysKey(opts.toKey, -29)
    let logDays30 = 0
    built.forEach((d, k) => { if (k >= from30 && k <= opts.toKey && d.logNeeded) logDays30++ })
    const inWindow = Array.from(built.values()).filter((d) => d.dayKey >= opts.fromKey && d.dayKey <= opts.toKey)
    if (!inWindow.length) return
    const first = days.get(keys[0])![0]
    records.push({
      userId,
      personName: first.personName || 'Driver',
      driverClass: cls,
      days: inWindow.sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1)),
      logDays30,
      eld: logDays30 > ELD_LOG_DAYS ? 'needed' : logDays30 >= ELD_WARN_DAYS ? 'warn' : 'ok',
      windowH: Math.round(inWindow.reduce((s, d) => s + d.onDutyH, 0) * 100) / 100,
    })
  })
  // Whoever is closest to needing an ELD first, then by name.
  const weight: Record<EldStatus, number> = { needed: 0, warn: 1, ok: 2 }
  return records.sort((a, b) => weight[a.eld] - weight[b.eld] || b.logDays30 - a.logDays30 || a.personName.localeCompare(b.personName))
}

/** "2 log days in the last 30 · ELD needed past 8". */
export function eldWords(r: Pick<ShortHaulRecord, 'logDays30' | 'eld'>): string {
  const n = r.logDays30
  if (r.eld === 'needed') return `${n} log days in the last 30 — past 8, this driver needs an ELD.`
  if (n === 0) return 'Every day in the last 30 met the short-haul exception.'
  return `${n} log day${n === 1 ? '' : 's'} in the last 30 — an ELD is required past 8.`
}

const csvCell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The carrier's time records, one row per driver-day — what an auditor asks for. */
export function shortHaulCsv(records: ShortHaulRecord[], tz: string): string {
  const head = [
    'Driver', 'Driver type', 'Date', 'Reported for duty', 'Released', 'Hours on duty',
    'Hours start to release', 'On duty prior 7 days', 'Farthest (air-mi)', 'Released from start (air-mi)',
    'Short-haul', 'Reasons',
  ]
  const rows = [head.join(',')]
  for (const r of records) {
    for (const d of r.days.slice().reverse()) {
      rows.push([
        r.personName, DRIVER_CLASS_LABEL[r.driverClass], d.dayKey,
        fmtTime(Date.parse(d.startAt), tz), d.releaseAt ? fmtTime(Date.parse(d.releaseAt), tz) : 'on duty',
        d.onDutyH.toFixed(2), d.spanH.toFixed(2), d.prior7H.toFixed(2),
        d.reachAirMi == null ? '' : d.reachAirMi.toFixed(1), d.releaseAirMi == null ? '' : d.releaseAirMi.toFixed(1),
        d.logNeeded ? 'Log needed' : d.open ? 'On duty' : d.issues.length ? 'Can’t verify' : 'Met',
        d.notes.join(' '),
      ].map(csvCell).join(','))
    }
  }
  return rows.join('\n') + '\n'
}
