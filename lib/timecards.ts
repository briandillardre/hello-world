/**
 * Time cards — the pure math behind /timecards, the CSV export and the AI
 * `time_cards` tool (Sep 9 2026; Brian: "clock in also a must and mandatory
 * tracking thru app while clocked in"; the bar is Workyard's "GPS-verified
 * time cards straight to payroll").
 *
 * Inputs are time_entries rows (015/059/103/120) plus, per entry, what the
 * person's phone reported between clock-in and clock-out (migration 120's
 * timecard_gps_stats_v2). Outputs are per-person cards: days → entries with
 * paid hours, an on-site share and plain-word flags, weekly regular / OT
 * split at 40 h (FLSA; SC has no daily overtime), hours by site.
 *
 * INTEGRITY (Sep 22 2026): a landscaping prospect's office found, by
 * reviewing camera footage against the timecards, one crew member clocking
 * another in nineteen minutes before he arrived, and whole shifts clocked on
 * days the person's car was never on the property. The phone's own record
 * of the shift answers both without a camera — this file reads it against
 * the clock and says, in one sentence per entry, what a manager should look
 * at: never on site, the same phone clocking two people, clocked in away
 * from the site, on site N minutes after clocking in, left N minutes before
 * clocking out, a phone that never moved all shift, a missing clock-in photo.
 *
 * No I/O here — lib/db/timecards.ts loads, this file computes, and the same
 * numbers reach the page, the export and the assistant. Harness:
 * scripts/timecards-test.mjs — run it after ANY change here.
 */
import { dayKey, fmtDateTime, fmtTime, addDaysKey } from './dates'
import { fmtDistanceM } from './clock-policy'

export type TimeCardFlag =
  | 'open' | 'no_gps' | 'off_site' | 'long' | 'edited' | 'no_site'
  | 'never_on_site' | 'shared_device' | 'in_away' | 'out_away' | 'arrived_late' | 'left_early' | 'phone_still' | 'no_photo'

export const FLAG_LABEL: Record<TimeCardFlag, string> = {
  open: 'Still clocked in',
  no_gps: 'No GPS',
  off_site: 'Mostly off-site',
  long: 'Long shift',
  edited: 'Edited',
  no_site: 'No site',
  never_on_site: 'Never on site',
  shared_device: 'Shared phone',
  in_away: 'Clocked in away',
  out_away: 'Clocked out away',
  arrived_late: 'Arrived after clock-in',
  left_early: 'Left before clock-out',
  phone_still: 'Phone never moved',
  no_photo: 'No photo',
}

/** The flags that put an entry on the manager's "Needs a look" list, worst
 *  first — the order the list sorts by. Open / Edited / No site are states,
 *  not doubts. */
export const INTEGRITY_FLAGS: TimeCardFlag[] = [
  'never_on_site', 'shared_device', 'no_gps', 'in_away', 'out_away', 'arrived_late', 'left_early', 'phone_still', 'off_site', 'no_photo', 'long',
]

export interface TimeCardGps {
  fixes: number
  onSite: number
  firstFix: string | null
  lastFix: string | null
  /** 120 (timecard_gps_stats_v2) — absent on a pre-120 database. */
  firstOnSite?: string | null
  lastOnSite?: string | null
  /** Corner to corner of the shift's fixes, metres. */
  spreadM?: number | null
  /** Clock-in / clock-out fix to the site's edge, metres (0 inside; null without a site or a fix). */
  inDistM?: number | null
  outDistM?: number | null
  /** That fix inside one of the company's yards. */
  inAtYard?: boolean | null
  outAtYard?: boolean | null
}

export interface TimeCardEntry {
  id: string
  userId: string
  personName: string
  category: string
  zoneId: string | null
  zoneName: string | null
  plan: string
  inAt: string
  outAt: string | null
  breakMinutes: number
  inLat: number | null
  inLng: number | null
  outLat: number | null
  outLng: number | null
  /** Where the clock-in / clock-out happened, in words (zone → cached address → nothing). */
  inPlace: string | null
  outPlace: string | null
  edited: { by: string | null; at: string | null; note: string | null; originalIn: string | null; originalOut: string | null } | null
  /** Phone fixes during the shift (103/120 RPC); null when the database cannot say yet. */
  gps: TimeCardGps | null
  /** The phone that clocked in / out (120) — a random id the app keeps per device. */
  deviceId?: string | null
  outDeviceId?: string | null
  /** A clock-in / clock-out photo exists (120); the URL is signed and short-lived. */
  inPhoto?: boolean
  outPhoto?: boolean
  inPhotoUrl?: string | null
  outPhotoUrl?: string | null
}

export interface TimeCardRow extends TimeCardEntry {
  dayKey: string
  /** Wall-clock hours between in and out (or now). */
  elapsedHours: number
  /** Paid hours = elapsed − unpaid break, never below 0. */
  hours: number
  /** Share of the shift's fixes inside the clocked job site; null without fixes or a site. */
  onSitePct: number | null
  flags: TimeCardFlag[]
  /** One plain sentence per integrity flag — what a manager reads. */
  findings: string[]
  /** True when any INTEGRITY flag is on: the entry belongs on "Needs a look". */
  review: boolean
  /** Teammates whose entries came from the same phone this window. */
  sharedWith: string[]
}

export interface DayCard { dayKey: string; entries: TimeCardRow[]; hours: number }
export interface SiteHours { zoneId: string | null; label: string; hours: number }
export interface PersonCard {
  userId: string
  personName: string
  days: DayCard[]
  hours: number
  regular: number
  overtime: number
  openNow: boolean
  /** Fixes inside the clocked site ÷ all fixes, across project shifts with fixes. */
  verifiedPct: number | null
  fixes: number
  flags: Record<TimeCardFlag, number>
  /** Entries on the "Needs a look" list. */
  review: number
  sites: SiteHours[]
}

export const OT_WEEKLY_HOURS = 40
export const LONG_SHIFT_HOURS = 14
export const OFF_SITE_BELOW_PCT = 50
/** An entry nobody closed stops accruing here — the flag says "still clocked in". */
export const MAX_SHIFT_HOURS = 24
/** A clock-in / clock-out fix this far from the site (and not in a yard) is "away". A quarter mile. */
export const AWAY_M = 400
/** Nearer than this to the site's edge counts as at the site for the arrive/leave reads. */
export const NEAR_M = 100
/** On site this long after clocking in, or gone this long before clocking out, is worth a look. */
export const LATE_ARRIVAL_MIN = 10
export const EARLY_LEAVE_MIN = 10
/** A closed shift of this many hours with this many fixes inside this many metres = the phone never moved. */
export const STILL_HOURS = 2
export const STILL_FIXES = 10
export const STILL_M = 50
/** Enough fixes to say "never on site" instead of "no signal yet". */
export const NEVER_ON_SITE_FIXES = 5

export const round2 = (n: number) => Math.round(n * 100) / 100
const h1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

const CATEGORY_LABEL: Record<string, string> = {
  project: 'Project', shop: 'Shop', overhead: 'Office / other', maintenance: 'Maintenance',
}
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c

/** Wall-clock and paid hours for one entry at `nowMs`. */
export function shiftHours(inAt: string, outAt: string | null, breakMinutes: number, nowMs: number): { elapsed: number; paid: number } {
  const start = Date.parse(inAt)
  const end = outAt ? Date.parse(outAt) : nowMs
  const elapsedRaw = Math.max(0, (end - start) / 3_600_000)
  const elapsed = Math.min(MAX_SHIFT_HOURS, elapsedRaw)
  const paid = Math.max(0, elapsed - Math.max(0, breakMinutes || 0) / 60)
  return { elapsed: round2(elapsed), paid: round2(paid) }
}

const minutesBetween = (a: string | null | undefined, b: string | null | undefined): number | null => {
  if (!a || !b) return null
  const x = Date.parse(a), y = Date.parse(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return Math.round((y - x) / 60_000)
}

export interface FlagPolicy { photoIn: boolean; photoOut: boolean }

/**
 * The flags and their sentences for one entry. `sharedWith` = teammates whose
 * entries in the window came from this entry's phone; `policy` = the
 * company's photo switches (a missing photo is only a finding when one was
 * required).
 */
export function flagsFor(e: TimeCardEntry, elapsed: number, onSitePct: number | null, sharedWith: string[] = [], policy: FlagPolicy | null = null): { flags: TimeCardFlag[]; findings: string[] } {
  const flags: TimeCardFlag[] = []
  const findings: string[] = []
  const say = (f: TimeCardFlag, s: string) => { flags.push(f); findings.push(s) }
  const closed = !!e.outAt
  const site = e.zoneName
  if (!e.outAt) flags.push('open')
  if (e.edited) flags.push('edited')
  if (e.category === 'project' && !e.zoneId) flags.push('no_site')

  if (sharedWith.length) say('shared_device', `Same phone as ${sharedWith.join(' and ')}`)

  if (e.gps) {
    const g = e.gps
    // No shift fixes at all (the clock-in fix lives on the entry, not in the
    // trail). A shift that just started gets 15 minutes before it counts.
    const settled = closed || elapsed >= 0.25
    if (g.fixes === 0 && settled) {
      say('no_gps', elapsed >= 1 ? `${h1(elapsed)} h clocked with no phone fixes at all` : 'No phone fixes during the shift')
    }
    // A zone the viewer cannot see (someone's personal zone) counts nothing
    // as on-site — that is not a flag, so it needs the zone to be visible.
    if (onSitePct != null && site && g.fixes >= NEVER_ON_SITE_FIXES) {
      if (g.onSite === 0) say('never_on_site', `Never on ${site}: ${g.fixes} phone fixes during the shift, none inside the site`)
      else if (onSitePct < OFF_SITE_BELOW_PCT) say('off_site', `Only ${onSitePct}% of the shift's fixes on ${site}`)
    }
    // Where the clock-in / clock-out tap happened (120). A yard start or a
    // yard finish is how crews work, not a doubt.
    if (site && g.inDistM != null && g.inDistM >= AWAY_M && !g.inAtYard) say('in_away', `Clocked in ${fmtDistanceM(g.inDistM)} from ${site}`)
    if (site && closed && g.outDistM != null && g.outDistM >= AWAY_M && !g.outAtYard) say('out_away', `Clocked out ${fmtDistanceM(g.outDistM)} from ${site}`)
    // On site N minutes after clocking in: the phone was somewhere else
    // first (a fix off the site before the first on-site fix), the tap was
    // not on the site, and not a yard start. "The tracker's first fix took
    // a minute" is not an arrival.
    if (site && g.firstOnSite && g.firstFix && !g.inAtYard && (g.inDistM == null || g.inDistM > NEAR_M)) {
      const travel = minutesBetween(g.firstFix, g.firstOnSite)
      const late = minutesBetween(e.inAt, g.firstOnSite)
      if (travel != null && travel >= LATE_ARRIVAL_MIN && late != null && late >= LATE_ARRIVAL_MIN) say('arrived_late', `On site ${late} min after clocking in`)
    }
    // Left N minutes before clocking out: fixes CONTINUED off the site after
    // the last on-site one (a phone that went dark is a different story),
    // the clock-out tap was not on the site, and not a yard finish.
    if (site && closed && g.lastOnSite && g.lastFix && !g.outAtYard && (g.outDistM == null || g.outDistM > NEAR_M)) {
      const after = minutesBetween(g.lastOnSite, g.lastFix)
      const early = minutesBetween(g.lastOnSite, e.outAt)
      if (after != null && after >= EARLY_LEAVE_MIN && early != null && early >= EARLY_LEAVE_MIN) say('left_early', `Left the site ${early} min before clocking out`)
    }
    // A phone that sat still all shift — in a parked truck, in a locker.
    if (closed && elapsed >= STILL_HOURS && g.fixes >= STILL_FIXES && g.spreadM != null && g.spreadM < STILL_M) {
      say('phone_still', `Phone didn't move all shift (${fmtDistanceM(g.spreadM)} across ${h1(elapsed)} h)`)
    }
  }
  if (policy) {
    const missIn = policy.photoIn && !e.inPhoto
    const missOut = policy.photoOut && closed && !e.outPhoto
    if (missIn && missOut) say('no_photo', 'No clock-in or clock-out photo')
    else if (missIn) say('no_photo', 'No clock-in photo')
    else if (missOut) say('no_photo', 'No clock-out photo')
  }
  if (elapsed > LONG_SHIFT_HOURS) say('long', `${h1(elapsed)} h shift`)
  return { flags, findings }
}

function emptyFlags(): Record<TimeCardFlag, number> {
  const out = {} as Record<TimeCardFlag, number>
  for (const k of Object.keys(FLAG_LABEL) as TimeCardFlag[]) out[k] = 0
  return out
}

/** Per-person cards for a set of entries (one week, one month — the caller
 *  picks the window; OT is split against `otWeekly` over the whole set, so
 *  hand it exactly one pay week for a payroll read). */
export function buildTimeCards(entries: TimeCardEntry[], opts: { tz: string; nowMs?: number; otWeekly?: number; policy?: FlagPolicy | null }): PersonCard[] {
  const nowMs = opts.nowMs ?? Date.now()
  const otWeekly = opts.otWeekly ?? OT_WEEKLY_HOURS
  const policy = opts.policy ?? null

  // Which people each phone clocked in this window (120). Two people on one
  // device is the buddy-punch tell — a name per teammate, never a raw id.
  const deviceUsers = new Map<string, Map<string, string>>()
  for (const e of entries) {
    for (const dev of [e.deviceId, e.outDeviceId]) {
      if (!dev) continue
      const m = deviceUsers.get(dev) ?? new Map<string, string>()
      if (!m.has(e.userId)) m.set(e.userId, e.personName || 'Crew')
      deviceUsers.set(dev, m)
    }
  }
  const sharedWith = (e: TimeCardEntry): string[] => {
    const names = new Map<string, string>()
    for (const dev of [e.deviceId, e.outDeviceId]) {
      if (!dev) continue
      for (const [uid, name] of Array.from(deviceUsers.get(dev)?.entries() ?? [])) if (uid !== e.userId) names.set(uid, name)
    }
    return Array.from(names.values()).sort()
  }

  const byPerson = new Map<string, { name: string; rows: TimeCardRow[] }>()
  for (const e of entries) {
    const { elapsed, paid } = shiftHours(e.inAt, e.outAt, e.breakMinutes, nowMs)
    const onSitePct = e.gps && e.gps.fixes > 0 && e.zoneId ? Math.round((e.gps.onSite / e.gps.fixes) * 100) : null
    const shared = sharedWith(e)
    const { flags, findings } = flagsFor(e, elapsed, onSitePct, shared, policy)
    const row: TimeCardRow = {
      ...e,
      dayKey: dayKey(Date.parse(e.inAt), opts.tz),
      elapsedHours: elapsed,
      hours: paid,
      onSitePct,
      flags,
      findings,
      review: flags.some((f) => INTEGRITY_FLAGS.includes(f)),
      sharedWith: shared,
    }
    const p = byPerson.get(e.userId) ?? { name: e.personName || 'Crew', rows: [] }
    if (!p.name && e.personName) p.name = e.personName
    p.rows.push(row)
    byPerson.set(e.userId, p)
  }

  const cards: PersonCard[] = []
  for (const [userId, p] of Array.from(byPerson.entries())) {
    p.rows.sort((a, b) => Date.parse(a.inAt) - Date.parse(b.inAt))
    const dayMap = new Map<string, TimeCardRow[]>()
    for (const r of p.rows) (dayMap.get(r.dayKey) ?? dayMap.set(r.dayKey, []).get(r.dayKey)!).push(r)
    const days: DayCard[] = Array.from(dayMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, rows]) => ({ dayKey: k, entries: rows, hours: round2(rows.reduce((s, r) => s + r.hours, 0)) }))
    const hours = round2(days.reduce((s, d) => s + d.hours, 0))
    const regular = round2(Math.min(hours, otWeekly))
    const overtime = round2(Math.max(0, hours - otWeekly))
    let fixes = 0, onSite = 0
    const flags = emptyFlags()
    const siteMap = new Map<string, SiteHours>()
    for (const r of p.rows) {
      for (const f of r.flags) flags[f]++
      if (r.gps && r.zoneId && r.gps.fixes > 0) { fixes += r.gps.fixes; onSite += r.gps.onSite }
      const key = r.category === 'project' ? (r.zoneId ?? 'none') : `cat:${r.category}`
      const label = r.category === 'project' ? (r.zoneName ?? 'No site') : categoryLabel(r.category)
      const s = siteMap.get(key) ?? { zoneId: r.category === 'project' ? r.zoneId : null, label, hours: 0 }
      s.hours = round2(s.hours + r.hours)
      siteMap.set(key, s)
    }
    cards.push({
      userId,
      personName: p.name,
      days,
      hours, regular, overtime,
      openNow: p.rows.some((r) => !r.outAt),
      verifiedPct: fixes > 0 ? Math.round((onSite / fixes) * 100) : null,
      fixes: p.rows.reduce((s, r) => s + (r.gps?.fixes ?? 0), 0),
      flags,
      review: p.rows.filter((r) => r.review).length,
      sites: Array.from(siteMap.values()).sort((a, b) => b.hours - a.hours),
    })
  }
  cards.sort((a, b) => a.personName.localeCompare(b.personName))
  return cards
}

/** Company-wide totals for the header strip. `flagged` = entries on the "Needs a look" list. */
export function summarizeCards(cards: PersonCard[]): { people: number; hours: number; overtime: number; openNow: number; verifiedPct: number | null; flagged: number } {
  let fixes = 0, onSite = 0
  for (const c of cards) for (const d of c.days) for (const r of d.entries) if (r.gps && r.zoneId && r.gps.fixes > 0) { fixes += r.gps.fixes; onSite += r.gps.onSite }
  return {
    people: cards.length,
    hours: round2(cards.reduce((s, c) => s + c.hours, 0)),
    overtime: round2(cards.reduce((s, c) => s + c.overtime, 0)),
    openNow: cards.filter((c) => c.openNow).length,
    verifiedPct: fixes > 0 ? Math.round((onSite / fixes) * 100) : null,
    flagged: cards.reduce((s, c) => s + c.review, 0),
  }
}

export interface ReviewItem { row: TimeCardRow; personName: string; worst: TimeCardFlag }

/** The manager's list: every entry with an integrity flag, worst first, then
 *  newest first. One row per entry — its findings carry the sentences. */
export function reviewItems(cards: PersonCard[]): ReviewItem[] {
  const rank = (f: TimeCardFlag) => { const i = INTEGRITY_FLAGS.indexOf(f); return i < 0 ? INTEGRITY_FLAGS.length : i }
  const out: ReviewItem[] = []
  for (const c of cards) for (const d of c.days) for (const r of d.entries) {
    if (!r.review) continue
    const worst = r.flags.filter((f) => INTEGRITY_FLAGS.includes(f)).sort((a, b) => rank(a) - rank(b))[0]
    out.push({ row: r, personName: c.personName, worst })
  }
  out.sort((a, b) => rank(a.worst) - rank(b.worst) || Date.parse(b.row.inAt) - Date.parse(a.row.inAt))
  return out
}

// ── Weeks ────────────────────────────────────────────────────────────────────

/** Monday of the local week containing `ms`, as a day key. */
export function weekStartKey(ms: number, tz: string): string {
  const key = dayKey(ms, tz)
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(ms))
  const idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd)
  return addDaysKey(key, -(idx < 0 ? 0 : idx))
}

/** "Sep 7 – 13, 2026" for a Monday key. */
export function weekLabel(mondayKey: string): string {
  const [y, m, d] = mondayKey.split('-').map(Number)
  const a = new Date(Date.UTC(y, m - 1, d))
  const b = new Date(Date.UTC(y, m - 1, d + 6))
  const mo = (x: Date) => x.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' })
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${mo(a)} ${a.getUTCDate()} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`
    : `${mo(a)} ${a.getUTCDate()} – ${mo(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`
}

// ── CSV (payroll-ready) ─────────────────────────────────────────────────────

const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v)
  // Payroll opens this in Excel: a name or note starting with = + - @ or a
  // tab would run as a formula (sec-check, Sep 9). Every numeric column here
  // is non-negative, so prefixing an apostrophe collides with nothing.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per entry, hours to 2 decimals, times in the company's tz. */
export function timeCardsCsv(cards: PersonCard[], tz: string): string {
  const head = ['Person', 'Date', 'Clock in', 'Clock out', 'Break (min)', 'Paid hours', 'Category', 'Site',
    'Clocked in at', 'Clocked out at', 'GPS fixes', 'On-site %', 'Flags', 'Findings', 'Edited by', 'Edit note', 'Week regular hours', 'Week overtime hours', 'Entry id']
  const lines = [head.map(csvCell).join(',')]
  for (const c of cards) {
    for (const d of c.days) {
      for (const r of d.entries) {
        lines.push([
          c.personName,
          r.dayKey,
          fmtDateTime(Date.parse(r.inAt), tz),
          r.outAt ? fmtDateTime(Date.parse(r.outAt), tz) : '',
          r.breakMinutes,
          r.hours.toFixed(2),
          categoryLabel(r.category),
          r.category === 'project' ? (r.zoneName ?? '') : '',
          r.inPlace ?? '',
          r.outPlace ?? '',
          r.gps ? r.gps.fixes : '',
          r.onSitePct ?? '',
          r.flags.map((f) => FLAG_LABEL[f]).join('; '),
          r.findings.join('; '),
          r.edited?.by ?? '',
          r.edited?.note ?? '',
          c.regular.toFixed(2),
          c.overtime.toFixed(2),
          r.id,
        ].map(csvCell).join(','))
      }
    }
  }
  return lines.join('\r\n') + '\r\n'
}

/** "6:58 AM" in tz — re-exported so the view has one import. */
export const clockTime = (iso: string, tz: string) => fmtTime(Date.parse(iso), tz)
