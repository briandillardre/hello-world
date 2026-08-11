/**
 * Fleet scorecard data source — feeds /reports.
 *
 * One sampled fetch over the SAME window math as the map timeline
 * (rangeWindow), scored per vehicle by lib/scorecard, with the longest
 * off-site stops named via the shared Photon geocode cache. Returns null in
 * demo mode so the page falls back to the mock scorecard.
 */

import type { AssetWithLocation, Geofence } from '../types'
import { rangeWindow, type TimeRangeKey } from '../dates'
import { scoreVehicle, foldStops, type ScoreRow, type ScoreRing, type VehicleScore } from '../scorecard'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface FleetScorecard {
  scores: VehicleScore[]
  window: { from: number; to: number }
  /** True when long-range data came back stride-sampled — totals are estimates. */
  sampled: boolean
}

interface WorkOpts { work_start: string; work_end: string; work_days: number[] }

/** How many of the longest off-site stops get a real name per page load.
 *  The geocode cache (11 m buckets) makes repeat loads nearly free. */
const GEOCODE_BUDGET = 24

export async function getFleetScorecard(
  companyId: string,
  assets: AssetWithLocation[],
  geofences: Geofence[],
  range: TimeRangeKey,
  tz: string,
  work: WorkOpts
): Promise<FleetScorecard | null> {
  if (isMock) return null
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()

  // "All time" starts at the first fix the company ever recorded.
  let earliestMs: number | null = null
  if (range === 'all') {
    const { data } = await supabase
      .from('asset_locations')
      .select('timestamp')
      .order('timestamp', { ascending: true })
      .limit(1)
    earliestMs = data?.[0] ? Date.parse(data[0].timestamp) : null
  }
  const window = rangeWindow(tz, range, { earliestMs })

  // Same per-asset sampler as the map timeline (039): short windows come back
  // full-resolution, long ones stride evenly — ranges can't contradict the map.
  const spanDays = (window.to - window.from) / 86_400_000
  const budget = spanDays <= 2 ? 30_000 : spanDays <= 31 ? 20_000 : 14_000
  type Row = ScoreRow & { asset_id: string }
  let rows: Row[] = []
  let sampled = false
  const { data: viaRpc, error: rpcErr } = await supabase.rpc('sampled_history', {
    p_from: new Date(window.from).toISOString(),
    p_to: new Date(window.to).toISOString(),
    p_max: budget,
  })
  if (!rpcErr && Array.isArray(viaRpc)) {
    rows = viaRpc as Row[]
    sampled = rows.length >= budget * 0.9
  } else {
    // Pre-039 install — paged fallback, newest-first past any server row cap.
    const PAGE = 1000
    while (rows.length < 40_000) {
      const { data, error } = await supabase
        .from('asset_locations')
        .select('asset_id, lat, lng, speed, ignition, timestamp')
        .gte('timestamp', new Date(window.from).toISOString())
        .lt('timestamp', new Date(window.to).toISOString())
        .order('timestamp', { ascending: false })
        .range(rows.length, rows.length + PAGE - 1)
      if (error) return { scores: [], window, sampled: false }
      rows.push(...((data ?? []) as Row[]))
      if (!data || data.length < PAGE) break
    }
    rows.reverse()
    sampled = rows.length >= 40_000
  }

  // Zones that mean "at work": job sites + yards. Boundaries aren't places,
  // personal zones stay out so a stop at the owner's home reads honestly as
  // a residence, and VENDORS are their own lane — real work errands that
  // must never count as site time (they get named deterministically below).
  const toRing = (g: Geofence): ScoreRing =>
    ({ id: g.id, name: g.name, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] })
  const rings: ScoreRing[] = geofences
    .filter((g) => g.kind !== 'boundary' && g.kind !== 'vendor' && !g.owner_id)
    .map(toRing)
    .filter((g) => g.ring.length >= 3)
  const vendorRings: ScoreRing[] = geofences
    .filter((g) => g.kind === 'vendor')
    .map(toRing)
    .filter((g) => g.ring.length >= 3)

  const byAsset = new Map<string, ScoreRow[]>()
  for (const r of rows) {
    let list = byAsset.get(r.asset_id)
    if (!list) byAsset.set(r.asset_id, (list = []))
    list.push(r)
  }

  // Trucks and machines only. Tools inherit a carrier's location and phones
  // are people — neither belongs on a vehicle-accountability report.
  const scores: VehicleScore[] = []
  for (const a of assets) {
    if (a.type !== 'vehicle' && a.type !== 'equipment') continue
    const assetRows = byAsset.get(a.id)
    if (!assetRows || assetRows.length < 2) continue
    scores.push(scoreVehicle(a.id, a.name, assetRows, rings, {
      tz, workStart: work.work_start, workEnd: work.work_end, workDays: work.work_days,
      fromMs: window.from, toMs: window.to, vendorRings,
    }))
  }

  // Name the LONGEST off-site stops fleet-wide (they carry the story), fold
  // the rest into "other". Small parallel batches keep Photon happy.
  const pending = scores
    .flatMap((s, si) => s.pendingStops.map((p) => ({ ...p, si })))
    .sort((a, b) => b.minutes - a.minutes)
  const toName = pending.slice(0, GEOCODE_BUDGET)
  const { classifyPoint } = await import('../poi-server')
  const named: { si: number; kind: import('../poi').PoiKind; name: string; minutes: number; inWorkHours: boolean }[] = []
  // HARD TIME BOX. Naming stops is garnish, not the meal — on a cold cache
  // the serial geocode batches were the bulk of a 20-second page ("it is not
  // acceptable", Aug 10). Batches stay small (public Photon instance), but
  // once the deadline passes the remaining stops simply fold into "other";
  // the 11 m-bucket cache names them on the next visit for free.
  const deadline = Date.now() + 2_500
  let namedCount = 0
  for (let i = 0; i < toName.length; i += 8) {
    if (Date.now() > deadline) break
    const batch = toName.slice(i, i + 8)
    const results = await Promise.all(batch.map((p) =>
      Promise.race([
        classifyPoint(p.lat, p.lng),
        new Promise<{ kind: import('../poi').PoiKind; name: string }>((r) =>
          setTimeout(() => r({ kind: 'other', name: '' }), Math.max(400, deadline - Date.now()))),
      ])
    ))
    results.forEach((r, j) => named.push({ si: batch[j].si, kind: r.kind, name: r.name, minutes: batch[j].minutes, inWorkHours: batch[j].inWorkHours }))
    namedCount = i + batch.length
  }
  const rest = [...toName.slice(namedCount), ...pending.slice(GEOCODE_BUDGET)]
  for (let si = 0; si < scores.length; si++) {
    scores[si] = {
      ...scores[si],
      stops: foldStops(
        scores[si],
        named.filter((n) => n.si === si),
        rest.filter((r) => r.si === si)
      ),
    }
  }

  // Vehicles first (they're the accountability story), busiest first within.
  const typeOf = (id: string) => assets.find((a) => a.id === id)?.type ?? 'vehicle'
  scores.sort((a, b) => {
    const ta = typeOf(a.assetId) === 'vehicle' ? 0 : 1
    const tb = typeOf(b.assetId) === 'vehicle' ? 0 : 1
    return ta !== tb ? ta - tb : b.miles - a.miles
  })

  return { scores, window, sampled }
}
