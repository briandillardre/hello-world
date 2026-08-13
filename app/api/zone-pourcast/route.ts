import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Pour-cast: can you pour / lift / roof at each active job site this week?
 * One Open-Meteo daily forecast (free, keyless — same API as the weather
 * cron) per ACTIVE site-kind zone, flagged against concrete-day thresholds:
 *
 *   rain ≥ 60% chance → 'rain'   gusts ≥ 25 mph → 'wind'   low ≤ 35°F → 'cold'
 *
 * Calls scale with SITES, not viewers: capped at 25 zones, module-cached
 * 30 min per company. Imperial units throughout.
 */

const RAIN_PCT = 60
const GUST_MPH = 25
const COLD_F = 35
const ZONE_CAP = 25
const CACHE_MS = 30 * 60_000
const FORECAST_DAYS = 5

interface PourDay {
  date: string
  rainPct: number | null
  gustMph: number | null
  hiF: number | null
  loF: number | null
  flags: ('rain' | 'wind' | 'cold')[]
}

interface PourZone {
  id: string
  name: string
  days: PourDay[]
  nextBad: { date: string; reason: 'rain' | 'wind' | 'cold' } | null
}

const cache = new Map<string, { at: number; zones: PourZone[] }>()

interface ZoneRow {
  id: string
  name: string
  kind?: string | null
  completed_at?: string | null
  active_from?: string | null
  active_until?: string | null
  geometry?: { coordinates?: [number, number][][] } | null
}

/** kind 'site', not completed, and inside its active_from/until window. */
function isActiveSite(z: ZoneRow, nowMs: number): boolean {
  if ((z.kind ?? 'site') !== 'site' || z.completed_at) return false
  const from = z.active_from ? Date.parse(z.active_from) : NaN
  const until = z.active_until ? Date.parse(z.active_until) : NaN
  if (Number.isFinite(from) && from > nowMs) return false
  if (Number.isFinite(until) && until < nowMs) return false
  return true
}

async function pourcastAt(lat: number, lng: number): Promise<PourDay[]> {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    '&daily=precipitation_probability_max,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min' +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=${FORECAST_DAYS}`
  const r = await fetch(u, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!r.ok) throw new Error(`open-meteo ${r.status}`)
  const j = await r.json() as {
    daily?: {
      time?: string[]
      precipitation_probability_max?: (number | null)[]
      wind_gusts_10m_max?: (number | null)[]
      temperature_2m_max?: (number | null)[]
      temperature_2m_min?: (number | null)[]
    }
  }
  const d = j.daily
  const days: PourDay[] = []
  for (let i = 0; i < (d?.time?.length ?? 0); i++) {
    const date = d!.time![i]
    if (!date) continue
    const rainPct = typeof d?.precipitation_probability_max?.[i] === 'number' ? Math.round(d.precipitation_probability_max[i] as number) : null
    const gustMph = typeof d?.wind_gusts_10m_max?.[i] === 'number' ? Math.round(d.wind_gusts_10m_max[i] as number) : null
    const hiF = typeof d?.temperature_2m_max?.[i] === 'number' ? Math.round(d.temperature_2m_max[i] as number) : null
    const loF = typeof d?.temperature_2m_min?.[i] === 'number' ? Math.round(d.temperature_2m_min[i] as number) : null
    const flags: PourDay['flags'] = []
    if (rainPct != null && rainPct >= RAIN_PCT) flags.push('rain')
    if (gustMph != null && gustMph >= GUST_MPH) flags.push('wind')
    if (loF != null && loF <= COLD_F) flags.push('cold')
    days.push({ date, rainPct, gustMph, hiF, loF, flags })
  }
  return days
}

export async function GET() {
  try {
    if (isMock) return NextResponse.json({ zones: [] })

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Cache key = company (profiles.company_id, solo accounts fall back to uid).
    const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).maybeSingle()
    const companyKey = (profile?.company_id as string | undefined) ?? user.id
    const hit = cache.get(companyKey)
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return NextResponse.json({ zones: hit.zones })
    }

    // RLS scopes the view to the caller's company (global zones only —
    // personal scratch zones don't need a pour forecast).
    const { data: zoneRows, error } = await supabase
      .from('geofences_json')
      .select('id, name, kind, completed_at, active_from, active_until, geometry')
      .is('owner_id', null)
      .limit(200)
    if (error) return NextResponse.json({ zones: [] })

    const nowMs = Date.now()
    const sites = ((zoneRows ?? []) as ZoneRow[])
      .filter((z) => isActiveSite(z, nowMs))
      .slice(0, ZONE_CAP)

    const zones: PourZone[] = await Promise.all(sites.map(async (z): Promise<PourZone> => {
      // Same centroid math as the nightly weather cron: ring-vertex average.
      const ring = z.geometry?.coordinates?.[0]
      if (!ring || ring.length < 3) return { id: z.id, name: z.name, days: [], nextBad: null }
      const lng = ring.reduce((sum, p) => sum + p[0], 0) / ring.length
      const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length
      try {
        const days = await pourcastAt(lat, lng)
        const bad = days.find((day) => day.flags.length > 0)
        return {
          id: z.id,
          name: z.name,
          days,
          nextBad: bad ? { date: bad.date, reason: bad.flags[0] } : null,
        }
      } catch {
        // One site's forecast failing must not sink the rest.
        return { id: z.id, name: z.name, days: [], nextBad: null }
      }
    }))

    // Cache useful answers for the full TTL; cache an all-empty blip too,
    // but SHORT — otherwise a down Open-Meteo means every request fires up
    // to 25 upstream calls (sec-check, Aug 12). Short-cache = backdate.
    const useful = zones.some((z) => z.days.length > 0) || zones.length === 0
    if (cache.size > 100) {
      let oldest: string | null = null, oldestAt = Infinity
      cache.forEach((v, k) => { if (v.at < oldestAt) { oldestAt = v.at; oldest = k } })
      if (oldest) cache.delete(oldest)
    }
    cache.set(companyKey, { at: useful ? Date.now() : Date.now() - (CACHE_MS - 90_000), zones })
    return NextResponse.json({ zones })
  } catch {
    return NextResponse.json({ zones: [] })
  }
}
