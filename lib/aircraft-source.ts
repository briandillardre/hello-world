import { gunzipSync } from 'zlib'
import { parseTrace, type TraceIdent } from './aircraft-log'

/**
 * The upstream side of the flight log: adsb.lol for tracks, adsbdb for
 * identity. Server-only — both are keyless community services and neither
 * should ever be called straight from a browser at our users' volume.
 *
 * ETIQUETTE, because these people give the data away for free:
 *  • Archive days are immutable once the day is over, so a day we have read
 *    once is never read again — it goes into `aircraft_flights` and stays.
 *  • Day files are fetched with a small stagger, never thirty at once.
 *  • Everything is cached in-process on top of that.
 *  • adsb.lol data is ODbL; the UI credits it wherever flights are shown.
 *  • adsbdb's route database stays query-and-display — we look up one
 *    airframe at a time and never bulk-import it (same rule as the map
 *    popup, docs/AGENT-INTERFACE.md).
 */

const UA = 'HammerTrack flight log (hello@hammertrack.ai)'

/** What the upstream archive actually keeps — probed, not assumed. */
export const ARCHIVE_DAYS = 30

/** Only these hosts, even after a redirect. */
const ALLOWED_HOSTS = new Set(['adsb.lol', 'globe.adsb.lol', 'api.adsbdb.com'])
/** A day file is tens to low hundreds of KB; anything near this is not one. */
const MAX_BYTES = 25 * 1024 * 1024

async function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'User-Agent': UA },
  })
  // Redirects are followed (the archive host uses them), but never off the
  // services we meant to call, and never into an unbounded body — a
  // decompression bomb would take the whole function down (sec-check).
  if (!ALLOWED_HOSTS.has(new URL(r.url).hostname)) throw new Error('redirected off-host')
  if (r.status === 404) return null // the aircraft did not fly that day
  if (!r.ok) throw new Error(`${r.status}`)
  const declared = Number(r.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new Error('response too large')
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) throw new Error('response too large')
  // The archive host hands back gzip bytes without a content-encoding header.
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    return null // an HTML error page is "no data", not a crash
  }
}

/** `YYYY-MM-DD` in UTC — the archive is cut on UTC days. */
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10)

/** The UTC days the upstream archive can still answer for, newest first. */
export function availableDays(now = new Date(), days = ARCHIVE_DAYS): string[] {
  const out: string[] = []
  for (let i = 0; i < days; i++) out.push(utcDay(new Date(now.getTime() - i * 86_400_000)))
  return out
}

/**
 * Cached day files, bounded by BYTES rather than entry count. Capping at 400
 * entries was capping nothing useful: one busy airliner day is megabytes of
 * text and several times that once parsed, so a full cache could outgrow the
 * whole lambda (sec-check, Sep 12).
 */
const traceCache = new Map<string, { at: number; raw: unknown | null; bytes: number }>()
let traceCacheBytes = 0
const TRACE_CACHE_MAX_BYTES = 40 * 1024 * 1024

function cacheTrace(key: string, raw: unknown | null, bytes: number) {
  const prev = traceCache.get(key)
  if (prev) traceCacheBytes -= prev.bytes
  traceCache.set(key, { at: Date.now(), raw, bytes })
  traceCacheBytes += bytes
  // Map preserves insertion order, so this drops the oldest first.
  while (traceCacheBytes > TRACE_CACHE_MAX_BYTES && traceCache.size > 1) {
    const oldest = traceCache.keys().next()
    if (oldest.done) break
    const e = traceCache.get(oldest.value)
    if (e) traceCacheBytes -= e.bytes
    traceCache.delete(oldest.value)
  }
}
// Today's file keeps growing; a finished day never changes again.
const TODAY_TTL = 60_000
const PAST_TTL = 6 * 3_600_000

/**
 * One UTC day of track for one airframe, or null when it did not fly (or the
 * day has aged out of the archive — indistinguishable upstream, and the same
 * answer for our purposes: nothing to show).
 */
export async function fetchTraceDay(hex: string, day: string, now = new Date()): Promise<unknown | null> {
  const h = hex.toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(h)) return null
  const key = `${h}:${day}`
  const isToday = day === utcDay(now)
  const hit = traceCache.get(key)
  if (hit && Date.now() - hit.at < (isToday ? TODAY_TTL : PAST_TTL)) return hit.raw

  const tail = h.slice(-2)
  const url = isToday
    ? `https://adsb.lol/data/traces/${tail}/trace_full_${h}.json`
    : `https://adsb.lol/globe_history/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}/traces/${tail}/trace_full_${h}.json`
  try {
    const raw = await getJson(url, 15_000)
    // Rough, and deliberately so — an exact size would cost another
    // stringify of the thing we are trying not to hold too much of.
    cacheTrace(key, raw, raw ? (((raw as { trace?: unknown[] }).trace?.length ?? 0) * 220 + 2048) : 256)
    return raw
  } catch {
    // A transient upstream failure must not be cached as "did not fly" —
    // that would blank a real day for six hours.
    return hit?.raw ?? null
  }
}

/**
 * Several days, gently: a small stagger rather than a thundering herd, and a
 * hard cap so one request can never turn into thirty upstream fetches at
 * once. Days already banked in our own tables never reach here.
 */
export async function fetchTraceDays(
  hex: string,
  days: string[],
  now = new Date(),
): Promise<{ day: string; raw: unknown }[]> {
  const out: { day: string; raw: unknown }[] = []
  const CONCURRENCY = 3
  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const batch = await Promise.all(days.slice(i, i + CONCURRENCY).map((d) => fetchTraceDay(hex, d, now)))
    batch.forEach((raw, k) => { if (raw) out.push({ day: days[i + k], raw }) })
    if (i + CONCURRENCY < days.length) await new Promise((r) => setTimeout(r, 120))
  }
  return out
}

export interface AircraftIdent extends TraceIdent {
  manufacturer: string | null
}

interface AdsbdbAircraft {
  response?: {
    aircraft?: {
      mode_s?: string
      registration?: string
      type?: string
      icao_type?: string
      manufacturer?: string
      registered_owner?: string
    }
  }
}

const identCache = new Map<string, { at: number; ident: AircraftIdent | null }>()
const IDENT_TTL = 24 * 3_600_000

/**
 * Resolve a tail number OR an icao24 hex to one airframe. adsbdb answers both
 * directions from the same endpoint, so a person can type either and does not
 * have to know which is which.
 *
 * The query is shaped-checked before it is interpolated into the upstream
 * URL — this string comes from a search box.
 */
export async function lookupAircraft(query: string): Promise<AircraftIdent | null> {
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (q.length < 3 || q.length > 10) return null
  const hit = identCache.get(q)
  if (hit && Date.now() - hit.at < IDENT_TTL) return hit.ident

  let ident: AircraftIdent | null = null
  try {
    const j = (await getJson(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(q)}`, 8_000)) as AdsbdbAircraft | null
    const a = j?.response?.aircraft
    const hex = a?.mode_s?.toLowerCase().replace(/[^0-9a-f]/g, '') ?? ''
    if (a && /^[0-9a-f]{6}$/.test(hex)) {
      const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
      const mfr = str(a.manufacturer)
      const model = str(a.type)
      ident = {
        hex,
        reg: str(a.registration),
        typeCode: str(a.icao_type),
        desc: [mfr, model].filter(Boolean).join(' ') || null,
        owner: str(a.registered_owner),
        year: null,
        manufacturer: mfr,
      }
    }
  } catch {
    if (hit) return hit.ident // stale identity beats no answer; it barely changes
    return null
  }
  if (identCache.size > 500) identCache.clear()
  identCache.set(q, { at: Date.now(), ident })
  return ident
}

/**
 * Identity straight off a trace file — the fallback when adsbdb has never
 * heard of an airframe but it is transmitting anyway (common for new
 * registrations and military).
 */
export async function identFromTrace(hex: string, now = new Date()): Promise<AircraftIdent | null> {
  // Two days, not five: this runs on the save path, which is a server action
  // and so outside the route rate limiter (sec-check).
  for (const day of availableDays(now, 2)) {
    const raw = await fetchTraceDay(hex, day, now)
    const p = raw ? parseTrace(raw) : null
    if (p) return { ...p.ident, manufacturer: null }
  }
  return null
}
