import type { Place, PlaceKind } from '../types'

/**
 * Places — saved destinations crews navigate to (migration 085). A place is
 * a POINT you drive to (supply house, dump, shop, customer driveway); a zone
 * is an AREA the alerts engine and hours ledger reason about. Keeping them
 * separate keeps Lowe's out of the burn map.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Demo fleet's saved spots — staged on the Nashville grid with the rest of
 *  the story (index 0 = the vendor quarry the trucks already haul from). */
export const MOCK_PLACES: Place[] = [
  { id: 'place-1', name: 'Palmetto Aggregates — scale house', kind: 'supplier', lat: 36.1585, lng: -86.8055, address: 'Centennial Blvd', notes: 'Check in at the scale before loading', active: true, created_at: '2026-07-01T12:00:00Z' },
  { id: 'place-2', name: 'Building supply — Charlotte Ave', kind: 'supplier', lat: 36.1522, lng: -86.8148, address: 'Charlotte Ave', notes: null, active: true, created_at: '2026-07-01T12:00:00Z' },
  { id: 'place-3', name: 'Fuel — Broadway Shell', kind: 'fuel', lat: 36.1568, lng: -86.7845, address: 'Broadway', notes: 'Fleet cards only', active: true, created_at: '2026-07-01T12:00:00Z' },
  { id: 'place-4', name: 'County landfill gate', kind: 'dump', lat: 36.1755, lng: -86.7908, address: 'Elm Hill Pike', notes: 'Closes 4:30 sharp', active: true, created_at: '2026-07-01T12:00:00Z' },
]

export async function getPlaces(companyId: string): Promise<Place[]> {
  if (isMock) return MOCK_PLACES
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('places')
      .select('id, name, kind, lat, lng, address, notes, active, created_at')
      .eq('company_id', companyId)
      .eq('active', true)
      .order('name')
    if (error) return [] // missing table (085 not applied) degrades to none
    return (data ?? []) as Place[]
  } catch {
    return []
  }
}

export async function createPlace(companyId: string, p: {
  name: string
  kind: PlaceKind
  lat: number
  lng: number
  address?: string | null
  notes?: string | null
  createdBy?: string | null
}): Promise<{ place: Place | null; error: string | null }> {
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('places')
      .insert({
        company_id: companyId,
        name: p.name,
        kind: p.kind,
        lat: p.lat,
        lng: p.lng,
        address: p.address ?? null,
        notes: p.notes ?? null,
        created_by: p.createdBy ?? null,
      })
      .select('id, name, kind, lat, lng, address, notes, active, created_at')
      .single()
    if (error) return { place: null, error: error.message }
    return { place: data as Place, error: null }
  } catch (err) {
    return { place: null, error: err instanceof Error ? err.message : 'failed' }
  }
}

export async function updatePlace(companyId: string, id: string, patch: Partial<Pick<Place, 'name' | 'kind' | 'notes' | 'address' | 'lat' | 'lng'>>): Promise<string | null> {
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('places').update(patch).eq('id', id).eq('company_id', companyId)
    return error ? error.message : null
  } catch (err) {
    return err instanceof Error ? err.message : 'failed'
  }
}

/** Soft delete — keeps the row for any history that references it later. */
export async function removePlace(companyId: string, id: string): Promise<string | null> {
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('places').update({ active: false }).eq('id', id).eq('company_id', companyId)
    return error ? error.message : null
  } catch (err) {
    return err instanceof Error ? err.message : 'failed'
  }
}
