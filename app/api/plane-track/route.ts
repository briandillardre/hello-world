import { NextRequest, NextResponse } from 'next/server'
import { gunzipSync } from 'zlib'

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
 *  measurement nobody took. JSON has no NaN, so the wire carries null. */
type TrackPt = [number, number, number, number | null, number | null]
interface Cached { at: number; pts: TrackPt[] }
const cache = new Map<string, Cached>()
const TTL_MS = 30_000

// readsb trace fix:
//   [dt, lat, lon, altFt|"ground"|null, gs, track, flags, vert_rate, …]
// Index 7 is the vertical rate in feet per minute; it is frequently absent.
type Fix = [number, number, number, number | string | null, ...unknown[]]

export async function GET(req: NextRequest) {
  const hex = (req.nextUrl.searchParams.get('hex') || '').toLowerCase().replace(/[^0-9a-f]/g, '')
  if (hex.length < 6) return NextResponse.json({ error: 'hex required' }, { status: 400 })

  const hit = cache.get(hex)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ pts: hit.pts })

  try {
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
    const j: { trace?: Fix[] } = JSON.parse(text)
    const fixes = j.trace ?? []
    const all: TrackPt[] = []
    for (const f of fixes) {
      const lat = f[1]
      const lon = f[2]
      const alt = f[3]
      if (typeof lat !== 'number' || typeof lon !== 'number') continue
      const altM = typeof alt === 'number' ? alt * 0.3048 : 0 // "ground"/null → 0
      const gs = typeof f[4] === 'number' ? Math.round(f[4] as number) : null
      const vs = typeof f[7] === 'number' ? Math.round(f[7] as number) : null
      all.push([lon, lat, altM, gs, vs])
    }
    // Downsample to ~220 points, keeping the newest (end of the array).
    const MAX = 220
    let pts: TrackPt[] = all
    if (all.length > MAX) {
      const step = all.length / MAX
      pts = []
      for (let i = 0; i < MAX; i++) pts.push(all[Math.floor(i * step)])
      pts.push(all[all.length - 1])
    }
    cache.set(hex, { at: Date.now(), pts })
    if (cache.size > 300) cache.clear()
    return NextResponse.json({ pts })
  } catch (e) {
    return NextResponse.json({ pts: [], note: e instanceof Error ? e.message : 'trace unavailable' })
  }
}
