import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getJob } from '@/lib/db/jobs'
import { getJobExtras } from '@/lib/db/jobwork'
import { JobView } from '@/components/jobs/JobView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `${fence.name} — Job — HammerTrack` : 'Job — HammerTrack' }
}

/** One job (migration 152): where it stands, what is left to do, the contract, who's who. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('jobs')
  if (isProspect(perms)) notFound()
  // The site through the caller's own RLS; a job only ever sits on a company site.
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.owner_id || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const page = await getJob(companyId, fence.id, perms.canViewCosts)
  const today = new Date().toISOString().slice(0, 10)
  // Issues, papers running out and — once the job is closing — what closeout still waits on.
  const extras = page.job
    ? await getJobExtras(companyId, { id: page.job.id, zoneId: fence.id }, { closing: ['substantial', 'closeout', 'closed'].includes(page.job.stage), money: perms.canViewCosts, today })
    : null
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <JobView
      zone={{ id: fence.id, name: fence.name, kind: fence.kind ?? null }}
      page={page}
      extras={extras}
      today={today}
      canEdit={canEdit}
      canManage={canEdit && rankOf(perms) >= RANK.manager}
      canCosts={perms.canViewCosts}
      canPlans={perms.features.includes('plans')}
      demo={isMock}
    />
  )
}
