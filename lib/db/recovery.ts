/**
 * Recovery mode (migration 132) — explicitly authorized recovery tracking of
 * a missing asset. Reads only; the writes are lib/actions/recovery.ts. Read
 * with the caller's own client: RLS gives the company's rows, follows the
 * asset's visibility (111) and shows a Prospective Client nothing.
 * docs/LOCATION-PRIVACY.md.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export { RECOVERY_DAYS } from '../location-policy'

export interface RecoveryRow {
  id: string
  assetId: string
  startedAt: string
  startedByName: string | null
  reason: string
  expiresAt: string
  extendedAt: string | null
  extendedByName: string | null
  endedAt: string | null
  endedByName: string | null
  /** True while it is running: not stopped and not run out. */
  active: boolean
}

type Raw = {
  id: string; asset_id: string; started_at: string; started_by: string | null; reason: string; expires_at: string
  extended_at: string | null; extended_by: string | null; ended_at: string | null; ended_by: string | null
}

function isActive(r: Pick<Raw, 'ended_at' | 'expires_at'>, nowMs = Date.now()): boolean {
  return !r.ended_at && Date.parse(r.expires_at) > nowMs
}

/** This asset's recoveries, newest first (the running one first when there is one). */
export async function getRecoveries(assetId: string, limit = 5): Promise<RecoveryRow[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const db = createClient()
    const { data, error } = await db.from('asset_recovery')
      .select('id, asset_id, started_at, started_by, reason, expires_at, extended_at, extended_by, ended_at, ended_by')
      .eq('asset_id', assetId)
      .order('started_at', { ascending: false })
      .limit(limit)
    if (error || !data?.length) return []
    const rows = data as Raw[]
    const ids = Array.from(new Set(rows.flatMap((r) => [r.started_by, r.extended_by, r.ended_by]).filter((x): x is string => !!x)))
    const names = new Map<string, string>()
    if (ids.length) {
      const { data: people } = await db.from('profiles').select('id, name').in('id', ids)
      for (const p of people ?? []) names.set(p.id as string, (p.name as string) || 'Someone')
    }
    const name = (id: string | null) => (id ? names.get(id) ?? 'Someone' : null)
    return rows.map((r) => ({
      id: r.id,
      assetId: r.asset_id,
      startedAt: r.started_at,
      startedByName: name(r.started_by),
      reason: r.reason,
      expiresAt: r.expires_at,
      extendedAt: r.extended_at,
      extendedByName: name(r.extended_by),
      // A row that ran out is closed lazily; until then it reads as ended at its expiry.
      endedAt: r.ended_at ?? (Date.parse(r.expires_at) <= Date.now() ? r.expires_at : null),
      endedByName: name(r.ended_by),
      active: isActive(r),
    }))
  } catch {
    return []
  }
}

/** Every asset in recovery right now → when it started and when it ends —
 *  the map's red badge. Empty in demo mode or before 132. */
export async function getActiveRecoveries(companyId: string): Promise<Map<string, { startedAt: string; endsAt: string }>> {
  const out = new Map<string, { startedAt: string; endsAt: string }>()
  if (isMock) return out
  try {
    const { createClient } = await import('../supabase-server')
    const { data, error } = await createClient().from('asset_recovery')
      .select('asset_id, started_at, expires_at')
      .eq('company_id', companyId).is('ended_at', null).gt('expires_at', new Date().toISOString())
      .limit(500)
    if (error) return out
    for (const r of data ?? []) out.set(r.asset_id as string, { startedAt: r.started_at as string, endsAt: r.expires_at as string })
  } catch { /* additive */ }
  return out
}
