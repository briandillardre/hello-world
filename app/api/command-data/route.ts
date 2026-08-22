import { NextResponse } from 'next/server'
import { getAssetsWithLocations, getLocationHistory, getEarliestLocationTime } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, getPairingEpisodes } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'
import { tracksFromHistory, historyWindow } from '@/lib/trails'
import { buildCostCurve } from '@/lib/costs'
import { moneyFull } from '@/lib/projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The Command Center's heavy cargo — 24h trails, the full timeline history,
 * pairing episodes, cost-today — fetched by the client AFTER the shell and
 * basemap have painted ("the entire app needs to be snappy", Brian, Aug 22).
 * Exactly the work the /command server page used to block on.
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

  const companyId = await getCurrentCompanyId()
  const since24 = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const [rawAssets, toolAssociations, history, earliestMs] = await Promise.all([
    getAssetsWithLocations(companyId),
    getToolAssociations(companyId),
    getLocationHistory(companyId, since24),
    getEarliestLocationTime(companyId),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)
  const tracks = history ? tracksFromHistory(assets, history) : []

  const fullSince = new Date(earliestMs ?? Date.now() - 30 * 86_400_000).toISOString()
  const [fullHistory, pairingEpisodes] = await Promise.all([
    earliestMs !== null ? getLocationHistory(companyId, fullSince, 12000) : Promise.resolve(null),
    getPairingEpisodes(companyId, fullSince),
  ])
  const MAX_SHIP = 20000
  const rows = fullHistory ?? []
  const { simplifyHistoryRows } = await import('@/lib/simplify')
  const historyRows = fullHistory ? (rows.length > MAX_SHIP ? simplifyHistoryRows(rows, 12, MAX_SHIP) : rows) : null

  const w = history ? historyWindow(history) : null
  const costToday = history && w
    ? moneyFull(buildCostCurve(assets, history, w.from, w.to).curve.at(-1) ?? 0)
    : moneyFull(0)

  return NextResponse.json({ tracks, historyRows, earliestMs, pairingEpisodes, costToday })
}
