import { NextRequest, NextResponse } from 'next/server'
import { notifySystem } from '@/lib/monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The watchdog — runs hourly on Vercel cron so the owner learns the system
 * is sick from a push, not from a customer (or an empty map at 6 AM).
 *
 * Checks:
 *  1. Database reachable (any failure pages immediately).
 *  2. Ingest freshness — trackers check in at least hourly even parked, so
 *     the newest location across the fleet being >6h old means the pipeline
 *     (device → SIM → flespi → webhook) is down somewhere. Pings at most
 *     4×/day while broken (11/15/19/23 UTC) instead of every hour.
 *  3. Once a day (11 UTC ≈ 7 AM ET): /diag layer probes — any red feed rows
 *     land in one summary push.
 *
 * Manual test: GET /api/cron/health with `Authorization: Bearer $CRON_SECRET`.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const STALE_HOURS = 6
const REMIND_HOURS_UTC = [11, 15, 19, 23]
const DIAG_HOUR_UTC = 11

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const hour = new Date().getUTCHours()
  const out: Record<string, unknown> = {}

  // 1 + 2 — DB reachable, ingest fresh. Freshness is judged by COUNTING rows
  // inside the window, never by "fetch the newest row": an order-by-desc
  // fetch returns NULLs first in Postgres and is fooled by type quirks — on
  // Aug 5 it swore "39h silent" 28 minutes AFTER a theft alert processed
  // live data from the very same table. A count cannot be tricked.
  // Two clocks still matter: `timestamp` is the DEVICE's GPS time (backlog
  // replays stamp old), `created_at` (049) is when rows actually ARRIVED.
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const db = createServiceClient()
    const sinceIso = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString()

    const devQ = await db.from('asset_locations')
      .select('id', { count: 'exact', head: true }).gte('timestamp', sinceIso)
    if (devQ.error) throw new Error(devQ.error.message)
    const recentByDevice = devQ.count ?? 0

    // Pre-049 schema: no created_at → device-time count is the only signal.
    let recentByArrival: number | null = null
    const arrQ = await db.from('asset_locations')
      .select('id', { count: 'exact', head: true }).gte('created_at', sinceIso)
    if (!arrQ.error) recentByArrival = arrQ.count ?? 0

    out.recentByDevice = recentByDevice
    out.recentByArrival = recentByArrival

    const fresh = recentByDevice > 0 || (recentByArrival ?? 0) > 0
    if (!fresh && REMIND_HOURS_UTC.includes(hour)) {
      // For the human-readable age, fetch the newest NON-NULL stamps (report
      // only — the verdict above came from the counts).
      const newest = await db.from('asset_locations')
        .select('timestamp').not('timestamp', 'is', null)
        .order('timestamp', { ascending: false, nullsFirst: false }).limit(1)
      const newestIso = newest.data?.[0]?.timestamp as string | undefined
      const ageH = newestIso ? Math.round((Date.now() - Date.parse(newestIso)) / 3_600_000) : null
      await notifySystem(
        'trackers silent',
        ageH != null
          ? `No tracker data in the last ${STALE_HOURS}h (fleet-wide); newest row is ${ageH}h old (${newestIso}). Check flespi webhook + device power.`
          : 'No location rows found at all — ingest pipeline never ran today.'
      )
      out.notified = 'ingest-stale'
    } else if ((recentByArrival ?? 0) > 0 && recentByDevice === 0 && REMIND_HOURS_UTC.includes(hour)) {
      // Rows are arriving but every device timestamp is old — clock/backlog.
      await notifySystem(
        'tracker clock behind',
        `Data is arriving fine (${recentByArrival} rows in ${STALE_HOURS}h), but none carry a recent GPS timestamp — a tracker is replaying a backlog or has a bad clock. Trails may look stale until it catches up.`
      )
      out.notified = 'device-clock-behind'
    }

    // Per-device silence — the fleet-wide check goes green the moment ANY
    // source reports (e.g. a phone tracker), which masks a dead hardware
    // unit. Watch each IMEI unit (15-digit tracker_id) individually; phones
    // and BLE tags are sporadic by nature and are not outages.
    if (REMIND_HOURS_UTC.includes(hour) && out.notified !== 'ingest-stale') {
      const { data: hw } = await db
        .from('assets')
        .select('id, name, tracker_id')
        .eq('active', true)
        .not('tracker_id', 'is', null)
        .limit(100)
      const units = (hw ?? []).filter((a) => /^\d{15}$/.test(String(a.tracker_id ?? ''))).slice(0, 25)
      const sinceIso = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString()
      const stale: string[] = []
      for (const u of units) {
        // Count in the window — same reasoning as the fleet check above.
        const recent = await db.from('asset_locations')
          .select('id', { count: 'exact', head: true })
          .eq('asset_id', u.id).gte('timestamp', sinceIso)
        if (recent.error || (recent.count ?? 0) > 0) continue
        // A unit that has NEVER reported is mid-setup, not an outage.
        const ever = await db.from('asset_locations')
          .select('id', { count: 'exact', head: true }).eq('asset_id', u.id)
        if (ever.error || (ever.count ?? 0) === 0) continue
        const newest = await db.from('asset_locations')
          .select('timestamp').eq('asset_id', u.id).not('timestamp', 'is', null)
          .order('timestamp', { ascending: false, nullsFirst: false }).limit(1)
        const t = newest.data?.[0]?.timestamp ? Date.parse(newest.data[0].timestamp as string) : NaN
        stale.push(Number.isFinite(t) ? `${u.name}: ${Math.round((Date.now() - t) / 3_600_000)}h` : u.name)
      }
      out.staleUnits = stale
      if (stale.length) {
        await notifySystem(
          'tracker silent',
          `${stale.length === 1 ? 'A hardware tracker is' : `${stale.length} hardware trackers are`} silent while other sources report fine — ${stale.join(' · ')}. Check that unit's power/SIM (Hologram balance, OBD seated, flespi last-message).`
        )
        out.notified = out.notified ?? 'device-stale'
      }
    }
  } catch (err) {
    await notifySystem('database check failed', err instanceof Error ? err.message : 'unknown DB error')
    out.db = 'error'
  }

  // 3 — daily external-feed sweep via our own /diag probes.
  if (hour === DIAG_HOUR_UTC) {
    try {
      const origin = req.nextUrl.origin
      const r = await fetch(`${origin}/api/diag/layers`, { cache: 'no-store', signal: AbortSignal.timeout(45_000) })
      const j = await r.json() as { checks?: { key: string; ok: boolean }[] }
      // Key-presence rows are configuration status, not outages — skip them.
      const red = (j.checks ?? []).filter((c) => !c.ok && !c.key.endsWith('-key')).map((c) => c.key)
      out.diagRed = red
      if (red.length) {
        await notifySystem('map feeds failing', `Red on /diag: ${red.join(', ')} — open /diag for details.`)
      }
    } catch { out.diag = 'unreachable' }

    // 4 — the 30-day safety net (092): soft-deleted assets, buffered drawer
    // pings and old tracker moves past their window. One bounded call.
    try {
      const { createServiceClient } = await import('@/lib/supabase-server')
      const { data, error } = await createServiceClient().rpc('purge_retention', { keep_days: 30 })
      if (error) throw new Error(error.message)
      out.purged = Array.isArray(data) ? data[0] : data
    } catch (err) { out.purge = err instanceof Error ? err.message : 'failed' }
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), ...out })
}
