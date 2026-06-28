import { MOCK_COMPANY } from '@/lib/mock-data'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { generateTracks } from '@/lib/trails'
import { MapPageClient } from '@/components/map/MapPageClient'

// Demo mode renders mock data, so this is statically prerendered (deploys
// atomically + cleanly, like the homepage). When Supabase is wired, switch this
// to `force-dynamic` AND add a no-cache header so the edge doesn't serve stale.
export default async function MapPage() {
  const [rawAssets, geofences, toolAssociations] = await Promise.all([
    getAssetsWithLocations(MOCK_COMPANY.id),
    getGeofences(MOCK_COMPANY.id),
    getToolAssociations(MOCK_COMPANY.id),
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
    <div className="h-full pb-[70px] md:pb-0">
      <MapPageClient assets={assets} geofences={geofences} tracks={tracks} toolGateways={toolGateways} />
    </div>
  )
}
