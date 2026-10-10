/**
 * Server half of the site page's Site takeoff card — streamed under its own
 * Suspense so the add-on check and the list never hold up the page.
 */
import { listSiteTakeoffs, getZoneOrthos, siteTakeoffAddonActive } from '@/lib/db/site-takeoff'
import { ZoneSiteTakeoffCard } from './ZoneSiteTakeoffCard'

export async function ZoneSiteTakeoffSection({ zoneId, companyId, canEdit }: { zoneId: string; companyId: string; canEdit: boolean }) {
  const addon = await siteTakeoffAddonActive(companyId)
  const [takeoffs, orthos] = addon ? await Promise.all([listSiteTakeoffs(companyId, zoneId), getZoneOrthos(zoneId)]) : [[], []]
  return <ZoneSiteTakeoffCard zoneId={zoneId} takeoffs={takeoffs} orthoCount={orthos.length} newestOrtho={orthos[0]?.id ?? null} addon={addon} canEdit={canEdit} />
}
