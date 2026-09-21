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
