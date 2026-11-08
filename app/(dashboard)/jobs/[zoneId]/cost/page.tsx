import { notFound, redirect } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getJob } from '@/lib/db/jobs'
import { getBilling } from '@/lib/db/payapps'
import { getJobCost } from '@/lib/db/jobcost'
import { rollup, wip } from '@/lib/jobs/cost'
import { counts } from '@/lib/jobs/payapp'
import { CostView } from '@/components/jobs/CostView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Job cost · ${fence.name} — HammerTrack` : 'Job cost — HammerTrack' }
}

/** Budget vs actual by cost type, where the actuals came from, and WIP (migration 155). Costs only. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('jobs')
  if (isProspect(perms) || !perms.canViewCosts) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.owner_id || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const page = await getJob(companyId, fence.id, true)
  if (!page.job && !isMock) redirect(`/jobs/${fence.id}`)
  const job = page.job
  const from = job ? (job.startDate ?? job.awardDate ?? job.createdAt.slice(0, 10)) : null
  const contract = page.money?.contractAmount ?? null
  const [data, billing] = job
    ? await Promise.all([getJobCost(companyId, { id: job.id, zoneId: fence.id, from }), getBilling(job.id, contract)])
    : [await getJobCost(companyId, { id: '', zoneId: fence.id, from: null }), { available: isMock, sov: [], cos: [], apps: [] }]
  const roll = rollup(data.budget, data.coImpacts, data.actuals)
  const last = [...billing.apps].reverse().find((a) => counts(a.status)) ?? null
  const approvedCos = billing.cos.filter((c) => c.status === 'approved').reduce((s, c) => s + (c.approved ?? 0), 0)
  const contractToDate = last?.totals.contractToDate ?? ((contract ?? 0) + approvedCos)
  const w = wip({
    contract: contractToDate, currentBudget: roll.total.current, costToDate: roll.total.actual,
    billed: last?.totals.completedStored ?? 0, retainageHeld: last?.totals.retTotal ?? 0, estimateAtCompletion: data.eac,
  })
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <CostView
      zone={{ id: fence.id, name: fence.name }} data={data} roll={roll} wip={w}
      canEdit={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} demo={isMock}
    />
  )
}
