/**
 * Server half of the site page's Satellite card — streamed under its own
 * Suspense (like the Dirt takeoff card) so the add-on check never holds up
 * the page. Renders nothing before migration 131 has run.
 */
import { getZoneSatellite, satelliteAddonActive } from '@/lib/db/satellite'
import { isPlatformOwner } from '@/lib/platform-owner'
import { ACRE_M2, boxSize, cleanRing, ringAreaM2, siteAoiBox } from '@/lib/satellite/geo'
import { siteEstimate } from '@/lib/satellite/pricing'
import { siteFinished } from '@/lib/satellite/scenes'
import { ZoneSatellite } from './ZoneSatellite'

export async function ZoneSatelliteSection({ zoneId, companyId, ring, canEdit, canBill, personal, completedAt, activeUntil }: {
  zoneId: string
  companyId: string
  ring: [number, number][] | null
  canEdit: boolean
  /** The Billing permission — daily Planet pictures are billed per picture. */
  canBill: boolean
  personal: boolean
  completedAt: string | null
  activeUntil: string | null
}) {
  const [addon, state, founder] = await Promise.all([
    satelliteAddonActive(companyId),
    getZoneSatellite(zoneId),
    isPlatformOwner(),
  ])
  if (state === undefined) return null
  const clean = cleanRing(ring)
  // Daily Planet is only offered once the key is in Vercel (lib/satellite/planet.ts → planetReady).
  const planetReady = !!process.env.PL_API_KEY?.trim()
  return (
    <ZoneSatellite
      zoneId={zoneId}
      addon={addon}
      canEdit={canEdit}
      canBill={canBill}
      personal={personal}
      finished={siteFinished({ completed_at: completedAt, active_until: activeUntil }, Date.now())}
      state={state}
      planetReady={planetReady}
      estimate={founder && clean ? siteEstimate(boxSize(siteAoiBox(clean)).km2) : null}
      siteAcres={clean ? ringAreaM2(clean) / ACRE_M2 : null}
    />
  )
}
