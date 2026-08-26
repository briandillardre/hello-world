import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { GeofencesManager } from '@/components/zones/GeofencesManager'
import { getGeofences } from '@/lib/db/zones'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'
import { pointInPolygon } from '@/lib/alerts-engine'

export const metadata = { title: 'HammerTrack — Zones' }

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export default async function GeofencesPage() {
  const companyId = await getCurrentCompanyId()
  const [geofences, rawAssets, toolAssociations] = await Promise.all([
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
    getToolAssociations(companyId),
  ])
  // Tools inherit their carrier's position — without this, every BLE-tagged
  // machine counted nowhere and this list said "0 assets inside" for a site
  // /command showed 4 at (logged-in review, Aug 26).
  const assets = resolveToolLocations(rawAssets, toolAssociations)

  const counts: Record<string, number> = {}
  for (const g of geofences) {
    const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
    counts[g.id] = !ring ? 0 : assets.filter(
      (a) => a.location && pointInPolygon([a.location.lng, a.location.lat], ring)
    ).length
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Zones</h1>
        <span className="text-sm text-faint">{geofences.length} zones</span>
        <Link href="/map?draw=1" className="ml-auto">
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Draw Zone
          </Button>
        </Link>
      </div>

      <GeofencesManager geofences={geofences} counts={counts} editable={!isMock} />
    </div>
  )
}
