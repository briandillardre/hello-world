import { NextRequest, NextResponse } from 'next/server'
import { simulateWindow, fallbackRoute, centroid, type SimAsset, type SimZone, type RouteProvider } from '@/lib/sim/engine'
import type { FlespiMessage } from '@/lib/flespi'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// Catch-up window bounds: first run backfills a working stretch; a stalled
// cron never tries to replay more than this in one go.
const MAX_CATCHUP_MS = 6 * 3_600_000
// Sized to the ingest route's sequential per-message DB work — 150 risked
// its function duration on a beacon-heavy backfill (ship-check P2).
const CHUNK = 60

function keyFor(a: [number, number], b: [number, number]): string {
  return `${a[0].toFixed(4)},${a[1].toFixed(4)}>${b[0].toFixed(4)},${b[1].toFixed(4)}`
}

/** OSRM public router — real road geometry. Cached per zone pair; a moved
 *  zone changes the key, so the next run re-routes to the new spot. */
async function osrmRoute(a: [number, number], b: [number, number]): Promise<{ coords: [number, number][]; meters: number } | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'hammertrack-showroom' } })
    if (!r.ok) return null
    const j = (await r.json()) as { routes?: { distance?: number; geometry?: { coordinates?: [number, number][] } }[] }
    const coords = j.routes?.[0]?.geometry?.coordinates
    if (!coords || coords.length < 2) return null
    return { coords, meters: j.routes?.[0]?.distance ?? 0 }
  } catch {
    return null
  }
}

/**
 * Drives every simulated (showroom) company through the REAL flespi ingest
 * route — simulated trucks are just devices, so alerts, zone sessions, tool
 * pairing and stops all run the production code path. Stateless catch-up:
 * each run generates from the fleet's newest stored fix to now.
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo' })
  // FAIL CLOSED (sec-check, unlike the read-only crons): this route triggers
  // outbound OSRM traffic and DB writes, so with no CRON_SECRET configured
  // it must not run for anonymous callers at all.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = process.env.FLESPI_WEBHOOK_TOKEN
  if (!token) return NextResponse.json({ ok: false, error: 'FLESPI_WEBHOOK_TOKEN unset — simulator cannot ingest' })

  const base = process.env.SIM_INGEST_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://hammertrack.ai')

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()

  const { data: companies } = await svc.from('companies').select('id, name, work_days').eq('simulated', true)
  if (!companies?.length) return NextResponse.json({ ok: true, companies: 0 })

  const results: Record<string, unknown>[] = []
  // Short id in responses/logs only — never full tenant UUIDs (sec-check).
  const shortId = (id: string) => id.slice(0, 8)
  for (const co of companies) {
    const { data: assetRows } = await svc
      .from('assets')
      .select('id, name, type, tracker_id, metadata')
      .eq('company_id', co.id)
      .eq('active', true)
      .like('tracker_id', 'sim-%')
    const assets = (assetRows ?? []) as SimAsset[]
    if (!assets.length) { results.push({ company: shortId(co.id), skipped: 'no sim assets' }); continue }

    // Stable order (ship-check P2): the engine assigns machines/trucks to
    // sites BY INDEX — unordered rows could reassign the excavator to a
    // different site mid-day (teleport chord + spurious left-site alert).
    const { data: fenceRows } = await svc.from('geofences').select('id, name, kind, geometry').eq('company_id', co.id).order('created_at', { ascending: true })
    const zones: SimZone[] = (fenceRows ?? [])
      .filter((g) => g.kind !== 'boundary')
      .map((g) => ({
        id: g.id as string,
        name: g.name as string,
        kind: (g.kind as string | null) ?? null,
        ring: ((g.geometry as { coordinates?: [number, number][][] } | null)?.coordinates?.[0] ?? []) as [number, number][],
      }))
      // Rings are tenant-stored JSON — validate every coordinate so a
      // malformed zone can't throw in keyFor()/the engine and 500 the whole
      // cron for every showroom (sec-check).
      .filter((z) => z.ring.length >= 4 && z.ring.every((p) =>
        Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
        Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90))
    if (!zones.length) { results.push({ company: shortId(co.id), skipped: 'no zones' }); continue }

    // Window: newest stored fix → now (capped).
    const assetIds = assets.map((a) => a.id)
    const { data: newest } = await svc
      .from('asset_locations')
      .select('timestamp')
      .in('asset_id', assetIds)
      .order('timestamp', { ascending: false })
      .limit(1)
    const now = Date.now()
    const lastMs = newest?.[0] ? Date.parse(newest[0].timestamp as string) : 0
    const fromMs = Math.max(Number.isFinite(lastMs) ? lastMs + 30_000 : 0, now - MAX_CATCHUP_MS)
    if (now - fromMs < 3 * 60_000) { results.push({ company: shortId(co.id), skipped: 'up to date' }); continue }

    // Pre-resolve road routes for every zone pair the plans can use.
    const yard = zones.find((z) => z.kind === 'yard') ?? null
    const sites = zones.filter((z) => !z.kind || z.kind === 'site')
    const vendors = zones.filter((z) => z.kind === 'vendor')
    const pairs: [[number, number], [number, number]][] = []
    // Anchor cap bounds the N² pair fan-out — zone count is tenant-
    // controlled and must never translate into unbounded OSRM traffic.
    const anchors = [...(yard ? [yard] : []), ...sites, ...vendors].slice(0, 8).map((z) => centroid(z.ring))
    for (const a of anchors) for (const b of anchors) {
      if (a !== b) pairs.push([a, b])
    }
    const routeMap = new Map<string, { coords: [number, number][]; meters: number }>()
    const keys = pairs.map(([a, b]) => keyFor(a, b))
    const { data: cached } = await svc.from('sim_routes').select('key, geometry, meters').eq('company_id', co.id).in('key', keys)
    for (const r of cached ?? []) routeMap.set(r.key as string, { coords: r.geometry as [number, number][], meters: r.meters as number })
    // Per-run OSRM budget: cache misses beyond this fall back to bowed lines
    // until later runs fill them in — a zone reshuffle never bursts the
    // public router (sec-check).
    let osrmBudget = 12
    for (const [a, b] of pairs) {
      const k = keyFor(a, b)
      if (routeMap.has(k) || osrmBudget <= 0) continue
      osrmBudget--
      const road = await osrmRoute(a, b)
      if (road) {
        routeMap.set(k, road)
        await svc.from('sim_routes').upsert({ company_id: co.id, key: k, geometry: road.coords, meters: road.meters }, { onConflict: 'company_id,key' })
      }
    }
    const route: RouteProvider = (a, b) => routeMap.get(keyFor(a, b)) ?? fallbackRoute(a, b)

    const workDays = Array.isArray(co.work_days) && co.work_days.length ? (co.work_days as number[]) : [1, 2, 3, 4, 5, 6]
    const messages = simulateWindow(assets, zones, route, fromMs, now, 'America/New_York', workDays)

    // Through the front door: the ordinary flespi webhook, chunked.
    let sent = 0
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk: FlespiMessage[] = messages.slice(i, i + CHUNK)
      try {
        const r = await fetch(`${base}/api/ingest/flespi`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-flespi-token': token },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(60_000),
        })
        if (!r.ok) { results.push({ company: shortId(co.id), error: `ingest ${r.status} at msg ${i}` }); break }
        sent += chunk.length
      } catch (e) {
        results.push({ company: shortId(co.id), error: `ingest failed at msg ${i}: ${e instanceof Error ? e.message : 'unknown'}` })
        break
      }
    }
    results.push({ company: shortId(co.id), windowMin: Math.round((now - fromMs) / 60_000), messages: messages.length, sent, roads: routeMap.size })
  }

  return NextResponse.json({ ok: true, companies: companies.length, results })
}
