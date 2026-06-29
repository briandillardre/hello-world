import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Hexagon, MapPin, CornerDownRight } from 'lucide-react'
import { getGeofence, getGeofences } from '@/lib/db/geofences'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { pointInPolygon } from '@/lib/alerts-engine'
import type { AssetType } from '@/lib/types'

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }

export default async function GeofenceDetailPage({ params }: { params: { id: string } }) {
  const companyId = await getCurrentCompanyId()
  const [fence, allFences, assets] = await Promise.all([
    getGeofence(params.id),
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
  ])
  if (!fence) notFound()

  const ring = fence.geometry?.coordinates?.[0] as [number, number][] | undefined
  const inside = !ring ? [] : assets.filter((a) => a.location && pointInPolygon([a.location.lng, a.location.lat], ring))
  const parent = fence.parent_id ? allFences.find((g) => g.id === fence.parent_id) : null
  const subZones = allFences.filter((g) => g.parent_id === fence.id)

  return (
    <div className="h-full overflow-auto pb-28 md:pb-10">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <Link href="/geofences" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3">
          <ArrowLeft className="h-4 w-4" /> All zones
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl grid place-items-center flex-none" style={{ backgroundColor: fence.color + '22', border: `2px solid ${fence.color}` }}>
            <Hexagon className="h-6 w-6" style={{ color: fence.color }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{fence.name}</h1>
            {parent && (
              <Link href={`/geofences/${parent.id}`} className="text-xs text-faint hover:text-amber">
                Sub-zone of {parent.name}
              </Link>
            )}
          </div>
          <Link href="/map" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm px-3.5 py-2 hover:bg-amber-600 transition-colors">
            <MapPin className="h-4 w-4" /> View on map
          </Link>
        </div>
      </div>

      <div className="p-4 max-w-3xl space-y-6">
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Assets inside ({inside.length})</h2>
          {inside.length === 0 ? (
            <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">No assets currently inside this zone.</p>
          ) : (
            <div className="space-y-2">
              {inside.map((a) => (
                <Link key={a.id} href={`/assets/${a.id}`} className="flex items-center gap-3 rounded-xl border border-navy-800 bg-navy-900 p-3 hover:bg-navy-800 transition-colors">
                  <span className="text-2xl">{TYPE_EMOJI[a.type]}</span>
                  <span className="flex-1 font-medium text-ink truncate">{a.name}</span>
                  {a.tracker_id && <span className="font-mono text-xs text-faint">{a.tracker_id}</span>}
                </Link>
              ))}
            </div>
          )}
        </section>

        {subZones.length > 0 && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Sub-zones ({subZones.length})</h2>
            <div className="space-y-2">
              {subZones.map((s) => (
                <Link key={s.id} href={`/geofences/${s.id}`} className="flex items-center gap-2 rounded-xl border border-navy-800 bg-navy-900 p-3 hover:bg-navy-800 transition-colors">
                  <CornerDownRight className="h-4 w-4 text-faint" />
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span className="flex-1 font-medium text-ink truncate">{s.name}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
