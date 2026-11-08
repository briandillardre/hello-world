/**
 * The cost book and a site's estimate (migration 147) — reads under the
 * caller's own RLS: costs need the costs ability, markups the Admin rank, so
 * a login without them simply gets nothing back.
 */
import {
  cleanLines, cleanMarkups, cleanSettings, DEFAULT_SETTINGS,
  type Distance, type Line, type Markups, type Material, type Price, type PriceUnit, type Settings, type Source,
} from '@/lib/estimate/engine'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Place kinds that sell or take material (a place with a price counts too). */
export const SOURCE_KINDS = ['quarry', 'asphalt', 'concrete', 'borrow', 'landfill', 'supplier', 'dump', 'shop']

export interface CostSource extends Source { lat: number; lng: number; address: string | null }
export interface CostPrice extends Price { note: string | null }

export interface CostBook {
  available: boolean
  materials: Material[]
  prices: CostPrice[]
  sources: CostSource[]
  settings: Settings
  /** Admins only (null for everyone else). */
  markupDefaults: Markups | null
}

const EMPTY: CostBook = { available: false, materials: [], prices: [], sources: [], settings: DEFAULT_SETTINGS, markupDefaults: null }

export async function getCostBook(admin: boolean): Promise<CostBook> {
  if (isMock) return EMPTY
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [mq, pq, sq, dq, plq] = await Promise.all([
      db.from('cost_materials').select('id, name, unit, tons_per_cy, waste_pct, sort').order('sort').order('name').limit(1000),
      db.from('cost_prices').select('id, place_id, material_id, price, unit, basis, min_charge, fuel_pct, quoted_on, note').order('quoted_on', { ascending: false }).limit(5000),
      db.from('cost_settings').select('data').maybeSingle(),
      admin ? db.from('cost_markup_defaults').select('data').maybeSingle() : Promise.resolve({ data: null, error: null }),
      db.from('places').select('id, name, kind, lat, lng, address').eq('active', true).limit(2000),
    ])
    if (mq.error || pq.error) return EMPTY
    const prices: CostPrice[] = (pq.data ?? []).map((r) => ({
      id: String(r.id), placeId: String(r.place_id), materialId: String(r.material_id), price: Number(r.price), unit: r.unit as PriceUnit,
      basis: r.basis === 'delivered' ? 'delivered' : 'pickup', minCharge: r.min_charge === null ? null : Number(r.min_charge),
      fuelPct: r.fuel_pct === null ? null : Number(r.fuel_pct), quotedOn: String(r.quoted_on), note: (r.note as string | null) ?? null,
    }))
    const priced = new Set(prices.map((p) => p.placeId))
    const sources: CostSource[] = (plq.data ?? [])
      .filter((p) => SOURCE_KINDS.includes(String(p.kind)) || priced.has(String(p.id)))
      .map((p) => ({ id: String(p.id), name: String(p.name), kind: String(p.kind), lat: Number(p.lat), lng: Number(p.lng), address: (p.address as string | null) ?? null }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    return {
      available: true,
      materials: (mq.data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), unit: r.unit as PriceUnit, tonsPerCy: r.tons_per_cy === null ? null : Number(r.tons_per_cy), wastePct: Number(r.waste_pct ?? 0) })),
      prices,
      sources,
      settings: cleanSettings(sq.data?.data ?? {}),
      markupDefaults: admin && dq.data ? cleanMarkups((dq.data as { data: unknown }).data) : admin ? cleanMarkups({}) : null,
    }
  } catch {
    return EMPTY
  }
}

export interface EstimateRow { id: string; name: string; status: 'draft' | 'sent' | 'won' | 'lost'; snapshotId: string | null; lines: Line[]; createdAt: string; updatedAt: string }

export async function getEstimate(zoneId: string, admin: boolean): Promise<{ estimate: EstimateRow | null; markups: Markups | null; distances: Record<string, Distance> }> {
  const none = { estimate: null, markups: null, distances: {} }
  if (isMock || !/^[0-9a-f-]{36}$/i.test(zoneId)) return none
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [eq, dq] = await Promise.all([
      db.from('estimates').select('id, name, status, snapshot_id, lines, created_at, updated_at').eq('geofence_id', zoneId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('site_distances').select('place_id, miles, minutes, source').eq('geofence_id', zoneId).limit(500),
    ])
    const distances: Record<string, Distance> = {}
    for (const r of dq.data ?? []) distances[String(r.place_id)] = { miles: Number(r.miles), minutes: Number(r.minutes), source: r.source === 'fleet' ? 'fleet' : 'road' }
    const e = eq.data
    if (!e) return { ...none, distances }
    let markups: Markups | null = null
    if (admin) {
      const { data: m } = await db.from('estimate_markups').select('data').eq('estimate_id', e.id).maybeSingle()
      markups = cleanMarkups(m?.data ?? {})
    }
    return {
      estimate: {
        id: String(e.id), name: String(e.name), status: e.status as EstimateRow['status'], snapshotId: (e.snapshot_id as string | null) ?? null,
        lines: cleanLines(e.lines), createdAt: String(e.created_at), updatedAt: String(e.updated_at),
      },
      markups,
      distances,
    }
  } catch {
    return none
  }
}
