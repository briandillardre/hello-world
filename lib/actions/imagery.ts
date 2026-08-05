'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ZoneImage {
  id: string
  url: string
  taken_on: string
  caption: string | null
  source: 'drone' | 'aerial' | 'satellite' | 'ground'
  created_at: string
  /** 053: ground corners [[TL],[TR],[BR],[BL]] as [lng,lat] once the shot is
   *  placed on the map — null/undefined = timeline-only (not on the map). */
  bounds?: [[number, number], [number, number], [number, number], [number, number]] | null
}

// Site imagery upload cap (mirrored client-side in ZoneImagery). Drone shots
// go direct to Supabase Storage via a signed URL — Vercel's ~4.5 MB serverless
// request cap never sees the file. ('use server' forbids exporting consts.)
const IMAGERY_MAX_BYTES = 50 * 1024 * 1024

const IMAGERY_EXT: Record<string, string> = {
  'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
}

/**
 * Step 1 of the site-photo upload: validate + mint a one-time signed upload
 * URL so the device streams the file straight to Supabase Storage. Mavic
 * JPEGs run 5–9 MB and pano/ortho exports more — capped at 50 MB.
 */
export async function createImageryUploadAction(zoneId: string, contentType: string, size: number): Promise<{
  ok: boolean; path?: string; token?: string; error?: string
}> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!/^[0-9a-f-]{36}$/i.test(zoneId)) return { ok: false, error: 'Bad zone' }
  if (!contentType.startsWith('image/')) return { ok: false, error: 'That file isn’t an image.' }
  if (!size || size > IMAGERY_MAX_BYTES) return { ok: false, error: 'Photo too large (50 MB max).' }

  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  // Zone must be this company's — RLS would catch the insert later, but the
  // storage object lands first and shouldn't orphan under someone else's zone.
  const { data: zone } = await supabase.from('geofences').select('id').eq('id', zoneId).maybeSingle()
  if (!zone) return { ok: false, error: 'Zone not found' }

  const svc = createServiceClient()
  const ext = IMAGERY_EXT[contentType] ?? 'jpg'
  const path = `${companyId}/imagery/${zoneId}/${crypto.randomUUID()}.${ext}`
  const { data, error } = await svc.storage.from('field-photos').createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, path: data.path, token: data.token }
}

/**
 * Step 2: after the device has uploaded to the signed URL, record the shot on
 * the zone's imagery timeline. Verifies the object actually landed (and its
 * size) before inserting — the path shape pins it to this company + zone.
 */
export async function finalizeZoneImageryAction(input: {
  zoneId: string; path: string; takenOn: string; caption?: string; source?: string
}): Promise<{ ok: boolean; image?: ZoneImage; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { zoneId, path, takenOn } = input
  const caption = String(input.caption ?? '').trim().slice(0, 200)
  const source = ['drone', 'aerial', 'satellite', 'ground'].includes(input.source ?? '') ? input.source! : 'drone'
  if (!/^[0-9a-f-]{36}$/i.test(zoneId)) return { ok: false, error: 'Bad zone' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) return { ok: false, error: 'Pick the date it was taken.' }

  const companyId = await getCurrentCompanyId()
  const prefix = `${companyId}/imagery/${zoneId}/`
  if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.[a-z0-9]{3,4}$/i.test(path.slice(prefix.length))) {
    return { ok: false, error: 'Bad upload path' }
  }

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const filename = path.slice(prefix.length)
  const { data: objects } = await svc.storage.from('field-photos')
    .list(prefix.slice(0, -1), { search: filename })
  const obj = objects?.find((o) => o.name === filename)
  if (!obj) return { ok: false, error: 'Upload didn’t finish — try again.' }
  const bytes = (obj.metadata as { size?: number } | null)?.size ?? 0
  if (bytes > IMAGERY_MAX_BYTES) {
    await svc.storage.from('field-photos').remove([path])
    return { ok: false, error: 'Photo too large (50 MB max).' }
  }
  const url = svc.storage.from('field-photos').getPublicUrl(path).data.publicUrl

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('zone_imagery').insert({
    company_id: companyId,
    geofence_id: zoneId,
    url,
    taken_on: takenOn,
    caption: caption || null,
    source,
    created_by: user?.id ?? null,
  }).select('id, url, taken_on, caption, source, created_at').single()
  if (error) return { ok: false, error: 'Run migration 052_zone_imagery.sql in the Supabase SQL Editor first.' }
  revalidatePath(`/geofences/${zoneId}`)
  return { ok: true, image: data as ZoneImage }
}

/**
 * Save (or clear) a shot's ground corners — the "Place on map" tool's commit.
 * bounds = [[TL],[TR],[BR],[BL]] as [lng,lat] (MapLibre image-source order);
 * null removes the placement (shot stays on the zone timeline).
 */
export async function saveOverlayBoundsAction(
  zoneId: string,
  imageId: string,
  bounds: [[number, number], [number, number], [number, number], [number, number]] | null
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) return { ok: false, error: 'Bad image' }
  if (bounds !== null) {
    const sane = Array.isArray(bounds) && bounds.length === 4 && bounds.every((c) =>
      Array.isArray(c) && c.length === 2 &&
      Number.isFinite(c[0]) && Math.abs(c[0]) <= 180 &&
      Number.isFinite(c[1]) && Math.abs(c[1]) <= 90)
    if (!sane) return { ok: false, error: 'Bad placement — try again.' }
  }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { error } = await supabase.from('zone_imagery')
    .update({ bounds })
    .eq('id', imageId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Run migration 053_imagery_bounds.sql in the Supabase SQL Editor first.' }
  revalidatePath(`/geofences/${zoneId}`)
  revalidatePath('/map')
  return { ok: true }
}

export async function deleteZoneImageryAction(zoneId: string, imageId: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { error } = await supabase.from('zone_imagery')
    .delete().eq('id', imageId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Delete failed' }
  revalidatePath(`/geofences/${zoneId}`)
  return { ok: true }
}
