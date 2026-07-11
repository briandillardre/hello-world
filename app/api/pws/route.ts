import { NextResponse } from 'next/server'
import { compassDir, type PwsConditions } from '@/lib/pws'

export const dynamic = 'force-dynamic'

/**
 * Home weather station proxy. Reads whichever provider is configured in env,
 * normalizes the observation, and keeps every API key server-side. A short
 * in-memory cache spares the provider APIs from one hit per map viewer.
 */

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)
const cToF = (c: number | null) => (c == null ? null : (c * 9) / 5 + 32)
const msToMph = (ms: number | null) => (ms == null ? null : ms * 2.23694)
const mmToIn = (mm: number | null) => (mm == null ? null : mm / 25.4)
const mbToInHg = (mb: number | null) => (mb == null ? null : mb * 0.02953)
const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)

async function fromAmbient(apiKey: string, appKey: string, mac?: string): Promise<PwsConditions | null> {
  const r = await fetch(
    `https://rt.ambientweather.net/v1/devices?applicationKey=${encodeURIComponent(appKey)}&apiKey=${encodeURIComponent(apiKey)}`,
    { cache: 'no-store' }
  )
  if (!r.ok) return null
  const devices = await r.json()
  if (!Array.isArray(devices) || devices.length === 0) return null
  const dev = (mac && devices.find((d) => d?.macAddress?.toLowerCase() === mac.toLowerCase())) || devices[0]
  const d = dev?.lastData
  if (!d || num(d.tempf) == null) return null
  return {
    station: dev?.info?.name || 'Home station',
    at: new Date(d.dateutc ?? Date.now()).toISOString(),
    tempF: Math.round(d.tempf),
    feelsF: r1(num(d.feelsLike)),
    humidity: num(d.humidity),
    windMph: Math.round(num(d.windspeedmph) ?? 0),
    gustMph: r1(num(d.windgustmph)),
    windDir: compassDir(num(d.winddir)),
    rainTodayIn: r1(num(d.dailyrainin)),
    pressureInHg: r1(num(d.baromrelin)),
    uv: num(d.uv),
  }
}

async function fromTempest(token: string, stationId: string): Promise<PwsConditions | null> {
  const r = await fetch(
    `https://swd.weatherflow.com/swd/rest/observations/station/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`,
    { cache: 'no-store' }
  )
  if (!r.ok) return null
  const j = await r.json()
  const o = Array.isArray(j?.obs) ? j.obs[0] : null
  const tempF = cToF(num(o?.air_temperature))
  if (!o || tempF == null) return null
  return {
    station: j?.station_name || 'Home station',
    at: new Date((num(o.timestamp) ?? Date.now() / 1000) * 1000).toISOString(),
    tempF: Math.round(tempF),
    feelsF: r1(cToF(num(o.feels_like))),
    humidity: num(o.relative_humidity),
    windMph: Math.round(msToMph(num(o.wind_avg)) ?? 0),
    gustMph: r1(msToMph(num(o.wind_gust))),
    windDir: compassDir(num(o.wind_direction)),
    rainTodayIn: r1(mmToIn(num(o.precip_accum_local_day))),
    pressureInHg: r1(mbToInHg(num(o.sea_level_pressure))),
    uv: num(o.uv),
  }
}

async function fromWunderground(apiKey: string, stationId: string): Promise<PwsConditions | null> {
  const r = await fetch(
    `https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(stationId)}&format=json&units=e&apiKey=${encodeURIComponent(apiKey)}`,
    { cache: 'no-store' }
  )
  if (!r.ok) return null
  const j = await r.json()
  const o = Array.isArray(j?.observations) ? j.observations[0] : null
  const imp = o?.imperial
  if (!o || num(imp?.temp) == null) return null
  return {
    station: o.stationID || 'Home station',
    at: o.obsTimeUtc || new Date().toISOString(),
    tempF: Math.round(imp.temp),
    feelsF: r1(num(imp.heatIndex) ?? num(imp.windChill)),
    humidity: num(o.humidity),
    windMph: Math.round(num(imp.windSpeed) ?? 0),
    gustMph: r1(num(imp.windGust)),
    windDir: compassDir(num(o.winddir)),
    rainTodayIn: r1(num(imp.precipTotal)),
    pressureInHg: r1(num(imp.pressure)),
    uv: num(o.uv),
  }
}

// One reading per minute per server instance is plenty — the station itself
// only reports every 16 s to 5 min depending on brand.
let cached: { at: number; data: PwsConditions | null } | null = null

export async function GET() {
  const provider = process.env.PWS_PROVIDER?.toLowerCase()
  const apiKey = process.env.PWS_API_KEY
  const appKey = process.env.PWS_APP_KEY
  const token = process.env.PWS_TOKEN
  const stationId = process.env.PWS_STATION_ID

  // Infer the provider from which credentials exist when not set explicitly.
  const which =
    provider ||
    (appKey && apiKey ? 'ambient' : token && stationId ? 'tempest' : apiKey && stationId ? 'wunderground' : null)

  if (!which) return NextResponse.json({ configured: false })

  if (cached && Date.now() - cached.at < 60_000) {
    return cached.data ? NextResponse.json(cached.data) : NextResponse.json({ configured: false })
  }

  let data: PwsConditions | null = null
  try {
    if (which === 'ambient' && apiKey && appKey) data = await fromAmbient(apiKey, appKey, process.env.PWS_MAC)
    else if (which === 'tempest' && token && stationId) data = await fromTempest(token, stationId)
    else if (which === 'wunderground' && apiKey && stationId) data = await fromWunderground(apiKey, stationId)
  } catch (err) {
    console.error('PWS fetch failed', err)
  }

  // A station that hasn't reported in an hour is offline — don't show a
  // yesterday temp as if it were live.
  if (data && Date.now() - new Date(data.at).getTime() > 3_600_000) data = null

  cached = { at: Date.now(), data }
  return data ? NextResponse.json(data) : NextResponse.json({ configured: false })
}
