import type { ToolAssociation, AssetWithLocation } from '../types'
import { MOCK_TOOL_ASSOCIATIONS } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getToolAssociations(companyId: string): Promise<ToolAssociation[]> {
  if (isMock) return MOCK_TOOL_ASSOCIATIONS

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('tool_associations')
    .select('*')
    .eq('company_id', companyId)
  return data ?? []
}

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
