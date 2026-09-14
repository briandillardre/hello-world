import { NextRequest, NextResponse } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Live ADS-B aircraft for the map's Aircraft layer.
 *
 * Proxies the adsb.lol community aggregator (free, keyless): all aircraft
 * within `r` nautical miles (max 250) of a point. We trim to what the 3D
 * layer needs — position, barometric altitude, ground speed, vertical rate,
 * track and identity. Aircraft the feed says are ON THE GROUND are kept and
 * flagged; `?ground=1` asks for them, and without it they are filtered out on
 * the way to the wire. ONE snapshot per rounded center serves both, cached
 * ~5s, so a map full of viewers doesn't hammer a free community feed.
 */

interface Plane {
  hex: string
  flight: string | null
  reg: string | null
  type: string | null
  lat: number
  lon: number
  altFt: number
  /** The feed says this one is on the ground — parked, taxiing or rolling.
   *  Drawn only with the "Aircraft on the ground" layer on. */
  onGround: boolean
  gsKt: number | null
  /** Feet per minute, + climbing. Barometric where the aircraft sends it,
   *  else GNSS-derived; null when it sends neither (many light aircraft). */
  vsFpm: number | null
  track: number | null
  /** Seconds since this aircraft's position was last updated at the feed
   *  (adsb.lol seen_pos). The client dates the fix by it instead of by the
   *  moment the JSON arrived — otherwise every poll "moves" the plane back
   *  to where it was several seconds ago (Brian, Sep 4: forward, then
   *  slightly backward). */
  seenPos: number | null
}

interface AdsbAc {
  hex?: string
  baro_rate?: number
  geom_rate?: number
  flight?: string
  r?: string
  t?: string
  lat?: number
  lon?: number
  alt_baro?: number | string
  alt_geom?: number
  gs?: number
  track?: number
  seen_pos?: number
}

const cache = new Map<string, { at: number; planes: Plane[] }>()
/** One upstream call in flight per key — a second viewer waits on it rather
 *  than opening its own. */
const inflight = new Map<string, Promise<{ at: number; planes: Plane[] }>>()
const TTL_MS = 5_000
/** How stale a snapshot may get before we stop serving it. Past this an
 *  aircraft's position is fiction, so an honest error beats a ghost. */
const STALE_MS = 90_000
/** adsb.lol is a free community aggregator and rate-limits by IP. When it
 *  answers 429, stop asking for a while — hammering it is what earns the
 *  next one. Brian's "feed 503" (Sep 13) was this, surfaced raw. */
let cooldownUntil = 0
const COOLDOWN_MS = 20_000

async function fetchSnapshot(lat: number, lon: number, r: number): Promise<{ at: number; planes: Plane[] }> {
  const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(r)}`
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
    headers: { 'User-Agent': 'HammerTrack fleet map (hammertrack.ai)' },
  })
  if (resp.status === 429) cooldownUntil = Date.now() + COOLDOWN_MS
  if (!resp.ok) throw new Error(`feed ${resp.status}`)
  // Recovered — don't keep serving stale for the rest of a cooldown the feed
  // has already forgiven.
  cooldownUntil = 0
  const j: { ac?: AdsbAc[] } = await resp.json()
  const planes: Plane[] = []
  let air = 0
  let gnd = 0
  for (const a of j.ac ?? []) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || !a.hex) continue
    // alt_baro is the string "ground" for an aircraft the feed says is on
    // the ground. Those used to be dropped outright — which is why a field
    // like GMU looked empty next to FlightRadar24 (Brian, Sep 13). They are
    // kept here, FLAGGED, and filtered per request on the way out.
    const alt = typeof a.alt_baro === 'number' ? a.alt_baro : typeof a.alt_geom === 'number' ? a.alt_geom : null
    // The feed's own word for it — never an altitude threshold. Barometric
    // altitude is above SEA level, so a jet parked at Denver reads ~5,300 ft
    // and any threshold would call it airborne, while a coastal approach at
    // 80 ft would be drawn parked (the same trap the flight log designed
    // around). A stray `|| alt < 100` used to sit here saying otherwise; it
    // caught nothing the flag missed — 45 aircraft over Atlanta, 8 on the
    // ground, none of them by altitude.
    const onGround = a.alt_baro === 'ground'
    if (!onGround && alt == null) continue
    if (onGround) {
      if (gnd >= 600) continue
      gnd++
    } else {
      if (air >= 1200) continue
      air++
    }
    planes.push({
      hex: a.hex,
      flight: a.flight?.trim() || null,
      reg: a.r?.trim() || null,
      type: a.t?.trim() || null,
      lat: a.lat,
      lon: a.lon,
      altFt: onGround ? 0 : Math.round(alt as number),
      onGround,
      gsKt: typeof a.gs === 'number' ? Math.round(a.gs) : null,
      vsFpm: typeof a.baro_rate === 'number' ? Math.round(a.baro_rate)
        : typeof a.geom_rate === 'number' ? Math.round(a.geom_rate) : null,
      track: typeof a.track === 'number' ? Math.round(a.track) : null,
      seenPos: typeof a.seen_pos === 'number' && a.seen_pos >= 0 ? Math.min(60, a.seen_pos) : null,
    })
    if (air >= 1200 && gnd >= 600) break
  }
  // Dated when the FEED answered, not when each waiting caller was served —
  // otherwise a viewer that joined a call already in flight banks it as newer
  // than it is and the whole snapshot ages late.
  return { at: Date.now(), planes }
}

export async function GET(req: NextRequest) {
  // Public — /live renders this map signed out, so a session can't be the
  // gate. The limit is what stops a scraper relaying through us: abuse on our
  // egress IP gets US rate-limited at adsb.lol and kills the layer for every
  // real customer. A viewer polls ~10/min and a whole site office can sit
  // behind ONE public IP, so the ceiling is 120 — a dozen honest maps, and
  // still nothing like a scraper. Same guard /api/route and /api/plane-info
  // already carry.
  if (ipRateLimited(req, 'planes', 120)) {
    return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })
  }
  const sp = req.nextUrl.searchParams
  const lat = Number(sp.get('lat'))
  const lon = Number(sp.get('lon'))
  // Radius is served in 50 nm steps. The key space is what an anonymous
  // caller can inflate — 241 legal radii over one dense centre was 241
  // upstream calls and a cache wipe — and rounding UP always answers with at
  // least the coverage asked for.
  const rIn = Math.min(Math.max(Number(sp.get('r')) || 250, 10), 250)
  const r = Math.min(250, Math.ceil(rIn / 50) * 50)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: 'lat/lon required' }, { status: 400 })
  }
  const wantGround = sp.get('ground') === '1'
  // The cache key deliberately does NOT carry `ground`: ONE upstream call
  // holds the whole snapshot and every request filters it on the way out.
  // Keying by it doubled our call rate the day the ground layer shipped, and
  // adsb.lol answered with 429s that reached the map as "feed 503".
  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${Math.round(r)}`
  const hit = cache.get(key)
  const reply = (planes: Plane[], ageMs: number) =>
    NextResponse.json({ planes: wantGround ? planes : planes.filter((p) => !p.onGround), ageMs })
  // ageMs = how old this snapshot already is on OUR side, so the client can
  // date fixes correctly without trusting its clock against ours — and so the
  // layers panel stamps an outage honestly instead of claiming freshness.
  if (hit && Date.now() - hit.at < TTL_MS) return reply(hit.planes, Date.now() - hit.at)
  // Told to slow down: ride the last snapshot out rather than earning another.
  // A MISS has to be refused here too — a miss is precisely the request that
  // makes the upstream call, so letting it fall through left the brake
  // touching only the requests that were never going to press the pedal.
  if (Date.now() < cooldownUntil) {
    if (hit && Date.now() - hit.at < STALE_MS) return reply(hit.planes, Date.now() - hit.at)
    return NextResponse.json({ error: 'ADS-B feed unavailable' }, { status: 503 })
  }
  try {
    let job = inflight.get(key)
    if (!job) {
      job = fetchSnapshot(lat, lon, r)
      const tracked = job
      inflight.set(key, tracked)
      tracked.catch(() => {}).finally(() => { if (inflight.get(key) === tracked) inflight.delete(key) })
    }
    const snap = await job
    // Bounded in BYTES, not just entries: a snapshot holds up to 1,800
    // aircraft (~450 KB), so 200 of them was ~90 MB of resident heap. With
    // the radius quantised there are five keys per 0.1 degree cell and a
    // real map needs a handful.
    if (cache.size > 24) cache.clear()
    const held = cache.get(key)
    if (!held || held.at < snap.at) cache.set(key, snap)
    return reply(snap.planes, Math.max(0, Date.now() - snap.at))
  } catch (e) {
    // A snapshot a minute old beats a red error badge on a layer that works.
    if (hit && Date.now() - hit.at < STALE_MS) return reply(hit.planes, Date.now() - hit.at)
    // The upstream status stays in OUR logs. Relaying "feed 429" told an
    // abuser exactly when they had succeeded in getting our egress throttled.
    console.warn('[planes] upstream failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'ADS-B feed unavailable' }, { status: 503 })
  }
}
