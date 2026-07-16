import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Receipt chase — nightly nudge for charges that still have no receipt. A charge
 * older than GRACE_DAYS with no matching receipt gets the owner a reminder (and
 * a push), then we stamp chased_at so we don't nag about the same one daily.
 * The point: receipts get logged while the memory is fresh, not at tax time.
 *
 * Manual test: GET with Authorization: Bearer $CRON_SECRET.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const GRACE_DAYS = 3
const RECHASE_DAYS = 3

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  const olderThan = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const rechaseBefore = new Date(Date.now() - RECHASE_DAYS * 86_400_000).toISOString()

  const { data: rows, error } = await db
    .from('expenses')
    .select('id, company_id, merchant, amount, txn_date, chased_at')
    .eq('status', 'needs_receipt')
    .lte('txn_date', olderThan)
    .or(`chased_at.is.null,chased_at.lt.${rechaseBefore}`)
    .limit(2000)
  if (error) return NextResponse.json({ ok: true, skipped: 'expenses unavailable', detail: error.message })
  if (!rows?.length) return NextResponse.json({ ok: true, chased: 0 })

  // Group by company.
  const byCompany = new Map<string, { ids: string[]; count: number; total: number }>()
  for (const r of rows) {
    const g = byCompany.get(r.company_id) ?? { ids: [], count: 0, total: 0 }
    g.ids.push(r.id); g.count++; g.total += Number(r.amount)
    byCompany.set(r.company_id, g)
  }

  let notified = 0
  const { dispatchAlerts } = await import('@/lib/notify')
  for (const [companyId, g] of Array.from(byCompany.entries())) {
    const { data: co } = await db.from('companies').select('name, alert_phone, alert_email').eq('id', companyId).single()
    await dispatchAlerts(
      co?.name ?? 'Your fleet',
      { phone: co?.alert_phone, email: co?.alert_email },
      [{ severity: 'info', reason: `${g.count} charge${g.count === 1 ? '' : 's'} still need a receipt ($${g.total.toFixed(2)}). Snap them in HammerTrack → Receipts.` }],
      companyId,
    )
    await db.from('expenses').update({ chased_at: new Date().toISOString() }).in('id', g.ids)
    notified++
  }

  return NextResponse.json({ ok: true, companies: notified, charges: rows.length })
}
