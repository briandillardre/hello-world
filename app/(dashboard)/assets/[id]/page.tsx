import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Battery, Zap, Clock, Wifi, MapPin, Wrench, Hash, Tag } from 'lucide-react'
import { getAssetsWithLocations, getAssetPhotos } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, getPairingLog } from '@/lib/db/tools'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { getMaintenanceSchedules, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import type { AssetType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import { CostCard } from '@/components/assets/CostCard'
import { AssetActions } from '@/components/assets/AssetActions'
import { AssetDiagnostics } from '@/components/assets/AssetDiagnostics'
import { TripLog } from '@/components/assets/TripLog'
import { getGeofences } from '@/lib/db/geofences'
import { segmentTrips, type Trip } from '@/lib/trips'
import { DEFAULT_TZ } from '@/lib/dates'
import { cookies } from 'next/headers'
import { vehiclePower } from '@/lib/vehicle-power'

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }
const TYPE_LABEL: Record<AssetType, string> = { vehicle: 'Vehicle', equipment: 'Equipment', personnel: 'Personnel', tool: 'Small Tool' }
const UNIT: Record<string, string> = { engine_hours: 'hrs', mileage: 'mi', days: 'days' }
const PHOTO_LABEL: Record<string, string> = { truck: 'Truck / unit', gvwr: 'GVWR sticker', vin: 'VIN plate', engine: 'Engine', issue: 'Issue / damage', other: 'Other' }
const M_STATUS = {
  overdue: { label: 'Overdue', cls: 'bg-alert/15 text-alert', bar: 'bg-alert' },
  due_soon: { label: 'Due soon', cls: 'bg-amber/15 text-amber', bar: 'bg-amber' },
  ok: { label: 'OK', cls: 'bg-[#34d399]/15 text-[#6ee7b7]', bar: 'bg-[#34d399]' },
}

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const companyId = await getCurrentCompanyId()
  const perms = await getMyPermissions()
  const canEdit = perms.canEdit
  const [rawAssets, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getToolAssociations(companyId),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)
  const asset = assets.find((a) => a.id === params.id)
  if (!asset) notFound()

  const [schedules, readings, pairingRows, assetPhotos] = await Promise.all([
    getMaintenanceSchedules(companyId),
    getCurrentReadings(),
    getPairingLog(companyId, asset.id),
    getAssetPhotos(asset.id),
  ])
  const assetSchedules = schedules
    .filter((s) => s.asset_id === asset.id)
    .map((s) => ({ ...computeStatus(s, readings[s.asset_id] ?? s.last_service_value), name: s.description }))

  const loc = asset.location
  // Vercel renders in UTC — trip times format in the viewer's zone.
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)
  const meta = (asset.metadata ?? {}) as Record<string, unknown>
  const serial = asset.serial ?? (meta.serial ?? meta.serial_number ?? meta.vin) as string | undefined
  const detailRows = Object.entries(meta).filter(([k]) => !['serial', 'serial_number', 'vin'].includes(k))

  // Trip log: segment this asset's last 7 days of pings into drives, with
  // zone names anchoring each end ("Yard → Riverfront Tower").
  const isMockEnv = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
  const TRIP_DAYS = 7
  let trips: Trip[] | null = null
  if (!isMockEnv && (asset.type === 'vehicle' || asset.type === 'equipment')) {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const [fences, { data: rows }] = await Promise.all([
      getGeofences(companyId),
      supabase
        .from('asset_locations')
        .select('lat, lng, speed, timestamp')
        .eq('asset_id', asset.id)
        .gte('timestamp', new Date(Date.now() - TRIP_DAYS * 86_400_000).toISOString())
        .order('timestamp', { ascending: true })
        .limit(30_000),
    ])
    trips = segmentTrips(rows ?? [], fences)
  }

  return (
    <div className="h-full overflow-auto pb-28 md:pb-10">
      {/* header */}
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <Link href="/assets" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3">
          <ArrowLeft className="h-4 w-4" /> All assets
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-3xl w-12 h-12 grid place-items-center bg-navy-800 rounded-xl flex-none">{TYPE_EMOJI[asset.type]}</div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-ink leading-snug">{asset.name}</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge variant="secondary">{TYPE_LABEL[asset.type]}</Badge>
              {asset.category && <Badge variant="outline">{asset.category}</Badge>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canEdit && <AssetActions asset={asset} photos={assetPhotos} />}
            {/* phones: icon-only (the text version wrapped to 3 ugly lines) */}
            <Link href="/map" aria-label="View on map" className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm p-2.5 sm:px-3.5 sm:py-2 hover:bg-amber-600 transition-colors whitespace-nowrap">
              <MapPin className="h-4 w-4" /> <span className="hidden sm:inline">View on map</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-3xl space-y-6">
        {/* photo + identity */}
        <section className="grid sm:grid-cols-[200px_1fr] gap-4">
          {asset.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.photo_url} alt={asset.name} className="aspect-square w-full rounded-xl border border-navy-800 bg-navy-900 object-cover" />
          ) : (
            <div className="aspect-square rounded-xl border border-navy-800 bg-navy-900 grid place-items-center text-center">
              <div>
                <p className="text-5xl mb-1">{TYPE_EMOJI[asset.type]}</p>
                <p className="font-mono text-[11px] text-faint">No photo yet</p>
              </div>
            </div>
          )}
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
            <Field icon={<Wifi className="h-4 w-4 text-[#60a5fa]" />} label="Tracker ID" value={asset.tracker_id ?? '—'} />
            <Field icon={<Hash className="h-4 w-4 text-faint" />} label="Serial number" value={serial ?? '— (add later)'} />
            {detailRows.map(([k, v]) => (
              <Field key={k} icon={<Tag className="h-4 w-4 text-faint" />} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </div>
        </section>

        {/* photo gallery — truck shot, GVWR sticker, VIN plate, engine, issues */}
        {assetPhotos.length > 0 && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Photos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {assetPhotos.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="relative rounded-lg border border-navy-800 overflow-hidden group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={PHOTO_LABEL[p.label ?? ''] ?? p.label ?? 'Photo'} className="h-28 w-full object-cover transition-transform group-hover:scale-105" />
                  <span className="absolute bottom-0 inset-x-0 bg-navy-950/80 text-[10px] text-muted px-1.5 py-0.5 truncate">{PHOTO_LABEL[p.label ?? ''] ?? p.label ?? 'Photo'}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* cost structure — dollar figures are permission-gated */}
        {perms.canViewCosts && <CostCard asset={asset} />}

        {/* live telemetry */}
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Live status</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat icon={<Battery className="h-4 w-4 text-[#34d399]" />} label="Battery" value={loc?.battery != null ? `${loc.battery}%` : '—'} />
            <Stat icon={<Zap className="h-4 w-4 text-amber" />} label="Speed" value={loc?.speed != null ? `${loc.speed} mph` : '—'} />
            <Stat icon={<Clock className="h-4 w-4 text-faint" />} label="Last seen" value={loc?.timestamp ? formatRelativeTime(loc.timestamp) : '—'} />
            <Stat icon={<MapPin className="h-4 w-4 text-teal" />} label="Location" value={loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : 'Off-grid'} />
            {(() => {
              // Engine + 12V health from OBD voltage — the free dead-battery
              // early warning (docs/TRACKER-DATA.md). Vehicles only.
              if (asset.type !== 'vehicle') return null
              const p = vehiclePower(loc?.raw)
              if (p.volts == null && p.engineOn == null) return null
              return (
                <>
                  <Stat
                    icon={<Zap className={'h-4 w-4 ' + (p.engineOn ? 'text-[#34d399]' : 'text-faint')} />}
                    label="Engine"
                    value={p.engineOn == null ? '—' : p.engineOn ? 'Running' : 'Off'}
                  />
                  <Stat
                    icon={<Battery className={'h-4 w-4 ' + (p.health === 'low' ? 'text-alert' : p.health === 'weak' ? 'text-amber' : 'text-[#34d399]')} />}
                    label={p.health === 'low' ? '12V battery · charge soon' : p.health === 'weak' ? '12V battery · getting weak' : '12V battery'}
                    value={p.volts != null ? `${p.volts.toFixed(1)} V` : '—'}
                  />
                </>
              )
            })()}
          </div>
        </section>

        {/* full raw telemetry — collapsed, one tap from the glance stats above */}
        <section>
          <AssetDiagnostics raw={loc?.raw} timestamp={loc?.timestamp} />
        </section>

        {/* drive history (real cellular assets only) */}
        {trips !== null && <TripLog trips={trips} days={TRIP_DAYS} tz={tz} />}

        {/* pairing history — which truck carried this tool / what this truck
            carried, as episodes. Empty until migration 021 + first beacon. */}
        {(() => {
          const rows = pairingRows
          if (!rows.length) return null
          const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? 'removed asset'
          const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' })
          const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
          return (
            <section>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Pairing history</h2>
              <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
                {rows.map((p) => {
                  const partnerId = p.member_asset_id === asset.id ? p.carrier_asset_id : p.member_asset_id
                  const verb = p.member_asset_id === asset.id ? 'rode with' : 'carried'
                  const start = new Date(p.started_at)
                  const end = p.ended_at ? new Date(p.ended_at) : null
                  return (
                    <div key={p.id} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                      <Wifi className={'h-4 w-4 flex-none ' + (p.ended_at ? 'text-faint' : 'text-[#34d399]')} />
                      <span className="flex-1 min-w-0">
                        <span className="text-ink font-medium">{verb} </span>
                        <Link href={`/assets/${partnerId}`} className="text-teal hover:underline font-medium">{nameOf(partnerId)}</Link>
                        <span className="block text-xs text-faint">
                          {dayFmt.format(start)} {timeFmt.format(start)}
                          {' → '}
                          {end ? `${dayFmt.format(end)} ${timeFmt.format(end)}` : 'still together'}
                        </span>
                      </span>
                      {!p.ended_at && (
                        <span className="flex-none font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#34d399]/15 text-[#6ee7b7]">LIVE</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })()}

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
