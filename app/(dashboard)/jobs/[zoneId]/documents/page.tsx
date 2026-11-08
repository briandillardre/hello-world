import { notFound, redirect } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getJob } from '@/lib/db/jobs'
import { getAppChoices, getDocuments } from '@/lib/db/jobwork'
import { DocumentsView } from '@/components/jobs/DocumentsView'
import { costsOnly } from '@/lib/jobs/documents'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Documents · ${fence.name} — HammerTrack` : 'Documents — HammerTrack' }
}

/** The job's documents by type (migration 156); the money papers only with costs. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('jobs')
  if (isProspect(perms)) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.owner_id || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const companyId = await getCurrentCompanyId()
  const page = await getJob(companyId, fence.id, false)
  if (!page.job && !isMock) redirect(`/jobs/${fence.id}`)
  const [list, apps] = page.job
    ? await Promise.all([getDocuments(page.job.id), perms.canViewCosts ? getAppChoices(page.job.id) : Promise.resolve([])])
    : [{ available: isMock, docs: [] }, []]
  // RLS reads with the real login; a view-as preview without costs must not see the money papers either.
  const docs = perms.canViewCosts ? list.docs : list.docs.filter((d) => !costsOnly(d.kind))
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <DocumentsView
      zone={{ id: fence.id, name: fence.name }} docs={docs} available={list.available} apps={apps} members={page.members}
      today={new Date().toISOString().slice(0, 10)}
      canEdit={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} canCosts={perms.canViewCosts} demo={isMock}
    />
  )
}
