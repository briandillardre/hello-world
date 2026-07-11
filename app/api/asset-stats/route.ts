import { NextRequest, NextResponse } from 'next/server'
import { rangeWindow, DEFAULT_TZ, type TimeRangeKey } from '@/lib/dates'
import { computeRangeStats } from '@/lib/asset-stats'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// One fetch covers every range (they nest), computed once server-side.
const FETCH_CAP = 40_000

const RANGES: { key: TimeRangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All time' },
]

/**
 * Per-asset mileage + top speed for the asset panel's range table
 * (Today / Yesterday / 7d / 30d / YTD / All time). Auth: RLS via the
 * caller's session — an asset outside their company returns zero rows.
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ ranges: [] })

  const assetId = req.nextUrl.searchParams.get('asset')
  if (!assetId) return NextResponse.json({ error: 'asset required' }, { status: 400 })

  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const tz = decodeURIComponent(req.cookies.get('ht_tz')?.value ?? DEFAULT_TZ)

  // Page past Supabase's API Max-Rows cap (a bare .limit(40000) can silently
  // return 1000). Newest-first so an over-cap asset keeps its recent history.
  const PAGE = 1000
  const fetched: { lat: number; lng: number; speed: number | null; timestamp: string }[] = []
  while (fetched.length < FETCH_CAP) {
    const { data, error } = await supabase
      .from('asset_locations')
      .select('lat, lng, speed, timestamp')
      .eq('asset_id', assetId)
      .order('timestamp', { ascending: false })
      .range(fetched.length, fetched.length + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    fetched.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  const pts = fetched
    .reverse()
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed as number | null, ms: Date.parse(r.timestamp) }))
    .filter((p) => Number.isFinite(p.ms))

  const earliestMs = pts.length ? pts[0].ms : null
  const nowMs = Date.now()
  const ranges = RANGES.map(({ key, label }) => {
    const w = rangeWindow(tz, key, { earliestMs })
    return { key, label, ...computeRangeStats(pts, w.from, w.to, earliestMs, nowMs) }
  })

  return NextResponse.json(
    { ranges, truncated: pts.length >= FETCH_CAP },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
