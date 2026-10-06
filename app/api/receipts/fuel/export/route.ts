import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getMyPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { loadFuelPilot } from '@/lib/db/fuel-check'
import { exceptionsCsv, type ExportRow } from '@/lib/fuel-check'
import { dayKey, safeTz } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Every fuel-pilot exception and its verdict as a CSV — the pilot's working
 *  file. Same gate as the page: the Receipts view level and the $ figures. */
export async function GET() {
  if (isMock) return new NextResponse('Demo mode', { status: 400 })
  const perms = await getMyPermissions()
  if (!perms.features.includes('receipts') || !perms.canViewCosts) return new NextResponse('Not found', { status: 404 })
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const todayKey = dayKey(Date.now(), tz)
  const [{ createClient }, companyId] = await Promise.all([import('@/lib/supabase-server'), getCurrentCompanyId()])
  const view = await loadFuelPilot(createClient(), companyId, { todayKey, viewer: perms })
  const txnById = new Map(view.txns.map((t) => [t.id, t]))
  const rows: ExportRow[] = []
  for (const e of view.exceptions) {
    const t = txnById.get(e.transactionId)
    if (!t || (e.clearedAtMs && !e.verdict)) continue
    rows.push({
      txnDate: t.txnDate, txnAtMs: t.txnAtMs, merchant: t.placeLabel ?? t.merchant, amount: t.amount,
      gallons: t.gallons, gallonsEstimated: t.gallonsEstimated, vehicle: t.assetName, cardLast4: t.cardLast4,
      kind: e.kind, severity: e.severity, evidence: e.text, dollarsAtRisk: e.dollarsAtRisk, missing: e.missing,
      cleared: !!e.clearedAtMs, verdict: e.verdict, verdictNote: e.verdictNote, verdictBy: e.verdictBy, verdictAtMs: e.verdictAtMs,
    })
  }
  rows.sort((a, b) => b.txnDate.localeCompare(a.txnDate) || (b.txnAtMs ?? 0) - (a.txnAtMs ?? 0))
  return new NextResponse(exceptionsCsv(rows, tz), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="fuel-exceptions-${todayKey}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
