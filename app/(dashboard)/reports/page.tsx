import type { ReactNode } from 'react'
import { Activity, Clock, Gauge, MapPin } from 'lucide-react'
import { MOCK_UTILIZATION, MOCK_EQUIPMENT_RATES } from '@/lib/mock-data'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getUtilization } from '@/lib/db/reports'
import type { AssetType, AssetUtilization } from '@/lib/types'
import { ReportsExport } from '@/components/reports/ReportsExport'
import { CountUp } from '@/components/ui/count-up'

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}

const RANGES: { key: string; label: string; days: number }[] = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'ytd', label: 'YTD', days: 366 },
]

export default async function ReportsPage({ searchParams }: { searchParams?: { range?: string } }) {
  const companyId = await getCurrentCompanyId()
  const [assets, geofences] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
  ])
  const picked = RANGES.find((r) => r.key === searchParams?.range) ?? RANGES[1]
  const sinceMs = picked.key === 'ytd'
    ? new Date(new Date().getFullYear(), 0, 1).getTime()
    : Date.now() - picked.days * 24 * 60 * 60 * 1000
  const since = new Date(sinceMs).toISOString()
  const real = await getUtilization(companyId, since, assets, geofences)

  // Real mode: measured utilization + each asset's own hourly rate. Demo: mock.
  const util: AssetUtilization[] = real ?? MOCK_UTILIZATION
  const rateFor = (assetId: string): number =>
    real
      ? (assets.find((a) => a.id === assetId)?.hourly_rate ?? 0)
      : (MOCK_EQUIPMENT_RATES[assetId] ?? 0)

  const totalEngineHours = Math.round(util.reduce((s, u) => s + u.engine_hours, 0) * 10) / 10
  const totalIdle = Math.round(util.reduce((s, u) => s + u.idle_hours, 0) * 10) / 10
  const totalDistance = Math.round(util.reduce((s, u) => s + u.distance_miles, 0) * 10) / 10
  const maxEngine = Math.max(...util.map(u => u.engine_hours), 1)
  const idlePct = totalEngineHours + totalIdle > 0 ? Math.round((totalIdle / (totalEngineHours + totalIdle)) * 100) : 0
  const billableValue = Math.round(util.reduce((s, u) => s + u.engine_hours * rateFor(u.asset_id), 0))

  const empty = real !== null && util.length === 0

  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-20">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Utilization Reports</h1>
          <p className="text-xs text-faint mt-0.5">{picked.key === 'ytd' ? 'Year to date' : `Last ${picked.label}`}{real ? ' · measured from tracker data' : ' · demo data'}</p>
        </div>
        <div className="flex gap-1 ml-2">
          {RANGES.map((r) => (
            <a key={r.key} href={`/reports?range=${r.key}`}
              className={'px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-colors ' + (picked.key === r.key ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')}>
              {r.label}
            </a>
          ))}
        </div>
        {util.length > 0 && <div className="ml-auto"><ReportsExport util={util} rates={util.map(u => rateFor(u.asset_id))} /></div>}
      </div>

      <div className="p-4 space-y-6 max-w-2xl lg:max-w-6xl">
        {empty ? (
          <section className="rounded-2xl border border-navy-800 bg-navy-900 p-6 text-center">
            <p className="text-4xl mb-2">📊</p>
            <p className="text-ink font-medium">No utilization yet</p>
            <p className="text-sm text-faint mt-1">Once your trackers report a few days of movement, active hours, idle %, miles, and hours-per-site fill in here automatically.</p>
          </section>
        ) : (
        <>
        {/* Hero: what the tracked hours are worth — the reason this page exists */}
        <section className="rounded-2xl border border-navy-800 bg-gradient-to-br from-navy-900 to-navy-950 p-5 relative overflow-hidden lg:max-w-2xl">
          <div className="absolute inset-0 brand-glow" />
          <div className="relative">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Billable value · {picked.key === 'ytd' ? 'year to date' : `last ${picked.label}`}</p>
            <p className="font-display font-black text-[2.1rem] text-amber leading-tight">
              <CountUp value={billableValue} prefix="$" />
            </p>
            <p className="text-xs text-faint">{totalEngineHours.toLocaleString()} active hours at your asset rates{real ? '' : ' — demo figures'}. {real && billableValue === 0 ? 'Set hourly rates on your assets to see billable value.' : 'Job-costed automatically.'}</p>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3 lg:max-w-2xl">
          <SummaryCard icon={<Activity className="h-4 w-4 text-amber" />} label="Active hrs" value={`${totalEngineHours}`} />
          <SummaryCard icon={<Clock className="h-4 w-4 text-alert" />} label="Idle %" value={`${idlePct}%`} />
          <SummaryCard icon={<Gauge className="h-4 w-4 text-[#60a5fa]" />} label="Miles" value={totalDistance.toLocaleString()} />
        </section>

        <div className="space-y-6 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:items-start">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Active Hours by Asset</h2>
          <div className="bg-navy-900 rounded-xl border border-navy-800 p-4 space-y-3">
            {util.map(u => (
              <div key={u.asset_id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted font-medium">{TYPE_EMOJI[u.asset_type]} {u.asset_name}</span>
                  <span className="text-muted">{u.engine_hours} hrs</span>
                </div>
                <div className="h-2.5 bg-navy-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber rounded-full" style={{ width: `${(u.engine_hours / maxEngine) * 100}%` }} />
                </div>
                <p className="text-xs text-faint mt-0.5">{u.idle_hours} hrs idle · {u.distance_miles} mi</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Hours by Job Site</h2>
          <div className="bg-navy-900 rounded-xl border border-navy-800 divide-y divide-navy-800">
            {util.filter(u => u.job_site_hours.length > 0).map(u => (
              <div key={u.asset_id} className="p-4">
                <p className="font-medium text-ink text-sm mb-1">{u.asset_name}</p>
                {u.job_site_hours.map(s => (
                  <div key={s.geofence_id} className="flex items-center gap-2 text-xs text-muted mt-1">
                    <MapPin className="h-3 w-3 text-faint" />
                    <span className="flex-1">{s.geofence_name}</span>
                    <span className="font-medium text-muted">{s.hours} hrs</span>
                  </div>
                ))}
              </div>
            ))}
            {util.every(u => u.job_site_hours.length === 0) && (
              <div className="p-4 text-xs text-faint">Draw job-site zones on the map to see hours attributed per site.</div>
            )}
          </div>
          <p className="text-xs text-faint text-center">
            Job-site hours drive equipment-usage billing → see Accounting.
          </p>
        </section>
        </div>
        </>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-navy-900 rounded-xl border border-navy-800 p-3">
      <div className="flex items-center gap-1.5 mb-1">{icon}</div>
      <p className="text-xl font-bold text-ink">{value}</p>
      <p className="text-xs text-faint">{label}</p>
    </div>
  )
}
