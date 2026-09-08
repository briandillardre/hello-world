/**
 * Weather layer data — all free + keyless so it runs client-side in production.
 *
 * - Radar tiles: IEM's archived MRMS reflectivity (see the radar section
 *   below); the RainViewer helpers are the older single-frame path. (The
 *   "Satellite" basemap is Esri aerial imagery, not RainViewer.)
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

// ── Animated radar (Iowa Environmental Mesonet · MRMS reflectivity) ──────────
// Free + keyless US composite reflectivity, served as XYZ tiles keyed by a
// UTC timestamp so we can loop the last hour and scrub any past minute.
//
// PRODUCT (Brian, Sep 6 — "what is going on with radar"): the raw NEXRAD N0Q
// composite this layer used to draw is UNFILTERED. On a September night every
// radar site sits inside a smooth green disk 60–80 miles across — migrating
// birds and insects in clear-air mode, not rain — with wedge-shaped holes
// where Appalachian ridges block the beam. NOAA's MRMS system runs a quality
// control that strips non-weather echoes, and IEM archives its SeamlessHSR
// product as `mrms::lcref-<ts>` on the SAME tile cache (CORS *, cached 5 min):
// one raster every 2 minutes since 2015, the newest about 6 minutes behind
// the clock. Same storms, no birds — verified side by side against N0Q and
// the nowCOAST MRMS mosaic for the same minute before switching.
export interface IemFrame { ts: string; label: string }

const pad2 = (n: number) => String(n).padStart(2, '0')
/** MRMS rasters land on even minutes. */
const MRMS_STEP_MS = 2 * 60_000
/** How far behind the clock the newest archived raster reliably exists.
 *  Probed Sep 8: the 4-minute-old slot 503'd, the 6-minute-old one served;
 *  8 keeps the loop landing on a frame that is there. A frame that is still
 *  missing simply never shows (the buffered loader skips it). */
const MRMS_LAG_MS = 8 * 60_000

const fmtTs = (d: Date) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`

/** Newest archive slot that should exist right now (even minute, lagged). */
export function newestRadarSlotMs(nowMs = Date.now()): number {
  return Math.floor((nowMs - MRMS_LAG_MS) / MRMS_STEP_MS) * MRMS_STEP_MS
}

/** Build the last `count` radar frames at `stepMin`-minute spacing (a multiple
 *  of 2 — the archive's cadence), ending on the newest slot that exists. */
export function buildRadarFrames(count = 12, stepMin = 4): IemFrame[] {
  const step = Math.max(1, Math.round(stepMin / 2)) * MRMS_STEP_MS
  const latest = newestRadarSlotMs()
  const frames: IemFrame[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(latest - i * step)
    frames.push({ ts: fmtTs(d), label: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })
  }
  return frames
}

/** XYZ tile template for a given archive timestamp (empty ts = the live
 *  SeamlessHSR composite, same product without a clock). */
export function iemRadarUrl(ts?: string): string {
  const layer = ts ? `mrms::lcref-${ts}` : 'q2-hsr-900913'
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${layer}/{z}/{x}/{y}.png`
}

/** IEM archive timestamp (UTC, floored to the 2-min MRMS cadence) for any
 *  epoch ms — lets the radar layer time-travel with the playback scrubber.
 *  Clamped to the newest frame that can exist (same lag as buildRadarFrames):
 *  replay windows end at a future midnight and the scrubber opens at the
 *  window end, so an unclamped ts asked IEM for tomorrow's radar — guaranteed
 *  503s on every "Today" replay (logged-in review, Aug 26). */
export function iemTsForMs(ms: number): string {
  const slot = Math.min(Math.floor(ms / MRMS_STEP_MS) * MRMS_STEP_MS, newestRadarSlotMs())
  return fmtTs(new Date(slot))
}

// ── Rain totals (IEM MRMS precipitation accumulation) ────────────────────────
// Free + keyless national rain-accumulation rasters from the same IEM tile
// service as the radar loop. Each layer is the CURRENT running total for its
// period (MRMS Q3 QPE), refreshed every few minutes upstream.
export interface PrecipPeriod { key: string; label: string; layer: string }

export const PRECIP_PERIODS: PrecipPeriod[] = [
  { key: '1h', label: '1 hr', layer: 'q2-n1p-900913' },
  { key: '24h', label: '24 hr', layer: 'q2-p24h-900913' },
  { key: '48h', label: '48 hr', layer: 'q2-p48h-900913' },
  { key: '72h', label: '72 hr', layer: 'q2-p72h-900913' },
]

export function iemPrecipUrl(layer: string): string {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${layer}/{z}/{x}/{y}.png`
}

// ── Current conditions (Open-Meteo) ──────────────────────────────────────────
export interface Conditions {
  tempF: number
  windMph: number
  precip: number
  code: number
  isThunder: boolean
  /** Open-Meteo's sunrise/sunset verdict at the queried point — picks the
   *  sun-or-moon face of every glyph (Brian, Sep 4). */
  isDay: boolean
}

export async function fetchConditions(lat: number, lng: number): Promise<Conditions | null> {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m,weather_code,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph`
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
      isDay: c.is_day == null ? true : Number(c.is_day) === 1,
    }
  } catch {
    return null
  }
}

/** Emoji fallback for text-only surfaces (emails, SMS). The top bar uses
 *  components/map/WeatherIcon for true day/night faces. */
export function weatherEmoji(code: number, isDay = true): string {
  if (!isDay && code === 0) return '🌙'
  if (!isDay && [1, 2].includes(code)) return '☁️'
  if ([95, 96, 99].includes(code)) return '⛈️'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️'
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '🌧️'
  if ([45, 48].includes(code)) return '🌫️'
  if ([2, 3].includes(code)) return '⛅'
  if (code === 1) return '🌤️'
  if (code === 0) return '☀️'
  return '🌡️'
}
