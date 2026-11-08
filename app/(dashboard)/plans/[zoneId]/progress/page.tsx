import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive, listSurfaces, listTakeoffs } from '@/lib/db/dirt'
import { getProgress } from '@/lib/db/progress'
import { ProgressView } from '@/components/progress/ProgressView'

export const dynamic = 'force-dynamic'
// Measuring a flight reads the survey and the lidar and runs the takeoff on the server.
export const maxDuration = 90

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Progress · ${fence.name} — HammerTrack` : 'Progress — HammerTrack' }
}

/** A site's drone flights against its dirt takeoff (migration 150): what is left to cut and fill, flight by flight. */
export default async function Page({ params, searchParams }: { params: { zoneId: string }; searchParams: { takeoff?: string } }) {
  const perms = await requireFeature('plans')
  if (isProspect(perms)) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const addon = await dirtAddonActive(companyId)
  const [takeoffs, flights, progress] = addon && companyId
    ? await Promise.all([listTakeoffs(companyId, fence.id), listSurfaces(fence.id), getProgress(fence.id)])
    : [[], [], []]
  const withRuns = takeoffs.filter((t) => t.results)
  const takeoff = withRuns.find((t) => t.id === searchParams.takeoff) ?? withRuns[0] ?? null
  const ring = (fence.geometry?.coordinates?.[0] as [number, number][] | undefined) ?? null
  return (
    <ProgressView
      zone={{ id: fence.id, name: fence.name, ring }}
      addon={addon}
      takeoffs={withRuns.map((t) => ({ id: t.id, name: t.name, stale: t.stale }))}
      takeoffId={takeoff?.id ?? null}
      flights={flights}
      progress={takeoff ? progress.filter((p) => p.takeoffId === takeoff.id) : []}
      canEdit={perms.canEdit && !perms.viewingAs && !isMock && !fence.owner_id}
      demo={isMock}
    />
  )
}
