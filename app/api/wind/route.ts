import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Gridded surface wind for the animated "Wind flow" layer.
 *
 * Source: NOAA GFS 0.5° via the NOMADS GrADS data server's .ascii endpoint —
 * plain-text arrays, so no GRIB decoding, no key, no license strings attached.
 * One CONUS subset (~20-55N, 130-60W) is ~200 KB and covers every viewport;
 * cached in-module for 3 h (GFS runs 6-hourly).
 *
 * Demo mode returns a synthetic swirl so the layer demos without NOAA.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface WindFieldJson {
  lat0: number; lon0: number; dLat: number; dLon: number
  ny: number; nx: number
  u: number[]; v: number[]
  ref: string
}

// GFS 0.5°: lat index = (lat+90)/0.5, lon index = lonE/0.5.
const LAT_I0 = 220, LAT_I1 = 290   // 20N..55N  → 71 rows
const LON_I0 = 460, LON_I1 = 600   // 130W..60W → 141 cols
const NY = LAT_I1 - LAT_I0 + 1
const NX = LON_I1 - LON_I0 + 1

let cache: { data: WindFieldJson; at: number } | null = null
const TTL_MS = 3 * 3_600_000

function syntheticField(): WindFieldJson {
  // Broad westerly flow + a low spinning over Tennessee — looks alive, is fake.
  const u: number[] = [], v: number[] = []
  const lat0 = 20, lon0 = -130, d = 0.5
  const cLat = 36.2, cLng = -86.7
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const lat = lat0 + y * d, lng = lon0 + x * d
      const dx = lng - cLng, dy = lat - cLat
      const r2 = dx * dx + dy * dy
      const swirl = 220 / (r2 + 25)
      u.push(7 + 4 * Math.sin(lat / 5) - swirl * dy)
      v.push(2 * Math.cos(lng / 7) + swirl * dx)
    }
  }
  return { lat0, lon0, dLat: d, dLon: d, ny: NY, nx: NX, u, v, ref: 'demo' }
}

/** Pull all floats out of one variable's block in GrADS ascii output. */
function parseVar(text: string, name: string): number[] | null {
  const start = text.indexOf(name + ',')
  if (start < 0) return null
  const out: number[] = []
  for (const line of text.slice(start).split('\n').slice(1)) {
    if (!line.startsWith('[')) {
      if (out.length) break // block over (next var / coord arrays)
      continue
    }
    const vals = line.slice(line.indexOf(',') + 1).split(',')
    for (const s of vals) {
      const f = parseFloat(s)
      out.push(!Number.isFinite(f) || Math.abs(f) > 1e19 ? 0 : f)
    }
  }
  return out.length === NY * NX ? out : null
}

async function fetchGfs(): Promise<WindFieldJson | null> {
  const now = new Date()
  // Try the freshest run that's plausibly published (runs land ~5h after cycle).
  const tries: { d: string; h: string }[] = []
  for (let back = 0; back < 2; back++) {
    const day = new Date(now.getTime() - back * 86_400_000)
    const d = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, '0')}${String(day.getUTCDate()).padStart(2, '0')}`
    for (const h of ['18', '12', '06', '00']) {
      const runMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(h))
      if (now.getTime() - runMs > 5 * 3_600_000) tries.push({ d, h })
    }
  }
  for (const { d, h } of tries.slice(0, 5)) {
    const url = `https://nomads.ncep.noaa.gov/dods/gfs_0p50/gfs${d}/gfs_0p50_${h}z.ascii?ugrd10m[0][${LAT_I0}:${LAT_I1}][${LON_I0}:${LON_I1}],vgrd10m[0][${LAT_I0}:${LAT_I1}][${LON_I0}:${LON_I1}]`
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) continue
      const text = await r.text()
      const u = parseVar(text, 'ugrd10m')
      const v = parseVar(text, 'vgrd10m')
      if (u && v) {
        return { lat0: 20, lon0: -130, dLat: 0.5, dLon: 0.5, ny: NY, nx: NX, u, v, ref: `${d}/${h}z` }
      }
    } catch { /* run not up yet or NOMADS mood — try the previous cycle */ }
  }
  return null
}

export async function GET() {
  if (isMock) {
    return NextResponse.json(syntheticField(), { headers: { 'Cache-Control': 'public, max-age=3600' } })
  }
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data, { headers: { 'Cache-Control': 'public, s-maxage=3600' } })
  }
  const data = await fetchGfs()
  if (!data) {
    // Stale beats blank if we ever had a field this process lifetime.
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json({ error: 'wind model unavailable' }, { status: 503 })
  }
  cache = { data, at: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=3600' } })
}
