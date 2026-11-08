'use server'

/**
 * The takeoff's writes (migration 146): the item library, marks on sheets,
 * the scale set by hand, snapshots. Service client after the edit check and
 * a company check on every row (the 143 pattern). A mark's quantity is
 * measured HERE, at the sheet's scale — the browser's number is never stored.
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow, getMyPermissions } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { cleanGeom, kindFor, markQty, MEASURE_UNITS, STARTER_ITEMS, type Measure, type Unit, type MarkKind } from '@/lib/plans/measure'
import { versionScale, remeasureVersion, itemsById } from '@/lib/takeoff-server'
import { markFromRow, MARK_COLS, memoFromRow, MEMO_COLS, type PlanMark, type BidMemo } from '@/lib/db/takeoff'
import { keyRateLimited } from '@/lib/rate-limit'
import { cleanPenStats, ruleAssign, cleanAssignments, firstPassPrompt, FIRST_PASS_SYSTEM, MAX_MARKS, type Assignment, type LibraryItem } from '@/lib/plans/first-pass'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f-]{36}$/i
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  // The plans view level gates the writes too (a login with Plans switched
  // off must not reach them by calling an action directly).
  if (!perms.features.includes('plans')) throw new Error('Plans aren’t open for your login.')
  // The company-wide item library and a bid's frozen record are a Manager's.
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('That’s for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}

/** A site of the caller's company that isn't someone's personal zone (the plan room's rule). */
async function companySite(svc: Awaited<ReturnType<typeof writer>>['svc'], companyId: string, zoneId: string): Promise<boolean> {
  const { data } = await svc.from('geofences').select('id, owner_id').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  return !!data && !data.owner_id
}

async function zoneOfSheet(svc: Awaited<ReturnType<typeof writer>>['svc'], sheetId: string): Promise<string | null> {
  const { data } = await svc.from('plan_sheets').select('geofence_id').eq('id', sheetId).maybeSingle()
  return data ? String(data.geofence_id) : null
}
function refresh(zoneId: string | null, sheetId?: string | null) {
  if (!zoneId) return
  revalidatePath(`/plans/${zoneId}`)
  revalidatePath(`/plans/${zoneId}/takeoff`)
  if (sheetId) revalidatePath(`/plans/${zoneId}/${sheetId}`)
}

// ── The item library ────────────────────────────────────────────────────────

export interface ItemInput {
  id?: string
  code: string
  name: string
  measure: string
  unit: string
  color?: string
  unitPrice?: number | null
  wastePct?: number
  depthIn?: number | null
  tonsPerCy?: number | null
  section?: string | null
}

export async function saveTakeoffItemAction(input: ItemInput): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await writer({ managers: true })
  const code = clip(input.code, 16).toUpperCase().replace(/\s+/g, '-')
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,15}$/.test(code)) return { ok: false, error: 'Codes are short letters and numbers, like PAV-HD.' }
  const name = clip(input.name, 120)
  if (!name) return { ok: false, error: 'Name the item.' }
  const measure = input.measure as Measure
  if (!(measure in MEASURE_UNITS)) return { ok: false, error: 'Pick how it is measured.' }
  const unit = input.unit as Unit
  if (!MEASURE_UNITS[measure].includes(unit)) return { ok: false, error: `A ${measure} item is measured in ${MEASURE_UNITS[measure].join(' or ')}.` }
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
  const depth = num(input.depthIn, 0.01, 240)
  if (measure === 'volume' && !depth) return { ok: false, error: 'A volume item needs a depth.' }
  const tons = num(input.tonsPerCy, 0.01, 5)
  if (unit === 'TON' && !tons) return { ok: false, error: 'Tons need a tons-per-CY figure.' }
  const row: Record<string, unknown> = {
    code, name, measure, unit,
    color: /^#[0-9a-fA-F]{6}$/.test(input.color ?? '') ? input.color : '#ff9e16',
    waste_pct: num(input.wastePct, 0, 100) ?? 0,
    depth_in: depth, tons_per_cy: tons,
    section: clip(input.section, 40) || null,
  }
  // A price is written only by someone who may see prices.
  if (perms.canViewCosts && input.unitPrice !== undefined) row.unit_price = num(input.unitPrice, 0, 1e9)
  const { data: clash } = await svc.from('takeoff_items').select('id').eq('company_id', companyId).eq('code', code).is('deleted_at', null)
    .neq('id', input.id && UUID.test(input.id) ? input.id : '00000000-0000-0000-0000-000000000000').limit(1)
  if (clash?.length) return { ok: false, error: `${code} is already an item.` }
  if (input.id) {
    if (!UUID.test(input.id)) return { ok: false, error: 'Bad item' }
    const { data: cur } = await svc.from('takeoff_items').select('id, measure').eq('id', input.id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
    if (!cur) return { ok: false, error: 'Item not found' }
    if (cur.measure !== measure) {
      const { count } = await svc.from('plan_marks').select('id', { count: 'exact', head: true }).eq('item_id', input.id).is('deleted_at', null)
      if (count) return { ok: false, error: `This item is on ${count} mark${count === 1 ? '' : 's'} — make a new item for a different kind of measure.` }
    }
    const { error } = await svc.from('takeoff_items').update(row).eq('id', input.id).eq('company_id', companyId)
    if (error) return { ok: false, error: 'Couldn’t save — try again.' }
    // Depth / unit changes re-measure the marks that use it.
    const { data: vs } = await svc.from('plan_marks').select('version_id').eq('item_id', input.id).is('deleted_at', null).limit(5000)
    for (const vid of Array.from(new Set((vs ?? []).map((r) => String(r.version_id))))) await remeasureVersion(svc, companyId, vid)
    revalidatePath('/plans', 'layout')
    return { ok: true, id: input.id }
  }
  const { data, error } = await svc.from('takeoff_items').insert({ ...row, company_id: companyId }).select('id').single()
  if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  revalidatePath('/plans', 'layout')
  return { ok: true, id: String(data.id) }
}

export async function deleteTakeoffItemAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(id)) return { ok: false, error: 'Bad item' }
  const { error } = await svc.from('takeoff_items').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t delete — try again.' }
  revalidatePath('/plans', 'layout')
  return { ok: true }
}

/** An empty library gets the sitework starter set (no prices). */
export async function seedStarterItemsAction(): Promise<Res<{ added: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const { count } = await svc.from('takeoff_items').select('id', { count: 'exact', head: true }).eq('company_id', companyId).is('deleted_at', null)
  if (count) return { ok: true, added: 0 }
  const rows = STARTER_ITEMS.map((it, i) => ({
    company_id: companyId, code: it.code, name: it.name, measure: it.measure, unit: it.unit, color: it.color,
    depth_in: it.depth_in ?? null, tons_per_cy: it.tons_per_cy ?? null, section: it.section, sort: i,
  }))
  const { error } = await svc.from('takeoff_items').insert(rows)
  if (error) return { ok: false, error: 'Couldn’t add the starter items — try again.' }
  revalidatePath('/plans', 'layout')
  return { ok: true, added: rows.length }
}

// ── Marks ───────────────────────────────────────────────────────────────────

export async function createMarkAction(input: { versionId: string; itemId: string; geom: unknown; label?: string | null }): Promise<Res<{ mark: PlanMark }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (!UUID.test(input.versionId) || !UUID.test(input.itemId)) return { ok: false, error: 'Bad mark' }
  const items = await itemsById(svc, companyId, [input.itemId])
  const item = items.get(input.itemId)
  if (!item) return { ok: false, error: 'Pick an item from the library.' }
  const kind = kindFor(item.measure)
  const geom = cleanGeom(input.geom, kind)
  if (!geom) return { ok: false, error: kind === 'area' ? 'An area needs at least three points.' : kind === 'line' ? 'A length needs two points.' : 'Tap at least one spot.' }
  const sc = await versionScale(svc, companyId, input.versionId)
  if (!sc.sheetId) return { ok: false, error: 'Version not found' }
  if (!sc.feet) return { ok: false, error: sc.blocked ?? 'This sheet has no scale yet.' }
  const qty = markQty(item, kind, geom, sc.feet)
  const { data, error } = await svc.from('plan_marks').insert({
    company_id: companyId, sheet_id: sc.sheetId, version_id: input.versionId, item_id: item.id, kind, geom, qty,
    label: clip(input.label, 120) || null, created_by: userId,
  }).select(MARK_COLS).single()
  if (error || !data) return { ok: false, error: 'Couldn’t save the mark — try again.' }
  refresh(await zoneOfSheet(svc, sc.sheetId), sc.sheetId)
  return { ok: true, mark: markFromRow(data as Record<string, unknown>) }
}

/** Change a mark's item or shape, or accept / clear its flag. */
export async function updateMarkAction(markId: string, patch: { itemId?: string; geom?: unknown; status?: 'ok'; label?: string | null }): Promise<Res<{ mark: PlanMark }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(markId)) return { ok: false, error: 'Bad mark' }
  const { data: m } = await svc.from('plan_marks').select('id, version_id, sheet_id, item_id, kind, geom').eq('id', markId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!m) return { ok: false, error: 'Mark not found' }
  const itemId = patch.itemId && UUID.test(patch.itemId) ? patch.itemId : (m.item_id as string | null)
  const items = await itemsById(svc, companyId, itemId ? [itemId] : [])
  const item = itemId ? items.get(itemId) : undefined
  if (patch.itemId && !item) return { ok: false, error: 'Pick an item from the library.' }
  const kind = m.kind as MarkKind
  if (item && kindFor(item.measure) !== kind) return { ok: false, error: 'That item measures a different kind of shape.' }
  const geom = patch.geom !== undefined ? cleanGeom(patch.geom, kind) : m.geom
  if (!geom) return { ok: false, error: 'That shape isn’t complete.' }
  const sc = await versionScale(svc, companyId, String(m.version_id))
  const upd: Record<string, unknown> = {
    item_id: itemId, geom, qty: item && sc.feet ? markQty(item, kind, geom, sc.feet) : null, updated_at: new Date().toISOString(),
  }
  if (patch.status === 'ok') upd.status = 'ok'
  if (patch.label !== undefined) upd.label = clip(patch.label, 120) || null
  const { data, error } = await svc.from('plan_marks').update(upd).eq('id', markId).eq('company_id', companyId).select(MARK_COLS).single()
  if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(await zoneOfSheet(svc, String(m.sheet_id)), String(m.sheet_id))
  return { ok: true, mark: markFromRow(data as Record<string, unknown>) }
}

export async function deleteMarksAction(markIds: string[]): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!Array.isArray(markIds) || markIds.length > 2000 || !markIds.every((x) => UUID.test(x))) return { ok: false, error: 'Bad marks' }
  if (!markIds.length) return { ok: true }
  const { data } = await svc.from('plan_marks').update({ deleted_at: new Date().toISOString() }).in('id', markIds).eq('company_id', companyId).select('sheet_id').limit(1)
  if (data?.[0]) refresh(await zoneOfSheet(svc, String(data[0].sheet_id)), String(data[0].sheet_id))
  return { ok: true }
}

/** Accept the AI's suggested marks, or clear "needs a look" on carried ones. */
export async function confirmMarksAction(markIds: string[]): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!Array.isArray(markIds) || markIds.length > 2000 || !markIds.every((x) => UUID.test(x))) return { ok: false, error: 'Bad marks' }
  if (!markIds.length) return { ok: true }
  const { data } = await svc.from('plan_marks').update({ status: 'ok', updated_at: new Date().toISOString() }).in('id', markIds).eq('company_id', companyId).is('deleted_at', null).select('sheet_id').limit(1)
  if (data?.[0]) refresh(await zoneOfSheet(svc, String(data[0].sheet_id)), String(data[0].sheet_id))
  return { ok: true }
}

/**
 * Set a sheet's scale by hand (the scale card's "Use 1\" = 60'") — or clear
 * it (null) — and re-measure every mark on it.
 */
export async function setVersionScaleAction(versionId: string, feetPerInch: number | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(versionId)) return { ok: false, error: 'Bad version' }
  if (feetPerInch !== null && !(typeof feetPerInch === 'number' && feetPerInch > 0 && feetPerInch <= 2000)) return { ok: false, error: 'Pick a real scale.' }
  const { data: v } = await svc.from('plan_versions').select('id, sheet_id, scale_checks').eq('id', versionId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!v) return { ok: false, error: 'Version not found' }
  const kept = (Array.isArray(v.scale_checks) ? v.scale_checks as { key: string }[] : []).filter((c) => c.key !== 'set')
  const perms = await getMyPermissions()
  const next = feetPerInch === null ? kept : [...kept, { key: 'set', feetPerInch: Math.round(feetPerInch * 100) / 100, detail: perms.role ? `set by hand` : 'set by hand' }]
  const { error } = await svc.from('plan_versions').update({ scale_checks: next.length ? next : null }).eq('id', versionId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  await remeasureVersion(svc, companyId, versionId)
  refresh(await zoneOfSheet(svc, String(v.sheet_id)), String(v.sheet_id))
  return { ok: true }
}

// ── Snapshots ───────────────────────────────────────────────────────────────

/** Freeze the site's takeoff as it stands ("Bid · Rev 0 · Aug 12"). Quantities only. */
export async function freezeTakeoffAction(zoneId: string, name: string, kind: 'bid' | 'other' = 'bid'): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (!UUID.test(zoneId)) return { ok: false, error: 'Bad site' }
  const label = clip(name, 120)
  if (!label) return { ok: false, error: 'Name the snapshot.' }
  if (!(await companySite(svc, companyId, zoneId))) return { ok: false, error: 'Site not found' }
  const { buildTakeoff } = await import('@/lib/takeoff-summary')
  const t = await buildTakeoff(svc, companyId, zoneId)
  if (!t) return { ok: false, error: 'Nothing to freeze yet.' }
  const data = {
    items: t.rows.map((r) => ({ code: r.code, name: r.name, unit: r.unit, qty: r.qty })),
    sheets: t.sheets.map((s) => ({ number: s.number, rev: s.rev, versionId: s.versionId })),
  }
  const { data: row, error } = await svc.from('takeoff_snapshots').insert({
    company_id: companyId, geofence_id: zoneId, name: label, kind: kind === 'other' ? 'other' : 'bid', data, created_by: userId,
  }).select('id').single()
  if (error || !row) return { ok: false, error: 'Couldn’t freeze — try again.' }
  refresh(zoneId)
  return { ok: true, id: String(row.id) }
}

export async function deleteSnapshotAction(snapshotId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(snapshotId)) return { ok: false, error: 'Bad snapshot' }
  const { data } = await svc.from('takeoff_snapshots').update({ deleted_at: new Date().toISOString() }).eq('id', snapshotId).eq('company_id', companyId).select('geofence_id').maybeSingle()
  refresh(data ? String(data.geofence_id) : null)
  return { ok: true }
}

// ── Spreadsheet links ───────────────────────────────────────────────────────

/** A private CSV link for this site's takeoff (Sheets IMPORTDATA / Excel Power Query). */
export async function createTakeoffLinkAction(zoneId: string, includeCosts: boolean): Promise<Res<{ token: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, userId, svc } = await writer()
  if (!UUID.test(zoneId)) return { ok: false, error: 'Bad site' }
  if (!(await companySite(svc, companyId, zoneId))) return { ok: false, error: 'Site not found' }
  const { count } = await svc.from('takeoff_links').select('token', { count: 'exact', head: true }).eq('company_id', companyId).is('revoked_at', null)
  if ((count ?? 0) >= 100) return { ok: false, error: 'Your company has 100 live spreadsheet links — turn some off first.' }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  const { error } = await svc.from('takeoff_links').insert({
    token, company_id: companyId, geofence_id: zoneId, include_costs: includeCosts && perms.canViewCosts, created_by: userId,
  })
  if (error) return { ok: false, error: 'Couldn’t make the link — try again.' }
  refresh(zoneId)
  return { ok: true, token }
}

export async function revokeTakeoffLinkAction(token: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!/^[A-Za-z0-9]{24,40}$/.test(token)) return { ok: false, error: 'Bad link' }
  const { data } = await svc.from('takeoff_links').update({ revoked_at: new Date().toISOString() }).eq('token', token).eq('company_id', companyId).select('geofence_id').maybeSingle()
  refresh(data ? String(data.geofence_id) : null)
  return { ok: true }
}

// ── The first pass ──────────────────────────────────────────────────────────

/**
 * Which of a sheet's pens (CAD layers) is which library item: the model when
 * it answers, the layer-name rules otherwise. Words only — the marks those
 * pens draw are measured by suggestMarksAction like any other mark.
 */
export async function firstPassAction(versionId: string, rawStats: unknown): Promise<Res<{ assign: Assignment[]; source: 'ai' | 'rules'; model: string | null }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(versionId)) return { ok: false, error: 'Bad version' }
  const { data: v } = await svc.from('plan_versions').select('id').eq('id', versionId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!v) return { ok: false, error: 'Version not found' }
  const stats = cleanPenStats(rawStats)
  if (!stats.length) return { ok: false, error: 'This sheet has no linework to read — it may be a scan.' }
  const { data: rows } = await svc.from('takeoff_items').select('id, code, name, measure, section').eq('company_id', companyId).is('deleted_at', null).limit(500)
  const items: LibraryItem[] = (rows ?? []).map((r) => ({ id: String(r.id), code: String(r.code), name: String(r.name), measure: r.measure as Measure, section: (r.section as string | null) ?? null }))
  if (!items.length) return { ok: false, error: 'Add items to the library first (the Items tab in the plan room).' }
  const rules = ruleAssign(stats, items)
  // A run reads the whole sheet: bounded per company (API money).
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey && !keyRateLimited(companyId, 'first-pass', 30, 60 * 60_000)) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const { everydayModel } = await import('@/lib/ai-status')
      const model = everydayModel()
      const client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 })
      const res = await client.messages.create({
        model, max_tokens: 4000, system: FIRST_PASS_SYSTEM,
        messages: [{ role: 'user', content: firstPassPrompt(stats, items) }],
      })
      const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
      const i = text.indexOf('{'), j = text.lastIndexOf('}')
      if (res.stop_reason !== 'refusal' && i >= 0 && j > i) {
        const ai = cleanAssignments(JSON.parse(text.slice(i, j + 1)), stats, items)
        // The model's word wins; a layer it left out that the rules are sure of stays.
        const taken = new Set(ai.map((a) => a.pen))
        const merged = [...ai, ...rules.filter((r) => !taken.has(r.pen))]
        if (merged.length) return { ok: true, assign: merged, source: 'ai', model }
      }
    } catch (err) {
      console.error('First pass mapping failed', err)
    }
  }
  return { ok: true, assign: rules, source: 'rules', model: null }
}

/**
 * Store the first pass's marks as SUGGESTED (dashed until someone accepts
 * them), measured here at the sheet's scale. A new run replaces the last
 * run's suggestions on that version; accepted marks are never touched.
 */
export async function suggestMarksAction(versionId: string, marks: unknown): Promise<Res<{ marks: PlanMark[] }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (!UUID.test(versionId)) return { ok: false, error: 'Bad version' }
  if (!Array.isArray(marks) || marks.length > MAX_MARKS) return { ok: false, error: 'Too many marks in one go.' }
  const sc = await versionScale(svc, companyId, versionId)
  if (!sc.sheetId) return { ok: false, error: 'Version not found' }
  if (!sc.feet) return { ok: false, error: sc.blocked ?? 'This sheet has no scale yet.' }
  const ids = Array.from(new Set(marks.map((m) => (m && typeof m === 'object' ? String((m as { itemId?: unknown }).itemId ?? '') : '')).filter((x) => UUID.test(x))))
  const items = await itemsById(svc, companyId, ids)
  const rows = marks.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const { itemId, geom, label } = m as { itemId?: unknown; geom?: unknown; label?: unknown }
    const item = typeof itemId === 'string' ? items.get(itemId) : undefined
    if (!item) return []
    const kind = kindFor(item.measure)
    const g = cleanGeom(geom, kind)
    if (!g) return []
    return [{
      company_id: companyId, sheet_id: sc.sheetId, version_id: versionId, item_id: item.id, kind, geom: g,
      qty: markQty(item, kind, g, sc.feet!), status: 'suggested', label: clip(label, 120) || 'First pass', created_by: userId,
    }]
  })
  await svc.from('plan_marks').update({ deleted_at: new Date().toISOString() }).eq('version_id', versionId).eq('company_id', companyId).eq('status', 'suggested').is('deleted_at', null)
  if (!rows.length) return { ok: true, marks: [] }
  const { data, error } = await svc.from('plan_marks').insert(rows).select(MARK_COLS)
  if (error || !data) return { ok: false, error: 'Couldn’t save the suggestions — try again.' }
  refresh(await zoneOfSheet(svc, sc.sheetId), sc.sheetId)
  return { ok: true, marks: data.map((r) => markFromRow(r as Record<string, unknown>)) }
}

// ── The bid memo ────────────────────────────────────────────────────────────

/** Draft the site's bid memo from what the plan room and the takeoff hold. */
export async function draftBidMemoAction(zoneId: string): Promise<Res<{ memo: BidMemo }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  if (!UUID.test(zoneId) || !(await companySite(svc, companyId, zoneId))) return { ok: false, error: 'Site not found' }
  if (keyRateLimited(companyId, 'bid-memo', 12, 60 * 60_000)) return { ok: false, error: 'That’s a lot of drafts this hour — edit the last one, or try again later.' }
  const { gatherBidFacts, draftBidMemo } = await import('@/lib/bid-memo')
  const facts = await gatherBidFacts(svc, companyId, zoneId)
  if (!facts) return { ok: false, error: 'Site not found' }
  const d = await draftBidMemo(facts, true)
  const { data, error } = await svc.from('bid_memos').insert({
    company_id: companyId, geofence_id: zoneId, body: d.body, facts, model: d.model, status: 'draft', created_by: userId,
  }).select(MEMO_COLS).single()
  if (error || !data) return { ok: false, error: 'Couldn’t save the draft — try again.' }
  refresh(zoneId)
  return { ok: true, memo: memoFromRow(data as Record<string, unknown>) }
}

/** Save an edited memo. An edit after approval takes the approval off. */
export async function saveBidMemoAction(memoId: string, body: string): Promise<Res<{ memo: BidMemo }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(memoId)) return { ok: false, error: 'Bad memo' }
  const text = String(body ?? '').replace(/\r\n/g, '\n').slice(0, 40000)
  if (!text.trim()) return { ok: false, error: 'The memo is empty.' }
  const { data, error } = await svc.from('bid_memos').update({ body: text, status: 'draft', approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
    .eq('id', memoId).eq('company_id', companyId).is('deleted_at', null).select(`${MEMO_COLS}, geofence_id`).maybeSingle()
  if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(String(data.geofence_id))
  return { ok: true, memo: memoFromRow(data as Record<string, unknown>) }
}

/** A Manager signs off on the memo as it reads now. */
export async function approveBidMemoAction(memoId: string): Promise<Res<{ memo: BidMemo }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ managers: true })
  if (!UUID.test(memoId)) return { ok: false, error: 'Bad memo' }
  const now = new Date().toISOString()
  const { data, error } = await svc.from('bid_memos').update({ status: 'approved', approved_by: userId, approved_at: now, updated_at: now })
    .eq('id', memoId).eq('company_id', companyId).is('deleted_at', null).select(`${MEMO_COLS}, geofence_id`).maybeSingle()
  if (error || !data) return { ok: false, error: 'Couldn’t approve — try again.' }
  refresh(String(data.geofence_id))
  return { ok: true, memo: memoFromRow(data as Record<string, unknown>) }
}
