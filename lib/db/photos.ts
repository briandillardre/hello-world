/**
 * Field photos (migration 101) — every job photo that knows where it was
 * taken. One read helper for the /photos page, the map layer's API and the
 * Agent Interface, so all three tell the same story.
 */
export interface FieldPhoto {
  id: string
  url: string
  thumb_url: string | null
  lat: number
  lng: number
  taken_at: string
  caption: string | null
  source: 'camera' | 'daily_log' | 'import'
  source_id: string | null
  geofence_id: string | null
  user_id: string | null
  zone: string | null
  by: string | null
}

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Photos in a window (default: the last 30 days), newest first, with the
 *  site name and the photographer's name resolved. RLS-scoped through the
 *  caller's session. Pre-101 databases return []. */
export async function getFieldPhotos(opts: { fromMs?: number; toMs?: number; zoneId?: string | null; limit?: number } = {}): Promise<FieldPhoto[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const to = opts.toMs ?? Date.now()
    const from = opts.fromMs ?? to - 30 * 86_400_000
    let q = supabase.from('field_photos')
      .select('id, url, thumb_url, lat, lng, taken_at, caption, source, source_id, geofence_id, user_id')
      .gte('taken_at', new Date(from).toISOString())
      .lte('taken_at', new Date(to).toISOString())
      .order('taken_at', { ascending: false })
      .limit(Math.min(opts.limit ?? 600, 2000))
    if (opts.zoneId) q = q.eq('geofence_id', opts.zoneId)
    const [{ data, error }, { data: zones }, { data: people }] = await Promise.all([
      q,
      supabase.from('geofences').select('id, name').limit(1000),
      supabase.from('profiles').select('id, name'),
    ])
    if (error) return []
    const zoneName = new Map((zones ?? []).map((z) => [z.id as string, z.name as string]))
    const personName = new Map((people ?? []).map((p) => [p.id as string, (p.name as string) || null]))
    return (data ?? []).map((r) => ({
      id: r.id as string,
      url: r.url as string,
      thumb_url: (r.thumb_url as string | null) ?? null,
      lat: Number(r.lat),
      lng: Number(r.lng),
      taken_at: r.taken_at as string,
      caption: (r.caption as string | null) ?? null,
      source: r.source as FieldPhoto['source'],
      source_id: (r.source_id as string | null) ?? null,
      geofence_id: (r.geofence_id as string | null) ?? null,
      user_id: (r.user_id as string | null) ?? null,
      zone: r.geofence_id ? zoneName.get(r.geofence_id as string) ?? null : null,
      by: r.user_id ? personName.get(r.user_id as string) ?? null : null,
    }))
  } catch {
    return []
  }
}
