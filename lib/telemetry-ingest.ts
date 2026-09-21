import type { SupabaseClient } from '@supabase/supabase-js'
import { foldReadings } from './telemetry-catalog'

/**
 * The DB half of truck readings (115): fold one webhook batch's reports for
 * an asset into { key: { v, t, n, since } } and hand it to telemetry_merge,
 * which keeps the newest value per key on the asset's single row.
 *
 * Additive by design — a failure here never fails the fix that was just
 * stored. Before 115 lands (or on a DB without it) the RPC is missing and we
 * stay quiet: the map still works, the readings just wait for the migration.
 */
/** Keys a JSON body may carry that must never become object properties on
 *  our side — `JSON.parse` keeps an own `__proto__`, and object spread copies
 *  it into `raw` and the readings fold (sec-check, Sep 21). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** A shallow copy of `body` without the prototype keys, safe to spread and to
 *  store as `asset_locations.raw`. Non-objects come back as an empty bag. */
export function safeBag(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out
  for (const k of Object.keys(body as object)) {
    if (UNSAFE_KEYS.has(k)) continue
    out[k] = (body as Record<string, unknown>)[k]
  }
  return out
}

/**
 * The direct ingest routes' timestamp gate — the same window the flespi
 * webhook enforces: a string that parses, no more than five minutes in the
 * future and no older than 30 days. Returns the ISO form to store, `null`
 * when the caller sent none (use now), or `false` when it is not a time —
 * a garbage `t` stored once poisons `telemetry_merge`'s casts for that key.
 */
export function plausibleTimestamp(v: unknown, nowMs = Date.now()): string | null | false {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return false
  const ms = Date.parse(v)
  if (!Number.isFinite(ms) || ms > nowMs + 5 * 60_000 || ms < nowMs - 30 * 86_400_000) return false
  return new Date(ms).toISOString()
}

export async function recordTelemetry(
  db: SupabaseClient,
  assetId: string,
  companyId: string,
  rows: { timestamp: string; params: Record<string, unknown> }[],
): Promise<void> {
  if (!rows.length) return
  const readings = foldReadings(rows)
  if (!Object.keys(readings).length) return
  try {
    const { error } = await db.rpc('telemetry_merge', { p_asset: assetId, p_company: companyId, p_new: readings })
    // 42883 = function missing, 42P01 = table missing — the migration has not
    // applied yet. Anything else is worth a line in the log.
    if (error && error.code !== '42883' && error.code !== '42P01') {
      console.error(`telemetry_merge failed for ${assetId}: ${error.code} ${error.message}`)
    }
  } catch (e) {
    console.error(`telemetry_merge threw for ${assetId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
