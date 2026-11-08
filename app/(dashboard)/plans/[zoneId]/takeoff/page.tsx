import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getSnapshots, getBidMemo, getTakeoffLinks } from '@/lib/db/takeoff'
import type { TakeoffSummary } from '@/lib/takeoff-summary'
import { TakeoffView } from '@/components/plans/TakeoffView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Takeoff · ${fence.name} — HammerTrack` : 'Takeoff — HammerTrack' }
}

/** A site's takeoff (migration 146): the bid's quantity page. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('plans')
  // The site through the caller's own RLS (a personal zone of someone else 404s).
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  let summary: TakeoffSummary | null = null
  let links: Awaited<ReturnType<typeof getTakeoffLinks>> = []
  if (!isMock) {
    const companyId = await getCurrentCompanyId()
    const [{ createServiceClient }, { buildTakeoff }] = await Promise.all([import('@/lib/supabase-server'), import('@/lib/takeoff-summary')])
    ;[summary, links] = await Promise.all([
      buildTakeoff(createServiceClient(), companyId, fence.id, perms.canViewCosts),
      canEdit ? getTakeoffLinks(companyId, fence.id) : Promise.resolve([]),
    ])
  }
  const [snapshots, memo] = await Promise.all([getSnapshots(fence.id), isProspect(perms) ? Promise.resolve(null) : getBidMemo(fence.id)])
  return (
    <TakeoffView
      zone={{ id: fence.id, name: fence.name }}
      summary={summary}
      snapshots={snapshots}
      memo={memo}
      links={links}
      canEdit={canEdit}
      canManage={canEdit && rankOf(perms) >= RANK.manager}
      canCosts={perms.canViewCosts}
      showMemo={!isProspect(perms)}
      demo={isMock}
    />
  )
}
