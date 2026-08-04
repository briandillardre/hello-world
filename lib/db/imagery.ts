const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SiteOverlay {
  id: string
  url: string
  /** Ground corners in MapLibre image-source order: [[TL],[TR],[BR],[BL]], each [lng, lat]. */
  coords: [[number, number], [number, number], [number, number], [number, number]]
}

type Corner = [number, number]
function validCorners(b: unknown): b is [Corner, Corner, Corner, Corner] {
  return Array.isArray(b) && b.length === 4 && b.every((c) =>
    Array.isArray(c) && c.length === 2 &&
    typeof c[0] === 'number' && c[0] >= -180 && c[0] <= 180 &&
    typeof c[1] === 'number' && c[1] >= -90 && c[1] <= 90)
}

/**
 * Placed site imagery for the map's 'Site imagery' layer: the NEWEST placed
 * shot per zone (053 bounds set via the zone page's "Place on map" tool).
 * One image per zone keeps the layer readable — the zone page timeline still
 * holds every date. Tolerates the table/column not existing yet (pre-052/053).
 */
export async function getPlacedSiteOverlays(companyId: string): Promise<SiteOverlay[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('zone_imagery')
      .select('id, url, bounds, geofence_id, taken_on, created_at')
      .eq('company_id', companyId)
      .not('bounds', 'is', null)
      .order('taken_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return []
    const seen = new Set<string>()
    const out: SiteOverlay[] = []
    for (const row of data ?? []) {
      if (seen.has(row.geofence_id)) continue
      if (!validCorners(row.bounds)) continue
      seen.add(row.geofence_id)
      out.push({ id: row.id, url: row.url, coords: row.bounds })
    }
    return out
  } catch {
    return []
  }
}
