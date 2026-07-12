'use server'

import { revalidatePath } from 'next/cache'
import { getGeofence, createGeofence, updateGeofence, deleteGeofence } from '@/lib/db/geofences'
import { getCurrentCompanyId } from '@/lib/db/company'

export async function createGeofenceAction(name: string, geometry: GeoJSON.Polygon, color: string, kind: 'site' | 'boundary' | 'yard' = 'site') {
  const companyId = await getCurrentCompanyId()
  const id = await createGeofence(companyId, { name, geometry, color, kind })
  revalidatePath('/geofences')
  revalidatePath('/map')
  // Null = the insert didn't happen (RPC error / RLS) — callers surface it.
  return id
}

export async function saveGeofenceAction(
  id: string,
  name: string,
  color: string,
  parentId: string | null,
  geometry?: GeoJSON.Polygon,
  kind?: 'site' | 'boundary' | 'yard'
) {
  const g = await getGeofence(id)
  if (!g) return
  await updateGeofence(id, { name, color, geometry: geometry ?? g.geometry, parent_id: parentId, kind })
  revalidatePath('/geofences')
  revalidatePath(`/geofences/${id}`)
  revalidatePath('/map')
}

export async function deleteGeofenceAction(id: string) {
  await deleteGeofence(id)
  revalidatePath('/geofences')
  revalidatePath('/map')
}

/** Owner notes on a zone — free text the panel shows and the AI reads.
 *  Direct column update (RLS-scoped); RPC untouched. */
export async function saveZoneNotesAction(id: string, notes: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase
      .from('geofences')
      .update({ notes: notes.trim() || null })
      .eq('id', id)
    if (error) {
      // 42703 = column missing → migration 020 not applied yet.
      if (error.code === '42703') return { ok: false, error: 'Run migration 020_notes.sql first.' }
      return { ok: false, error: error.message }
    }
    revalidatePath(`/geofences/${id}`)
    revalidatePath('/geofences')
    revalidatePath('/map')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'failed' }
  }
}
