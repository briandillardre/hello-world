'use server'

/**
 * Supplier invoices' writes (migration 165). Members hold SELECT only, so
 * every write runs on the service client AFTER the edit + plans + COSTS
 * checks (the cost book's gate — a login that can't see dollars can't write
 * them), pinned to the caller's company. Files go straight from the device
 * to the private 'invoices' bucket at <company>/<uuid> through a one-time
 * signed upload and come back only as short signed links.
 *
 * Filing an invoice can (a) write the cost book's dated prices for its
 * source and (b) charge the site's job cost (pcat M, vendor + reference =
 * the invoice number). Deleting one is a Manager's.
 *
 * Callers read every reply as `r?.ok` (lib/action-reply.ts).
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow, getMyPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import {
  cleanDraft, invoiceChecks, invoiceRef, lineAmount, matchMaterial, matchVendor, pricesFromInvoice,
  readDay, type InvoiceCheck, type InvoiceDraft, type Match,
} from '@/lib/pricing/invoice'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BYTES = 25 * 1024 * 1024
/** Claude reads an image up to ~5 MB; the page shrinks photos before upload. */
const MAX_IMAGE_READ = 5 * 1024 * 1024
const MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
const SOURCE_KINDS = ['supplier', 'quarry', 'asphalt', 'concrete', 'borrow', 'landfill', 'dump'] as const
const MAX_JOB_COSTS = 20_000

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; typeIt?: boolean }
const clip = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const today = () => new Date().toISOString().slice(0, 10)

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (perms.viewingAs) throw new Error('Read-only preview — exit View as to make changes.')
  if (isProspect(perms)) throw new Error('Invoices aren’t open for your login.')
  if (!perms.features.includes('plans')) throw new Error('The cost book isn’t open for your login.')
  if (!perms.canViewCosts) throw new Error('Invoices are for logins that can see costs.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('Removing an invoice is for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}
type Svc = Awaited<ReturnType<typeof writer>>['svc']
type Perms = Awaited<ReturnType<typeof writer>>['perms']

const refresh = (zoneId?: string | null) => {
  revalidatePath('/costbook', 'layout')
  if (zoneId) { revalidatePath(`/jobs/${zoneId}/cost`); revalidatePath(`/jobs/${zoneId}`) }
}

const pathOk = (companyId: string, path: unknown): path is string =>
  typeof path === 'string' && path.startsWith(`${companyId}/`) && UUID.test(path.slice(companyId.length + 1)) && path.length === companyId.length + 37

/** The stored object (size + type), or null when it never landed. */
async function stored(svc: Svc, companyId: string, path: string): Promise<{ size: number; mime: string } | null> {
  const name = path.slice(companyId.length + 1)
  const { data } = await svc.storage.from('invoices').list(companyId, { search: name, limit: 5 })
  const o = data?.find((x) => x.name === name)
  const meta = (o?.metadata ?? {}) as { size?: number; mimetype?: string }
  const size = Number(meta.size ?? 0)
  return o && size ? { size, mime: String(meta.mimetype ?? '') } : null
}

/** A site zone of the caller's company (never personal, a boundary, a vendor or a yard). */
async function ownSite(svc: Svc, companyId: string, zoneId: string): Promise<boolean> {
  if (!UUID.test(zoneId)) return false
  const { data } = await svc.from('geofences').select('id, kind, owner_id').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  return !!data && !data.owner_id && !['boundary', 'vendor', 'yard'].includes(String(data.kind))
}

async function bookOf(svc: Svc, companyId: string) {
  const [{ data: mats }, { data: places }] = await Promise.all([
    svc.from('cost_materials').select('id, name, unit').eq('company_id', companyId).is('deleted_at', null).limit(1000),
    svc.from('places').select('id, name, kind').eq('company_id', companyId).eq('active', true).limit(2000),
  ])
  return {
    materials: (mats ?? []).map((m) => ({ id: String(m.id), name: String(m.name), unit: String(m.unit) })),
    places: (places ?? []).map((p) => ({ id: String(p.id), name: String(p.name), kind: String(p.kind) })),
  }
}

// ── Upload ──────────────────────────────────────────────────────────────────

/** Upload, step 1: a one-time signed upload into the private invoices bucket. */
export async function startInvoiceUploadAction(input: { filename: string; size: number; mime: string }): Promise<Res<{ path: string; token: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode — invoices are read once you sign in to your company.' }
  const { companyId, userId, svc } = await writer()
  if (userId && keyRateLimited(userId, 'invoice-upload', 30)) return { ok: false, error: 'That’s a lot of uploads in a minute — wait a moment.' }
  if (!clip(input?.filename, 200)) return { ok: false, error: 'That file has no name.' }
  if (!MIMES.includes(String(input?.mime))) return { ok: false, error: 'Invoices go up as a PDF or a photo (JPEG, PNG, WebP, HEIC).' }
  if (!(Number(input?.size) > 0) || Number(input.size) > MAX_BYTES) return { ok: false, error: 'Invoices go up to 25 MB.' }
  // Count uploads STARTED in a day (an unfinished one still holds space until the sweep).
  const since = Date.now() - 86_400_000
  const { data: recent } = await svc.storage.from('invoices').list(companyId, { limit: 401, sortBy: { column: 'created_at', order: 'desc' } })
  if ((recent ?? []).filter((o) => Date.parse(String(o.created_at ?? '')) >= since).length >= 400) return { ok: false, error: 'That’s a lot of invoices for one day — try again tomorrow.' }
  const path = `${companyId}/${crypto.randomUUID()}`
  const { data, error } = await svc.storage.from('invoices').createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, path: data.path, token: data.token }
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface ReadResult {
  draft: InvoiceDraft
  vendorMatch: Match | null
  /** Per line: the cost-book material it was matched to (null = no good match). */
  lineMatches: (Match | null)[]
  checks: InvoiceCheck[]
}

/** Upload, step 2: read the stored PDF or photo into a draft for review (nothing is written). */
export async function readInvoiceAction(input: { path: string }): Promise<Res<ReadResult>> {
  if (isMock) return { ok: false, error: 'Demo mode', typeIt: true }
  const { companyId, userId, svc } = await writer()
  if (!pathOk(companyId, input?.path)) return { ok: false, error: 'That file wasn’t found.' }
  if (userId && keyRateLimited(userId, 'invoice-read', 10)) return { ok: false, error: 'That’s a lot of invoices in a minute — wait a moment.' }
  if (keyRateLimited(companyId, 'invoice-read-day', 200, 86_400_000)) return { ok: false, error: 'Your company has read 200 invoices today — type this one in, or try tomorrow.', typeIt: true }
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Invoice reading isn’t set up — type it in below.', typeIt: true }
  const obj = await stored(svc, companyId, input.path)
  if (!obj) return { ok: false, error: 'The file didn’t finish uploading — try again.' }
  const { data: blob, error } = await svc.storage.from('invoices').download(input.path)
  if (error || !blob) return { ok: false, error: 'Couldn’t open the file — try again.' }
  const mime = blob.type || obj.mime
  if (mime === 'image/heic') return { ok: false, error: 'That photo is in Apple’s HEIC format, which can’t be read — type it in below, or take the photo from the app’s camera.', typeIt: true }
  const buf = Buffer.from(await blob.arrayBuffer())
  if (mime !== 'application/pdf' && buf.byteLength > MAX_IMAGE_READ) return { ok: false, error: 'That photo is too big to read — retake it, or type it in below.', typeIt: true }
  let raw: Record<string, unknown>
  try {
    const { readInvoice } = await import('@/lib/pricing/invoice-read')
    raw = await readInvoice({ data: buf, mediaType: mime })
  } catch (e) {
    if (e instanceof Error && e.name === 'InvoiceReadUnavailable') return { ok: false, error: 'Invoice reading isn’t set up — type it in below.', typeIt: true }
    return { ok: false, error: 'The invoice couldn’t be read just now — try again, or type it in below.', typeIt: true }
  }
  const draft = cleanDraft(raw)
  if (!draft.lines.length && !draft.vendorName && draft.total === null) return { ok: false, error: 'Nothing on that page reads as an invoice — type it in below.', typeIt: true }
  const { materials, places } = await bookOf(svc, companyId)
  const vendorMatch = draft.vendorName ? matchVendor(draft.vendorName, places) : null
  if (vendorMatch) draft.placeId = vendorMatch.id
  const lineMatches = draft.lines.map((l) => (l.description ? matchMaterial(l.description, materials) : null))
  draft.lines = draft.lines.map((l, i) => ({ ...l, materialId: lineMatches[i]?.id ?? null }))
  return { ok: true, draft, vendorMatch, lineMatches, checks: invoiceChecks(draft) }
}

// ── File ────────────────────────────────────────────────────────────────────

export interface FileOptions {
  /** The upload's path (<company>/<uuid>) — none for a typed-in invoice. */
  filePath?: string | null
  fileName?: string | null
  /** The draft came from the reader (else typed). */
  readByAi?: boolean
  updatePrices: boolean
  chargeJob: boolean
  /** A source not on the map yet: it becomes a Place here. */
  newSource?: { name: string; kind: string; lat: number; lng: number } | null
  /** Lines whose material is new to the book: added under this name, sold by the line's unit. */
  newMaterials?: { line: number; name: string }[]
  note?: string | null
}

async function dupeOf(svc: Svc, companyId: string, vendor: string, no: string, notId?: string): Promise<string | null> {
  const { data } = await svc.from('supplier_invoices').select('id, vendor_name, invoice_on, created_at')
    .eq('company_id', companyId).is('deleted_at', null).ilike('invoice_no', no.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(50)
  const hit = (data ?? []).find((r) => String(r.vendor_name).toLowerCase() === vendor.toLowerCase() && String(r.id) !== notId)
  if (!hit) return null
  const on = String(hit.invoice_on ?? String(hit.created_at ?? '').slice(0, 10))
  return `Invoice ${no} from ${hit.vendor_name} is already filed${on ? ` (dated ${on})` : ''}.`
}

/** Charge an invoice's lines + freight + fuel + tax to its site's job cost (pcat M). Refuses twice. */
async function chargeToJob(svc: Svc, perms: Perms, companyId: string, userId: string | null, inv: { id: string; zoneId: string | null; draft: InvoiceDraft }): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  if (!perms.features.includes('jobs')) return { ok: false, error: 'Jobs aren’t open for your login, so it wasn’t charged to the job.' }
  if (!inv.zoneId) return { ok: false, error: 'Pick the site it was for to charge its job.' }
  const { data: job } = await svc.from('jobs').select('id').eq('geofence_id', inv.zoneId).eq('company_id', companyId).maybeSingle()
  if (!job) return { ok: false, error: 'That site has no job yet — it was filed without charging a job.' }
  const d = inv.draft
  const vendor = clip(d.vendorName, 120)
  const reference = invoiceRef(inv.id, d.invoiceNo)
  const { data: prior } = await svc.from('job_costs').select('id, vendor').eq('job_id', job.id).eq('company_id', companyId).eq('reference', reference).is('deleted_at', null).limit(50)
  if ((prior ?? []).some((p) => String(p.vendor ?? '').toLowerCase() === vendor.toLowerCase())) return { ok: false, error: `Invoice ${reference} is already on this job’s cost.` }
  const spentOn = d.invoiceOn ?? today()
  const rows: Record<string, unknown>[] = []
  const add = (amount: number | null, description: string) => {
    if (amount === null || amount === 0) return
    rows.push({ company_id: companyId, job_id: job.id, spent_on: spentOn, pcat: 'M', amount, vendor, reference, description: clip(description, 300) || null, source: 'import', created_by: userId })
  }
  for (const l of d.lines) {
    const qty = l.qty !== null && l.unit ? ` — ${l.qty.toLocaleString('en-US')} ${l.unit}` : ''
    add(lineAmount(l), `${l.description || 'Material'}${qty}${l.ticket ? ` · ticket ${l.ticket}` : ''}`)
  }
  add(d.freight, 'Freight')
  add(d.fuel, 'Fuel surcharge')
  add(d.tax, 'Sales tax')
  if (!rows.length) return { ok: false, error: 'The invoice has no amounts to charge.' }
  const { count } = await svc.from('job_costs').select('id', { count: 'exact', head: true }).eq('job_id', job.id).is('deleted_at', null)
  if ((count ?? 0) + rows.length > MAX_JOB_COSTS) return { ok: false, error: `That would take the job past ${MAX_JOB_COSTS.toLocaleString()} entered costs.` }
  const { error } = await svc.from('job_costs').insert(rows)
  if (error) return { ok: false, error: 'Couldn’t charge the job — try again from the invoice.' }
  return { ok: true, rows: rows.length }
}

/**
 * File a reviewed invoice: the duplicate check, the source (a new Place if
 * asked), the row, then the cost book's prices and the job's cost when asked.
 * The invoice is filed even if a later step can't run — `warnings` says which.
 */
export async function fileInvoiceAction(rawDraft: unknown, opts: FileOptions): Promise<Res<{ id: string; prices: number; charged: number; warnings: string[] }>> {
  if (isMock) return { ok: false, error: 'Demo mode — filing invoices works once you sign in to your company.' }
  const { perms, companyId, userId, svc } = await writer()
  if (userId && keyRateLimited(userId, 'invoice-file', 30)) return { ok: false, error: 'That’s a lot of invoices in a minute — wait a moment.' }
  const d = cleanDraft(rawDraft)
  if (!d.vendorName) return { ok: false, error: 'Name the vendor.' }
  if (!d.lines.length && d.total === null) return { ok: false, error: 'Give at least one line or the total.' }
  if (d.total === null) {
    const sum = d.lines.reduce((t, l) => t + (lineAmount(l) ?? 0), 0) + (d.freight ?? 0) + (d.fuel ?? 0) + (d.tax ?? 0)
    d.total = Math.round(sum * 100) / 100
  }
  if (d.invoiceNo) {
    const dupe = await dupeOf(svc, companyId, d.vendorName, d.invoiceNo)
    if (dupe) return { ok: false, error: dupe }
  }
  // The file: this company's, landed, and not already another invoice's.
  let filePath: string | null = null
  if (opts?.filePath) {
    if (!pathOk(companyId, opts.filePath)) return { ok: false, error: 'That file wasn’t found.' }
    if (!(await stored(svc, companyId, opts.filePath))) return { ok: false, error: 'The file didn’t finish uploading — try again.' }
    const { data: used } = await svc.from('supplier_invoices').select('id').eq('file_path', opts.filePath).is('deleted_at', null).limit(1)
    if (used?.length) return { ok: false, error: 'That file is already filed as an invoice.' }
    filePath = opts.filePath
  }
  // The site.
  if (d.zoneId && !(await ownSite(svc, companyId, d.zoneId))) return { ok: false, error: 'That site wasn’t found.' }
  const warnings: string[] = []
  // The source: a place of this company, or a new one.
  if (d.placeId) {
    const { data: p } = await svc.from('places').select('id').eq('id', d.placeId).eq('company_id', companyId).eq('active', true).maybeSingle()
    if (!p) d.placeId = null
  }
  if (!d.placeId && opts?.newSource) {
    const ns = opts.newSource
    const name = clip(ns.name, 80) || clip(d.vendorName, 80)
    const kind = (SOURCE_KINDS as readonly string[]).includes(ns.kind) ? ns.kind : 'supplier'
    const lat = Number(ns.lat), lng = Number(ns.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      return { ok: false, error: 'A new source needs its location — use this phone’s location at the plant, or type its lat, lng.' }
    }
    const { data: p, error } = await svc.from('places').insert({ company_id: companyId, name, kind, lat, lng, created_by: userId }).select('id').single()
    if (error || !p) return { ok: false, error: 'Couldn’t add the source — try again.' }
    d.placeId = String(p.id)
  }
  // Materials: the book's own, plus any added here.
  const { materials } = await bookOf(svc, companyId)
  const known = new Set(materials.map((m) => m.id))
  d.lines = d.lines.map((l) => ({ ...l, materialId: l.materialId && known.has(l.materialId) ? l.materialId : null }))
  const byName = new Map(materials.map((m) => [m.name.toLowerCase(), m.id]))
  for (const nm of (Array.isArray(opts?.newMaterials) ? opts.newMaterials : []).slice(0, 200)) {
    const i = Number(nm?.line)
    const line = Number.isInteger(i) ? d.lines[i] : undefined
    const name = clip(nm?.name, 80)
    if (!line || !name) continue
    if (!line.unit) { warnings.push(`Line ${i + 1}: “${name}” needs a unit to join the book.`); continue }
    let mid = byName.get(name.toLowerCase())
    if (!mid) {
      const { data: m } = await svc.from('cost_materials').insert({ company_id: companyId, name, unit: line.unit }).select('id').single()
      if (!m) { warnings.push(`Couldn’t add “${name}” to the book.`); continue }
      mid = String(m.id)
      byName.set(name.toLowerCase(), mid)
      materials.push({ id: mid, name, unit: line.unit })
    }
    line.materialId = mid
  }
  const id = crypto.randomUUID()
  const { error: insErr } = await svc.from('supplier_invoices').insert({
    id, company_id: companyId, place_id: d.placeId, geofence_id: d.zoneId, vendor_name: d.vendorName, invoice_no: d.invoiceNo,
    invoice_on: d.invoiceOn, due_on: d.dueOn, freight: d.freight, fuel: d.fuel, tax: d.tax, total: d.total, lines: d.lines,
    status: 'filed', file_path: filePath, file_name: filePath ? clip(opts.fileName, 200) || null : null,
    read_by: opts?.readByAi && filePath ? 'ai' : 'typed', note: clip(opts?.note, 500) || null, created_by: userId,
  })
  if (insErr) {
    if (insErr.code === '23505') return { ok: false, error: `Invoice ${d.invoiceNo ?? ''} from ${d.vendorName} is already filed.` }
    return { ok: false, error: 'Couldn’t file it — try again.' }
  }
  // (a) The cost book's dated prices.
  let prices = 0
  if (opts?.updatePrices) {
    if (!d.placeId) warnings.push('No source picked, so the cost book wasn’t updated.')
    else if (!d.invoiceOn) warnings.push('No invoice date, so the cost book wasn’t updated.')
    else {
      const rows = pricesFromInvoice(d, materials)
      if (!rows.length) warnings.push('No line is matched to a material with a quantity and unit, so the cost book wasn’t updated.')
      else {
        const { error } = await svc.from('cost_prices').insert(rows.map((r) => ({
          company_id: companyId, place_id: r.placeId, material_id: r.materialId, price: r.price, unit: r.unit, basis: r.basis,
          min_charge: null, fuel_pct: r.fuelPct, quoted_on: r.quotedOn, note: r.note, created_by: userId,
        })))
        if (error) warnings.push('Couldn’t write the cost book prices — add them from the cost book.')
        else prices = rows.length
      }
    }
  }
  // (b) The job's cost.
  let charged = 0
  if (opts?.chargeJob && d.zoneId) {
    const c = await chargeToJob(svc, perms, companyId, userId, { id, zoneId: d.zoneId, draft: d })
    if (c.ok) charged = c.rows
    else warnings.push(c.error)
  }
  refresh(d.zoneId)
  return { ok: true, id, prices, charged, warnings }
}

/** Charge an invoice filed earlier to its site's job (once). */
export async function chargeInvoiceAction(id: string): Promise<Res<{ charged: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, userId, svc } = await writer()
  if (!UUID.test(String(id))) return { ok: false, error: 'Bad invoice' }
  const { data: r } = await svc.from('supplier_invoices').select('*').eq('id', id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!r) return { ok: false, error: 'That invoice is gone.' }
  const draft = cleanDraft({
    vendorName: r.vendor_name, invoiceNo: r.invoice_no, invoiceOn: r.invoice_on, dueOn: r.due_on, freight: r.freight === null ? null : Number(r.freight),
    fuel: r.fuel === null ? null : Number(r.fuel), tax: r.tax === null ? null : Number(r.tax), total: r.total === null ? null : Number(r.total), lines: r.lines,
  })
  const c = await chargeToJob(svc, perms, companyId, userId, { id: String(r.id), zoneId: (r.geofence_id as string | null) ?? null, draft })
  if (!c.ok) return { ok: false, error: c.error }
  refresh(r.geofence_id as string | null)
  return { ok: true, charged: c.rows }
}

/** Set (or clear, with paidOn null) what was paid on an invoice and when. */
export async function markInvoicePaidAction(id: string, input: { paidOn: string | null; paidAmount: number | null }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(String(id))) return { ok: false, error: 'Bad invoice' }
  let paidOn: string | null = null, paidAmount: number | null = null
  if (input?.paidOn !== null && input?.paidOn !== undefined) {
    paidOn = readDay(input.paidOn)
    if (!paidOn) return { ok: false, error: 'Give the day it was paid.' }
    if (paidOn > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) return { ok: false, error: 'That day hasn’t come yet.' }
    const amt = input.paidAmount
    if (amt !== null && amt !== undefined && !(typeof amt === 'number' && Number.isFinite(amt) && Math.abs(amt) <= 100_000_000)) return { ok: false, error: 'That amount can’t be read.' }
    paidAmount = amt === null || amt === undefined ? null : Math.round(amt * 100) / 100
  }
  const { data, error } = await svc.from('supplier_invoices').update({ paid_on: paidOn, paid_amount: paidAmount, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId).is('deleted_at', null).select('id')
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  if (!data?.length) return { ok: false, error: 'That invoice is gone.' }
  refresh()
  return { ok: true }
}

/**
 * Remove an invoice (Managers and above): the row (soft) and its file. The
 * prices it wrote stay in the book's dated history, and charges it put on a
 * job stay on the job's cost — remove those there if they should go.
 */
export async function deleteInvoiceAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(String(id))) return { ok: false, error: 'Bad invoice' }
  const { data } = await svc.from('supplier_invoices').update({ deleted_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId).is('deleted_at', null).select('file_path, geofence_id')
  if (!data?.length) return { ok: false, error: 'That invoice is gone.' }
  const path = data[0].file_path as string | null
  if (path) { try { await svc.storage.from('invoices').remove([path]) } catch { /* the health sweep catches it */ } }
  refresh(data[0].geofence_id as string | null)
  return { ok: true }
}

/** A short signed link to an invoice's file (the row is read under the caller's RLS — costs logins only). */
export async function invoiceFileUrlAction(id: string): Promise<Res<{ url: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!UUID.test(String(id))) return { ok: false, error: 'Bad invoice' }
  const perms = await getMyPermissions()
  if (isProspect(perms) || !perms.canViewCosts || !perms.features.includes('plans')) return { ok: false, error: 'Invoices aren’t open for your login.' }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: r } = await createClient().from('supplier_invoices').select('file_path, file_name').eq('id', id).maybeSingle()
  if (!r?.file_path) return { ok: false, error: 'This invoice has no file.' }
  const { data: s } = await createServiceClient().storage.from('invoices').createSignedUrl(String(r.file_path), 300)
  if (!s?.signedUrl) return { ok: false, error: 'Couldn’t open the file — try again.' }
  return { ok: true, url: s.signedUrl }
}
