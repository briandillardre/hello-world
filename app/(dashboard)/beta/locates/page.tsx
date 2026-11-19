import { requireBetaTool } from '@/lib/beta/server'
import { companySites, companyToday, listRecords } from '@/lib/db/beta'
import { rankOf, RANK } from '@/lib/permissions'
import { LocatesView } from '@/components/beta/LocatesView'

export const metadata = { title: 'HammerTrack — 811 tickets' }
export const dynamic = 'force-dynamic'

export default async function LocatesPage() {
  const { perms, companyId, canWrite, demo } = await requireBetaTool('locates')
  const [{ today }, recs, sites] = await Promise.all([companyToday(companyId), listRecords(companyId, ['locate']), companySites(companyId)])
  return <LocatesView rows={recs.rows} sites={sites.map(({ id, name }) => ({ id, name }))} today={today} demo={demo}
    canWrite={canWrite && perms.canEdit} canRemoveAny={rankOf(perms) >= RANK.manager} />
}
