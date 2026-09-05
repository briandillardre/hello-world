'use server'
import { requireEditOrThrow } from '@/lib/permissions-server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import type { MeasureKind, MeasureProps } from '@/lib/db/measurements'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SaveMeasurementInput {
  name: string
  kind: MeasureKind
  personal: boolean
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon
  props: MeasureProps
}

export async function saveMeasurementAction(input: SaveMeasurementInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }
    const { data, error } = await supabase
      .from('measurements')
      .insert({
        company_id: companyId,
        owner_id: input.personal ? user.id : null,
        name: input.name.trim() || 'Measurement',
        kind: input.kind,
        geometry: input.geometry,
        props: input.props,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    revalidatePath('/map')
    revalidatePath('/measurements')
    return { ok: true, id: data.id as string }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed.' }
  }
}

/** Edit an existing measurement in place — rename and/or replace the shape
 *  (the map's tap-to-edit flow). RLS scopes the update to the caller's rows. */
export async function updateMeasurementAction(
  id: string,
  patch: { name?: string; geometry?: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon; props?: MeasureProps }
): Promise<{ ok: boolean; error?: string }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  if (!id) return { ok: false, error: 'Missing id.' }
  // Bound the payload like the create path: a geometry is at most a few
  // hundred vertices; props is a small readouts object.
  if (patch.geometry) {
    const n = patch.geometry.type === 'Point' ? 1
      : patch.geometry.type === 'LineString' ? patch.geometry.coordinates.length
      : patch.geometry.coordinates.reduce((s, ring) => s + ring.length, 0)
    if (!Number.isFinite(n) || n < 1 || n > 2000) return { ok: false, error: 'Shape too complex.' }
  }
  if (patch.props && JSON.stringify(patch.props).length > 4000) return { ok: false, error: 'Props too large.' }
  if (patch.name !== undefined && patch.name.length > 200) patch.name = patch.name.slice(0, 200)
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const row: Record<string, unknown> = {}
    if (patch.name !== undefined) row.name = patch.name.trim() || 'Measurement'
    if (patch.geometry !== undefined) row.geometry = patch.geometry
    if (patch.props !== undefined) row.props = patch.props
    if (!Object.keys(row).length) return { ok: true }
    const { error } = await supabase.from('measurements').update(row).eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/map')
    revalidatePath('/measurements')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed.' }
  }
}

export async function deleteMeasurementAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('measurements').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/map')
    revalidatePath('/measurements')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed.' }
  }
}
