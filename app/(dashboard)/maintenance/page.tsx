import { getMaintenanceSchedules, getServiceRecords, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import { getAssets } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getConnectionStatus } from '@/lib/qbo'
import { Badge } from '@/components/ui/badge'
import { MaintenanceLists } from '@/components/maintenance/MaintenanceLists'

export default async function MaintenancePage() {
  const companyId = await getCurrentCompanyId()
  const [schedules, assets, readings, services, qbo] = await Promise.all([
    getMaintenanceSchedules(companyId),
    getAssets(companyId),
    getCurrentReadings(),
    getServiceRecords(companyId),
    getConnectionStatus(companyId),
  ])
  // Real connected QBO → each service record gets a one-tap expense push.
  const qboLive = qbo.connected && !qbo.demo

  const assetName = (id: string) => assets.find(a => a.id === id)?.name ?? 'Unknown asset'

  const statuses = schedules
    .map(s => ({ ...computeStatus(s, readings[s.asset_id] ?? s.last_service_value), name: assetName(s.asset_id) }))

  const overdueCount = statuses.filter(s => s.status === 'overdue').length
  const totalSpent = services.reduce((sum, r) => sum + r.cost, 0)

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Maintenance</h1>
        {overdueCount > 0 && <Badge variant="destructive">{overdueCount} overdue</Badge>}
        <span className="ml-auto text-sm text-faint">
          ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2 })} YTD
        </span>
      </div>

      <MaintenanceLists
        statuses={statuses}
        services={services.map(r => ({ ...r, assetName: assetName(r.asset_id) }))}
        qboLive={qboLive}
      />
    </div>
  )
}
