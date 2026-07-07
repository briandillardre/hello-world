import { getAssetsWithLocations, getLocationHistory } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { getCurrentCompany, getCompanyPrefs } from '@/lib/db/company'
import { generateTracks, tracksFromHistory, historyWindow } from '@/lib/trails'
import { buildCostCurve, zoneCostsFromHistory, type CostCurve, type ZoneCost } from '@/lib/costs'
import { MapPageClient } from '@/components/map/MapPageClient'
import { MapTopBar } from '@/components/map/MapTopBar'

// Demo mode renders mock data, so this is statically prerendered (deploys
// atomically + cleanly, like the homepage). When Supabase is wired, switch this
// to `force-dynamic` AND add a no-cache header so the edge doesn't serve stale.
export default async function MapPage() {
  const company = await getCurrentCompany()
  const companyId = company.id
  const prefs = await getCompanyPrefs()
  const [rawAssets, geofences, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getToolAssociations(companyId),
  ])

  // Tools have no GPS of their own — resolve their position from the gateway
  // (truck/equipment) that currently detects them over Bluetooth.
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  // Time-series tracks for the Equipment Trails + Timeline Playback view.
  // Real mode: last 24h of actual asset_locations (assets with no history get
  // no trail). Demo mode (history === null): synthetic walks for the demo.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const history = await getLocationHistory(companyId, since)
  const tracks = history ? tracksFromHistory(assets, history) : generateTracks(assets)
  // Real window → scrubber shows true timestamps instead of the demo clock.
  const trackWindow = history ? historyWindow(history) : null
  // Real cost curve from per-asset rates × observed activity (null = demo).
  const realCost: CostCurve | null =
    history && trackWindow ? buildCostCurve(assets, history, trackWindow.from, trackWindow.to) : null
  // Per-zone accrual — the zone popup's meter stops when assets leave.
  const zoneCosts: Record<string, ZoneCost> | null = history ? zoneCostsFromHistory(geofences, assets, history) : null

  // Map each tool to the gateway holding it, for the asset detail panel.
  const toolGateways: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of toolAssociations) {
    const gateway = rawAssets.find(a => a.id === assoc.gateway_asset_id)
    if (gateway) toolGateways[assoc.tool_asset_id] = { name: gateway.name, lastSeen: assoc.last_seen }
  }

  return (
    <div className="h-full flex flex-col pb-[70px] md:pb-0">
      <MapTopBar companyName={company.name} />
      <div className="flex-1 relative min-h-0">
        <MapPageClient assets={assets} geofences={geofences} tracks={tracks} realWindow={trackWindow} realCost={realCost} realZoneCosts={zoneCosts} toolGateways={toolGateways} defaultWeatherPlace={prefs.weatherPlace} canSetWeatherDefault={prefs.isAdmin} />
      </div>
    </div>
  )
}
