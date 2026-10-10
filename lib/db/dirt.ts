/**
 * Dirt takeoffs (migration 127) — server-side reads.
 *
 * The add-on is ON for a company when it has an active `company_addons` row,
 * and always for the platform owner's own company (the founder reviews it
 * live). Reads of takeoffs ride the caller's RLS client: a member sees their
 * company's takeoffs, a prospect sees none.
 */
import type { DirtDesign, DirtResults } from '@/lib/dirt/takeoff'
import type { LngLatBox } from '@/lib/dirt/ground-box'
import type { PileResults } from '@/lib/dirt/stockpile'

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

/**
 * Where a takeoff lives, read under the caller's RLS: its zone's outline plus
 * its saved traces, as a lng/lat box. The lidar route only reads ground near
 * this (a login can't use it to pull elevation for anywhere in the country).
 * Null = no such takeoff for this login.
 */
export async function takeoffExtent(id: string): Promise<LngLatBox | null> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const sb = createClient()
    const { data, error } = await sb.from('dirt_takeoffs').select('id, geofence_id, design').eq('id', id).is('deleted_at', null).maybeSingle()
    if (error || !data) return null
    const coords: [number, number][] = []
    const design = data.design as DirtDesign | null
    for (const f of Array.isArray(design?.features) ? design!.features : []) {
      for (const c of Array.isArray(f?.coords) ? f.coords : []) coords.push([Number(c[0]), Number(c[1])])
    }
    if (data.geofence_id) {
      const { getGeofence } = await import('@/lib/db/zones')
      const zone = await getGeofence(data.geofence_id as string)
      for (const c of zone?.geometry?.coordinates?.[0] ?? []) coords.push([Number(c[0]), Number(c[1])])
    }
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    for (const [lng, lat] of coords) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
    }
    return Number.isFinite(minLng) ? { minLng, minLat, maxLng, maxLat } : null
  } catch {
    return null
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

// ── Stockpiles (migration 136) ──────────────────────────────────────────────

export interface StockpileSummary {
  id: string
  name: string
  material: string
  measuredOn: string
  source: 'dsm' | 'lidar'
  toe: [number, number][]
  results: PileResults
}

export interface SurfaceSummary { id: string; name: string; flownOn: string; words: string; resM: number | null }

/** A site's measured piles, newest survey first (RLS: the caller's company, never a prospect). */
export async function listStockpiles(geofenceId: string, limit = 200): Promise<StockpileSummary[]> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(geofenceId)) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('dirt_stockpiles')
      .select('id, name, material, measured_on, source, toe, results')
      .eq('geofence_id', geofenceId).is('deleted_at', null)
      .order('measured_on', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
    if (error || !data) return []
    return data.map(r => ({
      id: r.id as string, name: r.name as string, material: r.material as string, measuredOn: r.measured_on as string,
      source: r.source as 'dsm' | 'lidar', toe: r.toe as [number, number][], results: r.results as PileResults,
    }))
  } catch {
    return []
  }
}

/** A site's ready drone surveys, newest flight first. */
export async function listSurfaces(geofenceId: string): Promise<SurfaceSummary[]> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(geofenceId)) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('dirt_surfaces')
      .select('id, name, flown_on, info').eq('geofence_id', geofenceId).eq('status', 'ready').is('deleted_at', null)
      .order('flown_on', { ascending: false }).limit(60)
    if (error || !data) return []
    return data.map(r => {
      const info = (r.info ?? {}) as { words?: string; resM?: number }
      return { id: r.id as string, name: r.name as string, flownOn: r.flown_on as string, words: info.words ?? '', resM: Number.isFinite(info.resM) ? Number(info.resM) : null }
    })
  } catch {
    return []
  }
}
