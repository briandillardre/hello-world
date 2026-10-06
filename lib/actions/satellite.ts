'use server'

/**
 * Satellite site imagery (migration 131) — the one write: turn a site's
 * satellite watch on (Sentinel-2 or Planet) or off. The cron does the rest.
 *
 * Gate: signed in, not demo mode, the `edit` ability (requireEditOrThrow — a
 * view-as preview and a prospect never hold it), the `zones` view level, the
 * company's satellite add-on, a company site (not a boundary, vendor or
 * personal zone) of a sane size, and — for Planet — the key being set.
 * Writes ride the service client after those checks (the table has no member
 * write policy).
 */
import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { satelliteAddonActive } from '@/lib/db/satellite'
import { boxSize, cleanRing, ringBox, siteAoiBox } from '@/lib/satellite/geo'
import { planetBilledKm2, type Provider } from '@/lib/satellite/pricing'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Watched sites per company, by feed. */
const MAX_SITES = { sentinel2: 25, planet: 10 } as const
/** Biggest site outline (its bounding box) a satellite watch takes: ~2,200 acres. */
const MAX_SITE_BOX_KM2 = 9
/** Planet bills by area: no more than this per site (with its picture margin). */
const MAX_PLANET_KM2 = 5

export async function setZoneSatelliteAction(zoneId: string, provider: Provider | null): Promise<{ ok: boolean; error?: string }> {
  let perms: Awaited<ReturnType<typeof requireEditOrThrow>>
  try {
    perms = await requireEditOrThrow()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Your role can view this but not change it.' }
  }
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  if (!UUID.test(zoneId)) return { ok: false, error: 'That site was not found.' }
  if (provider !== null && provider !== 'sentinel2' && provider !== 'planet') return { ok: false, error: 'Pick a satellite feed.' }
  if (!perms.features.includes('zones')) return { ok: false, error: 'Your role can’t open sites.' }
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user || !companyId) return { ok: false, error: 'Sign in first.' }
  const svc = createServiceClient()

  if (provider === null) {
    const { error } = await svc.from('zone_satellite')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('zone_id', zoneId).eq('company_id', companyId)
    if (error) return { ok: false, error: 'Couldn’t turn it off — try again.' }
    revalidatePath(`/zones/${zoneId}`)
    return { ok: true }
  }

  if (!(await satelliteAddonActive(companyId))) return { ok: false, error: 'Satellite pictures are an add-on — ask us to turn it on for your company.' }
  if (provider === 'planet' && !process.env.PL_API_KEY?.trim()) {
    return { ok: false, error: 'Daily Planet pictures aren’t set up yet — ask us to turn them on.' }
  }

  const { getGeofence } = await import('@/lib/db/zones')
  const zone = await getGeofence(zoneId)
  if (!zone || zone.company_id !== companyId) return { ok: false, error: 'That site was not found.' }
  if (zone.kind === 'boundary' || zone.kind === 'vendor') return { ok: false, error: 'Satellite pictures are for sites and yards.' }
  // A personal zone is its owner's alone; satellite pictures land on the
  // company-wide photo timeline and map.
  if (zone.owner_id) return { ok: false, error: 'This is a personal zone. Make it a company site first.' }
  const ring = cleanRing(zone.geometry?.coordinates?.[0])
  if (!ring) return { ok: false, error: 'This site’s outline can’t be read — redraw it first.' }
  if (boxSize(ringBox(ring)).km2 > MAX_SITE_BOX_KM2) return { ok: false, error: 'This site is too big for one satellite picture — split it into smaller sites.' }
  if (provider === 'planet' && planetBilledKm2(boxSize(siteAoiBox(ring)).km2) > MAX_PLANET_KM2) {
    return { ok: false, error: 'This site is too big for daily Planet pictures.' }
  }

  const { count } = await svc.from('zone_satellite')
    .select('zone_id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('enabled', true).eq('provider', provider).neq('zone_id', zoneId)
  if ((count ?? 0) >= MAX_SITES[provider]) {
    return { ok: false, error: `Satellite pictures are on for ${MAX_SITES[provider]} sites already — turn one off first.` }
  }

  const { data: prev } = await svc.from('zone_satellite').select('provider, enabled').eq('zone_id', zoneId).maybeSingle()
  const now = new Date().toISOString()
  const fresh = !prev || !prev.enabled || prev.provider !== provider
  const { error } = await svc.from('zone_satellite').upsert({
    zone_id: zoneId,
    company_id: companyId,
    provider,
    enabled: true,
    ...(fresh ? { enabled_by: user.id, enabled_at: now, last_error: null } : {}),
    updated_at: now,
  }, { onConflict: 'zone_id' })
  if (error) return { ok: false, error: 'Couldn’t turn it on — try again.' }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}
