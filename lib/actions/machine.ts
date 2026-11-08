'use server'

/**
 * Machine files (migration 149). Members hold SELECT only, so every write
 * runs on the service client AFTER the edit check, the plans view level and
 * an explicit company check on the site — the 138 pattern. Files go straight
 * from the device to the private 'machine' bucket at <company>/<id> through a
 * one-time signed upload and come back only as short signed links.
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow, getMyPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import { cleanBuiltFrom, kindOf, MACHINE_KINDS, type BuiltFrom, type MachineKind } from '@/lib/machine/status'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f-]{36}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_BYTES = 100 * 1024 * 1024
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const clip = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('plans')) throw new Error('Plans aren’t open for your login.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('Deleting machine files is for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { companyId, userId: user?.id ?? null, svc: createServiceClient() }
}
type Svc = Awaited<ReturnType<typeof writer>>['svc']

/** A site zone of the caller's company (never a personal zone, a boundary or a vendor). */
async function ownSite(svc: Svc, companyId: string, zoneId: string): Promise<boolean> {
  if (!UUID.test(zoneId)) return false
  const { data } = await svc.from('geofences').select('id, kind, owner_id').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  return !!data && data.kind !== 'boundary' && data.kind !== 'vendor' && !data.owner_id
}

/** Upload, step 1: a signed upload into the private machine bucket. */
export async function startMachineUploadAction(input: { zoneId: string; filename: string; size: number }): Promise<Res<{ id: string; path: string; token: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (userId && keyRateLimited(userId, 'machine-upload', 30)) return { ok: false, error: 'That’s a lot of uploads in a minute — wait a moment.' }
  if (userId && keyRateLimited(userId, 'machine-upload-h', 60, 3_600_000)) return { ok: false, error: 'That’s a lot of uploads for one hour — try again later.' }
  if (!(await ownSite(svc, companyId, String(input?.zoneId ?? '')))) return { ok: false, error: 'That site wasn’t found.' }
  if (!clip(input.filename, 200)) return { ok: false, error: 'That file has no name.' }
  if (!input.size || input.size > MAX_BYTES) return { ok: false, error: 'Machine files go up to 100 MB.' }
  // Count uploads STARTED, not files filed: an upload that never finishes still
  // holds up to 100 MB until the sweep (sec-check, Nov 8). Objects carry their own time.
  const since = Date.now() - 86_400_000
  const { data: recent } = await svc.storage.from('machine').list(companyId, { limit: 201, sortBy: { column: 'created_at', order: 'desc' } })
  const started = (recent ?? []).filter((o) => Date.parse(String(o.created_at ?? '')) >= since).length
  if (started >= 200) return { ok: false, error: 'That’s a lot of machine files for one day — try again tomorrow.' }
  const id = crypto.randomUUID()
  const { data, error } = await svc.storage.from('machine').createSignedUploadUrl(`${companyId}/${id}`)
  if (error || !data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, id, path: data.path, token: data.token }
}

/** The plan versions a takeoff was traced from: the sheet pictures it shows, by their versions. */
async function takeoffBuiltFrom(svc: Svc, companyId: string, zoneId: string, takeoffId: string): Promise<BuiltFrom[] | null> {
  const { data: t } = await svc.from('dirt_takeoffs').select('id, design').eq('id', takeoffId).eq('company_id', companyId).eq('geofence_id', zoneId).is('deleted_at', null).maybeSingle()
  if (!t) return null
  // The sheets it was traced from: the ones the plan reader imported (each
  // feature's `src` is the sheet picture), plus any the design lists. Nothing
  // wrote `design.sheets` until now, so every export read "Plans not recorded"
  // (ship-check, Nov 8). A hand-traced takeoff still records none — honestly.
  const design = (t.design ?? {}) as { sheets?: unknown; features?: { src?: unknown }[] }
  const raw = [...(Array.isArray(design.sheets) ? design.sheets : []), ...(Array.isArray(design.features) ? design.features.map((f) => f?.src) : [])]
  const ids = Array.from(new Set(raw.filter((s): s is string => typeof s === 'string' && UUID.test(s)))).slice(0, 200)
  if (!ids.length) return []
  const { data: vs } = await svc.from('plan_versions').select('id, sheet_id, issued_on').in('image_id', ids).eq('company_id', companyId).is('deleted_at', null)
    .order('issued_on', { ascending: false }).limit(400)
  return onSite(svc, companyId, zoneId, cleanBuiltFrom((vs ?? []).map((v) => ({ sheetId: String(v.sheet_id), versionId: String(v.id) }))))
}

/** Keep only entries whose sheet is one of this site's (plan_versions carry no site of their own). */
async function onSite(svc: Svc, companyId: string, zoneId: string, list: BuiltFrom[]): Promise<BuiltFrom[]> {
  if (!list.length) return []
  const { data: sh } = await svc.from('plan_sheets').select('id').in('id', list.map((b) => b.sheetId)).eq('company_id', companyId).eq('geofence_id', zoneId).is('deleted_at', null)
  const mine = new Set((sh ?? []).map((x) => String(x.id)))
  return list.filter((b) => mine.has(b.sheetId))
}

/** Only versions that really are of this site's sheets. */
async function siteBuiltFrom(svc: Svc, companyId: string, zoneId: string, raw: unknown): Promise<BuiltFrom[]> {
  const want = cleanBuiltFrom(raw)
  if (!want.length) return []
  const { data: vs } = await svc.from('plan_versions').select('id, sheet_id').in('id', want.map((b) => b.versionId)).eq('company_id', companyId).is('deleted_at', null)
  const real = new Set((vs ?? []).map((v) => `${v.sheet_id}|${v.id}`))
  return onSite(svc, companyId, zoneId, want.filter((b) => real.has(`${b.sheetId}|${b.versionId}`)))
}

export interface FinishMachineInput {
  zoneId: string
  id: string
  name: string
  filename: string
  kind?: string
  builtBy?: string | null
  builtOn?: string | null
  builtFrom?: unknown
  note?: string | null
  /** A design the dirt takeoff wrote — its plan versions are read from the takeoff itself. */
  takeoffId?: string | null
  grid?: string | null
}

/** Upload, step 2: the file landed — check it and file it. */
export async function finishMachineFileAction(input: FinishMachineInput): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const zoneId = String(input?.zoneId ?? '')
  if (!(await ownSite(svc, companyId, zoneId))) return { ok: false, error: 'That site wasn’t found.' }
  if (!UUID.test(String(input.id))) return { ok: false, error: 'Bad file' }
  // An id that is already filed is refused before anything is touched — the
  // clean-up below would otherwise delete a filed file's only copy (sec-check, Nov 8).
  const { data: filed } = await svc.from('machine_files').select('id').eq('id', input.id).maybeSingle()
  if (filed) return { ok: false, error: 'That file is already filed.' }
  const path = `${companyId}/${input.id}`
  const { data: objs } = await svc.storage.from('machine').list(companyId, { search: input.id })
  const obj = objs?.find((o) => o.name === input.id)
  const size = Number((obj?.metadata as { size?: number } | undefined)?.size ?? 0)
  if (!obj || !size) return { ok: false, error: 'The file didn’t finish uploading — try again.' }
  if (size > MAX_BYTES) { await svc.storage.from('machine').remove([path]); return { ok: false, error: 'Machine files go up to 100 MB.' } }
  const filename = clip(input.filename, 200) || 'machine file'
  const name = clip(input.name, 120) || filename.replace(/\.[a-z0-9]+$/i, '')
  const kind: MachineKind = (MACHINE_KINDS as readonly string[]).includes(String(input.kind)) ? (input.kind as MachineKind) : kindOf(filename)
  let builtFrom: BuiltFrom[] = []
  let takeoffId: string | null = null
  if (input.takeoffId) {
    if (!UUID.test(input.takeoffId)) return { ok: false, error: 'That takeoff wasn’t found.' }
    const bf = await takeoffBuiltFrom(svc, companyId, zoneId, input.takeoffId)
    if (!bf) { await svc.storage.from('machine').remove([path]); return { ok: false, error: 'That takeoff wasn’t found.' } }
    builtFrom = bf
    takeoffId = input.takeoffId
  } else builtFrom = await siteBuiltFrom(svc, companyId, zoneId, input.builtFrom)
  const builtOn = input.builtOn && DAY.test(input.builtOn) && !Number.isNaN(Date.parse(`${input.builtOn}T00:00:00Z`)) ? input.builtOn : null
  const { error } = await svc.from('machine_files').insert({
    id: input.id, company_id: companyId, geofence_id: zoneId, name, kind, filename, size_bytes: size, path,
    built_by: clip(input.builtBy, 80) || null, built_on: builtOn, built_from: builtFrom,
    source: takeoffId ? 'hammertrack' : 'upload', takeoff_id: takeoffId, grid: clip(input.grid, 60) || null,
    note: clip(input.note, 500) || null, created_by: userId,
  })
  if (error) {
    // 23505 = another finish filed this id first: its object is now a filed file's — keep it.
    if (error.code !== '23505') await svc.storage.from('machine').remove([path])
    return { ok: false, error: error.code === '23505' ? 'That file is already filed.' : 'Couldn’t file it — try again.' }
  }
  revalidatePath(`/plans/${zoneId}/machine`)
  return { ok: true, id: input.id }
}

/** A short signed link to download a machine file (the row read runs under RLS; never for a prospect). */
export async function machineFileLinkAction(id: string): Promise<Res<{ url: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!UUID.test(id)) return { ok: false, error: 'Bad file' }
  const perms = await getMyPermissions()
  if (!perms.features.includes('plans') || isProspect(perms)) return { ok: false, error: 'Machine files aren’t open for your login.' }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: f } = await createClient().from('machine_files').select('id, filename, path').eq('id', id).maybeSingle()
  if (!f?.path) return { ok: false, error: 'That file is gone.' }
  const { data: s } = await createServiceClient().storage.from('machine').createSignedUrl(String(f.path), 600, { download: String(f.filename) })
  if (!s?.signedUrl) return { ok: false, error: 'Couldn’t open the file — try again.' }
  return { ok: true, url: s.signedUrl }
}

/** Remove a machine file (Managers and above) — the row and the file. */
export async function deleteMachineFileAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(id)) return { ok: false, error: 'Bad file' }
  const { data } = await svc.from('machine_files').update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId).is('deleted_at', null).select('geofence_id, path')
  if (!data?.length) return { ok: false, error: 'That file is gone.' }
  try { await svc.storage.from('machine').remove([String(data[0].path)]) } catch { /* the health sweep catches it */ }
  revalidatePath(`/plans/${data[0].geofence_id}/machine`)
  return { ok: true }
}
