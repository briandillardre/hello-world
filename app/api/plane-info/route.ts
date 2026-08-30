import { NextRequest, NextResponse } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * FlightAware-style enrichment for one tapped aircraft on the map.
 *
 * Two free, keyless lookups run in parallel, and each half may fail alone —
 * a GA Cessna with no filed route still gets its photo, and a jet the
 * spotters never caught still gets its route:
 *  - Photo: planespotters.net public API by icao24 hex. Their terms require
 *    visible photographer attribution AND a link back to the photo page
 *    wherever the image appears, so both ride along in the response — never
 *    render the image without the credit + link.
 *  - Route: adsbdb by callsign (keyless; adsb.lol's routeset endpoint was
 *    verified returning empty 201s upstream, Aug 30). No filed route is a
 *    real answer (VFR traffic files nothing) → route: null, not an error.
 *    Routes are SCHEDULE-derived with no position plausibility check, so
 *    the popup labels them "filed route", never gospel. adsbdb's route DB
 *    is query-and-display only — never bulk-import it into our tables.
 *
 * Upstream failure text never reaches the client — a map popup is the wrong
 * place to debug someone else's API.
 */

interface PlanePhoto {
  url: string
  photographer: string
  link: string
}

interface PlaneRoute {
  from: string
  to: string
}

interface PlaneInfo {
  photo: PlanePhoto | null
  route: PlaneRoute | null
}

// Planespotters: photos[] of nested variants; thumbnail_large is popup-sized.
interface SpotterPhoto {
  thumbnail_large?: { src?: string }
  photographer?: string
  link?: string
}

// adsbdb: flightroute carries full airport objects; we keep just the codes.
interface AdsbdbRoute {
  response?: {
    flightroute?: {
      origin?: { iata_code?: string; icao_code?: string }
      destination?: { iata_code?: string; icao_code?: string }
    }
  }
}

// Keyed by identity, not position — a flight keeps the same route and photo
// across its whole track, so lat/lon in the key would defeat the cache for
// anything that moves.
const cache = new Map<string, { at: number; info: PlaneInfo }>()
const TTL_MS = 600_000

const UA = 'HammerTrack aircraft (hello@hammertrack.ai)'

async function fetchPhoto(hex: string): Promise<PlanePhoto | null> {
  const resp = await fetch(`https://api.planespotters.net/pub/photos/hex/${hex}`, {
    signal: AbortSignal.timeout(6_000),
    cache: 'no-store',
    headers: { 'user-agent': UA },
  })
  if (!resp.ok) throw new Error(`photos ${resp.status}`)
  const j: { photos?: SpotterPhoto[] } = await resp.json()
  const p = j.photos?.[0]
  const url = p?.thumbnail_large?.src
  const link = p?.link
  // No usable link means the attribution requirement can't be honored — in
  // that case there is no photo to show. https-only because these strings
  // end up in an <img src> / <a href> client-side.
  if (typeof url !== 'string' || !url.startsWith('https://')) return null
  if (typeof link !== 'string' || !link.startsWith('https://')) return null
  return { url, photographer: p?.photographer?.trim() || '', link }
}

async function fetchRoute(callsign: string): Promise<PlaneRoute | null> {
  const resp = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
    signal: AbortSignal.timeout(6_000),
    cache: 'no-store',
    headers: { 'user-agent': UA },
  })
  // adsbdb answers 404 for a callsign with no filed route — an answer.
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`adsbdb ${resp.status}`)
  const j = (await resp.json()) as AdsbdbRoute
  const fr = j.response?.flightroute
  const from = fr?.origin?.iata_code || fr?.origin?.icao_code
  const to = fr?.destination?.iata_code || fr?.destination?.icao_code
  if (!from || !to || !/^[A-Z0-9]{3,4}$/.test(from) || !/^[A-Z0-9]{3,4}$/.test(to)) return null
  return { from, to }
}

export async function GET(req: NextRequest) {
  if (ipRateLimited(req, 'plane', 30)) {
    return NextResponse.json({ error: 'slow down' }, { status: 429 })
  }
  const sp = req.nextUrl.searchParams
  // These interpolate into upstream URLs/bodies — reject anything that isn't
  // shaped exactly like an icao24 hex or an ADS-B callsign.
  const hex = (sp.get('hex') || '').trim().toLowerCase()
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return NextResponse.json({ error: 'bad hex' }, { status: 400 })
  }
  const cs = (sp.get('callsign') || '').trim().toUpperCase()
  if (cs && !/^[A-Z0-9-]{2,10}$/i.test(cs)) {
    return NextResponse.json({ error: 'bad callsign' }, { status: 400 })
  }
  const callsign = cs || null
  // (lat/lon were only needed by the retired adsb.lol routeset body — adsbdb
  // looks up by callsign alone, so position is no longer required.)

  const key = `${hex}|${callsign ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.info)

  // Both halves in flight together; either may die without taking the other
  // with it — the popup shows whatever we managed to learn.
  const [photoRes, routeRes] = await Promise.allSettled([
    fetchPhoto(hex),
    callsign ? fetchRoute(callsign) : Promise.resolve<PlaneRoute | null>(null),
  ])
  const info: PlaneInfo = {
    photo: photoRes.status === 'fulfilled' ? photoRes.value : null,
    route: routeRes.status === 'fulfilled' ? routeRes.value : null,
  }
  if (photoRes.status === 'rejected' && routeRes.status === 'rejected' && hit) {
    // Both upstreams down but we've answered this plane before — stale beats
    // blank for data this static.
    return NextResponse.json(hit.info)
  }
  if (photoRes.status === 'fulfilled' && routeRes.status === 'fulfilled') {
    // Only fully-answered lookups cache — a 6s timeout must not pin ten
    // minutes of empty popup on a plane that would answer on the next tap.
    // (A legit "no photos" / "unknown route" IS an answer and does cache.)
    if (cache.size > 300) cache.clear()
    cache.set(key, { at: Date.now(), info })
  }
  return NextResponse.json(info)
}
