import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Site weather receipts — one row per job-site zone per day: high/low, rain
 * total, max wind. Runs nightly; the zone page renders the log as evidence
 * for rain-delay claims ("it rained 1.4 inches on the 12th, here's the log").
 * Free model data, keyless; calls scale with SITES, not viewers.
 */

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  let written = 0
  let failed = 0

  const { data: companies } = await db.from('companies').select('id').limit(20)
  for (const co of companies ?? []) {
    const { data: zones } = await db
      .from('geofences')
      .select('id, geometry, kind')
      .eq('company_id', co.id)
      .limit(40)
    for (const z of zones ?? []) {
      if (z.kind === 'boundary') continue
      const ring = (z.geometry as GeoJSON.Polygon | null)?.coordinates?.[0] as [number, number][] | undefined
      if (!ring || ring.length < 3) continue
      const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length
      const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
          '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code' +
          '&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph&timezone=auto&forecast_days=1',
          { signal: AbortSignal.timeout(8000) }
        )
        if (!r.ok) { failed++; continue }
        const j = await r.json() as {
          // Top-level latitude/longitude = the MODEL GRID POINT Open-Meteo
          // snapped our centroid to — the true source location (mig 060).
          latitude?: number; longitude?: number; elevation?: number
          daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_sum?: number[]; wind_speed_10m_max?: number[]; weather_code?: number[] }
        }
        const d = j.daily
        const day = d?.time?.[0]
        if (!day) { failed++; continue }
        const base = {
          company_id: co.id,
          geofence_id: z.id,
          day,
          temp_hi: d?.temperature_2m_max?.[0] ?? null,
          temp_lo: d?.temperature_2m_min?.[0] ?? null,
          rain_in: d?.precipitation_sum?.[0] ?? null,
          wind_max: d?.wind_speed_10m_max?.[0] ?? null,
          code: d?.weather_code?.[0] ?? null,
          source: 'model',
        }
        const full = {
          ...base,
          src_lat: typeof j.latitude === 'number' ? j.latitude : null,
          src_lng: typeof j.longitude === 'number' ? j.longitude : null,
          src_elev_m: typeof j.elevation === 'number' ? j.elevation : null,
        }
        let { error } = await db.from('site_weather').upsert(full, { onConflict: 'geofence_id,day' })
        // Migration 060 not applied yet → keep logging without provenance.
        if (error && (error.code === 'PGRST204' || error.code === '42703')) {
          ({ error } = await db.from('site_weather').upsert(base, { onConflict: 'geofence_id,day' }))
        }
        if (error) failed++
        else written++
      } catch {
        failed++
      }
    }
  }

  return NextResponse.json({ ok: true, written, failed, at: new Date().toISOString() })
}
