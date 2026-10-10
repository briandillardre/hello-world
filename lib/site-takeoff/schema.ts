/**
 * Site takeoff design validation — pure. The server action stores only what
 * passes here; everything a browser posts is rebuilt field by field (unknown
 * keys dropped), bounded in size, and every coordinate checked.
 */
import { PRICE_UNITS, type ItemKind, type PriceUnit, type SiteDesign, type SiteItem, type SiteMark } from './items'

export const MAX_ITEMS = 60
export const MAX_MARKS = 2000
export const MAX_POINTS_PER_MARK = 4000
export const MAX_POINTS_TOTAL = 60_000

const ID = /^[A-Za-z0-9_-]{1,40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLOR = /^#[0-9a-fA-F]{6}$/
const KINDS: ItemKind[] = ['area', 'line', 'count']

type Check = { ok: true; design: SiteDesign } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function num(v: unknown, lo: number, hi: number): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}

export function checkSiteDesign(input: unknown): Check {
  if (!isObj(input)) return { ok: false, error: 'The takeoff could not be read.' }
  const imageryId = input.imageryId == null ? null : String(input.imageryId)
  if (imageryId != null && !UUID.test(imageryId)) return { ok: false, error: 'That picture was not found.' }
  if (!Array.isArray(input.items) || input.items.length > MAX_ITEMS) return { ok: false, error: `Up to ${MAX_ITEMS} line items.` }
  if (!Array.isArray(input.marks) || input.marks.length > MAX_MARKS) return { ok: false, error: `Up to ${MAX_MARKS} marks per takeoff.` }

  const items: SiteItem[] = []
  const ids = new Set<string>()
  for (const raw of input.items) {
    if (!isObj(raw)) return { ok: false, error: 'A line item could not be read.' }
    const id = String(raw.id ?? '')
    if (!ID.test(id) || ids.has(id)) return { ok: false, error: 'A line item has a bad id.' }
    const kind = raw.kind as ItemKind
    if (!KINDS.includes(kind)) return { ok: false, error: 'A line item has an unknown kind.' }
    const name = String(raw.name ?? '').trim().slice(0, 60)
    if (!name) return { ok: false, error: 'Every line item needs a name.' }
    const priceUnit = raw.priceUnit as PriceUnit
    if (!PRICE_UNITS[kind].includes(priceUnit)) return { ok: false, error: `${name}: that price unit doesn't fit.` }
    const price = num(raw.price, 0, 1_000_000)
    if (raw.price != null && raw.price !== '' && price == null) return { ok: false, error: `${name}: the price must be between $0 and $1,000,000.` }
    const color = COLOR.test(String(raw.color ?? '')) ? String(raw.color) : '#94a3b8'
    const depthIn = kind === 'area' ? num(raw.depthIn, 0, 48) : null
    if (priceUnit === 'cy' && !(depthIn && depthIn > 0)) return { ok: false, error: `${name}: priced per CY needs a depth.` }
    ids.add(id)
    items.push({ id, name, kind, priceUnit, price, color, depthIn })
  }

  const marks: SiteMark[] = []
  const markIds = new Set<string>()
  let total = 0
  for (const raw of input.marks) {
    if (!isObj(raw)) return { ok: false, error: 'A mark could not be read.' }
    const id = String(raw.id ?? '')
    if (!ID.test(id) || markIds.has(id)) return { ok: false, error: 'A mark has a bad id.' }
    const item = items.find(i => i.id === String(raw.item ?? ''))
    if (!item) return { ok: false, error: 'A mark belongs to a line item that is gone.' }
    if (!Array.isArray(raw.coords) || raw.coords.length > MAX_POINTS_PER_MARK) return { ok: false, error: `${item.name}: a shape has too many points.` }
    const coords: [number, number][] = []
    for (const c of raw.coords) {
      if (!Array.isArray(c) || c.length < 2) return { ok: false, error: `${item.name}: a point could not be read.` }
      const lng = Number(c[0]), lat = Number(c[1])
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85) return { ok: false, error: `${item.name}: a point is off the map.` }
      coords.push([lng, lat])
    }
    total += coords.length
    if (total > MAX_POINTS_TOTAL) return { ok: false, error: 'This takeoff has too many points — simplify a few shapes.' }
    const count = item.kind === 'count' && raw.count != null ? num(raw.count, 0, 10_000) : null
    if (item.kind === 'area' && coords.length < 3) return { ok: false, error: `${item.name}: an area needs at least 3 corners.` }
    if (item.kind === 'line' && coords.length < 2) return { ok: false, error: `${item.name}: a line needs at least 2 points.` }
    if (item.kind === 'count' && coords.length < 1) return { ok: false, error: `${item.name}: a count needs a point.` }
    const src = raw.src === 'wand' || raw.src === 'stall' ? raw.src : 'hand'
    const m: SiteMark = { id, item: item.id, coords, src }
    if (count != null) m.count = Math.round(count)
    if (item.kind === 'area' && raw.minus === true) m.minus = true
    markIds.add(id)
    marks.push(m)
  }
  return { ok: true, design: { v: 1, imageryId, items, marks } }
}
