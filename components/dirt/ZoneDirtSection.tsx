/**
 * Server half of the site page's Dirt takeoff card — streamed under its own
 * Suspense so the add-on check and the list never hold up the page.
 */
import { dirtAddonActive, listStockpiles, listTakeoffs } from '@/lib/db/dirt'
import { ZoneDirtCard } from './ZoneDirtCard'

export async function ZoneDirtSection({ zoneId, companyId, canEdit }: { zoneId: string; companyId: string; canEdit: boolean }) {
  const addon = await dirtAddonActive(companyId)
  const [takeoffs, piles] = addon ? await Promise.all([listTakeoffs(companyId, zoneId), listStockpiles(zoneId, 60)]) : [[], []]
  return <ZoneDirtCard zoneId={zoneId} takeoffs={takeoffs} piles={piles} addon={addon} canEdit={canEdit} />
}
