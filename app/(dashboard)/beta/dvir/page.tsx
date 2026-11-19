import { requireBetaTool } from '@/lib/beta/server'
import { companyAssets, listRecords } from '@/lib/db/beta'
import { rankOf, RANK, visibleAssets } from '@/lib/permissions'
import { DvirView } from '@/components/beta/DvirView'

export const metadata = { title: 'HammerTrack — Inspections' }
export const dynamic = 'force-dynamic'

export default async function DvirPage() {
  const { perms, companyId, canWrite, demo } = await requireBetaTool('dvir')
  const [assets, recs] = await Promise.all([companyAssets(companyId), listRecords(companyId, ['dvir'], { limit: 300 })])
  // a preview sees what the previewed role may see (RLS reads as the real login)
  const shown = visibleAssets(assets, perms)
  return <DvirView assets={shown.map(({ id, name, type }) => ({ id, name, type }))} rows={recs.rows} demo={demo} canWrite={canWrite}
    canCertify={canWrite && perms.canEdit && rankOf(perms) >= RANK.foreman} />
}
