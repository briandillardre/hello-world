import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// Hard caps: enough for several days of second-by-second OBD pings after
// thinning, small enough to stay a snappy mobile payload.
const FETCH_CAP = 40_000
const SHIP_CAP = 5_000

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

  // Fetch NEWEST-first: when a window holds more than the cap, losing the
  // oldest hours beats silently dropping the newest tracker's whole history
  // (a freshly installed unit's data is always at the recent end — "7 days
  // not showing the Atlas at all"). The client backfills the older tail from
  // its evenly-strided snapshot when `truncated` is set.
  const { data, error } = await supabase
    .from('asset_locations')
    .select('asset_id, lat, lng, speed, timestamp')
    .gte('timestamp', new Date(fromMs).toISOString())
    .lt('timestamp', new Date(toMs).toISOString())
    .order('timestamp', { ascending: false })
    .limit(FETCH_CAP)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).reverse()
  // Even stride ACROSS the window (not newest-biased) keeps every hour of the
  // day equally represented when we're over the ship cap.
  const stride = Math.max(1, Math.ceil(rows.length / SHIP_CAP))
  const thinned = stride > 1 ? rows.filter((_, i) => i % stride === 0 || i === rows.length - 1) : rows

  return NextResponse.json(
    { rows: thinned, truncated: rows.length >= FETCH_CAP },
    { headers: { 'Cache-Control': 'private, max-age=30' } }
  )
}
