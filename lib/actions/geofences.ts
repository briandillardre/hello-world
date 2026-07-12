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
