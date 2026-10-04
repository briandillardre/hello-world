'use server'

/**
 * Dirt takeoffs (migration 127) — every write. The editor runs the takeoff
 * live in the browser for feedback; SAVE sends the design here, where it is
 * validated and RUN AGAIN on the server against the same cached lidar grid —
 * the numbers and the cut/fill picture the company sees later are the
 * server's, never a figure a browser posted.
 *
 * Save runs BEFORE it writes, then stores design + numbers + picture in one
 * compare-and-set: a design too big to run is never parked where it would
 * hang every colleague's editor, and two saves racing can't leave numbers
 * that belong to the other design.
 *
 * Gate on every action: signed in, not demo mode, not a view-as preview, not
 * a prospect, the `edit` ability, the `zones` view level, and the company's
 * dirt add-on.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import { keyRateLimited } from '@/lib/rate-limit'
import { checkDesign } from '@/lib/dirt/schema'
import { emptyDesign, runTakeoff, type DirtDesign, type DirtResults, type GroundGrid } from '@/lib/dirt/takeoff'
import { heatRaster } from '@/lib/dirt/heat'
import { boxInside, boxTooBig, groundBoxFor, growBox, parseBox, type LngLatBox } from '@/lib/dirt/ground-box'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Live takeoffs allowed per site and per company. */
const MAX_PER_ZONE = 25
const MAX_PER_COMPANY = 300
/** Server run budget: lidar wait + run stay well inside the page's maxDuration (90 s). */
const LIDAR_WAIT_MS = 25_000
const RUN_MS = 40_000

type Gate = { ok: true; companyId: string; userId: string } | { ok: false; error: string }

async function gate(): Promise<Gate> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  if (isProspect(perms)) return { ok: false, error: 'This login can look, not change.' }
  if (!perms.canEdit) return { ok: false, error: 'Your role can view takeoffs but not change them.' }
  if (!perms.features.includes('zones')) return { ok: false, error: 'Your role can’t open sites.' }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user || !companyId) return { ok: false, error: 'Sign in first.' }
  if (!(await dirtAddonActive(companyId))) return { ok: false, error: 'Dirt takeoff is an add-on — ask us to turn it on for your company.' }
  return { ok: true, companyId, userId: user.id }
}

type Ring = [number, number][]

function zoneRing(zone: { geometry?: { coordinates?: number[][][] } } | null): Ring | null {
  const ring = zone?.geometry?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 6000) return null
  const pts = ring.slice(0, -1).map(p => [Number(p[0]), Number(p[1])] as [number, number])
  return pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? pts : null
}

export async function createTakeoffAction(zoneId: string, name?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(zoneId)) return { ok: false, error: 'That site was not found.' }
  const { getGeofence } = await import('@/lib/db/zones')
  const zone = await getGeofence(zoneId)
  if (!zone || zone.company_id !== g.companyId) return { ok: false, error: 'That site was not found.' }
  // A personal zone is its owner's alone — a takeoff on it would put its name
  // and outline in front of the whole company (takeoffs are company-wide).
  if (zone.owner_id) return { ok: false, error: 'This is a personal zone. Make it a company site first, then start a takeoff.' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const [{ count: here }, { count: all }] = await Promise.all([
    svc.from('dirt_takeoffs').select('id', { count: 'exact', head: true }).eq('company_id', g.companyId).eq('geofence_id', zone.id).is('deleted_at', null),
    svc.from('dirt_takeoffs').select('id', { count: 'exact', head: true }).eq('company_id', g.companyId).is('deleted_at', null),
  ])
  if ((here ?? 0) >= MAX_PER_ZONE) return { ok: false, error: `This site already has ${MAX_PER_ZONE} takeoffs — delete an old one first.` }
  if ((all ?? 0) >= MAX_PER_COMPANY) return { ok: false, error: `Your company has ${MAX_PER_COMPANY} takeoffs — delete some old ones first.` }

  // Start with the site zone as the grading limits — the estimator redraws
  // them where the proposed grading meets existing.
  const design: DirtDesign = emptyDesign()
  const ring = zoneRing(zone)
  if (ring) design.features.push({ id: `b${Date.now().toString(36)}`, kind: 'boundary', coords: ring })
  const title = ((name ?? '').trim() || `${zone.name} — dirt takeoff`).slice(0, 120)

  const { data, error } = await svc.from('dirt_takeoffs').insert({
    company_id: g.companyId, geofence_id: zone.id, name: title, design,
    created_by: g.userId, updated_by: g.userId,
  }).select('id').single()
  if (error || !data) {
    console.error('takeoff create failed', error?.message)
    return { ok: false, error: error?.code === '42P01' ? 'The database is still updating — try again in a few minutes.' : 'Could not start a takeoff. Try again in a minute.' }
  }
  revalidatePath(`/zones/${zone.id}`)
  return { ok: true, id: data.id as string }
}

export interface SaveResult {
  ok: boolean
  error?: string
  results?: DirtResults | null
  heatUrl?: string | null
  heatCorners?: [number, number][] | null
  savedAt?: string
}

/**
 * Validate, run, then store design + numbers + picture together.
 * `groundBox` is the box the editor's preview read lidar for: when it holds
 * every trace and sits by the site, the server reads the same cached grid
 * (same numbers, no second USGS read).
 */
export async function saveTakeoffAction(id: string, input: { name?: string; design: unknown; groundBox?: unknown }): Promise<SaveResult> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That takeoff was not found.' }
  if (keyRateLimited(g.userId, 'dirt-save', 6)) return { ok: false, error: 'That’s a lot of saves in a minute — wait a moment and save again.' }
  const chk = checkDesign(input?.design)
  if (!chk.ok) return { ok: false, error: chk.error }
  const design = chk.design

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: row } = await svc.from('dirt_takeoffs')
    .select('id, geofence_id, heat_path, updated_at').eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).maybeSingle()
  if (!row) return { ok: false, error: 'That takeoff was not found.' }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : ''

  // ── Existing ground ──
  let ground: GroundGrid | null = null
  const warnings: string[] = []
  let lidarDown: string | null = null
  if (design.existing.source === 'lidar') {
    const traced: Ring = design.features.flatMap(f => f.coords)
    let ring: Ring | null = null
    if (row.geofence_id) {
      const { data: z } = await svc.from('geofences_json').select('geometry').eq('id', row.geofence_id).maybeSingle()
      ring = zoneRing(z as { geometry?: { coordinates?: number[][][] } } | null)
    }
    const own = groundBoxFor([...traced, ...(ring ?? [])])
    const hint = parseBox(input?.groundBox)
    const tracedBox = groundBoxFor(traced)
    const box: LngLatBox | null = hint && own && !boxTooBig(hint) && (!tracedBox || boxInside(tracedBox, hint)) && boxInside(hint, growBox(own, 1500)) ? hint : own
    if (box && boxTooBig(box)) warnings.push('Your traces span more than about 3 km — lidar is read for sites up to that size. Trace the existing contours instead.')
    else if (box) {
      try {
        const { groundCached } = await import('@/lib/dirt/ground')
        const gr = await groundCached(svc as never, box, AbortSignal.timeout(LIDAR_WAIT_MS), { companyId: g.companyId, who: g.userId })
        if (gr.header.coverage > 0) {
          ground = gr.grid
          if (gr.header.partial) warnings.push('Part of the lidar didn’t load, so some spots use coarser USGS data — Save again in a minute for the full 1 m read.')
        } else if (gr.header.partial) lidarDown = 'USGS lidar didn’t answer'
        else warnings.push(`USGS elevation is not available here (${gr.header.source}). Trace the existing contours instead.`)
      } catch (e) {
        lidarDown = e instanceof Error && e.name === 'GroundBusy' ? 'There were too many new lidar reads in the last few minutes' : 'USGS lidar didn’t answer'
      }
    }
  }

  // ── Run (before anything is written) ──
  let results: DirtResults | null = null
  let heat: ReturnType<typeof heatRaster> = null
  if (!lidarDown) {
    try {
      const run = runTakeoff(design, ground, new Date(), { deadline: Date.now() + RUN_MS })
      results = run.results
      results.warnings = [...warnings, ...results.warnings]
      heat = heatRaster(run.ctx, { maxPx: 1400 })
      if (heat) results.heatBandFt = heat.bandFt
    } catch (e) {
      if (e instanceof Error && e.name === 'TakeoffTooBig') return { ok: false, error: e.message }
      console.error('takeoff run failed', e)
      return { ok: false, error: 'The takeoff could not run — check the traces and save again.' }
    }
  }

  let heatPath: string | null = null
  if (heat) {
    try {
      const { encodePng } = await import('@/lib/dirt/png')
      const png = encodePng(heat.width, heat.height, heat.rgba)
      heatPath = `${g.companyId}/${id}/heat-${Date.now()}.png`
      const { error } = await svc.storage.from('dirt').upload(heatPath, png, { contentType: 'image/png', upsert: false })
      if (error) { console.error('heat upload failed', error.message); heatPath = null }
    } catch (e) {
      console.error('heat encode failed', e)
      heatPath = null
    }
  }
  const removeQuietly = async (p: string | null) => {
    if (!p) return
    try { await svc.storage.from('dirt').remove([p]) } catch { /* best-effort */ }
  }

  // ── Store: one compare-and-set on the stamp read above ──
  const stamp = new Date().toISOString()
  const { data: landed, error: upErr } = await svc.from('dirt_takeoffs').update({
    design, updated_at: stamp, updated_by: g.userId, ...(name ? { name } : {}),
    results, heat_path: heatPath, heat_corners: heat && heatPath ? heat.corners : null,
    computed_at: results ? stamp : null,
  }).eq('id', id).eq('company_id', g.companyId).eq('updated_at', row.updated_at).is('deleted_at', null).select('id')
  if (upErr) {
    console.error('takeoff save failed', upErr.message)
    await removeQuietly(heatPath)
    return { ok: false, error: 'Could not save. Try again in a minute.' }
  }
  if (!landed?.length) {
    await removeQuietly(heatPath)
    return { ok: false, error: 'This takeoff was saved somewhere else while yours was running. Save again to keep your version.' }
  }
  if (row.heat_path && row.heat_path !== heatPath) await removeQuietly(row.heat_path as string)

  let heatUrl: string | null = null
  if (heatPath) {
    const { data: s } = await svc.storage.from('dirt').createSignedUrl(heatPath, 3600)
    heatUrl = s?.signedUrl ?? null
  }
  if (row.geofence_id) revalidatePath(`/zones/${row.geofence_id}`)
  revalidatePath('/map')
  return {
    ok: true, results, heatUrl, heatCorners: heat && heatPath ? heat.corners : null, savedAt: stamp,
    ...(lidarDown ? { error: `Saved your traces. ${lidarDown}, so there are no numbers yet — Save again in a minute.` } : {}),
  }
}

export async function deleteTakeoffAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That takeoff was not found.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: before } = await svc.from('dirt_takeoffs').select('heat_path').eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).maybeSingle()
  const { data, error } = await svc.from('dirt_takeoffs')
    .update({ deleted_at: new Date().toISOString(), updated_by: g.userId, heat_path: null, heat_corners: null })
    .eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).select('geofence_id')
  if (error) return { ok: false, error: 'Could not delete. Try again in a minute.' }
  if (!data?.length) {
    // A retry after a reply that never arrived: already deleted is what was asked for.
    const { data: gone } = await svc.from('dirt_takeoffs').select('id').eq('id', id).eq('company_id', g.companyId).not('deleted_at', 'is', null).maybeSingle()
    return gone ? { ok: true } : { ok: false, error: 'That takeoff was not found.' }
  }
  // The picture goes now; the row itself is purged after 30 days (health cron).
  if (before?.heat_path) {
    try { await svc.storage.from('dirt').remove([before.heat_path as string]) } catch { /* the health cron sweeps leftovers */ }
  }
  if (data[0].geofence_id) revalidatePath(`/zones/${data[0].geofence_id}`)
  revalidatePath('/map')
  return { ok: true }
}
