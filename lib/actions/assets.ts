'use server'

import { revalidatePath } from 'next/cache'
import { createAsset, updateAsset, addAssetPhotos, deleteAssetPhoto, getAssetPhotos, setAssetPhotoOrder } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import type { AssetType } from '@/lib/types'

/** Document-folder link on an asset (Dropbox/Drive/etc.) — direct column update. */
export async function saveAssetFolderAction(id: string, folderUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = folderUrl.trim()
    if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: 'Enter a full link starting with https://' }
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('assets').update({ folder_url: url || null }).eq('id', id)
    if (error) {
      if (error.code === '42703') return { ok: false, error: 'Run migration 032 first.' }
      return { ok: false, error: error.message }
    }
    revalidatePath(`/assets/${id}`)
    revalidatePath('/map')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'failed' }
  }
}

export interface CreateAssetInput {
  name: string
  type: AssetType
  category?: string
  serial?: string
  photo_url?: string
  /** Document folder URL — stored null when blank. */
  folder_url?: string
  tracker_id?: string
  metadata?: Record<string, unknown>
  // Cost structure — numbers or null (form converts empty inputs to null)
  hourly_rate?: number | null
  mileage_rate?: number | null
  daily_cost?: number | null
  purchase_price?: number | null
  purchase_value?: number | null
}

/** Normalize a form string to a trimmed value or null (empty → null). */
function orNull(v: string | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

/** Coerce a cost field to a non-negative finite number or null. */
function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
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

/**
 * Upload every image in a photo FormData (repeatable `photo` field + a parallel
 * JSON `labels` array) and return {url,label} for each that succeeded. Order is
 * preserved so the first becomes the asset's hero image.
 */
async function uploadPhotoSet(companyId: string, photoForm?: FormData): Promise<{ url: string; label: string | null }[]> {
  if (!photoForm) return []
  const files = photoForm.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0)
  if (!files.length) return []
  let labels: (string | null)[] = []
  try {
    const raw = photoForm.get('labels')
    if (typeof raw === 'string') labels = JSON.parse(raw)
  } catch { /* labels are optional */ }
  const out: { url: string; label: string | null }[] = []
  for (let i = 0; i < files.length; i++) {
    const url = await uploadAssetPhoto(companyId, files[i])
    if (url) out.push({ url, label: (labels[i] ?? null) || null })
  }
  return out
}

/** Translate raw Postgres failures into words a user can act on. */
function friendlyAssetError(err: { code?: string; message: string }): string {
  if (err.code === '23505') {
    return 'That tracker/tag ID is already on another asset — each ID can only live on one. Search your Assets list for it (it may be on an inactive asset).'
  }
  return `Could not save: ${err.message}`
}

export async function createAssetAction(input: CreateAssetInput, photoForm?: FormData):
  Promise<{ ok: boolean; asset?: import('@/lib/types').Asset | null; error?: string }> {
  const companyId = await getCurrentCompanyId()

  // Captured/chosen photos win over a pasted URL. The first uploaded photo
  // becomes the hero (the map panel + list thumbnail); the rest form the gallery.
  const uploaded = await uploadPhotoSet(companyId, photoForm)
  const photoUrl = orNull(input.photo_url) ?? uploaded[0]?.url ?? null

  const { asset, error } = await createAsset(companyId, {
    name: input.name.trim(),
    type: input.type,
    tracker_id: orNull(input.tracker_id),
    category: orNull(input.category),
    serial: orNull(input.serial),
    folder_url: orNull(input.folder_url),
    photo_url: photoUrl,
    hourly_rate: numOrNull(input.hourly_rate),
    mileage_rate: numOrNull(input.mileage_rate),
    daily_cost: numOrNull(input.daily_cost),
    purchase_price: numOrNull(input.purchase_price),
    purchase_value: numOrNull(input.purchase_value),
    metadata: input.metadata ?? {},
  })

  if (error) return { ok: false, error: friendlyAssetError(error) }

  if (asset && uploaded.length) await addAssetPhotos(companyId, asset.id, uploaded)

  revalidatePath('/assets')
  revalidatePath('/map')
  return { ok: true, asset }
}

/** Scan-to-map (Brian, Aug 28: "get the devices QUICKLY, scan QR code or
 *  similar, and they show up on the map — then I can edit them"). One scan
 *  of the IMEI barcode on the tracker's box creates the asset with a
 *  placeholder name; the dot appears the moment the device first reports.
 *  Renaming/rates/icon come later on the edit form. */
export async function quickAddTrackerAction(raw: string, kind: 'vehicle' | 'equipment'):
  Promise<{ ok: boolean; asset?: { id: string; name: string } | null; existing?: { id: string; name: string }; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode — scanning works once connected to your real account.' }
  // Teltonika box labels carry the IMEI as a barcode/QR; scanned payloads can
  // wrap it in other text, so take the first 15-digit run.
  const imei = (String(raw).match(/\d{15}/) ?? [])[0]
  if (!imei) return { ok: false, error: 'No 15-digit IMEI in that code — scan the IMEI barcode on the box, or type the number.' }

  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  // Already claimed → hand back the existing asset instead of erroring; the
  // scan flow is batch-first and re-scanning a box must be harmless.
  const { data: dup } = await supabase.from('assets')
    .select('id, name').eq('company_id', companyId).eq('tracker_id', imei).limit(1)
  if (dup?.[0]) return { ok: true, existing: { id: dup[0].id, name: dup[0].name } }

  const { asset, error } = await createAsset(companyId, {
    name: (kind === 'vehicle' ? 'New truck …' : 'New machine …') + imei.slice(-4),
    type: kind,
    tracker_id: imei,
    category: null, serial: null, folder_url: null, photo_url: null,
    hourly_rate: null, mileage_rate: null, daily_cost: null,
    purchase_price: null, purchase_value: null,
    metadata: {},
  })
  if (error) return { ok: false, error: friendlyAssetError(error) }
  revalidatePath('/assets')
  revalidatePath('/map')
  return { ok: true, asset: asset ? { id: asset.id, name: asset.name } : null }
}

/** Remove one gallery photo, then set the hero/thumbnail to whatever is now
 *  first (or null when the gallery is empty). */
export async function deleteAssetPhotoAction(assetId: string, photoId: string) {
  if (isMock) return
  const companyId = await getCurrentCompanyId()
  await deleteAssetPhoto(companyId, photoId)
  const remaining = await getAssetPhotos(assetId)
  await updateAsset(assetId, { photo_url: remaining[0]?.url ?? null }) // best-effort hero re-pick
  revalidatePath('/assets')
  revalidatePath(`/assets/${assetId}`)
  revalidatePath('/map')
}

/** Persist a drag-reordered gallery; the first photo becomes the thumbnail. */
export async function reorderAssetPhotosAction(assetId: string, orderedIds: string[]) {
  if (isMock) return
  const companyId = await getCurrentCompanyId()
  await setAssetPhotoOrder(companyId, assetId, orderedIds)
  const photos = await getAssetPhotos(assetId)
  await updateAsset(assetId, { photo_url: photos[0]?.url ?? null })
  revalidatePath('/assets')
  revalidatePath(`/assets/${assetId}`)
  revalidatePath('/map')
}

export async function updateAssetAction(
  id: string,
  input: Partial<CreateAssetInput> & { active?: boolean },
  photoForm?: FormData
): Promise<{ ok: boolean; asset?: import('@/lib/types').Asset | null; error?: string }> {
  const companyId = await getCurrentCompanyId()

  // New photos append to the gallery. Hero is NOT taken from the form (the
  // gallery + delete action own it) — that avoids an edit resending a stale
  // hero after a photo was just deleted. Promote a hero only when none exists.
  const uploaded = await uploadPhotoSet(companyId, photoForm)
  let heroPatch: { photo_url?: string } = {}
  if (uploaded.length) {
    await addAssetPhotos(companyId, id, uploaded)
    if (!isMock) {
      const { createClient } = await import('@/lib/supabase-server')
      const { data: cur } = await createClient().from('assets').select('photo_url').eq('id', id).maybeSingle()
      if (!cur?.photo_url) heroPatch = { photo_url: uploaded[0].url }
    }
  }

  const { asset, error } = await updateAsset(id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.tracker_id !== undefined ? { tracker_id: orNull(input.tracker_id) } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.category !== undefined ? { category: orNull(input.category) } : {}),
    ...(input.serial !== undefined ? { serial: orNull(input.serial) } : {}),
    ...(input.folder_url !== undefined ? { folder_url: orNull(input.folder_url) } : {}),
    ...(input.hourly_rate !== undefined ? { hourly_rate: numOrNull(input.hourly_rate) } : {}),
    ...(input.mileage_rate !== undefined ? { mileage_rate: numOrNull(input.mileage_rate) } : {}),
    ...(input.daily_cost !== undefined ? { daily_cost: numOrNull(input.daily_cost) } : {}),
    ...(input.purchase_price !== undefined ? { purchase_price: numOrNull(input.purchase_price) } : {}),
    ...(input.purchase_value !== undefined ? { purchase_value: numOrNull(input.purchase_value) } : {}),
    ...heroPatch,
  })

  if (error) return { ok: false, error: friendlyAssetError(error) }

  revalidatePath('/assets')
  revalidatePath(`/assets/${id}`)
  revalidatePath('/map')
  return { ok: true, asset }
}


export interface ReassignTrackerInput {
  /** ISO timestamp of the physical tracker swap. */
  swapAtIso: string
  /** Is THIS record the vehicle the tracker is in now (keeps it), or the old
   *  one it just left (loses it)? */
  currentRole: 'new' | 'old'
  /** The other vehicle: create a fresh record or reuse an existing (trackerless) one. */
  other: { mode: 'new'; name: string; type: AssetType } | { mode: 'existing'; assetId: string }
}

/**
 * Move a tracker (IMEI) between vehicles and split the location history at the
 * swap moment, so each vehicle keeps only its own past.
 *
 *  - currentRole 'old'  → the tracker LEAVES this record for `other`. This
 *    record keeps everything before the swap; `other` gets the tracker + all
 *    pings from the swap onward. (The normal "device moved to a new truck" case.)
 *  - currentRole 'new'  → the tracker STAYS here; `other` is the previous
 *    vehicle and receives all pings BEFORE the swap. (Fixes a record that was
 *    just renamed onto a new truck, conflating two vehicles' history.)
 */
export async function reassignTrackerAction(currentId: string, input: ReassignTrackerInput):
  Promise<{ ok: boolean; otherId?: string; moved?: number; error?: string }> {
  if (isMock) return { ok: false, error: 'Not available in demo mode.' }
  const swapMs = Date.parse(input.swapAtIso)
  if (Number.isNaN(swapMs)) return { ok: false, error: 'Invalid swap date/time.' }

  const companyId = await getCurrentCompanyId()
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  const { data: current } = await db
    .from('assets').select('id, company_id, tracker_id, name, type')
    .eq('id', currentId).eq('company_id', companyId).maybeSingle()
  if (!current) return { ok: false, error: 'Asset not found.' }
  const trackerId = current.tracker_id
  if (!trackerId) return { ok: false, error: 'This asset has no tracker to reassign.' }

  // Resolve the "other" vehicle.
  let otherId: string
  if (input.other.mode === 'existing') {
    const { data: other } = await db
      .from('assets').select('id, tracker_id')
      .eq('id', input.other.assetId).eq('company_id', companyId).maybeSingle()
    if (!other) return { ok: false, error: 'Destination vehicle not found.' }
    if (input.currentRole === 'old' && other.tracker_id)
      return { ok: false, error: 'That vehicle already has a tracker. Pick one without a tracker.' }
    otherId = other.id
  } else {
    const name = input.other.name.trim()
    if (!name) return { ok: false, error: 'Name the other vehicle.' }
    const { data: created, error } = await db
      .from('assets')
      .insert({ company_id: companyId, name, type: input.other.type, active: true, metadata: {}, tracker_id: null })
      .select('id').single()
    if (error || !created) return { ok: false, error: 'Could not create the new vehicle.' }
    otherId = created.id
  }

  // Which record keeps the tracker, and which direction the history moves.
  // keeper = record the tracker stays/goes to (also the vehicle NOW).
  // mover  = record that receives the split-off history.
  const iso = new Date(swapMs).toISOString()
  let moved = 0
  if (input.currentRole === 'old') {
    // Tracker leaves current → other. Other keeps the tracker + pings >= swap.
    await db.from('assets').update({ tracker_id: null }).eq('id', currentId).eq('company_id', companyId)
    await db.from('assets').update({ tracker_id: trackerId }).eq('id', otherId).eq('company_id', companyId)
    const { data: rows } = await db
      .from('asset_locations').update({ asset_id: otherId })
      .eq('asset_id', currentId).eq('company_id', companyId).gte('timestamp', iso).select('id')
    moved = rows?.length ?? 0
  } else {
    // Tracker stays on current; other (old vehicle) gets pings < swap.
    const { data: rows } = await db
      .from('asset_locations').update({ asset_id: otherId })
      .eq('asset_id', currentId).eq('company_id', companyId).lt('timestamp', iso).select('id')
    moved = rows?.length ?? 0
  }

  revalidatePath('/assets')
  revalidatePath(`/assets/${currentId}`)
  revalidatePath(`/assets/${otherId}`)
  revalidatePath('/map')
  return { ok: true, otherId, moved }
}

export async function deleteAssetAction(id: string) {
  if (isMock) return
  // Hard delete — locations, tool associations, maintenance, and alert events
  // cascade via FK. Service client: RLS delete policy exists, but this also
  // needs to work for the company owner regardless of role nuances.
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
  const companyId = profile?.company_id ?? user.id

  const service = createServiceClient()
  await service.from('assets').delete().eq('id', id).eq('company_id', companyId)
  revalidatePath('/assets')
  revalidatePath('/map')
}
