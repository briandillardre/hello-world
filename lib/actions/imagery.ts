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

/**
 * Upload one dated site photo to a zone's imagery timeline.
 * FormData: photo (file), zoneId, takenOn (YYYY-MM-DD), caption?, source?
 * Mavic JPEGs run 5–9 MB — capped at 12 MB, stored as-is (evidence quality
 * beats bandwidth here; the viewer lazy-loads).
 */
export async function uploadZoneImageryAction(form: FormData): Promise<{ ok: boolean; image?: ZoneImage; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const zoneId = String(form.get('zoneId') ?? '')
  const takenOn = String(form.get('takenOn') ?? '')
  const caption = String(form.get('caption') ?? '').trim().slice(0, 200)
  const sourceRaw = String(form.get('source') ?? 'drone')
  const source = ['drone', 'aerial', 'satellite', 'ground'].includes(sourceRaw) ? sourceRaw : 'drone'
  const photo = form.get('photo')
  if (!/^[0-9a-f-]{36}$/i.test(zoneId)) return { ok: false, error: 'Bad zone' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) return { ok: false, error: 'Pick the date it was taken.' }
  if (!(photo instanceof File) || !photo.size || !photo.type.startsWith('image/')) {
    return { ok: false, error: 'Attach the photo first.' }
  }
  if (photo.size > 12 * 1024 * 1024) return { ok: false, error: 'Photo too large (12 MB max).' }

  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  // Zone must be this company's — the insert's RLS would catch it, but the
  // storage upload happens first and shouldn't orphan files.
  const { data: zone } = await supabase.from('geofences').select('id').eq('id', zoneId).maybeSingle()
  if (!zone) return { ok: false, error: 'Zone not found' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const ext = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${companyId}/imagery/${zoneId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await svc.storage.from('field-photos')
    .upload(path, photo, { contentType: photo.type, upsert: false })
  if (upErr) return { ok: false, error: 'Upload failed — try again.' }
  const url = svc.storage.from('field-photos').getPublicUrl(path).data.publicUrl

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
