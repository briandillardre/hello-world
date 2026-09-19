import { NextRequest, NextResponse } from 'next/server'
import { notifySystem } from '@/lib/monitor'
import { diagnoseSilence } from '@/lib/power-loss-check'
import { clockLabel, shortName } from '@/lib/power-loss'
import { readState, writeState } from '@/lib/system-state'

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
 *  2b. Per-unit silence — hourly, but announced on CHANGE only (a unit went
 *     dark → once, with why; it came back → once), remembered across runs
 *     in system_state (112).
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
/** Where the silent-unit set lives between runs (system_state, 112). */
const STATE_KEY = 'health.silent_units'
/** The founder feed is one person's phone; clock labels read in his zone. */
const FOUNDER_TZ = process.env.FOUNDER_TZ || 'America/New_York'

type SilentUnit = { name: string; since: string; why: string; firstSeenAt: string }

/** The stored blob is ours, but a row edited by hand or written by an older
 *  build must not be able to wedge every hourly run (sec-check): anything
 *  that is not a well-formed entry is dropped and rewritten this run. */
function sanitizeSilent(v: unknown): Record<string, SilentUnit> {
  const out: Record<string, SilentUnit> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    const u = (e && typeof e === 'object' ? e : {}) as Partial<SilentUnit>
    if (typeof u.name !== 'string' || typeof u.since !== 'string' || !Number.isFinite(Date.parse(u.since))) continue
    out[id] = {
      name: u.name, since: u.since,
      why: typeof u.why === 'string' ? u.why : '',
      firstSeenAt: typeof u.firstSeenAt === 'string' ? u.firstSeenAt : u.since,
    }
  }
  return out
}

export async function GET(req: NextRequest) {
  // Fails closed like the other crons that write state or page a human: an
  // unset secret is a misconfiguration, not an invitation (sec-check).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
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
    //
    // Hourly, and about CHANGE: the silent set is remembered in system_state
    // (112) and diffed against the last run, so a unit that goes dark is
    // announced once, WITH its diagnosis, and heard from again only when it
    // comes back. The old version re-sent the same two dead units every four
    // hours (Brian, Sep 19: three identical pushes in sixteen hours).
    const { data: hw, error: hwErr } = out.notified !== 'ingest-stale'
      ? await db.from('assets').select('id, name, tracker_id').eq('active', true).not('tracker_id', 'is', null).order('id').limit(200)
      : { data: null, error: null }
    // A failed roster read must not be read as "every unit came back".
    if (hwErr) out.silentCheck = 'assets query failed'
    if (out.notified !== 'ingest-stale' && !hwErr) {
      const units = (hw ?? []).filter((a) => /^\d{15}$/.test(String(a.tracker_id ?? ''))).slice(0, 60)
      const sinceIso = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString()
      // `undefined` = no memory at all (pre-112, or the read failed): fall
      // back to the old four-a-day cadence rather than go quiet about a dead
      // unit. `null` = memory works, nothing stored yet.
      const rawPrev = await readState<unknown>(db, STATE_KEY)
      const prev = rawPrev === undefined ? undefined : rawPrev === null ? null : sanitizeSilent(rawPrev)
      if (prev === undefined) out.silentState = 'unavailable'
      const before = prev ?? {}
      const silent: Record<string, SilentUnit> = {}
      let partial = false
      for (const u of units) {
        // Count in the window — same reasoning as the fleet check above.
        const recent = await db.from('asset_locations')
          .select('id', { count: 'exact', head: true })
          .eq('asset_id', u.id).gte('timestamp', sinceIso)
        if (recent.error) {
          // Unknown, not healthy: a unit we already had as silent stays so.
          partial = true
          if (before[u.id]) silent[u.id] = before[u.id]
          continue
        }
        if ((recent.count ?? 0) > 0) continue
        // Its newest fix: what the unit said last IS the diagnosis. A unit
        // that has NEVER reported is mid-setup, not an outage.
        const newest = await db.from('asset_locations')
          .select('timestamp, speed, battery, raw').eq('asset_id', u.id).not('timestamp', 'is', null)
          .order('timestamp', { ascending: false, nullsFirst: false }).limit(1)
        if (newest.error) {
          partial = true
          if (before[u.id]) silent[u.id] = before[u.id]
          continue
        }
        const last = newest.data?.[0]
        if (!last?.timestamp) continue
        const why = await diagnoseSilence(db, u.id, {
          timestamp: last.timestamp as string,
          speed: typeof last.speed === 'number' ? last.speed : null,
          battery: typeof last.battery === 'number' ? last.battery : null,
          raw: last.raw,
        }, FOUNDER_TZ)
        silent[u.id] = { name: u.name, since: last.timestamp as string, why, firstSeenAt: new Date().toISOString() }
      }
      const hoursAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000))
      out.staleUnits = Object.values(silent).map((s) => `${s.name}: ${hoursAgo(s.since)}h`)
      if (partial) out.silentCheck = 'partial'

      const unitIds = new Set(units.map((u) => u.id))
      const newly = Object.keys(silent).filter((id) => !before[id])
      // "Back" means it reported again. A unit that left the roster (deleted,
      // deactivated, tracker taken off) is dropped from the watch quietly.
      const back = Object.keys(before).filter((id) => !silent[id] && unitIds.has(id))
      const gone = Object.keys(before).filter((id) => !silent[id] && !unitIds.has(id))
      for (const id of Object.keys(silent)) if (before[id]?.firstSeenAt) silent[id].firstSeenAt = before[id].firstSeenAt

      if (newly.length && (prev !== undefined || REMIND_HOURS_UTC.includes(hour))) {
        // ntfy shows ~800 chars: three full diagnoses, names for the rest.
        const lines = newly.slice(0, 3).map((id) => `${shortName(silent[id].name)} — silent ${hoursAgo(silent[id].since)}h. ${silent[id].why}`)
        const rest = newly.slice(3).map((id) => `${shortName(silent[id].name)} (${hoursAgo(silent[id].since)}h)`)
        if (rest.length) lines.push(`Also silent: ${rest.join(', ')}`)
        const still = Object.keys(silent).filter((id) => before[id]).map((id) => `${shortName(silent[id].name)} (${hoursAgo(silent[id].since)}h)`)
        if (still.length) lines.push(`Still silent: ${still.join(', ')}`)
        await notifySystem(newly.length === 1 ? 'tracker silent' : `${newly.length} trackers silent`, lines.join('\n'))
        out.notified = out.notified ?? 'device-stale'
      }
      if (back.length && prev !== undefined) {
        await notifySystem(
          back.length === 1 ? 'tracker back' : `${back.length} trackers back`,
          back.map((id) => `${shortName(before[id].name)} is reporting again — it had been silent since ${clockLabel(Date.parse(before[id].since), FOUNDER_TZ)}.`).join('\n'),
        )
      }
      if (prev !== undefined && (prev === null || newly.length || back.length || gone.length)) {
        await writeState(db, STATE_KEY, silent)
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

    // 5 — photo objects nobody finalized (sec-check on 101): a signed upload
    // that never became a field_photos row is removed after a day. Bounded:
    // companies with photo activity this week, up to 1000 objects each.
    try {
      const { createServiceClient } = await import('@/lib/supabase-server')
      const svc = createServiceClient()
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data: recent } = await svc.from('field_photos').select('company_id').gte('created_at', since).limit(5000)
      const companies = Array.from(new Set((recent ?? []).map((r) => r.company_id as string))).slice(0, 50)
      let swept = 0
      for (const co of companies) {
        const { data: objects } = await svc.storage.from('field-photos').list(`${co}/photos`, { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } })
        const stale = (objects ?? []).filter((o) => o.name && Date.parse(o.created_at ?? '') < Date.now() - 86_400_000)
        if (!stale.length) continue
        const { data: known } = await svc.from('field_photos').select('url, thumb_url').eq('company_id', co)
        const keep = new Set<string>()
        for (const k of known ?? []) for (const u of [k.url, k.thumb_url]) if (typeof u === 'string') keep.add(u.slice(u.lastIndexOf('/') + 1))
        const orphans = stale.filter((o) => !keep.has(o.name)).map((o) => `${co}/photos/${o.name}`)
        if (orphans.length) { await svc.storage.from('field-photos').remove(orphans.slice(0, 200)); swept += Math.min(200, orphans.length) }
      }
      out.photoOrphansSwept = swept
    } catch (err) { out.photoSweep = err instanceof Error ? err.message : 'failed' }
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), ...out })
}
