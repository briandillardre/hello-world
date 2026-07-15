import type { Geofence } from '../types'
import { MOCK_GEOFENCES } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getGeofences(companyId: string): Promise<Geofence[]> {
  if (isMock) return MOCK_GEOFENCES

  // Read from the GeoJSON view (geometry as GeoJSON). If the view is missing
  // (migration 005 not run yet) or anything errors, degrade to empty instead of
  // throwing — a geofence hiccup must never take down the whole map page.
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('geofences_json')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
    if (error) return []
    return (data ?? []) as Geofence[]
  } catch {
    return []
  }
}

export async function getGeofence(id: string): Promise<Geofence | null> {
  if (isMock) return MOCK_GEOFENCES.find((g) => g.id === id) ?? null

  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase.from('geofences_json').select('*').eq('id', id).single()
    if (error) return null
    return (data as Geofence) ?? null
  } catch {
    return null
  }
}

export async function createGeofence(
  _companyId: string,
  payload: Pick<Geofence, 'name' | 'geometry' | 'color'> & { parent_id?: string | null; kind?: 'site' | 'boundary' | 'yard';
    personal?: boolean; active_from?: string | null; active_until?: string | null }
): Promise<string | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  // upsert_geofence converts GeoJSON -> PostGIS and applies the caller's RLS.
  // Try newest signature (027: personal + lifecycle) → 013 (kind) → 005 (base),
  // so the app keeps working on a database that hasn't run every migration yet.
  const base = {
    p_id: null,
    p_name: payload.name,
    p_color: payload.color,
    p_geometry: payload.geometry,
    p_parent_id: payload.parent_id ?? null,
  }
  const full = await supabase.rpc('upsert_geofence', {
    ...base, p_kind: payload.kind ?? 'site',
    p_personal: payload.personal ?? null,
    p_active_from: payload.active_from ?? null,
    p_active_until: payload.active_until ?? null,
  })
  if (!full.error) return (full.data as string) ?? null
  const withKind = await supabase.rpc('upsert_geofence', { ...base, p_kind: payload.kind ?? 'site' })
  if (!withKind.error) return (withKind.data as string) ?? null
  const { data } = await supabase.rpc('upsert_geofence', base)
  return (data as string) ?? null
}

export async function updateGeofence(
  id: string,
  payload: { name: string; color: string; geometry: GeoJSON.Polygon; parent_id?: string | null; kind?: 'site' | 'boundary' | 'yard';
    personal?: boolean; active_from?: string | null; active_until?: string | null; clear_dates?: boolean }
): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const base = {
    p_id: id,
    p_name: payload.name,
    p_color: payload.color,
    p_geometry: payload.geometry,
    p_parent_id: payload.parent_id ?? null,
  }
  const full = await supabase.rpc('upsert_geofence', {
    ...base, p_kind: payload.kind ?? null,
    p_personal: payload.personal ?? null,
    p_active_from: payload.active_from ?? null,
    p_active_until: payload.active_until ?? null,
    p_clear_dates: payload.clear_dates ?? false,
  })
  if (!full.error) return
  const withKind = await supabase.rpc('upsert_geofence', { ...base, p_kind: payload.kind ?? null })
  if (withKind.error) await supabase.rpc('upsert_geofence', base)
}

/** Zone change history, newest first. Empty on a pre-028 database. */
export async function getZoneEvents(geofenceId: string): Promise<import('../types').ZoneEvent[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('zone_events').select('*')
      .eq('geofence_id', geofenceId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return []
    return (data ?? []) as import('../types').ZoneEvent[]
  } catch { return [] }
}

/** Append a change event. Best-effort — a logging failure never blocks the edit. */
export async function logZoneEvent(
  companyId: string, geofenceId: string, userId: string | null,
  action: string, detail: Record<string, unknown> | null
): Promise<void> {
  if (isMock) return
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    await supabase.from('zone_events').insert({ company_id: companyId, geofence_id: geofenceId, user_id: userId, action, detail })
  } catch { /* pre-028 DB — history is additive */ }
}

export async function deleteGeofence(id: string): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.from('geofences').delete().eq('id', id)
}
