'use server'

/**
 * Site takeoffs (migration 137) — every write. The editor computes
 * quantities live for feedback; SAVE sends the design here, where it is
 * validated (lib/site-takeoff/schema.ts) and the quantities are computed AGAIN
 * on the server — the numbers stored and printed are the server's, never a
 * figure a browser posted.
 *
 * Gate on every action: signed in, not demo mode, `requireEditOrThrow` (edit
 * ability, never inside a view-as preview), not a prospect, the `zones` view
 * level, and the company's site_takeoff add-on.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions, requireEditOrThrow } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { siteTakeoffAddonActive } from '@/lib/db/site-takeoff'
import { keyRateLimited } from '@/lib/rate-limit'
import { checkSiteDesign } from '@/lib/site-takeoff/schema'
import { computeSite, type SiteResults } from '@/lib/site-takeoff/measure'
import { emptySiteDesign } from '@/lib/site-takeoff/items'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PER_ZONE = 25
const MAX_PER_COMPANY = 300

type Gate = { ok: true; companyId: string; userId: string } | { ok: false; error: string }

async function gate(): Promise<Gate> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  if (isProspect(perms)) return { ok: false, error: 'This login can look, not change.' }
  try { await requireEditOrThrow() } catch { return { ok: false, error: 'Your role can view takeoffs but not change them.' } }
  if (!perms.features.includes('zones')) return { ok: false, error: 'Your role can’t open sites.' }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user || !companyId) return { ok: false, error: 'Sign in first.' }
  if (!(await siteTakeoffAddonActive(companyId))) return { ok: false, error: 'Site takeoff is an add-on — ask us to turn it on for your company.' }
  return { ok: true, companyId, userId: user.id }
}

/** The picture must be this company's, on this zone, placed, and not a satellite frame. */
async function imageryOk(svc: ReturnType<typeof import('@/lib/supabase-server').createServiceClient>, companyId: string, zoneId: string | null, imageryId: string | null): Promise<boolean> {
  if (!imageryId) return true
  if (!zoneId) return false
  const { data } = await svc.from('zone_imagery')
    .select('id, kind, source, bounds').eq('id', imageryId).eq('company_id', companyId).eq('geofence_id', zoneId).maybeSingle()
  return !!data && data.kind === 'photo' && data.source !== 'satellite' && Array.isArray(data.bounds) && data.bounds.length === 4
}

export async function createSiteTakeoffAction(zoneId: string, imageryId?: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(zoneId)) return { ok: false, error: 'That site was not found.' }
  const img = imageryId && UUID.test(imageryId) ? imageryId : null
  const { getGeofence } = await import('@/lib/db/zones')
  const zone = await getGeofence(zoneId)
  if (!zone || zone.company_id !== g.companyId) return { ok: false, error: 'That site was not found.' }
  if (zone.owner_id) return { ok: false, error: 'This is a personal zone. Make it a company site first, then start a takeoff.' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  if (!(await imageryOk(svc, g.companyId, zone.id, img))) return { ok: false, error: 'That picture is not placed on this site.' }
  const [{ count: here }, { count: all }] = await Promise.all([
    svc.from('site_takeoffs').select('id', { count: 'exact', head: true }).eq('company_id', g.companyId).eq('zone_id', zone.id).is('deleted_at', null),
    svc.from('site_takeoffs').select('id', { count: 'exact', head: true }).eq('company_id', g.companyId).is('deleted_at', null),
  ])
  if ((here ?? 0) >= MAX_PER_ZONE) return { ok: false, error: `This site already has ${MAX_PER_ZONE} takeoffs — delete an old one first.` }
  if ((all ?? 0) >= MAX_PER_COMPANY) return { ok: false, error: `Your company has ${MAX_PER_COMPANY} takeoffs — delete some old ones first.` }

  const design = emptySiteDesign(img)
  const { data, error } = await svc.from('site_takeoffs').insert({
    company_id: g.companyId, zone_id: zone.id, imagery_id: img,
    name: `${zone.name} — site takeoff`.slice(0, 120), design,
    results: computeSite(design), computed_at: new Date().toISOString(),
    created_by: g.userId, updated_by: g.userId,
  }).select('id').single()
  if (error || !data) {
    console.error('site takeoff create failed', error?.message)
    return { ok: false, error: error?.code === '42P01' ? 'The database is still updating — try again in a few minutes.' : 'Could not start a takeoff. Try again in a minute.' }
  }
  revalidatePath(`/zones/${zone.id}`)
  return { ok: true, id: data.id as string }
}

export interface SiteSaveResult {
  ok: boolean
  error?: string
  results?: SiteResults
  savedAt?: string
}

/**
 * Validate, compute, store. `since` is the updated_at the editor loaded or
 * last saved: a save over someone else's newer save is refused, not merged.
 */
export async function saveSiteTakeoffAction(id: string, input: { name?: string; design: unknown; since?: string }): Promise<SiteSaveResult> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That takeoff was not found.' }
  if (keyRateLimited(g.userId, 'site-takeoff-save', 12)) return { ok: false, error: 'That’s a lot of saves in a minute — wait a moment and save again.' }
  const chk = checkSiteDesign(input?.design)
  if (!chk.ok) return { ok: false, error: chk.error }
  const design = chk.design

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: row } = await svc.from('site_takeoffs')
    .select('id, zone_id, updated_at').eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).maybeSingle()
  if (!row) return { ok: false, error: 'That takeoff was not found.' }
  if (!(await imageryOk(svc, g.companyId, row.zone_id as string | null, design.imageryId))) return { ok: false, error: 'That picture is not placed on this site.' }

  const results = computeSite(design)
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : ''
  const now = new Date().toISOString()
  let q = svc.from('site_takeoffs').update({
    design, results, imagery_id: design.imageryId, computed_at: now, updated_at: now, updated_by: g.userId,
    ...(name ? { name } : {}),
  }).eq('id', id).eq('company_id', g.companyId).is('deleted_at', null)
  if (typeof input.since === 'string' && input.since) q = q.eq('updated_at', input.since)
  const { data: saved, error } = await q.select('updated_at').maybeSingle()
  if (error) {
    console.error('site takeoff save failed', error.message)
    return { ok: false, error: 'Could not save. Try again in a minute.' }
  }
  if (!saved) return { ok: false, error: 'Someone else saved this takeoff since you opened it — reload to see their changes.' }
  if (row.zone_id) revalidatePath(`/zones/${row.zone_id}`)
  return { ok: true, results, savedAt: saved.updated_at as string }
}

export async function deleteSiteTakeoffAction(id: string): Promise<{ ok: boolean; error?: string; zoneId?: string | null }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That takeoff was not found.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data, error } = await createServiceClient().from('site_takeoffs')
    .update({ deleted_at: new Date().toISOString(), updated_by: g.userId })
    .eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).select('zone_id').maybeSingle()
  if (error || !data) return { ok: false, error: 'That takeoff was not found.' }
  if (data.zone_id) revalidatePath(`/zones/${data.zone_id}`)
  return { ok: true, zoneId: (data.zone_id as string | null) ?? null }
}
