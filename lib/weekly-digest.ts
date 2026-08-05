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
  // Ahead (open / next 7 days)
  receiptsOutstanding: { count: number; total: number }
  openTasks: { title: string; zone: string; due: string | null; overdue: boolean }[]
  milestonesDue: { name: string; zone: string; date: string | null }[]
  maintenanceDue: string[]
  openAlerts: string[]
}

const wk = () => new Date(Date.now() - 7 * 86_400_000).toISOString()
const ahead = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

/** One bounded sweep that feeds BOTH digest flavors. Missing tables → zeros. */
export async function gatherWeeklyFacts(db: SupabaseClient, companyId: string, companyName: string): Promise<WeeklyFacts> {
  const g = async <T,>(q: PromiseLike<{ data: T | null }>): Promise<T | null> => {
    try { return (await q).data } catch { return null }
  }

  const [entries, logs, alertsWeek, zones, tasks, milestones, expenses, maint, assets, alertsOpen] = await Promise.all([
    g(db.from('time_entries').select('person_name, clock_in_at, clock_out_at').eq('company_id', companyId).gte('clock_in_at', wk()).limit(300)),
    g(db.from('daily_logs').select('id').eq('company_id', companyId).gte('created_at', wk()).limit(300)),
    g(db.from('alert_events').select('id').eq('company_id', companyId).gte('triggered_at', wk()).limit(200)),
    g(db.from('geofences').select('id, name, kind, completed_at').eq('company_id', companyId).is('owner_id', null)),
    g(db.from('project_tasks').select('title, status, due_date, done_at, geofence_id').eq('company_id', companyId).limit(400)),
    g(db.from('project_milestones').select('name, target_date, done_at, geofence_id').eq('company_id', companyId).is('done_at', null).limit(100)),
    g(db.from('expenses').select('amount').eq('company_id', companyId).eq('status', 'needs_receipt').limit(500)),
    g(db.from('maintenance_schedules').select('id, asset_id, next_due_at').eq('company_id', companyId).limit(200)),
    g(db.from('assets').select('id, name, type').eq('company_id', companyId)),
    g(db.from('alert_events').select('asset_id, rule:alert_rules(trigger)').eq('company_id', companyId).is('acknowledged_at', null).gte('triggered_at', wk()).limit(10)),
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
    alertsFired: (alertsWeek ?? []).length,
    tasksDone: (tasks ?? []).filter((t) => t.done_at && (t.done_at as string) >= wk()).length,
    activeZones: siteZones.map((z) => z.name as string).slice(0, 8),
    darkAssets,
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
    openAlerts: (alertsOpen ?? []).map((e) =>
      `${nameOf.get(e.asset_id as string) ?? 'Asset'} (${(((e.rule as { trigger?: string } | null)?.trigger) ?? 'alert').replace(/_/g, ' ')})`
    ).slice(0, 5),
  }
}

// ── Composition ────────────────────────────────────────────────────────────

export const day = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'no date'

export function shell(title: string, inner: string): string {
  return `
  <div style="background:#001523;padding:28px 14px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#00243d;border:1px solid #0e3a5c;border-radius:14px;padding:24px">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7fa3bd">${BRAND_NAME}</p>
      <h1 style="margin:0 0 16px;font-size:19px;color:#e8f0f7">${title}</h1>
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
  inner += h2('The week in hours')
  inner += f.hoursByPerson.length
    ? f.hoursByPerson.map(([n, h]) => li(`<b style="color:#e8f0f7">${n}</b> — ${h.toFixed(1)} h`)).join('')
    : none('No clocked hours this week.')
  inner += h2('Jobs & field')
  const jf: string[] = []
  if (f.activeZones.length) jf.push(li(`Active jobs: ${f.activeZones.join(', ')}`))
  if (f.logsFiled) jf.push(li(`${f.logsFiled} daily log${f.logsFiled === 1 ? '' : 's'} filed`))
  if (f.tasksDone) jf.push(li(`${f.tasksDone} punch item${f.tasksDone === 1 ? '' : 's'} completed`))
  if (f.alertsFired) jf.push(li(`${f.alertsFired} alert${f.alertsFired === 1 ? '' : 's'} fired`))
  inner += jf.length ? jf.join('') : none('Quiet week on the boards.')
  if (f.receiptsOutstanding.count || f.darkAssets.length) {
    inner += h2('Loose ends going into the weekend')
    if (f.receiptsOutstanding.count) inner += li(`<b style="color:#ff9e16">${f.receiptsOutstanding.count} receipt${f.receiptsOutstanding.count === 1 ? '' : 's'} still missing</b> ($${f.receiptsOutstanding.total.toFixed(2)})`)
    if (f.darkAssets.length) inner += li(`Not reporting: ${f.darkAssets.join(', ')} — check power/parking`)
  }
  return shell(`${f.company} — Friday wrap-up`, inner)
}

/** The Friday SMS — one message, the essentials only. */
export function fridaySms(f: WeeklyFacts): string {
  const hrs = f.hoursByPerson.reduce((s, [, h]) => s + h, 0)
  const bits = [`${f.company} week: ${hrs.toFixed(0)}h clocked`, `${f.logsFiled} logs`]
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
    inner += f.openAlerts.map((a) => li(`<b style="color:#f87171">${a}</b>`)).join('')
  }
  inner += h2('Punch list this week')
  inner += f.openTasks.length
    ? f.openTasks.map((t) => li(`${t.overdue ? '<b style="color:#f87171">OVERDUE</b> · ' : ''}${t.title}${t.zone ? ` <span style="color:#6f88a0">(${t.zone})</span>` : ''} — ${day(t.due)}`)).join('')
    : none('Punch lists are clear.')
  if (f.milestonesDue.length) {
    inner += h2('Milestones due')
    inner += f.milestonesDue.map((m) => li(`${m.name}${m.zone ? ` <span style="color:#6f88a0">(${m.zone})</span>` : ''} — ${day(m.date)}`)).join('')
  }
  if (f.maintenanceDue.length) {
    inner += h2('Maintenance due this week')
    inner += f.maintenanceDue.map((m) => li(m)).join('')
  }
  if (f.receiptsOutstanding.count) {
    inner += h2('Paper to chase')
    inner += li(`${f.receiptsOutstanding.count} receipt${f.receiptsOutstanding.count === 1 ? '' : 's'} outstanding ($${f.receiptsOutstanding.total.toFixed(2)})`)
  }
  if (!inner) inner = none('Clean slate — nothing queued for the week.')
  return shell(`${f.company} — the week ahead`, inner)
}
