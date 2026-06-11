import type { Metadata } from 'next'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { generateTracks } from '@/lib/trails'
import { PROJECTS, projectCost, LIVE_DAY_FRACTION, moneyFull } from '@/lib/projects'
import { pointInPolygon } from '@/lib/alerts-engine'
import { CommandCenter, type CommandKpis } from '@/components/command/CommandCenter'

export const metadata: Metadata = {
  title: 'HammerTrack — Command Center',
  description: 'Live fleet command center for the lobby TV.',
}

// Live fleet data must never be baked at build time.
export const dynamic = 'force-dynamic'

export default async function CommandPage() {
  const [rawAssets, geofences, alerts, toolAssociations] = await Promise.all([
    getAssetsWithLocations(MOCK_COMPANY.id),
    getGeofences(MOCK_COMPANY.id),
    getAlertEvents(MOCK_COMPANY.id),
    getToolAssociations(MOCK_COMPANY.id),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)
  const tracks = generateTracks(assets)

  const costToday = PROJECTS.reduce((s, p) => s + projectCost(p, LIVE_DAY_FRACTION).todayTotal, 0)

  // Measure what the chips claim: "moving" = telemetry speed > 0,
  // "on site" = position inside one of the job-site geofences.
  const onAnySite = (lng: number, lat: number) =>
    geofences.some((g) => pointInPolygon([lng, lat], g.geometry.coordinates[0] as [number, number][]))

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
    sites: PROJECTS.length,
  }

  return (
    <CommandCenter
      assets={assets}
      geofences={geofences}
      tracks={tracks}
      kpis={kpis}
      company={MOCK_COMPANY.name}
    />
  )
}
