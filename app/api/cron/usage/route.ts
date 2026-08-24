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

  // ── Daily trail rollups (077) — the long-range map's data shape. Refresh
  // today (still accumulating) + yesterday (late backfills), then drain up
  // to 90 missing history days per run. Errors don't fail the ledger run —
  // a pre-077 DB just skips until the migration lands.
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
  const { error: tdErr } = await svc.rpc('build_trail_daily', { p_day: day(0) })
  let backfilled: number | null = null
  if (!tdErr) {
    await svc.rpc('build_trail_daily', { p_day: day(1) })
    const { data } = await svc.rpc('trail_backfill', { p_days: 90 })
    backfilled = typeof data === 'number' ? data : null
  }
  return NextResponse.json({ ok: true, trails: tdErr ? `skipped: ${tdErr.message}` : { backfilled } })
}
