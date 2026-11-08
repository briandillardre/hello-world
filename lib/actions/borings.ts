'use server'

/**
 * Borings and test pits (migration 148). Members hold SELECT only, so every
 * write runs on the service client AFTER the edit check, the plans view level
 * and an explicit company check on the site — the 138 pattern. A boring must
 * sit within 2 km of its site (a typed coordinate gone wrong never lands on
 * another job's numbers). Pit photos go straight from the phone to the
 * private 'plans' bucket at <company>/pits/<id> through a signed upload.
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import { boringProblem, parseBorings, type BoringFields } from '@/lib/borings/paste'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f-]{36}$/i
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const PHOTO_MAX_BYTES = 15 * 1024 * 1024
const MAX_PER_SITE = 500
const NEAR_M = 2000

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('plans')) throw new Error('Plans aren’t open for your login.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('Deleting borings is for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { companyId, userId: user?.id ?? null, svc: createServiceClient() }
}
type Svc = Awaited<ReturnType<typeof writer>>['svc']

/** The caller's company's site zone (never a personal zone, a boundary or a vendor) and its outline. */
async function siteOf(svc: Svc, companyId: string, zoneId: string): Promise<{ ring: [number, number][] } | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('geofences_json').select('id, kind, owner_id, geometry').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  const z = data as { kind?: string; owner_id?: string | null; geometry?: { coordinates?: number[][][] } } | null
  if (!z || z.kind === 'boundary' || z.kind === 'vendor' || z.owner_id) return null
  const ring = (z.geometry?.coordinates?.[0] ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) as [number, number][]
  return { ring }
}

/** Metres from a point to the outline's bounding box (0 inside it). */
function metresFrom(ring: [number, number][], lng: number, lat: number): number {
  if (!ring.length) return 0
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180)
  const dx = Math.max(x0 - lng, 0, lng - x1) * 111_320 * k
  const dy = Math.max(y0 - lat, 0, lat - y1) * 110_574
  return Math.hypot(dx, dy)
}

function tooFar(ring: [number, number][], b: BoringFields): string | null {
  const m = metresFrom(ring, b.lng, b.lat)
  if (m <= NEAR_M) return null
  const mi = m / 1609.344
  return `${b.name} is ${mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString('en-US')} mi from the site — check its place.`
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : NaN)

/** The fields from a form, cleaned — NaN where a box held something that isn't a number. */
function fieldsFrom(input: Record<string, unknown>): BoringFields {
  return {
    name: String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 41),
    kind: input.kind === 'pit' ? 'pit' : 'boring',
    lat: Number(input.lat), lng: Number(input.lng),
    groundFt: numOrNull(input.groundFt), depthFt: Number(input.depthFt),
    topsoilIn: numOrNull(input.topsoilIn), fillFt: numOrNull(input.fillFt), pwrFt: numOrNull(input.pwrFt),
    refusalFt: numOrNull(input.refusalFt), waterFt: numOrNull(input.waterFt), water24hFt: numOrNull(input.water24hFt),
    unsuitableFt: numOrNull(input.unsuitableFt),
    note: String(input.note ?? '').trim().slice(0, 500) || null,
  }
}

function rowOf(b: BoringFields) {
  return {
    name: b.name, kind: b.kind, lat: b.lat, lng: b.lng, ground_ft: b.groundFt, depth_ft: b.depthFt,
    topsoil_in: b.topsoilIn, fill_ft: b.fillFt, pwr_ft: b.pwrFt, refusal_ft: b.refusalFt,
    water_ft: b.waterFt, water_24h_ft: b.water24hFt, unsuitable_ft: b.unsuitableFt, note: b.note,
  }
}

function refresh(zoneId: string) {
  revalidatePath(`/plans/${zoneId}/ground`)
  revalidatePath(`/plans/${zoneId}`)
}

export interface SaveBoringInput {
  zoneId: string
  id?: string | null
  name: string
  kind: 'boring' | 'pit'
  lat: number
  lng: number
  groundFt?: number | null
  depthFt: number
  topsoilIn?: number | null
  fillFt?: number | null
  pwrFt?: number | null
  refusalFt?: number | null
  waterFt?: number | null
  water24hFt?: number | null
  unsuitableFt?: number | null
  note?: string | null
  source?: 'log' | 'sheet' | 'pit' | 'map'
  sourceRef?: string | null
}

/** Add or change one boring / pit. */
export async function saveBoringAction(input: SaveBoringInput): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (userId && keyRateLimited(userId, 'boring-save', 60)) return { ok: false, error: 'That’s a lot of saves in a minute — wait a moment.' }
  const site = await siteOf(svc, companyId, String(input?.zoneId ?? ''))
  if (!site) return { ok: false, error: 'That site wasn’t found.' }
  const b = fieldsFrom(input as unknown as Record<string, unknown>)
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && Number.isNaN(v) && k !== 'depthFt') return { ok: false, error: 'One of the numbers isn’t a number — check the boxes.' }
  const why = boringProblem(b) ?? tooFar(site.ring, b)
  if (why) return { ok: false, error: why }
  const source = ['log', 'sheet', 'pit', 'map'].includes(String(input.source)) ? input.source! : b.kind === 'pit' ? 'pit' : 'log'
  const sourceRef = String(input.sourceRef ?? '').trim().slice(0, 120) || null
  const now = new Date().toISOString()
  if (input.id) {
    if (!UUID.test(input.id)) return { ok: false, error: 'That boring wasn’t found.' }
    const { data, error } = await svc.from('borings').update({ ...rowOf(b), source, source_ref: sourceRef, updated_at: now })
      .eq('id', input.id).eq('company_id', companyId).eq('geofence_id', input.zoneId).is('deleted_at', null).select('id')
    if (error) return { ok: false, error: error.code === '23505' ? `There’s already a ${b.name} on this site.` : 'Couldn’t save — try again.' }
    if (!data?.length) return { ok: false, error: 'That boring wasn’t found.' }
    refresh(input.zoneId)
    return { ok: true, id: input.id }
  }
  const { count } = await svc.from('borings').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('geofence_id', input.zoneId).is('deleted_at', null)
  if ((count ?? 0) >= MAX_PER_SITE) return { ok: false, error: `A site holds up to ${MAX_PER_SITE} borings.` }
  const { data, error } = await svc.from('borings').insert({ ...rowOf(b), source, source_ref: sourceRef, company_id: companyId, geofence_id: input.zoneId, created_by: userId })
    .select('id').single()
  if (error || !data) return { ok: false, error: error?.code === '23505' ? `There’s already a ${b.name} on this site.` : 'Couldn’t save — try again.' }
  refresh(input.zoneId)
  return { ok: true, id: String(data.id) }
}

/** A pasted table of borings: a name already on the site is updated, a new one added. */
export async function importBoringsAction(zoneId: string, text: string, sourceRef?: string): Promise<Res<{ added: number; updated: number; skipped: { line: number; why: string }[]; columns: string[] }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (userId && keyRateLimited(userId, 'boring-import', 10)) return { ok: false, error: 'That’s a lot of pastes in a minute — wait a moment.' }
  const site = await siteOf(svc, companyId, zoneId)
  if (!site) return { ok: false, error: 'That site wasn’t found.' }
  const parsed = parseBorings(String(text ?? ''))
  if (parsed.error) return { ok: false, error: parsed.error }
  const skipped = [...parsed.skipped]
  const good = parsed.rows.filter(({ line, boring }) => {
    const why = tooFar(site.ring, boring)
    if (why) skipped.push({ line, why })
    return !why
  })
  // The last row of a name wins; names already on the site update in place.
  const byKey = new Map<string, { line: number; boring: BoringFields }>()
  for (const r of good) byKey.set(r.boring.name.toLowerCase(), r)
  const { data: live } = await svc.from('borings').select('id, name').eq('company_id', companyId).eq('geofence_id', zoneId).is('deleted_at', null).limit(MAX_PER_SITE + 1)
  const existing = new Map((live ?? []).map((r) => [String(r.name).toLowerCase(), String(r.id)]))
  const fresh = Array.from(byKey.values()).filter((r) => !existing.has(r.boring.name.toLowerCase()))
  if (existing.size + fresh.length > MAX_PER_SITE) return { ok: false, error: `A site holds up to ${MAX_PER_SITE} borings.` }
  const ref = String(sourceRef ?? '').trim().slice(0, 120) || null
  const now = new Date().toISOString()
  let added = 0, updated = 0
  for (const r of Array.from(byKey.values())) {
    const id = existing.get(r.boring.name.toLowerCase())
    const source = r.boring.kind === 'pit' ? 'pit' : 'log'
    if (id) {
      const { error } = await svc.from('borings').update({ ...rowOf(r.boring), source, source_ref: ref, updated_at: now }).eq('id', id).eq('company_id', companyId)
      if (error) skipped.push({ line: r.line, why: `${r.boring.name}: couldn’t save.` })
      else updated++
    }
  }
  if (fresh.length) {
    const { error } = await svc.from('borings').insert(fresh.map((r) => ({
      ...rowOf(r.boring), source: r.boring.kind === 'pit' ? 'pit' : 'log', source_ref: ref, company_id: companyId, geofence_id: zoneId, created_by: userId,
    })))
    if (error) return { ok: false, error: 'Couldn’t save the new borings — try again.' }
    added = fresh.length
  }
  refresh(zoneId)
  return { ok: true, added, updated, skipped: skipped.sort((a, b) => a.line - b.line), columns: parsed.columns }
}

/** Remove a boring (Managers and above) — and its photo. */
export async function deleteBoringAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(id)) return { ok: false, error: 'That boring wasn’t found.' }
  const { data } = await svc.from('borings').update({ deleted_at: new Date().toISOString(), photo_path: null })
    .eq('id', id).eq('company_id', companyId).is('deleted_at', null).select('geofence_id, id')
  if (!data?.length) return { ok: false, error: 'That boring wasn’t found.' }
  try { await svc.storage.from('plans').remove([`${companyId}/pits/${id}`]) } catch { /* best-effort */ }
  refresh(String(data[0].geofence_id))
  return { ok: true }
}

/** A pit photo, step 1: a signed upload into the private plans bucket. */
export async function startPitPhotoAction(input: { id: string; contentType: string; size: number }): Promise<Res<{ path: string; token: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(input?.id ?? '')) return { ok: false, error: 'That boring wasn’t found.' }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.contentType)) return { ok: false, error: 'A photo is a JPEG or PNG.' }
  if (!input.size || input.size > PHOTO_MAX_BYTES) return { ok: false, error: 'That photo is over 15 MB.' }
  const { data: row } = await svc.from('borings').select('id').eq('id', input.id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!row) return { ok: false, error: 'That boring wasn’t found.' }
  const { data, error } = await svc.storage.from('plans').createSignedUploadUrl(`${companyId}/pits/${input.id}`, { upsert: true })
  if (error || !data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, path: data.path, token: data.token }
}

/** Step 2: the photo landed — check it and file it on the boring. */
export async function finishPitPhotoAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(id)) return { ok: false, error: 'That boring wasn’t found.' }
  const path = `${companyId}/pits/${id}`
  const { data: objs } = await svc.storage.from('plans').list(`${companyId}/pits`, { search: id })
  const obj = objs?.find((o) => o.name === id)
  if (!obj) return { ok: false, error: 'The photo didn’t finish uploading — try again.' }
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string }
  if ((meta.size ?? 0) > PHOTO_MAX_BYTES || (meta.mimetype && !/^image\/(png|jpeg|webp)$/.test(meta.mimetype))) {
    await svc.storage.from('plans').remove([path])
    return { ok: false, error: 'That file isn’t a photo under 15 MB.' }
  }
  const { data } = await svc.from('borings').update({ photo_path: path, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId).is('deleted_at', null).select('geofence_id')
  if (!data?.length) {
    await svc.storage.from('plans').remove([path])
    return { ok: false, error: 'That boring wasn’t found.' }
  }
  refresh(String(data[0].geofence_id))
  return { ok: true }
}
