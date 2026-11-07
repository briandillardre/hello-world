import { notFound } from 'next/navigation'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { getGeofence } from '@/lib/db/zones'
import { getPlanRoom } from '@/lib/db/plans'
import { PlanRoom } from '@/components/plans/PlanRoom'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Plans · ${fence.name} — HammerTrack` : 'Plans — HammerTrack' }
}

/** One site's plan room (migration 143). */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('plans')
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const real = await getRealPermissions()
  const data = await getPlanRoom(fence.id, real.userId)
  const ring = (fence.geometry?.coordinates?.[0] as [number, number][] | undefined) ?? null
  return (
    <PlanRoom zone={{ id: fence.id, name: fence.name }} data={data}
      canEdit={perms.canEdit && !perms.viewingAs && !isMock} ring={ring} demo={isMock} />
  )
}
