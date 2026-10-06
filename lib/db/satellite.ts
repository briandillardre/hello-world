/**
 * Satellite site imagery (migration 131) — server-side reads.
 *
 * The add-on is ON for a company with an active `company_addons` row
 * ('satellite'), and always for the platform owner's own company — the
 * dirt-takeoff rule. A site's subscription and its scene tally are read under
 * the caller's RLS (company-scoped; never the cost columns).
 */
import type { Provider } from '@/lib/satellite/pricing'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ZoneSatelliteState {
  provider: Provider
  enabled: boolean
  enabledAt: string
  lastCheckedAt: string | null
  lastSceneAt: string | null
  lastError: string | null
  /** Pictures on this site's timeline from the satellite, and passes skipped for cloud. */
  pictures: number
  cloudy: number
  /** Planet orders being made. */
  pending: number
}

/** Is the satellite add-on on for this company? Fails closed. */
export async function satelliteAddonActive(companyId: string | null): Promise<boolean> {
  if (isMock || !companyId) return false
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const { data, error } = await svc.from('company_addons')
      .select('active').eq('company_id', companyId).eq('addon', 'satellite').maybeSingle()
    if (!error && data?.active) return true
    const { isPlatformOwnerCompany } = await import('@/lib/digest-delivery')
    return await isPlatformOwnerCompany(svc, companyId)
  } catch {
    return false
  }
}

/**
 * A site's satellite subscription + tally, under the caller's RLS.
 * `undefined` = the tables aren't there yet (pre-131) — render nothing;
 * `null` = never turned on.
 */
export async function getZoneSatellite(zoneId: string): Promise<ZoneSatelliteState | null | undefined> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(zoneId)) return undefined
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const sb = createClient()
    const { data: sub, error } = await sb.from('zone_satellite')
      .select('provider, enabled, enabled_at, last_checked_at, last_scene_at, last_error')
      .eq('zone_id', zoneId).maybeSingle()
    if (error) return undefined
    if (!sub) return null
    const count = async (status: string) => {
      const { count: n } = await sb.from('satellite_scenes')
        .select('id', { count: 'exact', head: true })
        .eq('zone_id', zoneId).eq('provider', sub.provider).eq('status', status)
      return n ?? 0
    }
    const [pictures, cloudy, pending] = await Promise.all([count('ingested'), count('cloudy'), count('pending')])
    return {
      provider: sub.provider === 'planet' ? 'planet' : 'sentinel2',
      enabled: !!sub.enabled,
      enabledAt: String(sub.enabled_at),
      lastCheckedAt: (sub.last_checked_at as string | null) ?? null,
      lastSceneAt: (sub.last_scene_at as string | null) ?? null,
      lastError: (sub.last_error as string | null) ?? null,
      pictures, cloudy, pending,
    }
  } catch {
    return undefined
  }
}
