'use server'

import { revalidatePath } from 'next/cache'
import { RECOVERY_DAYS } from '@/lib/location-policy'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Recovery mode (migration 132): an Admin or the owner, with a reason,
 * authorizes recovery tracking of a missing asset — for RECOVERY_DAYS, then
 * it ends on its own unless someone extends it. While it runs, phones off
 * the clock report that asset's tag at its EXACT spot instead of a ~250 m
 * area (still never whose phone heard it), the asset page wears a red
 * banner and the map a red badge. Every start / extend / stop is a row in
 * `asset_recovery` (who, when, why). Writes go through the service role
 * after these checks — the table has no write policies.
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
async function readAsset(assetId: string): Promise<{ id: string; company_id: string } | null> {
  const { createClient } = await import('@/lib/supabase-server')
  const { data } = await createClient().from('assets').select('id, company_id').eq('id', assetId).maybeSingle()
  return (data as { id: string; company_id: string } | null) ?? null
}

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
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const { data: open } = await svc.from('asset_recovery').select('id, expires_at')
      .eq('asset_id', asset.id).is('ended_at', null).maybeSingle()
    if (!open || Date.parse(open.expires_at as string) <= Date.now()) {
      return { ok: false, error: 'This recovery already ended — start a new one.' }
    }
    const now = new Date()
    const { error } = await svc.from('asset_recovery').update({
      expires_at: new Date(now.getTime() + RECOVERY_DAYS * 86_400_000).toISOString(),
      extended_by: g.userId, extended_at: now.toISOString(),
    }).eq('id', open.id).is('ended_at', null)
    if (error) return { ok: false, error: 'Could not extend it — try again.' }
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
