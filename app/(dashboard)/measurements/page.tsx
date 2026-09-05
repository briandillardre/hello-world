import type { Metadata } from 'next'
import { requireFeature } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMeasurements } from '@/lib/db/measurements'
import { MeasurementsManager } from '@/components/measure/MeasurementsManager'

export const metadata: Metadata = { title: 'HammerTrack — Measurements' }

/** Home for everything saved from the map's measure & takeoff tool — points
 *  (coordinates + elevation), lines (lengths), and areas (SF/acres + tonnage).
 *  Each row jumps back onto the map exactly where it was drawn. */
export default async function MeasurementsPage() {
  await requireFeature('measurements')
  const companyId = await getCurrentCompanyId()
  const measurements = await getMeasurements(companyId)
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <h1 className="font-display font-black text-xl text-ink">Measurements</h1>
        <p className="text-[12.5px] text-faint mt-0.5">Points, lengths, areas &amp; takeoffs saved from the map&rsquo;s measure tool.</p>
      </div>
      <MeasurementsManager measurements={measurements} />
    </div>
  )
}
