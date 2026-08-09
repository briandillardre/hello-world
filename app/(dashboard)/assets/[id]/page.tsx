import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Wifi, MapPin, Wrench, Hash, Tag } from 'lucide-react'
import { getAssetsWithLocations, getAssetPhotos, ensureHeroInGallery } from '@/lib/db/assets'
import { getToolAssociations, resolveToolLocations, getPairingLog } from '@/lib/db/tools'
import { toolIsFresh } from '@/lib/tools-resolve'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { getMaintenanceSchedules, getCurrentReadings, computeStatus } from '@/lib/db/maintenance'
import type { AssetType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { CostCard } from '@/components/assets/CostCard'
import { AssetActions } from '@/components/assets/AssetActions'
import { ReassignTracker } from '@/components/assets/ReassignTracker'
import { AssetDiagnostics } from '@/components/assets/AssetDiagnostics'
import { TripLog } from '@/components/assets/TripLog'
import { getGeofences } from '@/lib/db/zones'
import { segmentTrips, type Trip } from '@/lib/trips'
import { DEFAULT_TZ } from '@/lib/dates'
import { cookies } from 'next/headers'
import { vehiclePower } from '@/lib/vehicle-power'
import { deriveLiveStatus } from '@/lib/live-status'
import { LiveStatusBadge } from '@/components/assets/LiveStatus'
import { FolderLink } from '@/components/ui/FolderLink'

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
    // Pull the legacy single hero into the gallery first, so an orphaned old
    // photo (e.g. a repurposed record's previous image) is visible + deletable.
    ensureHeroInGallery(companyId, asset.id, asset.photo_url ?? null).then(() => getAssetPhotos(asset.id)),
  ])
  const assetSchedules = schedules
    .filter((s) => s.asset_id === asset.id)
    .map((s) => ({ ...computeStatus(s, readings[s.asset_id] ?? s.last_service_value), name: s.description }))

  const loc = asset.location
  // Vercel renders in UTC — trip times format in the viewer's zone.
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)
  const meta = (asset.metadata ?? {}) as Record<string, unknown>
  const serial = asset.serial ?? (meta.serial ?? meta.serial_number ?? meta.vin) as string | undefined
  // Show every spec, but keep internal/UI-only keys out of the flat row list:
  // serial variants are shown above; `color` is a map setting; `cost_basis`
  // is the AI cost-assumption note rendered under the cost card.
  const detailRows = Object.entries(meta).filter(([k]) => !['serial', 'serial_number', 'vin', 'color', 'cost_basis'].includes(k))

  // Trip log: segment this asset's last 7 days of pings into drives, with
  // zone names anchoring each end ("Yard → Riverfront Tower"). Also drives the
  // live-status badge (today's idle + last-moved) up top.
  const isMockEnv = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
  const TRIP_DAYS = 7
  let trips: Trip[] | null = null
  let todayStats: { idleMin: number; movingMin: number; miles: number; maxMph: number; starts: number } | null = null
  let lastMovedMs: number | null = null
  if (!isMockEnv && (asset.type === 'vehicle' || asset.type === 'equipment' || asset.type === 'tool')) {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    // Page NEWEST-first so today survives the cap — a bare ascending .limit()
    // returned the OLDEST rows and cut today/yesterday off the trip log.
    const PAGE = 1000, CAP = 30_000
    const from = new Date(Date.now() - TRIP_DAYS * 86_400_000).toISOString()
    const [fences, rows] = await Promise.all([
      getGeofences(companyId),
      (async () => {
        // Tools: their week is stitched from the trucks that carried them
        // (pairing episodes) — same trip log a truck gets for those rides.
        if (asset.type === 'tool') {
          const { getToolWindowRows } = await import('@/lib/db/tools')
          return getToolWindowRows(asset.id, from, new Date().toISOString(), CAP)
        }
        const acc: { lat: number; lng: number; speed: number | null; timestamp: string; ignition?: boolean | null }[] = []
        while (acc.length < CAP) {
          const { data } = await supabase
            .from('asset_locations')
            .select('lat, lng, speed, timestamp, ignition')
            .eq('asset_id', asset.id)
            .gte('timestamp', from)
            .order('timestamp', { ascending: false })
            .range(acc.length, acc.length + PAGE - 1)
          if (!data || data.length === 0) break
          acc.push(...data)
          if (data.length < PAGE) break
        }
        return acc.reverse() // chronological
      })(),
    ])
    trips = segmentTrips(rows, fences)
    // Today's idle/moving + newest moving fix — for the live-status badge.
    const { computeRangeStats } = await import('@/lib/asset-stats')
    const { rangeWindow } = await import('@/lib/dates')
    const pts = rows.map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, ms: Date.parse(r.timestamp), ign: r.ignition ?? null })).filter((p) => Number.isFinite(p.ms))
    const w = rangeWindow(tz, 'today', {})
    const s = computeRangeStats(pts, w.from, w.to, pts[0]?.ms ?? null)
    todayStats = { idleMin: s.idleMin, movingMin: s.movingMin, miles: s.miles, maxMph: s.maxMph, starts: s.starts }
    for (let i = pts.length - 1; i >= 0; i--) { if ((pts[i].speed ?? 0) >= 2) { lastMovedMs = pts[i].ms; break } }
  }

  // Current status badge from the latest fix (+ engine voltage for vehicles).
  const enginePower = asset.type === 'vehicle' ? vehiclePower(loc?.raw) : { engineOn: null as boolean | null }
  const liveStatus = deriveLiveStatus({
    speedMph: loc?.speed ?? null,
    lastFixMs: loc?.timestamp ? Date.parse(loc.timestamp) : null,
    engineOn: enginePower.engineOn,
    lastMovedMs,
  })

  // Diagnostics "all signals seen" — the FULL set of fields this tracker has
  // emitted over the last week, each with its most-recent value + when. An
  // engine-off unit reports only position now, but RPM/coolant/fuel/DTCs show
  // up here from the last time it was running. Newest-first so the first time
  // we see a key is its latest value.
  let signalHistory: Record<string, { value: unknown; ts: string }> | undefined
  if (!isMockEnv && asset.tracker_id) {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: rows } = await supabase
      .from('asset_locations')
      .select('raw, timestamp')
      .eq('asset_id', asset.id)
      .gte('timestamp', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('timestamp', { ascending: false })
      .limit(3000)
    const hist: Record<string, { value: unknown; ts: string }> = {}
    for (const r of rows ?? []) {
      const rw = r.raw as Record<string, unknown> | null
      if (!rw) continue
      for (const [k, v] of Object.entries(rw)) {
        if (k === 'source' || v === null || v === undefined || v === '') continue
        if (!(k in hist)) hist[k] = { value: v, ts: r.timestamp as string }
      }
    }
    if (Object.keys(hist).length) signalHistory = hist
  }

  return (
    <div className="h-full overflow-auto pb-28 md:pb-10">
      {/* header — compact: the small MAIN PHOTO sits where the icon was, the
          back link shares the row, and every saved pixel is first-screen data
          (owner ask, Jul 16: "as much important info on first screen"). */}
      <div className="px-4 py-2 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <Link href="/assets" aria-label="All assets" className="flex-none grid place-items-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-navy-800">
            <ArrowLeft className="h-4.5 w-4.5" />
          </Link>
          {asset.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.photo_url} alt={asset.name} className="w-10 h-10 rounded-lg object-cover border border-navy-700 flex-none" />
          ) : (
            <div className="text-xl w-10 h-10 grid place-items-center bg-navy-800 rounded-lg flex-none">{TYPE_EMOJI[asset.type]}</div>
          )}
          <div className="min-w-0 flex-1 overflow-hidden">
            <h1 className="text-[15px] sm:text-lg font-bold text-ink leading-tight truncate">{asset.name}</h1>
            {/* overflow-hidden + wrap: badges used to paint OVER the action
                buttons on phones when the type + category didn't fit. */}
            <div className="flex flex-wrap items-center gap-1 mt-0.5 overflow-hidden">
              <Badge variant="secondary" className="whitespace-nowrap">{TYPE_LABEL[asset.type]}</Badge>
              {asset.category && <Badge variant="outline" className="max-w-full truncate">{asset.category}</Badge>}
            </div>
          </div>
          <div className="flex-none flex items-center gap-1.5">
            {canEdit && asset.tracker_id && (
              <ReassignTracker
                asset={asset}
                trackerlessAssets={assets.filter((a) => a.id !== asset.id && !a.tracker_id).map((a) => ({ id: a.id, name: a.name }))}
              />
            )}
            {canEdit && <AssetActions asset={asset} photos={assetPhotos} />}
            {/* phones: icon-only (the text version wrapped to 3 ugly lines) */}
            <Link href="/map" aria-label="View on map" className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm p-2.5 sm:px-3.5 sm:py-2 hover:bg-amber-600 transition-colors whitespace-nowrap">
              <MapPin className="h-4 w-4" /> <span className="hidden sm:inline">View on map</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-3xl space-y-5">
        {/* current status — one dense card: state, today's numbers, recap line */}
        <section className="rounded-xl border border-navy-800 bg-navy-900 p-3.5 space-y-2.5">
          <LiveStatusBadge
            status={liveStatus}
            idleTodayMin={todayStats?.idleMin}
            lastSeenMs={loc?.timestamp ? Date.parse(loc.timestamp) : null}
          />
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
            <MiniStat label="Speed" value={loc?.speed != null ? `${loc.speed}` : '—'} unit="mph" />
            <MiniStat label="Miles today" value={todayStats ? `${todayStats.miles}` : '—'} unit="mi" />
            <MiniStat label="Drive time" value={todayStats ? `${Math.floor(todayStats.movingMin / 60)}:${String(todayStats.movingMin % 60).padStart(2, '0')}` : '—'} unit="h" />
            <MiniStat label="Idle today" value={todayStats ? `${Math.floor(todayStats.idleMin / 60)}:${String(todayStats.idleMin % 60).padStart(2, '0')}` : '—'} unit="h" />
            <MiniStat label="Battery" value={loc?.battery != null ? `${loc.battery}` : '—'} unit="%" />
            {(() => {
              if (asset.type !== 'vehicle') return <MiniStat label="Starts today" value={todayStats ? `${todayStats.starts}` : '—'} />
              const p = vehiclePower(loc?.raw)
              return <MiniStat label={p.health === 'low' ? '12V · LOW' : p.health === 'weak' ? '12V · weak' : '12V battery'} value={p.volts != null ? p.volts.toFixed(1) : '—'} unit="V" />
            })()}
          </div>
          {/* today in one line — the writeup a foreman actually reads */}
          {todayStats && (
            <p className="text-[12px] text-muted leading-snug border-l-2 border-amber/50 pl-2">
              Today: {todayStats.miles >= 0.5
                ? `drove ${todayStats.miles} mi in ${trips?.filter((t) => new Date(t.startMs).toDateString() === new Date().toDateString()).length ?? '—'} trip(s), top ${todayStats.maxMph} mph, ${todayStats.starts} start${todayStats.starts === 1 ? '' : 's'}`
                : 'no driving recorded'}
              {todayStats.idleMin >= 15 ? ` · idled ${Math.floor(todayStats.idleMin / 60)}h ${String(todayStats.idleMin % 60).padStart(2, '0')}m` : ''}.
            </p>
          )}
          {loc && (
            <p className="text-[11px] text-faint">
              <MapPin className="inline h-3 w-3 mr-0.5" />{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
            </p>
          )}
        </section>

        {/* cost structure — dollar figures are permission-gated */}
        {perms.canViewCosts && (
          <div className="space-y-2">
            <CostCard asset={asset} />
            {typeof meta.cost_basis === 'string' && meta.cost_basis.trim() && (
              <p className="text-[11px] text-faint leading-snug px-1">
                <span className="text-teal font-semibold">✨ AI cost basis:</span> {meta.cost_basis}
              </p>
            )}
          </div>
        )}

        {/* full raw telemetry — collapsed, one tap from the glance stats above */}
        <section>
          <AssetDiagnostics raw={loc?.raw} timestamp={loc?.timestamp} history={signalHistory} />
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
                  // An open episode (no ended_at) is only "together" while the
                  // sighting is fresh. Arbitration never closes an episode when
                  // a tag simply goes silent (dropped on site, carrier drove
                  // off), so a stale open episode ends at last_seen — same
                  // clamp the map, trails, and hours ledger already apply
                  // (TL8 "left here" at Creekside yet LIVE with the Silverado
                  // in Easley, Aug 9).
                  const live = !p.ended_at && toolIsFresh(p.last_seen)
                  const end = p.ended_at ? new Date(p.ended_at) : live ? null : new Date(p.last_seen)
                  return (
                    <div key={p.id} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                      <Wifi className={'h-4 w-4 flex-none ' + (live ? 'text-[#34d399]' : 'text-faint')} />
                      <span className="flex-1 min-w-0">
                        <span className="text-ink font-medium">{verb} </span>
                        <Link href={`/assets/${partnerId}`} className="text-teal hover:underline font-medium">{nameOf(partnerId)}</Link>
                        <span className="block text-xs text-faint">
                          {dayFmt.format(start)} {timeFmt.format(start)}
                          {' → '}
                          {end ? `${dayFmt.format(end)} ${timeFmt.format(end)}` : 'still together'}
                          {!p.ended_at && !live && ' · signal lost'}
                        </span>
                      </span>
                      {live && (
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

        {/* photo gallery — ALL photos live down here (the header carries only a
            small thumbnail). Tap any to open full-size. */}
        {assetPhotos.length > 0 && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Photos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {assetPhotos.map((p, i) => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className={'relative rounded-lg border overflow-hidden group ' + (i === 0 ? 'border-amber/60' : 'border-navy-800')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={PHOTO_LABEL[p.label ?? ''] ?? p.label ?? 'Photo'} className="h-28 w-full object-cover transition-transform group-hover:scale-105" />
                  {i === 0 && <span className="absolute top-1 left-1 rounded bg-amber text-[#1a1100] text-[9px] font-bold px-1.5 py-0.5">★ MAIN</span>}
                  <span className="absolute bottom-0 inset-x-0 bg-navy-950/80 text-[10px] text-muted px-1.5 py-0.5 truncate">{PHOTO_LABEL[p.label ?? ''] ?? p.label ?? 'Photo'}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* document folder — link to Dropbox/Drive/etc. */}
        <FolderLink kind="asset" id={asset.id} initial={asset.folder_url ?? null} />

        {/* identity / hardware — reference info, kept at the bottom */}
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Identity &amp; hardware</h2>
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
            <Field icon={<Wifi className="h-4 w-4 text-[#60a5fa]" />} label="Tracker ID" value={asset.tracker_id ?? '—'} />
            <Field icon={<Hash className="h-4 w-4 text-faint" />} label="Serial number" value={serial ?? '— (add later)'} />
            {detailRows.map(([k, v]) => (
              <Field key={k} icon={<Tag className="h-4 w-4 text-faint" />} label={k.replace(/_/g, ' ')} value={String(v)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function MiniStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg bg-navy-800/70 py-1.5">
      <p className="font-display font-bold text-ink text-[15px] leading-none tabular-nums">
        {value}{unit && value !== '—' && <span className="text-[10px] text-faint font-normal ml-0.5">{unit}</span>}
      </p>
      <p className="text-[10px] text-faint mt-0.5">{label}</p>
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

