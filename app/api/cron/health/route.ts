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

  // 1 + 2 — DB reachable, ingest fresh. Two clocks matter: `timestamp` is the
  // DEVICE's GPS time (a backlog replay or skewed clock makes it old while
  // data pours in), `created_at` (049) is when rows actually ARRIVE. Silence
  // is judged on arrival; a big gap between the two is its own message.
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const db = createServiceClient()
    const { data, error } = await db
      .from('asset_locations') // the real table — 'locations' never existed, so every hourly check cried wolf
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1)
    if (error) throw new Error(error.message)
    const newestDevice = data?.[0]?.timestamp ? new Date(data[0].timestamp).getTime() : 0

    // Pre-049 schema: no created_at → fall back to judging on device time.
    let newestArrival = 0
    const arrivalQ = await db.from('asset_locations')
      .select('created_at').order('created_at', { ascending: false }).limit(1)
    if (!arrivalQ.error && arrivalQ.data?.[0]?.created_at) {
      newestArrival = new Date(arrivalQ.data[0].created_at as string).getTime()
    }
    const judgeMs = newestArrival || newestDevice
    const ageH = judgeMs ? (Date.now() - judgeMs) / 3_600_000 : Infinity
    const deviceAgeH = newestDevice ? (Date.now() - newestDevice) / 3_600_000 : Infinity
    out.ingestAgeHours = Number.isFinite(ageH) ? Math.round(ageH * 10) / 10 : null
    out.deviceAgeHours = Number.isFinite(deviceAgeH) ? Math.round(deviceAgeH * 10) / 10 : null

    if (ageH > STALE_HOURS && REMIND_HOURS_UTC.includes(hour)) {
      await notifySystem(
        'trackers silent',
        judgeMs
          ? `No tracker data for ${Math.round(ageH)}h (fleet-wide). Check flespi webhook + device power.`
          : 'No location rows found at all — ingest pipeline never ran today.'
      )
      out.notified = 'ingest-stale'
    } else if (newestArrival && deviceAgeH - ageH > STALE_HOURS && REMIND_HOURS_UTC.includes(hour)) {
      // Data is arriving but stamped hours in the past — clock/backlog, not an outage.
      await notifySystem(
        'tracker clock behind',
        `Data is arriving fine, but the newest GPS timestamp is ${Math.round(deviceAgeH)}h old — a tracker is replaying a backlog or has a bad clock. Trails may look stale until it catches up.`
      )
      out.notified = 'device-clock-behind'
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
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), ...out })
}
