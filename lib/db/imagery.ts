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
 *   photos — the NEWEST 500 placed shots (053 bounds), so the map timeline can
 *            play the site back: the scrubber shows each zone's newest shot
 *            taken on or before the scrubbed day; Live shows the newest, period.
 *            Newest, not oldest: a site watched by satellite (131) adds a dated
 *            picture every few days, and an oldest-first cap froze the live map
 *            on old pictures once a company passed 500.
 *   plans  — only each zone's map_active sheet (055 radio; one per zone),
 *            fetched on their own so photos can never crowd them out.
 * Photos sort before plans so plans mount later → draw on top when both
 * toggles are on. Within one day a satellite picture sorts BEFORE the other
 * shots, so the map (newest-in-order wins) keeps the sharper drone/aerial shot
 * of that day. Tolerates pre-055 (no kind column → all rows are photos) and
 * pre-052/053 (table/column missing → empty).
 */
export async function getPlacedSiteOverlays(companyId: string): Promise<SiteOverlay[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const base = 'id, url, bounds, geofence_id, taken_on, created_at, source'
    let rows: Record<string, unknown>[] | null = null
    let planRows: Record<string, unknown>[] = []
    {
      const [ph, pl] = await Promise.all([
        supabase
          .from('zone_imagery')
          .select(`${base}, kind`)
          .eq('company_id', companyId)
          .not('bounds', 'is', null)
          .neq('kind', 'plan')
          .order('taken_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('zone_imagery')
          .select(`${base}, kind, map_active`)
          .eq('company_id', companyId)
          .not('bounds', 'is', null)
          .eq('kind', 'plan')
          .eq('map_active', true)
          .limit(200),
      ])
      if (!ph.error) {
        rows = ph.data
        planRows = pl.error ? [] : (pl.data ?? [])
      }
    }
    if (!rows) {
      const { data, error } = await supabase
        .from('zone_imagery')
        .select(base)
        .eq('company_id', companyId)
        .not('bounds', 'is', null)
        .order('taken_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) return []
      rows = data
    }
    const satFirst = (r: Record<string, unknown>) => (r.source === 'satellite' ? 0 : 1)
    rows = [...(rows ?? [])].sort((a, b) =>
      String(a.taken_on ?? '').localeCompare(String(b.taken_on ?? '')) ||
      satFirst(a) - satFirst(b) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    rows = [...rows, ...planRows]
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
