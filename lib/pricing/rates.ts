/**
 * Unit rates from the bids themselves (migration 165, the pricing engine v0 —
 * "price through winning bids"). Pure: the same numbers on the device, the
 * server and the harness (`node scripts/rates-test.mjs`, run it after ANY
 * change here).
 *
 * Every priced line of every bid is a row: our unit price, today's unit cost
 * when the bid was built from an estimate, the result, and — when we lost and
 * the low total is known — the low bidder's level spread evenly over our
 * lines (an ESTIMATE of their unit price, never a fact). Per item the rows
 * become a band: where we win, where we lose, and what the last cost was.
 * A suggested price starts from cost at a target margin and is checked
 * against that band; the win chance is the plain share of decided bids at or
 * under a price that were won, with its Wilson interval, and nothing at all
 * under four decided bids.
 */
import { parseDelimited } from '../bulk-import'
import type { Line, LineCost, Totals } from '../estimate/engine'

export type BidResult = 'pending' | 'won' | 'lost'

export interface BidRow {
  id?: string
  estimateId?: string | null
  source?: 'estimate' | 'import'
  bidOn: string
  jobName: string
  customer: string | null
  itemKey: string
  itemName: string
  unit: string
  qty: number | null
  unitPrice: number
  /** Admins only — null for everyone else and for imported rows. */
  unitCost: number | null
  result: BidResult
  lowUnitPrice: number | null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r4 = (v: number) => Math.round(v * 10000) / 10000

// ── Keys ────────────────────────────────────────────────────────────────────

const UNIT_ALIAS: Record<string, string> = {
  TONS: 'TON', TN: 'TON', T: 'TON', CYS: 'CY', YD3: 'CY', CUYD: 'CY', SYS: 'SY', YD2: 'SY', SQYD: 'SY',
  SFS: 'SF', SQFT: 'SF', FT2: 'SF', LFS: 'LF', FT: 'LF', LNFT: 'LF', EACH: 'EA', EAS: 'EA', ACRE: 'AC', ACRES: 'AC', ACS: 'AC',
  LUMP: 'LS', LUMPSUM: 'LS', LOADS: 'LOAD', LD: 'LOAD', GAL: 'GAL', HR: 'HR', HRS: 'HR', DAY: 'DAY', DAYS: 'DAY',
}

/** "Tons", "sq yd", "S.Y." → TON, SY, SY. Anything else: its letters, ≤ 10. */
export function normUnit(u: string | null | undefined): string {
  const s = String(u ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return (UNIT_ALIAS[s] ?? s).slice(0, 10)
}

const slug = (s: string) => s.toLowerCase().replace(/["″]/g, ' in ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-')

/**
 * One item's key across bids: its code when it has one ("#p-hd|SY"), else its
 * words ("abc-stone-base-8-in|SY"). The unit is part of it — stone by the SY
 * and stone by the TON are different prices.
 */
export function itemKey(code: string | null | undefined, name: string, unit: string): string {
  const u = normUnit(unit) || 'EA'
  const c = code ? slug(code) : ''
  const body = c ? `#${c}` : slug(name) || 'item'
  return `${body.slice(0, 160 - u.length - 1)}|${u}`
}

// ── From an estimate ────────────────────────────────────────────────────────

export interface FrozenLine { itemKey: string; itemName: string; code: string | null; unit: string; qty: number; unitCost: number; unitPrice: number }

/** "Heavy duty asphalt — top 3″" → "Heavy duty asphalt": the layers of one item are one priced item. */
const LAYER_TAIL = /\s+—\s+(?:top|base|layer \d+)\s+[\d.]+″$/

/** An estimate line's item key — the layers of one paving item share their item's. */
export const lineKey = (line: Pick<Line, 'code' | 'name' | 'unit'>) => itemKey(line.code, line.name.replace(LAYER_TAIL, ''), line.unit)

/**
 * Each priced line of an estimate at its bid level: unit cost = the line's
 * direct cost ÷ its quantity, unit price = that × (bid ÷ direct) — the markups
 * spread evenly. Lines with no quantity or no cost are skipped. Lines that
 * share a key fold into one item:
 *  - the LAYERS of one paving item ("— top 3″", "— base 8″", same section)
 *    cover the same area, so their per-unit costs ADD (Σ costᵢ/qtyᵢ) over that
 *    area — even when a takeoff rounds one layer's area differently;
 *  - everything else sharing a key (the same item in two sections, two
 *    layered items in two sections) sums quantities and costs.
 */
export function fromEstimate(o: { lines: Line[]; costs: LineCost[]; totals: Pick<Totals, 'bid' | 'direct'> }): FrozenLine[] {
  const ratio = o.totals.direct > 0 && o.totals.bid > 0 ? o.totals.bid / o.totals.direct : 1
  type Part = { qty: number; cost: number }
  const by = new Map<string, { name: string; code: string | null; unit: string; plain: Part[]; layers: Map<string, Part[]> }>()
  o.lines.forEach((line, i) => {
    const cost = o.costs[i]
    if (!cost || !(line.qty > 0) || !(cost.total > 0)) return
    const k = lineKey(line)
    let g = by.get(k)
    if (!g) { g = { name: line.name.replace(LAYER_TAIL, ''), code: line.code, unit: line.unit, plain: [], layers: new Map() }; by.set(k, g) }
    const part = { qty: line.qty, cost: cost.total }
    if (LAYER_TAIL.test(line.name)) {
      const sec = String(line.section ?? '')
      const a = g.layers.get(sec)
      if (a) a.push(part); else g.layers.set(sec, [part])
    } else g.plain.push(part)
  })
  const out: FrozenLine[] = []
  for (const [k, g] of Array.from(by.entries())) {
    let qty = 0, cost = 0
    for (const p of g.plain) { qty += p.qty; cost += p.cost }
    for (const parts of Array.from(g.layers.values())) {
      // One layered item in one section: its area once, its layers' unit costs added.
      const area = Math.max(...parts.map((p) => p.qty))
      const perUnit = parts.reduce((t, p) => t + p.cost / p.qty, 0)
      qty += area
      cost += perUnit * area
    }
    if (!(qty > 0)) continue
    const unitCost = cost / qty
    out.push({ itemKey: k, itemName: g.name.slice(0, 200), code: g.code, unit: normUnit(g.unit) || 'EA', qty: r4(qty), unitCost: r4(unitCost), unitPrice: r4(unitCost * ratio) })
  }
  return out
}

/**
 * The low bidder's level on one of our lines IF their discount were spread
 * evenly over the bid: our unit × low total ÷ our total. An estimate — a
 * low bidder is cheap where they are cheap, not everywhere.
 */
export function lowUnitFromTotal(ourUnit: number, ourBid: number, lowBid: number | null | undefined): number | null {
  if (!(ourUnit >= 0) || !(ourBid > 0) || lowBid === null || lowBid === undefined || !(lowBid >= 0)) return null
  return r4((ourUnit * lowBid) / ourBid)
}

// ── Freezing a bid: once, at Sent ───────────────────────────────────────────

export type FreezeStep = 'drop' | 'freeze' | 'outcome'

/**
 * What a status change does to an estimate's frozen lines. The lines are
 * frozen ONCE — when it goes out (Sent), or on the first status past Draft
 * when nothing is frozen yet — so a Won or Lost weeks later keeps the prices
 * that went out, not what today's cost book would make them. Won / Lost (or
 * back to Sent) only re-marks the result and the low bidder's level; Draft
 * removes them (it is not a bid any more); `resend` (a revised bid) freezes
 * again.
 */
export function freezeStep(status: string, liveRows: number, opts: { resend?: boolean } = {}): FreezeStep {
  if (status !== 'sent' && status !== 'won' && status !== 'lost') return 'drop'
  if (opts.resend || liveRows <= 0) return 'freeze'
  return 'outcome'
}

/** Our bid as it was frozen: Σ unit price × quantity over its lines. */
export function frozenBidTotal(rows: Pick<BidRow, 'unitPrice' | 'qty'>[]): number {
  return r2(rows.reduce((t, r) => t + (r.qty !== null && r.qty > 0 ? r.unitPrice * r.qty : 0), 0))
}

/**
 * The result and the low bidder's level on each frozen line, from the stored
 * prices — never re-priced. The low level only on a loss with a low total.
 */
export function outcomeRows(rows: { id: string; unitPrice: number; qty: number | null }[], status: string, lowBid: number | null): { id: string; result: BidResult; lowUnitPrice: number | null }[] {
  const result: BidResult = status === 'won' ? 'won' : status === 'lost' ? 'lost' : 'pending'
  const ours = frozenBidTotal(rows)
  return rows.map((r) => ({
    id: r.id, result,
    lowUnitPrice: result === 'lost' && lowBid !== null ? lowUnitFromTotal(r.unitPrice, ours, lowBid) : null,
  }))
}

// ── Bands ───────────────────────────────────────────────────────────────────

/** Linear-interpolated percentile (Excel PERCENTILE.INC) of sorted values. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(h)
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)]) - sorted[lo])
}

export interface RateBand {
  itemKey: string
  itemName: string
  unit: string
  count: number
  pending: number
  won: { n: number; p25: number | null; median: number | null; p75: number | null; min: number | null; max: number | null; last: number | null; lastOn: string | null }
  lost: { n: number; median: number | null; lowMedian: number | null; lowN: number }
  latestCost: number | null
  latestCostOn: string | null
  lastBidOn: string | null
}

const sortNum = (a: number[]) => a.slice().sort((x, y) => x - y)
const byDate = (a: BidRow, b: BidRow) => a.bidOn.localeCompare(b.bidOn)

/** Per item: how many bids, the won band, the lost median and the low bidder's, the latest cost. */
export function rateBands(rows: BidRow[]): RateBand[] {
  const g = new Map<string, BidRow[]>()
  for (const r of rows) {
    if (!r || !r.itemKey || !(r.unitPrice >= 0)) continue
    const a = g.get(r.itemKey)
    if (a) a.push(r); else g.set(r.itemKey, [r])
  }
  const out: RateBand[] = []
  for (const [key, list] of Array.from(g.entries())) {
    const rs = list.slice().sort(byDate)
    const newest = rs[rs.length - 1]
    const won = rs.filter((r) => r.result === 'won')
    const lost = rs.filter((r) => r.result === 'lost')
    const wp = sortNum(won.map((r) => r.unitPrice))
    const lp = sortNum(lost.map((r) => r.unitPrice))
    const low = sortNum(lost.map((r) => r.lowUnitPrice).filter((v): v is number => v !== null && v >= 0))
    const costed = rs.filter((r) => r.unitCost !== null && r.unitCost >= 0)
    const lastCost = costed[costed.length - 1] ?? null
    const lastWon = won[won.length - 1] ?? null
    out.push({
      itemKey: key, itemName: newest.itemName, unit: newest.unit, count: rs.length,
      pending: rs.filter((r) => r.result === 'pending').length,
      won: {
        n: won.length, p25: percentile(wp, 0.25), median: percentile(wp, 0.5), p75: percentile(wp, 0.75),
        min: wp[0] ?? null, max: wp[wp.length - 1] ?? null, last: lastWon?.unitPrice ?? null, lastOn: lastWon?.bidOn ?? null,
      },
      lost: { n: lost.length, median: percentile(lp, 0.5), lowMedian: percentile(low, 0.5), lowN: low.length },
      latestCost: lastCost?.unitCost ?? null,
      latestCostOn: lastCost?.bidOn ?? null,
      lastBidOn: newest.bidOn,
    })
  }
  return out.sort((a, b) => b.count - a.count || a.itemName.localeCompare(b.itemName))
}

// ── Suggest a price ─────────────────────────────────────────────────────────

export interface Suggestion {
  /** The price to put in, or null when there is nothing to stand on. */
  price: number | null
  /** Cost at the target margin (null without a cost). */
  atMargin: number | null
  /** The margin the suggested price makes on today's cost (null without a cost). */
  marginPct: number | null
  underCost: boolean
  why: string[]
}

const $ = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Start at cost ÷ (1 − margin). When we have won this item before and that
 * price sits above 75% of the wins, say so and offer the 75th percentile —
 * but never below today's cost: when the wins sit under cost the answer is
 * cost, said out loud as under cost.
 */
export function suggest(o: { cost: number | null; targetMarginPct: number; band: RateBand | null }): Suggestion {
  const m = Math.min(90, Math.max(0, Number.isFinite(o.targetMarginPct) ? o.targetMarginPct : 0)) / 100
  const cost = o.cost !== null && Number.isFinite(o.cost) && o.cost > 0 ? o.cost : null
  const won = o.band?.won
  const why: string[] = []
  const marginOf = (p: number) => (cost && p > 0 ? Math.round(((p - cost) / p) * 1000) / 10 : null)
  if (cost === null) {
    if (won && won.n > 0 && won.median !== null) {
      why.push(`No cost for this item — your median win is ${$(won.median)} (${won.n} win${won.n === 1 ? '' : 's'}).`)
      return { price: r2(won.median), atMargin: null, marginPct: null, underCost: false, why }
    }
    return { price: null, atMargin: null, marginPct: null, underCost: false, why: ['No cost and no wins to stand on yet.'] }
  }
  const atMargin = r2(cost / (1 - m))
  let price = atMargin
  why.push(`${$(cost)} cost at ${Math.round(m * 1000) / 10}% margin = ${$(atMargin)}.`)
  let underCost = false
  if (won && won.n > 0 && won.p75 !== null) {
    if (atMargin > won.p75 + 0.005) {
      why.push(`That's above 3 of every 4 prices you've won at (75th percentile ${$(won.p75)}).`)
      if (won.p75 >= cost) {
        price = r2(won.p75)
        why.push(`Offering ${$(price)} — ${marginOf(price)}% margin.`)
      } else {
        price = r2(cost)
        underCost = true
        why.push(`Your wins sit under today's cost — at ${$(won.p75)} you'd be under cost. Holding at cost (${$(cost)}), no margin.`)
      }
    } else if (won.p25 !== null && atMargin < won.p25 - 0.005 && won.median !== null) {
      why.push(`Below most of your wins — the median win is ${$(won.median)}; there may be room.`)
    }
  } else if (o.band && o.band.won.n === 0 && o.band.lost.n > 0) {
    why.push(`Never won this item yet (${o.band.lost.n} lost).`)
  }
  const lost = o.band?.lost
  if (lost && lost.lowMedian !== null && price > lost.lowMedian) {
    why.push(`The low bidder's level was about ${$(lost.lowMedian)} (estimated from the totals).`)
  }
  return { price, atMargin, marginPct: marginOf(price), underCost, why }
}

// ── Win chance ──────────────────────────────────────────────────────────────

/** Wilson score interval for k of n at 95%. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (!(n > 0)) return { lo: 0, hi: 1 }
  const p = k / n
  const z2 = z * z
  const den = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / den
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

export interface WinChance { p: number; lo: number; hi: number; won: number; n: number; decided: number }

/**
 * Of the decided bids (won + lost) on this item at or under `price`, the share
 * that were won — with its 95% Wilson interval so three of three never reads
 * as a sure thing. null under four decided bids, or when none sits at or
 * under the price (nothing measured there).
 */
export function winChance(rows: BidRow[], price: number): WinChance | null {
  const decided = rows.filter((r) => r.result === 'won' || r.result === 'lost')
  if (decided.length < 4 || !Number.isFinite(price)) return null
  const at = decided.filter((r) => r.unitPrice <= price + 1e-9)
  if (!at.length) return null
  const won = at.filter((r) => r.result === 'won').length
  const { lo, hi } = wilson(won, at.length)
  return { p: won / at.length, lo, hi, won, n: at.length, decided: decided.length }
}

// ── Old bid sheets, pasted ──────────────────────────────────────────────────

type Col = 'date' | 'job' | 'customer' | 'item' | 'code' | 'unit' | 'qty' | 'price' | 'result' | 'low' | 'cost'
const ALIASES: [Col, RegExp][] = [
  ['low', /^(low|lowbid|lowbidunit|lowunit|lowunitprice|lowprice|lowbidder|lowbidprice|lowbidunitprice|winningprice|winningbid)$/],
  ['cost', /^(unitcost|cost|ourcost)$/],
  ['date', /^(date|biddate|bidon|biddue|duedate|letting|lettingdate)$/],
  ['job', /^(job|jobname|project|projectname|projectjob|bid|bidname)$/],
  ['customer', /^(customer|gc|generalcontractor|owner|client|bidto)$/],
  ['code', /^(code|itemcode|itemno|item#|itemnumber|payitem|no|#)$/],
  ['item', /^(item|description|itemdescription|desc|lineitem|payitemdescription|scope)$/],
  ['unit', /^(unit|units|uom|um|u\/m)$/],
  ['qty', /^(qty|quantity|quan|qnty|estqty|estimatedquantity)$/],
  ['price', /^(unitprice|price|rate|unitrate|ourprice|ourunitprice|bidprice|bidunitprice|unitbid)$/],
  ['result', /^(result|status|outcome|wonlost|wl|w\/l|award|awarded)$/],
]

const headKey = (s: string) => s.toLowerCase().replace(/[\s_.\-()$:]+/g, '')

function colFor(cell: string): Col | null {
  const k = headKey(cell)
  if (!k) return null
  for (const [c, re] of ALIASES) if (re.test(k)) return c
  return null
}

/** "2025-03-04", "3/4/2025", "03/04/25", "Mar 4, 2025" → ISO day, else null. */
export function readDay(s: string): string | null {
  const t = String(s ?? '').trim()
  if (!t) return null
  let y: number, m: number, d: number
  let mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3] } else if ((mm = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    m = +mm[1]; d = +mm[2]; y = +mm[3] < 100 ? 2000 + +mm[3] : +mm[3]
  } else {
    const p = Date.parse(t)
    if (Number.isNaN(p) || !/[a-z]/i.test(t)) return null
    const dt = new Date(p)
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate()
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const dt = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso && y >= 1990 && y <= 2100 ? iso : null
}

/** "$1,234.50" → 1234.5; blank / words → null. */
export function readMoney(s: string): number | null {
  const t = String(s ?? '').replace(/[$,\s]/g, '')
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/** won / W / awarded / yes → won; lost / L / no → lost; blank / sent / open / pending → pending; else null. */
export function readResult(s: string): BidResult | null {
  const t = String(s ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  if (!t || ['pending', 'sent', 'open', 'submitted', 'out', 'p', 'tbd'].includes(t)) return 'pending'
  if (['won', 'w', 'win', 'awarded', 'award', 'yes', 'y', 'got', 'gotit'].includes(t)) return 'won'
  if (['lost', 'l', 'loss', 'lose', 'no', 'n', 'notawarded', 'missed'].includes(t)) return 'lost'
  return null
}

export interface PastedBid extends BidRow { row: number }

const cut = (s: string | undefined, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * A bid history pasted from Excel / Sheets / CSV. The first row must name the
 * columns (aliases: date / bid date, job / project, customer / GC, item /
 * description, code, unit, qty, unit price / price / rate, result / status
 * (won · lost · W · L · awarded), low / low bid unit). Item, unit, unit price
 * and date are required per row; anything unreadable comes back as a problem
 * with its row number (1 = the header).
 */
export function parseBidPaste(text: string, opts: { maxRows?: number } = {}): { rows: PastedBid[]; problems: { row: number; why: string }[] } {
  const max = opts.maxRows ?? 5000
  const table = parseDelimited(String(text ?? '').slice(0, 2_000_000))
  const problems: { row: number; why: string }[] = []
  if (!table.length) return { rows: [], problems: [{ row: 0, why: 'Nothing pasted.' }] }
  const cols = table[0].map(colFor)
  const at = (c: Col) => cols.indexOf(c)
  if (at('item') < 0 && at('code') >= 0) cols[at('code')] = 'item' // a sheet with only a "Code" column names items by it
  const missing = (['item', 'unit', 'price'] as Col[]).filter((c) => at(c) < 0)
  if (missing.length) {
    return { rows: [], problems: [{ row: 1, why: `The first row must name the columns — couldn't find ${missing.map((c) => ({ item: 'Item', unit: 'Unit', price: 'Unit price' } as Record<string, string>)[c]).join(', ')}.` }] }
  }
  const rows: PastedBid[] = []
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    if (cells.every((c) => !c)) continue
    if (rows.length >= max) { problems.push({ row: i + 1, why: `Only the first ${max.toLocaleString()} rows are read at a time.` }); break }
    const get = (c: Col) => (at(c) >= 0 ? cells[at(c)] ?? '' : '')
    const name = cut(get('item'), 200)
    const code = cut(get('code'), 16) || null
    const unit = normUnit(get('unit'))
    const price = readMoney(get('price'))
    const day = readDay(get('date'))
    const result = readResult(get('result'))
    const why: string[] = []
    if (!name) why.push('no item')
    if (!unit) why.push('no unit')
    if (price === null || price < 0 || price > 10_000_000) why.push('no unit price')
    if (!day) why.push(get('date') ? `date “${cut(get('date'), 20)}” not read` : 'no date')
    if (result === null) why.push(`result “${cut(get('result'), 20)}” — use won, lost or blank`)
    const qtyTxt = get('qty')
    const qty = qtyTxt ? readMoney(qtyTxt) : null
    if (qtyTxt && (qty === null || qty < 0)) why.push('quantity not a number')
    const lowTxt = get('low')
    const low = lowTxt ? readMoney(lowTxt) : null
    if (lowTxt && (low === null || low < 0)) why.push('low bid not a number')
    if (why.length) { problems.push({ row: i + 1, why: why.join('; ') }); continue }
    const costTxt = get('cost')
    const cost = costTxt ? readMoney(costTxt) : null
    rows.push({
      row: i + 1, source: 'import', bidOn: day!, jobName: cut(get('job'), 160) || 'Imported bid', customer: cut(get('customer'), 160) || null,
      itemKey: itemKey(code, name, unit), itemName: name, unit, qty: qty === null ? null : r4(qty), unitPrice: r4(price!),
      unitCost: cost !== null && cost >= 0 && cost <= 10_000_000 ? r4(cost) : null,
      result: result!, lowUnitPrice: low === null ? null : r4(low),
    })
  }
  return { rows, problems }
}

/** The fields that make two bid rows the same row (an import pasted twice adds nothing). */
export const bidRowSig = (r: Pick<BidRow, 'bidOn' | 'jobName' | 'itemKey' | 'unitPrice' | 'qty' | 'result'>) =>
  [r.bidOn, r.jobName.toLowerCase(), r.itemKey, r4(r.unitPrice), r.qty === null ? '' : r4(r.qty), r.result].join('|')

/** A line's history hint in words: "Won 6 · $12.40–$14.10/SY · lost at $15.20". */
export function bandWords(b: RateBand): string {
  const parts: string[] = []
  const u = b.unit
  if (b.won.n) parts.push(`Won ${b.won.n} · ${b.won.min === b.won.max ? $(b.won.min!) : `${$(b.won.p25!)}–${$(b.won.p75!)}`}/${u}`)
  if (b.lost.n && b.lost.median !== null) parts.push(`lost ${b.lost.n === 1 ? '' : `${b.lost.n} `}at ${b.lost.n === 1 ? '' : 'median '}${$(b.lost.median)}`)
  if (!b.won.n && !b.lost.n) parts.push(`${b.pending} bid${b.pending === 1 ? '' : 's'} out, none decided`)
  return parts.join(' · ')
}
