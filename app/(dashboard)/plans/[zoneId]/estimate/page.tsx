import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCostBook, getEstimate } from '@/lib/db/estimate'
import { getSnapshots } from '@/lib/db/takeoff'
import { EstimateView } from '@/components/estimate/EstimateView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Estimate · ${fence.name} — HammerTrack` : 'Estimate — HammerTrack' }
}

/** A site's estimate (migration 147): the takeoff priced from the cost book, haul by road, crews, markups. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('plans')
  if (!perms.canViewCosts) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const admin = rankOf(perms) >= RANK.admin
  const [book, est, snapshots] = await Promise.all([getCostBook(admin), getEstimate(fence.id, admin), getSnapshots(fence.id)])
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <EstimateView
      zone={{ id: fence.id, name: fence.name }}
      book={book}
      estimate={est.estimate}
      markups={est.markups}
      distances={est.distances}
      snapshots={snapshots.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt }))}
      canEdit={canEdit}
      canManage={canEdit && rankOf(perms) >= RANK.manager}
      canMargins={canEdit && admin}
      showMargins={admin}
      demo={isMock}
    />
  )
}
