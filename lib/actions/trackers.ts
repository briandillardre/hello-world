'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { changeTracker, undoMove, softDeleteAsset, restoreAsset, type TrackerChange, type ChangeResult } from '@/lib/db/trackers'

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
  const denied = await requireEdit(); if (denied) return { ok: false, error: denied }
  const companyId = await getCurrentCompanyId()
  const res = await undoMove(companyId, moveId)
  refresh()
  return res
}

export async function restoreAssetAction(assetId: string): Promise<{ ok: boolean; error?: string; trackerReleased?: boolean }> {
  const denied = await requireEdit(); if (denied) return { ok: false, error: denied }
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
