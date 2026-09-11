/**
 * Weekly owner digests — the Friday recap ("what happened") and the Sunday
 * week-ahead ("what needs to happen"). Fact-gathering + composition live
 * here; /api/cron/weekly does the scheduling and delivery.
 *
 * Facts only from the database — nothing invented. Every query is bounded
 * and tolerant of tables a customer's migration level may not have yet.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BRAND_NAME, BRAND_URL } from './brand'
import { escapeHtml } from './email'
import { isZoneLogEvent } from './alerts-engine'

// Free-text from the DB (asset/zone/person/task names) is user-editable —
// escape EVERYTHING interpolated into email HTML (sec-check, Aug 22: a
// crafted asset name must never land as live markup in the owner's inbox).
const esc = escapeHtml

// ── Preferences ────────────────────────────────────────────────────────────

export interface DigestPrefs {
  friday: { enabled: boolean; email: boolean; sms: boolean; hour: number }
  sunday: { enabled: boolean; hour: number }
  /** Daily site briefing (054) — weekday mornings; weekends optional. */
  briefing: { enabled: boolean; email: boolean; sms: boolean; hour: number; weekdaysOnly: boolean }
  /** Evening digest — the day's wrap. Had NO prefs at all until Sep 11:
   *  the cron pushed every company's day to one global webhook. */
  evening: { enabled: boolean; email: boolean; sms: boolean; push: boolean; hour: number }
  /** Monday agenda — last week's anomalies as this week's to-do list. */
  monday: { enabled: boolean; email: boolean; sms: boolean; push: boolean; hour: number }
  /** The still-on-the-clock nudge. Off by default: it is the least
   *  actionable message we send and the fastest way to train someone to
   *  swipe our notifications away. */
  nag: { enabled: boolean; push: boolean; hour: number }
  tz: string
}

export const DIGEST_DEFAULTS: DigestPrefs = {
  friday: { enabled: true, email: true, sms: false, hour: 16 },
  sunday: { enabled: true, hour: 18 },
  briefing: { enabled: true, email: true, sms: false, hour: 6, weekdaysOnly: true },
  // Push only. A daily recap does not deserve an inbox slot or a text
  // unless the owner asks for one (Brian, Sep 11: "cut down on clients
  // feeling too spammed").
  evening: { enabled: true, email: false, sms: false, push: true, hour: 18 },
  monday: { enabled: true, email: false, sms: false, push: true, hour: 7 },
  nag: { enabled: false, push: true, hour: 19 },
  tz: 'America/New_York',
}

/** Merge a stored (possibly partial/null) prefs blob over the defaults. */
export function resolveDigestPrefs(raw: unknown): DigestPrefs {
  const p = (raw ?? {}) as Partial<DigestPrefs>
  return {
    friday: { ...DIGEST_DEFAULTS.friday, ...(p.friday ?? {}) },
    sunday: { ...DIGEST_DEFAULTS.sunday, ...(p.sunday ?? {}) },
    briefing: { ...DIGEST_DEFAULTS.briefing, ...(p.briefing ?? {}) },
    evening: { ...DIGEST_DEFAULTS.evening, ...(p.evening ?? {}) },
    monday: { ...DIGEST_DEFAULTS.monday, ...(p.monday ?? {}) },
    nag: { ...DIGEST_DEFAULTS.nag, ...(p.nag ?? {}) },
    tz: typeof p.tz === 'string' && p.tz ? p.tz : DIGEST_DEFAULTS.tz,
  }
}

/**
 * Sanitize a full prefs blob. EVERY key is written back: the old version
 * rebuilt `clean` from friday/sunday/tz alone, so the morning briefing —
 * and anything added after it — was silently reset to its default the next
 * time anyone touched any other toggle. A customer who turned the 6 AM
 * briefing off got it back the moment they changed their timezone
 * (Brian, Sep 11: "cut down on clients feeling too spammed").
 */
export function cleanDigestPrefs(prefs: DigestPrefs): DigestPrefs {
  const p = resolveDigestPrefs(prefs)
  const hour = (h: number, fallback: number) => Number.isInteger(h) && h >= 0 && h <= 23 ? h : fallback
  return {
    friday: { enabled: !!p.friday.enabled, email: !!p.friday.email, sms: !!p.friday.sms, hour: hour(p.friday.hour, 16) },
    sunday: { enabled: !!p.sunday.enabled, hour: hour(p.sunday.hour, 18) },
    briefing: { enabled: !!p.briefing.enabled, email: !!p.briefing.email, sms: !!p.briefing.sms, hour: hour(p.briefing.hour, 6), weekdaysOnly: !!p.briefing.weekdaysOnly },
    evening: { enabled: !!p.evening.enabled, email: !!p.evening.email, sms: !!p.evening.sms, push: !!p.evening.push, hour: hour(p.evening.hour, 18) },
    monday: { enabled: !!p.monday.enabled, email: !!p.monday.email, sms: !!p.monday.sms, push: !!p.monday.push, hour: hour(p.monday.hour, 7) },
    nag: { enabled: !!p.nag.enabled, push: !!p.nag.push, hour: hour(p.nag.hour, 19) },
    // Real-IANA check, not just shape: "America/Greenville" passes the regex
    // but throws in Intl at digest time (ship-check) — reject it at save.
    tz: (() => {
      if (typeof p.tz !== 'string' || !/^[A-Za-z_]+\/[A-Za-z_+-]+$/.test(p.tz)) return 'America/New_York'
      try { new Intl.DateTimeFormat('en-US', { timeZone: p.tz }); return p.tz } catch { return 'America/New_York' }
    })(),
  }
}

/** True when every recurring summary is switched off — what the "Turn
 *  everything off" button on the unsubscribe page leaves behind. */
export function allDigestsOff(p: DigestPrefs): boolean {
  return !p.friday.enabled && !p.sunday.enabled && !p.briefing.enabled && !p.evening.enabled && !p.monday.enabled && !p.nag.enabled
}

/** Same shape, everything silenced. Alerts (theft, left-site) are NOT in
 *  here — those are safety, not summaries, and have their own switches. */
export function silenceAll(p: DigestPrefs): DigestPrefs {
  return {
    friday: { ...p.friday, enabled: false },
    sunday: { ...p.sunday, enabled: false },
    briefing: { ...p.briefing, enabled: false },
    evening: { ...p.evening, enabled: false },
    monday: { ...p.monday, enabled: false },
    nag: { ...p.nag, enabled: false },
    tz: p.tz,
  }
}

/** Local weekday (0=Sun…6=Sat) and hour for a tz — the cron's send gate. */
export function localNow(tz: string): { day: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date())
    const wd = parts.find((x) => x.type === 'weekday')?.value ?? 'Mon'
    const hour = Number(parts.find((x) => x.type === 'hour')?.value ?? '0') % 24
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
    return { day: day < 0 ? 1 : day, hour }
  } catch {
    return { day: new Date().getUTCDay(), hour: new Date().getUTCHours() }
  }
}

// ── Facts ──────────────────────────────────────────────────────────────────

export interface WeeklyFacts {
  company: string
  // Recap (last 7 days)
  hoursByPerson: [string, number][]
  logsFiled: number
  alertsFired: number
  tasksDone: number
  activeZones: string[]
  darkAssets: string[]
  /** Per-site "who was where" from the exact visit ledger (zone_sessions):
   *  busiest sites first, each with per-asset hours + days-on-site lines. */
  siteActivity: { zone: string; totalH: number; lines: string[] }[]
  // Ahead (open / next 7 days)
  receiptsOutstanding: { count: number; total: number }
  openTasks: { title: string; zone: string; due: string | null; overdue: boolean }[]
  milestonesDue: { name: string; zone: string; date: string | null }[]
  maintenanceDue: string[]
  openAlerts: string[]
  /** Insight-engine headlines (≤3) — the trends worth opening the email with. */
  noticed: string[]
}

const wk = () => new Date(Date.now() - 7 * 86_400_000).toISOString()
const ahead = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

/** One bounded sweep that feeds BOTH digest flavors. Missing tables → zeros. */
export async function gatherWeeklyFacts(db: SupabaseClient, companyId: string, companyName: string, tz = 'America/New_York'): Promise<WeeklyFacts> {
  const g = async <T,>(q: PromiseLike<{ data: T | null }>): Promise<T | null> => {
    try { return (await q).data } catch { return null }
  }

  const [entries, logs, alertsWeek, zones, tasks, milestones, expenses, maint, assets, alertsOpen, sessions] = await Promise.all([
    g(db.from('time_entries').select('person_name, clock_in_at, clock_out_at').eq('company_id', companyId).gte('clock_in_at', wk()).limit(300)),
    g(db.from('daily_logs').select('id').eq('company_id', companyId).gte('created_at', wk()).limit(300)),
    g(db.from('alert_events').select('kind, rule:alert_rules(trigger)').eq('company_id', companyId).gte('triggered_at', wk()).limit(200)),
    g(db.from('geofences').select('id, name, kind, completed_at').eq('company_id', companyId).is('owner_id', null)),
    g(db.from('project_tasks').select('title, status, due_date, done_at, geofence_id').eq('company_id', companyId).limit(400)),
    g(db.from('project_milestones').select('name, target_date, done_at, geofence_id').eq('company_id', companyId).is('done_at', null).limit(100)),
    g(db.from('expenses').select('amount').eq('company_id', companyId).eq('status', 'needs_receipt').limit(500)),
    // No next_due_at column exists — due-ness is derived from the interval
    // (day-interval schedules only, without live meter readings).
    g(db.from('maintenance_schedules').select('id, asset_id, interval_type, interval_value, last_service_date').eq('company_id', companyId).limit(200)),
    g(db.from('assets').select('id, name, type').eq('company_id', companyId)),
    g(db.from('alert_events').select('asset_id, kind, rule:alert_rules(trigger)').eq('company_id', companyId).is('acknowledged_at', null).gte('triggered_at', wk()).limit(50)),
    // The exact visit ledger (056) — pre-aggregated, so a week is cheap.
    g(db.from('zone_sessions').select('geofence_id, asset_id, entered_at, exited_at').eq('company_id', companyId).gte('entered_at', wk()).limit(2000)),
  ])

  const nameOf = new Map((assets ?? []).map((a) => [a.id as string, a.name as string]))
  const zoneName = new Map((zones ?? []).map((z) => [z.id as string, z.name as string]))
  const siteZones = (zones ?? []).filter((z) => (z.kind ?? 'site') === 'site' && !z.completed_at)

  const hoursByPerson: Record<string, number> = {}
  for (const e of entries ?? []) {
    const end = e.clock_out_at ? Date.parse(e.clock_out_at) : Date.parse(e.clock_in_at)
    const h = Math.max(0, (end - Date.parse(e.clock_in_at)) / 3_600_000)
    hoursByPerson[e.person_name] = (hoursByPerson[e.person_name] ?? 0) + h
  }

  // Dark assets: trackable but silent 48h+ (only for assets with any history).
  let darkAssets: string[] = []
  const trackable = (assets ?? []).filter((a) => a.type === 'vehicle' || a.type === 'equipment')
  if (trackable.length) {
    const locs = await g(db.from('asset_locations').select('asset_id, timestamp').eq('company_id', companyId)
      .gte('timestamp', wk()).order('timestamp', { ascending: false }).limit(3000))
    const newest = new Map<string, number>()
    for (const r of locs ?? []) if (!newest.has(r.asset_id)) newest.set(r.asset_id, Date.parse(r.timestamp))
    darkAssets = trackable
      .filter((a) => newest.has(a.id) && (newest.get(a.id) ?? 0) < Date.now() - 48 * 3_600_000)
      .map((a) => a.name as string).slice(0, 5)
  }

  // Who was where: per site zone, per asset — hours + distinct local days
  // (the ledger's sessions, same numbers as the zone pages and invoices).
  // Guarded tz: one bad stored timezone must never 500 the whole cron run
  // and starve every OTHER company's digest (ship-check).
  let dayFmt: Intl.DateTimeFormat
  try {
    dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  }
  const siteIds = new Set(siteZones.map((z) => z.id as string))
  const byZone = new Map<string, Map<string, { ms: number; days: Set<string> }>>()
  const now = Date.now()
  for (const s of sessions ?? []) {
    if (!siteIds.has(s.geofence_id as string)) continue
    const enter = Date.parse(s.entered_at as string)
    const exit = Math.min(Date.parse(s.exited_at as string) || now, now)
    if (!Number.isFinite(enter) || exit <= enter) continue
    let zoneMap = byZone.get(s.geofence_id as string)
    if (!zoneMap) byZone.set(s.geofence_id as string, (zoneMap = new Map()))
    let agg = zoneMap.get(s.asset_id as string)
    if (!agg) zoneMap.set(s.asset_id as string, (agg = { ms: 0, days: new Set() }))
    agg.ms += exit - enter
    // A session spanning nights counts EVERY local day it touched — parked
    // on site all week is "5 days", not "1 day" (ship-check).
    for (let d = enter; d <= exit; d += 86_400_000) agg.days.add(dayFmt.format(new Date(d)))
    agg.days.add(dayFmt.format(new Date(exit)))
  }
  const siteActivity = Array.from(byZone.entries())
    .map(([zoneId, zoneMap]) => {
      const rows = Array.from(zoneMap.entries())
        .map(([assetId, a]) => ({ name: nameOf.get(assetId) ?? 'Asset', h: a.ms / 3_600_000, d: a.days.size }))
        .filter((r) => r.h >= 0.25)
        .sort((a, b) => b.h - a.h)
      return {
        zone: zoneName.get(zoneId) ?? 'Site',
        totalH: rows.reduce((s, r) => s + r.h, 0),
        lines: rows.slice(0, 5).map((r) => `<b style="color:#e8f0f7">${esc(r.name)}</b> — ${r.h.toFixed(1)} h over ${r.d} day${r.d === 1 ? '' : 's'}`)
          .concat(rows.length > 5 ? [`+ ${rows.length - 5} more`] : []),
      }
    })
    .filter((z) => z.lines.length)
    .sort((a, b) => b.totalH - a.totalH)
    .slice(0, 5)

  const today = new Date().toISOString().slice(0, 10)
  const openTasks = (tasks ?? []).filter((t) => t.status === 'open')
    .map((t) => ({
      title: t.title as string,
      zone: zoneName.get(t.geofence_id as string) ?? '',
      due: (t.due_date as string | null) ?? null,
      overdue: !!t.due_date && (t.due_date as string) < today,
    }))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .slice(0, 12)

  return {
    company: companyName,
    hoursByPerson: Object.entries(hoursByPerson).sort((a, b) => b[1] - a[1]).slice(0, 10),
    logsFiled: (logs ?? []).length,
    // Zone-log crossings excluded — "62 alerts fired" out of routine
    // enter/exits would cry wolf in the owner's weekly email.
    alertsFired: (alertsWeek ?? []).filter((e) => !isZoneLogEvent(e as { kind?: string | null; rule?: { trigger?: string | null } | null })).length,
    tasksDone: (tasks ?? []).filter((t) => t.done_at && (t.done_at as string) >= wk()).length,
    activeZones: siteZones.map((z) => z.name as string).slice(0, 8),
    darkAssets,
    siteActivity,
    receiptsOutstanding: {
      count: (expenses ?? []).length,
      total: (expenses ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0),
    },
    openTasks,
    milestonesDue: (milestones ?? [])
      .filter((m) => !m.target_date || (m.target_date as string) <= ahead())
      .map((m) => ({ name: m.name as string, zone: zoneName.get(m.geofence_id as string) ?? '', date: (m.target_date as string | null) ?? null }))
      .slice(0, 8),
    maintenanceDue: (maint ?? [])
      // Due inside the next 7 days: days since last service ≥ interval − 7.
      .filter((m) => m.interval_type === 'days' && m.last_service_date && Number(m.interval_value) > 0 &&
        (Date.now() - Date.parse(m.last_service_date as string)) / 86_400_000 >= Number(m.interval_value) - 7)
      .map((m) => nameOf.get(m.asset_id as string) ?? 'Asset').slice(0, 6),
    openAlerts: (alertsOpen ?? [])
      .filter((e) => !isZoneLogEvent(e as { kind?: string | null; rule?: { trigger?: string | null } | null }))
      .map((e) =>
        `${nameOf.get(e.asset_id as string) ?? 'Asset'} (${(((e.rule as { trigger?: string } | null)?.trigger) ?? 'alert').replace(/_/g, ' ')})`
      ).slice(0, 5),
    noticed: await (async () => {
      try {
        const { getInsightHeadlines } = await import('./insights')
        return await getInsightHeadlines(db, companyId, 3)
      } catch { return [] }
    })(),
  }
}

// ── Composition ────────────────────────────────────────────────────────────

export const day = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'no date'

export function shell(title: string, inner: string, manageUrl?: string | null): string {
  // Every recurring email carries a one-tap way out. No login, works from a
  // phone (Brian, Sep 11) — and a live unsubscribe link is also what keeps
  // us out of spam folders. Falls back to the in-app path when the app has
  // no signing secret to mint a token with.
  const footer = manageUrl
    ? `<p style="margin:14px 0 0;font-size:11px;color:#7fa3bd">Too many emails? <a href="${manageUrl}" style="color:#b8cadb;text-decoration:underline">Turn these off or change when they arrive →</a></p>`
    : `<p style="margin:14px 0 0;font-size:10.5px;color:#7fa3bd">Change the day, time, or channel any time in Settings → Notifications.</p>`
  return `
  <div style="background:#001523;padding:28px 14px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#00243d;border:1px solid #0e3a5c;border-radius:14px;padding:24px">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7fa3bd">${BRAND_NAME}</p>
      <h1 style="margin:0 0 16px;font-size:19px;color:#e8f0f7">${esc(title)}</h1>
      ${inner}
      <p style="margin:20px 0 0;font-size:12px"><a href="${BRAND_URL}/command" style="color:#ff9e16;font-weight:700;text-decoration:none">Open the Command Center →</a></p>
      ${footer}
    </div>
  </div>`
}

/** The one line every recurring TEXT ends with. Kept short — an SMS that
 *  runs past 160 chars bills as two and reads as spam. */
export function smsOptOut(manageUrl?: string | null): string {
  return manageUrl ? ` Stop/change these: ${manageUrl}` : ''
}

export const h2 = (t: string) => `<p style="margin:16px 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#7fa3bd;font-weight:700">${t}</p>`
export const li = (t: string) => `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:#b8cadb">• ${t}</p>`
export const none = (t: string) => `<p style="margin:0;font-size:13px;color:#6f88a0">${t}</p>`

/**
 * The evening digest / Monday agenda body: AI-composed prose, one paragraph
 * per line, in the same shell as every other summary so the manage link and
 * the branding are identical wherever a customer meets us.
 */
export function proseEmailHtml(title: string, text: string, manageUrl?: string | null): string {
  const inner = text.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => `<p style="margin:0 0 10px;font-size:13.5px;line-height:1.6;color:#b8cadb">${esc(l)}</p>`)
    .join('')
  return shell(title, inner || none('All quiet.'), manageUrl)
}

/** Has this daily summary already gone out for the company's local day?
 *  The crons run hourly (a per-company hour needs it), so without this a
 *  clock change or a manual poke sends the same digest twice. */
export function sentSameLocalDay(stamp: string | null | undefined, tz: string): boolean {
  if (!stamp) return false
  const ms = Date.parse(stamp)
  if (!Number.isFinite(ms)) return false
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    return fmt.format(new Date(ms)) === fmt.format(new Date())
  } catch {
    return Date.now() - ms < 20 * 3_600_000
  }
}

/**
 * Is a daily/weekly summary due for this company right now?
 *
 * True at its local hour AND for a few hours after, because an exact-hour
 * match is brittle: an hourly cron that ran long, a batch that hit its
 * per-run cap, or a cold start on the wrong side of the minute would drop
 * that company's send for the whole day with no retry. The same-local-day
 * stamp is what keeps the grace window from sending twice.
 *
 * `weekday` (0=Sun…6=Sat) pins a weekly summary to its own local day — a
 * fixed UTC Monday is Sunday evening for a third of the country.
 */
export function dueNow(opts: {
  hour: number
  tz: string
  stamp?: string | null
  weekday?: number
  graceHours?: number
}): boolean {
  const { day, hour } = localNow(opts.tz)
  if (opts.weekday !== undefined && day !== opts.weekday) return false
  const grace = opts.graceHours ?? 3
  if (hour < opts.hour || hour > opts.hour + grace) return false
  return !sentSameLocalDay(opts.stamp, opts.tz)
}

/** Friday afternoon — the week that just happened. */
export function fridayEmailHtml(f: WeeklyFacts, manageUrl?: string | null): string {
  let inner = ''
  if (f.noticed.length) {
    inner += h2('Noticed this week')
    for (const n of f.noticed) inner += li(`✨ ${esc(n)}`)
  }
  inner += h2('The week in hours')
  inner += f.hoursByPerson.length
    ? f.hoursByPerson.map(([n, h]) => li(`<b style="color:#e8f0f7">${esc(n)}</b> — ${h.toFixed(1)} h`)).join('')
    : none('No clocked hours this week.')
  if (f.siteActivity.length) {
    inner += h2('Who was where')
    for (const z of f.siteActivity) {
      inner += li(`<b style="color:#e8f0f7">${esc(z.zone)}</b> — ${z.totalH.toFixed(1)} h tracked on site`)
      inner += z.lines.map((l) => `<p style="margin:0 0 4px 16px;font-size:12.5px;line-height:1.5;color:#9fb6cc">${l}</p>`).join('')
    }
  }
  inner += h2('Jobs & field')
  const jf: string[] = []
  if (f.activeZones.length) jf.push(li(`Active jobs: ${esc(f.activeZones.join(', '))}`))
  if (f.logsFiled) jf.push(li(`${f.logsFiled} daily log${f.logsFiled === 1 ? '' : 's'} filed`))
  if (f.tasksDone) jf.push(li(`${f.tasksDone} punch item${f.tasksDone === 1 ? '' : 's'} completed`))
  if (f.alertsFired) jf.push(li(`${f.alertsFired} alert${f.alertsFired === 1 ? '' : 's'} fired`))
  inner += jf.length ? jf.join('') : none('Quiet week on the boards.')
  if (f.receiptsOutstanding.count || f.darkAssets.length) {
    inner += h2('Loose ends going into the weekend')
    if (f.receiptsOutstanding.count) inner += li(`<b style="color:#ff9e16">${f.receiptsOutstanding.count} receipt${f.receiptsOutstanding.count === 1 ? '' : 's'} still missing</b> ($${f.receiptsOutstanding.total.toFixed(2)})`)
    if (f.darkAssets.length) inner += li(`Not reporting: ${esc(f.darkAssets.join(', '))} — check power/parking`)
  }
  return shell(`${f.company} — Friday wrap-up`, inner, manageUrl)
}

/** The Friday SMS — one message, the essentials only. */
export function fridaySms(f: WeeklyFacts, manageUrl?: string | null): string {
  const hrs = f.hoursByPerson.reduce((s, [, h]) => s + h, 0)
  const bits = [`${f.company} week: ${hrs.toFixed(0)}h clocked`, `${f.logsFiled} logs`]
  if (f.siteActivity.length) bits.push(`busiest site ${f.siteActivity[0].zone} (${f.siteActivity[0].totalH.toFixed(0)}h)`)
  if (f.tasksDone) bits.push(`${f.tasksDone} punch items done`)
  if (f.alertsFired) bits.push(`${f.alertsFired} alerts`)
  if (f.receiptsOutstanding.count) bits.push(`${f.receiptsOutstanding.count} receipts missing ($${f.receiptsOutstanding.total.toFixed(0)})`)
  return `${bits.join(' · ')}. Full picture: ${BRAND_URL}/reports${smsOptOut(manageUrl)}`
}

/** Sunday evening — what needs to happen this week. */
export function sundayEmailHtml(f: WeeklyFacts, manageUrl?: string | null): string {
  let inner = ''
  if (f.openAlerts.length) {
    inner += h2('Deal with first')
    inner += f.openAlerts.map((a) => li(`<b style="color:#f87171">${esc(a)}</b>`)).join('')
  }
  if (f.noticed.length) {
    inner += h2('Worth a look this week')
    for (const n of f.noticed) inner += li(`✨ ${esc(n)}`)
  }
  inner += h2('Punch list this week')
  inner += f.openTasks.length
    ? f.openTasks.map((t) => li(`${t.overdue ? '<b style="color:#f87171">OVERDUE</b> · ' : ''}${esc(t.title)}${t.zone ? ` <span style="color:#6f88a0">(${esc(t.zone)})</span>` : ''} — ${day(t.due)}`)).join('')
    : none('Punch lists are clear.')
  if (f.milestonesDue.length) {
    inner += h2('Milestones due')
    inner += f.milestonesDue.map((m) => li(`${esc(m.name)}${m.zone ? ` <span style="color:#6f88a0">(${esc(m.zone)})</span>` : ''} — ${day(m.date)}`)).join('')
  }
  if (f.maintenanceDue.length) {
    inner += h2('Maintenance due this week')
    inner += f.maintenanceDue.map((m) => li(esc(m))).join('')
  }
  if (f.receiptsOutstanding.count) {
    inner += h2('Paper to chase')
    inner += li(`${f.receiptsOutstanding.count} receipt${f.receiptsOutstanding.count === 1 ? '' : 's'} outstanding ($${f.receiptsOutstanding.total.toFixed(2)})`)
  }
  if (!inner) inner = none('Clean slate — nothing queued for the week.')
  return shell(`${f.company} — the week ahead`, inner, manageUrl)
}
