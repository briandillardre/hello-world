/**
 * Haul tickets against the trucks' own trips — pure. Every ticket says a
 * truck brought a load to (or took one from) the site; every one of our
 * trucks' trips into the site's zone is in the hours ledger (zone sessions).
 * Per truck per day the two counts should agree:
 *   - more tickets than trips  → a ticket for a load that never came (or a
 *     hauler's truck the ticket names as ours);
 *   - more trips than tickets → a load with no ticket (a missing ticket is a
 *     load you can't bill, or a dump fee you'll be charged twice for).
 * Tons and cubic yards are converted by the material's typical loose weight
 * when the ticket gives only one — the ticket's own number always wins.
 */
import { MATERIALS } from './registers'

export interface Ticket { id: string; day: string; assetId: string | null; truckText?: string; direction: 'in' | 'out'; material: string; tons?: number; cy?: number; price?: number; source?: string }
export interface Trip { assetId: string; day: string; arrivals: number }

export const tonsPerCy = (material: string) => MATERIALS.find((m) => m.value === material)?.tonsPerCy ?? 1.3

export function ticketQty(t: Pick<Ticket, 'material' | 'tons' | 'cy'>): { tons: number; cy: number; derived: 'tons' | 'cy' | null } {
  const k = tonsPerCy(t.material)
  if (t.tons !== undefined && t.cy !== undefined) return { tons: t.tons, cy: t.cy, derived: null }
  if (t.tons !== undefined) return { tons: t.tons, cy: Math.round((t.tons / k) * 100) / 100, derived: 'cy' }
  if (t.cy !== undefined) return { tons: Math.round(t.cy * k * 100) / 100, cy: t.cy, derived: 'tons' }
  return { tons: 0, cy: 0, derived: null }
}

export interface ReconRow { assetId: string; day: string; tickets: number; trips: number; state: 'match' | 'extra_ticket' | 'missing_ticket'; words: string }

export function reconcile(tickets: Ticket[], trips: Trip[], names: Map<string, string>): ReconRow[] {
  const key = (a: string, d: string) => `${a}|${d}`
  const tix = new Map<string, number>()
  for (const t of tickets) if (t.assetId) tix.set(key(t.assetId, t.day), (tix.get(key(t.assetId, t.day)) ?? 0) + 1)
  const trp = new Map<string, number>()
  for (const t of trips) trp.set(key(t.assetId, t.day), (trp.get(key(t.assetId, t.day)) ?? 0) + t.arrivals)
  // a truck with trips but no ticket that day only matters if it hauls for this site at all
  const haulers = new Set(tickets.map((t) => t.assetId).filter(Boolean) as string[])
  const keys = new Set([...Array.from(tix.keys()), ...Array.from(trp.keys()).filter((k) => haulers.has(k.split('|')[0]))])
  const out: ReconRow[] = []
  for (const k of Array.from(keys)) {
    const [assetId, day] = k.split('|')
    const a = tix.get(k) ?? 0, b = trp.get(k) ?? 0
    const name = names.get(assetId) ?? 'Truck'
    const state: ReconRow['state'] = a === b ? 'match' : a > b ? 'extra_ticket' : 'missing_ticket'
    const words = state === 'match' ? `${name}: ${a} ${a === 1 ? 'ticket' : 'tickets'}, ${b} ${b === 1 ? 'trip' : 'trips'} — they agree.`
      : state === 'extra_ticket' ? `${name}: ${a} tickets but only ${b} ${b === 1 ? 'trip' : 'trips'} into the site — ${a - b} ${a - b === 1 ? 'ticket has' : 'tickets have'} no trip.`
      : `${name}: ${b} trips into the site but only ${a} ${a === 1 ? 'ticket' : 'tickets'} — ${b - a} ${b - a === 1 ? 'load has' : 'loads have'} no ticket.`
    out.push({ assetId, day, tickets: a, trips: b, state, words })
  }
  return out.sort((x, y) => (y.day.localeCompare(x.day)) || (names.get(x.assetId) ?? '').localeCompare(names.get(y.assetId) ?? ''))
}

export function haulTotals(tickets: Ticket[]): { inTons: number; inCy: number; outTons: number; outCy: number; cost: number | null; loads: number } {
  let inTons = 0, inCy = 0, outTons = 0, outCy = 0, cost = 0, priced = 0
  for (const t of tickets) {
    const q = ticketQty(t)
    if (t.direction === 'in') { inTons += q.tons; inCy += q.cy } else { outTons += q.tons; outCy += q.cy }
    if (t.price !== undefined) { cost += t.price * q.tons; priced++ }
  }
  const r = (n: number) => Math.round(n * 10) / 10
  return { inTons: r(inTons), inCy: r(inCy), outTons: r(outTons), outCy: r(outCy), cost: priced ? Math.round(cost * 100) / 100 : null, loads: tickets.length }
}
