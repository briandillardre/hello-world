import type { Geofence } from '../types'
import { MOCK_GEOFENCES } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getGeofences(companyId: string): Promise<Geofence[]> {
  if (isMock) return MOCK_GEOFENCES

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  // Read from the GeoJSON view so geometry comes back as GeoJSON (not PostGIS WKB).
  const { data } = await supabase
    .from('geofences_json')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  return (data ?? []) as Geofence[]
}

export async function getGeofence(id: string): Promise<Geofence | null> {
  if (isMock) return MOCK_GEOFENCES.find((g) => g.id === id) ?? null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase.from('geofences_json').select('*').eq('id', id).single()
  return (data as Geofence) ?? null
}

export async function createGeofence(
  _companyId: string,
  payload: Pick<Geofence, 'name' | 'geometry' | 'color'> & { parent_id?: string | null }
): Promise<string | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  // upsert_geofence converts GeoJSON -> PostGIS and applies the caller's RLS.
  const { data } = await supabase.rpc('upsert_geofence', {
    p_id: null,
    p_name: payload.name,
    p_color: payload.color,
    p_geometry: payload.geometry,
    p_parent_id: payload.parent_id ?? null,
  })
  return (data as string) ?? null
}

export async function updateGeofence(
  id: string,
  payload: { name: string; color: string; geometry: GeoJSON.Polygon; parent_id?: string | null }
): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.rpc('upsert_geofence', {
    p_id: id,
    p_name: payload.name,
    p_color: payload.color,
    p_geometry: payload.geometry,
    p_parent_id: payload.parent_id ?? null,
  })
}

export async function deleteGeofence(id: string): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.from('geofences').delete().eq('id', id)
}
