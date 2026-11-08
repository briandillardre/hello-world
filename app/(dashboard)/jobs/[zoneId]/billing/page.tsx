import { notFound, redirect } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompany, getCurrentCompanyId } from '@/lib/db/company'
import { getJob } from '@/lib/db/jobs'
import { getBilling } from '@/lib/db/payapps'
import { BillingView } from '@/components/jobs/BillingView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Pay apps · ${fence.name} — HammerTrack` : 'Pay apps — HammerTrack' }
}

/** A job's schedule of values, change orders and applications for payment (migration 154). Dollars — costs only. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('jobs')
  if (isProspect(perms) || !perms.canViewCosts) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.owner_id || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const [page, company] = await Promise.all([getJob(companyId, fence.id, true), getCurrentCompany()])
  if (!page.job && !isMock) redirect(`/jobs/${fence.id}`)
  const job = page.job
  const contract = page.money?.contractAmount ?? null
  const billing = job ? await getBilling(job.id, contract) : { available: isMock, sov: [], cos: [], apps: [] }
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <BillingView
      zone={{ id: fence.id, name: fence.name }}
      info={{
        companyName: company.name, jobName: fence.name, jobNumber: job?.number ?? null, customer: job?.customer ?? null,
        customerJobNo: job?.customerJobNo ?? null, ownerName: job?.ownerName ?? null, contractNo: job?.contractNo ?? null,
        contractDate: job?.contractDate ?? null, scope: job?.scope ?? null,
        address: job ? [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ') || null : null,
      }}
      contract={contract}
      billing={billing}
      canEdit={canEdit}
      canManage={canEdit && rankOf(perms) >= RANK.manager}
      demo={isMock}
    />
  )
}
