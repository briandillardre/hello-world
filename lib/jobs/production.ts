/**
 * Production (migration 160) — pure: what got BUILT, against what was BID.
 *
 * Brian, Nov 9 (an HCSS ad: "the unified platform built for Heavy Civil"):
 * "Make sure we are beating HCSS on our features, cleanliness, and ease of
 * use." HCSS's heart is HeavyJob — foremen log quantities and hours by cost
 * code every day, and the office reads unit cost and production vs the bid.
 * Here the foreman logs ONLY the quantity: the hours are already known — the
 * crew's GPS time cards clocked to the site and every tracked machine's hours
 * on it (the same sources job cost reads). Each day's cost is shared across
 * the items worked that day by the value each earned (installed × bid unit
 * cost), so an item's actual unit cost and production rate come out without
 * anyone splitting hours by cost code.
 *
 * Shared by the production page, the field entry and
 * `scripts/production-test.mjs` (run it after ANY change here).
 */

export const PROD_UNITS = ['CY', 'TON', 'SY', 'SF', 'LF', 'EA', 'LOAD', 'AC', 'LS'] as const
export type ProdUnit = (typeof PROD_UNITS)[number]
export const isProdUnit = (v: unknown): v is ProdUnit => typeof v === 'string' && (PROD_UNITS as readonly string[]).includes(v)

export interface ProdItem {
  id: string
  code: string | null
  name: string
  unit: ProdUnit
  /** quantity the job was bid for */
  budgetQty: number
  /** DIRECT cost per unit in the bid (null when costs are hidden from the viewer) */
  bidUnitCost: number | null
  /** bid production: units per crew-day (null when the estimate had none) */
  bidPerDay: number | null
  crew: string | null
  sort: number
}

export interface ProdEntry { itemId: string; day: string; qty: number }

/** one day on the job: hours and cost from the time cards and the machine ledger */
export interface DayCost { day: string; laborHrs: number; laborCost: number; equipHrs: number; equipCost: number }

export interface ItemProgress {
  id: string
  installed: number
  pct: number | null
  remaining: number
  /** days the item had quantity logged */
  daysWorked: number
  /** installed per day worked */
  actualPerDay: number | null
  /** remaining ÷ the better known rate (actual, else bid) — crew-days to finish */
  daysLeft: number | null
  /** installed × bid unit cost */
  earned: number | null
  /** the share of the days' labor + machine cost this item carries */
  actualCost: number | null
  actualUnitCost: number | null
  /** earned − actual: + = under the bid (making money), − = over */
  overUnder: number | null
  /** labor hours carried, for the manhours-per-unit read */
  laborHrs: number
  lastDay: string | null
}

export interface ProductionRollup {
  items: ItemProgress[]
  /** value of the whole bid scope at bid unit costs */
  budgetValue: number | null
  earned: number | null
  /** earned ÷ budget value — % complete by what got built */
  pctComplete: number | null
  /** field cost carried by days with quantities logged */
  allocatedCost: number | null
  /** field cost on days nobody logged a quantity (shown, never hidden) */
  unallocatedCost: number
  unallocatedDays: string[]
  overUnder: number | null
  daysLogged: number
}

const r2 = (v: number) => Math.round(v * 100) / 100
const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Items from the won estimate's lines: every line with a quantity (lump sums
 * count as 1 EA-like LS so mobilization can be marked done), the bid's
 * direct unit cost and production rate carried over.
 */
export function itemsFromEstimate(
  lines: { id: string; section: string | null; code: string | null; name: string; unit: string; qty: number; perDay: number | null; crewKey: string | null }[],
  costs: Map<string, { total: number; unitCost: number | null }>,
  crewName: (key: string | null) => string | null
): Omit<ProdItem, 'id'>[] {
  const out: Omit<ProdItem, 'id'>[] = []
  lines.forEach((l, i) => {
    const unit: ProdUnit = isProdUnit(l.unit) ? l.unit : 'EA'
    const qty = unit === 'LS' ? 1 : fin(l.qty)
    if (!(qty > 0)) return
    const k = costs.get(l.id)
    const unitCost = unit === 'LS' ? (k ? r2(fin(k.total)) : null) : k?.unitCost ?? null
    out.push({
      code: (l.code || l.section || '').trim().slice(0, 40) || null,
      name: (l.name || 'Item').trim().slice(0, 120),
      unit,
      budgetQty: Math.round(qty * 1000) / 1000,
      bidUnitCost: unitCost !== null && Number.isFinite(unitCost) ? r2(unitCost) : null,
      bidPerDay: l.perDay && l.perDay > 0 ? l.perDay : null,
      crew: crewName(l.crewKey),
      sort: i + 1,
    })
  })
  return out
}

/** The whole read: per item and for the job. Money is null throughout when no bid unit costs are known. */
export function productionRollup(items: ProdItem[], entries: ProdEntry[], days: DayCost[]): ProductionRollup {
  const byItem = new Map(items.map((it) => [it.id, it]))
  // one number per item per day (a re-save of a day replaces it upstream; sum defensively here)
  const qtyByItemDay = new Map<string, Map<string, number>>()
  for (const e of entries) {
    if (!byItem.has(e.itemId) || !(fin(e.qty) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(e.day)) continue
    const m = qtyByItemDay.get(e.itemId) ?? new Map<string, number>()
    m.set(e.day, (m.get(e.day) ?? 0) + fin(e.qty))
    qtyByItemDay.set(e.itemId, m)
  }
  const anyMoney = items.some((it) => it.bidUnitCost !== null)

  // each day's field cost, shared across that day's items by the value each earned
  const costShare = new Map<string, number>()
  const hrsShare = new Map<string, number>()
  const dayCost = new Map<string, DayCost>()
  for (const d of days) {
    const prev = dayCost.get(d.day)
    dayCost.set(d.day, prev
      ? { day: d.day, laborHrs: prev.laborHrs + fin(d.laborHrs), laborCost: prev.laborCost + fin(d.laborCost), equipHrs: prev.equipHrs + fin(d.equipHrs), equipCost: prev.equipCost + fin(d.equipCost) }
      : { day: d.day, laborHrs: fin(d.laborHrs), laborCost: fin(d.laborCost), equipHrs: fin(d.equipHrs), equipCost: fin(d.equipCost) })
  }
  const loggedDays = new Set<string>()
  qtyByItemDay.forEach((m) => m.forEach((_, day) => loggedDays.add(day)))
  let unallocated = 0
  const unallocatedDays: string[] = []
  dayCost.forEach((d) => {
    const cost = d.laborCost + d.equipCost
    const worked = items.filter((it) => (qtyByItemDay.get(it.id)?.get(d.day) ?? 0) > 0)
    if (!worked.length) {
      if (cost > 0 || d.laborHrs > 0) {
        unallocated += cost
        unallocatedDays.push(d.day)
      }
      return
    }
    // weight by earned value; with no unit costs, weight by share of each item's own budget
    const weights = worked.map((it) => {
      const q = qtyByItemDay.get(it.id)!.get(d.day)!
      return it.bidUnitCost !== null && it.bidUnitCost > 0 ? q * it.bidUnitCost : it.budgetQty > 0 ? q / it.budgetQty : 1
    })
    const total = weights.reduce((a, b) => a + b, 0) || 1
    worked.forEach((it, i) => {
      costShare.set(it.id, (costShare.get(it.id) ?? 0) + (cost * weights[i]) / total)
      hrsShare.set(it.id, (hrsShare.get(it.id) ?? 0) + (d.laborHrs * weights[i]) / total)
    })
  })

  let budgetValue = 0
  let earnedTotal = 0
  let allocated = 0
  const out: ItemProgress[] = items
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((it) => {
      const m = qtyByItemDay.get(it.id)
      const installed = m ? Array.from(m.values()).reduce((a, b) => a + b, 0) : 0
      const daysWorked = m ? m.size : 0
      const lastDay = m && m.size ? Array.from(m.keys()).sort().slice(-1)[0] : null
      const pct = it.budgetQty > 0 ? installed / it.budgetQty : null
      const remaining = Math.max(0, it.budgetQty - installed)
      const actualPerDay = daysWorked > 0 ? installed / daysWorked : null
      const rate = actualPerDay ?? it.bidPerDay
      const daysLeft = remaining === 0 ? 0 : rate && rate > 0 ? remaining / rate : null
      const earned = it.bidUnitCost !== null ? installed * it.bidUnitCost : null
      // a day's cost is only known from the field sources — money stays null when bid costs are hidden
      const actualCost = anyMoney && it.bidUnitCost !== null ? costShare.get(it.id) ?? 0 : null
      if (it.bidUnitCost !== null) {
        budgetValue += it.budgetQty * it.bidUnitCost
        earnedTotal += earned ?? 0
        allocated += actualCost ?? 0
      }
      return {
        id: it.id,
        installed: Math.round(installed * 1000) / 1000,
        pct: pct === null ? null : Math.round(pct * 1000) / 1000,
        remaining: Math.round(remaining * 1000) / 1000,
        daysWorked,
        actualPerDay: actualPerDay === null ? null : Math.round(actualPerDay * 100) / 100,
        daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
        earned: earned === null ? null : r2(earned),
        actualCost: actualCost === null ? null : r2(actualCost),
        actualUnitCost: actualCost !== null && installed > 0 ? r2(actualCost / installed) : null,
        overUnder: earned !== null && actualCost !== null ? r2(earned - actualCost) : null,
        laborHrs: Math.round((hrsShare.get(it.id) ?? 0) * 10) / 10,
        lastDay,
      }
    })

  return {
    items: out,
    budgetValue: anyMoney ? r2(budgetValue) : null,
    earned: anyMoney ? r2(earnedTotal) : null,
    pctComplete: anyMoney && budgetValue > 0 ? Math.round((earnedTotal / budgetValue) * 1000) / 1000 : avgPct(out),
    allocatedCost: anyMoney ? r2(allocated) : null,
    unallocatedCost: anyMoney ? r2(unallocated) : 0,
    unallocatedDays: unallocatedDays.sort(),
    overUnder: anyMoney ? r2(earnedTotal - allocated) : null,
    daysLogged: loggedDays.size,
  }
}

/** % complete when no money is known: the plain average of item completion (capped at 100% each) */
function avgPct(items: ItemProgress[]): number | null {
  const ps = items.map((i) => i.pct).filter((p): p is number => p !== null)
  if (!ps.length) return null
  return Math.round((ps.reduce((a, p) => a + Math.min(1, p), 0) / ps.length) * 1000) / 1000
}

/** "1,240 LF", "3.5 CY", "Done" for LS */
export function qtyWords(q: number, unit: ProdUnit): string {
  if (unit === 'LS') return q >= 1 ? 'Done' : q > 0 ? `${Math.round(q * 100)}%` : 'Not started'
  const n = Math.abs(q) >= 100 ? Math.round(q).toLocaleString('en-US') : (Math.round(q * 10) / 10).toLocaleString('en-US')
  return `${n} ${unit}`
}

/** a typed field number: "1,250", "12.5", "" → null, junk → 'bad' */
export function readQty(v: unknown): number | null | 'bad' {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 1e8 ? v : 'bad'
  const s = String(v).replace(/[, ]/g, '').trim()
  if (!s) return null
  if (!/^\d*\.?\d+$/.test(s)) return 'bad'
  const n = Number(s)
  return Number.isFinite(n) && n <= 1e8 ? n : 'bad'
}
