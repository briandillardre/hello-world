import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Actual lightning strikes for the map — NOT the smeared density raster.
 *
 * Source: GOES-East Geostationary Lightning Mapper (GLM) Level-2 flash data
 * on the NOAA Open Data bucket (public domain, keyless). A granule lands
 * every 20 seconds; each is an HDF5/NetCDF-4 file whose flash_lat/flash_lon
 * arrays are the individual optical flash detections. We pull the last few
 * minutes of granules, parse them with h5wasm, and return plain points.
 *
 * Accuracy honesty: GLM pixels are ~8 km — a strike renders near where it
 * hit, not on a parcel. Latency source→here is ~1 minute.
 *
 * Blitzortung was considered and rejected: better precision, but its data
 * license is non-commercial only — not usable in a paid product.
 */

// GOES-19 took over as GOES-East in April 2025; GOES-16 kept as fallback.
const BUCKETS = ['noaa-goes19', 'noaa-goes16']
const PRODUCT = 'GLM-L2-LCFA'
const GRANULES = 9 // ~3 minutes of 20-second granules
const CACHE_MS = 45_000

interface Strike { lat: number; lon: number; ageSec: number }
let cache: { at: number; strikes: Strike[] } | null = null
// Last refresh diagnostics — surfaced via ?debug=1 so a blank map is
// explainable from the phone (which stage died: wasm, listing, parsing).
// Messages only, never stack traces (public endpoint).
let diag: Record<string, unknown> = {}
// Single-flight: concurrent requests at cache expiry share ONE upstream
// pull instead of each running the S3+WASM pipeline (sec-check, Aug 11).
let inflight: Promise<void> | null = null

/** s20262231758000 → ms UTC (year, day-of-year, HH, MM, SS). */
function granuleMs(key: string): number {
  const m = key.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})/)
  if (!m) return 0
  const [, y, doy, hh, mm, ss] = m
  return Date.UTC(Number(y), 0, 1, Number(hh), Number(mm), Number(ss)) + (Number(doy) - 1) * 86_400_000
}

async function listLatestKeys(bucket: string): Promise<string[]> {
  // Granules are keyed by UTC year/day-of-year/hour. Just after the top of
  // the hour the fresh files are still few — list the previous hour too.
  const hours: Date[] = [new Date()]
  if (new Date().getUTCMinutes() < 5) hours.push(new Date(Date.now() - 3_600_000))
  const keys: string[] = []
  for (const d of hours) {
    const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1
    const prefix = `${PRODUCT}/${d.getUTCFullYear()}/${String(doy).padStart(3, '0')}/${String(d.getUTCHours()).padStart(2, '0')}/`
    const r = await fetch(`https://${bucket}.s3.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`, {
      signal: AbortSignal.timeout(8_000), cache: 'no-store',
    })
    if (!r.ok) throw new Error(`S3 list ${r.status}`)
    const xml = await r.text()
    const re = /<Key>([^<]+)<\/Key>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) keys.push(m[1])
  }
  return keys.sort().slice(-GRANULES)
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  // Optional bbox trim (w,s,e,n) — GLM sees a whole hemisphere.
  const w = Number(sp.get('w')), s = Number(sp.get('s')), e = Number(sp.get('e')), n = Number(sp.get('n'))
  const hasBox = [w, s, e, n].every(Number.isFinite)

  if (!cache || Date.now() - cache.at > CACHE_MS) {
    try {
      if (!inflight) inflight = refreshCache().finally(() => { inflight = null })
      await inflight
    } catch (err) {
      diag.fatal = err instanceof Error ? err.message : String(err)
      console.error('[lightning-strikes]', err)
      if (sp.get('debug')) return NextResponse.json({ diag }, { status: 200 })
      if (cache) return NextResponse.json({ strikes: trim(cache.strikes, hasBox, w, s, e, n), stale: true })
      return NextResponse.json({ error: err instanceof Error ? err.message : 'GLM feed unreachable' }, { status: 503 })
    }
  }
  if (sp.get('debug')) return NextResponse.json({ diag, cached: cache?.strikes.length ?? 0 })
  return NextResponse.json({ strikes: trim(cache?.strikes ?? [], hasBox, w, s, e, n) })
}

async function refreshCache(): Promise<void> {
  diag = { at: new Date().toISOString() }
  const h5wasm = (await import('h5wasm/node')).default
  const Module = await h5wasm.ready
  diag.wasm = 'ready'
  const FS = (Module as unknown as { FS: { writeFile: (p: string, d: Uint8Array) => void; unlink: (p: string) => void } }).FS
  let keys: string[] = []
  let bucket = BUCKETS[0]
  for (const b of BUCKETS) {
    try { keys = await listLatestKeys(b); bucket = b; if (keys.length) break } catch (e) { diag[`list_${b}`] = String(e) }
  }
  diag.bucket = bucket
  diag.granules = keys.length
  if (!keys.length) throw new Error('no GLM granules listed')
  const now = Date.now()
  const strikes: Strike[] = []
  let parsed = 0
  for (const key of keys) {
    try {
      const r = await fetch(`https://${bucket}.s3.amazonaws.com/${key}`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' })
      if (!r.ok) continue
      const buf = new Uint8Array(await r.arrayBuffer())
      const name = `/g${granuleMs(key)}.nc`
      FS.writeFile(name, buf)
      const f = new h5wasm.File(name, 'r')
      try {
        const lat = (f.get('flash_lat') as { value: Float32Array } | null)?.value
        const lon = (f.get('flash_lon') as { value: Float32Array } | null)?.value
        const ageSec = Math.max(0, Math.round((now - granuleMs(key)) / 1000))
        if (lat && lon) { parsed++; for (let i = 0; i < lat.length; i++) strikes.push({ lat: lat[i], lon: lon[i], ageSec }) }
      } finally {
        f.close()
        FS.unlink(name)
      }
    } catch (e) { diag[`granule_err`] = String(e) }
  }
  diag.parsed = parsed
  diag.total = strikes.length
  cache = { at: Date.now(), strikes }
}

function trim(all: Strike[], hasBox: boolean, w: number, s: number, e: number, n: number): Strike[] {
  const out = hasBox ? all.filter((p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n) : all
  // slice from the END — strikes accumulate oldest-first, and when an
  // outbreak overflows the cap it's the freshest bolts that must survive.
  return out.slice(-4000)
}
