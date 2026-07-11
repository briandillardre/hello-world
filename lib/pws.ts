/**
 * Personal weather station (PWS) — Brian's home station wired into the map.
 *
 * The server route (/api/pws) talks to whichever provider is configured via
 * env vars and normalizes everything to PwsConditions; API keys never reach
 * the browser. Supported providers:
 *
 *   ambient      Ambient Weather (AWN)      PWS_API_KEY + PWS_APP_KEY [+ PWS_MAC]
 *   tempest      WeatherFlow Tempest        PWS_TOKEN + PWS_STATION_ID
 *   wunderground Weather Underground PWS    PWS_API_KEY + PWS_STATION_ID
 *
 * PWS_PROVIDER picks explicitly; unset, the route infers it from which keys
 * exist. No env vars at all → { configured: false } and the UI shows nothing.
 */

export interface PwsConditions {
  station: string
  /** ISO timestamp of the observation (station time, not fetch time). */
  at: string
  tempF: number
  feelsF: number | null
  humidity: number | null
  windMph: number
  gustMph: number | null
  /** Compass point ("NW") derived from degrees, for display. */
  windDir: string | null
  rainTodayIn: number | null
  pressureInHg: number | null
  uv: number | null
}

export function compassDir(deg: number | null | undefined): string | null {
  if (deg == null || !isFinite(deg)) return null
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return pts[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]
}

/** Client helper — null when unconfigured, errored, or the reading is stale. */
export async function fetchPws(): Promise<PwsConditions | null> {
  try {
    const r = await fetch('/api/pws', { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    return j?.configured === false ? null : (j as PwsConditions)
  } catch {
    return null
  }
}
