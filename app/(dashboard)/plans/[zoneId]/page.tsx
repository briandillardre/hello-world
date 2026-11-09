import { notFound } from 'next/navigation'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getPlanRoom } from '@/lib/db/plans'
import { PlanRoom } from '@/components/plans/PlanRoom'
import { getTakeoffItems } from '@/lib/db/takeoff'

export const dynamic = 'force-dynamic'
// Filing a set lines its sheets up on the server (lib/plans/autoplace-server.ts).
export const maxDuration = 60

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
  const [data, items] = await Promise.all([getPlanRoom(fence.id, real.userId), getTakeoffItems(perms.canViewCosts)])
  const ring = (fence.geometry?.coordinates?.[0] as [number, number][] | undefined) ?? null
  return (
    <PlanRoom zone={{ id: fence.id, name: fence.name }} data={data}
      canEdit={perms.canEdit && !perms.viewingAs && !isMock} ring={ring} demo={isMock} items={items} canCosts={perms.canViewCosts}
      canGround={!isProspect(perms)}
      canJobs={!isProspect(perms) && perms.features.includes('jobs') && !fence.owner_id}
      canDelete={perms.canEdit && !perms.viewingAs && !isMock && rankOf(perms) >= RANK.manager} />
  )
}
