import { NextRequest, NextResponse } from 'next/server'
import { encodePng } from '@/lib/dirt/png'
import { buildGrid, renderTile, SURFACE_KINDS, type Station, type SurfaceGrid, type SurfaceKind } from '@/lib/wx-surface'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Temperature / Feels like / Wind speed map tiles, rendered from the NWS
 * surface-observation service (keyless). nowCOAST dropped its RTMA layers
 * (Oct 2026) — see lib/wx-surface.ts. ONE upstream read per 10 minutes per
 * instance serves every tile of every kind; tiles are CDN-cached 10 min.
 */

const OBS = 'https://mapservices.weather.noaa.gov/vector/rest/services/obs/surface_obs/MapServer/60/query'
const TTL_MS = 10 * 60_000
const STALE_MS = 3 * 3_600_000

let cache: { at: number; obsAt: number; grid: SurfaceGrid } | null = null
let inflight: Promise<{ at: number; obsAt: number; grid: SurfaceGrid }> | null = null

async function loadStations(): Promise<{ stations: Station[]; obsAt: number }> {
  const stations: Station[] = []
  let obsAt = 0
  type Page = {
    error?: { message?: string }
    features?: Array<{ attributes: Record<string, number | null>; geometry?: { x: number; y: number } }>
  }
  // Two pages of 2,000 in parallel (≈2,300 stations over CONUS + margins;
  // the service takes 5–30 s per page, hence the cache below).
  const pages = await Promise.all([0, 1].map(async (page) => {
    const q = new URLSearchParams({
      where: 'temperature IS NOT NULL',
      outFields: 'timeobs,temperature,dewpoint,windspeed',
      geometry: '-128,23,-64,51', geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', geometryPrecision: '3',
      returnGeometry: 'true', f: 'json', resultOffset: String(page * 2000), resultRecordCount: '2000',
    })
    const r = await fetch(`${OBS}?${q}`, { signal: AbortSignal.timeout(45_000), cache: 'no-store' })
    if (!r.ok) throw new Error(`obs ${r.status}`)
    const j = await r.json() as Page
    if (j.error) throw new Error(j.error.message ?? 'obs error')
    return j
  }))
  for (const j of pages) {
    const now = Date.now()
    for (const f of j.features ?? []) {
      const a = f.attributes, g = f.geometry
      if (!g || typeof a.temperature !== 'number') continue
      // Drop stale (>3 h) reports and impossible values.
      if (typeof a.timeobs === 'number' && now - a.timeobs > STALE_MS) continue
      if (a.temperature < -80 || a.temperature > 135) continue
      if (typeof a.timeobs === 'number') obsAt = Math.max(obsAt, a.timeobs)
      stations.push({
        lat: g.y, lng: g.x, t: a.temperature,
        td: typeof a.dewpoint === 'number' ? a.dewpoint : NaN,
        // knots → mph
        w: typeof a.windspeed === 'number' && a.windspeed >= 0 && a.windspeed < 200 ? a.windspeed * 1.15078 : NaN,
      })
    }
  }
  if (stations.length < 50) throw new Error(`only ${stations.length} stations reporting`)
  return { stations, obsAt }
}

async function getGrid() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache
  if (!inflight) {
    inflight = loadStations()
      .then(({ stations, obsAt }) => (cache = { at: Date.now(), obsAt, grid: buildGrid(stations) }))
      .finally(() => { inflight = null })
  }
  // Older than the TTL but within 2 h: answer now, refresh behind it.
  if (cache && Date.now() - cache.at < 2 * 3_600_000) {
    inflight?.catch(() => {})
    return cache
  }
  try {
    return await inflight
  } catch (e) {
    if (cache) return cache // stale beats blank
    throw e
  }
}

export async function GET(_req: NextRequest, { params }: { params: { kind: string; z: string; x: string; y: string } }) {
  const kind = params.kind as SurfaceKind
  const z = Number(params.z), x = Number(params.x), y = Number(String(params.y).replace(/\.png$/, ''))
  if (!SURFACE_KINDS.includes(kind) || ![z, x, y].every(Number.isInteger) || z < 0 || z > 10
    || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return NextResponse.json({ error: 'bad tile' }, { status: 400 })
  }
  try {
    const { grid, obsAt } = await getGrid()
    const png = encodePng(256, 256, renderTile(grid, kind, z, x, y))
    return new NextResponse(Buffer.from(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800',
        'X-Obs-Time': obsAt ? new Date(obsAt).toISOString() : '',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'observations unreachable' }, { status: 503 })
  }
}
