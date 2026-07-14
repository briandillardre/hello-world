import type { ToolAssociation, AssetWithLocation } from './types'

/**
 * Given the full asset list and the current tool→gateway associations, returns
 * the gateway (truck/equipment) a given tool is currently detected by, if any.
 */
export function findGatewayForTool(
  toolId: string,
  associations: ToolAssociation[],
  assets: AssetWithLocation[]
): { gateway: AssetWithLocation; assoc: ToolAssociation } | null {
  const assoc = associations.find(a => a.tool_asset_id === toolId)
  if (!assoc) return null
  const gateway = assets.find(a => a.id === assoc.gateway_asset_id)
  if (!gateway) return null
  return { gateway, assoc }
}

/**
 * Tools usually have no GPS of their own — they inherit the location of the
 * gateway (truck/equipment) that currently detects them over Bluetooth.
 */
export function resolveToolLocations(
  assets: AssetWithLocation[],
  associations: ToolAssociation[]
): AssetWithLocation[] {
  return assets.map(asset => {
    if (asset.type !== 'tool') return asset
    const match = findGatewayForTool(asset.id, associations, assets)
    if (!match?.gateway.location) return asset
    // A tool can carry a location row of its own (seeded demo fixes; possibly
    // GPS tags someday). Whichever signal is FRESHER wins — a live Bluetooth
    // sighting must beat a stale stored fix, or a repurposed demo asset stays
    // pinned to the old demo site forever (Tool A/B rendered at Nashville
    // while physically riding the Chevy in SC, Jul 14).
    const ownMs = asset.location ? new Date(asset.location.timestamp).getTime() : -Infinity
    const seenMs = new Date(match.assoc.last_seen).getTime()
    if (Number.isFinite(ownMs) && ownMs >= seenMs) return asset
    return {
      ...asset,
      location: {
        ...match.gateway.location,
        id: `inherited-${asset.id}`,
        asset_id: asset.id,
        timestamp: match.assoc.last_seen,
      },
    }
  })
}