import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { GeofencesManager } from '@/components/geofences/GeofencesManager'
import { getGeofences } from '@/lib/db/geofences'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { pointInPolygon } from '@/lib/alerts-engine'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export default async function GeofencesPage() {
  const companyId = await getCurrentCompanyId()
  const [geofences, assets] = await Promise.all([
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
  ])

  const counts: Record<string, number> = {}
  for (const g of geofences) {
    const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
    counts[g.id] = !ring ? 0 : assets.filter(
      (a) => a.location && pointInPolygon([a.location.lng, a.location.lat], ring)
    ).length
  }

  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Zones</h1>
        <span className="text-sm text-faint">{geofences.length} zones</span>
        <Link href="/map" className="ml-auto">
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Draw Zone
          </Button>
        </Link>
      </div>

      <GeofencesManager geofences={geofences} counts={counts} editable={!isMock} />
    </div>
  )
}
