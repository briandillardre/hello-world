'use server'

import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { getLiveConnection, createUsageInvoice, createServiceExpense, qboTxnUrl } from '@/lib/qbo'
import { zoneAssetUsage, type ZoneAssetUsage } from '@/lib/costs'

/**
 * QuickBooks server actions — the two money flows:
 *   previewZoneInvoiceAction / pushZoneInvoiceAction — bill tracked usage
 *     inside a job-site zone for the last N days
 *   pushServiceExpenseAction — send a maintenance record to QBO as an expense
 * All reads go through the caller's RLS session; only lib/qbo touches the
 * service client (token refresh).
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ZoneInvoiceDraft {
  zone: string
  fromIso: string
  toIso: string
  lines: { description: string; amount: number }[]
  total: number
  hasRates: boolean
}

function fmtH(h: number): string { return h >= 10 ? h.toFixed(0) : h.toFixed(1) }

function usageToLines(usage: ZoneAssetUsage[]): { description: string; amount: number }[] {
  return usage
    .filter((u) => u.amount > 0)
    .map((u) => {
      const bits = [`${fmtH(u.activeHours)} hrs active`]
      if (u.miles >= 0.5) bits.push(`${u.miles.toFixed(1)} mi`)
      if (u.presentHours - u.activeHours > 0.5) bits.push(`${fmtH(u.presentHours)} hrs on site`)
      return {
        description: `${u.name} — tracked usage (${bits.join(' · ')})`,
        amount: u.amount,
      }
    })
}

/** Build the draft (zone usage × asset rates over the window). Shared by
 *  preview and push so what you approve is exactly what posts. */
async function buildDraft(fenceId: string, days: number): Promise<ZoneInvoiceDraft | { error: string }> {
  if (isMock) return { error: 'Demo mode — connect Supabase + QuickBooks first.' }
  const companyId = await getCurrentCompanyId()
  if (!(await getMyPermissions()).canManageBilling) return { error: 'You need the Billing & QBO permission (Team page) to create invoices.' }

  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const to = Date.now()
  const from = to - Math.max(1, Math.min(days, 92)) * 86_400_000

  const [{ data: fence }, { data: assets }, { data: rows }] = await Promise.all([
    supabase.from('geofences').select('id, name, geometry').eq('id', fenceId).maybeSingle(),
    supabase.from('assets').select('id, name, type, hourly_rate, mileage_rate, daily_cost').eq('company_id', companyId),
    supabase.from('asset_locations')
      .select('asset_id, lat, lng, speed, timestamp')
      .eq('company_id', companyId)
      .gte('timestamp', new Date(from).toISOString())
      .order('timestamp', { ascending: true })
      .limit(40_000),
  ])
  if (!fence) return { error: 'Zone not found.' }

  const ring = ((fence.geometry as { coordinates?: unknown[] })?.coordinates?.[0] ?? []) as [number, number][]
  const usage = zoneAssetUsage(ring, assets ?? [], rows ?? [], from, to)
  const lines = usageToLines(usage)
  const hasRates = (assets ?? []).some(
    (a) => (a.hourly_rate ?? 0) > 0 || (a.mileage_rate ?? 0) > 0 || (a.daily_cost ?? 0) > 0
  )
  return {
    zone: fence.name,
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
    lines,
    total: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    hasRates,
  }
}

export async function previewZoneInvoiceAction(
  fenceId: string,
  days: number
): Promise<ZoneInvoiceDraft | { error: string }> {
  try {
    return await buildDraft(fenceId, days)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Preview failed.' }
  }
}

export async function pushZoneInvoiceAction(
  fenceId: string,
  days: number
): Promise<{ ok: true; docNumber: string; total: number; url: string } | { error: string }> {
  try {
    const draft = await buildDraft(fenceId, days)
    if ('error' in draft) return draft
    if (draft.lines.length === 0) {
      return { error: draft.hasRates ? 'No billable tracked usage in this window.' : 'Set cost rates on your assets first (Assets → Edit → Cost structure).' }
    }
    const companyId = await getCurrentCompanyId()
    const conn = await getLiveConnection(companyId)
    if (!conn) return { error: 'QuickBooks isn’t connected. Connect it on this page first.' }

    const period = `${draft.fromIso.slice(0, 10)} → ${draft.toIso.slice(0, 10)}`
    const inv = await createUsageInvoice(conn, {
      customerName: draft.zone,
      memo: `HammerTrack tracked usage · ${draft.zone} · ${period}`,
      lines: draft.lines,
    })
    return { ok: true, docNumber: inv.docNumber, total: inv.total, url: qboTxnUrl('invoice', inv.id) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invoice push failed.' }
  }
}

export async function pushServiceExpenseAction(
  serviceRecordId: string
): Promise<{ ok: true; url: string } | { error: string }> {
  try {
    if (isMock) return { error: 'Demo mode — connect Supabase + QuickBooks first.' }
    const companyId = await getCurrentCompanyId()
    if (!(await getMyPermissions()).canManageBilling) return { error: 'You need the Billing & QBO permission (Team page) to record expenses.' }
    const conn = await getLiveConnection(companyId)
    if (!conn) return { error: 'QuickBooks isn’t connected — see the Accounting page.' }

    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: rec } = await supabase
      .from('service_records')
      .select('id, cost, vendor, notes, service_date, asset_id')
      .eq('id', serviceRecordId)
      .maybeSingle()
    if (!rec) return { error: 'Service record not found.' }
    if (!(rec.cost > 0)) return { error: 'This record has no cost to expense.' }
    const { data: asset } = await supabase.from('assets').select('name').eq('id', rec.asset_id).maybeSingle()

    const exp = await createServiceExpense(conn, {
      vendorName: rec.vendor,
      amount: rec.cost,
      dateIso: rec.service_date,
      memo: `${asset?.name ?? 'Asset'} service — ${rec.notes || 'maintenance'} (HammerTrack)`,
    })
    return { ok: true, url: qboTxnUrl('expense', exp.id) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Expense push failed.' }
  }
}
