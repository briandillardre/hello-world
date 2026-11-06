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

export async function gatherBriefingFacts(
  db: SupabaseClient, companyId: string, companyName: string, tz: string
): Promise<BriefingFacts> {
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
    g(db.from('work_orders').select('id, status').eq('company_id', companyId).limit(200)),
    g(db.from('alert_events').select('id').eq('company_id', companyId)
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

  type ZoneRow = { id: string; name: string; kind?: string | null; completed_at?: string | null; geometry?: { coordinates?: [number, number][][] } }
  const siteZones = ((zones ?? []) as ZoneRow[])
    .filter((z) => (z.kind ?? 'site') === 'site' && !z.completed_at)
    .slice(0, 10)

  const sites: SiteBrief[] = []
  for (const z of siteZones) {
    const ring = z.geometry?.coordinates?.[0]
    if (!ring || ring.length < 3) continue
    const usage = zoneAssetUsage(ring, (assets ?? []) as { id: string }[], rows, yesterday.from, yesterday.to)
    const dueToday = (tasks ?? [])
      .filter((t) => t.geofence_id === z.id && t.due_date && (t.due_date as string) <= today)
      .map((t) => ({ title: t.title as string, overdue: (t.due_date as string) < today }))
      .slice(0, 6)
    const milestonesSoon = (milestones ?? [])
      .filter((m) => m.geofence_id === z.id && m.target_date && (m.target_date as string) <= weekOut)
      .map((m) => ({ name: m.name as string, date: (m.target_date as string | null) ?? null }))
      .slice(0, 4)
    const hadActivity = usage.some((u) => u.presentHours > 0.05)
    // Skip zones with nothing to say — an empty section is noise at 6 AM.
    if (!hadActivity && !dueToday.length && !milestonesSoon.length) continue
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
    sites.push({
      zone: z.name,
      weather: await forecastAt(cy, cx),
      yesterdayHours: Math.round(usage.reduce((s, u) => s + u.activeHours, 0) * 10) / 10,
      yesterdayCost: Math.round(usage.reduce((s, u) => s + u.amount, 0)),
      onSite: usage.filter((u) => u.presentHours > 0.05).map((u) => u.name).slice(0, 8),
      dueToday,
      milestonesSoon,
    })
  }

  // Broken things: hardware units (IMEI tracker_ids) silent >6h.
  const newest = new Map<string, number>()
  for (const r of rows) {
    const t = Date.parse(r.timestamp)
    if (!newest.has(r.asset_id) || t > (newest.get(r.asset_id) ?? 0)) newest.set(r.asset_id, t)
  }
  type AssetRow = { id: string; name: string; tracker_id?: string | null }
  const silentUnits = ((assets ?? []) as AssetRow[])
    .filter((a) => /^\d{15}$/.test(String(a.tracker_id ?? '')))
    .filter((a) => (newest.get(a.id) ?? 0) < Date.now() - 6 * 3_600_000)
    .filter((a) => newest.has(a.id)) // never-reported = mid-setup, not broken
    .map((a) => a.name).slice(0, 5)

  const nameOf = new Map(((assets ?? []) as AssetRow[]).map((a) => [a.id, a.name]))
  const trucks = await gatherTrucks(db, companyId, tz, (assets ?? []) as TruckAsset[], (zones ?? []) as ZoneRow[])

  return {
    company: companyName,
    dateLabel: new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()),
    sites,
    silentUnits,
    maintenanceOverdue: (maint ?? [])
      .filter((m) => m.interval_type === 'days' && m.last_service_date && Number(m.interval_value) > 0 &&
        (Date.now() - Date.parse(m.last_service_date as string)) / 86_400_000 >= Number(m.interval_value))
      .map((m) => `${nameOf.get(m.asset_id as string) ?? 'Asset'} — ${m.description}`)
      .slice(0, 6),
    openWorkOrders: (wos ?? []).filter((w) => w.status !== 'done' && w.status !== 'canceled').length,
    alertsYesterday: (alertsYest ?? []).length,
    trucks,
    noticed: await (async () => {
      try {
        const { getInsightHeadlines } = await import('./insights')
        // includeMoney: the briefing goes to alert_email/alert_phone — the owner.
        return await getInsightHeadlines(db, companyId, 3, true)
      } catch { return [] }
    })(),
  }
}

type TruckAsset = { id: string; name: string; type?: string; tracker_id?: string | null }

/** Miles yesterday off the safety builder's day rows (driving_daily, built
 *  hourly in the company's own day), the newest fix per truck, the zone it
 *  sits in, and the check-engine count off the telemetry map. Each read
 *  degrades to "unknown", never to an error. */
async function gatherTrucks(
  db: SupabaseClient, companyId: string, tz: string,
  assets: TruckAsset[],
  zones: { id: string; name: string; kind?: string | null; geometry?: { coordinates?: [number, number][][] } }[],
): Promise<TruckBrief[]> {
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
  const out: TruckBrief[] = []
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
      name: v.name,
      milesYesterday: Math.round(miles.get(v.id) ?? 0),
      at,
      silentH: fix ? (Date.now() - Date.parse(fix.timestamp)) / 3_600_000 : null,
      checkEngine: codes.get(v.id) ?? 0,
    })
  }
  return out.sort((a, b) => b.milesYesterday - a.milesYesterday)
}

/** "F350 — 112 mi · at Magley" / "RAM 2500 — dark 28 days" */
export function truckLine(t: TruckBrief): string {
  if (t.silentH == null) return `${t.name} — never reported`
  if (t.silentH > 24) return `${t.name} — dark ${t.silentH > 48 ? `${Math.round(t.silentH / 24)} days` : `${Math.round(t.silentH)} h`}`
  const bits = [t.milesYesterday ? `${t.milesYesterday} mi` : 'parked']
  bits.push(t.at ? `at ${t.at}` : 'off site')
  if (t.checkEngine) bits.push(`check engine (${t.checkEngine})`)
  return `${t.name} — ${bits.join(' · ')}`
}

/** The push: one line a manager reads on the lock screen. */
export function briefingPush(f: BriefingFacts): { title: string; body: string } {
  const live = f.trucks.filter((t) => t.silentH != null && t.silentH <= 24)
  const miles = live.reduce((s, t) => s + t.milesYesterday, 0)
  const dark = f.trucks.filter((t) => t.silentH == null || t.silentH > 24).length
  const cel = f.trucks.filter((t) => t.checkEngine && t.silentH != null && t.silentH <= 24).length
  const top = live.filter((t) => t.milesYesterday > 0).slice(0, 3).map((t) => `${t.name} ${t.milesYesterday} mi`)
  const bits: string[] = []
  if (top.length) bits.push(`Yesterday: ${top.join(', ')}${live.filter((t) => t.milesYesterday > 0).length > 3 ? ` (${Math.round(miles)} mi total)` : ''}`)
  else bits.push('No truck moved yesterday')
  if (dark) bits.push(`${dark} tracker${dark === 1 ? '' : 's'} dark`)
  if (cel) bits.push(`${cel} check engine`)
  if (f.alertsYesterday) bits.push(`${f.alertsYesterday} alert${f.alertsYesterday === 1 ? '' : 's'}`)
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
      inner += h2(s.zone)
      if (s.weather) inner += li(`Today: <b style="color:#e8f0f7">${s.weather}</b>`)
      if (s.yesterdayHours > 0) {
        inner += li(`Yesterday: <b style="color:#e8f0f7">${s.yesterdayHours} h</b> tracked${s.yesterdayCost ? ` · $${s.yesterdayCost.toLocaleString()}` : ''}${s.onSite.length ? ` — ${s.onSite.join(', ')}` : ''}`)
      }
      for (const t of s.dueToday) {
        inner += li(`${t.overdue ? '<b style="color:#f87171">OVERDUE</b> · ' : 'Due today · '}${t.title}`)
      }
      for (const m of s.milestonesSoon) inner += li(`Milestone: ${m.name} — ${day(m.date)}`)
    }
  } else {
    inner += none('No active site had activity or deadlines — quiet board this morning.')
  }

  const broken: string[] = []
  if (f.silentUnits.length) broken.push(li(`<b style="color:#f87171">Trackers silent:</b> ${f.silentUnits.join(', ')} — check power/SIM`))
  if (f.maintenanceOverdue.length) broken.push(...f.maintenanceOverdue.map((m) => li(`<b style="color:#ff9e16">Service overdue:</b> ${m}`)))
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
