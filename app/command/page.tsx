import type { Metadata } from 'next'
import { getAssetsWithLocations, getLocationHistory, getEarliestLocationTime } from '@/lib/db/assets'
import { DEFAULT_TZ } from '@/lib/dates'
import { cookies } from 'next/headers'
import { getGeofences } from '@/lib/db/geofences'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations, toolsAboard, getPairingEpisodes } from '@/lib/db/tools'
import { getCurrentCompany } from '@/lib/db/company'
import { generateTracks, tracksFromHistory, historyWindow } from '@/lib/trails'
import { buildCostCurve } from '@/lib/costs'
import { PROJECTS, projectCost, LIVE_DAY_FRACTION, moneyFull } from '@/lib/projects'
import { pointInPolygon } from '@/lib/alerts-engine'
import { CommandCenter, type CommandKpis } from '@/components/command/CommandCenter'

export const metadata: Metadata = {
  title: 'HammerTrack — Command Center',
  description: 'Live fleet command center for the lobby TV.',
}

// Supabase is live — render per-request so the wall shows THIS company's
// fleet, not the demo baked in at build time.
export const dynamic = 'force-dynamic'

export default async function CommandPage() {
  const company = await getCurrentCompany()
  const companyId = company.id
  const [rawAssets, geofences, alerts, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getAlertEvents(companyId),
    getToolAssociations(companyId),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)
  // Real mode: trails from actual history; demo mode: synthetic walks.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const history = await getLocationHistory(companyId, since)
  const tracks = history ? tracksFromHistory(assets, history) : generateTracks(assets)

  // SAME history feed as the live map page, so the kiosk timeline shows
  // identical data (ranges, scrubber, /api/history refetches) — it was
  // running on a private 24h snapshot and disagreed with /map.
  const earliestMs = await getEarliestLocationTime(companyId)
  const fullSince = earliestMs ?? Date.now() - 30 * 86_400_000
  const fullHistory = earliestMs !== null
    ? await getLocationHistory(companyId, new Date(fullSince).toISOString(), 12000)
    : null
  const MAX_SHIP = 20000
  const rows = fullHistory ?? []
  const { simplifyHistoryRows } = await import('@/lib/simplify')
  const historyRows = fullHistory ? (rows.length > MAX_SHIP ? simplifyHistoryRows(rows, 12, MAX_SHIP) : rows) : null
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)

  // Real accounts: cost from per-asset rates × observed activity; demo: PROJECTS.
  const trackWindow = history ? historyWindow(history) : null
  const costToday = history && trackWindow
    ? (buildCostCurve(assets, history, trackWindow.from, trackWindow.to).curve.at(-1) ?? 0)
    : PROJECTS.reduce((s, p) => s + projectCost(p, LIVE_DAY_FRACTION).todayTotal, 0)

  // Measure what the chips claim: "moving" = telemetry speed > 0,
  // "on site" = position inside one of the job-site geofences.
  const onAnySite = (lng: number, lat: number) =>
    geofences.some((g) => g.kind !== 'boundary' && pointInPolygon([lng, lat], g.geometry.coordinates[0] as [number, number][]))

  const kpis: CommandKpis = {
    assetsOnline: assets.filter((a) => a.location).length,
    assetsTotal: assets.length,
    equipmentRunning: assets.filter(
      (a) => (a.type === 'equipment' || a.type === 'vehicle') && (a.location?.speed ?? 0) > 0
    ).length,
    crewOnSite: assets.filter(
      (a) => a.type === 'personnel' && a.location && onAnySite(a.location.lng, a.location.lat)
    ).length,
    activeAlerts: alerts.filter((a) => !a.acknowledged_at).length,
    costToday: moneyFull(costToday),
    // Live accounts: real zones (job sites + yards; boundaries are perimeters,
    // not places). Demo keeps the seeded project count.
    sites: history ? geofences.filter((g) => g.kind !== 'boundary').length : PROJECTS.length,
  }

  return (
    <CommandCenter
      assets={assets}
      geofences={geofences}
      tracks={tracks}
      historyRows={historyRows}
      earliestMs={earliestMs}
      tz={tz}
      kpis={kpis}
      company={company.name}
      alerts={alerts}
      aboard={toolsAboard(rawAssets, toolAssociations)}
      pairingEpisodes={await getPairingEpisodes(companyId, new Date(fullSince).toISOString())}
    />
  )
}
