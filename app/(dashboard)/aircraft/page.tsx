import { requireFeature, getMyPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getSavedAircraft } from '@/lib/db/aircraft'
import { ARCHIVE_DAYS } from '@/lib/aircraft-source'
import { FlightLog } from '@/components/aircraft/FlightLog'

export const metadata = { title: 'HammerTrack — Flight log' }
export const dynamic = 'force-dynamic'

/**
 * Flight log (Brian, Sep 12: "search tail numbers, see all prior flights,
 * save planes etc").
 *
 * Search reads the ADS-B archive's rolling ~30-day window live, so any tail
 * answers straight away with nothing set up. Saving a plane is what makes it
 * keep going: the nightly cron banks that airframe's flights into our own
 * tables, past the point the free archive forgets them.
 */
export default async function AircraftPage() {
  await requireFeature('aircraft')
  const [companyId, perms] = await Promise.all([getCurrentCompanyId(), getMyPermissions()])
  const saved = await getSavedAircraft(companyId)
  return (
    <div className="h-full overflow-auto pb-36 md:pb-24">
      <div className="sticky top-0 z-10 border-b border-navy-800 bg-navy-950/95 p-4 backdrop-blur">
        <h1 className="text-xl font-bold text-ink">Flight log</h1>
        <p className="mt-0.5 text-[11.5px] text-faint">
          Look up any aircraft by tail number and read where it has been.
        </p>
      </div>
      <FlightLog saved={saved} canEdit={perms.canEdit} archiveDays={ARCHIVE_DAYS} />
    </div>
  )
}
