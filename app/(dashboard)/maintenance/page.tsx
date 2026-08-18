import { getMaintenanceSchedules, getServiceRecords, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import { getAssets } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getConnectionStatus } from '@/lib/qbo'
import { getWorkOrders, ensureScheduleWorkOrders } from '@/lib/db/workorders'
import { Badge } from '@/components/ui/badge'
import { MaintenanceLists, AddScheduleButton } from '@/components/maintenance/MaintenanceLists'
import { WorkOrders } from '@/components/maintenance/WorkOrders'

export const metadata = { title: 'HammerTrack — Maintenance' }

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

  // Every overdue schedule gets exactly one open work order (idempotent),
  // stamped with the machine's live reading — then the board is loaded.
  await ensureScheduleWorkOrders(companyId, statuses.filter(s => s.status === 'overdue'), readings)
  const woData = await getWorkOrders(companyId)
  const assetNames = Object.fromEntries(
    assets.filter(a => a.type === 'vehicle' || a.type === 'equipment').map(a => [a.id, a.name])
  )

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
        <AddScheduleButton assetNames={assetNames} />
      </div>

      <WorkOrders
        orders={woData.orders}
        members={woData.members}
        assetNames={assetNames}
        available={woData.available}
      />

      <MaintenanceLists
        statuses={statuses}
        services={services.map(r => ({ ...r, assetName: assetName(r.asset_id) }))}
        qboLive={qboLive}
        assetNames={assetNames}
      />
    </div>
  )
}
