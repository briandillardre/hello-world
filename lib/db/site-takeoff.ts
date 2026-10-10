/**
 * Site takeoffs (migration 137) — server-side reads.
 *
 * The add-on is ON for a company with an active `company_addons` row
 * ('site_takeoff'), and always for the platform owner's own company (the
 * founder reviews it live) — the dirt add-on's rule. Takeoff reads ride the
 * caller's RLS client: a member sees their company's, a prospect none.
 */
import type { SiteDesign } from '@/lib/site-takeoff/items'
import type { SiteResults } from '@/lib/site-takeoff/measure'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SiteTakeoffSummary {
  id: string
  name: string
  zoneId: string | null
  updatedAt: string
  total: number | null
  /** Line items with a quantity. */
  lines: number
}

export interface SiteTakeoffFull {
  id: string
  name: string
  zoneId: string | null
  imageryId: string | null
  design: SiteDesign
  results: SiteResults | null
  updatedAt: string
}

/** A zone's placed picture the takeoff can trace on. */
export interface Ortho {
  id: string
  url: string
  takenOn: string
  caption: string | null
  source: string
  corners: [number, number][]
}

/** Is the site takeoff add-on on for this company? Fails closed. */
export async function siteTakeoffAddonActive(companyId: string | null): Promise<boolean> {
  if (isMock) return true
  if (!companyId) return false
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const { data, error } = await svc.from('company_addons')
      .select('active').eq('company_id', companyId).eq('addon', 'site_takeoff').maybeSingle()
    if (!error && data?.active) return true
    const { isPlatformOwnerCompany } = await import('@/lib/digest-delivery')
    return await isPlatformOwnerCompany(svc, companyId)
  } catch {
    return false
  }
}

export async function listSiteTakeoffs(companyId: string, zoneId?: string): Promise<SiteTakeoffSummary[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    let q = createClient().from('site_takeoffs')
      .select('id, name, zone_id, updated_at, results')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(50)
    if (zoneId) q = q.eq('zone_id', zoneId)
    const { data, error } = await q
    if (error || !data) return []
    return data.map(r => {
      const res = r.results as SiteResults | null
      return {
        id: r.id as string,
        name: r.name as string,
        zoneId: (r.zone_id as string | null) ?? null,
        updatedAt: r.updated_at as string,
        total: res ? res.total : null,
        lines: res ? res.items.filter(i => i.qty > 0).length : 0,
      }
    })
  } catch {
    return []
  }
}

export async function getSiteTakeoff(id: string): Promise<SiteTakeoffFull | null> {
  if (isMock || !UUID.test(id)) return null
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('site_takeoffs')
      .select('id, name, zone_id, imagery_id, design, results, updated_at')
      .eq('id', id).is('deleted_at', null).maybeSingle()
    if (error || !data) return null
    return {
      id: data.id as string,
      name: data.name as string,
      zoneId: (data.zone_id as string | null) ?? null,
      imageryId: (data.imagery_id as string | null) ?? null,
      design: data.design as SiteDesign,
      results: (data.results as SiteResults | null) ?? null,
      updatedAt: data.updated_at as string,
    }
  } catch {
    return null
  }
}

/**
 * The zone's PLACED pictures a takeoff may trace on and run the assist over:
 * the company's own uploads (drone, aerial, ground) — never satellite frames
 * (Sentinel-2 is 10 m, and Planet's licence does not cover this).
 */
export async function getZoneOrthos(zoneId: string): Promise<Ortho[]> {
  if (isMock || !UUID.test(zoneId)) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('zone_imagery')
      .select('id, url, taken_on, caption, source, bounds, kind')
      .eq('geofence_id', zoneId).eq('kind', 'photo').neq('source', 'satellite').not('bounds', 'is', null)
      .order('taken_on', { ascending: false }).limit(40)
    if (error || !data) return []
    return data
      .filter(r => Array.isArray(r.bounds) && r.bounds.length === 4)
      .map(r => ({
        id: r.id as string,
        url: r.url as string,
        takenOn: r.taken_on as string,
        caption: (r.caption as string | null) ?? null,
        source: r.source as string,
        corners: r.bounds as [number, number][],
      }))
  } catch {
    return []
  }
}
