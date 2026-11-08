import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { listJobs, sitesWithoutJob, getTemplate } from '@/lib/db/jobs'
import { JobsLog } from '@/components/jobs/JobsLog'

export const metadata = { title: 'Jobs — HammerTrack' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The project log (migration 152): every job from the first bid to the final
 * lien waiver, by stage — DCG's PM Master "Projects" tab and the Invoice
 * Tracking project log in one list.
 */
export default async function Page() {
  const perms = await requireFeature('jobs')
  if (isProspect(perms)) notFound()
  const companyId = await getCurrentCompanyId()
  const [log, template] = await Promise.all([listJobs(perms.canViewCosts), getTemplate(companyId)])
  const sites = await sitesWithoutJob(new Set(log.rows.map((r) => r.job.zoneId)))
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <JobsLog
      rows={log.rows} members={log.members} available={log.available} sites={sites}
      template={template.items} templateCustom={template.custom}
      canEdit={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} canCosts={perms.canViewCosts} demo={isMock}
    />
  )
}
