/**
 * Weather layer data — all free + keyless so it runs client-side in production.
 *
 * - Radar tiles: RainViewer public API. Timestamped past + nowcast frames;
 *   the map shows the latest observation as a live overlay. (The "Satellite"
 *   basemap is Esri aerial imagery, not RainViewer.)
 * - Current conditions + thunderstorm flag: Open-Meteo.
 */

export interface RadarFrame {
  time: number // unix seconds
  path: string
  kind: 'past' | 'nowcast'
}

export interface WeatherFrames {
  host: string
  radar: RadarFrame[]
}

export async function fetchWeatherFrames(): Promise<WeatherFrames | null> {
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    const host: string = j.host
    const radar: RadarFrame[] = [
      ...(j.radar?.past ?? []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path, kind: 'past' as const })),
      ...(j.radar?.nowcast ?? []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path, kind: 'nowcast' as const })),
    ]
    return { host, radar }
  } catch {
    return null
  }
}

export function weatherTileUrl(host: string, frame: RadarFrame): string {
  // RainViewer: {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
  // Color 4 = "The Weather Channel" palette, reads well on dark.
  return `${host}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`
}

/** Index of the most recent "live" frame (latest past observation). */
export function liveFrameIndex(frames: RadarFrame[]): number {
  let idx = frames.length - 1
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].kind === 'past') { idx = i; break }
  }
  return Math.max(0, idx)
}

export function frameLabel(time: number): string {
  return new Date(time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// ── Current conditions (Open-Meteo) ──────────────────────────────────────────
export interface Conditions {
  tempF: number
  windMph: number
  precip: number
  code: number
  isThunder: boolean
}

export async function fetchConditions(lat: number, lng: number): Promise<Conditions | null> {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`
    const r = await fetch(u, { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    const c = j.current
    const code: number = c.weather_code
    return {
      tempF: Math.round(c.temperature_2m),
      windMph: Math.round(c.wind_speed_10m),
      precip: c.precipitation ?? 0,
      code,
      isThunder: [95, 96, 99].includes(code),
    }
  } catch {
    return null
  }
}

export function weatherEmoji(code: number): string {
  if ([95, 96, 99].includes(code)) return '⛈️'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️'
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '🌧️'
  if ([45, 48].includes(code)) return '🌫️'
  if ([2, 3].includes(code)) return '⛅'
  if (code === 1) return '🌤️'
  if (code === 0) return '☀️'
  return '🌡️'
}
