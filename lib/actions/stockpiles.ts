'use server'

/**
 * Stockpile volumes (migration 136) — every write. Inside the dirt takeoff
 * add-on, behind the same gate as lib/actions/dirt.ts.
 *
 * A drone survey (DSM GeoTIFF) goes straight from the browser to the private
 * `dirt` bucket on a signed upload URL (never through an action — Vercel's
 * body cap), then `finalizeSurfaceAction` opens it by range requests and
 * checks its GeoKeys before the row turns `ready`. A measurement reads only
 * the pile's window of that survey (or USGS lidar, with a warning that lidar
 * is years old) and the SERVER's numbers are what is stored.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import { keyRateLimited } from '@/lib/rate-limit'
import { MATERIALS, PileError, measurePile, parseToe, pileResults, type PileBase, type PileResults, type ZUnits } from '@/lib/dirt/stockpile'
import { boxTooBig, groundBoxFor, type LngLatBox } from '@/lib/dirt/ground-box'
import { makeFrame, toFrame } from '@/lib/dirt/tm'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_BYTES = 50 * 1024 * 1024
const MAX_SURFACES_PER_ZONE = 60
const MAX_PILES_PER_ZONE = 500
const RUN_MS = 40_000
/** Largest toe accepted (~1 km across). */
const MAX_TOE_DEG = 0.01

type Gate = { ok: true; companyId: string; userId: string } | { ok: false; error: string }

async function gate(): Promise<Gate> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  if (isProspect(perms)) return { ok: false, error: 'This login can look, not change.' }
  if (!perms.canEdit) return { ok: false, error: 'Your role can view stockpiles but not measure them.' }
  if (!perms.features.includes('zones')) return { ok: false, error: 'Your role can’t open sites.' }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user || !companyId) return { ok: false, error: 'Sign in first.' }
  if (!(await dirtAddonActive(companyId))) return { ok: false, error: 'Stockpiles are part of the dirt takeoff add-on — ask us to turn it on for your company.' }
  return { ok: true, companyId, userId: user.id }
}

async function companyZone(companyId: string, zoneId: string) {
  if (!UUID.test(zoneId)) return null
  const { getGeofence } = await import('@/lib/db/zones')
  const zone = await getGeofence(zoneId)
  if (!zone || zone.company_id !== companyId || zone.owner_id) return null
  return zone
}

// ── Surveys ────────────────────────────────────────────────────────────────

export async function startSurfaceUploadAction(zoneId: string, input: { name: string; flownOn: string; size: number; zUnits?: string }): Promise<{ ok: boolean; id?: string; path?: string; token?: string; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  const zone = await companyZone(g.companyId, zoneId)
  if (!zone) return { ok: false, error: 'That site was not found.' }
  if (keyRateLimited(g.userId, 'dirt-dsm', 10)) return { ok: false, error: 'That’s a lot of uploads in a minute — wait a moment.' }
  const size = Number(input?.size)
  if (!size || size > MAX_BYTES) return { ok: false, error: 'Survey file too large (50 MB max) — export the DSM at a coarser resolution or cropped to the stockpile area.' }
  const flownOn = DATE.test(String(input?.flownOn)) ? String(input.flownOn) : new Date().toISOString().slice(0, 10)
  const zUnits: ZUnits = ['m', 'ft', 'usft'].includes(String(input?.zUnits)) ? input.zUnits as ZUnits : 'auto'
  const name = (String(input?.name ?? '').trim() || `Drone survey ${flownOn}`).slice(0, 120)
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { count } = await svc.from('dirt_surfaces').select('id', { count: 'exact', head: true })
    .eq('company_id', g.companyId).eq('geofence_id', zone.id).is('deleted_at', null)
  if ((count ?? 0) >= MAX_SURFACES_PER_ZONE) return { ok: false, error: `This site has ${MAX_SURFACES_PER_ZONE} surveys — ask us to clear old ones.` }
  const id = crypto.randomUUID()
  const path = `${g.companyId}/${zone.id}/dsm-${id}.tif`
  const { data: up, error: upErr } = await svc.storage.from('dirt').createSignedUploadUrl(path)
  if (upErr || !up) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  const { error } = await svc.from('dirt_surfaces').insert({
    id, company_id: g.companyId, geofence_id: zone.id, name, flown_on: flownOn, path, z_units: zUnits, bytes: size, created_by: g.userId,
  })
  if (error) {
    console.error('dsm row failed', error.message)
    return { ok: false, error: error.code === '42P01' ? 'The database is still updating — try again in a few minutes.' : 'Couldn’t start the upload — try again.' }
  }
  return { ok: true, id, path: up.path, token: up.token }
}

export interface SurfaceRow { id: string; name: string; flownOn: string; words: string; resM: number | null }

/** After the browser's upload: open the file, check its GeoKeys, mark it ready (or remove it with the reason). */
export async function finalizeSurfaceAction(id: string): Promise<{ ok: boolean; surface?: SurfaceRow; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That survey was not found.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: row } = await svc.from('dirt_surfaces').select('id, name, flown_on, path, z_units, geofence_id, status')
    .eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).maybeSingle()
  if (!row) return { ok: false, error: 'That survey was not found.' }
  const drop = async (error: string) => {
    try { await svc.storage.from('dirt').remove([row.path as string]) } catch { /* best-effort */ }
    await svc.from('dirt_surfaces').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    return { ok: false, error }
  }
  const { data: signed } = await svc.storage.from('dirt').createSignedUrl(row.path as string, 300)
  if (!signed?.signedUrl) return drop('The upload didn’t arrive — try again.')
  try {
    const { openDsm, describeDsm } = await import('@/lib/dirt/dsm')
    const tiff = await openDsm(signed.signedUrl, AbortSignal.timeout(20_000))
    const d = await describeDsm(tiff, row.z_units as ZUnits)
    if (!d.ok) return drop(d.error)
    const { error } = await svc.from('dirt_surfaces').update({ status: 'ready', info: d.info }).eq('id', id).eq('company_id', g.companyId)
    if (error) return { ok: false, error: 'Could not save the survey — try again.' }
    if (row.geofence_id) revalidatePath(`/dirt/stockpiles/${row.geofence_id}`)
    return { ok: true, surface: { id, name: row.name as string, flownOn: row.flown_on as string, words: d.info.words, resM: d.info.resM } }
  } catch (e) {
    console.error('dsm finalize failed', e)
    return drop('That file isn’t a GeoTIFF we can read — upload the DSM / elevation export as .tif.')
  }
}

// ── Measuring ──────────────────────────────────────────────────────────────

export interface MeasureInput {
  zoneId: string
  name: string
  toe: unknown
  surfaceId: string | null
  base: PileBase
  material: string
  densityTCy: number
}

export interface PileRow {
  id: string
  name: string
  material: string
  measuredOn: string
  source: 'dsm' | 'lidar'
  toe: [number, number][]
  results: PileResults
}

export async function measureStockpileAction(input: MeasureInput): Promise<{ ok: boolean; pile?: PileRow; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  const zone = await companyZone(g.companyId, String(input?.zoneId))
  if (!zone) return { ok: false, error: 'That site was not found.' }
  if (keyRateLimited(g.userId, 'dirt-pile', 8)) return { ok: false, error: 'That’s a lot of measurements in a minute — wait a moment.' }
  const toe = parseToe(input?.toe)
  if (!toe) return { ok: false, error: 'Draw the toe with 3 to 500 corners.' }
  const box = groundBoxFor(toe) as LngLatBox
  if (box.maxLng - box.minLng > MAX_TOE_DEG + 0.001 || box.maxLat - box.minLat > MAX_TOE_DEG + 0.001) return { ok: false, error: 'That toe is bigger than about 1 km — draw one pile at a time.' }
  const base: PileBase = input?.base === 'lowest' ? 'lowest' : 'tin'
  const material = MATERIALS.some(m => m.id === input?.material) ? String(input.material) : 'other'
  const density = Number(input?.densityTCy)
  if (!(density > 0.2 && density < 4)) return { ok: false, error: 'Density should be between 0.2 and 4 tons per cubic yard.' }
  const name = (String(input?.name ?? '').trim() || 'Stockpile').slice(0, 120)

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { count } = await svc.from('dirt_stockpiles').select('id', { count: 'exact', head: true })
    .eq('company_id', g.companyId).eq('geofence_id', zone.id).is('deleted_at', null)
  if ((count ?? 0) >= MAX_PILES_PER_ZONE) return { ok: false, error: `This site has ${MAX_PILES_PER_ZONE} measurements — delete old ones first.` }

  const cLng = toe.reduce((s, p) => s + p[0], 0) / toe.length
  const cLat = toe.reduce((s, p) => s + p[1], 0) / toe.length
  const signal = AbortSignal.timeout(30_000)
  const deadline = Date.now() + RUN_MS
  let results: PileResults
  let measuredOn = new Date().toISOString().slice(0, 10)
  let source: 'dsm' | 'lidar'
  let surfaceId: string | null = null
  try {
    if (input?.surfaceId) {
      if (!UUID.test(input.surfaceId)) return { ok: false, error: 'That survey was not found.' }
      const { data: s } = await svc.from('dirt_surfaces').select('id, path, info, flown_on, name, status')
        .eq('id', input.surfaceId).eq('company_id', g.companyId).eq('geofence_id', zone.id).is('deleted_at', null).maybeSingle()
      if (!s || s.status !== 'ready' || !s.info) return { ok: false, error: 'That survey isn’t ready — upload it again.' }
      const { data: signed } = await svc.storage.from('dirt').createSignedUrl(s.path as string, 300)
      if (!signed?.signedUrl) return { ok: false, error: 'The survey file is missing — upload it again.' }
      const { openDsm, dsmSurface } = await import('@/lib/dirt/dsm')
      const info = s.info as import('@/lib/dirt/dsm').DsmInfo
      const b = info.bounds
      if (b && !toe.every(([lng, lat]) => lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat)) {
        return { ok: false, error: `The toe runs outside “${s.name}” — draw it inside the surveyed area.` }
      }
      const frame = makeFrame(cLng, cLat)
      const ring = toe.flatMap(([lng, lat]) => toFrame(frame, lng, lat))
      const tiff = await openDsm(signed.signedUrl, signal)
      const top = await dsmSurface(tiff, info, frame, ring, signal)
      const m = measurePile(ring, top.surface, base, frame.k, { sampleM: Math.max(top.resM, 0.1), deadline })
      results = pileResults(m, { base, densityTCy: density, source: { kind: 'dsm', detail: `Drone survey “${s.name}” · ${info.words}`, resolutionM: top.resM } })
      measuredOn = s.flown_on as string
      source = 'dsm'
      surfaceId = s.id as string
    } else {
      if (boxTooBig(box)) return { ok: false, error: 'That toe is too big for a lidar read.' }
      const { groundCached } = await import('@/lib/dirt/ground')
      const gr = await groundCached(svc as never, box, signal, { companyId: g.companyId, who: g.userId })
      if (!(gr.header.coverage > 0)) return { ok: false, error: 'USGS lidar didn’t answer here — upload a drone survey instead.' }
      const ground = gr.grid
      const { GridSurface } = await import('@/lib/dirt/surface')
      const frame = makeFrame(cLng, cLat, ground.zone)
      const ring = toe.flatMap(([lng, lat]) => toFrame(frame, lng, lat))
      const top = new GridSurface({ x0: ground.x0 - frame.e0, y0: ground.y0 - frame.n0, dx: ground.dx, dy: ground.dy, nx: ground.nx, ny: ground.ny, z: ground.z })
      const m = measurePile(ring, top, base, frame.k, { sampleM: Math.max(ground.dx, 0.5), deadline })
      m.warnings.unshift(`USGS lidar is years old (${gr.header.source}) — this is the ground as it was flown then, NOT today’s pile. Upload a current drone survey for a real stockpile number.`)
      results = pileResults(m, { base, densityTCy: density, source: { kind: 'lidar', detail: gr.header.source, resolutionM: ground.resolutionM } })
      source = 'lidar'
    }
  } catch (e) {
    if (e instanceof PileError) return { ok: false, error: e.message }
    if (e instanceof Error && e.name === 'GroundBusy') return { ok: false, error: e.message }
    if (e instanceof Error && e.message === 'too-big') return { ok: false, error: 'The survey is too detailed to read under a toe this big — draw a smaller toe or upload a coarser DSM.' }
    if (e instanceof Error && e.message === 'outside') return { ok: false, error: 'The toe is outside the survey — draw it inside the surveyed area.' }
    console.error('stockpile measure failed', e)
    return { ok: false, error: 'Could not measure that pile — check the connection and try again.' }
  }

  const { data, error } = await svc.from('dirt_stockpiles').insert({
    company_id: g.companyId, geofence_id: zone.id, surface_id: surfaceId, name, material, density_t_cy: density,
    base, source, toe, measured_on: measuredOn, results, created_by: g.userId,
  }).select('id').single()
  if (error || !data) {
    console.error('stockpile save failed', error?.message)
    return { ok: false, error: error?.code === '42P01' ? 'The database is still updating — try again in a few minutes.' : 'Could not save the measurement. Try again in a minute.' }
  }
  revalidatePath(`/zones/${zone.id}`)
  return { ok: true, pile: { id: data.id as string, name, material, measuredOn, source, toe, results } }
}

export async function deleteStockpileAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await gate()
  if (!g.ok) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'That measurement was not found.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data, error } = await createServiceClient().from('dirt_stockpiles')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('company_id', g.companyId).is('deleted_at', null).select('geofence_id')
  if (error) return { ok: false, error: 'Could not delete. Try again in a minute.' }
  if (data?.[0]?.geofence_id) revalidatePath(`/zones/${data[0].geofence_id}`)
  return { ok: true }
}
