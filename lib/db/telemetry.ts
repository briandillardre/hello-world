import type { Readings } from '../telemetry-catalog'

/**
 * Truck readings, read side (115). Both readers use the CALLER's client, so
 * row-level security decides what comes back: the company's own assets, minus
 * anything the per-asset visibility ladder (111) hides from this person.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface TruckReadings {
  readings: Readings
  updatedAt: string
}

/** Newest value of every parameter this asset's tracker has sent. */
export async function getTruckReadings(assetId: string): Promise<TruckReadings | null> {
  if (isMock) return null
  try {
    const { createClient } = await import('../supabase-server')
    const { data, error } = await createClient()
      .from('asset_telemetry_latest')
      .select('readings, updated_at')
      .eq('asset_id', assetId)
      .maybeSingle()
    if (error || !data) return null
    const readings = (data.readings ?? {}) as Readings
    return { readings, updatedAt: data.updated_at as string }
  } catch {
    return null
  }
}

export interface TrendRow {
  day: string      // YYYY-MM-DD in the company's zone
  key: string
  n: number
  min: number
  max: number
  avg: number
  last: number
  lastTs: string
}

/**
 * Per-day min / max / avg of numeric readings over the last `days`, computed
 * in SQL from the raw history (telemetry_daily) — never pulled row by row.
 */
export async function getTruckTrend(assetId: string, keys: string[], days = 7, tz = 'America/New_York'): Promise<TrendRow[]> {
  if (isMock || !keys.length) return []
  try {
    const { createClient } = await import('../supabase-server')
    const { data, error } = await createClient().rpc('telemetry_daily', {
      p_asset: assetId,
      p_keys: keys.slice(0, 12),
      p_days: Math.min(31, Math.max(1, Math.round(days))),
      p_tz: tz,
    })
    if (error || !Array.isArray(data)) return []
    return (data as { day: string; key: string; n: number; vmin: number; vmax: number; vavg: number; vlast: number; last_ts: string }[])
      .map((r) => ({ day: r.day, key: r.key, n: r.n, min: r.vmin, max: r.vmax, avg: r.vavg, last: r.vlast, lastTs: r.last_ts }))
  } catch {
    return []
  }
}

/** Which readings earn a trend on the asset page, in preference order. */
export const TREND_CANDIDATES = [
  'can.engine.coolant.temperature',
  'external.powersource.voltage',
  'can.fuel.level',
  'can.engine.rpm',
  'can.engine.load.level',
  'gsm.signal.level',
  'battery.voltage',
  'custom.param.25016',
]

export function pickTrendKeys(readings: Readings, limit = 4): string[] {
  return TREND_CANDIDATES.filter((k) => typeof readings[k]?.v === 'number').slice(0, limit)
}
