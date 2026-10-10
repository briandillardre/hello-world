/**
 * Site takeoff (migration 137) — the line items and the design document. Pure.
 *
 * A site takeoff measures what is ALREADY on the ground for paving and
 * landscaping bids: asphalt / concrete / sealcoat / turf / mulch-bed areas,
 * striping / curb / edging lengths, and counts (stalls, ADA, wheel stops,
 * trees). Each mark belongs to one line item; a line item carries its unit
 * price. Everything is stored in lng/lat; quantities are measured in
 * lib/site-takeoff/measure.ts.
 */

export type ItemKind = 'area' | 'line' | 'count'
/** What the unit price is per. */
export type PriceUnit = 'sf' | 'sy' | 'lf' | 'ea' | 'cy'

export interface SiteItem {
  id: string
  name: string
  kind: ItemKind
  priceUnit: PriceUnit
  /** $ per priceUnit; null = no price. */
  price: number | null
  color: string
  /** Area items only: depth in inches → volume in CY (mulch, stone). */
  depthIn?: number | null
}

export type MarkSource = 'hand' | 'wand' | 'stall'

export interface SiteMark {
  id: string
  item: string
  /** area: ring without the closing point · line: polyline · count: points, or a 2-point row line when `count` is set. */
  coords: [number, number][]
  /** Count marks made along a row (stall assist): the count, editable. */
  count?: number | null
  /** Area marks: subtract this area from its item (an island inside asphalt). */
  minus?: boolean
  src?: MarkSource
}

export interface SiteDesign {
  v: 1
  /** The zone_imagery photo the takeoff is traced on; null = Esri basemap (hand tracing only). */
  imageryId: string | null
  items: SiteItem[]
  marks: SiteMark[]
}

export const PRICE_UNITS: Record<ItemKind, PriceUnit[]> = {
  area: ['sf', 'sy', 'cy'],
  line: ['lf'],
  count: ['ea'],
}

export const UNIT_LABEL: Record<PriceUnit, string> = { sf: 'SF', sy: 'SY', lf: 'LF', ea: 'EA', cy: 'CY' }

/** The starting line items of a new takeoff. Prices blank — every company's are its own. */
export function presetItems(): SiteItem[] {
  return [
    { id: 'asphalt', name: 'Asphalt', kind: 'area', priceUnit: 'sy', price: null, color: '#94a3b8' },
    { id: 'concrete', name: 'Concrete', kind: 'area', priceUnit: 'sf', price: null, color: '#e2e8f0' },
    { id: 'sealcoat', name: 'Sealcoat', kind: 'area', priceUnit: 'sf', price: null, color: '#c084fc' },
    { id: 'turf', name: 'Turf', kind: 'area', priceUnit: 'sf', price: null, color: '#22c55e' },
    { id: 'mulch', name: 'Mulch beds', kind: 'area', priceUnit: 'cy', price: null, color: '#d97706', depthIn: 3 },
    { id: 'striping', name: 'Striping', kind: 'line', priceUnit: 'lf', price: null, color: '#facc15' },
    { id: 'curb', name: 'Curb', kind: 'line', priceUnit: 'lf', price: null, color: '#f97316' },
    { id: 'edging', name: 'Edging', kind: 'line', priceUnit: 'lf', price: null, color: '#a3e635' },
    { id: 'stalls', name: 'Parking stalls', kind: 'count', priceUnit: 'ea', price: null, color: '#38bdf8' },
    { id: 'ada', name: 'ADA stalls', kind: 'count', priceUnit: 'ea', price: null, color: '#3b82f6' },
    { id: 'wheelstops', name: 'Wheel stops', kind: 'count', priceUnit: 'ea', price: null, color: '#f472b6' },
    { id: 'trees', name: 'Trees', kind: 'count', priceUnit: 'ea', price: null, color: '#16a34a' },
  ]
}

export function emptySiteDesign(imageryId: string | null = null): SiteDesign {
  return { v: 1, imageryId, items: presetItems(), marks: [] }
}
