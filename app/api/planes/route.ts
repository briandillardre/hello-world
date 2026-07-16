import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Live ADS-B aircraft for the map's Aircraft layer.
 *
 * Proxies the adsb.lol community aggregator (free, keyless): all aircraft
 * within `r` nautical miles (max 250) of a point. We trim to what the 3D
 * layer needs — position, barometric altitude, ground speed, track, and
 * identity — and drop aircraft on the ground. Cached ~5s per rounded
 * center so a map full of viewers doesn't hammer the feed.
 */

interface Plane {
  hex: string
  flight: string | null
  reg: string | null
  type: string | null
  lat: number
  lon: number
  altFt: number
  gsKt: number | null
  track: number | null
}

interface AdsbAc {
  hex?: string
  flight?: string
  r?: string
  t?: string
  lat?: number
  lon?: number
  alt_baro?: number | string
  alt_geom?: number
  gs?: number
  track?: number
}

const cache = new Map<string, { at: number; planes: Plane[] }>()
const TTL_MS = 5_000

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const lat = Number(sp.get('lat'))
  const lon = Number(sp.get('lon'))
  const r = Math.min(Math.max(Number(sp.get('r')) || 250, 10), 250)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85) {
    return NextResponse.json({ error: 'lat/lon required' }, { status: 400 })
  }
  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${Math.round(r)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ planes: hit.planes })
  }
  try {
    const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(r)}`
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
      headers: { 'User-Agent': 'HammerTrack fleet map (hammertrack.ai)' },
    })
    if (!resp.ok) throw new Error(`feed ${resp.status}`)
    const j: { ac?: AdsbAc[] } = await resp.json()
    const planes: Plane[] = []
    for (const a of j.ac ?? []) {
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || !a.hex) continue
      // alt_baro is the string "ground" for taxiing aircraft — sky only here.
      const alt = typeof a.alt_baro === 'number' ? a.alt_baro : typeof a.alt_geom === 'number' ? a.alt_geom : null
      if (alt == null || alt < 100) continue
      planes.push({
        hex: a.hex,
        flight: a.flight?.trim() || null,
        reg: a.r?.trim() || null,
        type: a.t?.trim() || null,
        lat: a.lat,
        lon: a.lon,
        altFt: Math.round(alt),
        gsKt: typeof a.gs === 'number' ? Math.round(a.gs) : null,
        track: typeof a.track === 'number' ? Math.round(a.track) : null,
      })
      if (planes.length >= 1200) break
    }
    // Keep the per-center cache from growing unbounded across a long session.
    if (cache.size > 200) cache.clear()
    cache.set(key, { at: Date.now(), planes })
    return NextResponse.json({ planes })
  } catch (e) {
    if (hit) return NextResponse.json({ planes: hit.planes })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'ADS-B feed unreachable' }, { status: 503 })
  }
}
