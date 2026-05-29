import type { ReactNode } from 'react'
import { Activity, Clock, Gauge, MapPin } from 'lucide-react'
import { MOCK_UTILIZATION } from '@/lib/mock-data'
import type { AssetType } from '@/lib/types'

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}

export default function ReportsPage() {
  const util = MOCK_UTILIZATION
  const totalEngineHours = util.reduce((s, u) => s + u.engine_hours, 0)
  const totalIdle = util.reduce((s, u) => s + u.idle_hours, 0)
  const totalDistance = util.reduce((s, u) => s + u.distance_miles, 0)
  const maxEngine = Math.max(...util.map(u => u.engine_hours), 1)
  const idlePct = totalEngineHours > 0 ? Math.round((totalIdle / (totalEngineHours + totalIdle)) * 100) : 0

  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
        <h1 className="text-xl font-bold text-slate-900">Utilization Reports</h1>
        <p className="text-xs text-slate-400 mt-0.5">Last 30 days</p>
      </div>

      <div className="p-4 space-y-6 max-w-2xl">
        <section className="grid grid-cols-3 gap-3">
          <SummaryCard icon={<Activity className="h-4 w-4 text-amber-500" />} label="Engine hours" value={`${totalEngineHours}`} />
          <SummaryCard icon={<Clock className="h-4 w-4 text-red-500" />} label="Idle %" value={`${idlePct}%`} />
          <SummaryCard icon={<Gauge className="h-4 w-4 text-blue-500" />} label="Miles" value={totalDistance.toLocaleString()} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Engine Hours by Asset</h2>
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-sm">
            {util.map(u => (
              <div key={u.asset_id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-700 font-medium">{TYPE_EMOJI[u.asset_type]} {u.asset_name}</span>
                  <span className="text-slate-500">{u.engine_hours} hrs</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(u.engine_hours / maxEngine) * 100}%` }} />
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{u.idle_hours} hrs idle</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Hours by Job Site</h2>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm">
            {util.map(u => (
              <div key={u.asset_id} className="p-4">
                <p className="font-medium text-slate-900 text-sm mb-1">{u.asset_name}</p>
                {u.job_site_hours.map(s => (
                  <div key={s.geofence_id} className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                    <MapPin className="h-3 w-3 text-slate-400" />
                    <span className="flex-1">{s.geofence_name}</span>
                    <span className="font-medium text-slate-700">{s.hours} hrs</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 text-center">
            Job-site hours drive equipment-usage billing → see Accounting.
          </p>
        </section>
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">{icon}</div>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  )
}
