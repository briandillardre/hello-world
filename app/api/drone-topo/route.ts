/**
 * GET /api/drone-topo?surface=<id>&interval=<ft> — contours off one drone
 * flight's elevation surface (a dirt_surfaces DSM), as GeoJSON lines for the
 * map's "Drone topo & survey" layer (163, Beta). The flight is read over its
 * site's outline, resampled to a ~0.5–2 m grid and contoured at the interval
 * in feet (index line every 5th, labelled). Read under the caller's RLS; the
 * result is remembered on this server for an hour (a flight never changes).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import { keyRateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FT = 0.3048
const cache = new Map<string, { at: number; body: string }>()

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('surface') ?? ''
  const interval = Math.min(10, Math.max(0.25, Number(req.nextUrl.searchParams.get('interval')) || 1))
  if (!UUID.test(id)) return NextResponse.json({ error: 'surface?' }, { status: 400 })
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in' }, { status: 401 })
    const perms = await getMyPermissions()
    if (isProspect(perms) || !perms.features.includes('zones') || !perms.features.includes('beta')) return NextResponse.json({ error: 'Not open' }, { status: 403 })
    const companyId = await getCurrentCompanyId()
    if (!(await dirtAddonActive(companyId))) return NextResponse.json({ error: 'Add-on' }, { status: 403 })
    const key = `${companyId}|${id}|${interval}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < 3_600_000) return new NextResponse(hit.body, { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' } })
    if (keyRateLimited(user.id, 'drone-topo', 20)) return NextResponse.json({ error: 'Slow down' }, { status: 429 })
    // RLS: the caller's company's live, ready flight
    const { data: s } = await db.from('dirt_surfaces').select('id, geofence_id, path, info, status').eq('id', id).eq('company_id', companyId).maybeSingle()
    if (!s || s.status !== 'ready' || !s.info) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const info = s.info as import('@/lib/dirt/dsm').DsmInfo
    let ringLL: [number, number][] = []
    if (s.geofence_id) {
      const { data: g } = await db.from('geofences_json').select('geometry').eq('id', s.geofence_id).maybeSingle()
      ringLL = ((g?.geometry as { coordinates?: [number, number][][] } | null)?.coordinates?.[0] ?? []) as [number, number][]
    }
    if (ringLL.length < 3) {
      const b = info.bounds
      if (!b) return NextResponse.json({ error: 'No footprint' }, { status: 422 })
      ringLL = [[b.minLng, b.minLat], [b.maxLng, b.minLat], [b.maxLng, b.maxLat], [b.minLng, b.maxLat]] }
    const { makeFrame, toFrame, fromFrame } = await import('@/lib/dirt/tm')
    const cLng = ringLL.reduce((a, p) => a + p[0], 0) / ringLL.length, cLat = ringLL.reduce((a, p) => a + p[1], 0) / ringLL.length
    const frame = makeFrame(cLng, cLat)
    const ringXY = ringLL.map((p) => toFrame(frame, p[0], p[1]))
    const x0 = Math.min(...ringXY.map((p) => p[0])), x1 = Math.max(...ringXY.map((p) => p[0]))
    const y0 = Math.min(...ringXY.map((p) => p[1])), y1 = Math.max(...ringXY.map((p) => p[1]))
    if (x1 - x0 > 3000 || y1 - y0 > 3000) return NextResponse.json({ error: 'Site too big for contours' }, { status: 422 })
    const { data: signed } = await createServiceClient().storage.from('dirt').createSignedUrl(String(s.path), 300)
    if (!signed?.signedUrl) return NextResponse.json({ error: 'File missing' }, { status: 404 })
    const { openDsm, dsmSurface } = await import('@/lib/dirt/dsm')
    const signal = AbortSignal.timeout(45_000)
    const tiff = await openDsm(signed.signedUrl, signal)
    const top = await dsmSurface(tiff, info, frame, [x0, y0, x1, y0, x1, y1, x0, y1], signal)
    // resample to a contouring grid: ~0.5–2 m, never more than ~600 × 600
    const step = Math.max(0.5, top.resM, (x1 - x0) / 600, (y1 - y0) / 600)
    const nx = Math.max(2, Math.floor((x1 - x0) / step) + 1), ny = Math.max(2, Math.floor((y1 - y0) / step) + 1)
    const z = new Float64Array(nx * ny)
    const { pointInPolygon } = await import('@/lib/alerts-engine')
    let lo = Infinity, hi = -Infinity
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, y = y0 + j * step
      const inSite = pointInPolygon(fromFrame(frame, x, y) as [number, number], ringLL)
      const v = inSite ? top.surface.zAt(x, y) / FT : NaN
      z[j * nx + i] = v
      if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v }
    }
    const { contourLevels, contours, simplify } = await import('@/lib/survey/contours')
    let iv = interval
    while (Number.isFinite(lo) && (hi - lo) / iv > 150) iv *= 2
    const lines = contours({ nx, ny, z }, contourLevels(lo, hi, iv), iv, 5)
    let budget = 60_000
    const features: GeoJSON.Feature[] = []
    for (const l of lines) {
      if (budget <= 0) break
      const pts = simplify(l.pts, 0.25).map(([i, j]) => fromFrame(frame, x0 + i * step, y0 + j * step).map((v) => Math.round(v * 1e7) / 1e7) as [number, number])
      if (pts.length < 2) continue
      budget -= pts.length
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: { z: l.level, index: l.index ? 1 : 0, lbl: l.index ? `${Math.round(l.level)}` : '' } })
    }
    const body = JSON.stringify({ type: 'FeatureCollection', features, interval: iv, min: lo, max: hi })
    if (cache.size > 40) cache.delete(cache.keys().next().value as string)
    cache.set(key, { at: Date.now(), body })
    return new NextResponse(body, { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' } })
  } catch (err) {
    const m = err instanceof Error ? err.message : ''
    return NextResponse.json({ error: m === 'outside' ? 'The flight doesn’t cover the site.' : 'Couldn’t read the flight.' }, { status: 502 })
  }
}
