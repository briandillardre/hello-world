import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getSiteTakeoff, getZoneOrthos, siteTakeoffAddonActive } from '@/lib/db/site-takeoff'
import { getGeofence } from '@/lib/db/zones'
import SiteTakeoffEditor from '@/components/site-takeoff/SiteTakeoffEditor'

export const dynamic = 'force-dynamic'

/**
 * The site takeoff editor (migration 137). Behind the site pages' view
 * level, the company's site_takeoff add-on, and never for a prospect.
 */
export default async function SiteTakeoffPage({ params }: { params: { id: string } }) {
  const perms = await requireFeature('zones')
  if (isProspect(perms)) notFound()
  const companyId = await getCurrentCompanyId()
  if (!(await siteTakeoffAddonActive(companyId))) notFound()
  const takeoff = await getSiteTakeoff(params.id)
  if (!takeoff) notFound()
  const [zone, orthos] = await Promise.all([
    takeoff.zoneId ? getGeofence(takeoff.zoneId) : Promise.resolve(null),
    takeoff.zoneId ? getZoneOrthos(takeoff.zoneId) : Promise.resolve([]),
  ])
  const raw = (zone?.geometry?.coordinates?.[0] ?? null) as [number, number][] | null
  return (
    <SiteTakeoffEditor
      takeoff={takeoff}
      zone={{ id: zone?.id ?? '', name: zone?.name ?? 'Site', ring: raw ? raw.slice(0, -1) : null }}
      orthos={orthos}
      canEdit={perms.canEdit && !perms.viewingAs}
    />
  )
}
