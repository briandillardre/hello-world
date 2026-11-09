import { notFound, redirect } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getJob } from '@/lib/db/jobs'
import { getProduction } from '@/lib/db/production'
import { productionRollup } from '@/lib/jobs/production'
import { ProductionView } from '@/components/jobs/ProductionView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Production · ${fence.name} — HammerTrack` : 'Production — HammerTrack' }
}

/** What got built against what was bid (migration 160). Quantities for the foreman; dollars only with costs. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('jobs')
  if (isProspect(perms)) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.owner_id || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const page = await getJob(companyId, fence.id, false)
  if (!page.job && !isMock) redirect(`/jobs/${fence.id}`)
  const job = page.job
  const from = job ? (job.startDate ?? job.awardDate ?? job.createdAt.slice(0, 10)) : null
  const data = await getProduction(companyId, { id: job?.id ?? '', zoneId: fence.id, from }, perms.canViewCosts)
  const roll = productionRollup(data.items, data.entries, data.days)
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <ProductionView
      zone={{ id: fence.id, name: fence.name }} data={data} roll={roll}
      canLog={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} canCosts={perms.canViewCosts} demo={isMock}
    />
  )
}
