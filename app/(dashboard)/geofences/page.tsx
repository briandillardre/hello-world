import { Hexagon, Plus } from 'lucide-react'
import { MOCK_GEOFENCES, MOCK_ASSETS } from '@/lib/mock-data'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

function assetCountInFence(fenceId: string): number {
  return MOCK_ASSETS.filter(a => {
    if (!a.location) return false
    const fence = MOCK_GEOFENCES.find(f => f.id === fenceId)
    if (!fence) return false
    return pointInPolygon([a.location.lng, a.location.lat], fence.geometry.coordinates[0] as [number, number][])
  }).length
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false
  const [x, y] = point
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export default function GeofencesPage() {
  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10 flex items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900">Geofences</h1>
        <span className="text-sm text-slate-400">{MOCK_GEOFENCES.length} zones</span>
        <Link href="/map" className="ml-auto">
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Draw Zone
          </Button>
        </Link>
      </div>

      <div className="p-4 space-y-3">
        {MOCK_GEOFENCES.map(fence => {
          const count = assetCountInFence(fence.id)
          return (
            <div key={fence.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 shadow-sm">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: fence.color + '22', border: `2px solid ${fence.color}` }}
              >
                <Hexagon className="h-6 w-6" style={{ color: fence.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900">{fence.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {count} asset{count !== 1 ? 's' : ''} currently inside
                </p>
              </div>
              <div
                className="w-4 h-4 rounded-sm flex-shrink-0"
                style={{ backgroundColor: fence.color }}
              />
            </div>
          )
        })}

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">📍 Draw geofences on the map</p>
          <p className="text-xs">Go to the Map view and tap the hexagon button to draw a new zone. Click points to form a polygon, then tap ✓ to save.</p>
        </div>
      </div>
    </div>
  )
}
