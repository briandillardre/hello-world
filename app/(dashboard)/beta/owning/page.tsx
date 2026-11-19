import { requireBetaTool } from '@/lib/beta/server'
import { companyAssets, listRecords, machineFacts } from '@/lib/db/beta'
import { owningCost, type OwningInputs } from '@/lib/beta/owning'
import { OwningView, type OwningRow } from '@/components/beta/OwningView'

export const metadata = { title: 'HammerTrack — Machine cost' }
export const dynamic = 'force-dynamic'

export default async function OwningPage() {
  const { companyId, canWrite, demo } = await requireBetaTool('owning')
  const [assets, sheets] = await Promise.all([companyAssets(companyId), listRecords(companyId, ['owning'])])
  const sheetBy = new Map(sheets.rows.map((r) => [r.assetId, r]))
  const facts = await machineFacts(companyId, assets.map((a) => a.id), true)
  const rows: OwningRow[] = assets.map((a) => {
    const sheet = sheetBy.get(a.id) ?? null
    const f = facts.get(a.id) ?? { hoursYear: null, repairs12: null, rate: null }
    const d = (sheet?.data ?? {}) as Partial<OwningInputs>
    const result = sheet && typeof d.price === 'number' && typeof d.lifeYears === 'number'
      ? owningCost(d as OwningInputs, f.hoursYear, { repairsLast12: f.repairs12, currentRate: f.rate }) : null
    return { asset: { id: a.id, name: a.name, type: a.type }, sheet, result, measuredHours: f.hoursYear, repairs12: f.repairs12, rate: f.rate }
  }).sort((x, y) => Number(!!y.sheet) - Number(!!x.sheet) || x.asset.name.localeCompare(y.asset.name))
  return <OwningView rows={rows} demo={demo} canWrite={canWrite} />
}
