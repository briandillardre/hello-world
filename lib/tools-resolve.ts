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
    if (asset.type !== 'tool' || asset.location) return asset
    const match = findGatewayForTool(asset.id, associations, assets)
    if (!match?.gateway.location) return asset
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