const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SiteOverlay {
  id: string
  url: string
  /** Ground corners in MapLibre image-source order: [[TL],[TR],[BR],[BL]], each [lng, lat]. */
  coords: [[number, number], [number, number], [number, number], [number, number]]
  zoneId: string
  /** taken_on (YYYY-MM-DD) — drives the map timeline for photos. */
  takenOn: string
  /** 'photo' rides the Site imagery toggle + timeline; 'plan' rides Scaled plans. */
  kind: 'photo' | 'plan'
}

type Corner = [number, number]
function validCorners(b: unknown): b is [Corner, Corner, Corner, Corner] {
  return Array.isArray(b) && b.length === 4 && b.every((c) =>
    Array.isArray(c) && c.length === 2 &&
    typeof c[0] === 'number' && c[0] >= -180 && c[0] <= 180 &&
    typeof c[1] === 'number' && c[1] >= -90 && c[1] <= 90)
}

/**
 * Placed site imagery for the live map:
 *   photos — EVERY placed shot (053 bounds), so the map timeline can play the
 *            site back: the scrubber shows each zone's newest shot taken on or
 *            before the scrubbed day; Live shows the newest, period.
 *   plans  — only each zone's map_active sheet (055 radio; one per zone).
 * Photos sort before plans so plans mount later → draw on top when both
 * toggles are on. Tolerates pre-055 (no kind column → all rows are photos)
 * and pre-052/053 (table/column missing → empty).
 */
export async function getPlacedSiteOverlays(companyId: string): Promise<SiteOverlay[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const base = 'id, url, bounds, geofence_id, taken_on, created_at'
    let rows: Record<string, unknown>[] | null = null
    let has055 = true
    {
      const { data, error } = await supabase
        .from('zone_imagery')
        .select(`${base}, kind, map_active`)
        .eq('company_id', companyId)
        .not('bounds', 'is', null)
        .order('taken_on', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(500)
      if (error) has055 = false
      else rows = data
    }
    if (!has055) {
      const { data, error } = await supabase
        .from('zone_imagery')
        .select(base)
        .eq('company_id', companyId)
        .not('bounds', 'is', null)
        .order('taken_on', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(500)
      if (error) return []
      rows = data
    }
    const photos: SiteOverlay[] = []
    const plans: SiteOverlay[] = []
    for (const row of rows ?? []) {
      if (!validCorners(row.bounds)) continue
      const item: SiteOverlay = {
        id: String(row.id),
        url: String(row.url),
        coords: row.bounds,
        zoneId: String(row.geofence_id),
        takenOn: String(row.taken_on ?? ''),
        kind: row.kind === 'plan' ? 'plan' : 'photo',
      }
      if (item.kind === 'plan') {
        if (row.map_active === true) plans.push(item)
      } else {
        photos.push(item)
      }
    }
    return [...photos, ...plans]
  } catch {
    return []
  }
}
