'use server'

/**
 * The job's documents (migration 156) — the machine-files pattern (149):
 * members hold SELECT only, every write runs on the service client after the
 * edit + Jobs checks and an explicit company + job check; files go straight
 * from the device to the private 'jobdocs' bucket at <company>/<id> through a
 * one-time signed upload and come back only as 10-minute signed downloads.
 * A money paper (contract, change order, lien waiver, invoice, W-9, bond)
 * needs costs to file, edit or open — the database's costs_only CHECK and
 * read policy hold the same line. Deleting is a Manager's.
 */
import { revalidatePath } from 'next/cache'
import { requireEditOrThrow, getMyPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import { cleanDocMeta, costsOnly, MAX_DOC_BYTES } from '@/lib/jobs/documents'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUCKET = 'jobdocs'

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>
const clip = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('jobs')) throw new Error('Jobs aren’t open for your login.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('Removing documents is for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}

const refresh = (zoneId: string) => { revalidatePath(`/jobs/${zoneId}/documents`); revalidatePath(`/jobs/${zoneId}`) }

async function jobId(svc: Svc, companyId: string, zoneId: string): Promise<string | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('jobs').select('id').eq('geofence_id', zoneId).eq('company_id', companyId).maybeSingle()
  return data ? String(data.id) : null
}

/** A pay application of this job (sent ones only) — a lien waiver or an invoice may point at it. */
async function ownApp(svc: Svc, companyId: string, job: string, id: string | null): Promise<boolean> {
  if (!id) return true
  const { data } = await svc.from('job_pay_apps').select('id').eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  return !!data
}

/** Upload, step 1: a signed upload into the private bucket. */
export async function startDocUploadAction(input: { zoneId: string; filename: string; size: number }): Promise<Res<{ id: string; path: string; token: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (userId && keyRateLimited(userId, 'jobdoc-upload', 30)) return { ok: false, error: 'That’s a lot of uploads in a minute — wait a moment.' }
  if (userId && keyRateLimited(userId, 'jobdoc-upload-h', 120, 3_600_000)) return { ok: false, error: 'That’s a lot of uploads for one hour — try again later.' }
  if (!(await jobId(svc, companyId, String(input?.zoneId ?? '')))) return { ok: false, error: 'That job wasn’t found.' }
  if (!clip(input.filename, 200)) return { ok: false, error: 'That file has no name.' }
  if (!input.size || input.size > MAX_DOC_BYTES) return { ok: false, error: 'Documents go up to 50 MB.' }
  // Count uploads STARTED (an unfinished one holds its space until the health sweep), not files filed.
  const since = Date.now() - 86_400_000
  const { data: recent } = await svc.storage.from(BUCKET).list(companyId, { limit: 301, sortBy: { column: 'created_at', order: 'desc' } })
  if ((recent ?? []).filter((o) => Date.parse(String(o.created_at ?? '')) >= since).length >= 300) return { ok: false, error: 'That’s a lot of documents for one day — try again tomorrow.' }
  const id = crypto.randomUUID()
  const { data, error } = await svc.storage.from(BUCKET).createSignedUploadUrl(`${companyId}/${id}`)
  if (error || !data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, id, path: data.path, token: data.token }
}

/** Upload, step 2: the file landed — check it and file it. */
export async function finishDocAction(input: { zoneId: string; id: string; filename: string; meta: unknown }): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, userId, svc } = await writer()
  const zoneId = String(input?.zoneId ?? '')
  const job = await jobId(svc, companyId, zoneId)
  if (!job) return { ok: false, error: 'That job wasn’t found.' }
  if (!UUID.test(String(input.id))) return { ok: false, error: 'Bad file' }
  const path = `${companyId}/${input.id}`
  // An id already filed is refused before anything is touched (its object is a filed document's only copy).
  const { data: filed } = await svc.from('job_documents').select('id').eq('path', path).maybeSingle()
  if (filed) return { ok: false, error: 'That document is already filed.' }
  const filename = clip(input.filename, 200) || 'document'
  const { meta, error } = cleanDocMeta(input.meta, { money: perms.canViewCosts, filename })
  if (!meta) { await svc.storage.from(BUCKET).remove([path]); return { ok: false, error: error ?? 'Nothing to file.' } }
  if (!(await ownApp(svc, companyId, job, meta.payAppId))) { await svc.storage.from(BUCKET).remove([path]); return { ok: false, error: 'That application wasn’t found.' } }
  const { data: objs } = await svc.storage.from(BUCKET).list(companyId, { search: input.id })
  const obj = objs?.find((o) => o.name === input.id)
  const size = Number((obj?.metadata as { size?: number } | undefined)?.size ?? 0)
  if (!obj || !size) return { ok: false, error: 'The file didn’t finish uploading — try again.' }
  if (size > MAX_DOC_BYTES) { await svc.storage.from(BUCKET).remove([path]); return { ok: false, error: 'Documents go up to 50 MB.' } }
  const { error: e } = await svc.from('job_documents').insert({
    id: input.id, company_id: companyId, job_id: job, kind: meta.kind, costs_only: costsOnly(meta.kind), title: meta.title,
    doc_date: meta.docDate, expires_on: meta.expiresOn, note: meta.note, filename, path, size_bytes: size, pay_app_id: meta.payAppId, created_by: userId,
  })
  if (e) {
    // 23505 = another finish filed this id first: its object is now a filed document's — keep it.
    if (e.code !== '23505') await svc.storage.from(BUCKET).remove([path])
    return { ok: false, error: e.code === '23505' ? 'That document is already filed.' : 'Couldn’t file it — try again.' }
  }
  refresh(zoneId)
  return { ok: true, id: input.id }
}

/** Change a document's type, title, dates or note. */
export async function saveDocAction(zoneId: string, id: string, raw: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await writer()
  const job = await jobId(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That document wasn’t found.' }
  const { data: cur } = await svc.from('job_documents').select('costs_only, filename').eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  // A money paper is never touched (or moved to an open type) by a login without costs.
  if (!cur || (cur.costs_only && !perms.canViewCosts)) return { ok: false, error: 'That document wasn’t found.' }
  const { meta, error } = cleanDocMeta(raw, { money: perms.canViewCosts, filename: String(cur.filename) })
  if (!meta) return { ok: false, error: error ?? 'Nothing to save.' }
  if (!(await ownApp(svc, companyId, job, meta.payAppId))) return { ok: false, error: 'That application wasn’t found.' }
  const { data, error: e } = await svc.from('job_documents').update({
    kind: meta.kind, costs_only: costsOnly(meta.kind), title: meta.title, doc_date: meta.docDate, expires_on: meta.expiresOn, note: meta.note,
    pay_app_id: meta.payAppId, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).select('id')
  if (e || !data?.length) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(zoneId)
  return { ok: true }
}

/** A 10-minute signed download (the row read runs under the caller's RLS — money papers need costs; never a prospect). */
export async function docLinkAction(id: string): Promise<Res<{ url: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!UUID.test(id)) return { ok: false, error: 'Bad document' }
  const perms = await getMyPermissions()
  if (!perms.features.includes('jobs') || isProspect(perms)) return { ok: false, error: 'Jobs aren’t open for your login.' }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: d } = await createClient().from('job_documents').select('id, filename, path, costs_only').eq('id', id).maybeSingle()
  // RLS uses the REAL login; a view-as preview carries the previewed role's costs rule too.
  if (!d?.path || (d.costs_only && !perms.canViewCosts)) return { ok: false, error: 'That document is gone.' }
  const { data: s } = await createServiceClient().storage.from(BUCKET).createSignedUrl(String(d.path), 600, { download: String(d.filename) })
  if (!s?.signedUrl) return { ok: false, error: 'Couldn’t open the document — try again.' }
  return { ok: true, url: s.signedUrl }
}

/** Remove a document (Managers and above) — the row and the file. */
export async function deleteDocAction(zoneId: string, id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await writer({ managers: true })
  const job = await jobId(svc, companyId, zoneId)
  if (!job || !UUID.test(id)) return { ok: false, error: 'That document wasn’t found.' }
  const { data: cur } = await svc.from('job_documents').select('costs_only').eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!cur || (cur.costs_only && !perms.canViewCosts)) return { ok: false, error: 'That document wasn’t found.' }
  const { data } = await svc.from('job_documents').update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('job_id', job).eq('company_id', companyId).is('deleted_at', null).select('path')
  if (!data?.length) return { ok: false, error: 'That document wasn’t found.' }
  try { await svc.storage.from(BUCKET).remove([String(data[0].path)]) } catch { /* the health sweep catches it */ }
  refresh(zoneId)
  return { ok: true }
}
