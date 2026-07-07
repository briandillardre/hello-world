'use server'

import { revalidatePath } from 'next/cache'
import { createAsset, updateAsset } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import type { AssetType } from '@/lib/types'

export interface CreateAssetInput {
  name: string
  type: AssetType
  category?: string
  serial?: string
  photo_url?: string
  tracker_id?: string
  metadata?: Record<string, unknown>
}

/** Normalize a form string to a trimmed value or null (empty → null). */
function orNull(v: string | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

export async function createAssetAction(input: CreateAssetInput) {
  const companyId = await getCurrentCompanyId()

  const asset = await createAsset(companyId, {
    name: input.name.trim(),
    type: input.type,
    tracker_id: orNull(input.tracker_id),
    category: orNull(input.category),
    serial: orNull(input.serial),
    photo_url: orNull(input.photo_url),
    metadata: input.metadata ?? {},
  })

  revalidatePath('/assets')
  revalidatePath('/map')
  return asset
}

export async function updateAssetAction(
  id: string,
  input: Partial<CreateAssetInput> & { active?: boolean }
) {
  const asset = await updateAsset(id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.tracker_id !== undefined ? { tracker_id: orNull(input.tracker_id) } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  })

  revalidatePath('/assets')
  revalidatePath(`/assets/${id}`)
  revalidatePath('/map')
  return asset
}
