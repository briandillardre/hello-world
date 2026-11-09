/**
 * Production reads (migration 160). Items and daily quantities come through
 * the caller's RLS — `bid_unit_cost` is not granted to members, so it is read
 * on the service role ONLY for a login with the costs ability. Each day's
 * hours and cost are read where they already live (time cards clocked to the
 * site, the machine hours ledger), the same sources and rates as job cost
 * (lib/db/jobcost.ts), bucketed by the company's local day. A login without
 * costs gets the hours and never a dollar.
 */
import { ledgerRowCost } from '@/lib/costs'
import { allRows } from '@/lib/db/paged'
import { dayKey, safeTz } from '@/lib/dates'
import { isProdUnit, type DayCost, type ProdEntry, type ProdItem } from '@/lib/jobs/production'
import { shiftHours } from '@/lib/timecards'
import type { AssetType } from '@/lib/types'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export const MAX_ITEMS = 400

export interface ProductionData {
  available: boolean
  partial: boolean
  tz: string
  today: string
  items: ProdItem[]
  entries: (ProdEntry & { note: string | null })[]
  days: DayCost[]
}

const DEMO_ITEMS: ProdItem[] = [
  { id: 'd1', code: 'MOB', name: 'Mobilization', unit: 'LS', budgetQty: 1, bidUnitCost: 4200, bidPerDay: null, crew: null, sort: 1 },
  { id: 'd2', code: 'Earthwork', name: 'Mass excavation', unit: 'CY', budgetQty: 5200, bidUnitCost: 6.1, bidPerDay: 900, crew: 'Dirt crew', sort: 2 },
  { id: 'd3', code: 'Storm', name: '15" RCP storm pipe', unit: 'LF', budgetQty: 840, bidUnitCost: 48, bidPerDay: 160, crew: 'Pipe crew', sort: 3 },
  { id: 'd4', code: 'Paving', name: 'ABC stone base 8"', unit: 'SY', budgetQty: 3100, bidUnitCost: 11.4, bidPerDay: 1200, crew: 'Dirt crew', sort: 4 },
]

function demo(withMoney: boolean, today: string): ProductionData {
  const back = (n: number) => dayKey(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000, 'UTC')
  const entries = [
    { itemId: 'd1', day: back(9), qty: 1, note: null },
    { itemId: 'd2', day: back(8), qty: 820, note: null }, { itemId: 'd2', day: back(7), qty: 960, note: null },
    { itemId: 'd2', day: back(6), qty: 610, note: 'Rain at 1 PM' }, { itemId: 'd3', day: back(5), qty: 120, note: null },
    { itemId: 'd3', day: back(4), qty: 150, note: null }, { itemId: 'd2', day: back(4), qty: 400, note: null },
    { itemId: 'd3', day: back(1), qty: 96, note: 'Hit rock at STA 3+40' },
  ]
  const days: DayCost[] = [9, 8, 7, 6, 5, 4, 2, 1].map((n) => ({
    day: back(n), laborHrs: 40, laborCost: withMoney ? 1900 : 0, equipHrs: 24, equipCost: withMoney ? 2300 : 0,
  }))
  return {
    available: true, partial: false, tz: 'America/New_York', today,
    items: DEMO_ITEMS.map((i) => ({ ...i, bidUnitCost: withMoney ? i.bidUnitCost : null })), entries, days,
  }
}

export async function getProduction(companyId: string, job: { id: string; zoneId: string; from: string | null }, withMoney: boolean): Promise<ProductionData> {
  const now = Date.now()
  if (isMock) return demo(withMoney, dayKey(now, 'America/New_York'))
  const emptyTz = 'America/New_York'
  const empty: ProductionData = { available: false, partial: false, tz: emptyTz, today: dayKey(now, emptyTz), items: [], entries: [], days: [] }
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const svc = createServiceClient()
    const [it, q, co] = await Promise.all([
      db.from('job_items').select('id, code, name, unit, budget_qty, bid_per_day, crew_name, sort').eq('job_id', job.id).is('deleted_at', null).order('sort').order('id').limit(MAX_ITEMS),
      allRows((f, t) => db.from('job_quantities').select('item_id, day, qty, note').eq('job_id', job.id).order('day').order('item_id').range(f, t), { max: 50_000 }),
      svc.from('companies').select('digest_prefs').eq('id', companyId).maybeSingle(),
    ])
    if (it.error) return empty
    const tzRaw = (co.data?.digest_prefs as { tz?: unknown } | null)?.tz
    const tz = safeTz(typeof tzRaw === 'string' ? tzRaw : null)
    const today = dayKey(now, tz)

    // money: only for a costs login, on the service role, pinned to this job + company
    const price = new Map<string, number>()
    if (withMoney && (it.data ?? []).length) {
      const { data } = await svc.from('job_items').select('id, bid_unit_cost').eq('job_id', job.id).eq('company_id', companyId).is('deleted_at', null).limit(MAX_ITEMS)
      for (const r of data ?? []) if (r.bid_unit_cost !== null) price.set(String(r.id), Number(r.bid_unit_cost))
    }
    const items: ProdItem[] = (it.data ?? []).map((r) => ({
      id: String(r.id), code: (r.code as string | null) ?? null, name: String(r.name), unit: isProdUnit(r.unit) ? r.unit : 'EA',
      budgetQty: Number(r.budget_qty), bidUnitCost: price.get(String(r.id)) ?? null,
      bidPerDay: r.bid_per_day === null ? null : Number(r.bid_per_day), crew: (r.crew_name as string | null) ?? null, sort: Number(r.sort ?? 0),
    }))
    const entries = q.rows.map((r) => ({ itemId: String(r.item_id), day: String(r.day), qty: Number(r.qty), note: (r.note as string | null) ?? null }))

    // the days' hours (and, with costs, dollars) — job cost's sources and rates
    const fromTs = job.from ? `${job.from}T00:00:00Z` : null
    const [teR, udR] = await Promise.all([
      allRows((f, t) => {
        let qq = svc.from('time_entries').select('id, user_id, clock_in_at, clock_out_at, break_minutes').eq('company_id', companyId).eq('project_geofence_id', job.zoneId)
        if (fromTs) qq = qq.gte('clock_in_at', fromTs)
        return qq.order('id').range(f, t)
      }, { max: 50_000 }),
      allRows((f, t) => {
        let qq = svc.from('usage_daily').select('asset_id, day, on_site_secs, active_secs').eq('company_id', companyId).eq('geofence_id', job.zoneId)
        if (job.from) qq = qq.gte('day', job.from)
        return qq.order('day').order('asset_id').range(f, t)
      }, { max: 100_000 }),
    ])
    const te = teR.rows, ud = udR.rows
    const rate = new Map<string, number>()
    const assets = new Map<string, { type: AssetType | null; hourly_rate: number | null; daily_cost: number | null }>()
    const people = Array.from(new Set(te.map((x) => String(x.user_id))))
    const machineIds = Array.from(new Set(ud.map((x) => String(x.asset_id))))
    // rates through the caller's RLS (a phone or machine hidden from them is never priced) — and only with costs
    if (withMoney) {
      for (let i = 0; i < people.length; i += 150) {
        const { data } = await db.from('assets').select('tracker_id, hourly_rate').eq('company_id', companyId).in('tracker_id', people.slice(i, i + 150).map((u) => `phone-${u}`))
        for (const a of data ?? []) if (a.hourly_rate !== null && Number(a.hourly_rate) > 0) rate.set(String(a.tracker_id).slice(6), Number(a.hourly_rate))
      }
    }
    for (let i = 0; i < machineIds.length; i += 150) {
      const { data } = await db.from('assets').select('id, type, hourly_rate, daily_cost').eq('company_id', companyId).in('id', machineIds.slice(i, i + 150))
      for (const a of data ?? []) assets.set(String(a.id), { type: a.type as AssetType | null, hourly_rate: withMoney ? (a.hourly_rate as number | null) : null, daily_cost: withMoney ? (a.daily_cost as number | null) : null })
    }
    const byDay = new Map<string, DayCost>()
    const get = (day: string) => {
      let d = byDay.get(day)
      if (!d) { d = { day, laborHrs: 0, laborCost: 0, equipHrs: 0, equipCost: 0 }; byDay.set(day, d) }
      return d
    }
    for (const x of te) {
      const h = shiftHours(String(x.clock_in_at), x.clock_out_at ? String(x.clock_out_at) : null, Number(x.break_minutes ?? 0), now).paid
      if (!(h > 0)) continue
      const d = get(dayKey(Date.parse(String(x.clock_in_at)), tz))
      d.laborHrs += h
      const r = rate.get(String(x.user_id))
      if (r) d.laborCost += h * r
    }
    for (const x of ud) {
      const a = assets.get(String(x.asset_id))
      if (!a || (a.type !== 'vehicle' && a.type !== 'equipment')) continue
      const d = get(String(x.day))
      d.equipHrs += Number(x.on_site_secs) / 3600
      if (withMoney) d.equipCost += ledgerRowCost(a, Number(x.on_site_secs), Number(x.active_secs))
    }
    const days = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({
      day: d.day, laborHrs: Math.round(d.laborHrs * 10) / 10, laborCost: Math.round(d.laborCost * 100) / 100,
      equipHrs: Math.round(d.equipHrs * 10) / 10, equipCost: Math.round(d.equipCost * 100) / 100,
    }))
    return { available: true, partial: [q, teR, udR].some((x) => x.truncated), tz, today, items, entries, days }
  } catch {
    return empty
  }
}
