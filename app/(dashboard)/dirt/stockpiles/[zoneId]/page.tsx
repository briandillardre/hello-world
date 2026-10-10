import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive, listStockpiles, listSurfaces } from '@/lib/db/dirt'
import { getGeofence } from '@/lib/db/zones'
import StockpileTool from '@/components/dirt/StockpileTool'

export const dynamic = 'force-dynamic'
// A measurement reads the survey window (or lidar) and integrates on the server.
export const maxDuration = 90

/**
 * Stockpile volumes for one site (migration 136) — inside the dirt takeoff
 * add-on: behind the site pages' view level, the add-on, never a prospect.
 */
export default async function StockpilesPage({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('zones')
  if (isProspect(perms)) notFound()
  const companyId = await getCurrentCompanyId()
  if (!(await dirtAddonActive(companyId))) notFound()
  const zone = await getGeofence(params.zoneId)
  if (!zone || zone.company_id !== companyId || zone.owner_id) notFound()
  const [piles, surfaces] = await Promise.all([listStockpiles(zone.id), listSurfaces(zone.id)])
  const ring = (zone.geometry?.coordinates?.[0] ?? null) as [number, number][] | null
  return (
    <StockpileTool
      zone={{ id: zone.id, name: zone.name, ring }}
      piles={piles}
      surfaces={surfaces}
      canEdit={perms.canEdit && !perms.viewingAs}
    />
  )
}
