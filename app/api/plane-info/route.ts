import { NextRequest, NextResponse } from 'next/server'

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
 *  - Route: adsb.lol routeset (the tar1090 community route DB) by callsign.
 *    "unknown" is a real answer (VFR traffic files nothing) → route: null,
 *    not an error.
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

// Routeset: one entry per queried plane; _airport_codes_iata is "CLT-ATL"
// style (falls back to ICAO codes for fields with no IATA), or "unknown".
interface RoutesetEntry {
  _airport_codes_iata?: string
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

async function fetchRoute(callsign: string, lat: number, lon: number): Promise<PlaneRoute | null> {
  // Position rides along so the DB can sanity-check the route against where
  // the aircraft actually is (their "plausible" flag).
  const resp = await fetch('https://api.adsb.lol/api/0/routeset', {
    method: 'POST',
    signal: AbortSignal.timeout(6_000),
    cache: 'no-store',
    headers: { 'user-agent': UA, 'content-type': 'application/json' },
    body: JSON.stringify({ planes: [{ callsign, lat, lng: lon }] }),
  })
  if (!resp.ok) throw new Error(`routeset ${resp.status}`)
  const j: unknown = await resp.json()
  const codes = Array.isArray(j) ? (j[0] as RoutesetEntry | undefined)?._airport_codes_iata : undefined
  if (!codes || codes === 'unknown') return null
  // Multi-stop flight numbers come back as "AVL-CLT-DFW"; first → last is
  // the flight's overall route, which is all the popup has room to say.
  const legs = codes.split('-').filter((c) => /^[A-Z0-9]{3,4}$/.test(c))
  if (legs.length < 2) return null
  return { from: legs[0], to: legs[legs.length - 1] }
}

export async function GET(req: NextRequest) {
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
  const lat = Number(sp.get('lat'))
  const lon = Number(sp.get('lon'))
  const posOk = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  if (callsign && !posOk) {
    return NextResponse.json({ error: 'lat/lon required' }, { status: 400 })
  }

  const key = `${hex}|${callsign ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.info)

  // Both halves in flight together; either may die without taking the other
  // with it — the popup shows whatever we managed to learn.
  const [photoRes, routeRes] = await Promise.allSettled([
    fetchPhoto(hex),
    callsign ? fetchRoute(callsign, lat, lon) : Promise.resolve<PlaneRoute | null>(null),
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
