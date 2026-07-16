/**
 * POI stop classification — turns "parked at 34.8,-82.4 for 2 hours" into
 * "2h 05m at Sunbelt Rentals · Supplier".
 *
 * Classification reads OpenStreetMap category tags (osm_key/osm_value from
 * the Photon reverse geocoder) — free, community-maintained, auto-updated.
 * Stops inside a company zone never geocode: the zone IS the answer.
 */

export type PoiKind =
  | 'site'        // inside one of the company's own zones
  | 'supplier'    // building materials, hardware, industrial yards
  | 'fuel'
  | 'food'
  | 'government'  // DMV, courthouse, post office, permits
  | 'dealer'      // vehicle/equipment sales
  | 'service'     // repair shops, car wash
  | 'store'       // other retail
  | 'residence'
  | 'other'

export const POI_KIND_META: Record<PoiKind, { label: string; cls: string }> = {
  site:       { label: 'Job site',   cls: 'bg-amber/15 text-amber border-amber/40' },
  supplier:   { label: 'Supplier',   cls: 'bg-teal/15 text-teal border-teal/40' },
  fuel:       { label: 'Fuel',       cls: 'bg-[#60a5fa]/15 text-[#60a5fa] border-[#60a5fa]/40' },
  food:       { label: 'Food',       cls: 'bg-orange-400/15 text-orange-300 border-orange-400/40' },
  government: { label: 'Government', cls: 'bg-purple-400/15 text-purple-300 border-purple-400/40' },
  dealer:     { label: 'Dealer',     cls: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/40' },
  service:    { label: 'Service',    cls: 'bg-cyan-400/15 text-cyan-300 border-cyan-400/40' },
  store:      { label: 'Store',      cls: 'bg-pink-400/15 text-pink-300 border-pink-400/40' },
  residence:  { label: 'Residence',  cls: 'bg-navy-700/60 text-muted border-navy-600' },
  other:      { label: 'Stop',       cls: 'bg-navy-700/60 text-muted border-navy-600' },
}

/** Solid hex per kind — for map pins, where tailwind classes can't reach. */
export const POI_KIND_COLOR: Record<PoiKind, string> = {
  site: '#f5a623', supplier: '#2dd4bf', fuel: '#60a5fa', food: '#fb923c',
  government: '#c084fc', dealer: '#34d399', service: '#22d3ee', store: '#f472b6',
  residence: '#8fa3b8', other: '#8fa3b8',
}

const SUPPLIER_SHOPS = new Set(['doityourself', 'hardware', 'trade', 'building_materials', 'electrical', 'plumbing', 'garden_centre', 'agrarian', 'wholesale', 'landscaping'])
const DEALER_SHOPS = new Set(['car', 'car_parts', 'truck', 'tyres', 'motorcycle', 'trailer'])
const FOOD_AMENITIES = new Set(['restaurant', 'fast_food', 'cafe', 'bar', 'food_court', 'ice_cream', 'pub'])
const GOV_AMENITIES = new Set(['townhall', 'courthouse', 'post_office', 'police', 'fire_station', 'public_building', 'library', 'community_centre'])

export function classifyOsm(key?: string, value?: string): PoiKind {
  const k = key ?? ''
  const v = value ?? ''
  if (k === 'amenity') {
    if (v === 'fuel' || v === 'charging_station') return 'fuel'
    if (FOOD_AMENITIES.has(v)) return 'food'
    if (GOV_AMENITIES.has(v)) return 'government'
    if (v === 'car_wash' || v === 'vehicle_inspection') return 'service'
  }
  if (k === 'office' && (v === 'government' || v === 'administrative')) return 'government'
  if (k === 'shop') {
    if (SUPPLIER_SHOPS.has(v)) return 'supplier'
    if (DEALER_SHOPS.has(v)) return 'dealer'
    if (v === 'car_repair') return 'service'
    return 'store'
  }
  if (k === 'craft') return 'service'
  if (k === 'landuse' && (v === 'industrial' || v === 'construction' || v === 'quarry')) return 'supplier'
  if (k === 'man_made' || k === 'industrial') return 'supplier'
  if (k === 'building' && (v === 'residential' || v === 'house' || v === 'detached' || v === 'apartments')) return 'residence'
  if (k === 'place' && (v === 'house' || v === 'neighbourhood')) return 'residence'
  if (k === 'highway' && v === 'residential') return 'residence'
  return 'other'
}

export interface StopRow { lat: number; lng: number; speed: number | null; timestamp: string }

export interface RawStop {
  fromMs: number
  toMs: number
  minutes: number
  lat: number
  lng: number
}

// A stop = staying put (< 2 mph AND barely moving) for at least this long.
const MIN_STOP_MS = 5 * 60_000
// Positions within a stop can wander (GPS drift); allow this much.
const DRIFT_M = 120

/** Segment chronological rows into stops (newest first, capped). */
export function segmentStops(rows: StopRow[], nowMs = Date.now(), cap = 30): RawStop[] {
  const pts = rows
    .map((r) => ({ ...r, ms: Date.parse(r.timestamp) }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms)
  const stops: RawStop[] = []
  let anchor: { lat: number; lng: number; ms: number } | null = null
  let lastMs = 0

  const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
  const close = (endMs: number) => {
    if (anchor && endMs - anchor.ms >= MIN_STOP_MS) {
      stops.push({ fromMs: anchor.ms, toMs: endMs, minutes: Math.round((endMs - anchor.ms) / 60_000), lat: anchor.lat, lng: anchor.lng })
    }
    anchor = null
  }

  for (const p of pts) {
    const moving = (p.speed ?? 0) >= 2
    if (!moving) {
      if (anchor) {
        const dist = Math.hypot((p.lng - anchor.lng) * kx(anchor.lat), (p.lat - anchor.lat) * 110_540)
        if (dist > DRIFT_M) { close(lastMs); anchor = { lat: p.lat, lng: p.lng, ms: p.ms } }
      } else {
        anchor = { lat: p.lat, lng: p.lng, ms: p.ms }
      }
    } else {
      close(lastMs || p.ms)
    }
    lastMs = p.ms
  }
  // Open stop at the end of data: still parked there right now.
  if (anchor) close(Math.min(nowMs, lastMs + 90 * 60_000) > lastMs ? Math.max(lastMs, Math.min(nowMs, lastMs + 90 * 60_000)) : lastMs)

  return stops.reverse().slice(0, cap)
}
