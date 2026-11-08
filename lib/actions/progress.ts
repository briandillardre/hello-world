'use server'

/**
 * Progress by drone flight (migration 150). Inside the dirt takeoff add-on,
 * behind the same gate as the stockpiles: the SERVER reads the flight (only
 * the grading limits' window, plus a band around them), levels it on the
 * untouched band against the lidar, runs the site's design against it and
 * stores the numbers and the day's cut / fill-to-grade picture.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import { keyRateLimited } from '@/lib/rate-limit'
import { checkDesign } from '@/lib/dirt/schema'
import { FT, runTakeoff, type DirtResults } from '@/lib/dirt/takeoff'
import { fromFrame, makeFrame } from '@/lib/dirt/tm'
import { boxTooBig, groundBoxFor } from '@/lib/dirt/ground-box'
import { BAND_M, bandDiffs, datumFit, flightGround, limitsOf, progressDesign, progressResults, type DatumFit, type ProgressResults } from '@/lib/dirt/progress'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RUN_MS = 40_000

type Gate = { ok: true; companyId: string; userId: string } | { ok: false; error: string }

async function gate(): Promise<Gate> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  if (isProspect(perms)) return { ok: false, error: 'This login can look, not change.' }
  if (!perms.canEdit) return { ok: false, error: 'Your role can view progress but not measure it.' }
  if (!perms.features.includes('plans')) return { ok: false, error: 'Plans aren’t open for your login.' }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user || !companyId) return { ok: false, error: 'Sign in first.' }
  if (!(await dirtAddonActive(companyId))) return { ok: false, error: 'Progress by flight is part of the dirt takeoff add-on — ask us to turn it on for your company.' }
  return { ok: true, companyId, userId: user.id }
}

export async function measureProgressAction(input: { takeoffId: string; surfaceId: string; asFlown?: boolean }): Promise<{ ok: true; results: ProgressResults } | { ok: false; error: string }> {
  const g = await gate()
  if (!g.ok) return g
  if (!UUID.test(String(input?.takeoffId)) || !UUID.test(String(input?.surfaceId))) return { ok: false, error: 'That flight or takeoff was not found.' }
  if (keyRateLimited(g.userId, 'dirt-progress', 6)) return { ok: false, error: 'That’s a lot of measurements in a minute — wait a moment.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: t } = await svc.from('dirt_takeoffs').select('id, geofence_id, design, results')
    .eq('id', input.takeoffId).eq('company_id', g.companyId).is('deleted_at', null).maybeSingle()
  if (!t?.geofence_id) return { ok: false, error: 'That takeoff was not found.' }
  const original = t.results as DirtResults | null
  if (!original) return { ok: false, error: 'Save the takeoff first — progress is measured against its saved run.' }
  const { data: zone } = await svc.from('geofences').select('id, owner_id').eq('id', t.geofence_id).eq('company_id', g.companyId).maybeSingle()
  if (!zone || zone.owner_id) return { ok: false, error: 'That takeoff was not found.' }
  const { data: s } = await svc.from('dirt_surfaces').select('id, path, info, flown_on, name, status')
    .eq('id', input.surfaceId).eq('company_id', g.companyId).eq('geofence_id', t.geofence_id).is('deleted_at', null).maybeSingle()
  if (!s || s.status !== 'ready' || !s.info) return { ok: false, error: 'That flight isn’t ready — upload it again.' }
  const chk = checkDesign(t.design)
  if (!chk.ok) return { ok: false, error: chk.error }
  const design = chk.design

  const coords = design.features.filter((f) => f.kind === 'boundary').flatMap((f) => f.coords)
  if (coords.length < 3) return { ok: false, error: 'Trace the takeoff’s grading limits first.' }
  const cLng = coords.reduce((a, p) => a + p[0], 0) / coords.length, cLat = coords.reduce((a, p) => a + p[1], 0) / coords.length
  const frame = makeFrame(cLng, cLat)
  const lim = limitsOf(design, frame)
  if (!lim.box) return { ok: false, error: 'Trace the takeoff’s grading limits first.' }
  const b = lim.box
  const ring = [b.x0 - BAND_M, b.y0 - BAND_M, b.x1 + BAND_M, b.y0 - BAND_M, b.x1 + BAND_M, b.y1 + BAND_M, b.x0 - BAND_M, b.y1 + BAND_M]
  const lngLat = groundBoxFor([0, 2, 4, 6].map((i) => fromFrame(frame, ring[i], ring[i + 1])))
  if (!lngLat || boxTooBig(lngLat)) return { ok: false, error: 'The grading limits span more than about 3 km — split the takeoff.' }

  const signal = AbortSignal.timeout(45_000)
  let results: ProgressResults
  let heat: { width: number; height: number; rgba: Uint8ClampedArray; corners: [number, number][] } | null = null
  try {
    const { data: signed } = await svc.storage.from('dirt').createSignedUrl(String(s.path), 300)
    if (!signed?.signedUrl) return { ok: false, error: 'The flight’s file is missing — upload it again.' }
    const { openDsm, dsmSurface } = await import('@/lib/dirt/dsm')
    const info = s.info as import('@/lib/dirt/dsm').DsmInfo
    const tiff = await openDsm(signed.signedUrl, signal)
    const top = await dsmSurface(tiff, info, frame, ring, signal)
    // Level the flight on the untouched band against the lidar (plus the takeoff's datum offset).
    let fit: DatumFit | null = null
    if (!input.asFlown) {
      try {
        const { groundCached } = await import('@/lib/dirt/ground')
        const gr = await groundCached(svc as never, lngLat, signal, { companyId: g.companyId, who: g.userId })
        if (gr.header.coverage > 0 && gr.grid.zone === frame.zone) {
          const { GridSurface } = await import('@/lib/dirt/surface')
          const lg = gr.grid
          const lidar = new GridSurface({ x0: lg.x0 - frame.e0, y0: lg.y0 - frame.n0, dx: lg.dx, dy: lg.dy, nx: lg.nx, ny: lg.ny, z: lg.z })
          const offFt = design.existing.source === 'lidar' ? Number(design.existing.offsetFt) || 0 : original.datum?.planExistingMinusLidarFt ?? 0
          fit = datumFit(bandDiffs({ flight: top.surface, existing: lidar, inside: lim.inside, box: b, existingOffsetM: offFt * FT }))
        }
      } catch { /* no lidar: the flight is used as flown, and the result says so */ }
    }
    const ground = flightGround(top.surface, frame, fit?.offsetM ?? 0, `Drone survey “${s.name}” (${s.flown_on})`, top.resM)
    const run = runTakeoff(progressDesign(design), ground, new Date(), { deadline: Date.now() + RUN_MS })
    results = progressResults({ flownOn: String(s.flown_on), left: run.results, original, fit, asFlown: !!input.asFlown, resolutionM: top.resM })
    const { heatRaster } = await import('@/lib/dirt/heat')
    heat = heatRaster(run.ctx, { maxPx: 1400 })
  } catch (e) {
    if (e instanceof Error && e.name === 'TakeoffTooBig') return { ok: false, error: e.message }
    if (e instanceof Error && e.name === 'GroundBusy') return { ok: false, error: e.message }
    if (e instanceof Error && e.message === 'outside') return { ok: false, error: 'This flight doesn’t cover the grading limits.' }
    if (e instanceof Error && e.message === 'too-big') return { ok: false, error: 'The flight is too detailed to read over a site this big — export the surface at 10 cm or coarser.' }
    console.error('progress measure failed', e)
    return { ok: false, error: 'Could not measure that flight — check the connection and try again.' }
  }

  let heatPath: string | null = null
  if (heat) {
    try {
      const { encodePng } = await import('@/lib/dirt/png')
      heatPath = `${g.companyId}/${t.id}/progress-${s.id}-${Date.now()}.png`
      const { error } = await svc.storage.from('dirt').upload(heatPath, encodePng(heat.width, heat.height, heat.rgba), { contentType: 'image/png', upsert: false })
      if (error) heatPath = null
    } catch { heatPath = null }
  }
  const row = { results, flown_on: s.flown_on, heat_path: heatPath, heat_corners: heat && heatPath ? heat.corners : null, updated_at: new Date().toISOString() }
  const { data: prev } = await svc.from('dirt_progress').select('id, heat_path').eq('takeoff_id', t.id).eq('surface_id', s.id).is('deleted_at', null).maybeSingle()
  const { error } = prev
    ? await svc.from('dirt_progress').update(row).eq('id', prev.id)
    : await svc.from('dirt_progress').insert({ ...row, company_id: g.companyId, geofence_id: t.geofence_id, takeoff_id: t.id, surface_id: s.id, created_by: g.userId })
  if (error) {
    if (heatPath) await svc.storage.from('dirt').remove([heatPath])
    return { ok: false, error: error.code === '42P01' ? 'The database is still updating — try again in a few minutes.' : 'Could not save the measurement — try again.' }
  }
  if (prev?.heat_path && prev.heat_path !== heatPath) { try { await svc.storage.from('dirt').remove([String(prev.heat_path)]) } catch { /* swept later */ } }
  revalidatePath(`/plans/${t.geofence_id}/progress`)
  return { ok: true, results }
}
