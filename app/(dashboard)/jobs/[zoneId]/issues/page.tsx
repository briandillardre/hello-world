import { notFound, redirect } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getJob } from '@/lib/db/jobs'
import { getCoNumbers, getIssues } from '@/lib/db/jobwork'
import { IssuesView } from '@/components/jobs/IssuesView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Issues · ${fence.name} — HammerTrack` : 'Issues — HammerTrack' }
}

/** Issues & actions (migration 156): what came up on the job, who owns it, who decides, by when, what it could cost. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('jobs')
  if (isProspect(perms)) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.owner_id || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const page = await getJob(companyId, fence.id, false)
  if (!page.job && !isMock) redirect(`/jobs/${fence.id}`)
  const [list, coNumbers] = page.job
    ? await Promise.all([getIssues(page.job.id, perms.canViewCosts), perms.canViewCosts ? getCoNumbers(page.job.id) : Promise.resolve({})])
    : [{ available: isMock, issues: [] }, {}]
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <IssuesView
      zone={{ id: fence.id, name: fence.name }} issues={list.issues} available={list.available} members={page.members} coNumbers={coNumbers}
      today={new Date().toISOString().slice(0, 10)}
      canEdit={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} canCosts={perms.canViewCosts} demo={isMock}
    />
  )
}
