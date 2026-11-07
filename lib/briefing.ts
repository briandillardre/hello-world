/**
 * Daily site briefing — the ForeFlight "pre-flight briefing" idea, translated
 * to dirt. One email/text per company on workday mornings:
 *   • today's weather at each active job site (Open-Meteo, free/keyless)
 *   • yesterday on each site: tracked hours + cost, who/what was there
 *   • due today: punch items (overdue flagged), milestones this week
 *   • broken things: silent hardware trackers, overdue service, open WOs
 *
 * Facts only from the database + one weather call per zone — nothing
 * invented. Missing tables (older migration levels) degrade to empty
 * sections, never errors. /api/cron/briefing schedules + delivers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BRAND_URL } from './brand'
import { shell, smsOptOut, h2, li, none, day } from './weekly-digest'
import { escapeHtml } from './email'
import { zoneAssetUsage, type HistoryPoint } from './costs'
import { rangeWindow } from './dates'
import { isZoneLogEvent } from './alerts-engine'
import { isScoredAsset } from './db/driving'

export interface SiteBrief {
  zone: string
  weather: string | null            // "72–91°F · 40% rain · gusts 22 mph"
  yesterdayHours: number            // active machine-hours on site
  yesterdayCost: number
  onSite: string[]                  // asset names seen there yesterday
  dueToday: { title: string; overdue: boolean }[]
  milestonesSoon: { name: string; date: string | null }[]
}

export interface TruckBrief {
  name: string
  milesYesterday: number
  /** Where its newest fix sits: a zone name, or null when off every zone. */
  at: string | null
  /** Hours since its newest fix — dark past 24. */
  silentH: number | null
  checkEngine: number
  /** False for a battery unit: it fixes every few minutes and can't see a
   *  drive, so it has no driving_daily row — 0 there means "unknown", not
   *  "parked" (ship-check, Nov 7). */
  milesKnown: boolean
}

export interface BriefingFacts {
  company: string
  dateLabel: string                 // "Tue, Aug 5"
  sites: SiteBrief[]
  silentUnits: string[]             // hardware trackers dark >6h
  maintenanceOverdue: string[]
  openWorkOrders: number
  alertsYesterday: number
  /** Insight-engine headlines (≤3) — trends the morning read should open with. */
  noticed: string[]
  /** One line per road vehicle with a hardware tracker (Nov 6 — Brian:
   *  "needs to be a daily helper and help run a business"; Craig's only
   *  questions were miles per truck). Newest-first by miles. */
  trucks: TruckBrief[]
}

/** Today's essentials at a point — Open-Meteo, free + keyless, ~200ms. */
async function forecastAt(lat: number, lng: number): Promise<string | null> {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=auto'
    const r = await fetch(u, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const d = (await r.json())?.daily
    const hi = Math.round(d?.temperature_2m_max?.[0]), lo = Math.round(d?.temperature_2m_min?.[0])
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null
    const rain = Math.round(d?.precipitation_probability_max?.[0] ?? 0)
    const gust = Math.round(d?.wind_gusts_10m_max?.[0] ?? 0)
    const bits = [`${lo}–${hi}°F`]
    if (rain >= 20) bits.push(`${rain}% rain`)
    if (gust >= 20) bits.push(`gusts ${gust} mph`)
    return bits.join(' · ')
  } catch {
    return null
  }
}

/**
 * WHO the briefing is for (sec-check, Nov 7, on #226). The briefing used to
 * go only to the company's own alert inbox — the owner's channel — so it was
 * built from everything. Since Nov 6 it also goes to each Admin and Manager,
 * and one company-wide copy carried assets above their rank (the owner's
 * phone and battery units, `metadata.visibility`, migration 111) and dollars
 * to people whose `costs` view level is off. Every copy is now shaped for its
 * reader: the same raw load, filtered per audience.
 */
export interface BriefingAudience {
  /** The visibility ladder (111) for this reader — `canSeeAsset`. */
  seesAsset: (a: { metadata?: unknown; type?: string | null }) => boolean
  /** Dollars on the page: the `costs` view level. */
  money: boolean
  /** The reader's view levels — sections for pages they can't open are left
   *  out (alerts, maintenance). Absent = everything (the office copy). */
  features?: ReadonlySet<string>
}

/** The company's own alert inbox / phone: the owner's channel, as before. */
export const OFFICE_AUDIENCE: BriefingAudience = { seesAsset: () => true, money: true }

type ZoneRow = { id: string; name: string; kind?: string | null; completed_at?: string | null; geometry?: { coordinates?: [number, number][][] } }
type AssetRow = { id: string; name: string; type?: string | null; tracker_id?: string | null; metadata?: unknown }
type TruckRaw = { asset: TruckAsset; miles: number; at: string | null; fixMs: number | null; checkEngine: number; scored: boolean }

/** Everything the briefing reads, once per company — no audience applied. */
export interface BriefingRaw {
  dateLabel: string
  yesterday: { from: number; to: number }
  today: string
  weekOut: string
  zones: ZoneRow[]
  assets: AssetRow[]
  tasks: { title: string; status: string; due_date: string | null; geofence_id: string | null }[]
  milestones: { name: string; target_date: string | null; geofence_id: string | null }[]
  maint: { asset_id: string; description: string; interval_type: string; interval_value: number; last_service_date: string | null }[]
  wos: { status: string; asset_id: string | null }[]
  alerts: { asset_id: string | null; kind?: string | null; rule?: { trigger?: string | null } | null }[]
  rows: HistoryPoint[]
  trucks: TruckRaw[]
  insights: import('./insights').InsightRow[]
  /** Today's forecast per site zone — fetched at most once per zone. */
  weather: (zone: ZoneRow) => Promise<string | null>
}

export async function loadBriefing(db: SupabaseClient, companyId: string, tz: string): Promise<BriefingRaw> {
  const g = async <T,>(q: PromiseLike<{ data: T | null }>): Promise<T | null> => {
    try { return (await q).data } catch { return null }
  }

  const yesterday = rangeWindow(tz, 'yesterday', {})
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()) // YYYY-MM-DD local
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

  const [zones, assets, tasks, milestones, maint, wos, alertsYest] = await Promise.all([
    g(db.from('geofences_json').select('*').eq('company_id', companyId).is('owner_id', null)),
    g(db.from('assets').select('*').eq('company_id', companyId).eq('active', true)),
    g(db.from('project_tasks').select('title, status, due_date, geofence_id').eq('company_id', companyId).eq('status', 'open').limit(300)),
    g(db.from('project_milestones').select('name, target_date, done_at, geofence_id').eq('company_id', companyId).is('done_at', null).limit(100)),
    // Overdue is DERIVED (computeStatus) — there is no next_due_at column;
    // the old select 400'd and this list has been silently empty. Without
    // live meter readings only day-interval schedules are decidable here.
    g(db.from('maintenance_schedules').select('asset_id, description, interval_type, interval_value, last_service_date').eq('company_id', companyId).limit(200)),
    g(db.from('work_orders').select('id, status, asset_id').eq('company_id', companyId).limit(200)),
    g(db.from('alert_events').select('id, asset_id, kind, rule:alert_rules(trigger)').eq('company_id', companyId)
      .gte('triggered_at', new Date(yesterday.from).toISOString())
      .lt('triggered_at', new Date(yesterday.to).toISOString()).limit(200)),
  ])

  // Yesterday's pings, newest-first so a busy day survives the cap.
  const rows: HistoryPoint[] = []
  {
    const PAGE = 1000, CAP = 15_000
    while (rows.length < CAP) {
      const { data } = await db.from('asset_locations')
        .select('asset_id, lat, lng, speed, timestamp')
        .eq('company_id', companyId)
        .gte('timestamp', new Date(yesterday.from).toISOString())
        .lt('timestamp', new Date(yesterday.to).toISOString())
        .order('timestamp', { ascending: false })
        .range(rows.length, rows.length + PAGE - 1)
      if (!data?.length) break
      rows.push(...(data as HistoryPoint[]))
      if (data.length < PAGE) break
    }
    rows.reverse() // chronological for the accrual engine
  }

  const zoneRows = (zones ?? []) as ZoneRow[]
  const assetRows = (assets ?? []) as AssetRow[]
  const trucks = await gatherTrucks(db, tz, assetRows as TruckAsset[], zoneRows)
  const insights = await (async () => {
    try {
      const { getActiveInsights } = await import('./insights')
      // Money rows ride along; each audience drops what it may not see.
      return await getActiveInsights(db, companyId, { limit: 10, includeMoney: true })
    } catch { return [] }
  })()

  const forecasts = new Map<string, Promise<string | null>>()
  const weather = (z: ZoneRow) => {
    let p = forecasts.get(z.id)
    if (!p) {
      const ring = z.geometry?.coordinates?.[0] ?? []
      const cx = ring.reduce((s, q) => s + q[0], 0) / Math.max(1, ring.length)
      const cy = ring.reduce((s, q) => s + q[1], 0) / Math.max(1, ring.length)
      p = ring.length >= 3 ? forecastAt(cy, cx) : Promise.resolve(null)
      forecasts.set(z.id, p)
    }
    return p
  }

  return {
    dateLabel: new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()),
    yesterday, today, weekOut,
    zones: zoneRows,
    assets: assetRows,
    tasks: (tasks ?? []) as BriefingRaw['tasks'],
    milestones: (milestones ?? []) as BriefingRaw['milestones'],
    maint: (maint ?? []) as BriefingRaw['maint'],
    wos: (wos ?? []) as BriefingRaw['wos'],
    alerts: (alertsYest ?? []) as BriefingRaw['alerts'],
    rows,
    trucks,
    insights,
    weather,
  }
}

/** One reader's briefing from the shared load — nothing above their rank,
 *  no dollars without the costs level. */
export async function shapeBriefing(raw: BriefingRaw, companyName: string, who: BriefingAudience): Promise<BriefingFacts> {
  const opens = (feature: string) => !who.features || who.features.has(feature)
  const seen = raw.assets.filter((a) => who.seesAsset(a))
  const seenIds = new Set(seen.map((a) => a.id))
  const siteZones = raw.zones
    .filter((z) => (z.kind ?? 'site') === 'site' && !z.completed_at)
    .slice(0, 10)

  const sites: SiteBrief[] = []
  for (const z of siteZones) {
    const ring = z.geometry?.coordinates?.[0]
    if (!ring || ring.length < 3) continue
    // Only assets this reader may see are counted — their names, hours and $.
    const usage = zoneAssetUsage(ring, seen as { id: string }[], raw.rows, raw.yesterday.from, raw.yesterday.to)
    const dueToday = raw.tasks
      .filter((t) => t.geofence_id === z.id && t.due_date && t.due_date <= raw.today)
      .map((t) => ({ title: t.title, overdue: (t.due_date as string) < raw.today }))
      .slice(0, 6)
    const milestonesSoon = raw.milestones
      .filter((m) => m.geofence_id === z.id && m.target_date && m.target_date <= raw.weekOut)
      .map((m) => ({ name: m.name, date: m.target_date ?? null }))
      .slice(0, 4)
    const hadActivity = usage.some((u) => u.presentHours > 0.05)
    // Skip zones with nothing to say — an empty section is noise at 6 AM.
    if (!hadActivity && !dueToday.length && !milestonesSoon.length) continue
    sites.push({
      zone: z.name,
      weather: await raw.weather(z),
      yesterdayHours: Math.round(usage.reduce((s, u) => s + u.activeHours, 0) * 10) / 10,
      yesterdayCost: who.money ? Math.round(usage.reduce((s, u) => s + u.amount, 0)) : 0,
      onSite: usage.filter((u) => u.presentHours > 0.05).map((u) => u.name).slice(0, 8),
      dueToday,
      milestonesSoon,
    })
  }

  // Broken things: hardware units (IMEI tracker_ids) silent >6h.
  const newest = new Map<string, number>()
  for (const r of raw.rows) {
    const t = Date.parse(r.timestamp)
    if (!newest.has(r.asset_id) || t > (newest.get(r.asset_id) ?? 0)) newest.set(r.asset_id, t)
  }
  const silentUnits = seen
    .filter((a) => /^\d{15}$/.test(String(a.tracker_id ?? '')))
    .filter((a) => (newest.get(a.id) ?? 0) < Date.now() - 6 * 3_600_000)
    .filter((a) => newest.has(a.id)) // never-reported = mid-setup, not broken
    .map((a) => a.name).slice(0, 5)

  const nameOf = new Map(seen.map((a) => [a.id, a.name]))
  // An insight about one machine links to its page; a hidden machine's
  // insight (the owner's idle unit) is not this reader's to see.
  const hiddenLink = (link: string | null | undefined) => {
    const m = /^\/assets\/([^/?#]+)/.exec(link ?? '')
    return !!m && !seenIds.has(m[1])
  }

  return {
    company: companyName,
    dateLabel: raw.dateLabel,
    sites,
    silentUnits,
    maintenanceOverdue: raw.maint
      .filter(() => opens('maintenance'))
      .filter((m) => seenIds.has(m.asset_id))
      .filter((m) => m.interval_type === 'days' && m.last_service_date && Number(m.interval_value) > 0 &&
        (Date.now() - Date.parse(m.last_service_date)) / 86_400_000 >= Number(m.interval_value))
      .map((m) => `${nameOf.get(m.asset_id) ?? 'Asset'} — ${m.description}`)
      .slice(0, 6),
    openWorkOrders: !opens('maintenance') ? 0 : raw.wos.filter((w) => (!w.asset_id || seenIds.has(w.asset_id)) && w.status !== 'done' && w.status !== 'canceled').length,
    // Actionable only — zone crossings and routine fuel/battery rows are a
    // log, not alerts ("· 143 alerts" on a lock screen, ship-check Nov 7).
    alertsYesterday: !opens('alerts') ? 0 : raw.alerts.filter((a) => (!a.asset_id || seenIds.has(a.asset_id)) && !isZoneLogEvent(a)).length,
    trucks: raw.trucks
      .filter((t) => seenIds.has(t.asset.id))
      .map((t) => ({ name: t.asset.name, milesYesterday: t.miles, at: t.at, silentH: t.fixMs == null ? null : (Date.now() - t.fixMs) / 3_600_000, checkEngine: t.checkEngine, milesKnown: t.scored }))
      .sort((a, b) => b.milesYesterday - a.milesYesterday),
    noticed: raw.insights
      .filter((r) => (who.money || !r.money) && !hiddenLink(r.link))
      .slice(0, 3)
      .map((r) => r.headline),
  }
}

/** The office copy (alert inbox / phone): everything, as before. */
export async function gatherBriefingFacts(
  db: SupabaseClient, companyId: string, companyName: string, tz: string
): Promise<BriefingFacts> {
  return shapeBriefing(await loadBriefing(db, companyId, tz), companyName, OFFICE_AUDIENCE)
}

type TruckAsset = { id: string; name: string; type?: string | null; tracker_id?: string | null; metadata?: unknown }

/** Miles yesterday off the safety builder's day rows (driving_daily, built
 *  hourly in the company's own day), the newest fix per truck, the zone it
 *  sits in, and the check-engine count off the telemetry map. Each read
 *  degrades to "unknown", never to an error. */
async function gatherTrucks(
  db: SupabaseClient, tz: string,
  assets: TruckAsset[],
  zones: { id: string; name: string; kind?: string | null; geometry?: { coordinates?: [number, number][][] } }[],
): Promise<TruckRaw[]> {
  const vehicles = assets.filter((a) => a.type === 'vehicle' && /^\d{15}$/.test(String(a.tracker_id ?? '')))
  if (!vehicles.length) return []
  const ids = vehicles.map((v) => v.id)
  const yday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - 86_400_000))
  const [dd, tel] = await Promise.all([
    db.from('driving_daily').select('asset_id, miles').in('asset_id', ids).eq('day', yday).then((r) => r.data ?? [], () => []),
    db.from('asset_telemetry_latest').select('asset_id, readings').in('asset_id', ids).then((r) => r.data ?? [], () => []),
  ])
  const miles = new Map((dd as { asset_id: string; miles: number }[]).map((r) => [r.asset_id, Number(r.miles) || 0]))
  const codes = new Map((tel as { asset_id: string; readings: Record<string, { v?: unknown }> | null }[])
    .map((r) => [r.asset_id, Number(r.readings?.['can.dtc.number']?.v ?? 0) || 0]))
  const { pointInPolygon } = await import('./alerts-engine')
  const out: TruckRaw[] = []
  for (const v of vehicles) {
    const { data } = await db.from('asset_locations').select('lat, lng, timestamp')
      .eq('asset_id', v.id).order('timestamp', { ascending: false }).limit(1)
    const fix = (data ?? [])[0] as { lat: number; lng: number; timestamp: string } | undefined
    let at: string | null = null
    if (fix) {
      for (const z of zones) {
        if ((z.kind ?? 'site') === 'boundary') continue
        const ring = z.geometry?.coordinates?.[0]
        if (ring && ring.length >= 3 && pointInPolygon([fix.lng, fix.lat], ring)) { at = z.name; break }
      }
    }
    out.push({
      asset: v,
      miles: Math.round(miles.get(v.id) ?? 0),
      at,
      fixMs: fix ? Date.parse(fix.timestamp) : null,
      checkEngine: codes.get(v.id) ?? 0,
      scored: isScoredAsset(v),
    })
  }
  return out
}

/** "F350 — 112 mi · at Magley" / "RAM 2500 — dark 28 days" */
export function truckLine(t: TruckBrief): string {
  if (t.silentH == null) return `${t.name} — never reported`
  if (t.silentH > 24) return `${t.name} — dark ${t.silentH > 48 ? `${Math.round(t.silentH / 24)} days` : `${Math.round(t.silentH)} h`}`
  const bits = [!t.milesKnown ? 'mileage n/a (battery unit)' : t.milesYesterday ? `${t.milesYesterday} mi` : 'parked']
  bits.push(t.at ? `at ${t.at}` : 'off site')
  if (t.checkEngine) bits.push(`check engine (${t.checkEngine})`)
  return `${t.name} — ${bits.join(' · ')}`
}

/** The push: one line a manager reads on the lock screen. */
export function briefingPush(f: BriefingFacts): { title: string; body: string } {
  const live = f.trucks.filter((t) => t.silentH != null && t.silentH <= 24)
  const measured = live.filter((t) => t.milesKnown)
  const moved = measured.filter((t) => t.milesYesterday > 0)
  const miles = moved.reduce((s, t) => s + t.milesYesterday, 0)
  // Dark = reported once and went quiet; a never-reported unit is mid-setup
  // (the email's silent list leaves those out too).
  const dark = f.trucks.filter((t) => t.silentH != null && t.silentH > 24).length
  const cel = live.filter((t) => t.checkEngine).length
  const top = moved.slice(0, 3).map((t) => `${t.name} ${t.milesYesterday} mi`)
  const bits: string[] = []
  if (top.length) bits.push(`Yesterday: ${top.join(', ')}${moved.length > 3 ? ` (${Math.round(miles)} mi total)` : ''}`)
  // Only say nobody moved when there are trucks that could tell us.
  else if (measured.length) bits.push('No truck moved yesterday')
  if (dark) bits.push(`${dark} tracker${dark === 1 ? '' : 's'} dark`)
  if (cel) bits.push(`${cel} check engine`)
  if (f.alertsYesterday) bits.push(`${f.alertsYesterday} alert${f.alertsYesterday === 1 ? '' : 's'}`)
  if (!bits.length) bits.push(f.sites.length ? `${f.sites.length} site${f.sites.length === 1 ? '' : 's'} on today's board` : 'Quiet board this morning')
  return { title: `☀ ${f.company} · ${f.dateLabel}`, body: bits.join(' · ') }
}

// ── Composition ────────────────────────────────────────────────────────────

export function briefingEmailHtml(f: BriefingFacts, manageUrl?: string | null): string {
  let inner = ''
  // The engine's findings open the read — the "here's what I noticed"
  // moment. Names inside headlines are user text: escape them.
  if (f.noticed.length) {
    inner += h2('Noticed')
    for (const n of f.noticed) inner += li(`✨ ${escapeHtml(n)}`)
  }
  if (f.trucks.length) {
    inner += h2('Trucks')
    for (const t of f.trucks) inner += li(escapeHtml(truckLine(t)))
  }
  if (f.sites.length) {
    for (const s of f.sites) {
      inner += h2(escapeHtml(s.zone))
      if (s.weather) inner += li(`Today: <b style="color:#e8f0f7">${s.weather}</b>`)
      if (s.yesterdayHours > 0) {
        inner += li(`Yesterday: <b style="color:#e8f0f7">${s.yesterdayHours} h</b> tracked${s.yesterdayCost ? ` · $${s.yesterdayCost.toLocaleString()}` : ''}${s.onSite.length ? ` — ${s.onSite.map(escapeHtml).join(', ')}` : ''}`)
      }
      for (const t of s.dueToday) {
        inner += li(`${t.overdue ? '<b style="color:#f87171">OVERDUE</b> · ' : 'Due today · '}${escapeHtml(t.title)}`)
      }
      for (const m of s.milestonesSoon) inner += li(`Milestone: ${escapeHtml(m.name)} — ${day(m.date)}`)
    }
  } else {
    inner += none('No active site had activity or deadlines — quiet board this morning.')
  }

  const broken: string[] = []
  if (f.silentUnits.length) broken.push(li(`<b style="color:#f87171">Trackers silent:</b> ${f.silentUnits.map(escapeHtml).join(', ')} — check power/SIM`))
  if (f.maintenanceOverdue.length) broken.push(...f.maintenanceOverdue.map((m) => li(`<b style="color:#ff9e16">Service overdue:</b> ${escapeHtml(m)}`)))
  if (f.openWorkOrders) broken.push(li(`${f.openWorkOrders} open work order${f.openWorkOrders === 1 ? '' : 's'}`))
  if (f.alertsYesterday) broken.push(li(`${f.alertsYesterday} alert${f.alertsYesterday === 1 ? '' : 's'} fired yesterday`))
  if (broken.length) {
    inner += h2('Needs attention')
    inner += broken.join('')
  }

  return shell(`${f.company} — morning briefing · ${f.dateLabel}`, inner, manageUrl)
}

export function briefingSms(f: BriefingFacts, manageUrl?: string | null): string {
  const bits: string[] = []
  const totalH = f.sites.reduce((s, z) => s + z.yesterdayHours, 0)
  if (totalH) bits.push(`yesterday ${Math.round(totalH)}h across ${f.sites.filter((s) => s.yesterdayHours > 0).length} site(s)`)
  const due = f.sites.reduce((s, z) => s + z.dueToday.length, 0)
  if (due) bits.push(`${due} punch item(s) due`)
  const wetSite = f.sites.find((s) => s.weather?.includes('% rain'))
  if (wetSite) bits.push(`rain at ${wetSite.zone}`)
  if (f.silentUnits.length) bits.push(`${f.silentUnits.length} tracker(s) silent`)
  if (f.maintenanceOverdue.length) bits.push(`${f.maintenanceOverdue.length} service overdue`)
  if (f.noticed.length) bits.push(f.noticed[0])
  if (!bits.length) bits.push('quiet board — nothing urgent')
  return `${f.company} ${f.dateLabel}: ${bits.join(' · ')}. ${BRAND_URL}/command${smsOptOut(manageUrl)}`
}
