/**
 * The takeoff's reads (migration 146). Marks, snapshots and memos read under
 * RLS; item PRICES are not readable by members at all (column grants), so
 * they come through the service client only for a login with the costs
 * ability.
 */
import type { Measure, Unit, MarkGeom, MarkKind } from '@/lib/plans/measure'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface TakeoffItem {
  id: string
  code: string
  name: string
  measure: Measure
  unit: Unit
  color: string
  /** Only for a login that can see costs; null otherwise. */
  unitPrice: number | null
  wastePct: number
  depthIn: number | null
  tonsPerCy: number | null
  section: string | null
  sort: number
}

export interface PlanMark {
  id: string
  sheetId: string
  versionId: string
  itemId: string | null
  kind: MarkKind
  geom: MarkGeom
  qty: number | null
  status: 'ok' | 'check' | 'suggested'
  label: string | null
  carriedFrom: string | null
  createdAt: string
}

export interface TakeoffSnapshot {
  id: string
  name: string
  kind: 'bid' | 'other'
  createdAt: string
  data: { items: { code: string; name: string; unit: string; qty: number }[]; sheets: { number: string; rev: string | null; versionId: string }[] }
}

const ITEM_COLS = 'id, code, name, measure, unit, color, waste_pct, depth_in, tons_per_cy, section, sort'

export function itemFromRow(r: Record<string, unknown>, price: number | null = null): TakeoffItem {
  return {
    id: String(r.id), code: String(r.code), name: String(r.name), measure: r.measure as Measure, unit: r.unit as Unit,
    color: String(r.color ?? '#ff9e16'), unitPrice: price, wastePct: Number(r.waste_pct ?? 0),
    depthIn: (r.depth_in as number | null) ?? null, tonsPerCy: (r.tons_per_cy as number | null) ?? null,
    section: (r.section as string | null) ?? null, sort: Number(r.sort ?? 0),
  }
}

export function markFromRow(r: Record<string, unknown>): PlanMark {
  return {
    id: String(r.id), sheetId: String(r.sheet_id), versionId: String(r.version_id), itemId: (r.item_id as string | null) ?? null,
    kind: r.kind as MarkKind, geom: r.geom as MarkGeom, qty: (r.qty as number | null) ?? null,
    status: (r.status as PlanMark['status']) ?? 'ok', label: (r.label as string | null) ?? null,
    carriedFrom: (r.carried_from as string | null) ?? null, createdAt: String(r.created_at ?? ''),
  }
}

export const MARK_COLS = 'id, sheet_id, version_id, item_id, kind, geom, qty, status, label, carried_from, created_at'

/** The company's item library, prices only when `withPrices`. */
export async function getTakeoffItems(withPrices: boolean): Promise<TakeoffItem[]> {
  if (isMock) return []
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const { data, error } = await db.from('takeoff_items').select(ITEM_COLS).order('sort').order('code').limit(1000)
    if (error || !data) return []
    let prices = new Map<string, number | null>()
    if (withPrices && data.length) {
      const { data: p } = await createServiceClient().from('takeoff_items').select('id, unit_price').in('id', data.map((r) => r.id as string))
      prices = new Map((p ?? []).map((r) => [String(r.id), r.unit_price === null ? null : Number(r.unit_price)]))
    }
    return data.map((r) => itemFromRow(r as Record<string, unknown>, prices.get(String(r.id)) ?? null))
  } catch {
    return []
  }
}

/** Live marks on some versions. */
export async function getMarks(versionIds: string[]): Promise<PlanMark[]> {
  if (isMock || !versionIds.length) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const out: PlanMark[] = []
    for (let i = 0; i < versionIds.length; i += 150) {
      const { data, error } = await db.from('plan_marks').select(MARK_COLS).in('version_id', versionIds.slice(i, i + 150)).limit(10000)
      if (error) return out
      for (const r of data ?? []) out.push(markFromRow(r as Record<string, unknown>))
    }
    return out
  } catch {
    return []
  }
}

export async function getSnapshots(zoneId: string): Promise<TakeoffSnapshot[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data } = await createClient().from('takeoff_snapshots').select('id, name, kind, created_at, data')
      .eq('geofence_id', zoneId).order('created_at', { ascending: false }).limit(50)
    return (data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), kind: r.kind as 'bid' | 'other', createdAt: String(r.created_at), data: r.data as TakeoffSnapshot['data'] }))
  } catch {
    return []
  }
}

export interface BidMemo { id: string; body: string; status: 'draft' | 'approved'; model: string | null; createdAt: string; updatedAt: string; approvedAt: string | null }

export const MEMO_COLS = 'id, body, status, model, created_at, updated_at, approved_at'
export function memoFromRow(r: Record<string, unknown>): BidMemo {
  return { id: String(r.id), body: String(r.body), status: r.status as BidMemo['status'], model: (r.model as string | null) ?? null, createdAt: String(r.created_at), updatedAt: String(r.updated_at), approvedAt: (r.approved_at as string | null) ?? null }
}

export async function getBidMemo(zoneId: string): Promise<BidMemo | null> {
  if (isMock) return null
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data } = await createClient().from('bid_memos').select(MEMO_COLS)
      .eq('geofence_id', zoneId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    return data ? memoFromRow(data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export interface TakeoffLink { token: string; includeCosts: boolean; createdAt: string; lastUsedAt: string | null }

/** The site's live spreadsheet links (service role — members hold no read on
 *  them; the caller has already checked it is an editor on this company). */
export async function getTakeoffLinks(companyId: string, zoneId: string): Promise<TakeoffLink[]> {
  if (isMock) return []
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { data } = await createServiceClient().from('takeoff_links').select('token, include_costs, created_at, last_used_at')
      .eq('company_id', companyId).eq('geofence_id', zoneId).is('revoked_at', null).order('created_at', { ascending: false }).limit(20)
    return (data ?? []).map((r) => ({ token: String(r.token), includeCosts: !!r.include_costs, createdAt: String(r.created_at), lastUsedAt: (r.last_used_at as string | null) ?? null }))
  } catch {
    return []
  }
}
