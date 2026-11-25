'use server'

/**
 * Bid history writes (migration 165, pricing engine v0 — "price through
 * winning bids"). Members hold SELECT only on `bid_items` (and never its
 * `unit_cost`), so every write runs on the service role AFTER the same checks
 * as the estimate (edit + plans + COSTS), company pinned on every row. A bid's
 * lines are FROZEN here once, when it goes out, from the estimate as the
 * server computes it — the cost book, the road distances, the estimate's own
 * markups — never from numbers a device sends. The frozen rows carry the
 * margins, so they read Admin-only (migration 166); these actions only write.
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import { allRows } from '@/lib/db/paged'
import { bidRowSig, freezeStep, fromEstimate, frozenBidTotal, lowUnitFromTotal, outcomeRows, parseBidPaste, type BidResult } from '@/lib/pricing/rates'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const COMPANY_CAP = 20_000
const IMPORT_CAP = 5_000
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function writer(opts: { managers?: boolean } = {}) {
  const perms = await requireEditOrThrow()
  if (perms.viewingAs) throw new Error('Read-only preview — exit View as to make changes.')
  if (isProspect(perms)) throw new Error('Not for this login.')
  if (!perms.features.includes('plans')) throw new Error('Plans aren’t open for your login.')
  if (!perms.canViewCosts) throw new Error('Bid history is for logins that can see costs.')
  if (opts.managers && rankOf(perms) < RANK.manager) throw new Error('That’s for Managers and above.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { perms, companyId, userId: user?.id ?? null, svc: createServiceClient() }
}
type W = Awaited<ReturnType<typeof writer>>

const today = () => new Date().toISOString().slice(0, 10)
const validDay = (s: unknown): s is string => typeof s === 'string' && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && s >= '1990-01-01' && s <= '2100-01-01'

type LiveRow = { id: string; unit_price: number; qty: number | null }

/** Soft-delete a set of rows by id (chunked). */
async function dropIds(w: W, ids: string[]) {
  const at = new Date().toISOString()
  for (let i = 0; i < ids.length; i += 200) {
    await w.svc.from('bid_items').update({ deleted_at: at }).in('id', ids.slice(i, i + 200)).eq('company_id', w.companyId).is('deleted_at', null)
  }
}

/**
 * An estimate's status → its frozen lines (`freezeStep` in lib/pricing/rates):
 * frozen ONCE when it goes out (or the first time nothing is frozen yet), so
 * Won / Lost later keep the prices that went out — those only re-mark the
 * result and the low bidder's level from the stored lines; Draft removes
 * them; `resend` (a revised bid) freezes again. A freeze inserts its rows
 * stamped with one time and then removes every OLDER live row of the
 * estimate, and stands down if a NEWER freeze landed meanwhile — the last
 * freeze wins, never two sets.
 */
async function freeze(w: W, estimateId: string, opts: { resend?: boolean } = {}): Promise<Res<{ items: number }>> {
  const { companyId, userId, svc, perms } = w
  const { data: est } = await svc.from('estimates').select('id, geofence_id, status, bid_on, low_bid, lines')
    .eq('id', estimateId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!est) return { ok: false, error: 'Estimate not found' }
  const { data: live } = await svc.from('bid_items').select('id, unit_price, qty').eq('estimate_id', estimateId).eq('company_id', companyId).is('deleted_at', null).limit(5000)
  const liveRows = (live ?? []) as LiveRow[]
  const status = String(est.status)
  const zoneId = String(est.geofence_id)
  const done = (items: number): Res<{ items: number }> => {
    revalidatePath('/costbook', 'layout')
    revalidatePath(`/plans/${zoneId}/estimate`)
    return { ok: true, items }
  }
  const step = freezeStep(status, liveRows.length, opts)
  if (step === 'drop') { await dropIds(w, liveRows.map((r) => String(r.id))); return done(0) } // back to draft: not a bid any more
  const lowBid = status === 'lost' && est.low_bid !== null && est.low_bid !== undefined ? Number(est.low_bid) : null

  if (step === 'outcome') {
    // Won / Lost / back to Sent: the result and the low level from the STORED prices — never re-priced.
    const ups = outcomeRows(liveRows.map((r) => ({ id: String(r.id), unitPrice: Number(r.unit_price), qty: r.qty === null ? null : Number(r.qty) })), status, lowBid)
    const bidOn = validDay(est.bid_on) ? String(est.bid_on) : null
    // Rows sharing a low level go in one update (with no low bid, that is all of them).
    const groups = new Map<string, string[]>()
    for (const u of ups) {
      const k = u.lowUnitPrice === null ? '' : String(u.lowUnitPrice)
      const a = groups.get(k); if (a) a.push(u.id); else groups.set(k, [u.id])
    }
    const result = ups[0]?.result ?? 'pending'
    const entries = Array.from(groups.entries())
    for (let i = 0; i < entries.length; i += 10) {
      const res = await Promise.all(entries.slice(i, i + 10).map(async ([k, ids]) => {
        for (let j = 0; j < ids.length; j += 200) {
          const { error } = await svc.from('bid_items').update({ result, low_unit_price: k === '' ? null : Number(k), ...(bidOn ? { bid_on: bidOn } : {}) })
            .in('id', ids.slice(j, j + 200)).eq('company_id', companyId).is('deleted_at', null)
          if (error) return false
        }
        return true
      }))
      if (res.some((x) => !x)) return { ok: false, error: 'Couldn’t record the result on the bid’s prices — try again.' }
    }
    return done(ups.length)
  }

  // Freeze: price the lines as the server computes them now.
  const [E, { getCostBook }] = await Promise.all([import('@/lib/estimate/engine'), import('@/lib/db/estimate')])
  const [book, { data: dq }, { data: mk }, { data: fence }, { data: job }] = await Promise.all([
    getCostBook(rankOf(perms) >= RANK.admin),
    svc.from('site_distances').select('place_id, miles, minutes, source').eq('geofence_id', zoneId).eq('company_id', companyId).limit(500),
    // The estimate's own margins, read here whatever the caller's rank: the frozen price is the bid that went out.
    svc.from('estimate_markups').select('data').eq('estimate_id', estimateId).eq('company_id', companyId).maybeSingle(),
    svc.from('geofences').select('name').eq('id', zoneId).eq('company_id', companyId).maybeSingle(),
    svc.from('jobs').select('customer').eq('geofence_id', zoneId).eq('company_id', companyId).maybeSingle(),
  ])
  if (!book.available) return { ok: false, error: 'The cost book isn’t ready on this database yet.' }
  const dist = new Map<string, import('@/lib/estimate/engine').Distance>()
  for (const r of dq ?? []) dist.set(String(r.place_id), { miles: Number(r.miles), minutes: Number(r.minutes), source: r.source === 'fleet' ? 'fleet' : 'road' })
  const shopSrc = book.sources.find((x) => x.kind === 'shop' && dist.has(x.id))
  const ctx = { materials: book.materials, prices: book.prices, sources: book.sources, distances: dist, settings: book.settings, shop: shopSrc ? dist.get(shopSrc.id)! : null }
  const lines = E.cleanLines(est.lines)
  const costs = lines.map((line) => E.lineCost(line, ctx))
  const t = E.totals(lines.map((line, i) => ({ line, cost: costs[i] })), E.cleanMarkups(mk?.data ?? {}))
  const frozen = fromEstimate({ lines, costs, totals: t })
  const result: BidResult = status === 'won' ? 'won' : status === 'lost' ? 'lost' : 'pending'
  const bidOn = validDay(est.bid_on) ? String(est.bid_on) : today()
  const jobName = String(fence?.name ?? 'Estimate').slice(0, 160) || 'Estimate'
  const customer = job?.customer ? String(job.customer).slice(0, 160) : null
  const cap = (v: number) => Math.min(10_000_000, Math.max(0, v))
  const kept = frozen.filter((f) => f.unitPrice <= 10_000_000)
  const ours = frozenBidTotal(kept.map((f) => ({ unitPrice: cap(f.unitPrice), qty: f.qty })))
  const stamp = new Date().toISOString()
  const rows = kept.map((f) => ({
    company_id: companyId, estimate_id: estimateId, source: 'estimate', bid_on: bidOn, job_name: jobName, customer,
    item_key: f.itemKey, item_name: f.itemName, unit: f.unit.slice(0, 10) || 'EA', qty: f.qty,
    unit_price: cap(f.unitPrice), unit_cost: cap(f.unitCost), result,
    low_unit_price: lowBid !== null ? lowUnitFromTotal(cap(f.unitPrice), ours, lowBid) : null,
    created_by: userId, created_at: stamp,
  }))
  if (rows.length) {
    const { error } = await svc.from('bid_items').insert(rows)
    if (error) return { ok: false, error: 'Couldn’t record the bid’s prices — try again.' }
  }
  // The last freeze wins: every older live set goes, and if a newer one landed meanwhile, this one stands down.
  const at = new Date().toISOString()
  await svc.from('bid_items').update({ deleted_at: at }).eq('estimate_id', estimateId).eq('company_id', companyId).is('deleted_at', null).lt('created_at', stamp)
  const { data: newer } = await svc.from('bid_items').select('id').eq('estimate_id', estimateId).eq('company_id', companyId).is('deleted_at', null).gt('created_at', stamp).limit(1)
  if (newer?.length) {
    await svc.from('bid_items').update({ deleted_at: at }).eq('estimate_id', estimateId).eq('company_id', companyId).is('deleted_at', null).eq('created_at', stamp)
    return done(0)
  }
  return done(rows.length)
}

/**
 * Record an estimate's priced lines as a bid when it goes out; afterwards a
 * status change only re-marks the result (see `freeze`). Called by the
 * estimate's autosave on every status change; safe to repeat.
 */
export async function freezeEstimateBidAction(estimateId: string): Promise<Res<{ items: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!UUID.test(estimateId)) return { ok: false, error: 'Bad estimate' }
  const w = await writer()
  if (keyRateLimited(w.companyId, 'bid-freeze', 300, 60 * 60_000)) return { ok: false, error: 'That’s a lot of bids this hour — try again later.' }
  return freeze(w, estimateId)
}

/** A revised bid went out: freeze the lines again at today's prices (the estimate must be Sent). */
export async function resendBidAction(estimateId: string): Promise<Res<{ items: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!UUID.test(estimateId)) return { ok: false, error: 'Bad estimate' }
  const w = await writer()
  if (keyRateLimited(w.companyId, 'bid-freeze', 300, 60 * 60_000)) return { ok: false, error: 'That’s a lot of bids this hour — try again later.' }
  const { data: cur } = await w.svc.from('estimates').select('status').eq('id', estimateId).eq('company_id', w.companyId).is('deleted_at', null).maybeSingle()
  if (!cur) return { ok: false, error: 'Estimate not found' }
  if (cur.status !== 'sent') return { ok: false, error: 'Only a bid that is out (Sent) can be re-sent.' }
  return freeze(w, estimateId, { resend: true })
}

/** Sent / won / lost, the day it went out, and the low bid when lost — then the bid's lines are frozen (once) or re-marked. */
export async function recordBidResultAction(estimateId: string, input: { status: string; bidOn?: string | null; lowBid?: number | null }): Promise<Res<{ items: number; bidOn: string; lowBid: number | null }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!UUID.test(estimateId)) return { ok: false, error: 'Bad estimate' }
  const status = String(input?.status ?? '')
  if (!['sent', 'won', 'lost'].includes(status)) return { ok: false, error: 'Pick sent, won or lost.' }
  const w = await writer()
  const { data: cur } = await w.svc.from('estimates').select('id, bid_on').eq('id', estimateId).eq('company_id', w.companyId).is('deleted_at', null).maybeSingle()
  if (!cur) return { ok: false, error: 'Estimate not found' }
  let bidOn: string
  if (input.bidOn === undefined || input.bidOn === null || input.bidOn === '') bidOn = validDay(cur.bid_on) ? String(cur.bid_on) : today()
  else if (validDay(input.bidOn)) bidOn = input.bidOn
  else return { ok: false, error: 'Give the bid date.' }
  let lowBid: number | null = null
  if (status === 'lost' && input.lowBid !== undefined && input.lowBid !== null) {
    if (typeof input.lowBid !== 'number' || !Number.isFinite(input.lowBid) || input.lowBid < 0 || input.lowBid > 1_000_000_000) return { ok: false, error: 'The low bid should be a dollar amount.' }
    lowBid = Math.round(input.lowBid * 100) / 100
  }
  const { error } = await w.svc.from('estimates').update({ status, bid_on: bidOn, low_bid: lowBid, updated_at: new Date().toISOString() })
    .eq('id', estimateId).eq('company_id', w.companyId).is('deleted_at', null)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  const f = await freeze(w, estimateId)
  if (!f.ok) return { ok: false, error: `Saved as ${status}, but ${f.error.charAt(0).toLowerCase()}${f.error.slice(1)}` }
  return { ok: true, items: f.items, bidOn, lowBid }
}

/**
 * Old bid sheets pasted from Excel / Sheets / CSV (Manager+): ≤ 5,000 rows a
 * paste, ≤ 20,000 rows per company. A row already on file (same day, job,
 * item, price, quantity and result) is skipped, so pasting twice adds nothing.
 */
export async function importBidHistoryAction(text: string): Promise<Res<{ added: number; duplicates: number; problems: { row: number; why: string }[] }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer({ managers: true })
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Paste the bid history first.' }
  if (text.length > 2_000_000) return { ok: false, error: 'That paste is too big — split it into a few.' }
  if (keyRateLimited(companyId, 'bid-import', 30, 60 * 60_000)) return { ok: false, error: 'That’s a lot of imports this hour — try again later.' }
  const { rows, problems } = parseBidPaste(text, { maxRows: IMPORT_CAP })
  if (!rows.length) return { ok: false, error: problems[0]?.why ?? 'No rows it could read.' }
  const { count } = await svc.from('bid_items').select('id', { count: 'exact', head: true }).eq('company_id', companyId).is('deleted_at', null)
  const keys = Array.from(new Set(rows.map((r) => r.itemKey)))
  const seen = new Set<string>()
  for (let i = 0; i < keys.length; i += 150) {
    const chunk = keys.slice(i, i + 150)
    const { rows: have } = await allRows<{ id: string; bid_on: string; job_name: string; item_key: string; unit_price: number; qty: number | null; result: BidResult }>((from, to) =>
      svc.from('bid_items').select('id, bid_on, job_name, item_key, unit_price, qty, result').eq('company_id', companyId).is('deleted_at', null).in('item_key', chunk).order('id').range(from, to), { max: COMPANY_CAP })
    for (const h of have) seen.add(bidRowSig({ bidOn: String(h.bid_on), jobName: String(h.job_name), itemKey: String(h.item_key), unitPrice: Number(h.unit_price), qty: h.qty === null ? null : Number(h.qty), result: h.result }))
  }
  let duplicates = 0
  const fresh = rows.filter((r) => {
    const s = bidRowSig(r)
    if (seen.has(s)) { duplicates++; return false }
    seen.add(s)
    return true
  })
  if ((count ?? 0) + fresh.length > COMPANY_CAP) return { ok: false, error: `That would pass ${COMPANY_CAP.toLocaleString()} bid lines on file — remove old imports first.` }
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await svc.from('bid_items').insert(fresh.slice(i, i + 500).map((r) => ({
      company_id: companyId, estimate_id: null, source: 'import', bid_on: r.bidOn, job_name: r.jobName, customer: r.customer,
      item_key: r.itemKey, item_name: r.itemName, unit: r.unit, qty: r.qty, unit_price: r.unitPrice,
      unit_cost: r.unitCost, result: r.result, low_unit_price: r.lowUnitPrice, created_by: userId,
    })))
    if (error) {
      revalidatePath('/costbook')
      return { ok: false, error: i ? `Saved the first ${i.toLocaleString()} rows; the rest didn’t save — paste them again (rows on file are skipped).` : 'Couldn’t save the rows — check the dates and numbers and try again.' }
    }
  }
  revalidatePath('/costbook')
  return { ok: true, added: fresh.length, duplicates, problems }
}

/** Remove pasted bid history (Manager+): all of it, or what was imported on or after a day. Frozen estimate bids stay. */
export async function deleteImportedBidsAction(opts: { importedSince?: string | null } = {}): Promise<Res<{ removed: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer({ managers: true })
  if (opts.importedSince && !validDay(opts.importedSince)) return { ok: false, error: 'Bad date' }
  let q = svc.from('bid_items').update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('company_id', companyId).eq('source', 'import').is('deleted_at', null)
  if (opts.importedSince) q = q.gte('created_at', `${opts.importedSince}T00:00:00Z`)
  const { error, count } = await q
  if (error) return { ok: false, error: 'Couldn’t remove them — try again.' }
  revalidatePath('/costbook')
  return { ok: true, removed: count ?? 0 }
}
