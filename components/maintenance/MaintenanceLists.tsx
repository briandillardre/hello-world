'use client'

/**
 * Maintenance lists with the app-wide search + sort convention (same controls
 * as Assets/Zones/Accounting): one search box covers both the schedule and
 * the history; each section carries its own sort pills.
 */

import { useState } from 'react'
import { Wrench, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import type { MaintenanceStatus } from '@/lib/db/maintenance'
import type { ServiceRecord } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import { SearchInput, SortPills } from '@/components/ui/list-controls'
import { ExpenseToQbo } from '@/components/maintenance/ExpenseToQbo'

const STATUS_META = {
  overdue: { label: 'Overdue', variant: 'destructive' as const, icon: AlertTriangle, bar: 'bg-alert' },
  due_soon: { label: 'Due soon', variant: 'default' as const, icon: Clock, bar: 'bg-amber' },
  ok: { label: 'OK', variant: 'success' as const, icon: CheckCircle2, bar: 'bg-[#34d399]' },
}

const UNIT = { engine_hours: 'hrs', mileage: 'mi', days: 'days' }

type ScheduleSort = 'due' | 'name'
type HistorySort = 'newest' | 'cost'

export function MaintenanceLists({ statuses, services, qboLive }: {
  statuses: (MaintenanceStatus & { name: string })[]
  services: (ServiceRecord & { assetName: string })[]
  qboLive: boolean
}) {
  const [query, setQuery] = useState('')
  const [schedSort, setSchedSort] = useState<ScheduleSort>('due')
  const [histSort, setHistSort] = useState<HistorySort>('newest')

  const q = query.toLowerCase()
  const schedule = statuses
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    .sort((a, b) => (schedSort === 'name' ? a.name.localeCompare(b.name) : a.remaining - b.remaining))
  const history = services
    .filter((r) => !q || r.assetName.toLowerCase().includes(q) || r.vendor.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q))
    .sort((a, b) => (histSort === 'cost' ? b.cost - a.cost : b.service_date.localeCompare(a.service_date)))

  return (
    <div className="p-4 max-w-2xl lg:max-w-6xl space-y-4">
      {(statuses.length > 0 || services.length > 0) && (
        <SearchInput value={query} onChange={setQuery} placeholder="Search machines, work, vendors…" />
      )}

      <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
        <section className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Service Schedule</h2>
            {statuses.length > 1 && (
              <span className="ml-auto"><SortPills<ScheduleSort> options={[['due', 'Due first'], ['name', 'A → Z']]} value={schedSort} onChange={setSchedSort} /></span>
            )}
          </div>
          {statuses.length === 0 && (
            <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6 max-w-sm mx-auto text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-amber/10 border border-amber/25 grid place-items-center mb-3">
                <Wrench className="h-6 w-6 text-amber" />
              </div>
              <p className="text-ink font-display font-bold">No blown engines on your watch</p>
              <p className="text-sm text-faint mt-1.5 leading-relaxed">
                Set a service interval by engine hours, miles, or days and HammerTrack counts down
                from real tracker data — overdue machines turn red before they turn expensive.
              </p>
            </div>
          )}
          {statuses.length > 0 && schedule.length === 0 && (
            <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">Nothing matches that search.</p>
          )}
          {schedule.map((s) => {
            const meta = STATUS_META[s.status]
            const Icon = meta.icon
            return (
              <div key={s.id} className="bg-navy-900 rounded-xl border border-navy-800 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-navy-800 flex items-center justify-center flex-shrink-0">
                    <Wrench className="h-5 w-5 text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink truncate">{s.name}</p>
                    <p className="text-xs text-muted">{s.description}</p>
                  </div>
                  <Badge variant={meta.variant} className="flex items-center gap-1">
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                </div>
                <div className="mt-3">
                  <div className="h-2 bg-navy-800 rounded-full overflow-hidden">
                    <div className={`h-full ${meta.bar} rounded-full transition-all`} style={{ width: `${Math.min(100, s.pct)}%` }} />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-faint">
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
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Service History</h2>
            {services.length > 1 && (
              <span className="ml-auto"><SortPills<HistorySort> options={[['newest', 'Newest'], ['cost', 'Priciest']]} value={histSort} onChange={setHistSort} /></span>
            )}
          </div>
          <div className="bg-navy-900 rounded-xl border border-navy-800 divide-y divide-navy-800">
            {services.length > 0 && history.length === 0 && (
              <p className="p-4 text-sm text-faint">Nothing matches that search.</p>
            )}
            {history.map((r) => (
              <div key={r.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink text-sm truncate">{r.assetName}</p>
                  <p className="text-xs text-muted truncate">{r.notes}</p>
                  <p className="text-xs text-faint mt-0.5">
                    {r.vendor} · {formatRelativeTime(r.service_date)}
                  </p>
                </div>
                <span className="font-semibold text-muted text-sm flex-shrink-0">
                  ${r.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
                {qboLive && r.cost > 0 && <ExpenseToQbo recordId={r.id} />}
              </div>
            ))}
          </div>
          <p className="text-xs text-faint text-center">
            Service costs sync to QuickBooks as expenses → see Accounting.
          </p>
        </section>
      </div>
    </div>
  )
}
