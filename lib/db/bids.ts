/**
 * Bid history reads (migration 165, pricing engine v0). `bid_items` reads go
 * through the caller's RLS (costs-only); `unit_cost` is not granted to
 * members, so an Admin's copy of it is read on the service role, company
 * pinned, AFTER the caller's rank is checked by the page (`admin` = rankOf(perms)
 * >= RANK.admin, the same rule as the estimate's markups). Demo mode returns a
 * fictional two-year history so /costbook's unit rates are alive without a
 * database.
 */
import { allRows } from '@/lib/db/paged'
import { itemKey, type BidResult, type BidRow } from '@/lib/pricing/rates'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const COLS = 'id, estimate_id, source, bid_on, job_name, customer, item_key, item_name, unit, qty, unit_price, result, low_unit_price'
const MAX_ROWS = 20_000

type Raw = Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

function fromRow(r: Raw, cost: number | null): BidRow {
  return {
    id: String(r.id), estimateId: (r.estimate_id as string | null) ?? null, source: r.source === 'import' ? 'import' : 'estimate',
    bidOn: String(r.bid_on), jobName: String(r.job_name), customer: (r.customer as string | null) ?? null,
    itemKey: String(r.item_key), itemName: String(r.item_name), unit: String(r.unit),
    qty: n(r.qty), unitPrice: Number(r.unit_price), unitCost: cost,
    result: (['won', 'lost'].includes(String(r.result)) ? r.result : 'pending') as BidResult,
    lowUnitPrice: n(r.low_unit_price),
  }
}

/** Admin-only unit costs, by row id (service role, company pinned). */
async function costsById(companyId: string, ids: Set<string> | null): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { rows } = await allRows<{ id: string; unit_cost: number | null }>((from, to) =>
    svc.from('bid_items').select('id, unit_cost').eq('company_id', companyId).is('deleted_at', null).not('unit_cost', 'is', null).order('id').range(from, to), { max: MAX_ROWS })
  for (const r of rows) if (r.unit_cost !== null && (!ids || ids.has(String(r.id)))) out.set(String(r.id), Number(r.unit_cost))
  return out
}

export interface RateLibrary { available: boolean; rows: BidRow[]; truncated: boolean }

/**
 * The company's whole bid history (≤ 20k rows, newest bids first). /costbook's
 * unit-rates tab calls this with `admin = rankOf(perms) >= RANK.admin`; the
 * bands are computed from the rows (`rateBands` in lib/pricing/rates).
 */
export async function getRateLibrary(companyId: string, admin: boolean): Promise<RateLibrary> {
  if (isMock) return { available: true, rows: demoHistory(admin), truncated: false }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const { rows, error, truncated } = await allRows<Raw>((from, to) =>
      db.from('bid_items').select(COLS).order('id').range(from, to), { max: MAX_ROWS })
    if (error) return { available: false, rows: [], truncated: false }
    const costs = admin && rows.length ? await costsById(companyId, null).catch(() => new Map<string, number>()) : new Map<string, number>()
    const out = rows.map((r) => fromRow(r, admin ? costs.get(String(r.id)) ?? null : null))
    out.sort((a, b) => b.bidOn.localeCompare(a.bidOn))
    return { available: true, rows: out, truncated }
  } catch {
    return { available: false, rows: [], truncated: false }
  }
}

/**
 * The history behind an estimate's lines: every bid row for these item keys,
 * except the estimate's own frozen rows. No unit costs — the estimate page
 * already has today's cost from the cost book.
 */
export async function getBidHistoryFor(itemKeys: string[], opts: { excludeEstimateId?: string | null } = {}): Promise<BidRow[]> {
  const keys = Array.from(new Set(itemKeys.filter((k) => typeof k === 'string' && k.length > 0 && k.length <= 160))).slice(0, 600)
  if (!keys.length) return []
  if (isMock) return demoHistory(false).filter((r) => keys.includes(r.itemKey))
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const out: BidRow[] = []
    for (let i = 0; i < keys.length; i += 150) {
      const chunk = keys.slice(i, i + 150)
      const { rows } = await allRows<Raw>((from, to) =>
        db.from('bid_items').select(COLS).in('item_key', chunk).order('id').range(from, to), { max: 5000 })
      for (const r of rows) if (!opts.excludeEstimateId || r.estimate_id !== opts.excludeEstimateId) out.push(fromRow(r, null))
    }
    return out
  } catch {
    return []
  }
}

/** The bid's outcome stored on the estimate (165): when it went out, and the low bid when lost. */
export async function getBidOutcome(estimateId: string | null | undefined): Promise<{ bidOn: string | null; lowBid: number | null }> {
  const none = { bidOn: null, lowBid: null }
  if (isMock || !estimateId || !/^[0-9a-f-]{36}$/i.test(estimateId)) return none
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data } = await createClient().from('estimates').select('bid_on, low_bid').eq('id', estimateId).maybeSingle()
    if (!data) return none
    return { bidOn: (data.bid_on as string | null) ?? null, lowBid: n(data.low_bid) }
  } catch {
    return none
  }
}

// ── Demo: a fictional sitework sub's two years of bids ──────────────────────

/** Small deterministic PRNG so the demo reads the same on every render. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

const DEMO_ITEMS: { name: string; unit: string; cost: number; qty: [number, number] }[] = [
  { name: 'ABC stone base 8"', unit: 'SY', cost: 10.6, qty: [800, 6000] },
  { name: '#57 stone', unit: 'TON', cost: 27.5, qty: [60, 600] },
  { name: 'Surge stone', unit: 'TON', cost: 31, qty: [80, 900] },
  { name: 'S9.5 surface asphalt', unit: 'TON', cost: 98, qty: [150, 1800] },
  { name: '15" RCP', unit: 'LF', cost: 52, qty: [80, 900] },
  { name: '24" RCP', unit: 'LF', cost: 84, qty: [60, 700] },
  { name: 'Curb & gutter 24"', unit: 'LF', cost: 19.5, qty: [300, 3200] },
  { name: 'Mass excavation', unit: 'CY', cost: 4.1, qty: [2000, 40000] },
  { name: 'Silt fence', unit: 'LF', cost: 2.6, qty: [500, 6000] },
  { name: 'Seeding & mulch', unit: 'AC', cost: 1650, qty: [1, 14] },
  { name: 'Concrete flatwork 4"', unit: 'SF', cost: 6.2, qty: [800, 9000] },
]
const DEMO_JOBS = ['Maple St Grading', 'Riverfront Tower', 'Oak Park Retail', 'Cedar Ridge Lot 4', 'Pine Hollow Phase 2', 'Elm Ave Widening', 'Harbor Self Storage', 'Birch Lane Church', 'Summit Office Park', 'Willow Creek Apartments', 'Lakeview Elementary Lot', 'Granite Plaza Outparcel', 'Hickory Point Shops', 'Bluebird Daycare', 'Northgate Warehouse', 'Fairway Townhomes']
const DEMO_GCS = ['Keystone Builders', 'Ridgeline Construction', 'Bridgewater GC', 'Palmetto Ventures', 'Northstar Contracting', null]

/** ~16 bids over two years, each pricing 6–10 of the items; mixed won / lost / pending, some low bids. */
function demoHistory(admin: boolean): BidRow[] {
  const rand = rng(165)
  const today = new Date()
  const out: BidRow[] = []
  DEMO_JOBS.forEach((job, j) => {
    const daysAgo = Math.round(720 - j * 45 - rand() * 20)
    const day = new Date(today.getTime() - Math.max(3, daysAgo) * 86_400_000).toISOString().slice(0, 10)
    const markup = 1.1 + rand() * 0.22 // our level on this bid
    const inflation = 1 + (720 - daysAgo) / 720 * 0.06
    const pending = j === DEMO_JOBS.length - 1 // the newest bid is still out
    // Cheaper bids win more often; a few just lose.
    const result: BidResult = pending ? 'pending' : markup < 1.2 ? (rand() < 0.8 ? 'won' : 'lost') : (rand() < 0.3 ? 'won' : 'lost')
    const lowRatio = result === 'lost' && rand() < 0.7 ? 0.9 + rand() * 0.08 : null
    const customer = DEMO_GCS[Math.floor(rand() * DEMO_GCS.length)]
    const items = DEMO_ITEMS.filter(() => rand() < 0.75)
    items.forEach((it, i) => {
      const cost = it.cost * inflation * (0.95 + rand() * 0.1)
      const price = cost * markup * (0.96 + rand() * 0.08)
      const qty = Math.round(it.qty[0] + rand() * (it.qty[1] - it.qty[0]))
      out.push({
        id: `demo-${j}-${i}`, estimateId: null, source: j % 3 === 0 ? 'import' : 'estimate', bidOn: day, jobName: job, customer,
        itemKey: itemKey(null, it.name, it.unit), itemName: it.name, unit: it.unit, qty,
        unitPrice: Math.round(price * 100) / 100,
        unitCost: admin && j % 3 !== 0 ? Math.round(cost * 100) / 100 : null,
        result, lowUnitPrice: lowRatio ? Math.round(price * lowRatio * 100) / 100 : null,
      })
    })
  })
  return out.sort((a, b) => b.bidOn.localeCompare(a.bidOn))
}
