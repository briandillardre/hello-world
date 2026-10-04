/**
 * Server half of the site page's Dirt takeoff card — streamed under its own
 * Suspense so the add-on check and the list never hold up the page.
 */
import { dirtAddonActive, listTakeoffs } from '@/lib/db/dirt'
import { ZoneDirtCard } from './ZoneDirtCard'

export async function ZoneDirtSection({ zoneId, companyId, canEdit }: { zoneId: string; companyId: string; canEdit: boolean }) {
  const addon = await dirtAddonActive(companyId)
  const takeoffs = addon ? await listTakeoffs(companyId, zoneId) : []
  return <ZoneDirtCard zoneId={zoneId} takeoffs={takeoffs} addon={addon} canEdit={canEdit} />
}
