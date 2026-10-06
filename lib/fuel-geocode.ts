/**
 * Placing a fuel purchase's station on the map — the server half of the fuel
 * pilot (lib/fuel-check.ts is the pure half). Photon (OpenStreetMap,
 * photon.komoot.io — the same keyless geocoder the stops classifier and the
 * "where is it" labels use, same user-agent, same manners), asked ONCE per
 * merchant per company and remembered in fuel_merchant_places (migration 130).
 *
 * What an export gives us decides how well the station is placed:
 *   - latitude/longitude columns            → exact (done at import)
 *   - a station address (fleet cards, Amex) → the brand's station nearest that
 *                                             address → exact
 *   - a bank line "SPINX #0156 GOOSE CREEK SC" → the city, then every Spinx
 *                                             around it → `brand` (the check
 *                                             measures to the nearest one), or
 *                                             exact when the town has one
 *   - only a city                           → `city` (centre + radius)
 *   - nothing usable                        → null: the checks say "can't place it"
 *
 * Fails soft: a provider error is never cached (retried next run) and never
 * blocks an import; an honest "nothing found" is cached so it is never asked
 * twice. Every call is budgeted (count and wall clock); at most three
 * merchants are looked up at once.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { abbrState, shortStreet } from './place-label'
import type { GeoPrecision, LatLng } from './fuel-check'
import { metresBetween } from './fuel-check'

const UA = 'HammerTrack (hello@hammertrack.ai)'
const PHOTON = 'https://photon.komoot.io'
const CALL_TIMEOUT_MS = 10_000

export interface PlacedMerchant {
  precision: GeoPrecision | null
  lat: number | null
  lng: number | null
  points: (LatLng & { label?: string })[]
  label: string | null
  radiusM: number | null
  source: string
}

export interface MerchantAsk {
  key: string
  brand: string | null
  name: string
  address: string | null
  city: string | null
  cityCandidates: string[]
  state: string | null
  zip: string | null
}

interface PhotonProps {
  osm_key?: string; osm_value?: string; type?: string; name?: string; housenumber?: string; street?: string
  city?: string; town?: string; village?: string; state?: string; countrycode?: string; extent?: number[]
}
interface PhotonFeature { properties?: PhotonProps; geometry?: { coordinates?: [number, number] } }

/** One budgeted session of Photon calls. `down` trips after two failures in a row. */
export class PhotonBudget {
  calls = 0
  private fails = 0
  private readonly started = Date.now()
  constructor(readonly maxCalls: number, readonly budgetMs: number) {}
  get spent(): boolean {
    return this.calls >= this.maxCalls || Date.now() - this.started > this.budgetMs || this.fails >= 2
  }
  async get(path: string): Promise<PhotonFeature[] | null> {
    if (this.spent) return null
    this.calls++
    try {
      const r = await fetch(PHOTON + path, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
      if (!r.ok) { this.fails++; return null }
      const j = (await r.json()) as { features?: PhotonFeature[] }
      this.fails = 0
      return Array.isArray(j?.features) ? j.features : []
    } catch {
      this.fails++
      return null
    }
  }
}

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const clip = (s: string | null | undefined, n = 80) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null)
const coord = (f: PhotonFeature): LatLng | null => {
  const c = f.geometry?.coordinates
  return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lat: c[1], lng: c[0] } : null
}

/** How OpenStreetMap names a brand's stations, and the name fragments that count as a match. */
const BRAND_SEARCH: Record<string, { q: string; match: string[] }> = {
  QuikTrip: { q: 'QuikTrip', match: ['quiktrip', 'qt'] },
  'Murphy USA': { q: 'Murphy USA', match: ['murphy'] },
  'TravelCenters of America': { q: 'TA', match: ['travelcenters', 'ta', 'petro'] },
  "Love's": { q: "Love's", match: ['loves'] },
  "Sam's Club": { q: "Sam's Club", match: ['samsclub', 'sams'] },
  'Kangaroo Express': { q: 'Kangaroo Express', match: ['kangaroo'] },
  'Phillips 66': { q: 'Phillips 66', match: ['phillips'] },
  Walmart: { q: 'Walmart', match: ['walmart', 'murphy'] },
}
function searchTerms(ask: MerchantAsk): { q: string; match: string[] } | null {
  if (ask.brand) return BRAND_SEARCH[ask.brand] ?? { q: ask.brand, match: [norm(ask.brand)] }
  const first = ask.name.split(/\s+/).find((w) => w.length >= 3 && !/^(the|gas|fuel|food|mart|shop|store)$/i.test(w))
  return first ? { q: ask.name, match: [norm(first)] } : null
}
const nameMatches = (name: string | undefined, match: string[]) => {
  const n = norm(name)
  return !!n && match.some((m) => (m.length <= 2 ? n === m || n.startsWith(m) : n.includes(m)))
}

interface CityHit { name: string; center: LatLng; radiusM: number; bbox: [number, number, number, number] }

async function resolveCity(b: PhotonBudget, cand: string, state: string | null, bias: LatLng | null, memo: Map<string, CityHit | null>): Promise<CityHit | null | undefined> {
  const k = `${norm(cand)}|${state ?? ''}`
  if (memo.has(k)) return memo.get(k) ?? null
  const q = encodeURIComponent(state ? `${cand}, ${state}` : cand)
  const feats = await b.get(`/api/?q=${q}&osm_tag=place&limit=6&lang=en${bias ? `&lat=${bias.lat}&lon=${bias.lng}` : ''}`)
  if (!feats) return undefined
  const want = norm(cand)
  for (const f of feats) {
    const p = f.properties ?? {}
    const at = coord(f)
    if (!at || p.osm_key !== 'place' || !['city', 'town', 'village', 'hamlet', 'suburb', 'municipality', 'neighbourhood'].includes(p.osm_value ?? '')) continue
    if (state && abbrState(p.state ?? null, p.countrycode ?? null) !== state) continue
    const got = norm(p.name)
    if (!(got === want || (want.length >= 5 && (got.startsWith(want) || want.startsWith(got))))) continue
    const e = Array.isArray(p.extent) && p.extent.length === 4 ? p.extent : null
    const bbox: [number, number, number, number] = e
      ? [Math.min(e[0], e[2]), Math.min(e[1], e[3]), Math.max(e[0], e[2]), Math.max(e[1], e[3])]
      : [at.lng - 0.05, at.lat - 0.04, at.lng + 0.05, at.lat + 0.04]
    const radiusM = Math.min(25_000, Math.max(1500, metresBetween({ lat: bbox[1], lng: bbox[0] }, { lat: bbox[3], lng: bbox[2] }) / 2))
    const hit = { name: p.name ?? cand, center: at, radiusM, bbox }
    memo.set(k, hit)
    return hit
  }
  memo.set(k, null)
  return null
}

const grow = (bb: [number, number, number, number], km: number): [number, number, number, number] => {
  const dy = km / 110.5
  const dx = km / (111.3 * Math.cos(((bb[1] + bb[3]) / 2) * Math.PI / 180))
  return [bb[0] - dx, bb[1] - dy, bb[2] + dx, bb[3] + dy]
}
const around = (p: LatLng, km: number): [number, number, number, number] => grow([p.lng, p.lat, p.lng, p.lat], km)

/** Place one merchant. undefined = the provider failed (don't cache). */
async function placeOne(b: PhotonBudget, ask: MerchantAsk, bias: LatLng | null, cityMemo: Map<string, CityHit | null>): Promise<PlacedMerchant | null | undefined> {
  // 1. The town.
  let city: CityHit | null = null
  for (const cand of ask.city ? [ask.city] : ask.cityCandidates) {
    const hit = await resolveCity(b, cand, ask.state, bias, cityMemo)
    if (hit === undefined) return undefined
    if (hit) { city = hit; break }
  }
  // 2. The street address, when the export has one.
  let anchor: LatLng | null = null
  if (ask.address) {
    const q = encodeURIComponent([ask.address, city?.name ?? ask.city, [ask.state, ask.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))
    const bz = city?.center ?? bias
    const feats = await b.get(`/api/?q=${q}&limit=3&lang=en${bz ? `&lat=${bz.lat}&lon=${bz.lng}` : ''}`)
    if (!feats) return undefined
    for (const f of feats) {
      const at = coord(f)
      const p = f.properties ?? {}
      if (!at) continue
      if (ask.state && abbrState(p.state ?? null, p.countrycode ?? null) !== ask.state) continue
      if (city && metresBetween(at, city.center) > 40_000) continue
      anchor = at
      break
    }
  }
  // 3. The brand's stations near the address, or around the town.
  const terms = searchTerms(ask)
  const bbox = anchor ? around(anchor, 2) : city ? grow(city.bbox, 6) : null
  let cands: (LatLng & { label: string })[] = []
  if (terms && bbox) {
    const feats = await b.get(`/api/?q=${encodeURIComponent(terms.q)}&osm_tag=amenity:fuel&limit=15&lang=en&bbox=${bbox.map((v) => v.toFixed(5)).join(',')}`)
    if (!feats) return undefined
    for (const f of feats) {
      const at = coord(f)
      const p = f.properties ?? {}
      if (!at || !nameMatches(p.name, terms.match)) continue
      const street = clip(p.street) ? shortStreet(clip(p.street)!) : null
      cands.push({ ...at, label: `${clip(p.name, 40) ?? terms.q}${street ? ` (${street})` : ''}` })
    }
  }
  const brandName = ask.brand ?? (ask.name || null)
  if (anchor && cands.length) {
    const best = cands.map((c) => ({ c, m: metresBetween(c, anchor!) })).sort((x, y) => x.m - y.m)[0]
    if (best.m <= 2000) return { precision: 'exact', lat: best.c.lat, lng: best.c.lng, points: [best.c], label: best.c.label, radiusM: null, source: 'address+station' }
  }
  if (!anchor && cands.length) {
    const center = city?.center ?? null
    if (center) cands = cands.sort((x, y) => metresBetween(x, center) - metresBetween(y, center))
    cands = cands.slice(0, 12)
    if (cands.length === 1) return { precision: 'exact', lat: cands[0].lat, lng: cands[0].lng, points: cands, label: cands[0].label, radiusM: null, source: 'station' }
    return {
      precision: 'brand', lat: cands[0].lat, lng: cands[0].lng, points: cands,
      label: `${brandName ?? 'station'} in ${city?.name ?? 'the area'}`, radiusM: null, source: 'brand',
    }
  }
  if (anchor) {
    return { precision: 'city', lat: anchor.lat, lng: anchor.lng, points: [anchor], label: `${shortStreet(ask.address ?? '')}${city ? `, ${city.name}` : ''}`.slice(0, 80), radiusM: 1500, source: 'address' }
  }
  if (city) return { precision: 'city', lat: city.center.lat, lng: city.center.lng, points: [city.center], label: city.name, radiusM: Math.round(city.radiusM), source: 'city' }
  return null
}

type Db = SupabaseClient

/**
 * Place many merchants for one company: the cache first, then Photon within
 * the budget. Keys left over (budget spent, provider down) come back absent —
 * the caller leaves those rows unplaced and the next run tries again.
 */
export async function placeMerchants(db: Db, companyId: string, asks: MerchantAsk[], opts: { maxCalls: number; budgetMs: number; bias: LatLng | null }):
  Promise<Map<string, PlacedMerchant | null>> {
  const out = new Map<string, PlacedMerchant | null>()
  const uniq = Array.from(new Map(asks.filter((a) => a.key).map((a) => [a.key, a])).values())
  if (!uniq.length) return out
  for (let i = 0; i < uniq.length; i += 200) {
    const { data } = await db.from('fuel_merchant_places').select('key, precision, lat, lng, points, label, radius_m, source')
      .eq('company_id', companyId).in('key', uniq.slice(i, i + 200).map((a) => a.key))
    for (const r of (data ?? []) as { key: string; precision: GeoPrecision | null; lat: number | null; lng: number | null; points: unknown; label: string | null; radius_m: number | null; source: string }[]) {
      out.set(r.key, r.precision ? {
        precision: r.precision, lat: r.lat, lng: r.lng, points: cleanPoints(r.points), label: r.label, radiusM: r.radius_m, source: r.source,
      } : null)
    }
  }
  const todo = uniq.filter((a) => !out.has(a.key))
  if (!todo.length) return out
  const budget = new PhotonBudget(opts.maxCalls, opts.budgetMs)
  const cityMemo = new Map<string, CityHit | null>()
  // Up to three merchants at a time — the public Photon instance answers in
  // seconds, not milliseconds, and a night's backlog must fit the cron.
  let next = 0
  const worker = async () => {
    while (next < todo.length && !budget.spent) {
      const ask = todo[next++]
      const placed = await placeOne(budget, ask, opts.bias, cityMemo)
      if (placed === undefined) continue
      out.set(ask.key, placed)
      const { error } = await db.from('fuel_merchant_places').upsert({
        company_id: companyId, key: ask.key, precision: placed?.precision ?? null, lat: placed?.lat ?? null, lng: placed?.lng ?? null,
        points: placed?.points ?? null, label: placed?.label ?? null, radius_m: placed?.radiusM ?? null, source: placed?.source ?? 'none',
      }, { onConflict: 'company_id,key' })
      if (error && error.code !== '42P01') console.error('fuel_merchant_places write failed:', error.message)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker))
  return out
}

export function cleanPoints(raw: unknown): (LatLng & { label?: string })[] {
  if (!Array.isArray(raw)) return []
  const out: (LatLng & { label?: string })[] = []
  for (const p of raw.slice(0, 12)) {
    if (!p || typeof p !== 'object') continue
    const o = p as { lat?: unknown; lng?: unknown; label?: unknown }
    const lat = Number(o.lat), lng = Number(o.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      out.push({ lat, lng, ...(typeof o.label === 'string' ? { label: o.label.slice(0, 80) } : {}) })
    }
  }
  return out
}

/**
 * A fuel station within ~150 m of a stop: its name, '' when OpenStreetMap
 * has none there, undefined when the lookup couldn't be made. Remembered per
 * ~100 m cell with the merchant places (key `rev:`). A plain reverse lookup
 * is wrong here — at a Spinx the nearest object is the convenience store
 * building, not the pumps — so this asks for fuel stations only.
 */
export async function fuelStationNear(db: Db, companyId: string, at: LatLng, b: PhotonBudget, memo: Map<string, string>): Promise<string | undefined> {
  const key = `rev:${at.lat.toFixed(3)},${at.lng.toFixed(3)}`
  if (memo.has(key)) return memo.get(key)
  const { data } = await db.from('fuel_merchant_places').select('label').eq('company_id', companyId).eq('key', key).maybeSingle()
  if (data) {
    const v = (data as { label: string | null }).label ?? ''
    memo.set(key, v)
    return v
  }
  const feats = await b.get(`/reverse?lat=${at.lat}&lon=${at.lng}&limit=1&radius=0.15&osm_tag=amenity:fuel&lang=en`)
  if (!feats) return undefined
  const f = feats[0]
  const pt = f ? coord(f) : null
  const name = f && pt && metresBetween(pt, at) <= 200 ? (clip(f.properties?.name, 40) ?? 'a fuel station') : ''
  memo.set(key, name)
  await db.from('fuel_merchant_places').upsert({
    company_id: companyId, key, precision: name ? 'exact' : null, lat: pt?.lat ?? null, lng: pt?.lng ?? null, points: null, label: name, radius_m: null, source: 'reverse',
  }, { onConflict: 'company_id,key' })
  return name
}
