import dynamic from 'next/dynamic'
import { MOCK_ASSETS, MOCK_GEOFENCES, MOCK_TOOL_ASSOCIATIONS } from '@/lib/mock-data'
import { resolveToolLocations } from '@/lib/db/tools'
import { generateTracks } from '@/lib/trails'

const MapView = dynamic(
  () => import('@/components/map/MapView').then(m => ({ default: m.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 h-full bg-navy-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-teal border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-faint font-mono">Loading map…</p>
        </div>
      </div>
    ),
  }
)

export default function MapPage() {
  // Tools have no GPS of their own — resolve their position from the gateway
  // (truck/equipment) that currently detects them over Bluetooth.
  const assets = resolveToolLocations(MOCK_ASSETS, MOCK_TOOL_ASSOCIATIONS)

  // Time-series tracks for the Equipment Trails + Timeline Playback view.
  const tracks = generateTracks(assets)

  // Map each tool to the gateway holding it, for the asset detail panel.
  const toolGateways: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of MOCK_TOOL_ASSOCIATIONS) {
    const gateway = MOCK_ASSETS.find(a => a.id === assoc.gateway_asset_id)
    if (gateway) toolGateways[assoc.tool_asset_id] = { name: gateway.name, lastSeen: assoc.last_seen }
  }

  return (
    <div className="h-full pb-[70px] md:pb-0">
      <MapView assets={assets} geofences={MOCK_GEOFENCES} tracks={tracks} toolGateways={toolGateways} />
    </div>
  )
}
