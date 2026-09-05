import { getMyClockState, getLogFormRaw } from '@/lib/db/fieldops'
import { requireFeature } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/zones'
import { ClockCard } from '@/components/field/ClockCard'
import { resolveLogForm } from '@/lib/log-form'

export const metadata = { title: 'HammerTrack — Time clock' }

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The crew page: clock in to a project, see the plan, clock out through the
 * daily log. Deliberately sparse — this is a gloves-on phone screen.
 */
export default async function ClockPage() {
  await requireFeature('clock')
  const [{ openEntry, available, personName }, companyId] = await Promise.all([
    getMyClockState(),
    getCurrentCompanyId(),
  ])
  const [geofences, logFormRaw] = await Promise.all([getGeofences(companyId), getLogFormRaw(companyId)])
  // Job sites only — boundary outlines aren't chargeable places.
  const zones = geofences
    .filter((g) => g.kind !== 'boundary')
    .map((g) => {
      // Ring centroid (cheap average) — lets the clock card preselect the
      // nearest job site from the phone's GPS fix.
      const ring = (g.geometry?.coordinates?.[0] ?? []) as [number, number][]
      const center = ring.length
        ? ([ring.reduce((s2, c) => s2 + c[0], 0) / ring.length, ring.reduce((s2, c) => s2 + c[1], 0) / ring.length] as [number, number])
        : null
      return { id: g.id, name: g.name, center }
    })

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20"><div className="max-w-md mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl text-ink">Time clock</h1>
        <p className="text-[12.5px] text-faint">Clock in to where the day&apos;s going. The daily log is the way out.</p>
      </div>
      <ClockCard openEntry={openEntry} zones={zones} available={available} personName={personName} demo={isMock}
        form={resolveLogForm(logFormRaw).filter((it) => it.enabled)} />
    </div></div>
  )
}
