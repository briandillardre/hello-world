/**
 * Progress by drone flight (migration 150) — read under the caller's own RLS
 * (the company's; a personal zone's only for its owner; nothing for a
 * prospect). The day's cut / fill-to-grade pictures come back as one-hour
 * signed links, made only for rows the RLS read returned.
 */
import type { ProgressResults } from '@/lib/dirt/progress'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ProgressRow {
  id: string
  takeoffId: string
  surfaceId: string
  flownOn: string
  results: ProgressResults
  heatUrl: string | null
  heatCorners: [number, number][] | null
  updatedAt: string
}

export async function getProgress(zoneId: string): Promise<ProgressRow[]> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(zoneId)) return []
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('dirt_progress')
      .select('id, takeoff_id, surface_id, flown_on, results, heat_path, heat_corners, updated_at')
      .eq('geofence_id', zoneId).order('flown_on', { ascending: false }).limit(300)
    if (error || !data) return []
    const paths = data.map((r) => r.heat_path).filter((p): p is string => typeof p === 'string')
    const signed = paths.length ? (await createServiceClient().storage.from('dirt').createSignedUrls(paths, 3600)).data ?? [] : []
    const urlOf = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [String(s.path), String(s.signedUrl)]))
    return data.map((r) => {
      const corners = Array.isArray(r.heat_corners) && r.heat_corners.length === 4 ? (r.heat_corners as [number, number][]) : null
      return {
        id: String(r.id), takeoffId: String(r.takeoff_id), surfaceId: String(r.surface_id), flownOn: String(r.flown_on),
        results: r.results as ProgressResults, heatUrl: r.heat_path ? urlOf.get(String(r.heat_path)) ?? null : null,
        heatCorners: corners, updatedAt: String(r.updated_at),
      }
    })
  } catch {
    return []
  }
}
