import { requireBetaTool } from '@/lib/beta/server'
import { companyAssets, companySites, companyToday, lastWorked, listRecords } from '@/lib/db/beta'
import { rankOf, RANK } from '@/lib/permissions'
import { RentalsView } from '@/components/beta/RentalsView'

export const metadata = { title: 'HammerTrack — Rentals' }
export const dynamic = 'force-dynamic'

export default async function RentalsPage() {
  const { perms, companyId, canWrite, demo } = await requireBetaTool('rentals')
  const [{ today, tz }, recs, sites, assets] = await Promise.all([companyToday(companyId), listRecords(companyId, ['rental']), companySites(companyId), companyAssets(companyId)])
  const tracked = Array.from(new Set(recs.rows.filter((r) => r.assetId && !r.data.offRentCalled).map((r) => r.assetId!)))
  const worked = await lastWorked(companyId, tracked, tz)
  return <RentalsView rows={recs.rows} sites={sites.map(({ id, name }) => ({ id, name }))} assets={assets} today={today} demo={demo}
    lastWorked={Object.fromEntries(worked)} canWrite={canWrite && perms.canEdit} canRemoveAny={rankOf(perms) >= RANK.manager} />
}
