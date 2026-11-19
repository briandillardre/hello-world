/**
 * Site survey reads (migration 163) for the Beta page — through the caller's
 * RLS. A site's takeoffs and their versions (with legends), its drone flights,
 * its rover shot sets and the drone-vs-rover checks.
 */
import type { CheckResults } from '@/lib/survey/check'
import type { Legend } from '@/lib/dirt/versions'
import type { Shot } from '@/lib/survey/shots'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface TakeoffRow { id: string; name: string; computedAt: string | null; updatedAt: string; cutCy: number; fillCy: number }
export interface VersionRow { id: string; takeoffId: string; versionNo: number; label: string; note: string | null; createdAt: string; legend: Legend; hasPicture: boolean }
export interface FlightRow { id: string; name: string; flownOn: string; ready: boolean }
export interface ShotSetRow { id: string; name: string; takenOn: string; source: string; shots: Shot[] }
export interface CheckRow { id: string; shotsId: string; surfaceId: string; createdAt: string; results: CheckResults }
export interface SurveySite { available: boolean; takeoffs: TakeoffRow[]; versions: VersionRow[]; flights: FlightRow[]; shotSets: ShotSetRow[]; checks: CheckRow[] }

export async function getSurveySite(companyId: string, zoneId: string): Promise<SurveySite> {
  const empty: SurveySite = { available: false, takeoffs: [], versions: [], flights: [], shotSets: [], checks: [] }
  if (isMock) return empty
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [t, v, f, s, c] = await Promise.all([
      db.from('dirt_takeoffs').select('id, name, computed_at, updated_at, results').eq('company_id', companyId).eq('geofence_id', zoneId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(20),
      db.from('dirt_takeoff_versions').select('id, takeoff_id, version_no, label, note, created_at, legend, heat_path').eq('company_id', companyId).eq('geofence_id', zoneId).order('created_at', { ascending: false }).limit(200),
      db.from('dirt_surfaces').select('id, name, flown_on, status').eq('company_id', companyId).eq('geofence_id', zoneId).is('deleted_at', null).order('flown_on', { ascending: false }).limit(60),
      db.from('survey_shots').select('id, name, taken_on, source, points').eq('company_id', companyId).eq('geofence_id', zoneId).order('taken_on', { ascending: false }).limit(40),
      db.from('survey_checks').select('id, shots_id, surface_id, created_at, results').eq('company_id', companyId).eq('geofence_id', zoneId).order('created_at', { ascending: false }).limit(60),
    ])
    if (v.error || s.error || c.error) return { ...empty, takeoffs: [] }
    return {
      available: true,
      takeoffs: (t.data ?? []).map((r) => {
        const res = (r.results ?? {}) as { cutCy?: number; fillCy?: number }
        return { id: String(r.id), name: String(r.name), computedAt: (r.computed_at as string | null) ?? null, updatedAt: String(r.updated_at), cutCy: Math.round(Number(res.cutCy) || 0), fillCy: Math.round(Number(res.fillCy) || 0) }
      }),
      versions: (v.data ?? []).map((r) => ({ id: String(r.id), takeoffId: String(r.takeoff_id), versionNo: Number(r.version_no), label: String(r.label), note: (r.note as string | null) ?? null, createdAt: String(r.created_at), legend: r.legend as Legend, hasPicture: !!r.heat_path })),
      flights: (f.data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), flownOn: String(r.flown_on), ready: r.status === 'ready' })),
      shotSets: (s.data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), takenOn: String(r.taken_on), source: String(r.source), shots: (r.points as Shot[]) ?? [] })),
      checks: (c.data ?? []).map((r) => ({ id: String(r.id), shotsId: String(r.shots_id), surfaceId: String(r.surface_id), createdAt: String(r.created_at), results: r.results as CheckResults })),
    }
  } catch {
    return empty
  }
}

/** Sites that carry anything the survey reads (takeoffs, flights, shots) — for the picker. */
export async function surveySites(companyId: string): Promise<{ id: string; name: string }[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [t, f, s] = await Promise.all([
      db.from('dirt_takeoffs').select('geofence_id').eq('company_id', companyId).is('deleted_at', null).limit(500),
      db.from('dirt_surfaces').select('geofence_id').eq('company_id', companyId).is('deleted_at', null).limit(500),
      db.from('survey_shots').select('geofence_id').eq('company_id', companyId).limit(500),
    ])
    const ids = Array.from(new Set([...(t.data ?? []), ...(f.data ?? []), ...(s.data ?? [])].map((r) => r.geofence_id).filter(Boolean).map(String)))
    if (!ids.length) return []
    const { data } = await db.from('geofences').select('id, name, owner_id').in('id', ids.slice(0, 500))
    return (data ?? []).filter((g) => !g.owner_id).map((g) => ({ id: String(g.id), name: String(g.name) })).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}
