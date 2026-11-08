/**
 * The estimate engine (Plans & Takeoff phase 3) — pure, the same numbers on
 * the device and the server.
 *
 * How a line builds up (the plan doc's "how a bid price builds up"):
 *   material  = the takeoff quantity in the price's unit (area × section depth
 *               → CY → tons when the line is stone or asphalt) × (1 + waste)
 *               × the source's price;
 *   haul      = the loads that quantity makes × one truck's round trip from
 *               that source to the site, at the truck's $/hr (nothing when the
 *               price is delivered);
 *   install   = the crew's $/day × the days the production rate says;
 *   sub       = a sub's quote × the quantity.
 * The source is picked by delivered cost (plant + haul), cheapest first, and
 * the estimator can pin another. Distances are road miles and minutes with no
 * traffic (the fleet's own round trips are board #217, not built).
 * Markups sit on the direct cost: overhead, contingency, profit, bond, and
 * sales tax on materials.
 */

export type PriceUnit = 'TON' | 'CY' | 'SY' | 'SF' | 'LF' | 'EA' | 'LOAD'
export const PRICE_UNITS: PriceUnit[] = ['TON', 'CY', 'SY', 'SF', 'LF', 'EA', 'LOAD']
export type LineUnit = 'LF' | 'SF' | 'SY' | 'AC' | 'EA' | 'CY' | 'TON' | 'LS'

export interface Material { id: string; name: string; unit: PriceUnit; tonsPerCy: number | null; wastePct: number }
export interface Price { id: string; placeId: string; materialId: string; price: number; unit: PriceUnit; basis: 'pickup' | 'delivered'; minCharge: number | null; fuelPct: number | null; quotedOn: string }
export interface Source { id: string; name: string; kind: string }
export interface Distance { miles: number; minutes: number; source: 'road' | 'fleet' }

export interface Crew { key: string; name: string; ratePerHr: number }
export interface Settings {
  /** One haul truck: what it carries and what an hour of it costs. */
  haul: { truckTons: number; truckCy: number; ratePerHr: number; loadMin: number }
  lowboy: { ratePerHr: number; loadMin: number }
  crews: Crew[]
  hoursPerDay: number
}

export const DEFAULT_SETTINGS: Settings = {
  haul: { truckTons: 18, truckCy: 14, ratePerHr: 95, loadMin: 15 },
  lowboy: { ratePerHr: 150, loadMin: 45 },
  crews: [],
  hoursPerDay: 8,
}

export interface Markups { overheadPct: number; contingencyPct: number; profitPct: number; bondPct: number; taxPct: number }
export const NO_MARKUPS: Markups = { overheadPct: 0, contingencyPct: 0, profitPct: 0, bondPct: 0, taxPct: 0 }

export interface Line {
  id: string
  section: string | null
  code: string | null
  name: string
  unit: LineUnit
  qty: number
  /** Area/volume items: the section depth that turns SF/SY into CY. */
  depthIn: number | null
  materialId: string | null
  /** Pinned source (null = the cheapest delivered). */
  placeId: string | null
  wastePct: number | null
  crewKey: string | null
  /** Production: line units per crew-day. */
  perDay: number | null
  /** A sub's price per line unit. */
  subUnit: number | null
  /** Lump sums (mobilization): the round trips a lowboy makes from the shop. */
  lowboyTrips: number | null
  note: string | null
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** A line's quantity in a price unit, or null when the units don't meet. */
export function qtyIn(qty: number, unit: LineUnit, depthIn: number | null, to: PriceUnit, tonsPerCy: number | null, s: Settings): number | null {
  if (!(qty >= 0)) return null
  if (unit === 'LS') return null
  if ((unit as string) === to) return qty
  // Area in square feet, then volume from the section depth.
  const sf = unit === 'SF' ? qty : unit === 'SY' ? qty * 9 : unit === 'AC' ? qty * 43_560 : null
  if (to === 'SF' && sf !== null) return sf
  if (to === 'SY' && sf !== null) return sf / 9
  let cy: number | null = unit === 'CY' ? qty : unit === 'TON' && tonsPerCy ? qty / tonsPerCy : null
  if (cy === null && sf !== null && depthIn && depthIn > 0) cy = (sf * depthIn) / 12 / 27
  if (cy === null) return null
  if (to === 'CY') return cy
  if (to === 'TON') return tonsPerCy ? cy * tonsPerCy : null
  if (to === 'LOAD') {
    if (tonsPerCy && s.haul.truckTons > 0) return (cy * tonsPerCy) / s.haul.truckTons
    return s.haul.truckCy > 0 ? cy / s.haul.truckCy : null
  }
  return null
}

/** Loads a quantity in a price unit makes (whole loads), or null when it doesn't haul. */
export function loadsFor(q: number, unit: PriceUnit, tonsPerCy: number | null, s: Settings): number | null {
  if (!(q > 0)) return 0
  if (unit === 'LOAD') return Math.ceil(q - 1e-9)
  if (unit === 'TON') return s.haul.truckTons > 0 ? Math.ceil(q / s.haul.truckTons - 1e-9) : null
  if (unit === 'CY') {
    // A truck fills by weight or by volume, whichever comes first.
    const byCy = s.haul.truckCy > 0 ? q / s.haul.truckCy : 0
    const byTon = tonsPerCy && s.haul.truckTons > 0 ? (q * tonsPerCy) / s.haul.truckTons : 0
    const n = Math.max(byCy, byTon)
    return n > 0 ? Math.ceil(n - 1e-9) : null
  }
  return null
}

/** One truck's round trip from a source, $ (drive both ways + load and dump). */
export function tripCost(d: Distance, s: Settings): number {
  const hrs = (2 * d.minutes + s.haul.loadMin) / 60
  return hrs * s.haul.ratePerHr
}

export interface SourceOption {
  placeId: string
  name: string
  priceId: string
  plant: number
  unit: PriceUnit
  basis: 'pickup' | 'delivered'
  /** Haul per price unit at a full load (0 when delivered). */
  haulPerUnit: number | null
  delivered: number | null
  miles: number | null
  minutes: number | null
  distanceSource: Distance['source'] | null
  quotedOn: string
}

/** Every source that prices a material, cheapest delivered first (unknown distance last). */
export function sourceOptions(materialId: string, materials: Material[], prices: Price[], sources: Source[], distances: Map<string, Distance>, s: Settings): SourceOption[] {
  const m = materials.find((x) => x.id === materialId)
  if (!m) return []
  const byId = new Map(sources.map((x) => [x.id, x]))
  const out: SourceOption[] = []
  for (const p of prices) {
    if (p.materialId !== materialId) continue
    const src = byId.get(p.placeId)
    if (!src) continue
    const d = distances.get(p.placeId) ?? null
    let haulPerUnit: number | null = null
    if (p.basis === 'delivered') haulPerUnit = 0
    else if (d) {
      const perLoad = p.unit === 'LOAD' ? 1 : p.unit === 'TON' ? s.haul.truckTons : p.unit === 'CY' ? Math.min(s.haul.truckCy, m.tonsPerCy ? s.haul.truckTons / m.tonsPerCy : Infinity) : null
      haulPerUnit = perLoad && perLoad > 0 && Number.isFinite(perLoad) ? tripCost(d, s) / perLoad : null
    }
    const fuel = p.fuelPct ? 1 + p.fuelPct / 100 : 1
    out.push({
      placeId: p.placeId, name: src.name, priceId: p.id, plant: r2(p.price * fuel), unit: p.unit, basis: p.basis,
      haulPerUnit: haulPerUnit === null ? null : r2(haulPerUnit),
      delivered: haulPerUnit === null ? null : r2(p.price * fuel + haulPerUnit),
      miles: d ? r2(d.miles) : null, minutes: d ? Math.round(d.minutes) : null, distanceSource: d?.source ?? null, quotedOn: p.quotedOn,
    })
  }
  return out.sort((a, b) => (a.delivered ?? Infinity) - (b.delivered ?? Infinity) || a.plant - b.plant || a.name.localeCompare(b.name))
}

export interface LineCost {
  lineId: string
  materialQty: number | null
  materialUnit: PriceUnit | null
  source: SourceOption | null
  loads: number | null
  material: number
  haul: number
  install: number
  sub: number
  lowboy: number
  total: number
  /** Per line unit (null for a lump sum or no quantity). */
  unitCost: number | null
  crewDays: number | null
  warnings: string[]
}

export interface Ctx { materials: Material[]; prices: Price[]; sources: Source[]; distances: Map<string, Distance>; settings: Settings; shop: Distance | null }

/** One line's cost, every part shown. */
export function lineCost(line: Line, c: Ctx): LineCost {
  const w: string[] = []
  const s = c.settings
  const out: LineCost = { lineId: line.id, materialQty: null, materialUnit: null, source: null, loads: null, material: 0, haul: 0, install: 0, sub: 0, lowboy: 0, total: 0, unitCost: null, crewDays: null, warnings: w }
  const m = line.materialId ? c.materials.find((x) => x.id === line.materialId) ?? null : null
  if (line.materialId && !m) w.push('Its material is no longer in the cost book.')
  if (m) {
    const opts = sourceOptions(m.id, c.materials, c.prices, c.sources, c.distances, s)
    const pinned = line.placeId ? opts.find((o) => o.placeId === line.placeId) ?? null : null
    if (line.placeId && !pinned) w.push('The pinned source no longer prices this material.')
    const src = pinned ?? opts.find((o) => o.delivered !== null) ?? opts[0] ?? null
    if (!src) w.push(`No source prices ${m.name} yet.`)
    else {
      out.source = src
      const q = qtyIn(line.qty, line.unit, line.depthIn, src.unit, m.tonsPerCy, s)
      if (q === null) w.push(`${line.unit} doesn't convert to ${src.unit} — give the item a section depth or the material tons per CY.`)
      else {
        const waste = line.wastePct ?? m.wastePct ?? 0
        const need = q * (1 + waste / 100)
        out.materialQty = r3(need)
        out.materialUnit = src.unit
        const price = c.prices.find((p) => p.id === src.priceId)
        out.material = Math.max(need * src.plant, price?.minCharge ?? 0)
        if (src.basis === 'pickup') {
          const loads = loadsFor(need, src.unit, m.tonsPerCy, s)
          out.loads = loads
          const d = c.distances.get(src.placeId)
          if (!d) w.push(`No road distance to ${src.name} yet — haul not counted.`)
          else if (loads === null) w.push(`${src.unit} doesn't haul by the load — haul not counted.`)
          else out.haul = loads * tripCost(d, s)
        }
      }
    }
  }
  if (line.crewKey) {
    const crew = s.crews.find((x) => x.key === line.crewKey)
    if (!crew) w.push('Its crew is no longer in the cost book.')
    else if (!(line.perDay && line.perDay > 0)) w.push(`Set how much ${crew.name} does in a day.`)
    else {
      const days = line.qty / line.perDay
      out.crewDays = r2(days)
      out.install = days * crew.ratePerHr * s.hoursPerDay
    }
  }
  if (line.subUnit && line.subUnit > 0) out.sub = line.subUnit * line.qty
  if (line.lowboyTrips && line.lowboyTrips > 0) {
    if (!c.shop) w.push('No road distance from the shop yet — mobilization not counted.')
    else out.lowboy = line.lowboyTrips * ((2 * c.shop.minutes + s.lowboy.loadMin) / 60) * s.lowboy.ratePerHr
  }
  out.material = r2(out.material); out.haul = r2(out.haul); out.install = r2(out.install); out.sub = r2(out.sub); out.lowboy = r2(out.lowboy)
  out.total = r2(out.material + out.haul + out.install + out.sub + out.lowboy)
  out.unitCost = line.unit !== 'LS' && line.qty > 0 ? r2(out.total / line.qty) : null
  return out
}

export interface Totals {
  direct: number
  materials: number
  bySection: { section: string; total: number }[]
  overhead: number
  contingency: number
  profit: number
  bond: number
  tax: number
  bid: number
}

/**
 * The bid: overhead and contingency on the direct cost, profit on that, sales
 * tax on the materials, the bond on everything before it.
 */
export function totals(costs: { line: Line; cost: LineCost }[], mk: Markups): Totals {
  const direct = costs.reduce((t, x) => t + x.cost.total, 0)
  const materials = costs.reduce((t, x) => t + x.cost.material, 0)
  const sec = new Map<string, number>()
  for (const x of costs) { const k = x.line.section ?? 'Other'; sec.set(k, (sec.get(k) ?? 0) + x.cost.total) }
  const pct = (v: number) => (Number.isFinite(v) && v > 0 ? v / 100 : 0)
  const overhead = direct * pct(mk.overheadPct)
  const contingency = direct * pct(mk.contingencyPct)
  const profit = (direct + overhead + contingency) * pct(mk.profitPct)
  const tax = materials * pct(mk.taxPct)
  const before = direct + overhead + contingency + profit + tax
  const bond = before * pct(mk.bondPct)
  return {
    direct: r2(direct), materials: r2(materials),
    bySection: Array.from(sec.entries()).map(([section, total]) => ({ section, total: r2(total) })),
    overhead: r2(overhead), contingency: r2(contingency), profit: r2(profit), bond: r2(bond), tax: r2(tax), bid: r2(before + bond),
  }
}

/** Trucks to keep a crew fed: one load every `minutesPerLoad`, each truck gone a round trip. */
export function trucksNeeded(d: Distance, s: Settings, minutesPerLoad: number): number | null {
  if (!(minutesPerLoad > 0)) return null
  return Math.max(1, Math.ceil((2 * d.minutes + s.haul.loadMin) / minutesPerLoad - 1e-9))
}

// ── Cleaning what arrives from a device ─────────────────────────────────────

const UUID = /^[0-9a-f-]{36}$/i
const LINE_UNITS: LineUnit[] = ['LF', 'SF', 'SY', 'AC', 'EA', 'CY', 'TON', 'LS']
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
const txt = (v: unknown, n: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : ''
  return s || null
}

/** An estimate's lines, bounded and typed (the server stores only this). */
export function cleanLines(x: unknown): Line[] {
  if (!Array.isArray(x)) return []
  const seen = new Set<string>()
  return x.slice(0, 500).flatMap((r) => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const id = typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : null
    const unit = LINE_UNITS.includes(o.unit as LineUnit) ? o.unit as LineUnit : null
    const name = txt(o.name, 120)
    if (!id || seen.has(id) || !unit || !name) return []
    seen.add(id)
    return [{
      id, section: txt(o.section, 40), code: txt(o.code, 16), name, unit,
      qty: num(o.qty, 0, 1e9) ?? 0,
      depthIn: num(o.depthIn, 0.01, 240),
      materialId: typeof o.materialId === 'string' && UUID.test(o.materialId) ? o.materialId : null,
      placeId: typeof o.placeId === 'string' && UUID.test(o.placeId) ? o.placeId : null,
      wastePct: num(o.wastePct, 0, 100),
      crewKey: typeof o.crewKey === 'string' && /^[a-z0-9-]{1,24}$/.test(o.crewKey) ? o.crewKey : null,
      perDay: num(o.perDay, 0.001, 1e7),
      subUnit: num(o.subUnit, 0, 1e7),
      lowboyTrips: num(o.lowboyTrips, 0, 100),
      note: txt(o.note, 200),
    }]
  })
}

export function cleanSettings(x: unknown): Settings {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const h = (o.haul && typeof o.haul === 'object' ? o.haul : {}) as Record<string, unknown>
  const l = (o.lowboy && typeof o.lowboy === 'object' ? o.lowboy : {}) as Record<string, unknown>
  const crews = Array.isArray(o.crews) ? o.crews.slice(0, 40).flatMap((c) => {
    if (!c || typeof c !== 'object') return []
    const r = c as Record<string, unknown>
    const name = txt(r.name, 60)
    const key = typeof r.key === 'string' && /^[a-z0-9-]{1,24}$/.test(r.key) ? r.key : null
    const rate = num(r.ratePerHr, 0, 100_000)
    return name && key && rate !== null ? [{ key, name, ratePerHr: rate }] : []
  }) : []
  const d = DEFAULT_SETTINGS
  return {
    haul: {
      truckTons: num(h.truckTons, 0.5, 60) ?? d.haul.truckTons, truckCy: num(h.truckCy, 0.5, 60) ?? d.haul.truckCy,
      ratePerHr: num(h.ratePerHr, 0, 10_000) ?? d.haul.ratePerHr, loadMin: num(h.loadMin, 0, 240) ?? d.haul.loadMin,
    },
    lowboy: { ratePerHr: num(l.ratePerHr, 0, 10_000) ?? d.lowboy.ratePerHr, loadMin: num(l.loadMin, 0, 600) ?? d.lowboy.loadMin },
    crews: crews.filter((c, i) => crews.findIndex((x) => x.key === c.key) === i),
    hoursPerDay: num(o.hoursPerDay, 1, 24) ?? d.hoursPerDay,
  }
}

export function cleanMarkups(x: unknown): Markups {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const p = (k: string) => num(o[k], 0, 100) ?? 0
  return { overheadPct: p('overheadPct'), contingencyPct: p('contingencyPct'), profitPct: p('profitPct'), bondPct: p('bondPct'), taxPct: p('taxPct') }
}

/** "crew-paving" from "Paving crew". */
export const crewKeyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'crew'
