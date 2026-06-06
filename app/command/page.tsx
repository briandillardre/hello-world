import type { Metadata } from 'next'
import { MOCK_ASSETS, MOCK_GEOFENCES, MOCK_TOOL_ASSOCIATIONS, MOCK_ALERTS, MOCK_COMPANY } from '@/lib/mock-data'
import { resolveToolLocations } from '@/lib/db/tools'
import { generateTracks } from '@/lib/trails'
import { PROJECTS, projectCost, LIVE_DAY_FRACTION, moneyFull } from '@/lib/projects'
import { CommandCenter, type CommandKpis } from '@/components/command/CommandCenter'

export const metadata: Metadata = {
  title: 'HammerTrack — Command Center',
  description: 'Live fleet command center for the lobby TV.',
}

export default function CommandPage() {
  const assets = resolveToolLocations(MOCK_ASSETS, MOCK_TOOL_ASSOCIATIONS)
  const tracks = generateTracks(assets)

  const costToday = PROJECTS.reduce((s, p) => s + projectCost(p, LIVE_DAY_FRACTION).todayTotal, 0)

  const kpis: CommandKpis = {
    assetsOnline: assets.filter((a) => a.location).length,
    assetsTotal: assets.length,
    equipmentRunning: assets.filter((a) => a.type === 'equipment').length,
    crewOnSite: assets.filter((a) => a.type === 'personnel').length,
    activeAlerts: MOCK_ALERTS.filter((a) => !a.acknowledged_at).length,
    costToday: moneyFull(costToday),
    sites: PROJECTS.length,
  }

  return (
    <CommandCenter
      assets={assets}
      geofences={MOCK_GEOFENCES}
      tracks={tracks}
      kpis={kpis}
      company={MOCK_COMPANY.name}
    />
  )
}
