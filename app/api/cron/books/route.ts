import { NextRequest, NextResponse } from 'next/server'
import { pullBooks } from '@/lib/books/qbo-read'
import { isQboConfigured } from '@/lib/qbo'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Nightly books read (migration 167): every company with a QuickBooks
 * connection gets one snapshot — accounts, AR / AP aging, 12 months of P&L,
 * 60 days of deposits — for /finance/close and the owner dashboard. The pull
 * also refreshes the connection, which keeps it from lapsing (Intuit's
 * refresh token dies ~100 days after its last use). Read-only on QuickBooks.
 *
 * Manual test: GET /api/cron/books with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  // FAIL CLOSED: without CRON_SECRET this refuses, like every other cron.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })
  if (!isQboConfigured) return NextResponse.json({ ran: 0, note: 'QuickBooks is not configured' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: conns } = await db.from('qbo_connections').select('company_id').limit(200)
  const started = Date.now()
  const results: { company: string; ok: boolean; note?: string }[] = []
  for (const c of conns ?? []) {
    // Leave room to finish inside maxDuration; the rest go tomorrow.
    if (Date.now() - started > 240_000) { results.push({ company: String(c.company_id), ok: false, note: 'skipped: out of time' }); continue }
    try {
      const r = await pullBooks(String(c.company_id))
      results.push({ company: String(c.company_id), ok: r.ok, ...(r.ok ? (r.missing.length ? { note: `missing ${r.missing.join(', ')}` } : {}) : { note: r.error.slice(0, 160) }) })
    } catch (err) {
      console.error('books cron failed for', c.company_id, err)
      results.push({ company: String(c.company_id), ok: false, note: 'failed' })
    }
  }
  return NextResponse.json({ ran: results.length, results })
}
