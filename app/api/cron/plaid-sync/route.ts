import { NextRequest, NextResponse } from 'next/server'
import { plaidEnabled } from '@/lib/plaid'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Pull new Plaid transactions into `expenses` for every linked institution.
 * Runs a few times a day; the /transactions/sync cursor means each run only
 * imports what's new. Manual test: GET with Authorization: Bearer $CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!plaidEnabled()) return NextResponse.json({ ok: true, skipped: 'plaid not configured' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: items, error } = await db.from('plaid_items').select('id, company_id, access_token, cursor')
  if (error) return NextResponse.json({ ok: true, skipped: 'plaid_items unavailable', detail: error.message })
  if (!items?.length) return NextResponse.json({ ok: true, items: 0 })

  const { syncPlaidItem } = await import('@/lib/plaid-ingest')
  let imported = 0, matched = 0
  for (const item of items) {
    try {
      const r = await syncPlaidItem(db, item)
      imported += r.imported; matched += r.matched
    } catch (err) {
      await db.from('plaid_items').update({ last_status: `error: ${err instanceof Error ? err.message : 'sync failed'}` }).eq('id', item.id)
    }
  }
  return NextResponse.json({ ok: true, items: items.length, imported, matched })
}
