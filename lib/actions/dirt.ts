'use server'

/**
 * Dirt takeoffs (migration 127) — every write. The editor runs the takeoff
 * live in the browser for feedback; SAVE sends the design here, where it is
 * validated, stored, and RUN AGAIN on the server against the same cached
 * lidar grid — the numbers and the cut/fill picture the company sees later
 * are the server's, never a figure a browser posted.
 *
 * Gate on every action: signed in, not demo mode, not a view-as preview, not
 * a prospect, the `edit` ability, and the company's dirt add-on.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import { checkDesign } from '@/lib/dirt/schema'
import { emptyDesign, runTakeoff, type DirtDesign, type DirtResults, type GroundGrid } from '@/lib/dirt/takeoff'
import { heatRaster } from '@/lib/dirt/heat'
import { boxTooBig, groundBoxFor } from '@/lib/dirt/ground-box'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Gate = { ok: true; companyId: string; userId: string } | { ok: false; error: string }

async function gate(): Promise<Gate> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  if (isProspect(perms)) return { ok: false, error: 'This login can look, not change.' }
  if (!perms.canEdit) return { ok: false, error: 'Your role can view takeoffs but not change them.' }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user || !companyId) return { ok: false, error: 'Sign in first.' }
  if (!(await dirtAddonActive(companyId))) return { ok: false, error: 'Dirt takeoff is an add-on — ask us to turn it on for your company.' }
  return { ok: true, companyId, userId: user.id }
}

export async function createTakeoffAction(zoneId: string, name?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(zoneId)) return { ok: false, error: 'That site was not found.' }
  const { getGeofence } = await import('@/lib/db/zones')
  const zone = await getGeofence(zoneId)
  if (!zone || zone.company_id !== g.companyId) return { ok: false, error: 'That site was not found.' }

  // Start with the site zone as the grading limits — the estimator redraws
  // them where the proposed grading meets existing.
  const design: DirtDesign = emptyDesign()
  const ring = zone.geometry?.coordinates?.[0]
  if (Array.isArray(ring) && ring.length >= 4 && ring.length <= 6000) {
    const pts = ring.slice(0, -1).map(p => [Number(p[0]), Number(p[1])] as [number, number])
    if (pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
      design.features.push({ id: `b${Date.now().toString(36)}`, kind: 'boundary', coords: pts })
    }
  }
  const title = (name ?? '').trim().slice(0, 120) || `${zone.name} — dirt takeoff`

  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data, error } = await createServiceClient().from('dirt_takeoffs').insert({
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
  results?: DirtResults
  heatUrl?: string | null
  heatCorners?: [number, number][] | null
  savedAt?: string
}

/**
 * Save the design and run it on the server. A slower run that finishes after
 * a newer save never overwrites the newer numbers (compare-and-set on the
 * save stamp).
 */
export async function saveTakeoffAction(id: string, input: { name?: string; design: unknown }): Promise<SaveResult> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That takeoff was not found.' }
  const chk = checkDesign(input?.design)
  if (!chk.ok) return { ok: false, error: chk.error }
  const design = chk.design

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: row } = await svc.from('dirt_takeoffs')
    .select('id, geofence_id, heat_path').eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).maybeSingle()
  if (!row) return { ok: false, error: 'That takeoff was not found.' }

  const stamp = new Date().toISOString()
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : ''
  const { error: upErr } = await svc.from('dirt_takeoffs').update({
    design, updated_at: stamp, updated_by: g.userId, ...(name ? { name } : {}),
  }).eq('id', id).eq('company_id', g.companyId)
  if (upErr) {
    console.error('takeoff save failed', upErr.message)
    return { ok: false, error: 'Could not save. Try again in a minute.' }
  }

  // ── Run it ──
  let ground: GroundGrid | null = null
  const warnings: string[] = []
  if (design.existing.source === 'lidar') {
    const box = groundBoxFor(design.features.flatMap(f => f.coords))
    if (box && boxTooBig(box)) warnings.push('Your traces span more than about 3 km — lidar is read for sites up to that size. Trace the existing contours instead.')
    else if (box) {
      try {
        const { groundCached } = await import('@/lib/dirt/ground')
        const gr = await groundCached(svc as never, box, AbortSignal.timeout(40000))
        if (gr.header.coverage > 0) ground = gr.grid
        else warnings.push(`USGS elevation is not available here (${gr.header.source}). Trace the existing contours instead.`)
      } catch {
        warnings.push('USGS elevation did not answer — try Save again in a minute, or trace the existing contours.')
      }
    }
  }
  let results: DirtResults
  let heat: ReturnType<typeof heatRaster> = null
  try {
    const run = runTakeoff(design, ground)
    results = run.results
    results.warnings = [...warnings, ...results.warnings]
    heat = heatRaster(run.ctx, { maxPx: 1400 })
    if (heat) results.heatBandFt = heat.bandFt
  } catch (e) {
    console.error('takeoff run failed', e)
    return { ok: true, savedAt: stamp, error: 'Saved, but the takeoff could not run — check the traces and save again.' }
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

  const { data: landed } = await svc.from('dirt_takeoffs').update({
    results, heat_path: heatPath, heat_corners: heat && heatPath ? heat.corners : null, computed_at: new Date().toISOString(),
  }).eq('id', id).eq('company_id', g.companyId).eq('updated_at', stamp).select('id')
  const stale = !landed?.length
  // Tidy: drop the picture this run replaced (or its own, when a newer save won).
  const toRemove = stale ? heatPath : row.heat_path && row.heat_path !== heatPath ? row.heat_path : null
  if (toRemove) {
    try { await svc.storage.from('dirt').remove([toRemove]) } catch { /* best-effort */ }
  }
  let heatUrl: string | null = null
  if (heatPath && !stale) {
    const { data: s } = await svc.storage.from('dirt').createSignedUrl(heatPath, 3600)
    heatUrl = s?.signedUrl ?? null
  }
  if (row.geofence_id) revalidatePath(`/zones/${row.geofence_id}`)
  revalidatePath('/map')
  return { ok: true, results, heatUrl, heatCorners: heat && heatPath ? heat.corners : null, savedAt: stamp }
}

export async function deleteTakeoffAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That takeoff was not found.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data, error } = await createServiceClient().from('dirt_takeoffs')
    .update({ deleted_at: new Date().toISOString(), updated_by: g.userId })
    .eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).select('geofence_id')
  if (error) return { ok: false, error: 'Could not delete. Try again in a minute.' }
  if (!data?.length) return { ok: false, error: 'That takeoff was not found.' }
  if (data[0].geofence_id) revalidatePath(`/zones/${data[0].geofence_id}`)
  revalidatePath('/map')
  return { ok: true }
}
