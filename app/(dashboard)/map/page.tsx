import { getAssetsWithLocations } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { getCurrentCompany } from '@/lib/db/company'
import { generateTracks } from '@/lib/trails'
import { MapPageClient } from '@/components/map/MapPageClient'
import { MapTopBar } from '@/components/map/MapTopBar'

// Demo mode renders mock data, so this is statically prerendered (deploys
// atomically + cleanly, like the homepage). When Supabase is wired, switch this
// to `force-dynamic` AND add a no-cache header so the edge doesn't serve stale.
export default async function MapPage() {
  const company = await getCurrentCompany()
  const companyId = company.id
  const [rawAssets, geofences, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getToolAssociations(companyId),
  ])

  // Tools have no GPS of their own — resolve their position from the gateway
  // (truck/equipment) that currently detects them over Bluetooth.
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  // Time-series tracks for the Equipment Trails + Timeline Playback view.
  const tracks = generateTracks(assets)

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
        <MapPageClient assets={assets} geofences={geofences} tracks={tracks} toolGateways={toolGateways} />
      </div>
    </div>
  )
}
