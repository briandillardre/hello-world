'use server'

import { revalidatePath } from 'next/cache'
import { RECOVERY_DAYS, RECOVERY_MAX_DAYS } from '@/lib/location-policy'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Recovery mode (migrations 132 + 133): an Admin or the owner, with a
 * reason, authorizes recovery tracking of a missing asset — equipment or a
 * tool, never a person — for RECOVERY_DAYS, then it ends on its own unless
 * someone extends it, and never longer than RECOVERY_MAX_DAYS from its start
 * (after that: stop it and start a fresh one with a reason). While it runs,
 * phones off the clock report that asset's tag at its EXACT spot instead of
 * a ~250 m area (still never whose phone heard it; Admins and the owner read
 * it), the asset page wears a red banner and the map a red badge. Every
 * start / stop is a row in `asset_recovery` (who, when, why) and every
 * extension a row in the append-only `asset_recovery_extensions` (133).
 * Writes go through the service role after these checks — neither table has
 * write policies.
 */

type Reply = { ok: boolean; error?: string }

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** The caller may manage recovery: a real Admin or the owner, with edit, not
 *  inside a "view app as" preview. Returns their ids or the reason not. */
async function gate(): Promise<{ userId: string; companyId: string } | { error: string }> {
  const { getMyPermissions, getRealPermissions } = await import('@/lib/permissions-server')
  const { rankOf, RANK } = await import('@/lib/permissions')
  const [mine, real] = await Promise.all([getMyPermissions(), getRealPermissions()])
  if (mine.viewingAs) return { error: 'Read-only while viewing the app as someone else.' }
  if (!real.userId || !real.companyId) return { error: 'Sign in again.' }
  if (rankOf(real) < RANK.admin || !real.canEdit) return { error: 'Only Admins and the owner can start or stop recovery.' }
  return { userId: real.userId, companyId: real.companyId }
}

/** The asset, read with the caller's own client: RLS = their company and
 *  what they may see (111). Null = not theirs to put in recovery. */
async function readAsset(assetId: string): Promise<{ id: string; company_id: string; type: string | null } | null> {
  const { createClient } = await import('@/lib/supabase-server')
  const { data } = await createClient().from('assets').select('id, company_id, type').eq('id', assetId).maybeSingle()
  return (data as { id: string; company_id: string; type: string | null } | null) ?? null
}

/** Recovery finds missing equipment. A person's phone is tracked by the time
 *  clock or by their own choice (Go Live) — never by an Admin's say-so. */
const PEOPLE_NOT_EQUIPMENT = 'Recovery is for missing equipment and tools — a person can’t be put in recovery.'

function revalidate(assetId: string) {
  revalidatePath(`/assets/${assetId}`)
  revalidatePath('/map')
}

export async function startRecoveryAction(input: { assetId: string; reason: string; alertEventId?: string | null }): Promise<Reply> {
  if (isMock) return { ok: false, error: 'Not available in the demo.' }
  try {
    const g = await gate()
    if ('error' in g) return { ok: false, error: g.error }
    if (!isUuid(input?.assetId)) return { ok: false, error: 'Asset not found.' }
    const reason = String(input.reason ?? '').replace(/\s+/g, ' ').trim()
    if (reason.length < 3) return { ok: false, error: 'Say why — a few words is enough (for example "left the yard overnight").' }
    if (reason.length > 300) return { ok: false, error: 'Keep the reason under 300 characters.' }
    const asset = await readAsset(input.assetId)
    if (!asset || asset.company_id !== g.companyId) return { ok: false, error: 'Asset not found.' }
    if (asset.type === 'personnel') return { ok: false, error: PEOPLE_NOT_EQUIPMENT }

    const { createServiceClient, createClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    // One open recovery per asset. A running one = nothing to do; one that
    // ran out is closed at its expiry (ended_by NULL = it ran out) first.
    const { data: open } = await svc.from('asset_recovery').select('id, expires_at')
      .eq('asset_id', asset.id).is('ended_at', null).maybeSingle()
    if (open) {
      if (Date.parse(open.expires_at as string) > Date.now()) return { ok: true }
      await svc.from('asset_recovery').update({ ended_at: open.expires_at }).eq('id', open.id).is('ended_at', null)
    }
    // Started from a theft alert: kept for the audit trail when it really is this asset's.
    let alertEventId: string | null = null
    if (isUuid(input.alertEventId)) {
      const { data: ev } = await createClient().from('alert_events').select('id')
        .eq('id', input.alertEventId).eq('asset_id', asset.id).maybeSingle()
      alertEventId = (ev?.id as string | undefined) ?? null
    }
    const { error } = await svc.from('asset_recovery').insert({
      company_id: g.companyId, asset_id: asset.id, started_by: g.userId, reason,
      expires_at: new Date(Date.now() + RECOVERY_DAYS * 86_400_000).toISOString(),
      alert_event_id: alertEventId,
    })
    // 23505: someone started it a moment ago — it is running, which is what was asked.
    if (error && error.code !== '23505') return { ok: false, error: 'Could not start recovery — try again.' }
    revalidate(asset.id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not start recovery — try again.' }
  }
}

export async function extendRecoveryAction(assetId: string): Promise<Reply> {
  if (isMock) return { ok: false, error: 'Not available in the demo.' }
  try {
    const g = await gate()
    if ('error' in g) return { ok: false, error: g.error }
    if (!isUuid(assetId)) return { ok: false, error: 'Asset not found.' }
    const asset = await readAsset(assetId)
    if (!asset || asset.company_id !== g.companyId) return { ok: false, error: 'Asset not found.' }
    if (asset.type === 'personnel') return { ok: false, error: PEOPLE_NOT_EQUIPMENT }
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const { data: open } = await svc.from('asset_recovery').select('id, started_at, expires_at, extended_by, extended_at')
      .eq('asset_id', asset.id).is('ended_at', null).maybeSingle()
    if (!open || Date.parse(open.expires_at as string) <= Date.now()) {
      return { ok: false, error: 'This recovery already ended — start a new one.' }
    }
    // RECOVERY_DAYS from now, never past RECOVERY_MAX_DAYS from the start:
    // a recovery cannot be kept alive forever one extension at a time (133).
    const now = new Date()
    const capMs = Date.parse(open.started_at as string) + RECOVERY_MAX_DAYS * 86_400_000
    const untilMs = Math.min(now.getTime() + RECOVERY_DAYS * 86_400_000, capMs)
    const before = open.expires_at as string
    if (!Number.isFinite(untilMs) || untilMs <= Date.parse(before) + 60_000) {
      return { ok: false, error: `A recovery runs at most ${RECOVERY_MAX_DAYS} days. If it’s still missing, stop this one and start a new one with a reason.` }
    }
    const until = new Date(untilMs).toISOString()
    // Compare-and-set on the old expiry: two Admins extending at once write one extension.
    const { data: moved, error } = await svc.from('asset_recovery').update({
      expires_at: until, extended_by: g.userId, extended_at: now.toISOString(),
    }).eq('id', open.id).is('ended_at', null).eq('expires_at', before).select('id')
    if (error) return { ok: false, error: 'Could not extend it — try again.' }
    if (!moved?.length) return { ok: true } // someone else's extension just landed
    // Every extension is its own row; nobody (the server included) can rewrite one.
    const { error: logErr } = await svc.from('asset_recovery_extensions').insert({
      recovery_id: open.id, company_id: g.companyId, asset_id: asset.id,
      extended_by: g.userId, extended_at: now.toISOString(), expires_before: before, expires_after: until,
    })
    if (logErr) {
      // No unaudited extension: put it back as it was.
      await svc.from('asset_recovery').update({ expires_at: before, extended_by: open.extended_by ?? null, extended_at: open.extended_at ?? null })
        .eq('id', open.id).eq('expires_at', until)
      return { ok: false, error: 'Could not extend it — try again.' }
    }
    revalidate(asset.id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not extend it — try again.' }
  }
}

export async function stopRecoveryAction(assetId: string): Promise<Reply> {
  if (isMock) return { ok: false, error: 'Not available in the demo.' }
  try {
    const g = await gate()
    if ('error' in g) return { ok: false, error: g.error }
    if (!isUuid(assetId)) return { ok: false, error: 'Asset not found.' }
    const asset = await readAsset(assetId)
    if (!asset || asset.company_id !== g.companyId) return { ok: false, error: 'Asset not found.' }
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { error } = await createServiceClient().from('asset_recovery')
      .update({ ended_at: new Date().toISOString(), ended_by: g.userId })
      .eq('asset_id', asset.id).is('ended_at', null)
    if (error) return { ok: false, error: 'Could not stop it — try again.' }
    revalidate(asset.id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not stop it — try again.' }
  }
}
