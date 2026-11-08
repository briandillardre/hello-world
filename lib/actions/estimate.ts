'use server'

/**
 * The cost book and the estimate's writes (migration 147). Service role after
 * the edit + plans + COSTS checks (a login that can't see dollars can't write
 * them either); margins — markups — are an Admin's. Every number stored is a
 * choice (a price, a rate, a pinned source); totals are computed from them.
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import { cleanLines, cleanMarkups, cleanSettings, PRICE_UNITS, type Line, type LineUnit, type PriceUnit, layersOf } from '@/lib/estimate/engine'
import { SOURCE_KINDS } from '@/lib/db/estimate'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f-]{36}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)

async function writer(opts: { admin?: boolean; managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (!perms.features.includes('plans')) throw new Error('Plans aren’t open for your login.')
  if (!perms.canViewCosts) throw new Error('Estimating is for logins that can see costs.')
  if (opts.admin && rankOf(perms) < RANK.admin) throw new Error('Margins are an Admin’s to set.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('That’s for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}
type Svc = Awaited<ReturnType<typeof writer>>['svc']

const refreshBook = () => revalidatePath('/costbook')
const refreshSite = (zoneId: string) => { revalidatePath(`/plans/${zoneId}/estimate`); revalidatePath(`/plans/${zoneId}/takeoff`) }

async function companySite(svc: Svc, companyId: string, zoneId: string): Promise<{ id: string; geometry: unknown } | null> {
  if (!UUID.test(zoneId)) return null
  const { data } = await svc.from('geofences').select('id, owner_id').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  if (!data || data.owner_id) return null
  const { data: g } = await svc.from('geofences_json').select('geometry').eq('id', zoneId).maybeSingle()
  return { id: String(data.id), geometry: g?.geometry ?? null }
}

// ── Materials ───────────────────────────────────────────────────────────────

export async function saveMaterialAction(input: { id?: string; name: string; unit: string; tonsPerCy?: number | null; wastePct?: number }): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const name = clip(input.name, 80)
  if (!name) return { ok: false, error: 'Name the material.' }
  if (!PRICE_UNITS.includes(input.unit as PriceUnit)) return { ok: false, error: 'Pick how it is sold.' }
  const row = { name, unit: input.unit, tons_per_cy: num(input.tonsPerCy, 0.01, 5), waste_pct: num(input.wastePct, 0, 100) ?? 0 }
  if (input.id) {
    if (!UUID.test(input.id)) return { ok: false, error: 'Bad material' }
    const { data, error } = await svc.from('cost_materials').update(row).eq('id', input.id).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (error || !data) return { ok: false, error: error?.code === '23505' ? `${name} is already in the book.` : 'Couldn’t save — try again.' }
    refreshBook()
    return { ok: true, id: input.id }
  }
  const { data, error } = await svc.from('cost_materials').insert({ ...row, company_id: companyId }).select('id').single()
  if (error || !data) return { ok: false, error: error?.code === '23505' ? `${name} is already in the book.` : 'Couldn’t save — try again.' }
  refreshBook()
  return { ok: true, id: String(data.id) }
}

export async function deleteMaterialAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(id)) return { ok: false, error: 'Bad material' }
  const now = new Date().toISOString()
  await svc.from('cost_materials').update({ deleted_at: now }).eq('id', id).eq('company_id', companyId)
  await svc.from('cost_prices').update({ deleted_at: now }).eq('material_id', id).eq('company_id', companyId)
  refreshBook()
  return { ok: true }
}

// ── Prices ──────────────────────────────────────────────────────────────────

export interface PriceInput { id?: string; placeId: string; materialId: string; price: number | null; unit: string; basis: string; minCharge?: number | null; fuelPct?: number | null; quotedOn: string; note?: string | null }

async function priceRow(svc: Svc, companyId: string, input: PriceInput): Promise<Record<string, unknown> | string> {
  if (!UUID.test(input.placeId) || !UUID.test(input.materialId)) return 'Pick a source and a material.'
  const price = num(input.price, 0, 1_000_000)
  if (price === null) return 'Give a price.'
  if (!PRICE_UNITS.includes(input.unit as PriceUnit)) return 'Pick the unit the price is per.'
  if (!DAY.test(input.quotedOn) || Number.isNaN(Date.parse(`${input.quotedOn}T00:00:00Z`)) || input.quotedOn < '2000-01-01' || input.quotedOn > '2100-01-01') return 'Give the date it was quoted.'
  const [{ data: place }, { data: mat }] = await Promise.all([
    svc.from('places').select('id').eq('id', input.placeId).eq('company_id', companyId).eq('active', true).maybeSingle(),
    svc.from('cost_materials').select('id').eq('id', input.materialId).eq('company_id', companyId).is('deleted_at', null).maybeSingle(),
  ])
  if (!place || !mat) return 'That source or material isn’t yours.'
  return {
    place_id: input.placeId, material_id: input.materialId, price, unit: input.unit,
    basis: input.basis === 'delivered' ? 'delivered' : 'pickup',
    min_charge: num(input.minCharge, 0, 10_000_000), fuel_pct: num(input.fuelPct, 0, 100),
    quoted_on: input.quotedOn, note: clip(input.note, 200) || null,
  }
}

export async function savePriceAction(input: PriceInput): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const row = await priceRow(svc, companyId, input)
  if (typeof row === 'string') return { ok: false, error: row }
  if (input.id) {
    if (!UUID.test(input.id)) return { ok: false, error: 'Bad price' }
    const { data, error } = await svc.from('cost_prices').update(row).eq('id', input.id).eq('company_id', companyId).is('deleted_at', null).select('id').maybeSingle()
    if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
    refreshBook()
    return { ok: true, id: input.id }
  }
  const { data, error } = await svc.from('cost_prices').insert({ ...row, company_id: companyId, created_by: userId }).select('id').single()
  if (error || !data) return { ok: false, error: 'Couldn’t save — try again.' }
  refreshBook()
  return { ok: true, id: String(data.id) }
}

export async function deletePriceAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(id)) return { ok: false, error: 'Bad price' }
  await svc.from('cost_prices').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId)
  refreshBook()
  return { ok: true }
}

/**
 * A price list pasted from Excel or Sheets: Source · Material · Price · Unit ·
 * Pickup/Delivered · Quoted (date) · Note. Sources must already be pins on the
 * map (they need a location to haul from); a material the book doesn't know
 * yet is added. Rows that can't be read come back with the reason.
 */
export async function importPricesAction(text: string): Promise<Res<{ added: number; skipped: { row: number; why: string }[] }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const lines = String(text ?? '').slice(0, 200_000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 501)
  if (!lines.length) return { ok: false, error: 'Paste the price list first.' }
  const split = (l: string) => (l.includes('\t') ? l.split('\t') : l.split(',')).map((c) => c.trim().replace(/^"|"$/g, ''))
  let rows = lines.map(split)
  if (/source|supplier|plant|quarry/i.test(rows[0][0] ?? '') && !/\d/.test(rows[0][2] ?? '')) rows = rows.slice(1)
  const [{ data: places }, { data: mats }] = await Promise.all([
    svc.from('places').select('id, name').eq('company_id', companyId).eq('active', true).limit(2000),
    svc.from('cost_materials').select('id, name').eq('company_id', companyId).is('deleted_at', null).limit(1000),
  ])
  const placeBy = new Map((places ?? []).map((p) => [String(p.name).toLowerCase(), String(p.id)]))
  const matBy = new Map((mats ?? []).map((m) => [String(m.name).toLowerCase(), String(m.id)]))
  const today = new Date().toISOString().slice(0, 10)
  const skipped: { row: number; why: string }[] = []
  const inserts: Record<string, unknown>[] = []
  for (let i = 0; i < rows.length && i < 500; i++) {
    const [srcName, matName, priceTxt, unitTxt, basisTxt, quoted, note] = rows[i]
    const placeId = placeBy.get((srcName ?? '').toLowerCase())
    if (!placeId) { skipped.push({ row: i + 1, why: `No place called “${clip(srcName, 40)}” on the map — drop its pin first.` }); continue }
    // An empty cell is no price — never $0, which would win "cheapest delivered" (ship-check, Nov 8).
    const priceClean = String(priceTxt ?? '').replace(/[$,\s]/g, '')
    const price = priceClean ? Number(priceClean) : NaN
    if (!(price >= 0 && price <= 1_000_000)) { skipped.push({ row: i + 1, why: 'No price.' }); continue }
    const unit = String(unitTxt ?? '').toUpperCase().replace(/^TONS?$/, 'TON').replace(/^LOADS?$/, 'LOAD').replace(/^EACH$/, 'EA') as PriceUnit
    if (!PRICE_UNITS.includes(unit)) { skipped.push({ row: i + 1, why: `Unit “${clip(unitTxt, 10)}” — use TON, CY, SY, SF, LF, EA or LOAD.` }); continue }
    const mname = clip(matName, 80)
    if (!mname) { skipped.push({ row: i + 1, why: 'No material.' }); continue }
    let materialId = matBy.get(mname.toLowerCase())
    if (!materialId) {
      const { data: m } = await svc.from('cost_materials').insert({ company_id: companyId, name: mname, unit }).select('id').single()
      if (!m) { skipped.push({ row: i + 1, why: 'Couldn’t add the material.' }); continue }
      materialId = String(m.id)
      matBy.set(mname.toLowerCase(), materialId)
    }
    const q = /^\d{4}-\d{2}-\d{2}$/.test(quoted ?? '') ? quoted! : (() => { const t = Date.parse(quoted ?? ''); return Number.isNaN(t) ? today : new Date(t).toISOString().slice(0, 10) })()
    inserts.push({
      company_id: companyId, place_id: placeId, material_id: materialId, price, unit,
      basis: /deliver/i.test(basisTxt ?? '') ? 'delivered' : 'pickup', quoted_on: q, note: clip(note, 200) || null, created_by: userId,
    })
  }
  if (inserts.length) {
    const { error } = await svc.from('cost_prices').insert(inserts)
    if (error) return { ok: false, error: 'Couldn’t save the prices — check the dates and try again.' }
  }
  refreshBook()
  return { ok: true, added: inserts.length, skipped }
}

// ── Settings and margins ────────────────────────────────────────────────────

export async function saveCostSettingsAction(settings: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ managers: true })
  const data = cleanSettings(settings)
  const { error } = await svc.from('cost_settings').upsert({ company_id: companyId, data, updated_by: userId, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refreshBook()
  return { ok: true }
}

export async function saveMarkupDefaultsAction(markups: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ admin: true })
  const { error } = await svc.from('cost_markup_defaults').upsert({ company_id: companyId, data: cleanMarkups(markups), updated_by: userId, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refreshBook()
  return { ok: true }
}

// ── Distances ───────────────────────────────────────────────────────────────

/** A site's centre: the middle of its outline. */
function centreOf(geometry: unknown): [number, number] | null {
  const ring = (geometry as { coordinates?: [number, number][][] } | null)?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 3) return null
  const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (!pts.length) return null
  return [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length]
}

/** Road miles and minutes (no traffic) from the site to every source and the shop. */
export async function refreshDistancesAction(zoneId: string): Promise<Res<{ count: number; missing: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const site = await companySite(svc, companyId, zoneId)
  if (!site) return { ok: false, error: 'Site not found' }
  const centre = centreOf(site.geometry)
  if (!centre) return { ok: false, error: 'This site has no outline to measure from.' }
  if (keyRateLimited(companyId, 'site-distances', 20, 60 * 60_000)) return { ok: false, error: 'That’s a lot of distance runs this hour — try again later.' }
  const [{ data: places }, { data: priced }] = await Promise.all([
    svc.from('places').select('id, kind, lat, lng').eq('company_id', companyId).eq('active', true).limit(2000),
    svc.from('cost_prices').select('place_id').eq('company_id', companyId).is('deleted_at', null).limit(5000),
  ])
  const pricedSet = new Set((priced ?? []).map((p) => String(p.place_id)))
  const targets = (places ?? []).filter((p) => pricedSet.has(String(p.id)) || SOURCE_KINDS.includes(String(p.kind)))
  if (!targets.length) return { ok: false, error: 'No sources on the map yet — add the quarries, plants and the shop as places.' }
  const { roadTable } = await import('@/lib/estimate/distance')
  let legs
  try {
    legs = await roadTable(centre, targets.map((p) => [Number(p.lng), Number(p.lat)] as [number, number]))
  } catch {
    return { ok: false, error: 'The routing service didn’t answer — the last distances stand. Try again in a minute.' }
  }
  const now = new Date().toISOString()
  const rows = targets.flatMap((p, i) => {
    const l = legs[i]
    return l ? [{ company_id: companyId, geofence_id: site.id, place_id: String(p.id), miles: l.miles, minutes: l.minutes, source: 'road', computed_at: now }] : []
  })
  if (rows.length) {
    const { error } = await svc.from('site_distances').upsert(rows, { onConflict: 'geofence_id,place_id' })
    if (error) return { ok: false, error: 'Couldn’t save the distances — try again.' }
  }
  refreshSite(site.id)
  return { ok: true, count: rows.length, missing: targets.length - rows.length }
}

// ── The estimate ────────────────────────────────────────────────────────────

const lineId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)
const UNIT_OF: Record<string, LineUnit> = { LF: 'LF', SF: 'SF', SY: 'SY', AC: 'AC', EA: 'EA', CY: 'CY', TON: 'TON' }

/**
 * Start a site's estimate from its takeoff — live, or a frozen snapshot — one
 * line per item, plus mobilization. Markups start at the company defaults.
 */
export async function createEstimateAction(zoneId: string, snapshotId: string | null = null): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const site = await companySite(svc, companyId, zoneId)
  if (!site) return { ok: false, error: 'Site not found' }
  const { buildTakeoff } = await import('@/lib/takeoff-summary')
  const t = await buildTakeoff(svc, companyId, site.id, false)
  if (!t) return { ok: false, error: 'Site not found' }
  let rows: { code: string; name: string; unit: string; qty: number; section: string | null; wastePct: number }[] = t.rows.map((r) => ({ code: r.code, name: r.name, unit: r.unit, qty: r.qty, section: r.section, wastePct: r.wastePct }))
  let label = `Estimate · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  if (snapshotId) {
    if (!UUID.test(snapshotId)) return { ok: false, error: 'Bad snapshot' }
    const { data: snap } = await svc.from('takeoff_snapshots').select('name, data').eq('id', snapshotId).eq('company_id', companyId).eq('geofence_id', site.id).is('deleted_at', null).maybeSingle()
    if (!snap) return { ok: false, error: 'Snapshot not found' }
    const items = ((snap.data as { items?: { code: string; name: string; unit: string; qty: number }[] })?.items ?? []).slice(0, 400)
    const live = new Map(rows.map((r) => [r.code, r]))
    rows = items.map((i) => ({ code: i.code, name: i.name, unit: i.unit, qty: Number(i.qty) || 0, section: live.get(i.code)?.section ?? null, wastePct: live.get(i.code)?.wastePct ?? 0 }))
    label = `Estimate · ${clip(snap.name, 90)}`
  }
  // Each item's section depth turns its area into the volume a material is sold by.
  const { data: items } = await svc.from('takeoff_items').select('code, depth_in').eq('company_id', companyId).is('deleted_at', null).limit(1000)
  const depthOf = new Map((items ?? []).map((i) => [String(i.code), (i.depth_in as number | null) ?? null]))
  // A layered item ("3\" on 8\" stone") becomes a line per layer, each with its own depth.
  const lines: Line[] = rows.flatMap((r) => {
    const depth = depthOf.get(r.code) ?? null
    const base = {
      section: r.section, code: r.code, unit: UNIT_OF[r.unit] ?? 'EA', qty: r.qty, materialId: null, placeId: null,
      wastePct: r.wastePct > 0 ? r.wastePct : null, crewKey: null, perDay: null, subUnit: null, lowboyTrips: null, note: null,
    }
    const layers = layersOf(r.name, depth)
    if (!layers) return [{ ...base, id: lineId(), name: r.name, depthIn: depth }]
    return layers.map((d, k) => ({
      ...base, id: lineId(), depthIn: d,
      name: `${r.name} — ${layers.length === 2 ? (k === 0 ? 'top' : 'base') : `layer ${k + 1}`} ${d}″`,
    }))
  })
  lines.unshift({ id: lineId(), section: 'General', code: 'MOB', name: 'Mobilization', unit: 'LS', qty: 1, depthIn: null, materialId: null, placeId: null, wastePct: null, crewKey: null, perDay: null, subUnit: null, lowboyTrips: 2, note: null })
  const { data: est, error } = await svc.from('estimates').insert({
    company_id: companyId, geofence_id: site.id, name: label, snapshot_id: snapshotId, lines: cleanLines(lines), created_by: userId,
  }).select('id').single()
  if (error || !est) return { ok: false, error: 'Couldn’t start the estimate — try again.' }
  const { data: d } = await svc.from('cost_markup_defaults').select('data').eq('company_id', companyId).maybeSingle()
  const { error: mkErr } = await svc.from('estimate_markups').insert({ estimate_id: est.id, company_id: companyId, data: cleanMarkups(d?.data ?? {}) })
  if (mkErr) {
    // Without its margins row the bid would read 0% overhead and profit — take it back and say so.
    await svc.from('estimates').update({ deleted_at: new Date().toISOString() }).eq('id', est.id).eq('company_id', companyId)
    return { ok: false, error: 'Couldn’t start the estimate — try again.' }
  }
  refreshSite(site.id)
  return { ok: true, id: String(est.id) }
}

/** Save the estimate's lines (and its name or status). */
export async function saveEstimateAction(id: string, patch: { name?: string; status?: string; lines?: unknown }): Promise<Res<{ savedAt: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(id)) return { ok: false, error: 'Bad estimate' }
  const { data: cur } = await svc.from('estimates').select('id, geofence_id').eq('id', id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!cur) return { ok: false, error: 'Estimate not found' }
  const savedAt = new Date().toISOString()
  const upd: Record<string, unknown> = { updated_at: savedAt }
  if (patch.name !== undefined) { const n = clip(patch.name, 120); if (!n) return { ok: false, error: 'Name the estimate.' }; upd.name = n }
  if (patch.status !== undefined) {
    if (!['draft', 'sent', 'won', 'lost'].includes(String(patch.status))) return { ok: false, error: 'Bad status' }
    upd.status = patch.status
  }
  if (patch.lines !== undefined) {
    const lines = cleanLines(patch.lines)
    // Ids from another company never resolve; keep the record clean of them.
    const matIds = Array.from(new Set(lines.map((l) => l.materialId).filter((x): x is string => !!x)))
    const placeIds = Array.from(new Set(lines.map((l) => l.placeId).filter((x): x is string => !!x)))
    const [{ data: ms }, { data: ps }] = await Promise.all([
      matIds.length ? svc.from('cost_materials').select('id').in('id', matIds).eq('company_id', companyId) : Promise.resolve({ data: [] as { id: string }[] }),
      placeIds.length ? svc.from('places').select('id').in('id', placeIds).eq('company_id', companyId) : Promise.resolve({ data: [] as { id: string }[] }),
    ])
    const okM = new Set((ms ?? []).map((m) => String(m.id))), okP = new Set((ps ?? []).map((p) => String(p.id)))
    upd.lines = lines.map((l) => ({ ...l, materialId: l.materialId && okM.has(l.materialId) ? l.materialId : null, placeId: l.placeId && okP.has(l.placeId) ? l.placeId : null }))
  }
  const { error } = await svc.from('estimates').update(upd).eq('id', id).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refreshSite(String(cur.geofence_id))
  return { ok: true, savedAt }
}

export async function saveEstimateMarkupsAction(id: string, markups: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ admin: true })
  if (!UUID.test(id)) return { ok: false, error: 'Bad estimate' }
  const { data: cur } = await svc.from('estimates').select('id, geofence_id').eq('id', id).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!cur) return { ok: false, error: 'Estimate not found' }
  const { error } = await svc.from('estimate_markups').upsert({ estimate_id: id, company_id: companyId, data: cleanMarkups(markups), updated_by: userId, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refreshSite(String(cur.geofence_id))
  return { ok: true }
}

export async function deleteEstimateAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (!UUID.test(id)) return { ok: false, error: 'Bad estimate' }
  const { data } = await svc.from('estimates').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId).select('geofence_id').maybeSingle()
  if (data) refreshSite(String(data.geofence_id))
  return { ok: true }
}
