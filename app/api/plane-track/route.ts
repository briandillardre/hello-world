import { NextRequest, NextResponse } from 'next/server'
import { gunzipSync } from 'zlib'
import { ipRateLimited } from '@/lib/rate-limit'
import { safeHex, guard, isMock } from '@/app/api/aircraft/_guard'
import { ARCHIVE_DAYS } from '@/lib/aircraft-source'
import type { Fix } from '@/lib/aircraft-log'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

/**
 * Recent flight track for one aircraft — backfills the 3D trail drawn when a
 * plane is clicked on the map.
 *
 * Proxies the adsb.lol readsb "trace_full" file (the same track globe.adsb.lol
 * draws). The file is keyed by the LAST two hex digits and gzip-compressed;
 * we decompress, keep the lat/lon/alt of each airborne fix, and downsample to
 * a manageable polyline. Cached ~30s per hex.
 */

/** Each point: lon, lat, altitude m, ground speed kt, vertical speed fpm.
 *  The last two exist so the trail can be COLOURED by them (Brian, Sep 13);
 *  NaN where the aircraft sent no such value — never 0, which would paint a
 *  measurement nobody took. JSON has no NaN, so the wire carries null.
 *  Internally each point also carries its epoch second, served as a parallel
 *  `ts` array so a searched plane can ride the timeline (Sep 21). */
type TrackPt = [number, number, number, number | null, number | null]
interface Cached { at: number; pts: TrackPt[]; ts: number[]; lastGround: boolean }
/** Where the aircraft was last heard, from the trace itself. `onGround` is
 *  the feed's own flag on that fix — never an altitude threshold. */
interface LastSeen { t: number; lat: number; lon: number; altFt: number; gsKt: number | null; onGround: boolean }
const cache = new Map<string, Cached>()
/** One download in flight per hex. A trace_full file runs to megabytes, so
 *  fifty taps on the same aircraft used to be fifty full downloads. */
interface Trace { pts: TrackPt[]; ts: number[]; lastGround: boolean }
const inflight = new Map<string, Promise<Trace>>()
const TTL_MS = 30_000

// readsb trace fix:
//   [dt, lat, lon, altFt|"ground"|null, gs, track, flags, vert_rate, …]
// Index 7 is the vertical rate in feet per minute; it is frequently absent.
type TraceFix = [number, number, number, number | string | null, ...unknown[]]

async function fetchTrack(hex: string): Promise<Trace> {
  const url = `https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'User-Agent': 'HammerTrack fleet map (hammertrack.ai)' },
  })
  if (!r.ok) throw new Error(`trace ${r.status}`)

  // Server may hand back gzip bytes without a decoding header — try JSON,
  // fall back to manual gunzip.
  const raw = Buffer.from(await r.arrayBuffer())
  let text: string
  try {
    text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
  } catch {
    text = raw.toString('utf8')
  }
  const j: { trace?: TraceFix[]; timestamp?: number } = JSON.parse(text)
  const fixes = j.trace ?? []
  // readsb dates each fix as seconds AFTER the file's own timestamp.
  const t0 = typeof j.timestamp === 'number' ? j.timestamp : 0
  const all: TrackPt[] = []
  const allTs: number[] = []
  let lastGround = false
  for (const f of fixes) {
    const lat = f[1]
    const lon = f[2]
    const alt = f[3]
    if (typeof lat !== 'number' || typeof lon !== 'number') continue
    lastGround = alt === 'ground'
    const altM = typeof alt === 'number' ? alt * 0.3048 : 0 // "ground"/null → 0
    const gs = typeof f[4] === 'number' ? Math.round(f[4] as number) : null
    const vs = typeof f[7] === 'number' ? Math.round(f[7] as number) : null
    all.push([lon, lat, altM, gs, vs])
    allTs.push(Math.round(t0 + (typeof f[0] === 'number' ? f[0] : 0)))
  }
  // Downsample to ~220 points, keeping the newest (end of the array).
  const MAX = 220
  if (all.length <= MAX) return { pts: all, ts: allTs, lastGround }
  const step = all.length / MAX
  const pts: TrackPt[] = []
  const ts: number[] = []
  for (let i = 0; i < MAX; i++) { const k = Math.floor(i * step); pts.push(all[k]); ts.push(allTs[k]) }
  pts.push(all[all.length - 1]); ts.push(allTs[allTs.length - 1])
  return { pts, ts, lastGround }
}

const lastSeenOf = (tr: Trace): LastSeen | null => {
  const { pts, ts } = tr
  if (!pts.length) return null
  const p = pts[pts.length - 1]
  return { t: ts[ts.length - 1] ?? 0, lat: p[1], lon: p[0], altFt: Math.round(p[2] / 0.3048), gsKt: p[3], onGround: tr.lastGround }
}

/** A logged flight's fixes in the trail's shape (lon, lat, altM, gs, vs) + times. */
const flightPoints = (track: Fix[]): { pts: TrackPt[]; ts: number[] } => {
  const pts: TrackPt[] = []
  const ts: number[] = []
  for (const f of track) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue
    pts.push([f.lon, f.lat, (f.altFt ?? 0) * 0.3048, f.gsKt ?? null, f.vsFpm ?? null])
    ts.push(f.t)
  }
  return { pts, ts }
}

/**
 * The timeline branch (Brian, Sep 21: a plane picked from the search bar
 * "should match trails with timeline slider selection"): every flight this
 * airframe flew inside [from, to], with times, from the flight log — banked
 * rows first, the public archive (≈30 days) behind them. Signed in + the
 * aircraft view level, because the archive reads are spent on our behalf.
 */
async function windowFlights(hex: string, fromMs: number, toMs: number) {
  if (isMock) {
    const { demoFlights } = await import('@/lib/aircraft-demo')
    const flights = demoFlights().filter((f) => f.endedAt * 1000 >= fromMs && f.startedAt * 1000 <= toMs)
    return { flights: flights.map((f) => ({ id: f.id, startedAt: f.startedAt, endedAt: f.endedAt, fromLabel: null, toLabel: null, ...flightPoints(f.track) })), archiveDays: ARCHIVE_DAYS, beyondArchive: false, truncated: false }
  }
  const { getFlights } = await import('@/lib/db/aircraft')
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { getCurrentCompanyId } = await import('@/lib/db/company')
  const db = createServiceClient()
  // Banked rows older than the public archive exist ONLY because some
  // company saved that airframe — answering them to anybody would turn this
  // branch into an oracle for other people's watchlists, the hole the
  // flights route closed on Sep 12 (sec-check, Sep 21). Only the company
  // that saved a plane reads past the public window.
  const companyId = await getCurrentCompanyId()
  const { data: mine } = companyId
    ? await db.from('aircraft_saved').select('id').eq('company_id', companyId).eq('hex', hex).eq('active', true).maybeSingle()
    : { data: null }
  const ours = !!mine
  const asked = Math.max(1, Math.min(400, Math.ceil((Date.now() - fromMs) / 86_400_000) + 1))
  const days = ours ? asked : Math.min(asked, ARCHIVE_DAYS)
  const floorMs = ours ? 0 : Date.now() - ARCHIVE_DAYS * 86_400_000
  const res = await getFlights(db, hex, days, { withTrack: true, window: { fromMs, toMs } })
  const flights = res.flights
    .filter((f) => f.endedAt * 1000 >= fromMs && f.startedAt * 1000 <= toMs && f.startedAt * 1000 >= floorMs)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((f) => ({ id: f.id, startedAt: f.startedAt, endedAt: f.endedAt, fromLabel: f.fromLabel, toLabel: f.toLabel, ...flightPoints(f.track) }))
  return { flights, archiveDays: ARCHIVE_DAYS, beyondArchive: ours && res.beyondArchive, truncated: res.truncated }
}

export async function GET(req: NextRequest) {
  // A ~60-byte GET here makes us download and gunzip a multi-megabyte readsb
  // trace. Public like the rest of the map proxies, so the limit is the
  // guard; a whole office can share one public IP, so 60 taps a minute.
  if (ipRateLimited(req, 'plane-track', 60)) {
    return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })
  }
  // Exactly six hex digits — this string reaches adsb.lol's URL path, and the
  // old `length < 6` let an arbitrarily long one build an arbitrarily long
  // upstream request.
  const hex = safeHex(req.nextUrl.searchParams.get('hex'))
  if (!hex) return NextResponse.json({ error: 'hex required' }, { status: 400 })

  // A timeline window: the flight log's flights inside it, with times.
  const fromRaw = req.nextUrl.searchParams.get('from')
  const toRaw = req.nextUrl.searchParams.get('to')
  if (fromRaw != null || toRaw != null) {
    const blocked = await guard(req, 'plane-track-window', 20)
    if (blocked) return blocked
    const fromMs = Number(fromRaw)
    const toMs = Number(toRaw)
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > 400 * 86_400_000) {
      return NextResponse.json({ error: 'from/to (epoch ms) required' }, { status: 400 })
    }
    try {
      return NextResponse.json(await windowFlights(hex, fromMs, toMs), { headers: { 'Cache-Control': 'private, no-store' } })
    } catch (e) {
      console.warn('[plane-track] window failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ flights: [], note: 'flight log unavailable' }, { status: 503 })
    }
  }

  const hit = cache.get(hex)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ pts: hit.pts, ts: hit.ts, lastSeen: lastSeenOf(hit) })

  try {
    let job = inflight.get(hex)
    if (!job) {
      job = fetchTrack(hex)
      const tracked = job
      inflight.set(hex, tracked)
      tracked.catch(() => {}).finally(() => { if (inflight.get(hex) === tracked) inflight.delete(hex) })
    }
    const tr = await job
    if (cache.size > 300) cache.clear()
    cache.set(hex, { at: Date.now(), ...tr })
    return NextResponse.json({ pts: tr.pts, ts: tr.ts, lastSeen: lastSeenOf(tr) })
  } catch (e) {
    // The upstream status stays in OUR logs — it is not the caller's business
    // and relaying it hands an abuser a success signal.
    console.warn('[plane-track] upstream failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ pts: [], ts: [], lastSeen: null, note: 'trace unavailable' })
  }
}
