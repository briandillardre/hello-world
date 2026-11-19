/**
 * GET /api/survey-map — the map's "Drone topo & survey" layer (163, Beta):
 *  - flights: each site's drone surfaces (date + footprint) — the client asks
 *    /api/drone-topo for the contours of the one that stood on the scrubbed day;
 *  - checks: rover shots coloured by how far the drone was off;
 *  - shots: shot sets with no check yet, as plain survey points;
 *  - versions: each frozen takeoff version's cut/fill picture with its date, so
 *    the Cut / fill layer can show the version that stood on the scrubbed day.
 * Empty — never an error — without the add-on, Beta, or the zones level.
 * Flights, shots and checks are the survey tool's (Foreman+ with Plans);
 * `?parts=versions` (the Cut / fill layer alone) skips them entirely.
 */
import { NextResponse } from 'next/server'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { toolByKey } from '@/lib/beta/tools'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import type { CheckResults } from '@/lib/survey/check'
import type { Shot } from '@/lib/survey/shots'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SurveyMapData {
  flights: { id: string; zoneId: string | null; name: string; flownOn: string; bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null }[]
  checks: { id: string; shotsId: string; zoneId: string; at: string; takenOn: string | null; bias: number; verdict: string; shots: [number, number, number | null, string, string][] }[]
  shots: { id: string; zoneId: string; takenOn: string; name: string; shots: [number, number, number, string, string][] }[]
  versions: { id: string; takeoffId: string; zoneId: string | null; versionNo: number; label: string; createdAt: string; url: string; corners: [number, number][]; cutCy: number; fillCy: number; exportCy: number; importCy: number }[]
}

export async function GET(req: Request) {
  const none: SurveyMapData = { flights: [], checks: [], shots: [], versions: [] }
  const empty = NextResponse.json(none)
  if (isMock) return empty
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) return empty
    const perms = await getMyPermissions()
    if (isProspect(perms) || !perms.features.includes('zones') || !perms.features.includes('beta')) return empty
    const companyId = await getCurrentCompanyId()
    if (!(await dirtAddonActive(companyId))) return empty
    const surveyTool = new URL(req.url).searchParams.get('parts') !== 'versions' && toolByKey('survey').canOpen(perms, false)
    const skip = Promise.resolve({ data: [] as Record<string, unknown>[] })
    const [f, c, s, v] = await Promise.all([
      !surveyTool ? skip : db.from('dirt_surfaces').select('id, geofence_id, name, flown_on, info, status').eq('company_id', companyId).is('deleted_at', null).eq('status', 'ready').order('flown_on', { ascending: false }).limit(200),
      !surveyTool ? skip : db.from('survey_checks').select('id, geofence_id, shots_id, created_at, results').eq('company_id', companyId).order('created_at', { ascending: false }).limit(40),
      !surveyTool ? skip : db.from('survey_shots').select('id, geofence_id, name, taken_on, points').eq('company_id', companyId).order('taken_on', { ascending: false }).limit(40),
      db.from('dirt_takeoff_versions').select('id, takeoff_id, geofence_id, version_no, label, created_at, heat_path, heat_corners, legend').eq('company_id', companyId).not('heat_path', 'is', null).order('created_at', { ascending: false }).limit(120),
    ])
    const checked = new Set((c.data ?? []).map((r) => String(r.shots_id)))
    const takenOn = new Map((s.data ?? []).map((r) => [String(r.id), String(r.taken_on)]))
    const out: SurveyMapData = {
      flights: (f.data ?? []).map((r) => ({ id: String(r.id), zoneId: (r.geofence_id as string | null) ?? null, name: String(r.name), flownOn: String(r.flown_on), bounds: ((r.info as { bounds?: SurveyMapData['flights'][number]['bounds'] } | null)?.bounds) ?? null })),
      // one check per shot set: the newest (a set checked against two flights drew every shot twice)
      checks: (c.data ?? []).filter((r, i, all) => all.findIndex((x) => x.shots_id === r.shots_id) === i).map((r) => {
        const res = r.results as CheckResults
        return {
          id: String(r.id), shotsId: String(r.shots_id), zoneId: String(r.geofence_id), at: String(r.created_at), takenOn: takenOn.get(String(r.shots_id)) ?? null, bias: res.all?.bias ?? 0, verdict: res.verdict?.words ?? '',
          shots: (res.shots ?? []).slice(0, 5000).map((p) => [p.lng, p.lat, p.dz, p.kind, p.id] as [number, number, number | null, string, string]),
        }
      }),
      shots: (s.data ?? []).filter((r) => !checked.has(String(r.id))).map((r) => ({
        id: String(r.id), zoneId: String(r.geofence_id), takenOn: String(r.taken_on), name: String(r.name),
        shots: ((r.points as Shot[]) ?? []).slice(0, 5000).map((p) => [p.lng, p.lat, p.z, p.kind, p.id] as [number, number, number, string, string]),
      })),
      versions: [],
    }
    const vs = (v.data ?? []).filter((r) => Array.isArray(r.heat_corners) && (r.heat_corners as unknown[]).length === 4)
    if (vs.length) {
      const { data: signed } = await createServiceClient().storage.from('dirt').createSignedUrls(vs.map((r) => String(r.heat_path)), 3600)
      const urlOf = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]))
      for (const r of vs) {
        const url = urlOf.get(String(r.heat_path))
        if (!url) continue
        const ew = (r.legend as { earthwork?: { cutCy?: number; fillCy?: number; exportCy?: number; importCy?: number } } | null)?.earthwork
        out.versions.push({ id: String(r.id), takeoffId: String(r.takeoff_id), zoneId: (r.geofence_id as string | null) ?? null, versionNo: Number(r.version_no), label: String(r.label), createdAt: String(r.created_at), url, corners: r.heat_corners as [number, number][], cutCy: Number(ew?.cutCy) || 0, fillCy: Number(ew?.fillCy) || 0, exportCy: Number(ew?.exportCy) || 0, importCy: Number(ew?.importCy) || 0 })
      }
    }
    return NextResponse.json(out)
  } catch {
    return empty
  }
}
