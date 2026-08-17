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
      // Browser-ish UA: NOMADS fronted responses 301'd our anonymous
      // fetches from Vercel (/diag Jul 14); redirect follow is explicit.
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; HammerTrack-weather/1.0; hello@hammertrack.ai)' },
      })
      if (!r.ok) {
        lastTried.push({ url: url.slice(0, 90), status: r.status, location: r.headers.get('location') ?? undefined })
        continue
      }
      const text = await r.text()
      const u = parseVar(text, 'ugrd10m')
      const v = parseVar(text, 'vgrd10m')
      if (u && v) {
        return { lat0: 20, lon0: -130, dLat: 0.5, dLon: 0.5, ny: NY, nx: NX, u, v, ref: `${d}/${h}z` }
      }
      lastTried.push({ url: url.slice(0, 90), status: r.status, note: `parse miss: ${text.slice(0, 60).replace(/\s+/g, ' ')}` })
    } catch (err) {
      lastTried.push({ url: url.slice(0, 90), note: err instanceof Error ? err.message : 'fetch failed' })
    }
  }
  return null
}

// Rolling forensics from the last failed fetch pass — surfaced in the 503
// body so a /diag or browser hit tells us exactly how NOMADS is refusing us.
let lastTried: { url: string; status?: number; location?: string; note?: string }[] = []

// ── Fallback: Unidata THREDDS (same GFS model, university-run server that
// welcomes programmatic access — NOMADS 301-blocks datacenter IPs).
// Response shapes verified live via the repo's URL-probe workflow Jul 14:
// lat arrives DESCENDING (55→20), height index 0 is the 10 m level, data
// rows read "[t][h][row], v1, v2, …" with lat/lon value vectors inline.
const THREDDS = 'https://thredds.ucar.edu/thredds/dodsC/grib/NCEP/GFS/Global_0p25deg/Best'
const U_VAR = 'u-component_of_wind_height_above_ground'
const V_VAR = 'v-component_of_wind_height_above_ground'

async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'HammerTrack weather (hello@hammertrack.ai)' },
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

/** Pull one variable's grid rows + its lat/lon map vectors from OPeNDAP ascii. */
function odapGrid(text: string, varName: string): { rows: number[][]; lat: number[]; lon: number[] } | null {
  const lines = text.split('\n')
  const rows: number[][] = []
  let lat: number[] = []
  let lon: number[] = []
  const vecAfter = (i: number): number[] => {
    const out: number[] = []
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim()
      if (!t) break
      for (const s of t.split(',')) {
        const f = parseFloat(s)
        if (Number.isFinite(f)) out.push(f)
      }
    }
    return out
  }
  let inData = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inData) {
      if (line.startsWith(`${varName}.${varName}[`)) inData = true
      continue
    }
    if (line.startsWith('[')) {
      const vals = line.slice(line.indexOf(',') + 1).split(',').map((s) => parseFloat(s))
      rows.push(vals.map((f) => (!Number.isFinite(f) || Math.abs(f) > 1e19 ? 0 : f)))
      continue
    }
    if (line.startsWith(`${varName}.lat[`)) { lat = vecAfter(i); continue }
    if (line.startsWith(`${varName}.lon[`)) { lon = vecAfter(i); break }
  }
  return rows.length && lat.length && lon.length ? { rows, lat, lon } : null
}

async function fetchThredds(): Promise<WindFieldJson | null> {
  try {
    // The dataset's clock: time values are "Hour since <epoch>" (units in DAS).
    const das = await fetchText(`${THREDDS}.das`)
    const um = das.match(/Hour since ([0-9][0-9T:\-\.]*Z?)/i)
    if (!um) { lastTried.push({ url: 'thredds.das', note: 'time units not found' }); return null }
    const epochMs = Date.parse(um[1])
    if (!Number.isFinite(epochMs)) { lastTried.push({ url: 'thredds.das', note: `bad epoch ${um[1]}` }); return null }

    const tText = await fetchText(`${THREDDS}.ascii?time`)
    // The values line is the longest comma-separated numeric line in the reply.
    let hours: number[] = []
    for (const l of tText.split('\n')) {
      const t = l.trim()
      if (!t.includes(',') || !/^[-0-9.eE+, ]+$/.test(t)) continue
      const vals = t.split(',').map((s) => parseFloat(s)).filter(Number.isFinite)
      if (vals.length > hours.length) hours = vals
    }
    if (!hours.length) { lastTried.push({ url: 'thredds time', note: 'no time vector' }); return null }
    const nowH = (Date.now() - epochMs) / 3_600_000
    let tIdx = -1
    for (let i = 0; i < hours.length; i++) if (hours[i] <= nowH + 1.5) tIdx = i
    if (tIdx < 0) tIdx = 0

    // 10 m u+v over 20–55N / 130–60W, strided from 0.25° to our 0.5° grid.
    const sel = `[${tIdx}][0][140:2:280][920:2:1200]`
    const body = await fetchText(`${THREDDS}.ascii?${U_VAR}${sel},${V_VAR}${sel}`, 22_000)
    const u = odapGrid(body, U_VAR)
    const v = odapGrid(body, V_VAR)
    if (!u || !v || u.rows.length !== v.rows.length) {
      lastTried.push({ url: 'thredds u/v', note: `parse miss u:${u?.rows.length ?? 0} v:${v?.rows.length ?? 0}` })
      return null
    }
    // Rows arrive north→south; our field is south-up — place by latitude value.
    const ny = u.lat.length
    const nx = u.lon.length
    const uArr = new Array<number>(ny * nx).fill(0)
    const vArr = new Array<number>(ny * nx).fill(0)
    for (let r = 0; r < ny; r++) {
      const j = Math.round((u.lat[r] - 20) / 0.5)
      if (j < 0 || j >= ny) continue
      for (let c = 0; c < nx; c++) {
        uArr[j * nx + c] = u.rows[r]?.[c] ?? 0
        vArr[j * nx + c] = v.rows[r]?.[c] ?? 0
      }
    }
    return { lat0: 20, lon0: -130, dLat: 0.5, dLon: 0.5, ny, nx, u: uArr, v: vArr, ref: `gfs-thredds+${Math.round(hours[tIdx] - nowH)}h` }
  } catch (err) {
    lastTried.push({ url: 'thredds', note: err instanceof Error ? err.message : 'fetch failed' })
    return null
  }
}

export async function GET() {
  if (isMock) {
    return NextResponse.json(syntheticField(), { headers: { 'Cache-Control': 'public, max-age=3600' } })
  }
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data, { headers: { 'Cache-Control': 'public, s-maxage=3600' } })
  }
  lastTried = []
  const data = (await fetchGfs()) ?? (await fetchThredds())
  if (!data) {
    // Stale beats blank if we ever had a field this process lifetime.
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json({ error: 'wind model unavailable', tried: lastTried.slice(0, 6) }, { status: 503 })
  }
  cache = { data, at: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=3600' } })
}
