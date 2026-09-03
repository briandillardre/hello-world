import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
// 074's window snap can widen a rebuild to a parked machine's whole session
// (capped at 60 days) — give the hourly run real headroom (ship-check P2).
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Hourly usage-ledger refresh (056/087): replays the last 48h of raw pings
 * through the session builder for every billing zone. Idempotent — each run
 * recomputes its (day-aligned) window, so the ledger self-heals from late
 * tracker backfills (devices buffer offline and upload with original
 * timestamps). Since 087 a run reads at most three days of pings per zone:
 * sessions that began earlier are cut at the window edge and re-joined, not
 * rescanned from their start (the 074 snap re-read up to 60 days per zone
 * every hour and burned the Supabase Disk IO budget).
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo' })
  // FAIL CLOSED (sec-check): this route runs 300s of service-role rebuild
  // work — with no CRON_SECRET set it must refuse, not run open to anyone.
  // Vercel cron sends the Authorization header automatically once set.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { error } = await svc.rpc('rebuild_all_usage', {
    p_from: new Date(Date.now() - 48 * 3600_000).toISOString(),
    p_to: new Date().toISOString(),
  })
  if (error) {
    console.error('rebuild_all_usage failed:', error.message)
    return NextResponse.json({ ok: false, error: 'rebuild failed' }, { status: 500 })
  }

  // ── Daily trail rollups (077/078/087) — the long-range map's data shape.
  // 087's build_trail_recent rebuilds ONLY the days that received rows since
  // the last run (by created_at) — late tracker uploads (a TAT141 parked out
  // of coverage surfaces days later, the offline field queue replays with
  // original timestamps) still land in their real day, but a quiet hour no
  // longer re-scans and rewrites a whole trailing week (Supabase Disk IO
  // alert, Sep 3). Pre-087 DB → the old today+7 loop. Then drain up to 90
  // history days per run. Errors don't fail the ledger run — a pre-077 DB
  // just skips until the migration lands.
  let trails: unknown = 'skipped'
  const recent = await svc.rpc('build_trail_recent')
  if (!recent.error) {
    const { data } = await svc.rpc('trail_backfill', { p_days: 90 })
    trails = { rebuiltDays: recent.data, backfilled: typeof data === 'number' ? data : null }
  } else {
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
    const { error: tdErr } = await svc.rpc('build_trail_daily', { p_day: day(0) })
    if (!tdErr) {
      for (let o = 1; o <= 7; o++) await svc.rpc('build_trail_daily', { p_day: day(o) })
      const { data } = await svc.rpc('trail_backfill', { p_days: 90 })
      trails = { legacy: true, backfilled: typeof data === 'number' ? data : null }
    } else {
      console.error('build_trail_daily skipped:', tdErr.message)
    }
  }
  return NextResponse.json({ ok: true, trails })
}
