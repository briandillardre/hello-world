import type { Asset, AssetWithLocation } from '../types'
import { MOCK_ASSETS } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getAssetsWithLocations(companyId: string): Promise<AssetWithLocation[]> {
  if (isMock) return MOCK_ASSETS

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('assets')
    .select(`
      *,
      location:asset_locations(
        id, asset_id, company_id, lat, lng, accuracy, battery, speed, heading, timestamp, raw
      )
    `)
    .eq('company_id', companyId)
    .eq('active', true)
    .order('created_at', { ascending: false })

  type AssetRow = Asset & { location: AssetWithLocation['location'][] | AssetWithLocation['location'] | null }
  return (data ?? []).map((a: AssetRow) => ({
    ...a,
    location: Array.isArray(a.location) ? a.location[0] ?? null : (a.location ?? null),
  }))
}

export async function getAssets(companyId: string): Promise<Asset[]> {
  if (isMock) return MOCK_ASSETS

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('assets')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  return data ?? []
}

export interface LocationHistoryRow {
  asset_id: string
  lat: number
  lng: number
  speed: number | null
  timestamp: string
}

/**
 * Location history since `sinceIso`, oldest-first, for drawing real movement
 * trails. Returns null in demo mode so callers can fall back to synthetic
 * tracks. Fetches newest-first (PostgREST caps result sets, so bias recent)
 * then reverses to chronological order.
 */
export async function getLocationHistory(
  companyId: string,
  sinceIso: string
): Promise<LocationHistoryRow[] | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('asset_locations')
    .select('asset_id, lat, lng, speed, timestamp')
    .eq('company_id', companyId)
    .gte('timestamp', sinceIso)
    .order('timestamp', { ascending: false })
    .limit(5000)
  return (data ?? []).reverse()
}

export async function createAsset(
  companyId: string,
  payload: Pick<Asset, 'name' | 'type' | 'tracker_id' | 'metadata'> &
    Partial<Pick<Asset, 'category' | 'serial' | 'photo_url' | 'hourly_rate' | 'mileage_rate' | 'daily_cost' | 'purchase_value'>>
): Promise<Asset | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('assets')
    .insert({ ...payload, company_id: companyId, active: true })
    .select()
    .single()
  return data
}

export async function updateAsset(
  id: string,
  payload: Partial<Pick<Asset, 'name' | 'type' | 'tracker_id' | 'metadata' | 'active' |
    'category' | 'serial' | 'photo_url' | 'hourly_rate' | 'mileage_rate' | 'daily_cost' | 'purchase_value'>>
): Promise<Asset | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('assets')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  return data
}
