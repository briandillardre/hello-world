import { TrackersPage } from '@/components/trackers/TrackersPage'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions, requireFeature } from '@/lib/permissions-server'
import { getTrackersOverview, getTrackerlessAssets } from '@/lib/db/trackers'

export const metadata = { title: 'HammerTrack — Trackers' }

// Last-seen and the undo window are live facts; never serve this from cache.
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requireFeature('trackers')
  const [companyId, perms] = await Promise.all([getCurrentCompanyId(), getMyPermissions()])
  const data = await getTrackersOverview(companyId)
  const trackerless = perms.canEdit ? await getTrackerlessAssets(companyId) : []
  return <TrackersPage data={data} canEdit={perms.canEdit} trackerless={trackerless} />
}
