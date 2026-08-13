import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * South Carolina road closures / incidents / work zones for the map layer.
 *
 * No single blessed feed exists, so this proxies a FALLBACK CHAIN (same idea
 * as the lightning route's bucket list) tried in order until one answers:
 *
 *   1. 511sc — SC 511's public JSON events API (Castle Rock platform
 *      convention: /api/v2/get/event, same shape as 511on.ca / 511ga etc.:
 *      Latitude/Longitude/EventType/RoadwayName/Description, epoch-second
 *      dates).
 *   2. scdot-arcgis — SCDOT's ArcGIS REST server root (gis.scdot.org),
 *      DISCOVERED at runtime: list services, pick the first one whose name
 *      smells like incidents/closures/work zones, query layer 0. Survives
 *      SCDOT renaming the service under us.
 *   3. wzdx-registry — USDOT's Work Zone Data Exchange feed registry on
 *      data.transportation.gov (Socrata dataset 69qe-yiui) filtered to SC,
 *      then the state's WZDx GeoJSON feed itself.
 *
 * Statewide result is module-cached 5 min; each request trims to its bbox.
 * All sources dead → 503 { error } and the client's ht:layer-error row says
 * so honestly. Field names are normalized defensively — these schemas are
 * not under our control.
 */

interface Closure {
  lat: number
  lng: number
  kind: 'closure' | 'workzone' | 'incident' | 'other'
  road: string | null
  desc: string | null
  start: string | null
  end: string | null
}

const CACHE_MS = 5 * 60_000
const MAX_ROWS = 800
let cache: { at: number; closures: Closure[]; source: string } | null = null
let inflight: Promise<void> | null = null
// Last failure per source — enough to diagnose a dead layer from the phone.
let diag: Record<string, string> = {}

// ── normalization helpers ──────────────────────────────────────────────────

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Epoch seconds, epoch ms, or a date string → ISO; anything else → null. */
function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const ms = v < 10_000_000_000 ? v * 1000 : v // seconds vs ms heuristic
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    return Number.isFinite(t) ? new Date(t).toISOString() : null
  }
  return null
}

/** First value in `obj` whose key matches `re` (case-insensitive). */
function pick(obj: Record<string, unknown>, re: RegExp): unknown {
  for (const k of Object.keys(obj)) if (re.test(k)) {
    const v = obj[k]
    if (v !== null && v !== undefined && v !== '') return v
  }
  return undefined
}

function toKind(raw: unknown, fullClosure?: unknown): Closure['kind'] {
  if (fullClosure === true || fullClosure === 'true') return 'closure'
  const s = String(raw ?? '').toLowerCase()
  if (/clos/.test(s)) return 'closure'
  if (/work|construc|maint/.test(s)) return 'workzone'
  if (/incident|accident|crash|hazard/.test(s)) return 'incident'
  return 'other'
}

// ── source 1: SC 511 (Castle Rock /api/v2/get/event convention) ───────────

async function from511sc(): Promise<Closure[]> {
  const r = await fetch('https://www.511sc.org/api/v2/get/event?format=json&lang=en', {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
    headers: { 'User-Agent': 'HammerTrack fleet map (hammertrack.ai)' },
  })
  if (!r.ok) throw new Error(`511sc ${r.status}`)
  const j = await r.json()
  const list: unknown[] = Array.isArray(j) ? j : []
  const out: Closure[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const lat = num(pick(e, /^lat(itude)?$/i))
    const lng = num(pick(e, /^(lng|lon|longitude)$/i))
    if (lat == null || lng == null) continue
    out.push({
      lat, lng,
      kind: toKind(pick(e, /event.?type|^type$/i), pick(e, /full.?closure/i)),
      road: str(pick(e, /roadway|road.?name|route/i)),
      desc: str(pick(e, /^description$|^desc$|comment/i)),
      start: toIso(pick(e, /start.?date|^reported$/i)),
      end: toIso(pick(e, /planned.?end|end.?date/i)),
    })
    if (out.length >= MAX_ROWS) break
  }
  if (!out.length) throw new Error('511sc: 0 mappable events')
  return out
}

// ── source 2: SCDOT ArcGIS server, service discovered at runtime ──────────

const ARCGIS_ROOT = 'https://gis.scdot.org/arcgis/rest/services'
const SERVICE_RE = /closur|incident|event|work.?zone|lane|511|traffic/i

async function arcgisJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`arcgis ${r.status}`)
  const j = await r.json()
  if (j?.error) throw new Error(`arcgis: ${JSON.stringify(j.error).slice(0, 120)}`)
  return j
}

async function fromScdotArcgis(): Promise<Closure[]> {
  const root = await arcgisJson(`${ARCGIS_ROOT}?f=json`) as {
    folders?: string[]
    services?: { name: string; type: string }[]
  }
  const services: { name: string; type: string }[] = [...(root.services ?? [])]
  // One level of likely folders — keep discovery bounded.
  for (const folder of (root.folders ?? []).filter((f) => SERVICE_RE.test(f)).slice(0, 3)) {
    try {
      const sub = await arcgisJson(`${ARCGIS_ROOT}/${folder}?f=json`) as { services?: { name: string; type: string }[] }
      services.push(...(sub.services ?? []))
    } catch { /* folder listing down — keep going */ }
  }
  const svc = services.find((s) => SERVICE_RE.test(s.name) && /MapServer|FeatureServer/.test(s.type))
  if (!svc) throw new Error('scdot-arcgis: no closure-like service found')
  const q = `${ARCGIS_ROOT}/${svc.name}/${svc.type}/0/query?where=1%3D1&outFields=*&outSR=4326&resultRecordCount=${MAX_ROWS}&f=json`
  const j = await arcgisJson(q) as {
    features?: { attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number; paths?: number[][][]; points?: number[][] } }[]
  }
  const out: Closure[] = []
  for (const f of j.features ?? []) {
    const a = f.attributes ?? {}
    const g = f.geometry
    const lng = num(g?.x) ?? num(g?.paths?.[0]?.[0]?.[0]) ?? num(g?.points?.[0]?.[0]) ?? num(pick(a, /^(lng|lon|longitude|x)$/i))
    const lat = num(g?.y) ?? num(g?.paths?.[0]?.[0]?.[1]) ?? num(g?.points?.[0]?.[1]) ?? num(pick(a, /^(lat|latitude|y)$/i))
    if (lat == null || lng == null) continue
    out.push({
      lat, lng,
      kind: toKind(pick(a, /event.?type|closure.?type|^type$|category|status/i)),
      road: str(pick(a, /route|road|street|highway|corridor/i)),
      desc: str(pick(a, /desc|comment|message|detail|remarks/i)),
      start: toIso(pick(a, /start|begin/i)),
      end: toIso(pick(a, /end|complete|reopen/i)),
    })
    if (out.length >= MAX_ROWS) break
  }
  if (!out.length) throw new Error(`scdot-arcgis: ${svc.name} returned 0 mappable rows`)
  return out
}

// ── source 3: WZDx feed via the USDOT feed registry ────────────────────────

async function fromWzdx(): Promise<Closure[]> {
  const reg = await fetch('https://data.transportation.gov/resource/69qe-yiui.json?state=SC', {
    signal: AbortSignal.timeout(10_000), cache: 'no-store',
  })
  if (!reg.ok) throw new Error(`wzdx registry ${reg.status}`)
  const rows = await reg.json()
  let feedUrl: string | null = null
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue
    for (const v of Object.values(row as Record<string, unknown>)) {
      const s = typeof v === 'string' ? v : (v as { url?: string } | null)?.url
      if (typeof s === 'string' && /^https?:\/\//.test(s) && !/transportation\.gov/.test(s)) { feedUrl = s; break }
    }
    if (feedUrl) break
  }
  if (!feedUrl) throw new Error('wzdx: no SC feed URL in registry')
  const r = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`wzdx feed ${r.status}`)
  const j = await r.json() as {
    features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[]
  }
  const out: Closure[] = []
  for (const f of j.features ?? []) {
    let lng: number | null = null, lat: number | null = null
    const c = f.geometry?.coordinates as number[] | number[][] | number[][][] | undefined
    if (f.geometry?.type === 'Point' && Array.isArray(c)) {
      lng = num(c[0]); lat = num(c[1])
    } else if (Array.isArray(c) && Array.isArray(c[0])) {
      const first = Array.isArray((c[0] as unknown[])[0]) ? (c as number[][][])[0][0] : (c as number[][])[0]
      lng = num(first?.[0]); lat = num(first?.[1])
    }
    if (lat == null || lng == null) continue
    const p = f.properties ?? {}
    const core = (p.core_details && typeof p.core_details === 'object' ? p.core_details : p) as Record<string, unknown>
    const roads = core.road_names
    const rawType = core.event_type ?? pick(core, /event.?type|^type$/i)
    const kind = toKind(rawType)
    out.push({
      lat, lng,
      // WZDx is the work-zone exchange — an unrecognized type is still a work zone.
      kind: kind === 'other' ? 'workzone' : kind,
      road: Array.isArray(roads) ? str(roads[0]) : str(roads ?? pick(core, /road|route/i)),
      desc: str(core.description ?? pick(core, /desc/i)),
      start: toIso(p.start_date ?? pick(p, /start.?date/i)),
      end: toIso(p.end_date ?? pick(p, /end.?date/i)),
    })
    if (out.length >= MAX_ROWS) break
  }
  if (!out.length) throw new Error('wzdx: 0 mappable features')
  return out
}

// ── route ──────────────────────────────────────────────────────────────────

const SOURCES: { name: string; pull: () => Promise<Closure[]> }[] = [
  { name: '511sc', pull: from511sc },
  { name: 'scdot-arcgis', pull: fromScdotArcgis },
  { name: 'wzdx-registry', pull: fromWzdx },
]

async function refresh(): Promise<void> {
  diag = {}
  for (const s of SOURCES) {
    try {
      const closures = await s.pull()
      cache = { at: Date.now(), closures, source: s.name }
      return
    } catch (e) {
      diag[s.name] = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error('all road-closure sources failed')
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const w = Number(sp.get('w')), s = Number(sp.get('s')), e = Number(sp.get('e')), n = Number(sp.get('n'))
  if (![w, s, e, n].every(Number.isFinite)) {
    return NextResponse.json({ error: 'w/s/e/n bbox required' }, { status: 400 })
  }

  if (!cache || Date.now() - cache.at > CACHE_MS) {
    try {
      // Single-flight: concurrent viewers at cache expiry share one pull.
      if (!inflight) inflight = refresh().finally(() => { inflight = null })
      await inflight
    } catch (err) {
      if (cache) {
        // Stale beats blank while the feeds hiccup.
        const inBox = cache.closures.filter((c) => c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n)
        return NextResponse.json({ closures: inBox, at: new Date(cache.at).toISOString(), source: cache.source, stale: true })
      }
      const msg = err instanceof Error ? err.message : 'road closure feeds unreachable'
      return NextResponse.json({ error: msg, diag }, { status: 503 })
    }
  }

  const inBox = (cache?.closures ?? []).filter((c) => c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n)
  return NextResponse.json({
    closures: inBox,
    at: cache ? new Date(cache.at).toISOString() : null,
    source: cache?.source ?? null,
  })
}
