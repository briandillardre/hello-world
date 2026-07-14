import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * RTMA layer-name discovery — asks nowCOAST's WMS GetCapabilities what the
 * temperature / apparent-temperature / wind layers are actually called and
 * maps our stable panel keys (temp/feels/wind) onto the real names.
 *
 * Why: the map hardcodes WMS LAYERS= names; if NOAA renames one (or we
 * guessed one wrong), that overlay silently draws nothing. This route makes
 * the names self-healing and gives /diag something concrete to show.
 */

export interface RtmaNames {
  temp: string | null
  feels: string | null
  wind: string | null
  /** All plausible layer names found — /diag debugging aid. */
  names: string[]
}

let cache: { at: number; data: RtmaNames } | null = null
const TTL_MS = 24 * 3_600_000

// GLOBAL capabilities — the rtma workspace path 404s (seen on /diag Jul 13);
// the global document lists every layer in every workspace, wherever NOAA
// filed the surface-analysis layers this year.
const CAPS_URL =
  'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities'

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data, { headers: { 'Cache-Control': 'public, s-maxage=3600' } })
  }
  try {
    const r = await fetch(CAPS_URL, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
    if (!r.ok) throw new Error(`caps ${r.status}`)
    const xml = await r.text()
    // Every <Name> in the doc; the service's own name and style names slip in,
    // but the pattern matches below only ever pick layer-shaped names.
    const names = Array.from(xml.matchAll(/<Name>([^<]+)<\/Name>/g), (m) => m[1].trim())
      .filter((n) => /temp|wind|dew|humid|apparent|heat|gust/i.test(n))
    // Workspace-qualified names (with ':') are the servable ones — the bare
    // 'wind_speed' the first pass picked drew a ServiceException in prod
    // while 'ndfd_temperature:air_temperature' rendered fine.
    const qualified = names.filter((n) => n.includes(':'))
    const pick = (...tests: RegExp[]): string | null => {
      for (const pool of [qualified, names]) {
        for (const t of tests) {
          const hit = pool.find((n) => t.test(n))
          if (hit) return hit
        }
      }
      return null
    }
    const data: RtmaNames = {
      temp: pick(/^(\w+:)?air_temperature$/i, /air_temp(?!.*(apparent|dew))/i),
      feels: pick(/apparent/i, /heat_index/i, /feels/i),
      wind: pick(/^(\w+:)?wind_speed$/i, /wind_speed/i, /wind_velocity/i, /(?<!gust_)wind(?!_dir)/i),
      names: Array.from(new Set(names)).slice(0, 60),
    }
    cache = { at: Date.now(), data }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=3600' } })
  } catch (err) {
    // Stale beats blank; a total miss tells the client to keep its defaults.
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'capabilities unreachable' },
      { status: 503 }
    )
  }
}
