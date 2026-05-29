import { Wrench, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { getMaintenanceSchedules, getServiceRecords, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import { getAssets } from '@/lib/db/assets'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'

const STATUS_META = {
  overdue: { label: 'Overdue', variant: 'destructive' as const, icon: AlertTriangle, bar: 'bg-red-500' },
  due_soon: { label: 'Due soon', variant: 'default' as const, icon: Clock, bar: 'bg-amber-500' },
  ok: { label: 'OK', variant: 'success' as const, icon: CheckCircle2, bar: 'bg-green-500' },
}

const UNIT = { engine_hours: 'hrs', mileage: 'mi', days: 'days' }

export default async function MaintenancePage() {
  const [schedules, assets, readings, services] = await Promise.all([
    getMaintenanceSchedules(MOCK_COMPANY.id),
    getAssets(MOCK_COMPANY.id),
    getCurrentReadings(),
    getServiceRecords(MOCK_COMPANY.id),
  ])

  const assetName = (id: string) => assets.find(a => a.id === id)?.name ?? 'Unknown asset'

  const statuses = schedules
    .map(s => ({ ...computeStatus(s, readings[s.asset_id] ?? s.last_service_value), name: assetName(s.asset_id) }))
    .sort((a, b) => a.remaining - b.remaining)

  const overdueCount = statuses.filter(s => s.status === 'overdue').length
  const totalSpent = services.reduce((sum, r) => sum + r.cost, 0)

  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10 flex items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900">Maintenance</h1>
        {overdueCount > 0 && <Badge variant="destructive">{overdueCount} overdue</Badge>}
        <span className="ml-auto text-sm text-slate-400">
          ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2 })} YTD
        </span>
      </div>

      <div className="p-4 space-y-6 max-w-2xl">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Service Schedule</h2>
          {statuses.map(s => {
            const meta = STATUS_META[s.status]
            const Icon = meta.icon
            return (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Wrench className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.description}</p>
                  </div>
                  <Badge variant={meta.variant} className="flex items-center gap-1">
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                </div>
                <div className="mt-3">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${meta.bar} rounded-full transition-all`} style={{ width: `${Math.min(100, s.pct)}%` }} />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-slate-400">
                    <span>{Math.round(s.used)} / {s.interval_value} {UNIT[s.interval_type]}</span>
                    <span>
                      {s.remaining <= 0
                        ? `${Math.abs(Math.round(s.remaining))} ${UNIT[s.interval_type]} overdue`
                        : `${Math.round(s.remaining)} ${UNIT[s.interval_type]} remaining`}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Service History</h2>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm">
            {services.map(r => (
              <div key={r.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 text-sm truncate">{assetName(r.asset_id)}</p>
                  <p className="text-xs text-slate-500 truncate">{r.notes}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {r.vendor} · {formatRelativeTime(r.service_date)}
                  </p>
                </div>
                <span className="font-semibold text-slate-700 text-sm flex-shrink-0">
                  ${r.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 text-center">
            Service costs sync to QuickBooks as expenses → see Accounting.
          </p>
        </section>
      </div>
    </div>
  )
}
