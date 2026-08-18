import { AssetList } from '@/components/assets/AssetList'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, toolsAboard } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'

export const metadata = { title: 'HammerTrack — Assets' }

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
  // Carry lastSeen so the list can tell "riding right now" from "left behind
  // hours ago" — a stale pairing must never claim the tool is WITH the truck
  // (Brian, Aug 4: tools left at the jobsite showed "with 2003 Chevy").
  const carriers: Record<string, { name: string; lastSeen: string }> = {}
  for (const assoc of toolAssociations) {
    const gw = rawAssets.find(a => a.id === assoc.gateway_asset_id)
    if (gw) carriers[assoc.tool_asset_id] = { name: gw.name, lastSeen: assoc.last_seen }
  }

  return (
    <div className="h-full overflow-hidden flex flex-col pb-[54px] md:pb-20">
      <AssetList assets={assets} toolCounts={toolCounts} carriers={carriers} />
    </div>
  )
}
