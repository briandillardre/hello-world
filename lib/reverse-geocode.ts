/**
 * Reverse geocoding for "where is it" labels — server half. See
 * lib/place-label.ts for the wording and the cell key.
 *
 * Two free, keyless providers, asked ONCE per ~100 m cell and remembered in
 * geocode_cache (migration 098) plus a per-instance memory:
 *   1. Photon (OSM, photon.komoot.io) — nearest object: housenumber + street,
 *      or a road's name, plus city/state. The stops classifier already uses it
 *      (lib/poi-server.ts), same user-agent, same manners.
 *   2. BigDataCloud client API — city/state only, the fallback when Photon has
 *      no city for the point (rural roads) or is down.
 * A provider ERROR is not cached (next load retries); an honest "nothing here"
 * is, so the ocean is never asked twice.
 */
import { placeKey, abbrState, type PlaceParts } from './place-label'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UA = 'HammerTrack (hello@hammertrack.ai)'
const TIMEOUT_MS = 5000
const CONCURRENCY = 4
const MEM_CAP = 5000
/** Wall-clock budget for one resolve: a hung provider (5 s per call) must
 *  not run a 25-cell batch past the route's 30 s function limit and lose the
 *  answers already in hand (ship-check P2). Cells left over are asked next load. */
const BUDGET_MS = 15_000

/** null = looked up, nothing known (an honest empty). */
const mem = new Map<string, PlaceParts | null>()
function remember(key: string, parts: PlaceParts | null) {
  if (mem.size >= MEM_CAP) mem.clear()
  mem.set(key, parts)
}

const empty = (p: PlaceParts | null) => !p || (!p.street && !p.city && !p.state)

type Db = Awaited<ReturnType<typeof import('./supabase-server').createServiceClient>>
async function serviceDb(): Promise<Db | null> {
  if (isMock) return null
  try {
    const { createServiceClient } = await import('./supabase-server')
    return createServiceClient()
  } catch { return null }
}

/** Cache-only lookup (memory, then the table). No network — safe on a page's
 *  render path. Keys absent from the result are unknown, not empty. */
export async function lookupCachedPlaces(keys: string[]): Promise<Record<string, PlaceParts | null>> {
  const out: Record<string, PlaceParts | null> = {}
  const miss: string[] = []
  for (const k of Array.from(new Set(keys))) {
    if (mem.has(k)) out[k] = mem.get(k) ?? null
    else miss.push(k)
  }
  if (!miss.length) return out
  const db = await serviceDb()
  if (!db) return out
  for (let i = 0; i < miss.length; i += 200) {
    const { data, error } = await db.from('geocode_cache').select('key, street, city, state').in('key', miss.slice(i, i + 200))
    if (error) { console.error('geocode_cache read failed:', error.message); break }
    for (const r of (data ?? []) as { key: string; street: string | null; city: string | null; state: string | null }[]) {
      const parts: PlaceParts = { street: r.street, city: r.city, state: r.state }
      const v = empty(parts) ? null : parts
      remember(r.key, v)
      out[r.key] = v
    }
  }
  return out
}

/** `ok` = the provider answered (even with nothing); false = down/timeout. */
async function getJson(url: string): Promise<{ ok: boolean; json: unknown }> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) return { ok: false, json: null }
    return { ok: true, json: await r.json() }
  } catch { return { ok: false, json: null } }
}

/** Provider strings are stored and shown as-is (React-escaped) — bound them. */
const clip = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, 120) : null
}

type PhotonProps = {
  osm_key?: string; osm_value?: string; name?: string; housenumber?: string; street?: string
  city?: string; town?: string; village?: string; locality?: string; district?: string; county?: string
  state?: string; countrycode?: string
}

function parsePhoton(j: unknown): PlaceParts | null {
  const p = (j as { features?: { properties?: PhotonProps }[] } | null)?.features?.[0]?.properties
  if (!p) return null
  // A road has its name in `name` (no `street`); a building/POI carries the
  // street it sits on. Either way, "near <that>" is the honest phrasing.
  const streetName = clip(p.street) || (p.osm_key === 'highway' ? clip(p.name) : null)
  const street = streetName ? [clip(p.housenumber), streetName].filter(Boolean).join(' ') : null
  const city = clip(p.city) || clip(p.town) || clip(p.village) || clip(p.locality)
  const county = clip(p.county) ? `${clip(p.county)} County` : null
  return { street, city: city ?? county, state: clip(abbrState(clip(p.state), clip(p.countrycode))) }
}

type BdcJson = { city?: string; locality?: string; principalSubdivision?: string; principalSubdivisionCode?: string; countryCode?: string }
function parseBdc(j: unknown): PlaceParts | null {
  const b = j as BdcJson | null
  if (!b) return null
  const city = clip(b.city) || clip(b.locality)
  const code = typeof b.principalSubdivisionCode === 'string' && b.principalSubdivisionCode.includes('-')
    ? clip(b.principalSubdivisionCode.split('-').pop()) : null
  const state = code ?? clip(abbrState(clip(b.principalSubdivision), clip(b.countryCode)))
  if (!city && !state) return null
  return { street: null, city, state }
}

/** One cell: Photon first; BigDataCloud fills a missing city (or stands in
 *  when Photon is down). `ok` = at least one provider answered. */
async function geocode(lat: number, lng: number): Promise<{ parts: PlaceParts | null; ok: boolean; source: string }> {
  const ph = await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`)
  const photon = ph.ok ? parsePhoton(ph.json) : null
  if (photon && photon.city && !/ County$/.test(photon.city)) return { parts: photon, ok: true, source: 'photon' }
  const bd = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
  const bdc = bd.ok ? parseBdc(bd.json) : null
  if (bdc) {
    // Keep Photon's street; take BDC's city (a real town beats "Pickens County").
    const merged: PlaceParts = { street: photon?.street ?? null, city: bdc.city ?? photon?.city ?? null, state: bdc.state ?? photon?.state ?? null }
    return { parts: merged, ok: true, source: ph.ok ? 'photon+bdc' : 'bdc' }
  }
  // Both answered with nothing (open water, wilderness) = an honest empty,
  // cached so the cell is never asked again; a provider outage is not.
  return { parts: photon, ok: ph.ok || bd.ok, source: ph.ok ? 'photon' : bd.ok ? 'bdc' : 'none' }
}

/**
 * Resolve many points to place parts: memory → table → providers (bounded:
 * `maxGeocodes` network lookups per call, `CONCURRENCY` at a time). Points
 * left over come back absent (unknown), never wrong. Same key on both ends.
 */
export async function resolvePlaces(points: { lat: number; lng: number }[], maxGeocodes = 25): Promise<Record<string, PlaceParts | null>> {
  const byKey = new Map<string, { lat: number; lng: number }>()
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue
    const k = placeKey(p.lat, p.lng)
    if (!byKey.has(k)) byKey.set(k, p)
  }
  const out = await lookupCachedPlaces(Array.from(byKey.keys()))
  const todo = Array.from(byKey.entries()).filter(([k]) => !(k in out)).slice(0, maxGeocodes)
  if (!todo.length) return out

  const db = await serviceDb()
  const started = Date.now()
  let i = 0
  const worker = async () => {
    while (i < todo.length && Date.now() - started < BUDGET_MS) {
      const [key, pt] = todo[i++]
      const r = await geocode(pt.lat, pt.lng)
      if (!r.ok) continue // provider trouble: leave unknown, retry next load
      const v = empty(r.parts) ? null : r.parts
      remember(key, v)
      out[key] = v
      // Written per cell, so a batch cut short by the budget keeps what it learned.
      if (db) {
        const { error } = await db.from('geocode_cache')
          .upsert({ key, street: v?.street ?? null, city: v?.city ?? null, state: v?.state ?? null, source: r.source }, { onConflict: 'key', ignoreDuplicates: true })
        if (error && error.code !== '42P01') console.error('geocode_cache write failed:', error.message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
  return out
}
