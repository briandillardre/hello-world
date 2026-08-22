import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
// 074's window snap can widen a rebuild to a parked machine's whole session
// (capped at 60 days) — give the hourly run real headroom (ship-check P2).
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Hourly usage-ledger refresh (056): replays the last 48h of raw pings
 * through the session builder for every billing zone. Idempotent — each run
 * deletes + recomputes its window, so the ledger self-heals from late
 * tracker backfills (devices buffer offline and upload with original
 * timestamps). History older than the window never changes, so exactness
 * costs one cheap in-database pass per hour.
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo' })
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { error } = await svc.rpc('rebuild_all_usage', {
    p_from: new Date(Date.now() - 48 * 3600_000).toISOString(),
    p_to: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
