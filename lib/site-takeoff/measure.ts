/**
 * Site takeoff quantities — pure. Areas and lengths are measured in a UTM
 * frame centred on the site (lib/dirt/tm.ts) and corrected by the frame's
 * scale factor, so a square foot here is a square foot on the ground (well
 * under 0.1% across any parking lot), never a Web Mercator pixel.
 */
import { makeFrame, toFrame, type Frame } from '../dirt/tm'
import { polyArea } from '../dirt/geom'
import type { PriceUnit, SiteDesign, SiteItem, SiteMark } from './items'
import { UNIT_LABEL } from './items'

export const M2_TO_SF = 10.763910416709722
export const M_TO_FT = 3.280839895013123
export const SF_PER_SY = 9
export const CF_PER_CY = 27

export interface ItemResult {
  id: string
  name: string
  kind: SiteItem['kind']
  /** area items: SF (net of minus marks) · line: LF · count: EA */
  qty: number
  sy: number | null
  cy: number | null
  depthIn: number | null
  marks: number
  priceUnit: PriceUnit
  price: number | null
  /** Quantity in the price unit. */
  priced: number
  total: number | null
}

export interface SiteResults {
  items: ItemResult[]
  total: number
  /** Items that have quantities but no price. */
  unpriced: number
  computedAt: string
}

/** One frame for a whole takeoff: the mean of every coordinate. */
export function frameFor(coords: [number, number][]): Frame | null {
  let sx = 0, sy = 0, n = 0
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    sx += lng; sy += lat; n++
  }
  return n ? makeFrame(sx / n, sy / n) : null
}

/** Ground area of a lng/lat ring, m². */
export function ringAreaM2(f: Frame, ring: [number, number][]): number {
  if (ring.length < 3) return 0
  const flat: number[] = []
  for (const [lng, lat] of ring) { const [x, y] = toFrame(f, lng, lat); flat.push(x, y) }
  return polyArea(flat) / (f.k * f.k)
}

/** Ground length of a lng/lat polyline, m. */
export function lineLengthM(f: Frame, line: [number, number][]): number {
  let s = 0
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = toFrame(f, line[i - 1][0], line[i - 1][1])
    const [x1, y1] = toFrame(f, line[i][0], line[i][1])
    s += Math.hypot(x1 - x0, y1 - y0)
  }
  return s / f.k
}

export function markCount(m: SiteMark): number {
  if (m.count != null && Number.isFinite(m.count)) return Math.max(0, Math.round(m.count))
  return m.coords.length
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function computeSite(design: SiteDesign, now = new Date()): SiteResults {
  const f = frameFor(design.marks.flatMap(m => m.coords))
  const out: ItemResult[] = []
  let total = 0, unpriced = 0
  for (const it of design.items) {
    const marks = design.marks.filter(m => m.item === it.id)
    let qty = 0
    for (const m of marks) {
      if (it.kind === 'area') { const a = f ? ringAreaM2(f, m.coords) * M2_TO_SF : 0; qty += m.minus ? -a : a }
      else if (it.kind === 'line') qty += f ? lineLengthM(f, m.coords) * M_TO_FT : 0
      else qty += markCount(m)
    }
    if (it.kind === 'area') qty = Math.max(0, qty)
    const depth = it.kind === 'area' && it.depthIn != null && it.depthIn > 0 ? it.depthIn : null
    const sy = it.kind === 'area' ? qty / SF_PER_SY : null
    const cy = depth != null ? qty * (depth / 12) / CF_PER_CY : null
    let priced = qty
    if (it.priceUnit === 'sy') priced = qty / SF_PER_SY
    else if (it.priceUnit === 'cy') priced = cy ?? 0
    const price = it.price != null && Number.isFinite(it.price) ? it.price : null
    const t = price != null ? r2(priced * price) : null
    if (t != null) total += t
    else if (qty > 0) unpriced++
    out.push({
      id: it.id, name: it.name, kind: it.kind,
      qty: it.kind === 'count' ? qty : r2(qty),
      sy: sy != null ? r2(sy) : null, cy: cy != null ? r2(cy) : null, depthIn: depth,
      marks: marks.length, priceUnit: it.priceUnit, price, priced: r2(priced), total: t,
    })
  }
  return { items: out, total: r2(total), unpriced, computedAt: now.toISOString() }
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-US')

export function qtyLabel(r: ItemResult): string {
  if (r.kind === 'area') return `${n0(r.qty)} SF · ${n0(r.sy ?? 0)} SY${r.cy != null ? ` · ${r.cy.toLocaleString('en-US', { maximumFractionDigits: 1 })} CY at ${r.depthIn}"` : ''}`
  if (r.kind === 'line') return `${n0(r.qty)} LF`
  return `${n0(r.qty)} EA`
}

export const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function csvCell(v: string | number | null): string {
  if (v == null) return ''
  let s = String(v)
  // A leading = + - @ in a text cell would run as a formula in a spreadsheet.
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function resultsCsv(name: string, r: SiteResults): string {
  const rows: (string | number | null)[][] = [
    ['Takeoff', name],
    [],
    ['Line item', 'Quantity', 'Unit', 'SY', 'Depth (in)', 'CY', 'Marks', 'Price unit', 'Unit price', 'Priced qty', 'Total'],
  ]
  for (const it of r.items) {
    if (it.marks === 0) continue
    rows.push([
      it.name, it.qty, it.kind === 'area' ? 'SF' : it.kind === 'line' ? 'LF' : 'EA',
      it.sy, it.depthIn, it.cy, it.marks, UNIT_LABEL[it.priceUnit], it.price, it.priced, it.total,
    ])
  }
  rows.push([], ['Total', null, null, null, null, null, null, null, null, null, r.total])
  return rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n'
}
