import type { SupabaseClient } from '@supabase/supabase-js'
import { assessPower, externalVolts, powerLostReason, silenceDiagnosis, type PowerFix } from './power-loss'

/**
 * The database half of lib/power-loss.ts: read a unit's recent fixes, decide,
 * write the `power_lost` alert (kind, no rule — same shape as fuel_low /
 * battery_low from 022) and clear it when power returns.
 */

/** Fixes to read per check. Moving units write one every 3–5 s, so this is
 *  ~4 minutes of driving — plenty to see a transition and its PERSIST_MS. A
 *  parked unit writes hourly, so the same window spans days. The batch just
 *  inserted is added on top (ship-check P1-3: a buffered packet of 60+
 *  battery rows filled the whole window and hid the transition for good). */
const WINDOW_ROWS = 60
const WINDOW_MAX = 400
/** A second loss within this many hours writes the event (the panel and the
 *  list stay truthful) but does not push: a port that drops at every key-off
 *  is a nightly fact, not a nightly page (ship-check P1-2). */
const QUIET_MS = 24 * 3_600_000
/** An event stamped this close to the run start is this same episode. */
const SAME_EPISODE_MS = 2 * 60_000

export interface PowerNote {
  reason: string
  severity: 'warning'
}

export interface PowerCheckOpts {
  /** Some fix in the batch just ingested read under POWERED_MIN_V. */
  lowInBatch: boolean
  /** Rows this batch inserted for the asset — widens the window past them. */
  inserted: number
}

/**
 * Called from ingest for every asset whose batch carried a power-pin reading.
 * Returns the alert line to push when a loss has just become a fact; null
 * otherwise. Never throws — the caller is the ingest path.
 *
 * Cost discipline: a powered truck with nothing open is answered by ONE
 * indexed select on alert_events — the 60-row read of raw telemetry happens
 * only when the batch carries a low reading (a loss may be forming) or an
 * alert is open (a restore may be arriving).
 */
export async function checkTruckPower(
  db: SupabaseClient,
  asset: { id: string; company_id: string; name: string },
  /** Resolved only when there is a line to write — most batches have none,
   *  and the company row should not be read on every flespi POST for it. */
  getTz: () => Promise<string>,
  opts: PowerCheckOpts,
): Promise<PowerNote | null> {
  try {
    if (!opts.lowInBatch) {
      const { data: open, error: openErr } = await db
        .from('alert_events')
        .select('id')
        .eq('asset_id', asset.id)
        .eq('kind', 'power_lost')
        .is('acknowledged_at', null)
        .limit(1)
      if (openErr || !open?.length) return null
    }

    const { data: rows, error } = await db
      .from('asset_locations')
      .select('timestamp, speed, raw')
      .eq('asset_id', asset.id)
      .not('timestamp', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(Math.min(WINDOW_MAX, WINDOW_ROWS + Math.max(0, opts.inserted)))
    if (error || !rows?.length) return null
    const fixes: PowerFix[] = rows.map((r) => ({
      timestamp: r.timestamp as string,
      volts: externalVolts(r.raw),
      speed: typeof r.speed === 'number' ? r.speed : null,
    }))
    const v = assessPower(fixes)

    if (v.change === 'lost' && v.since && v.at) {
      const sinceMs = Date.parse(v.since)
      const nowMs = Date.now()
      // Everything that bears on this loss in one indexed read: any OPEN
      // event (the plug never came back — same problem, no second alert),
      // any event stamped at this same run start (already reported, whether
      // or not someone cleared it), and any other episode in the quiet window.
      // A CLEARED event from an earlier episode must NOT block this one —
      // the final loss of a flapping plug is the alert that matters most.
      const floor = new Date(Math.min(sinceMs - SAME_EPISODE_MS, nowMs - QUIET_MS)).toISOString()
      const base = () => db.from('alert_events').select('triggered_at, acknowledged_at').eq('asset_id', asset.id).eq('kind', 'power_lost')
      const [open, recent] = await Promise.all([
        base().is('acknowledged_at', null).limit(1),
        base().gte('triggered_at', floor).order('triggered_at', { ascending: false }).limit(5),
      ])
      if (open.error || recent.error) return null
      const rowsPrior = [...(open.data ?? []), ...(recent.data ?? [])] as { triggered_at: string; acknowledged_at: string | null }[]
      const sameEpisode = rowsPrior.some((p) =>
        p.acknowledged_at == null || Math.abs(Date.parse(p.triggered_at) - sinceMs) <= SAME_EPISODE_MS)
      if (sameEpisode) return null
      const quiet = rowsPrior.some((p) => nowMs - Date.parse(p.triggered_at) < QUIET_MS)
      const { error: insErr } = await db.from('alert_events').insert({
        company_id: asset.company_id, asset_id: asset.id, kind: 'power_lost', triggered_at: v.since,
      })
      if (insErr || quiet) return null
      return { reason: powerLostReason(asset.name, v.since, v.at.speed, await getTz()), severity: 'warning' }
    }

    if (v.change === 'restored' && v.since) {
      // Power is back: the open alert clears itself. The map's red ring and
      // the bell follow acknowledged_at, so this is all it takes. Idempotent
      // — a repeat while the old battery run is still in the window is a
      // no-op update — so no freshness gate, which used to leave a slow
      // restore (records buffered in a dead zone) open forever.
      await db
        .from('alert_events')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('asset_id', asset.id)
        .eq('kind', 'power_lost')
        .is('acknowledged_at', null)
        .lt('triggered_at', v.since)
    }
    return null
  } catch (err) {
    console.warn('checkTruckPower failed', err instanceof Error ? err.message : err)
    return null
  }
}

/** The health cron's one-line reason for a silent unit. Never throws. */
export async function diagnoseSilence(
  db: SupabaseClient,
  assetId: string,
  last: { timestamp: string; speed: number | null; battery: number | null; raw: unknown },
  tz: string,
): Promise<string> {
  let powerLostAtIso: string | null = null
  try {
    const lastMs = Date.parse(last.timestamp)
    const { data } = await db
      .from('alert_events')
      .select('triggered_at')
      .eq('asset_id', assetId)
      .eq('kind', 'power_lost')
      .gte('triggered_at', new Date(lastMs - 48 * 3_600_000).toISOString())
      .order('triggered_at', { ascending: false })
      .limit(1)
    powerLostAtIso = (data?.[0]?.triggered_at as string | undefined) ?? null
  } catch { /* the diagnosis degrades to what the last fix says */ }
  try {
    return silenceDiagnosis({
      lastFixIso: last.timestamp,
      lastVolts: externalVolts(last.raw),
      lastSpeed: last.speed,
      battery: last.battery,
      powerLostAtIso,
      tz,
    })
  } catch {
    return 'Silent — no diagnosis available from its last fix.'
  }
}
