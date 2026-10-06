/**
 * Recovery mode (migrations 132 + 133) — explicitly authorized recovery
 * tracking of a missing asset. Reads only; the writes are
 * lib/actions/recovery.ts. Read with the caller's own client: RLS gives the
 * company's rows, follows the asset's visibility (111) and shows a
 * Prospective Client nothing. The REASON is not in what members may read
 * (133's column grants): it is read with the service role, for the rows the
 * caller could already see, and only when the caller manages recovery
 * (an Admin or the owner, not inside a "view app as" preview).
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
  /** Why it was started — null unless the reader manages recovery (133). */
  reason: string | null
  expiresAt: string
  extendedAt: string | null
  extendedByName: string | null
  endedAt: string | null
  endedByName: string | null
  /** True while it is running: not stopped and not run out. */
  active: boolean
}

type Raw = {
  id: string; asset_id: string; started_at: string; started_by: string | null; expires_at: string
  extended_at: string | null; extended_by: string | null; ended_at: string | null; ended_by: string | null
}

function isActive(r: Pick<Raw, 'ended_at' | 'expires_at'>, nowMs = Date.now()): boolean {
  return !r.ended_at && Date.parse(r.expires_at) > nowMs
}

/** This asset's recoveries, newest first (the running one first when there
 *  is one). `withReason` asks for the reasons too — granted only to a caller
 *  who manages recovery, checked here again. */
export async function getRecoveries(assetId: string, limit = 5, opts: { withReason?: boolean } = {}): Promise<RecoveryRow[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const db = createClient()
    const { data, error } = await db.from('asset_recovery')
      .select('id, asset_id, started_at, started_by, expires_at, extended_at, extended_by, ended_at, ended_by')
      .eq('asset_id', assetId)
      .order('started_at', { ascending: false })
      .limit(limit)
    if (error || !data?.length) return []
    const rows = data as Raw[]
    const reasons = opts.withReason ? await readReasons(rows.map((r) => r.id)) : new Map<string, string>()
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
      reason: reasons.get(r.id) ?? null,
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

/** The reasons for rows the caller already read under RLS — service role,
 *  and only for an Admin or the owner outside a preview. Empty otherwise. */
async function readReasons(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ids.length) return out
  try {
    const { getMyPermissions } = await import('../permissions-server')
    const { rankOf, RANK } = await import('../permissions')
    const perms = await getMyPermissions()
    if (perms.viewingAs || rankOf(perms) < RANK.admin) return out
    const { createServiceClient } = await import('../supabase-server')
    const { data } = await createServiceClient().from('asset_recovery').select('id, reason').in('id', ids)
    for (const r of data ?? []) out.set(r.id as string, String(r.reason ?? ''))
  } catch { /* no reasons — the card shows the rest */ }
  return out
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
