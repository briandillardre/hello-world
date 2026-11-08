import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getBorings } from '@/lib/db/borings'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive, listTakeoffs } from '@/lib/db/dirt'
import { GroundView } from '@/components/borings/GroundView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Ground · ${fence.name} — HammerTrack` : 'Ground — HammerTrack' }
}

/** A site's borings and test pits (migration 148), and what the dirt takeoff makes of them. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('plans')
  // Borings are bid data — never a prospect's.
  if (isProspect(perms)) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const [borings, addon] = await Promise.all([getBorings(fence.id, { photos: true }), dirtAddonActive(companyId)])
  const takeoffs = addon && companyId ? await listTakeoffs(companyId, fence.id) : []
  const t = takeoffs.find((x) => x.results?.ground) ?? null
  const ring = (fence.geometry?.coordinates?.[0] as [number, number][] | undefined) ?? null
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock && !fence.owner_id
  return (
    <GroundView
      zone={{ id: fence.id, name: fence.name, ring, personal: !!fence.owner_id }}
      borings={borings}
      takeoff={t ? { id: t.id, name: t.name, ground: t.results!.ground!, boundarySf: t.results!.boundarySf ?? 0, stale: t.stale, computedAt: t.computedAt } : null}
      dirtAddon={addon}
      canEdit={canEdit}
      canDelete={canEdit && rankOf(perms) >= RANK.manager}
      demo={isMock}
    />
  )
}
