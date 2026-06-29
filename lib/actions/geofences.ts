'use server'

import { revalidatePath } from 'next/cache'
import { getGeofence, updateGeofence, deleteGeofence } from '@/lib/db/geofences'

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
