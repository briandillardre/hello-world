import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Receipt chase — runs HOURLY (was nightly) to drive two loops:
 *
 * 1. The card-alert nag ladder. A swipe-time charge (source 'card_alert') got
 *    its instant ping at ingest (nag_level 1). Still no photo → re-ping the
 *    cardholder at +1 h (level 2) and +4 h (level 3, sharper tone). After
 *    that it folds into the nightly digest like everything else.
 * 2. The nightly digest for ALL aging unreceipted charges — unchanged
 *    behavior, gated to the 22:xx UTC run so it stays once-a-day.
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

  // ── Loop 1: card-alert nag ladder (every run) ──────────────────────────
  let laddered = 0
  try {
    const { data: fresh } = await db
      .from('expenses')
      .select('id, company_id, merchant, amount, last4, cardholder_user_id, capture_token, nag_level, created_at')
      .eq('source', 'card_alert')
      .eq('status', 'needs_receipt')
      .in('nag_level', [1, 2])
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
    if (fresh?.length) {
      const { sendPushToUser } = await import('@/lib/push')
      const { BRAND_URL } = await import('@/lib/brand')
      for (const e of fresh) {
        const ageMs = Date.now() - Date.parse(e.created_at)
        const due = (e.nag_level === 1 && ageMs >= 3_600_000) || (e.nag_level === 2 && ageMs >= 4 * 3_600_000)
        if (!due || !e.capture_token) continue
        const where = e.merchant ? ` at ${e.merchant}` : ''
        const link = `${BRAND_URL}/r/${e.capture_token}`
        const body = e.nag_level === 1
          ? `Still waiting on the receipt for $${Number(e.amount).toFixed(2)}${where}: ${link}`
          : `That $${Number(e.amount).toFixed(2)}${where} receipt is 4 hours old. 20 seconds now beats a write-off in April: ${link}`
        await sendPushToUser(e.company_id, e.cardholder_user_id, { title: '🧾 Receipt still missing', body })
        await db.from('expenses')
          .update({ nag_level: e.nag_level + 1, chased_at: new Date().toISOString() })
          .eq('id', e.id)
        laddered++
      }
    }
  } catch { /* pre-045 DB — ladder columns absent; nightly loop still works */ }

  // ── Loop 2: nightly digest — only on the 22:xx UTC run ─────────────────
  if (new Date().getUTCHours() !== 22) {
    return NextResponse.json({ ok: true, laddered, digest: 'skipped (not the nightly run)' })
  }

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

  return NextResponse.json({ ok: true, laddered, companies: notified, charges: rows.length })
}
