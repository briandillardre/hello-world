import { AssetList } from '@/components/assets/AssetList'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'

export default async function AssetsPage() {
  const companyId = await getCurrentCompanyId()
  const [rawAssets, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getToolAssociations(companyId),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  return (
    <div className="h-full overflow-hidden flex flex-col pb-[70px] md:pb-0">
      <AssetList assets={assets} />
    </div>
  )
}
