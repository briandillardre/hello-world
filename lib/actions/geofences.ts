'use server'

import { revalidatePath } from 'next/cache'
import { getGeofence, createGeofence, updateGeofence, deleteGeofence } from '@/lib/db/geofences'
import { getCurrentCompanyId } from '@/lib/db/company'

export async function createGeofenceAction(name: string, geometry: GeoJSON.Polygon, color: string) {
  const companyId = await getCurrentCompanyId()
  await createGeofence(companyId, { name, geometry, color })
  revalidatePath('/geofences')
  revalidatePath('/map')
}

export async function saveGeofenceAction(
  id: string,
  name: string,
  color: string,
  parentId: string | null
) {
  const g = await getGeofence(id)
  if (!g) return
  await updateGeofence(id, { name, color, geometry: g.geometry, parent_id: parentId })
  revalidatePath('/geofences')
  revalidatePath(`/geofences/${id}`)
  revalidatePath('/map')
}

export async function deleteGeofenceAction(id: string) {
  await deleteGeofence(id)
  revalidatePath('/geofences')
  revalidatePath('/map')
}
