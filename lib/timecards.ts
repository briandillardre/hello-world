/**
 * Time cards — the pure math behind /timecards, the CSV export and the AI
 * `time_cards` tool (Sep 9 2026; Brian: "clock in also a must and mandatory
 * tracking thru app while clocked in"; the bar is Workyard's "GPS-verified
 * time cards straight to payroll").
 *
 * Inputs are time_entries rows (015/059/103) plus, per entry, what the
 * person's phone reported between clock-in and clock-out (migration 103's
 * timecard_gps_stats). Outputs are per-person cards: days → entries with
 * paid hours, an on-site share and plain-word flags, weekly regular / OT
 * split at 40 h (FLSA; SC has no daily overtime), hours by site.
 *
 * No I/O here — lib/db/timecards.ts loads, this file computes, and the same
 * numbers reach the page, the export and the assistant.
 */
import { dayKey, fmtDateTime, fmtTime, addDaysKey } from './dates'

export type TimeCardFlag = 'open' | 'no_gps' | 'off_site' | 'long' | 'edited' | 'no_site'

export const FLAG_LABEL: Record<TimeCardFlag, string> = {
  open: 'Still clocked in',
  no_gps: 'No GPS',
  off_site: 'Mostly off-site',
  long: 'Long shift',
  edited: 'Edited',
  no_site: 'No job site',
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
  /** Phone fixes during the shift (103 RPC); null when the database cannot say yet. */
  gps: { fixes: number; onSite: number; firstFix: string | null; lastFix: string | null } | null
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
  sites: SiteHours[]
}

export const OT_WEEKLY_HOURS = 40
export const LONG_SHIFT_HOURS = 14
export const OFF_SITE_BELOW_PCT = 50
/** An entry nobody closed stops accruing here — the flag says "still clocked in". */
export const MAX_SHIFT_HOURS = 24

export const round2 = (n: number) => Math.round(n * 100) / 100

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

function flagsFor(e: TimeCardEntry, elapsed: number, onSitePct: number | null): TimeCardFlag[] {
  const out: TimeCardFlag[] = []
  if (!e.outAt) out.push('open')
  if (e.edited) out.push('edited')
  if (e.category === 'project' && !e.zoneId) out.push('no_site')
  if (elapsed > LONG_SHIFT_HOURS) out.push('long')
  if (e.gps) {
    // No evidence at all: nothing during the shift AND no clock-in fix. A
    // shift that just started gets 15 minutes before it counts as silent.
    const settled = !!e.outAt || elapsed >= 0.25
    if (e.gps.fixes === 0 && e.inLat == null && settled) out.push('no_gps')
    if (onSitePct != null && e.gps.fixes >= 5 && onSitePct < OFF_SITE_BELOW_PCT) out.push('off_site')
  }
  return out
}

function emptyFlags(): Record<TimeCardFlag, number> {
  return { open: 0, no_gps: 0, off_site: 0, long: 0, edited: 0, no_site: 0 }
}

/** Per-person cards for a set of entries (one week, one month — the caller
 *  picks the window; OT is split against `otWeekly` over the whole set, so
 *  hand it exactly one pay week for a payroll read). */
export function buildTimeCards(entries: TimeCardEntry[], opts: { tz: string; nowMs?: number; otWeekly?: number }): PersonCard[] {
  const nowMs = opts.nowMs ?? Date.now()
  const otWeekly = opts.otWeekly ?? OT_WEEKLY_HOURS
  const byPerson = new Map<string, { name: string; rows: TimeCardRow[] }>()
  for (const e of entries) {
    const { elapsed, paid } = shiftHours(e.inAt, e.outAt, e.breakMinutes, nowMs)
    const onSitePct = e.gps && e.gps.fixes > 0 && e.zoneId ? Math.round((e.gps.onSite / e.gps.fixes) * 100) : null
    const row: TimeCardRow = {
      ...e,
      dayKey: dayKey(Date.parse(e.inAt), opts.tz),
      elapsedHours: elapsed,
      hours: paid,
      onSitePct,
      flags: flagsFor(e, elapsed, onSitePct),
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
      const label = r.category === 'project' ? (r.zoneName ?? 'No job site') : categoryLabel(r.category)
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
      sites: Array.from(siteMap.values()).sort((a, b) => b.hours - a.hours),
    })
  }
  cards.sort((a, b) => a.personName.localeCompare(b.personName))
  return cards
}

/** Company-wide totals for the header strip. */
export function summarizeCards(cards: PersonCard[]): { people: number; hours: number; overtime: number; openNow: number; verifiedPct: number | null; flagged: number } {
  let fixes = 0, onSite = 0
  for (const c of cards) for (const d of c.days) for (const r of d.entries) if (r.gps && r.zoneId && r.gps.fixes > 0) { fixes += r.gps.fixes; onSite += r.gps.onSite }
  return {
    people: cards.length,
    hours: round2(cards.reduce((s, c) => s + c.hours, 0)),
    overtime: round2(cards.reduce((s, c) => s + c.overtime, 0)),
    openNow: cards.filter((c) => c.openNow).length,
    verifiedPct: fixes > 0 ? Math.round((onSite / fixes) * 100) : null,
    flagged: cards.reduce((s, c) => s + c.flags.no_gps + c.flags.off_site + c.flags.long + c.flags.no_site, 0),
  }
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
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per entry, hours to 2 decimals, times in the company's tz. */
export function timeCardsCsv(cards: PersonCard[], tz: string): string {
  const head = ['Person', 'Date', 'Clock in', 'Clock out', 'Break (min)', 'Paid hours', 'Category', 'Job site',
    'Clocked in at', 'Clocked out at', 'GPS fixes', 'On-site %', 'Flags', 'Edited by', 'Edit note', 'Week regular hours', 'Week overtime hours', 'Entry id']
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
