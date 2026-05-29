import type { Geofence } from '../types'
import { MOCK_GEOFENCES } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getGeofences(companyId: string): Promise<Geofence[]> {
  if (isMock) return MOCK_GEOFENCES

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('geofences')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function createGeofence(
  companyId: string,
  payload: Pick<Geofence, 'name' | 'geometry' | 'color'>
): Promise<Geofence | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('geofences')
    .insert({ ...payload, company_id: companyId })
    .select()
    .single()
  return data
}

export async function deleteGeofence(id: string): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.from('geofences').delete().eq('id', id)
}
