'use server'

import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import { addDaysKey, isDayKey } from '@/lib/dates'
import {
  PILOT_DAYS, PUMP_PRICE_MAX, PUMP_PRICE_MIN, cleanSettings, localToUtcMs, mergeSettings, parseFuelCsv, parseMerchant, parseTimeCell, pumpPriceOk, samePurchase,
  type FuelField, type FuelProduct, type PilotSettings, type Verdict,
} from '@/lib/fuel-check'
import {
  companyToday, enrichPatch, matchBook, mirrorFuelExpenses, rowFromDraft, runFuelCheck, type TxnRow,
} from '@/lib/db/fuel-check'

/**
 * The fuel reconciliation pilot's writes (migration 130). Every one needs the
 * Receipts view level, the $ figures (the page is money) and the edit
 * ability; none works inside a view-as preview. The tables have no write
 * policies — writes go through the service client after these checks, and
 * anything a write points at (a vehicle, a purchase, an exception) is first
 * read through the CALLER's session, so RLS decides whether they may touch it.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PATH = '/receipts/fuel'

type Guarded = { ok: true; companyId: string; userId: string } | { ok: false; error: string }

async function guard(): Promise<Guarded> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  if (!perms.features.includes('receipts') || !perms.canViewCosts) return { ok: false, error: 'The fuel check needs the Receipts page and the $ figures.' }
  if (!perms.canEdit) return { ok: false, error: 'Your role can view this but not change it.' }
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return { ok: false, error: 'Sign in first.' }
  const companyId = await getCurrentCompanyId()
  if (!companyId) return { ok: false, error: 'No company.' }
  return { ok: true, companyId, userId: user.id }
}

async function clients() {
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  return { db: createClient(), svc: createServiceClient() }
}

/** A vehicle the caller may see (RLS — the visibility ladder included) and that belongs to the company. */
async function visibleAsset(assetId: string, companyId: string): Promise<{ id: string; name: string; metadata: unknown } | null> {
  if (!UUID.test(assetId)) return null
  const { db } = await clients()
  const { data } = await db.from('assets').select('id, name, metadata, company_id, type').eq('id', assetId).maybeSingle()
  const a = data as { id: string; name: string; metadata: unknown; company_id: string; type: string } | null
  return a && a.company_id === companyId && (a.type === 'vehicle' || a.type === 'equipment' || a.type === 'personnel') ? a : null
}

async function ensurePilot(companyId: string, userId: string, todayKey: string) {
  const { svc } = await clients()
  const { data } = await svc.from('fuel_pilot').select('company_id, started_on').eq('company_id', companyId).maybeSingle()
  if (!data) await svc.from('fuel_pilot').insert({ company_id: companyId, started_on: todayKey, updated_by: userId })
  else if (!(data as { started_on: string | null }).started_on) await svc.from('fuel_pilot').update({ started_on: todayKey, updated_by: userId, updated_at: new Date().toISOString() }).eq('company_id', companyId)
}

export interface FuelImportResult {
  ok: boolean
  error?: string
  imported?: number
  enriched?: number
  duplicates?: number
  skipped?: number
  checked?: number
  remaining?: number
  unplaced?: number
}

/**
 * Import a fuel-card or bank/card export. Parsed with the same function the
 * preview ran (and the preview's column choices), deduped against what is
 * already in (re-importing the same export adds nothing), linked to a
 * purchase that came in by another door instead of doubling it, then placed
 * and checked as far as ~35 seconds allow — the nightly run finishes the rest.
 */
export async function importFuelCsvAction(text: string, mapping: (FuelField | null)[] | null): Promise<FuelImportResult> {
  const g = await guard()
  if (!g.ok) return g
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Paste the export or pick the CSV file first.' }
  if (text.length > 3_000_000) return { ok: false, error: 'That export is over 3 MB — export a shorter date range and import it in parts.' }
  if (keyRateLimited(g.userId, 'fuel-import', 8, 10 * 60_000)) return { ok: false, error: 'That is a lot of imports in a row — give it a few minutes.' }
  const { db, svc } = await clients()
  const { data: co } = await svc.from('companies').select('digest_prefs').eq('id', g.companyId).maybeSingle()
  const { tz, todayKey } = companyToday((co as { digest_prefs?: unknown } | null)?.digest_prefs)
  const parsed = parseFuelCsv(text, { tz, mapping: Array.isArray(mapping) ? mapping : null })
  if (!parsed.rows.length) return { ok: false, error: parsed.warnings[0] ?? 'No fuel purchases found in that export.', skipped: parsed.skipped.length }

  // Match the export's vehicle / driver / job columns — vehicles the caller can see only.
  const [assetsRes, peopleRes, zonesRes] = await Promise.all([
    db.from('assets').select('id, name, type, serial, metadata').eq('company_id', g.companyId).eq('active', true).limit(2000),
    svc.from('profiles').select('id, name, role').eq('company_id', g.companyId).limit(1000),
    svc.from('geofences').select('id, name').eq('company_id', g.companyId).is('owner_id', null).limit(500),
  ])
  const book = matchBook(
    (assetsRes.data ?? []) as { id: string; name: string; type: string; serial: string | null; metadata: unknown }[],
    ((peopleRes.data ?? []) as { id: string; name: string | null; role: string | null }[]).filter((p) => p.role !== 'prospect'),
    (zonesRes.data ?? []) as { id: string; name: string }[],
  )

  const days = parsed.rows.map((r) => r.txnDate).sort()
  const { data: have, error: haveErr } = await svc.from('fuel_transactions')
    .select('id, source, dedupe_key, alt_keys, expense_id, txn_at, txn_date, has_time, brand, amount, card_last4, gallons, gallons_estimated, unit_price, product, driver_text, vehicle_text, job_text, odometer, address, city, state, zip, geocode_source, cardholder_user_id')
    .eq('company_id', g.companyId).gte('txn_date', addDaysKey(days[0], -1)).lte('txn_date', addDaysKey(days[days.length - 1], 1)).limit(10000)
  if (haveErr) return { ok: false, error: haveErr.code === '42P01' ? 'The database is still updating for this page — try again in a few minutes.' : 'Could not read what is already imported. Try again.' }
  const existing = (have ?? []) as unknown as TxnRow[]
  const keys = new Set<string>()
  for (const t of existing) { keys.add(t.dedupe_key); for (const k of t.alt_keys ?? []) keys.add(k) }

  let duplicates = 0, enriched = 0
  const touched: string[] = []
  const inserts: Record<string, unknown>[] = []
  const claimed = new Set<string>()
  for (const d of parsed.rows) {
    if (keys.has(d.dedupeKey)) { duplicates++; continue }
    keys.add(d.dedupeKey)
    // The same purchase already in by another door (a card alert, typed by hand)?
    const twin = existing.find((t) => t.source !== 'csv' && !claimed.has(t.id) && samePurchase(
      { txnDate: d.txnDate, amount: d.amount, cardLast4: d.cardLast4, txnAtMs: d.txnAtMs, brand: d.brand },
      { txnDate: t.txn_date, amount: Number(t.amount), cardLast4: t.card_last4, txnAtMs: t.has_time && t.txn_at ? Date.parse(t.txn_at) : null, brand: t.brand },
    ))
    if (twin) {
      claimed.add(twin.id)
      const { error } = await svc.from('fuel_transactions').update(enrichPatch(twin, d)).eq('id', twin.id).eq('company_id', g.companyId)
      if (!error) { enriched++; touched.push(twin.id) }
      continue
    }
    inserts.push(rowFromDraft(d, {
      companyId: g.companyId, userId: g.userId,
      assetId: book.vehicle(d.vehicle), cardholderUserId: book.person(d.driver), geofenceId: book.site(d.job),
    }))
  }
  let imported = 0
  for (let i = 0; i < inserts.length; i += 200) {
    const { data, error } = await svc.from('fuel_transactions')
      .upsert(inserts.slice(i, i + 200), { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true }).select('id')
    if (error) {
      console.error('fuel import insert failed:', error.message)
      return { ok: false, error: imported ? `Imported ${imported}, then the database refused the rest — try again.` : 'The database refused the import — try again in a minute.' }
    }
    imported += (data ?? []).length
    touched.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
  }
  await ensurePilot(g.companyId, g.userId, todayKey)
  // Card alerts already in the receipt chase join the pilot on their own.
  await mirrorFuelExpenses(svc, g.companyId, days[0])
  const run = touched.length ? await runFuelCheck(svc, g.companyId, { ids: touched, budgetMs: 35_000, geocodeCalls: 24 }) : null
  revalidatePath(PATH)
  return {
    ok: true, imported, enriched, duplicates, skipped: parsed.skipped.length,
    checked: run?.checked ?? 0, remaining: (run?.remaining ?? 0) + Math.max(0, touched.length - (run?.checked ?? 0) - (run?.remaining ?? 0)),
    unplaced: run?.unplaced ?? 0,
  }
}

/** Card → vehicle from a date on (null = no vehicle from that date). Re-checks that card's purchases. */
export async function assignFuelCardAction(last4: string, assetId: string | null, validFrom: string): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return g
  if (!/^\d{4}$/.test(String(last4))) return { ok: false, error: 'A card is its last four digits.' }
  if (!isDayKey(validFrom)) return { ok: false, error: 'Pick the date the card started fueling this vehicle.' }
  if (assetId && !(await visibleAsset(assetId, g.companyId))) return { ok: false, error: 'That vehicle is not on this account.' }
  const { svc } = await clients()
  const { error } = await svc.from('fuel_card_assets').upsert({
    company_id: g.companyId, last4, asset_id: assetId, valid_from: validFrom, created_by: g.userId,
  }, { onConflict: 'company_id,last4,valid_from' })
  if (error) return { ok: false, error: error.code === '42P01' ? 'The database is still updating for this page — try again in a few minutes.' : 'Could not save that. Try again.' }
  const { data: ids } = await svc.from('fuel_transactions').select('id').eq('company_id', g.companyId).eq('card_last4', last4)
    .gte('txn_date', validFrom).eq('excluded', false).limit(300)
  if (ids?.length) await runFuelCheck(svc, g.companyId, { ids: (ids as { id: string }[]).map((r) => r.id), budgetMs: 20_000, geocodeCalls: 6 })
  revalidatePath(PATH)
  return { ok: true }
}

/** Tank size in gallons, written where every fuel reader already looks
 *  (assets.metadata.fuel_tank_gal — lib/asset-stats tankGallonsFrom, so Ask
 *  AI's gallons answers use it too). Through the caller's session: the
 *  asset's own policies decide. */
export async function setTankSizeAction(assetId: string, gallons: number | null): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return g
  if (gallons != null && !(Number.isFinite(gallons) && gallons >= 3 && gallons <= 400)) return { ok: false, error: 'A fuel tank is between 3 and 400 gallons.' }
  const a = await visibleAsset(assetId, g.companyId)
  if (!a) return { ok: false, error: 'That vehicle is not on this account.' }
  const { db, svc } = await clients()
  const next: Record<string, unknown> = { ...((a.metadata as Record<string, unknown> | null) ?? {}) }
  if (gallons == null) delete next.fuel_tank_gal
  else next.fuel_tank_gal = Math.round(gallons * 10) / 10
  const { error } = await db.from('assets').update({ metadata: next }).eq('id', assetId)
  if (error) return { ok: false, error: 'Could not save the tank size.' }
  const { data: ids } = await svc.from('fuel_transactions').select('id').eq('company_id', g.companyId).eq('asset_id', assetId).eq('excluded', false)
    .order('txn_date', { ascending: false }).limit(200)
  if (ids?.length) await runFuelCheck(svc, g.companyId, { ids: (ids as { id: string }[]).map((r) => r.id), budgetMs: 15_000, geocodeCalls: 4 })
  revalidatePath(PATH)
  revalidatePath(`/assets/${assetId}`)
  return { ok: true }
}

/**
 * The pilot's settings. A box left blank, zero or negative KEEPS its saved
 * value — Number('') is 0, and a cleared price box used to save the $0.50
 * floor, which turned every $60 fill into "120 gal" and flagged it. Same for
 * a blank start date. Answers with what is now saved.
 */
export async function saveFuelPilotAction(input: Partial<PilotSettings> & { startedOn?: string | null }): Promise<{ ok: boolean; error?: string; settings?: PilotSettings & { startedOn: string | null } }> {
  const g = await guard()
  if (!g.ok) return g
  const startedOn = typeof input?.startedOn === 'string' && input.startedOn.trim() ? input.startedOn.trim() : null
  if (startedOn != null && !isDayKey(startedOn)) return { ok: false, error: 'Pick the day the pilot started.' }
  const { svc } = await clients()
  const { data: cur, error: readErr } = await svc.from('fuel_pilot').select('started_on, gas_price, diesel_price, area_miles, runtime_hours')
    .eq('company_id', g.companyId).maybeSingle()
  if (readErr) return { ok: false, error: readErr.code === '42P01' ? 'The database is still updating for this page — try again in a few minutes.' : 'Could not read the pilot settings. Try again.' }
  const c = cur as { started_on: string | null; gas_price: unknown; diesel_price: unknown; area_miles: unknown; runtime_hours: unknown } | null
  const stored = cleanSettings(c ? { gasPrice: c.gas_price, dieselPrice: c.diesel_price, areaMiles: c.area_miles, runtimeHours: c.runtime_hours } : null)
  const s = mergeSettings(stored, input)
  if (!pumpPriceOk(s.gasPrice) || !pumpPriceOk(s.dieselPrice)) {
    return { ok: false, error: `A pump price is between $${PUMP_PRICE_MIN.toFixed(2)} and $${PUMP_PRICE_MAX.toFixed(2)} a gallon.` }
  }
  const { error } = await svc.from('fuel_pilot').upsert({
    company_id: g.companyId, gas_price: s.gasPrice, diesel_price: s.dieselPrice, area_miles: s.areaMiles, runtime_hours: s.runtimeHours,
    ...(startedOn ? { started_on: startedOn } : {}),
    updated_by: g.userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id' })
  if (error) return { ok: false, error: 'Could not save the pilot settings.' }
  revalidatePath(PATH)
  return { ok: true, settings: { ...s, startedOn: startedOn ?? c?.started_on ?? null } }
}

/** Re-check the last N days now (the nightly run does the last 14 on its own). */
export async function recheckFuelAction(days: number): Promise<{ ok: boolean; error?: string; checked?: number; remaining?: number; exceptions?: number; unplaced?: number }> {
  const g = await guard()
  if (!g.ok) return g
  if (keyRateLimited(g.userId, 'fuel-recheck', 6, 10 * 60_000)) return { ok: false, error: 'Checked a lot just now — give it a few minutes.' }
  const n = Math.min(PILOT_DAYS, Math.max(1, Math.round(Number(days) || 14)))
  const { svc } = await clients()
  const { data: co } = await svc.from('companies').select('digest_prefs').eq('id', g.companyId).maybeSingle()
  const { todayKey } = companyToday((co as { digest_prefs?: unknown } | null)?.digest_prefs)
  const since = addDaysKey(todayKey, -n)
  await mirrorFuelExpenses(svc, g.companyId, since)
  const r = await runFuelCheck(svc, g.companyId, { sinceKey: since, budgetMs: 40_000, geocodeCalls: 24 })
  revalidatePath(PATH)
  return { ok: true, checked: r.checked, remaining: r.remaining, exceptions: r.exceptions, unplaced: r.unplaced }
}

/** Valid / False alarm / Unsure (null clears it) + a note. The ONLY writer of the verdict columns. */
export async function setFuelVerdictAction(exceptionId: string, verdict: Verdict | null, note?: string | null): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return g
  if (!UUID.test(String(exceptionId))) return { ok: false, error: 'Unknown exception.' }
  if (verdict !== null && !['valid', 'false', 'unsure'].includes(verdict)) return { ok: false, error: 'Unknown verdict.' }
  const { db, svc } = await clients()
  const { data: seen } = await db.from('fuel_exceptions').select('id').eq('id', exceptionId).eq('company_id', g.companyId).maybeSingle()
  if (!seen) return { ok: false, error: 'That exception is not on this account.' }
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) || null : null
  const { error } = await svc.from('fuel_exceptions').update(verdict
    ? { verdict, verdict_by: g.userId, verdict_at: new Date().toISOString(), verdict_note: cleanNote }
    : { verdict: null, verdict_by: null, verdict_at: null, verdict_note: null }).eq('id', exceptionId).eq('company_id', g.companyId)
  if (error) return { ok: false, error: 'Could not save that. Try again.' }
  revalidatePath(PATH)
  return { ok: true }
}

/** "Not a fuel purchase" (the store, not the pump) — out of every check and number; reversible. */
export async function excludeFuelTxnAction(txnId: string, excluded: boolean, reason?: string | null): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return g
  if (!UUID.test(String(txnId))) return { ok: false, error: 'Unknown purchase.' }
  const { db, svc } = await clients()
  const { data: seen } = await db.from('fuel_transactions').select('id').eq('id', txnId).eq('company_id', g.companyId).maybeSingle()
  if (!seen) return { ok: false, error: 'That purchase is not on this account.' }
  const { error } = await svc.from('fuel_transactions').update({
    excluded: !!excluded, excluded_reason: excluded ? (typeof reason === 'string' ? reason.trim().slice(0, 200) || 'Not a fuel purchase' : 'Not a fuel purchase') : null,
  }).eq('id', txnId).eq('company_id', g.companyId)
  if (error) return { ok: false, error: 'Could not save that. Try again.' }
  revalidatePath(PATH)
  return { ok: true }
}

/** Read this one purchase against a different vehicle (null = back to the card's). */
export async function setFuelTxnVehicleAction(txnId: string, assetId: string | null): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return g
  if (!UUID.test(String(txnId))) return { ok: false, error: 'Unknown purchase.' }
  if (assetId && !(await visibleAsset(assetId, g.companyId))) return { ok: false, error: 'That vehicle is not on this account.' }
  const { db, svc } = await clients()
  const { data: seen } = await db.from('fuel_transactions').select('id').eq('id', txnId).eq('company_id', g.companyId).maybeSingle()
  if (!seen) return { ok: false, error: 'That purchase is not on this account.' }
  const { error } = await svc.from('fuel_transactions').update(assetId ? { asset_id: assetId, asset_source: 'row' } : { asset_id: null, asset_source: null })
    .eq('id', txnId).eq('company_id', g.companyId)
  if (error) return { ok: false, error: 'Could not save that. Try again.' }
  await runFuelCheck(svc, g.companyId, { ids: [txnId], budgetMs: 15_000, geocodeCalls: 4 })
  revalidatePath(PATH)
  return { ok: true }
}

/** One purchase typed by hand (a receipt in the truck, a card nobody exports). */
export async function addFuelTxnAction(input: {
  date: string; time?: string | null; merchant: string; address?: string | null; city?: string | null; state?: string | null
  amount: number; gallons?: number | null; product?: FuelProduct | null; last4?: string | null; assetId?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const g = await guard()
  if (!g.ok) return g
  if (!isDayKey(input.date)) return { ok: false, error: 'Pick the date of the purchase.' }
  const merchant = String(input.merchant ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!merchant) return { ok: false, error: 'Name the station.' }
  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!(amount > 0 && amount <= 20_000)) return { ok: false, error: 'Enter the amount paid.' }
  const gallons = input.gallons == null || !Number.isFinite(Number(input.gallons)) ? null : Number(input.gallons)
  if (gallons != null && !(gallons > 0 && gallons < 2000)) return { ok: false, error: 'Gallons look wrong.' }
  const minutes = input.time ? parseTimeCell(input.time) : null
  if (input.time && minutes == null) return { ok: false, error: 'That time doesn\'t read — try 7:42 AM.' }
  const last4 = input.last4 ? String(input.last4).replace(/\D/g, '') : ''
  if (last4 && last4.length !== 4) return { ok: false, error: 'A card is its last four digits.' }
  if (input.assetId && !(await visibleAsset(input.assetId, g.companyId))) return { ok: false, error: 'That vehicle is not on this account.' }
  const product = input.product && ['diesel', 'gas', 'def', 'other'].includes(input.product) ? input.product : null
  const state = input.state ? String(input.state).trim().toUpperCase().slice(0, 2) : null
  const { svc } = await clients()
  const { data: co } = await svc.from('companies').select('digest_prefs').eq('id', g.companyId).maybeSingle()
  const { tz, todayKey } = companyToday((co as { digest_prefs?: unknown } | null)?.digest_prefs)
  if (input.date > todayKey) return { ok: false, error: 'That date is in the future.' }
  const parts = parseMerchant(merchant)
  const atMs = minutes != null ? localToUtcMs(input.date, minutes, tz) : null
  const key = `man:${input.date}|${minutes ?? ''}|${Math.round(amount * 100)}|${last4}|${merchant.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}`
  const { data, error } = await svc.from('fuel_transactions').upsert({
    company_id: g.companyId, source: 'manual', dedupe_key: key,
    txn_at: atMs != null ? new Date(atMs).toISOString() : null, txn_date: input.date, has_time: atMs != null,
    merchant, brand: parts.brand, store_no: parts.storeNo, address: input.address?.trim().slice(0, 160) || null,
    city: input.city?.trim().slice(0, 80) || null, state: state && /^[A-Z]{2}$/.test(state) ? state : parts.state,
    city_candidates: input.city ? [] : parts.cityCandidates.slice(0, 3),
    gallons, gallons_estimated: false, amount, product, card_last4: last4 || null,
    asset_id: input.assetId || null, asset_source: input.assetId ? 'row' : null, created_by: g.userId,
  }, { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true }).select('id')
  if (error) return { ok: false, error: error.code === '42P01' ? 'The database is still updating for this page — try again in a few minutes.' : 'Could not save that purchase.' }
  await ensurePilot(g.companyId, g.userId, todayKey)
  const id = ((data ?? []) as { id: string }[])[0]?.id
  if (id) await runFuelCheck(svc, g.companyId, { ids: [id], budgetMs: 20_000, geocodeCalls: 6 })
  revalidatePath(PATH)
  return id ? { ok: true } : { ok: false, error: 'That purchase is already in.' }
}
