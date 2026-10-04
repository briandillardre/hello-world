/**
 * GET /api/dirt-map — the map's "Cut / fill" layer: every saved takeoff's
 * cut/fill picture (signed URL, 1 h) with its four corners and headline
 * numbers. Empty — never an error — for a company without the add-on or a
 * login that can't see takeoffs, so the layers panel doesn't call the feed
 * down.
 */
import { NextResponse } from 'next/server'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import type { DirtResults } from '@/lib/dirt/takeoff'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface DirtMapItem {
  id: string
  name: string
  zoneId: string | null
  url: string
  corners: [number, number][]
  cutCy: number
  fillCy: number
  exportCy: number
  importCy: number
  topsoilCy: number
  computedAt: string | null
}

export async function GET() {
  const empty = NextResponse.json({ takeoffs: [] as DirtMapItem[] })
  if (isMock) return empty
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) return empty
    const perms = await getMyPermissions()
    if (isProspect(perms) || !perms.features.includes('zones')) return empty
    const companyId = await getCurrentCompanyId()
    if (!(await dirtAddonActive(companyId))) return empty
    const { data, error } = await db.from('dirt_takeoffs')
      .select('id, name, geofence_id, heat_path, heat_corners, results, computed_at')
      .eq('company_id', companyId).is('deleted_at', null).not('heat_path', 'is', null)
      .order('computed_at', { ascending: false }).limit(30)
    if (error || !data?.length) return empty
    const svc = createServiceClient()
    const { data: signed } = await svc.storage.from('dirt').createSignedUrls(data.map(r => r.heat_path as string), 3600)
    const urlOf = new Map((signed ?? []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]))
    const takeoffs: DirtMapItem[] = []
    for (const r of data) {
      const url = urlOf.get(r.heat_path as string)
      const corners = r.heat_corners as [number, number][] | null
      if (!url || !Array.isArray(corners) || corners.length !== 4) continue
      const res = (r.results ?? {}) as Partial<DirtResults>
      takeoffs.push({
        id: r.id as string,
        name: r.name as string,
        zoneId: (r.geofence_id as string | null) ?? null,
        url,
        corners,
        cutCy: Number(res.cutCy) || 0,
        fillCy: Number(res.fillCy) || 0,
        exportCy: Number(res.exportCy) || 0,
        importCy: Number(res.importCy) || 0,
        topsoilCy: Number(res.topsoil?.cy) || 0,
        computedAt: (r.computed_at as string | null) ?? null,
      })
    }
    return NextResponse.json({ takeoffs })
  } catch {
    return empty
  }
}
