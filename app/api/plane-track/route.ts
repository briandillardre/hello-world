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

interface Cached { at: number; pts: [number, number, number][] }
const cache = new Map<string, Cached>()
const TTL_MS = 30_000

// Trace fixes: [dt, lat, lon, altFt|"ground"|null, gs, track, flags, ...]
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
    const all: [number, number, number][] = []
    for (const f of fixes) {
      const lat = f[1]
      const lon = f[2]
      const alt = f[3]
      if (typeof lat !== 'number' || typeof lon !== 'number') continue
      const altM = typeof alt === 'number' ? alt * 0.3048 : 0 // "ground"/null → 0
      all.push([lon, lat, altM])
    }
    // Downsample to ~220 points, keeping the newest (end of the array).
    const MAX = 220
    let pts = all
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
