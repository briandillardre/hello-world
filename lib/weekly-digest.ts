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
  tz: string
}

export const DIGEST_DEFAULTS: DigestPrefs = {
  friday: { enabled: true, email: true, sms: false, hour: 16 },
  sunday: { enabled: true, hour: 18 },
  briefing: { enabled: true, email: true, sms: false, hour: 6, weekdaysOnly: true },
  tz: 'America/New_York',
}

/** Merge a stored (possibly partial/null) prefs blob over the defaults. */
export function resolveDigestPrefs(raw: unknown): DigestPrefs {
  const p = (raw ?? {}) as Partial<DigestPrefs>
  return {
    friday: { ...DIGEST_DEFAULTS.friday, ...(p.friday ?? {}) },
    sunday: { ...DIGEST_DEFAULTS.sunday, ...(p.sunday ?? {}) },
    briefing: { ...DIGEST_DEFAULTS.briefing, ...(p.briefing ?? {}) },
    tz: typeof p.tz === 'string' && p.tz ? p.tz : DIGEST_DEFAULTS.tz,
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
    g(db.from('maintenance_schedules').select('id, asset_id, next_due_at').eq('company_id', companyId).limit(200)),
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
      .filter((m) => m.next_due_at && (m.next_due_at as string) <= new Date(Date.now() + 7 * 86_400_000).toISOString())
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

export function shell(title: string, inner: string): string {
  return `
  <div style="background:#001523;padding:28px 14px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#00243d;border:1px solid #0e3a5c;border-radius:14px;padding:24px">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7fa3bd">${BRAND_NAME}</p>
      <h1 style="margin:0 0 16px;font-size:19px;color:#e8f0f7">${esc(title)}</h1>
      ${inner}
      <p style="margin:20px 0 0;font-size:12px"><a href="${BRAND_URL}/command" style="color:#ff9e16;font-weight:700;text-decoration:none">Open the Command Center →</a></p>
      <p style="margin:14px 0 0;font-size:10.5px;color:#7fa3bd">Change the day, time, or channel any time in Settings → Weekly summaries.</p>
    </div>
  </div>`
}

export const h2 = (t: string) => `<p style="margin:16px 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#7fa3bd;font-weight:700">${t}</p>`
export const li = (t: string) => `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:#b8cadb">• ${t}</p>`
export const none = (t: string) => `<p style="margin:0;font-size:13px;color:#6f88a0">${t}</p>`

/** Friday afternoon — the week that just happened. */
export function fridayEmailHtml(f: WeeklyFacts): string {
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
  return shell(`${f.company} — Friday wrap-up`, inner)
}

/** The Friday SMS — one message, the essentials only. */
export function fridaySms(f: WeeklyFacts): string {
  const hrs = f.hoursByPerson.reduce((s, [, h]) => s + h, 0)
  const bits = [`${f.company} week: ${hrs.toFixed(0)}h clocked`, `${f.logsFiled} logs`]
  if (f.siteActivity.length) bits.push(`busiest site ${f.siteActivity[0].zone} (${f.siteActivity[0].totalH.toFixed(0)}h)`)
  if (f.tasksDone) bits.push(`${f.tasksDone} punch items done`)
  if (f.alertsFired) bits.push(`${f.alertsFired} alerts`)
  if (f.receiptsOutstanding.count) bits.push(`${f.receiptsOutstanding.count} receipts missing ($${f.receiptsOutstanding.total.toFixed(0)})`)
  return `${bits.join(' · ')}. Full picture: ${BRAND_URL}/reports`
}

/** Sunday evening — what needs to happen this week. */
export function sundayEmailHtml(f: WeeklyFacts): string {
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
  return shell(`${f.company} — the week ahead`, inner)
}
