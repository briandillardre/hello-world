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

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Upload an asset photo to the public `asset-photos` bucket and return its
 * public URL. Uses the service client (bucket has no client write policies),
 * namespaced under the company id. Returns null in demo mode or on failure —
 * a failed photo upload should never block saving the asset itself.
 */
async function uploadAssetPhoto(companyId: string, file: File): Promise<string | null> {
  if (isMock) return null
  if (!file.size || !file.type.startsWith('image/')) return null
  if (file.size > 4 * 1024 * 1024) return null

  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const supabase = createServiceClient()
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${companyId}/${crypto.randomUUID()}.${ext}`

    const { error } = await supabase.storage
      .from('asset-photos')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (error) {
      console.error('Asset photo upload failed', error)
      return null
    }
    return supabase.storage.from('asset-photos').getPublicUrl(path).data.publicUrl
  } catch (err) {
    console.error('Asset photo upload failed', err)
    return null
  }
}

export async function createAssetAction(input: CreateAssetInput, photoForm?: FormData) {
  const companyId = await getCurrentCompanyId()

  // A captured/chosen photo (FormData) wins over a pasted URL.
  let photoUrl = orNull(input.photo_url)
  const file = photoForm?.get('photo')
  if (file instanceof File && file.size > 0) {
    photoUrl = (await uploadAssetPhoto(companyId, file)) ?? photoUrl
  }

  const asset = await createAsset(companyId, {
    name: input.name.trim(),
    type: input.type,
    tracker_id: orNull(input.tracker_id),
    category: orNull(input.category),
    serial: orNull(input.serial),
    photo_url: photoUrl,
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
