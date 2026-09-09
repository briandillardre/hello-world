'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { changeTracker, undoMove, softDeleteAsset, restoreAsset, type TrackerChange, type ChangeResult } from '@/lib/db/trackers'
import { parseTrackerId, MODELS, type DeviceModel } from '@/lib/devices'
import { upsertDevice } from '@/lib/db/devices'
import { createAsset } from '@/lib/db/assets'
import type { AssetType } from '@/lib/types'

async function actor(): Promise<string | null> {
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    return user?.id ?? null
  } catch { return null }
}

async function requireEdit(): Promise<string | null> {
  const perms = await getMyPermissions()
  return perms.canEdit ? null : 'Your role can view trackers but not change them.'
}

/** Undo / restore are /trackers actions: edit rights AND that view level
 *  (sec-check, Sep 5 — a role hidden from the page could still call them). */
async function requireTrackersEdit(): Promise<string | null> {
  const perms = await getMyPermissions()
  if (!perms.canEdit) return 'Your role can view trackers but not change them.'
  return perms.features.includes('trackers') ? null : 'Your role does not have the Trackers page.'
}

function refresh(...assetIds: (string | null | undefined)[]) {
  revalidatePath('/assets')
  revalidatePath('/trackers')
  revalidatePath('/assets/onboard')
  revalidatePath('/map')
  for (const id of assetIds) if (id) revalidatePath(`/assets/${id}`)
}

export async function changeTrackerAction(assetId: string, change: TrackerChange): Promise<ChangeResult> {
  const denied = await requireEdit(); if (denied) return { ok: false, error: denied }
  const companyId = await getCurrentCompanyId()
  const res = await changeTracker(companyId, await actor(), assetId, change)
  refresh(assetId, res.goTo)
  return res
}

export async function undoTrackerMoveAction(moveId: string): Promise<{ ok: boolean; error?: string; undone?: number }> {
  const denied = await requireTrackersEdit(); if (denied) return { ok: false, error: denied }
  const companyId = await getCurrentCompanyId()
  const res = await undoMove(companyId, moveId)
  refresh()
  return res
}

export async function restoreAssetAction(assetId: string): Promise<{ ok: boolean; error?: string; trackerReleased?: boolean }> {
  const denied = await requireTrackersEdit(); if (denied) return { ok: false, error: denied }
  const companyId = await getCurrentCompanyId()
  const res = await restoreAsset(companyId, assetId)
  refresh(assetId)
  return res
}

/** Delete = 30-day soft delete (092). The asset leaves every list and the
 *  map, its tracker goes to the drawer, and Trackers → Recently deleted can
 *  bring it back whole until the window closes. */
export async function softDeleteAssetAction(assetId: string): Promise<{ ok: boolean; error?: string }> {
  const denied = await requireEdit(); if (denied) return { ok: false, error: denied }
  const companyId = await getCurrentCompanyId()
  const res = await softDeleteAsset(companyId, assetId)
  refresh(assetId)
  return res
}


/**
 * Add a box to the drawer from its label — the customer's first step
 * (Brian, Sep 9: "added as trackers, then seamlessly added to an asset").
 * Accepts a 15-digit IMEI or a 12-hex tool-tag MAC; the model comes from
 * the number itself. No asset yet: that is the next tap, on the drawer row.
 */
export async function registerTrackerAction(raw: string): Promise<
  { ok: true; id: string; model: DeviceModel; modelName: string; existed: boolean; onAsset: { id: string; name: string } | null } | { ok: false; error: string }
> {
  const denied = await requireEdit(); if (denied) return { ok: false, error: denied }
  const parsed = parseTrackerId(raw)
  if ('error' in parsed) return { ok: false, error: parsed.error }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const db = createClient()
  const { data: existing } = await db.from('device_onboarding').select('imei').eq('company_id', companyId).eq('imei', parsed.id).maybeSingle()
  // Already on a machine? Say which, rather than adding a phantom drawer row.
  const ids = parsed.kind === 'mac' ? [parsed.id, `00000000-0000-0000-0000-${parsed.id}`] : [parsed.id]
  const { data: holder } = await db.from('assets').select('id, name').eq('company_id', companyId).eq('active', true).in('tracker_id', ids).limit(1).maybeSingle()
  if (!existing) {
    const res = await upsertDevice(companyId, { imei: parsed.id, model: parsed.model })
    if (!res.ok) return { ok: false, error: res.error ?? 'Could not add that tracker.' }
  }
  refresh()
  return { ok: true, id: parsed.id, model: parsed.model, modelName: MODELS[parsed.model].name, existed: !!existing, onAsset: holder ? { id: holder.id, name: holder.name } : null }
}

/**
 * Put a drawer tracker on a machine — an existing one without a tracker, or
 * a new one named right here. Same history rules as the machine page's
 * Tracker sheet (this IS that attach, with "as of now").
 */
export async function putOnAction(
  trackerId: string,
  dest: { mode: 'asset'; assetId: string } | { mode: 'new'; name: string; type: AssetType },
): Promise<{ ok: boolean; error?: string; assetId?: string }> {
  const denied = await requireEdit(); if (denied) return { ok: false, error: denied }
  const companyId = await getCurrentCompanyId()
  let assetId: string
  if (dest.mode === 'new') {
    const name = dest.name.trim().slice(0, 120)
    if (!name) return { ok: false, error: 'Name the machine.' }
    const { asset, error } = await createAsset(companyId, { name, type: dest.type, tracker_id: null, metadata: { source: 'trackers-put-on' } })
    if (error || !asset) return { ok: false, error: 'Could not create the machine.' }
    assetId = asset.id
  } else {
    assetId = dest.assetId
  }
  const res = await changeTracker(companyId, await actor(), assetId, { kind: 'attach', imei: trackerId, sinceIso: new Date().toISOString() })
  refresh(assetId)
  if (!res.ok) return { ok: false, error: res.error, assetId }
  return { ok: true, assetId }
}
