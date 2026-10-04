/**
 * Dirt takeoffs (migration 127) — server-side reads.
 *
 * The add-on is ON for a company when it has an active `company_addons` row,
 * and always for the platform owner's own company (the founder reviews it
 * live). Reads of takeoffs ride the caller's RLS client: a member sees their
 * company's takeoffs, a prospect sees none.
 */
import type { DirtDesign, DirtResults } from '@/lib/dirt/takeoff'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface TakeoffSummary {
  id: string
  name: string
  geofenceId: string | null
  updatedAt: string
  computedAt: string | null
  results: Pick<DirtResults, 'cutCy' | 'fillCy' | 'exportCy' | 'importCy' | 'onsiteCy' | 'topsoil' | 'warnings'> | null
  /** The design changed after the last run. */
  stale: boolean
}

export interface TakeoffFull {
  id: string
  name: string
  geofenceId: string | null
  design: DirtDesign
  results: DirtResults | null
  heatUrl: string | null
  heatCorners: [number, number][] | null
  updatedAt: string
  computedAt: string | null
}

export interface PlanSheet {
  id: string
  url: string
  caption: string | null
  category: string | null
  corners: [number, number][]
  active: boolean
}

/** Is the dirt takeoff add-on on for this company? Fails closed. */
export async function dirtAddonActive(companyId: string | null): Promise<boolean> {
  if (isMock) return true
  if (!companyId) return false
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const { data, error } = await svc.from('company_addons')
      .select('active').eq('company_id', companyId).eq('addon', 'dirt').maybeSingle()
    if (!error && data?.active) return true
    const { isPlatformOwnerCompany } = await import('@/lib/digest-delivery')
    return await isPlatformOwnerCompany(svc, companyId)
  } catch {
    return false
  }
}

function summaryOf(row: { id: string; name: string; geofence_id: string | null; updated_at: string; computed_at: string | null; results: DirtResults | null }): TakeoffSummary {
  const r = row.results
  return {
    id: row.id,
    name: row.name,
    geofenceId: row.geofence_id,
    updatedAt: row.updated_at,
    computedAt: row.computed_at,
    results: r ? { cutCy: r.cutCy, fillCy: r.fillCy, exportCy: r.exportCy, importCy: r.importCy, onsiteCy: r.onsiteCy, topsoil: r.topsoil, warnings: r.warnings ?? [] } : null,
    stale: !row.computed_at || new Date(row.updated_at).getTime() > new Date(row.computed_at).getTime() + 1000,
  }
}

export async function listTakeoffs(companyId: string, geofenceId?: string): Promise<TakeoffSummary[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    let q = createClient().from('dirt_takeoffs')
      .select('id, name, geofence_id, updated_at, computed_at, results')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(50)
    if (geofenceId) q = q.eq('geofence_id', geofenceId)
    const { data, error } = await q
    if (error || !data) return []
    return data.map(summaryOf)
  } catch {
    return []
  }
}

export async function getTakeoff(id: string): Promise<TakeoffFull | null> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('dirt_takeoffs')
      .select('id, name, geofence_id, design, results, heat_path, heat_corners, updated_at, computed_at')
      .eq('id', id).is('deleted_at', null).maybeSingle()
    if (error || !data) return null
    let heatUrl: string | null = null
    if (data.heat_path) {
      const { data: s } = await createServiceClient().storage.from('dirt').createSignedUrl(data.heat_path, 3600)
      heatUrl = s?.signedUrl ?? null
    }
    return {
      id: data.id,
      name: data.name,
      geofenceId: data.geofence_id,
      design: data.design as DirtDesign,
      results: (data.results as DirtResults | null) ?? null,
      heatUrl,
      heatCorners: (data.heat_corners as [number, number][] | null) ?? null,
      updatedAt: data.updated_at,
      computedAt: data.computed_at,
    }
  } catch {
    return null
  }
}

/** The zone's placed plan sheets (055), map-active first. */
export async function getPlanSheets(geofenceId: string): Promise<PlanSheet[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('zone_imagery')
      .select('id, url, caption, plan_category, bounds, map_active, kind, taken_on')
      .eq('geofence_id', geofenceId).eq('kind', 'plan').not('bounds', 'is', null)
      .order('map_active', { ascending: false }).order('taken_on', { ascending: false }).limit(20)
    if (error || !data) return []
    return data
      .filter(r => Array.isArray(r.bounds) && r.bounds.length === 4)
      .map(r => ({
        id: r.id as string,
        url: r.url as string,
        caption: (r.caption as string | null) ?? null,
        category: (r.plan_category as string | null) ?? null,
        corners: r.bounds as [number, number][],
        active: !!r.map_active,
      }))
  } catch {
    return []
  }
}
