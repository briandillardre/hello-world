import { NextResponse } from 'next/server'
import { getAssetsWithLocations, getLocationHistory, getEarliestLocationTime } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, getPairingEpisodes } from '@/lib/db/tools'
import { getAlertEvents } from '@/lib/db/alerts'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { historyWindow } from '@/lib/trails'
import { buildCostCurve } from '@/lib/costs'
import { moneyFull } from '@/lib/projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The Command Center's deferred cargo — earliest history timestamp, pairing
 * episodes, cost-today — fetched by the client AFTER the shell and basemap
 * have painted. Trail/timeline rows come from /api/history (the SAME feed
 * /map uses, same window, same caps — "these should be the exact same map",
 * Brian, Aug 22), so this endpoint stays slim.
 *
 * costToday is role-gated exactly like /api/map-data: non-cost roles get
 * null, never dollars on the wire (sec-check P1, Aug 22).
 */
export async function GET() {
  if (isMock) return NextResponse.json({ error: 'demo mode has no live data' }, { status: 404 })
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const [companyId, perms] = await Promise.all([getCurrentCompanyId(), getMyPermissions()])
  const earliestMs = await getEarliestLocationTime(companyId)
  const fullSince = new Date(earliestMs ?? Date.now() - 30 * 86_400_000).toISOString()

  let costToday: string | null = null
  const [pairingEpisodes, alerts] = await Promise.all([
    getPairingEpisodes(companyId, fullSince),
    // Fresh alerts ride along so the wall display's ticker/rail don't fossilize
    // at whatever the server render saw (ship-check P2) — the client re-polls
    // this endpoint every few minutes.
    getAlertEvents(companyId),
    (async () => {
      if (!perms.canViewCosts) return
      const since24 = new Date(Date.now() - 24 * 3_600_000).toISOString()
      const [rawAssets, toolAssociations, history] = await Promise.all([
        getAssetsWithLocations(companyId),
        getToolAssociations(companyId),
        getLocationHistory(companyId, since24),
      ])
      const assets = resolveToolLocations(rawAssets, toolAssociations)
      const w = history ? historyWindow(history) : null
      costToday = history && w
        ? moneyFull(buildCostCurve(assets, history, w.from, w.to).curve.at(-1) ?? 0)
        : moneyFull(0)
    })(),
  ])

  return NextResponse.json(
    { earliestMs, pairingEpisodes, costToday, alerts },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
