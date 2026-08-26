import { NextRequest, NextResponse } from 'next/server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/zones'
import { getAssets } from '@/lib/db/assets'
import { getMyPermissions } from '@/lib/permissions-server'
import { usageFromLedger } from '@/lib/costs'
import { zonedDayWindow, dayKey, safeTz } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Per-site burn figures for the map's "money on the map" chips: what each
 * SITE zone spent today (machine time priced off the exact-hours ledger,
 * migration 056), job-coded receipts, budget, and yesterday/all-time context.
 *
 * Money reads the LEDGER (usage_daily), same as the zone page — never the
 * raw ping sweep. Every data family degrades independently: a missing table
 * or column zeroes that field, it never 500s the map tick.
 */

type RateCoverage = 'full' | 'partial' | 'none'

export interface ZoneBurnRow {
  id: string
  /** Machine cost accrued in this zone during the company-local today ($). */
  spentToday: number
  /** Active machine-hours in the zone today (personnel count present time). */
  hoursToday: number
  /** Labor $ from today's clocked time_entries. No wage-rate column exists
   *  anywhere in the schema yet, so this is 0 — never invented. The hours
   *  themselves are real and travel in laborHoursToday. */
  laborToday: number
  /** Additive: clocked person-hours charged to this zone today. */
  laborHoursToday: number
  /** Job-coded receipts dated today ($) — receipts.project_geofence_id. */
  receiptsToday: number
  /** Project budget from migration 046 (geofences.budget), null if unset. */
  budget: number | null
  /** All-time machine cost from the ledger ($). */
  spentTotal: number
  yesterdaySpend: number
  yesterdayHours: number
  /** Whether the company's billable assets have cost rates set — the UI
   *  renders "set rates" instead of lying with $0. */
  rateCoverage: RateCoverage
}

interface LedgerRow {
  geofence_id: string
  asset_id: string
  day: string
  on_site_secs: number
  active_secs: number
}

interface TimeEntryRow {
  project_geofence_id: string | null
  clock_in_at: string
  clock_out_at: string | null
}

interface ReceiptRow {
  project_geofence_id: string | null
  amount: number | string | null
}

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } } as const

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

export async function GET(req: NextRequest) {
  try {
    // Demo mode: the map chips read mock money from the client bundle.
    if (isMock) return NextResponse.json({ zones: [] as ZoneBurnRow[] }, NO_STORE)

    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const companyId = await getCurrentCompanyId()
    const [perms, geofences, assets] = await Promise.all([
      getMyPermissions(),
      getGeofences(companyId),
      getAssets(companyId),
    ])
    // Dollars are cost-permission gated (same boundary as /finance and the
    // map's cost chips) — a foreman/viewer gets an empty, valid payload.
    if (!perms.canViewCosts) return NextResponse.json({ zones: [] as ZoneBurnRow[] }, NO_STORE)

    const siteZones = geofences.filter((g) => (g.kind ?? 'site') === 'site')
    if (siteZones.length === 0) return NextResponse.json({ zones: [] as ZoneBurnRow[] }, NO_STORE)

    // "Today" is the VIEWER's local calendar day (ht_tz cookie), matching how
    // every other window in the app is derived. The ledger keys rows by DATE,
    // so the local day label picks the rows.
    const tz = safeTz(req.cookies.get('ht_tz')?.value)
    const today = zonedDayWindow(tz, 0)
    const todayKey = dayKey(today.from, tz)
    const yesterdayKey = dayKey(zonedDayWindow(tz, 1).from, tz)

    // Three independent reads — each one degrades to empty on its own.
    const [ledger, entries, receipts] = await Promise.all([
      // Exact-hours ledger (056). A year of asset-days company-wide is a few
      // thousand tiny rows; today/yesterday/all-time all come from one read.
      (async (): Promise<LedgerRow[]> => {
        try {
          const { data, error } = await supabase
            .from('usage_daily')
            .select('geofence_id, asset_id, day, on_site_secs, active_secs')
            .eq('company_id', companyId)
            .limit(50_000)
          if (error) return [] // pre-056 database
          return (data ?? []) as LedgerRow[]
        } catch { return [] }
      })(),
      // Today's clocked time (015) charged to a project zone.
      (async (): Promise<TimeEntryRow[]> => {
        try {
          const { data, error } = await supabase
            .from('time_entries')
            .select('project_geofence_id, clock_in_at, clock_out_at')
            .eq('company_id', companyId)
            .gte('clock_in_at', new Date(today.from).toISOString())
            .lt('clock_in_at', new Date(today.to).toISOString())
            .not('project_geofence_id', 'is', null)
            .limit(2000)
          if (error) return [] // pre-015 database
          return (data ?? []) as TimeEntryRow[]
        } catch { return [] }
      })(),
      // Job-coded receipts dated today (017). Rejected ones don't burn —
      // same filter as the Project Hub's receipts total (lib/db/projects.ts).
      (async (): Promise<ReceiptRow[]> => {
        try {
          const { data, error } = await supabase
            .from('receipts')
            .select('project_geofence_id, amount')
            .eq('company_id', companyId)
            .eq('txn_date', todayKey)
            .neq('status', 'rejected')
            .not('project_geofence_id', 'is', null)
            .limit(2000)
          if (error) return [] // pre-017 database
          return (data ?? []) as ReceiptRow[]
        } catch { return [] }
      })(),
    ])

    // Rate coverage across billable assets (tools carry no time-based cost) —
    // same predicate as lib/costs.ts hasRates, broken into full/partial/none.
    const billable = assets.filter((a) => a.type !== 'tool' && a.active !== false)
    const rated = billable.filter(
      (a) => (a.hourly_rate ?? 0) > 0 || (a.mileage_rate ?? 0) > 0 || (a.daily_cost ?? 0) > 0
    )
    const rateCoverage: RateCoverage =
      rated.length === 0 ? 'none' : rated.length === billable.length ? 'full' : 'partial'

    const ledgerByZone = new Map<string, LedgerRow[]>()
    for (const r of ledger) {
      const rows = ledgerByZone.get(r.geofence_id)
      if (rows) rows.push(r)
      else ledgerByZone.set(r.geofence_id, [r])
    }

    const laborHoursByZone = new Map<string, number>()
    const nowMs = Date.now()
    for (const e of entries) {
      if (!e.project_geofence_id) continue
      const start = Math.max(Date.parse(e.clock_in_at), today.from)
      const end = Math.min(e.clock_out_at ? Date.parse(e.clock_out_at) : nowMs, today.to)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      laborHoursByZone.set(
        e.project_geofence_id,
        (laborHoursByZone.get(e.project_geofence_id) ?? 0) + (end - start) / 3_600_000
      )
    }

    const receiptsByZone = new Map<string, number>()
    for (const r of receipts) {
      if (!r.project_geofence_id) continue
      receiptsByZone.set(
        r.project_geofence_id,
        (receiptsByZone.get(r.project_geofence_id) ?? 0) + (Number(r.amount) || 0)
      )
    }

    // Price ledger rows with the SAME house function the zone page uses
    // (usageFromLedger → ledgerRowCost) so the map chip and the invoice
    // preview can never disagree.
    const price = (rows: LedgerRow[]): { spent: number; hours: number } => {
      const usage = usageFromLedger(rows, assets)
      return {
        spent: usage.reduce((s, u) => s + u.amount, 0),
        hours: usage.reduce((s, u) => s + u.activeHours, 0),
      }
    }

    const zones: ZoneBurnRow[] = siteZones.map((g) => {
      const rows = ledgerByZone.get(g.id) ?? []
      const t = price(rows.filter((r) => r.day === todayKey))
      const y = price(rows.filter((r) => r.day === yesterdayKey))
      const all = price(rows)
      const budgetNum = g.budget == null ? NaN : Number(g.budget)
      return {
        id: g.id,
        spentToday: round2(t.spent),
        hoursToday: round1(t.hours),
        laborToday: 0,
        laborHoursToday: round1(laborHoursByZone.get(g.id) ?? 0),
        receiptsToday: round2(receiptsByZone.get(g.id) ?? 0),
        budget: Number.isFinite(budgetNum) ? budgetNum : null,
        spentTotal: round2(all.spent),
        yesterdaySpend: round2(y.spent),
        yesterdayHours: round1(y.hours),
        rateCoverage,
      }
    })

    return NextResponse.json({ zones }, NO_STORE)
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
