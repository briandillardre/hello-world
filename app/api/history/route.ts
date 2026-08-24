import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
// Long windows page through a lot of rows — never let the platform default
// (10s) kill the fetch mid-way; that silent 504 was why 30d/YTD/All fell back
// to the newest-biased snapshot and "lost" older trips entirely.
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// Hard caps: enough for several days of second-by-second OBD pings after
// thinning, small enough to stay a snappy mobile payload.
const FETCH_CAP = 40_000
const SHIP_CAP = 20_000
// Reduced-resolution budget for the part of the window OLDER than the
// full-res cap (see sampled_history below).
const BACKFILL_CAP = 10_000

/**
 * Range-scoped location history for the timeline. The map page ships a capped
 * snapshot for first paint; when the user picks a range this endpoint returns
 * rows for EXACTLY that window, so old days stop being silently truncated by
 * the since-forever fetch cap (the "yesterday's track lost data" bug).
 *
 * Auth: RLS via the caller's Supabase session cookie — no service role here.
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ rows: [] })

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const fromMs = from ? Date.parse(from) : NaN
  const toMs = to ? Date.parse(to) : NaN
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return NextResponse.json({ error: 'invalid window' }, { status: 400 })
  }

  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const spanDays = (toMs - fromMs) / 86_400_000
  const maxAge = spanDays <= 2 ? 30 : spanDays <= 31 ? 240 : 600

  // ── LONG RANGES READ THE PRE-ROLLED DAILY TRAILS (077) ─────────────────
  // The live sampler window-scans every raw ping in the range; on YTD/All
  // that blows the DB's statement budget and used to fall back to a
  // newest-first fetch — long ranges "lost" everything but the last days
  // (Brian, Aug 25). trail_daily holds each asset-day compressed once to
  // ≤288 points (≤36 for the lite tier), so this path reads hundreds of
  // tiny rows at ANY fleet size. The hourly cron keeps today/yesterday
  // fresh and drains history; missing days simply fall through below.
  if (spanDays > 2.5) {
    const useLite = spanDays > 45
    const col = useLite ? 'pts_lite' : 'pts'
    const { data: dayRows } = await supabase
      .from('trail_daily')
      .select(`asset_id, day, ${col}`)
      .gte('day', new Date(fromMs).toISOString().slice(0, 10))
      .lte('day', new Date(toMs).toISOString().slice(0, 10))
      .order('day', { ascending: true })
    if (dayRows && dayRows.length) {
      type Pt = [number, number, number, number | null]
      const byAsset = new Map<string, { asset_id: string; lat: number; lng: number; speed: number | null; timestamp: string; ms: number }[]>()
      for (const r of dayRows as unknown as { asset_id: string; day: string; [k: string]: unknown }[]) {
        const pts = (r[col] ?? []) as Pt[]
        if (!Array.isArray(pts)) continue
        const list = byAsset.get(r.asset_id) ?? []
        for (const p of pts) {
          const ms = (p?.[2] ?? 0) * 1000
          if (ms < fromMs || ms >= toMs) continue
          list.push({ asset_id: r.asset_id, lat: p[1], lng: p[0], speed: p[3] ?? null, timestamp: new Date(ms).toISOString(), ms })
        }
        byAsset.set(r.asset_id, list)
      }
      // Fair per-asset budget, same philosophy as the live sampler.
      const budgetTotal = 12_000
      const per = Math.max(400, Math.floor(budgetTotal / Math.max(1, byAsset.size)))
      const rows: { asset_id: string; lat: number; lng: number; speed: number | null; timestamp: string }[] = []
      for (const list of Array.from(byAsset.values())) {
        const stride = Math.max(1, Math.ceil(list.length / per))
        for (let i = 0; i < list.length; i++) {
          if (i % stride === 0 || i === list.length - 1) {
            const p = list[i]
            rows.push({ asset_id: p.asset_id, lat: p.lat, lng: p.lng, speed: p.speed, timestamp: p.timestamp })
          }
        }
      }
      rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
      return NextResponse.json(
        { rows, truncated: false, source: 'rollup', count: rows.length },
        { headers: { 'Cache-Control': `private, max-age=${maxAge}` } }
      )
    }
    // No rollups yet (backfill still draining) — fall through to the live paths.
  }

  // ── ONE PATH FOR EVERY RANGE ───────────────────────────────────────────
  // Today / Yesterday / 7d / 30d / YTD / All / Custom all resolve through the
  // SAME per-asset sampler (039). This is deliberate and is the permanent fix
  // for "7d shows more than 30d, and YTD/All disagree with both": while short
  // and long windows ran different code — different caps, different thinning,
  // different silent fallbacks — the ranges could and did contradict each
  // other. Now the only difference between ranges is the window itself.
  //
  // Density is bounded, not truncated: an asset whose rows already fit its
  // slice of the budget comes back at FULL resolution (stride 1), so short
  // windows lose nothing. Bigger windows simply stride wider, evenly across
  // the whole span — never newest-biased.
  const budget = spanDays <= 2 ? 30_000 : spanDays <= 31 ? 20_000 : 14_000
  const { data: sampled, error: rpcErr } = await supabase.rpc('sampled_history_json', {
    p_from: new Date(fromMs).toISOString(),
    p_to: new Date(toMs).toISOString(),
    p_max: budget,
  })
  if (!rpcErr && Array.isArray(sampled)) {
    return NextResponse.json(
      // `source`/`count` are diagnostics: if a range ever looks wrong again,
      // the Network tab says which path served it and how much it returned.
      // truncated is HONEST now — a payload at the budget ceiling engages the
      // client's snapshot-splice repair instead of claiming completeness.
      { rows: sampled, truncated: sampled.length >= budget, source: 'sampled', count: sampled.length },
      { headers: { 'Cache-Control': `private, max-age=${maxAge}` } }
    )
  }
  // Pre-063 DB (json wrapper missing) — fall through to the legacy paged fetch.
  const rpcNote = rpcErr?.message ?? 'sampled_history unavailable'

  // Fetch NEWEST-first in pages: Supabase's API "Max Rows" setting silently
  // caps a single .limit(40000) to as little as 1000 rows — which starved the
  // longer ranges (7d/30d/YTD "not working"). .range() paging gets past any
  // server cap. Newest-first because when a window truly exceeds our cap,
  // losing the oldest hours beats dropping the newest tracker's whole history
  // (a freshly installed unit's data is always at the recent end). Pages run
  // in small parallel batches — 40 sequential round-trips was pushing long
  // windows past the function timeout (the 30d/YTD/All missing-trip bug).
  const PAGE = 1000
  const CONCURRENCY = 5
  const fetched: { asset_id: string; lat: number; lng: number; speed: number | null; timestamp: string }[] = []
  let offset = 0
  let done = false
  while (!done && offset < FETCH_CAP) {
    const offsets: number[] = []
    for (let i = 0; i < CONCURRENCY && offset < FETCH_CAP; i++, offset += PAGE) offsets.push(offset)
    const results = await Promise.all(offsets.map((o) =>
      supabase
        .from('asset_locations')
        .select('asset_id, lat, lng, speed, timestamp')
        .gte('timestamp', new Date(fromMs).toISOString())
        .lt('timestamp', new Date(toMs).toISOString())
        .order('timestamp', { ascending: false })
        .range(o, o + PAGE - 1)
    ))
    for (const { data, error } of results) {
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      fetched.push(...(data ?? []))
      if (!data || data.length < PAGE) done = true
    }
  }

  const truncated = fetched.length >= FETCH_CAP
  let rows = fetched.reverse()

  // Over-cap window: everything OLDER than the full-res cap still has to
  // exist on the map. sampled_history (migration 035) returns one uniform
  // stride across the remainder in a single query — without this, a trip
  // older than the cap horizon showed on 7d but vanished from 30d/YTD/All
  // (Chesterfield run, Jul 17). RLS applies inside (SECURITY INVOKER).
  if (truncated && rows.length) {
    const oldestMs = Date.parse(rows[0].timestamp)
    // Skip the whole-remainder scan when the uncovered gap is trivial — a
    // sub-30-minute tail ships zero visually meaningful points but still made
    // Postgres window-scan the range on every poll (DB drag, Jul 21).
    if (Number.isFinite(oldestMs) && oldestMs - fromMs > 30 * 60_000) {
      const { data: older, error: rpcErr } = await supabase.rpc('sampled_history_json', {
        p_from: new Date(fromMs).toISOString(),
        p_to: new Date(oldestMs).toISOString(),
        p_max: BACKFILL_CAP,
      })
      // Pre-035 DB (function missing): keep newest-only rows; the client's
      // snapshot splice remains as the last-ditch fallback.
      if (!rpcErr && Array.isArray(older) && older.length) {
        rows = [...(older as typeof rows), ...rows]
      }
    }
  }

  // Even stride ACROSS the window (not newest-biased) keeps every hour of the
  // day equally represented when we're over the ship cap.
  // Geometry-aware thinning: keeps every curve point, drops straight-line
  // redundancy — the uniform stride here is what made 7-day trails cut
  // corners across the interstate ("that does not look good", Jul 12).
  const { simplifyHistoryRows } = await import('@/lib/simplify')
  const thinned = rows.length > SHIP_CAP ? simplifyHistoryRows(rows, 12, SHIP_CAP) : rows

  // Cache big windows longer — their content barely changes minute to minute,
  // and the browser cache absorbs an over-eager poller between real re-pulls.
  return NextResponse.json(
    { rows: thinned, truncated, source: 'paged', count: thinned.length, note: rpcNote },
    { headers: { 'Cache-Control': `private, max-age=${maxAge}` } }
  )
}
