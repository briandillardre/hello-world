'use server'

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { cleanCamera } from '@/lib/zone-cameras'

type Reply = { ok: true; id?: string } | { ok: false; error: string }

/** Add a site camera to a zone (138). Members hold SELECT only; the write is
 *  the service role after the edit check and a same-company zone check. */
export async function addZoneCameraAction(zoneId: string, input: { name: string; kind: string; url?: string }): Promise<Reply> {
  const perms = await requireEditOrThrow()
  if (perms.viewingAs) return { ok: false, error: 'Not while previewing as someone else.' }
  const c = cleanCamera(input)
  if (!c.ok) return c
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  // The caller's own client must see the zone — same company, not someone's personal zone.
  const { data: zone } = await createClient().from('geofences').select('id, company_id').eq('id', zoneId).maybeSingle()
  if (!zone || zone.company_id !== companyId) return { ok: false, error: 'Zone not found.' }
  const svc = createServiceClient()
  const { count } = await svc.from('zone_cameras').select('id', { count: 'exact', head: true }).eq('geofence_id', zoneId)
  if ((count ?? 0) >= 20) return { ok: false, error: '20 cameras per zone at most.' }
  const { data: { user } } = await createClient().auth.getUser()
  const { data, error } = await svc.from('zone_cameras')
    .insert({ company_id: companyId, geofence_id: zoneId, name: c.name, kind: c.kind, url: c.url, created_by: user?.id ?? null })
    .select('id').single()
  if (error || !data) return { ok: false, error: 'Could not save the camera.' }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true, id: data.id }
}

export async function removeZoneCameraAction(id: string): Promise<Reply> {
  const perms = await requireEditOrThrow()
  if (perms.viewingAs) return { ok: false, error: 'Not while previewing as someone else.' }
  const companyId = await getCurrentCompanyId()
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data } = await svc.from('zone_cameras').delete().eq('id', id).eq('company_id', companyId).select('geofence_id').maybeSingle()
  if (!data) return { ok: false, error: 'Camera not found.' }
  revalidatePath(`/zones/${data.geofence_id}`)
  return { ok: true }
}
