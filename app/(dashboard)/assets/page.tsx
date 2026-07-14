import { AssetList } from '@/components/assets/AssetList'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, toolsAboard } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'

export default async function AssetsPage() {
  const companyId = await getCurrentCompanyId()
  const [rawAssets, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getToolAssociations(companyId),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  // Chips both directions: trucks show "🔧 N aboard", tools show their ride.
  const aboard = toolsAboard(rawAssets, toolAssociations)
  const toolCounts = Object.fromEntries(Object.entries(aboard).map(([id, list]) => [id, list.length]))
  const carriers: Record<string, string> = {}
  for (const assoc of toolAssociations) {
    const gw = rawAssets.find(a => a.id === assoc.gateway_asset_id)
    if (gw) carriers[assoc.tool_asset_id] = gw.name
  }

  return (
    <div className="h-full overflow-hidden flex flex-col pb-[70px] md:pb-20">
      <AssetList assets={assets} toolCounts={toolCounts} carriers={carriers} />
    </div>
  )
}
