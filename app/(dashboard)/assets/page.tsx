import { AssetList } from '@/components/assets/AssetList'
import { MOCK_ASSETS } from '@/lib/mock-data'

export default function AssetsPage() {
  return (
    <div className="h-full overflow-hidden flex flex-col pb-[70px] md:pb-0">
      <AssetList assets={MOCK_ASSETS} />
    </div>
  )
}
