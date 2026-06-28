import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Battery, Zap, Clock, Wifi, MapPin, Wrench, Hash, Tag } from 'lucide-react'
import { MOCK_ASSETS, MOCK_TOOL_ASSOCIATIONS, MOCK_COMPANY } from '@/lib/mock-data'
import { resolveToolLocations } from '@/lib/db/tools'
import { getMaintenanceSchedules, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import type { AssetType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }
const TYPE_LABEL: Record<AssetType, string> = { vehicle: 'Vehicle', equipment: 'Equipment', personnel: 'Personnel', tool: 'Small Tool' }
const UNIT: Record<string, string> = { engine_hours: 'hrs', mileage: 'mi', days: 'days' }
const M_STATUS = {
  overdue: { label: 'Overdue', cls: 'bg-alert/15 text-alert', bar: 'bg-alert' },
  due_soon: { label: 'Due soon', cls: 'bg-amber/15 text-amber', bar: 'bg-amber' },
  ok: { label: 'OK', cls: 'bg-[#34d399]/15 text-[#6ee7b7]', bar: 'bg-[#34d399]' },
}

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const assets = resolveToolLocations(MOCK_ASSETS, MOCK_TOOL_ASSOCIATIONS)
  const asset = assets.find((a) => a.id === params.id)
  if (!asset) notFound()

  const [schedules, readings] = await Promise.all([getMaintenanceSchedules(MOCK_COMPANY.id), getCurrentReadings()])
  const assetSchedules = schedules
    .filter((s) => s.asset_id === asset.id)
    .map((s) => ({ ...computeStatus(s, readings[s.asset_id] ?? s.last_service_value), name: s.description }))

  const loc = asset.location
  const meta = (asset.metadata ?? {}) as Record<string, unknown>
  const serial = (meta.serial ?? meta.serial_number ?? meta.vin) as string | undefined
  const detailRows = Object.entries(meta).filter(([k]) => !['serial', 'serial_number', 'vin'].includes(k))

  return (
    <div className="h-full overflow-auto pb-28 md:pb-10">
      {/* header */}
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <Link href="/assets" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3">
          <ArrowLeft className="h-4 w-4" /> All assets
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-3xl w-12 h-12 grid place-items-center bg-navy-800 rounded-xl">{TYPE_EMOJI[asset.type]}</div>
          <div>
            <h1 className="text-xl font-bold text-ink">{asset.name}</h1>
            <Badge variant="secondary" className="mt-1">{TYPE_LABEL[asset.type]}</Badge>
          </div>
          <Link href="/map" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm px-3.5 py-2 hover:bg-amber-600 transition-colors">
            <MapPin className="h-4 w-4" /> View on map
          </Link>
        </div>
      </div>

      <div className="p-4 max-w-3xl space-y-6">
        {/* photo + identity */}
        <section className="grid sm:grid-cols-[200px_1fr] gap-4">
          <div className="aspect-square rounded-xl border border-navy-800 bg-navy-900 grid place-items-center text-center">
            <div>
              <p className="text-5xl mb-1">{TYPE_EMOJI[asset.type]}</p>
              <p className="font-mono text-[11px] text-faint">No photo yet</p>
            </div>
          </div>
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
            <Field icon={<Wifi className="h-4 w-4 text-[#60a5fa]" />} label="Tracker ID" value={asset.tracker_id ?? '—'} />
            <Field icon={<Hash className="h-4 w-4 text-faint" />} label="Serial number" value={serial ?? '— (add later)'} />
            {detailRows.map(([k, v]) => (
              <Field key={k} icon={<Tag className="h-4 w-4 text-faint" />} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </div>
        </section>

        {/* live telemetry */}
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Live status</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat icon={<Battery className="h-4 w-4 text-[#34d399]" />} label="Battery" value={loc?.battery != null ? `${loc.battery}%` : '—'} />
            <Stat icon={<Zap className="h-4 w-4 text-amber" />} label="Speed" value={loc?.speed != null ? `${loc.speed} mph` : '—'} />
            <Stat icon={<Clock className="h-4 w-4 text-faint" />} label="Last seen" value={loc?.timestamp ? formatRelativeTime(loc.timestamp) : '—'} />
            <Stat icon={<MapPin className="h-4 w-4 text-teal" />} label="Location" value={loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : 'Off-grid'} />
          </div>
        </section>

        {/* maintenance */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Maintenance</h2>
            <Link href="/maintenance" className="text-xs text-teal hover:underline">All maintenance →</Link>
          </div>
          {assetSchedules.length === 0 ? (
            <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">No service schedules for this asset.</p>
          ) : (
            <div className="space-y-2">
              {assetSchedules.map((s) => {
                const m = M_STATUS[s.status]
                return (
                  <div key={s.id} className="rounded-xl border border-navy-800 bg-navy-900 p-4">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-faint" />
                      <span className="font-medium text-ink text-sm flex-1">{s.name}</span>
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>
                    </div>
                    <div className="mt-2 h-2 bg-navy-800 rounded-full overflow-hidden">
                      <div className={`h-full ${m.bar} rounded-full`} style={{ width: `${Math.min(100, s.pct)}%` }} />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-faint">
                      <span>{Math.round(s.used)} / {s.interval_value} {UNIT[s.interval_type]}</span>
                      <span>{s.remaining <= 0 ? `${Math.abs(Math.round(s.remaining))} ${UNIT[s.interval_type]} overdue` : `${Math.round(s.remaining)} ${UNIT[s.interval_type]} left`}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-faint capitalize w-28 flex-none">{label}</span>
      <span className="text-ink font-medium truncate">{value}</span>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900 p-3">
      <div className="flex items-center gap-1.5 mb-1">{icon}</div>
      <p className="font-display font-bold text-ink text-[15px]">{value}</p>
      <p className="text-xs text-faint">{label}</p>
    </div>
  )
}
