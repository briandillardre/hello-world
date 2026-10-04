import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive, getPlanSheets, getTakeoff } from '@/lib/db/dirt'
import { getGeofence } from '@/lib/db/zones'
import TakeoffEditor from '@/components/dirt/TakeoffEditor'

export const dynamic = 'force-dynamic'
// Save re-runs the takeoff on the server (and may read the lidar fresh).
export const maxDuration = 90

/**
 * The dirt takeoff editor (migration 127). Behind the site pages' view level,
 * the company's dirt add-on, and never for a prospect.
 */
export default async function DirtTakeoffPage({ params }: { params: { id: string } }) {
  const perms = await requireFeature('zones')
  if (isProspect(perms)) notFound()
  const companyId = await getCurrentCompanyId()
  if (!(await dirtAddonActive(companyId))) notFound()
  const takeoff = await getTakeoff(params.id)
  if (!takeoff) notFound()
  const [zone, sheets] = await Promise.all([
    takeoff.geofenceId ? getGeofence(takeoff.geofenceId) : Promise.resolve(null),
    takeoff.geofenceId ? getPlanSheets(takeoff.geofenceId) : Promise.resolve([]),
  ])
  const ring = (zone?.geometry?.coordinates?.[0] ?? null) as [number, number][] | null
  return (
    <TakeoffEditor
      takeoff={takeoff}
      zone={{ id: zone?.id ?? '', name: zone?.name ?? 'Site', ring }}
      sheets={sheets}
      canEdit={perms.canEdit && !perms.viewingAs}
    />
  )
}
