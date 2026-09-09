'use server'

import { revalidatePath } from 'next/cache'
import { getRealPermissions } from '@/lib/permissions-server'
import type { FieldPhoto } from '@/lib/db/photos'

/**
 * Field photos (migration 101; Brian, Sep 9: "take photos or add photos which
 * are geotagged as a layer on the map"). Three steps, like site imagery, so
 * the file never rides through a server action: mint signed upload URLs
 * (full + thumbnail), the device streams both straight to storage, then
 * finalize records the shot with its fix and the site it landed on.
 */
const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const MAX_BYTES = 25 * 1024 * 1024
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic' }

export async function createPhotoUploadAction(contentType: string, size: number): Promise<{
  ok: boolean; path?: string; token?: string; thumbPath?: string; thumbToken?: string; error?: string
}> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const perms = await getRealPermissions()
  if (!perms.userId || !perms.companyId) return { ok: false, error: 'Sign in first.' }
  if (!EXT[contentType]) return { ok: false, error: 'That file isn’t a photo we can take (JPEG, PNG, WebP or HEIC).' }
  if (!size || size > MAX_BYTES) return { ok: false, error: 'Photo too large (25 MB max).' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  // A day's ceiling per company (sec-check: signed URLs are storage anyone
  // signed in can fill). Three hundred job photos a day is a big crew.
  const { count } = await svc.from('field_photos').select('id', { count: 'exact', head: true })
    .eq('company_id', perms.companyId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if ((count ?? 0) >= 300) return { ok: false, error: 'That’s 300 photos today for the company — the daily ceiling. Tomorrow resets it.' }
  const id = crypto.randomUUID()
  const path = `${perms.companyId}/photos/${id}.${EXT[contentType]}`
  const thumbPath = `${perms.companyId}/photos/${id}.thumb.jpg`
  const [full, thumb] = await Promise.all([
    svc.storage.from('field-photos').createSignedUploadUrl(path),
    svc.storage.from('field-photos').createSignedUploadUrl(thumbPath),
  ])
  if (full.error || !full.data || thumb.error || !thumb.data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, path: full.data.path, token: full.data.token, thumbPath: thumb.data.path, thumbToken: thumb.data.token }
}

/** Which site/yard a point falls in — the company's own polygons. */
async function resolveZone(companyId: string, lat: number, lng: number): Promise<{ id: string; name: string } | null> {
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { pointInPolygon } = await import('@/lib/alerts-engine')
    const { data: zones } = await createServiceClient().from('geofences_json')
      .select('id, name, kind, geometry').eq('company_id', companyId).is('owner_id', null)
    for (const z of zones ?? []) {
      const kind = (z.kind as string | null) ?? 'site'
      if (kind !== 'site' && kind !== 'yard') continue
      const ring = ((z.geometry as { coordinates?: number[][][] })?.coordinates?.[0] ?? []) as [number, number][]
      if (ring.length >= 3 && pointInPolygon([lng, lat], ring)) return { id: z.id as string, name: z.name as string }
    }
  } catch { /* no zones or pre-PostGIS view */ }
  return null
}

export async function finalizePhotoAction(input: {
  path: string; thumbPath?: string | null
  lat: number; lng: number; accuracy?: number | null; heading?: number | null
  takenAt?: string | null; caption?: string | null; source?: 'camera' | 'import'
}): Promise<{ ok: boolean; photo?: FieldPhoto; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const perms = await getRealPermissions()
  if (!perms.userId || !perms.companyId) return { ok: false, error: 'Sign in first.' }
  const { lat, lng } = input
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return { ok: false, error: 'No location on this photo — allow location or pick a photo that has one.' }
  }
  const shape = new RegExp(`^${perms.companyId}/photos/[0-9a-f-]{36}\\.(jpg|png|webp|heic)$`, 'i')
  if (!shape.test(input.path)) return { ok: false, error: 'Bad upload path' }
  const thumbOk = input.thumbPath && new RegExp(`^${perms.companyId}/photos/[0-9a-f-]{36}\\.thumb\\.jpg$`, 'i').test(input.thumbPath)

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  // The object must actually be there (and not oversized) before we record it.
  const slash = input.path.lastIndexOf('/')
  const { data: objects } = await svc.storage.from('field-photos').list(input.path.slice(0, slash), { search: input.path.slice(slash + 1) })
  const obj = (objects ?? []).find((o) => o.name === input.path.slice(slash + 1))
  if (!obj) return { ok: false, error: 'Upload didn’t finish — try again.' }
  const meta = (obj.metadata as { size?: number; mimetype?: string } | null) ?? {}
  const uploadedType = String(meta.mimetype ?? '').split(';')[0].trim().toLowerCase()
  const ext = input.path.slice(input.path.lastIndexOf('.') + 1).toLowerCase()
  const typeOk = !!EXT[uploadedType] && (EXT[uploadedType] === ext || (ext === 'heic' && EXT[uploadedType] === 'heic'))
  if ((meta.size ?? 0) > MAX_BYTES || !typeOk) {
    // Not the image it claimed to be (sec-check): gone, and no row.
    await svc.storage.from('field-photos').remove([input.path, ...(thumbOk ? [input.thumbPath as string] : [])])
    return { ok: false, error: !typeOk ? 'That upload wasn’t a photo.' : 'Photo too large (25 MB max).' }
  }
  const url = svc.storage.from('field-photos').getPublicUrl(input.path).data.publicUrl
  const thumbUrl = thumbOk ? svc.storage.from('field-photos').getPublicUrl(input.thumbPath as string).data.publicUrl : null
  const zone = await resolveZone(perms.companyId, lat, lng)
  const takenAt = input.takenAt && Number.isFinite(Date.parse(input.takenAt)) && Date.parse(input.takenAt) <= Date.now() + 60_000
    ? new Date(input.takenAt).toISOString() : new Date().toISOString()

  // Writes are service-only since 102 (no member can shape a row through
  // PostgREST); company and user still come from the session above.
  void createClient
  const { data, error } = await svc.from('field_photos').insert({
    company_id: perms.companyId,
    user_id: perms.userId,
    source: input.source === 'import' ? 'import' : 'camera',
    geofence_id: zone?.id ?? null,
    url,
    thumb_url: thumbUrl,
    lat, lng,
    accuracy_m: input.accuracy != null && Number.isFinite(input.accuracy) ? Math.round(input.accuracy) : null,
    heading: input.heading != null && Number.isFinite(input.heading) ? Math.round(input.heading) : null,
    taken_at: takenAt,
    caption: input.caption?.trim().slice(0, 240) || null,
  }).select('id, taken_at').single()
  if (error || !data) return { ok: false, error: /relation|column/i.test(error?.message ?? '') ? 'Photos need the newest database update — try again in a minute.' : 'Save failed — try again.' }
  revalidatePath('/photos')
  return {
    ok: true,
    photo: {
      id: data.id as string, url, thumb_url: thumbUrl, lat, lng, taken_at: data.taken_at as string,
      caption: input.caption?.trim().slice(0, 240) || null, source: input.source === 'import' ? 'import' : 'camera',
      source_id: null, geofence_id: zone?.id ?? null, user_id: perms.userId, zone: zone?.name ?? null, by: null,
    },
  }
}

/** Your own photo, or anyone's if you can edit — gone from the index and the bucket. */
export async function deletePhotoAction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const perms = await getRealPermissions()
  if (!perms.userId || !perms.companyId) return { ok: false, error: 'Sign in first.' }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Bad id' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: row } = await svc.from('field_photos').select('id, user_id, url, thumb_url, source').eq('id', id).eq('company_id', perms.companyId).maybeSingle()
  if (!row) return { ok: false, error: 'Not found' }
  if (row.user_id !== perms.userId && !perms.canEdit) return { ok: false, error: 'Only the person who took it, or an editor, can remove a photo.' }
  await svc.from('field_photos').delete().eq('id', id).eq('company_id', perms.companyId)
  // Only objects the camera path itself created leave storage — matched by
  // exact shape under this company's photos prefix. A daily-log photo stays
  // (the log still shows it); nothing else in the bucket is ever reachable
  // from here (sec-check on 101).
  if (row.source === 'camera' || row.source === 'import') {
    const marker = '/field-photos/'
    const shape = new RegExp(`^${perms.companyId}/photos/[0-9a-f-]{36}(\\.thumb\\.jpg|\\.(jpg|png|webp|heic))$`, 'i')
    const paths = [row.url, row.thumb_url].filter((u): u is string => !!u)
      .map((u) => u.slice(u.indexOf(marker) + marker.length)).filter((p) => shape.test(p))
    if (paths.length) await svc.storage.from('field-photos').remove(paths).catch(() => { /* orphan is harmless */ })
  }
  revalidatePath('/photos')
  return { ok: true }
}
