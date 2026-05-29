import dynamic from 'next/dynamic'
import { MOCK_ASSETS, MOCK_GEOFENCES } from '@/lib/mock-data'

const MapView = dynamic(
  () => import('@/components/map/MapView').then(m => ({ default: m.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 h-full bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading map…</p>
        </div>
      </div>
    ),
  }
)

export default function MapPage() {
  return (
    <div className="h-full pb-[70px] md:pb-0">
      <MapView
        assets={MOCK_ASSETS}
        geofences={MOCK_GEOFENCES}
      />
    </div>
  )
}
