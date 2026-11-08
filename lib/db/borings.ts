/**
 * A site's borings and test pits (migration 148) — read under the caller's
 * own RLS: the company's, a personal zone's only for its owner, nothing for a
 * prospect. Pit photos come back as short signed links, made only for rows
 * the RLS read returned.
 */
import type { BoringIn } from '@/lib/borings/ground'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export type BoringSource = 'log' | 'sheet' | 'pit' | 'map'

export interface BoringRow extends BoringIn {
  source: BoringSource
  sourceRef: string | null
  note: string | null
  hasPhoto: boolean
  /** A 10-minute signed link, when asked for. */
  photoUrl: string | null
  updatedAt: string
}

export const BORING_COLS = 'id, name, kind, lat, lng, ground_ft, depth_ft, topsoil_in, fill_ft, pwr_ft, refusal_ft, water_ft, water_24h_ft, unsuitable_ft, source, source_ref, note, photo_path, updated_at'

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

export function boringFromRow(r: Record<string, unknown>): BoringRow {
  return {
    id: String(r.id), name: String(r.name), kind: r.kind === 'pit' ? 'pit' : 'boring',
    lat: Number(r.lat), lng: Number(r.lng), groundFt: num(r.ground_ft), depthFt: Number(r.depth_ft),
    topsoilIn: num(r.topsoil_in), fillFt: num(r.fill_ft), pwrFt: num(r.pwr_ft), refusalFt: num(r.refusal_ft),
    waterFt: num(r.water_ft), water24hFt: num(r.water_24h_ft), unsuitableFt: num(r.unsuitable_ft),
    source: (['log', 'sheet', 'pit', 'map'].includes(String(r.source)) ? r.source : 'log') as BoringSource,
    sourceRef: r.source_ref ? String(r.source_ref) : null, note: r.note ? String(r.note) : null,
    hasPhoto: !!r.photo_path, photoUrl: null, updatedAt: String(r.updated_at),
  }
}

/** Natural order: B-2 before B-10. */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en-US', { numeric: true, sensitivity: 'base' })

export async function getBorings(zoneId: string, opts: { photos?: boolean } = {}): Promise<BoringRow[]> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(zoneId)) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('borings').select(BORING_COLS).eq('geofence_id', zoneId).is('deleted_at', null).limit(500)
    if (error || !data) return []
    const rows = (data as Record<string, unknown>[]).map((r) => ({ row: boringFromRow(r), path: r.photo_path ? String(r.photo_path) : null }))
    if (opts.photos) {
      const paths = rows.map((r) => r.path).filter((p): p is string => !!p)
      if (paths.length) {
        const { createServiceClient } = await import('@/lib/supabase-server')
        const { data: signed } = await createServiceClient().storage.from('plans').createSignedUrls(paths, 600)
        const by = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [String(s.path), String(s.signedUrl)]))
        for (const r of rows) if (r.path) r.row.photoUrl = by.get(r.path) ?? null
      }
    }
    return rows.map((r) => r.row).sort(byName)
  } catch {
    return []
  }
}
