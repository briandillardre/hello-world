import type { Asset, AssetWithLocation, AssetPhoto } from '../types'
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
    // Embedded locations must be newest-first + capped to 1, or `.location[0]`
    // below returns an arbitrary historical fix (asset_locations PK is a random
    // UUID, so unordered embeds don't come back latest-first). This makes each
    // asset show where it ACTUALLY is right now.
    .order('timestamp', { ascending: false, referencedTable: 'asset_locations' })
    .limit(1, { referencedTable: 'asset_locations' })

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
 * tracks. Pages newest-first in 1000-row chunks: Supabase's API "Max Rows"
 * setting silently caps a single .limit() to as little as 1000 — which
 * quietly starved trails, reports, and the stats table until paging.
 */
export async function getLocationHistory(
  companyId: string,
  sinceIso: string,
  limit = 5000
): Promise<LocationHistoryRow[] | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const PAGE = 1000
  const rows: LocationHistoryRow[] = []
  while (rows.length < limit) {
    const { data } = await supabase
      .from('asset_locations')
      .select('asset_id, lat, lng, speed, timestamp')
      .eq('company_id', companyId)
      .gte('timestamp', sinceIso)
      .order('timestamp', { ascending: false })
      .range(rows.length, Math.min(rows.length + PAGE, limit) - 1)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE || rows.length >= limit) break
  }
  return rows.reverse()
}

/** Earliest recorded location timestamp (ms) for the company, for "All time".
 *  Null in demo mode or when there's no history yet. */
export async function getEarliestLocationTime(companyId: string): Promise<number | null> {
  if (isMock) return null
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('asset_locations')
    .select('timestamp')
    .eq('company_id', companyId)
    .order('timestamp', { ascending: true })
    .limit(1)
    .maybeSingle()
  const ms = data?.timestamp ? new Date(data.timestamp).getTime() : NaN
  return Number.isFinite(ms) ? ms : null
}

export async function createAsset(
  companyId: string,
  payload: Pick<Asset, 'name' | 'type' | 'tracker_id' | 'metadata'> &
    Partial<Pick<Asset, 'category' | 'serial' | 'photo_url' | 'hourly_rate' | 'mileage_rate' | 'daily_cost' | 'purchase_price' | 'purchase_value'>>
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

/** All photos for an asset, hero-first (sort asc). Empty in demo mode or when
 *  the 025 table isn't present yet — callers fall back to the single hero. */
export async function getAssetPhotos(assetId: string): Promise<AssetPhoto[]> {
  if (isMock) return []
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data, error } = await supabase
    .from('asset_photos')
    .select('*')
    .eq('asset_id', assetId)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return [] // pre-025 database
  return data ?? []
}

/** Append labeled photos, continuing the sort sequence after existing ones. */
export async function addAssetPhotos(
  companyId: string,
  assetId: string,
  photos: { url: string; label: string | null }[]
): Promise<void> {
  if (isMock || !photos.length) return
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data: last } = await supabase
    .from('asset_photos')
    .select('sort')
    .eq('asset_id', assetId)
    .order('sort', { ascending: false })
    .limit(1)
    .maybeSingle()
  let sort = (last?.sort ?? -1) + 1
  const rows = photos.map((p) => ({ company_id: companyId, asset_id: assetId, url: p.url, label: p.label, sort: sort++ }))
  await supabase.from('asset_photos').insert(rows)
}

export async function deleteAssetPhoto(companyId: string, id: string): Promise<void> {
  if (isMock) return
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.from('asset_photos').delete().eq('id', id).eq('company_id', companyId)
}

export async function updateAsset(
  id: string,
  payload: Partial<Pick<Asset, 'name' | 'type' | 'tracker_id' | 'metadata' | 'active' |
    'category' | 'serial' | 'photo_url' | 'hourly_rate' | 'mileage_rate' | 'daily_cost' | 'purchase_price' | 'purchase_value'>>
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
