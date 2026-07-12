'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Battery, Zap, Clock, Wifi, ArrowRight, Crosshair, MapPin } from 'lucide-react'
import type { AssetWithLocation, AssetType } from '@/lib/types'
import { POI_KIND_META, type PoiKind } from '@/lib/poi'
import { formatRelativeTime } from '@/lib/utils'
import { vehiclePower } from '@/lib/vehicle-power'
import { Badge } from '@/components/ui/badge'
import { MapSheet } from './MapSheet'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const TYPE_LABELS: Record<AssetType, string> = {
  vehicle: 'Vehicle', equipment: 'Equipment', personnel: 'Personnel', tool: 'Small Tool',
}

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}

const BATTERY_COLOR = (pct: number | null) => {
  if (pct === null) return 'text-faint'
  if (pct > 50) return 'text-[#34d399]'
  if (pct > 20) return 'text-amber'
  return 'text-alert'
}

// Reverse-geocode cache — one lookup per ~100m cell, shared across opens.
const placeCache = new Map<string, string>()
// Nearest-POI cache (stopped assets): "Sherwin-Williams · paint" beats coords.
const poiCache = new Map<string, string>()

/** What named place is this parked asset AT? Free Photon (OSM) reverse
 *  lookup — supplier, restaurant, DMV… the "2-hour lunch vs. parts run"
 *  context. Only queried while stopped; skips unnamed/residential hits. */
function usePoiName(lat?: number, lng?: number, stopped?: boolean): string | null {
  const [poi, setPoi] = useState<string | null>(null)
  useEffect(() => {
    if (lat == null || lng == null || !stopped) { setPoi(null); return }
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
    if (poiCache.has(key)) { setPoi(poiCache.get(key) ?? null); return }
    let cancelled = false
    fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const p = j?.features?.[0]?.properties
        const boring = ['house', 'residential', 'yes', 'detached', 'apartments']
        const label = p?.name && !boring.includes(p?.osm_value)
          ? `${p.name}${p.osm_value && !['company', 'office'].includes(p.osm_value) ? ` · ${String(p.osm_value).replace(/_/g, ' ')}` : ''}`
          : ''
        poiCache.set(key, label)
        setPoi(label || null)
      })
      .catch(() => { /* offline */ })
    return () => { cancelled = true }
  }, [lat, lng, stopped])
  return poi
}

function usePlaceName(lat?: number, lng?: number): string | null {
  const [place, setPlace] = useState<string | null>(null)
  useEffect(() => {
    if (lat == null || lng == null) { setPlace(null); return }
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`
    const hit = placeCache.get(key)
    if (hit) { setPlace(hit); return }
    let cancelled = false
    // Free, keyless, CORS-open reverse geocoder (BigDataCloud client API).
    fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return
        const city = j.city || j.locality
        const state = typeof j.principalSubdivisionCode === 'string' && j.principalSubdivisionCode.includes('-')
          ? j.principalSubdivisionCode.split('-').pop()
          : j.principalSubdivision
        const label = [city, state].filter(Boolean).join(', ')
        if (label) { placeCache.set(key, label); setPlace(label) }
      })
      .catch(() => { /* offline — coords alone still show */ })
    return () => { cancelled = true }
  }, [lat, lng])
  return place
}

interface RangeStat {
  key: string; label: string; miles: number; maxMph: number
  movingMin: number; idleMin: number; parkedMin: number; starts: number; fuelGalEst: number
}

const dur = (min: number) =>
  min <= 0 ? '—'
  : min >= 2880 ? `${Math.floor(min / 1440)}d ${Math.round((min % 1440) / 60)}h`
  : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m`
  : `${min}m`

const RANGE_SHORT: Record<string, string> = {
  today: 'Today', yesterday: 'Yest', '7d': '7 days', '30d': '30 days', ytd: 'YTD', all: 'All',
}

// One range at a time, picked by chip — six columns of numbers could never
// breathe in a 250px panel, and this reads like a dashboard instead.
const METRICS: { label: string; fmt: (r: RangeStat) => string; accent?: boolean }[] = [
  { label: 'Distance', fmt: (r) => (r.miles ? `${r.miles.toLocaleString()} mi` : '—'), accent: true },
  { label: 'Top speed', fmt: (r) => (r.maxMph ? `${r.maxMph} mph` : '—') },
  { label: 'Moving', fmt: (r) => dur(r.movingMin) },
  { label: 'Idle', fmt: (r) => dur(r.idleMin) },
  { label: 'Parked', fmt: (r) => dur(r.parkedMin) },
  { label: 'Fuel est.*', fmt: (r) => (r.fuelGalEst ? `${r.fuelGalEst} gal` : '—') },
  { label: 'Starts', fmt: (r) => (r.starts ? String(r.starts) : '—') },
]

interface StatsPayload { ranges: RangeStat[]; mpg: number; lastMovedIso: string | null; movingNow: boolean }

function useAssetStats(assetId: string, enabled: boolean): StatsPayload | null {
  const [stats, setStats] = useState<StatsPayload | null>(null)
  useEffect(() => {
    setStats(null)
    if (!enabled || isMock) return
    const ctrl = new AbortController()
    fetch(`/api/asset-stats?asset=${assetId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && Array.isArray(j.ranges) && j.ranges.length) setStats({ ranges: j.ranges, mpg: j.mpg ?? 15, lastMovedIso: j.lastMovedIso ?? null, movingNow: !!j.movingNow }) })
      .catch(() => { /* aborted / offline */ })
    return () => ctrl.abort()
  }, [assetId, enabled])
  return stats
}

interface AssetPanelProps {
  asset: AssetWithLocation
  gateway?: { name: string; lastSeen: string }
  /** Isolate mode: the map shows only this asset (dot + trails). */
  isolated?: boolean
  onToggleIsolate?: () => void
  onClose: () => void
}

export function AssetPanel({ asset, gateway, isolated = false, onToggleIsolate, onClose }: AssetPanelProps) {
  const loc = asset.location
  const meta = asset.metadata ?? {}

  return (
    <MapSheet
      icon={<span className="text-2xl">{TYPE_EMOJI[asset.type]}</span>}
      title={asset.name}
      badge={<Badge variant="secondary">{TYPE_LABELS[asset.type]}</Badge>}
      onClose={onClose}
    >
      <AssetDetails asset={asset} loc={loc} meta={meta} gateway={gateway} isolated={isolated} onToggleIsolate={onToggleIsolate} />
    </MapSheet>
  )
}

function AssetDetails({
  asset,
  loc,
  meta,
  gateway,
  isolated,
  onToggleIsolate,
}: {
  asset: AssetWithLocation
  loc: AssetWithLocation['location']
  meta: Record<string, unknown>
  gateway?: { name: string; lastSeen: string }
  isolated: boolean
  onToggleIsolate?: () => void
}) {
  const place = usePlaceName(loc?.lat, loc?.lng)
  const poi = usePoiName(loc?.lat, loc?.lng, (loc?.speed ?? 0) < 2)
  // Range mileage table only makes sense for assets that actually move.
  const stats = useAssetStats(asset.id, asset.type === 'vehicle' || asset.type === 'equipment')

  return (
    <div className="space-y-3">
      {asset.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.photo_url}
          alt={asset.name}
          className="w-full h-36 object-cover rounded-xl border border-navy-800"
        />
      )}
      {asset.type === 'tool' && gateway && (
        <div className="bg-[#60a5fa]/15 border border-[#60a5fa]/30 rounded-lg p-3 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-[#60a5fa] flex-shrink-0" />
          <div className="text-sm">
            <span className="text-[#93c5fd]">Currently with </span>
            <span className="font-semibold text-[#93c5fd]">{gateway.name}</span>
            <span className="text-[#60a5fa] text-xs"> · {formatRelativeTime(gateway.lastSeen)}</span>
          </div>
        </div>
      )}
      {/* Where it IS, up top — city/state, plus the named place when parked
          somewhere recognizable. (The coordinates stay in the footer.) */}
      {(place || poi) && (
        <div className="bg-navy-800 rounded-lg px-3 py-2 flex items-start gap-2">
          <MapPin className="h-4 w-4 text-teal flex-none mt-0.5" />
          <div className="min-w-0 text-[13px] leading-snug">
            {place && <span className="text-ink font-semibold">{place}</span>}
            {poi && <span className="block text-teal text-[12px] truncate">at {poi}</span>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {loc?.battery !== null && loc?.battery !== undefined && (
          <StatTile
            icon={<Battery className={`h-4 w-4 ${BATTERY_COLOR(loc.battery)}`} />}
            label="Battery"
            value={`${loc.battery}%`}
          />
        )}
        {loc?.speed !== null && loc?.speed !== undefined && (
          <StatTile
            icon={<Zap className="h-4 w-4 text-amber" />}
            label="Speed"
            value={`${loc.speed} mph`}
          />
        )}
        {loc?.timestamp && (
          <StatTile
            icon={<Clock className="h-4 w-4 text-faint" />}
            label="Last Seen"
            value={formatRelativeTime(loc.timestamp)}
          />
        )}
        {onToggleIsolate && (
          <button
            onClick={onToggleIsolate}
            className={
              'rounded-lg p-3 flex items-start gap-2 text-left transition-colors border ' +
              (isolated
                ? 'bg-amber/15 border-amber/40'
                : 'bg-navy-800 border-transparent hover:bg-navy-700')
            }
          >
            <Crosshair className={'h-4 w-4 ' + (isolated ? 'text-amber' : 'text-teal')} />
            <span>
              <span className={'block text-xs ' + (isolated ? 'text-amber' : 'text-faint')}>Isolate</span>
              <span className="block text-sm font-semibold text-ink">{isolated ? 'On · only this one' : 'Only show this'}</span>
            </span>
          </button>
        )}
      </div>

      <EngineWidget asset={asset} />

      <SpecSheet meta={meta} mpg={stats?.mpg} />

      {stats && <ActivityCard stats={stats.ranges} mpg={stats.mpg} lastMovedIso={stats.lastMovedIso} movingNow={stats.movingNow} />}

      {(asset.type === 'vehicle' || asset.type === 'equipment') && <StopsCard assetId={asset.id} />}

      {typeof meta.notes === 'string' && meta.notes.trim() !== '' && (
        <div className="bg-navy-800 rounded-lg p-3">
          <p className="text-xs font-semibold text-faint uppercase tracking-wider mb-1.5">Notes</p>
          <p className="text-[12.5px] text-muted whitespace-pre-line leading-snug">{meta.notes}</p>
        </div>
      )}

      {Object.keys(meta).length > 0 && (
        <div className="bg-navy-800 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-faint uppercase tracking-wider mb-2">Details</p>
          {Object.entries(meta).filter(([k]) => !SPEC_ROWS.some(([sk]) => sk === k) && k !== 'specs' && k !== 'notes').map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-muted capitalize">{k.replace(/_/g, ' ')}</span>
              <span className="text-ink font-medium">{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {loc && (
        <div className="text-xs text-faint text-center space-y-0.5">
          {poi && <p className="text-teal font-medium">📍 at {poi}</p>}
          <p>
            {place && <span className="text-muted font-medium">{place} · </span>}
            {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
            {loc.accuracy && ` ±${loc.accuracy}m`}
          </p>
        </div>
      )}

      <Link
        href={`/assets/${asset.id}`}
        className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-navy-800 border border-navy-700 text-ink text-sm font-medium py-2.5 hover:bg-navy-700 transition-colors"
      >
        View full details <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

/** Spec sheet — what we know about the machine, one glance. VIN-decoded
 *  values, hand-entered service specs, AI value range, estimated economy. */
const SPEC_ROWS: [string, string][] = [
  ['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['trim', 'Trim'],
  ['body', 'Body'], ['engine', 'Engine'], ['horsepower', 'Horsepower'],
  ['fuel', 'Fuel'], ['drive', 'Drive'], ['gvwr', 'GVWR'],
  ['oil', 'Oil'], ['oil_filter', 'Oil filter'], ['air_filter', 'Air filter'],
  ['tires', 'Tires'], ['value_range', 'Market value*'],
]
function SpecSheet({ meta, mpg }: { meta: Record<string, unknown>; mpg?: number }) {
  const src = ((meta.specs as Record<string, unknown> | undefined) ?? meta)
  const rows = SPEC_ROWS.filter(([k]) => src[k] != null && String(src[k]).trim() !== '')
  if (!rows.length && !mpg) return null
  return (
    <div className="bg-navy-800 rounded-lg p-3">
      <p className="text-xs font-semibold text-faint uppercase tracking-wider mb-2">Specs</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map(([k, label]) => (
          <div key={k} className="flex justify-between text-xs gap-2 min-w-0">
            <span className="text-muted flex-none">{label}</span>
            <span className="text-ink font-medium truncate">{String(src[k])}</span>
          </div>
        ))}
        {mpg != null && (
          <div className="flex justify-between text-xs gap-2">
            <span className="text-muted">Economy</span>
            <span className="text-ink font-medium">~{mpg} mpg est.</span>
          </div>
        )}
      </div>
      {src.value_range != null && (
        <p className="mt-1.5 text-[10px] text-faint">*AI-estimated range — not an appraisal.</p>
      )}
    </div>
  )
}

/** Classified stop log: where it stopped, how long, what kind of place —
 *  supplier run vs DMV morning vs two-hour lunch, at a glance. */
function StopsCard({ assetId }: { assetId: string }) {
  const [range, setRange] = useState<'today' | 'yesterday' | '7d'>('today')
  const [data, setData] = useState<{ stops: { fromMs: number; toMs: number; minutes: number; name: string; kind: PoiKind }[]; tz: string } | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (isMock) return
    setLoading(true)
    const ctrl = new AbortController()
    fetch(`/api/stops?asset=${assetId}&range=${range}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setData(j); setLoading(false) })
      .catch(() => setLoading(false))
    return () => ctrl.abort()
  }, [assetId, range])
  if (isMock) return null
  const fmtT = (ms: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone: data?.tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
  return (
    <div className="bg-navy-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-faint uppercase tracking-wider">Stops</p>
        <div className="flex gap-1">
          {(['today', 'yesterday', '7d'] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={'px-2 py-0.5 rounded-md text-[10.5px] font-semibold ' + (range === r ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')}>
              {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yest' : '7 days'}
            </button>
          ))}
        </div>
      </div>
      {loading && !data ? (
        <p className="text-xs text-faint">Reading the day…</p>
      ) : !data?.stops.length ? (
        <p className="text-xs text-faint">No stops of 5+ minutes in this range.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.stops.map((st, i) => {
            const meta = POI_KIND_META[st.kind] ?? POI_KIND_META.other
            return (
              <li key={i} className="flex items-center gap-2 text-xs min-w-0">
                <span className="font-mono text-faint tabular-nums flex-none">{fmtT(st.fromMs)}</span>
                <span className="text-ink font-medium truncate flex-1">{st.name}</span>
                <span className={'flex-none rounded-full border px-1.5 py-px text-[9.5px] font-semibold ' + meta.cls}>{meta.label}</span>
                <span className="font-mono text-muted tabular-nums flex-none">
                  {st.minutes >= 60 ? `${Math.floor(st.minutes / 60)}h ${String(st.minutes % 60).padStart(2, '0')}m` : `${st.minutes}m`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Activity dashboard: pick a range with a chip, read big legible stats.
 *  Distance leads (the number a contractor asks for first). */
function ActivityCard({ stats, mpg, lastMovedIso, movingNow }: {
  stats: RangeStat[]; mpg: number; lastMovedIso: string | null; movingNow: boolean
}) {
  const parkedLabel = movingNow
    ? 'Moving right now'
    : lastMovedIso
      ? 'Parked since ' + new Date(lastMovedIso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      : null
  const [rangeKey, setRangeKey] = useState(stats[0]?.key ?? 'today')
  const r = stats.find((s) => s.key === rangeKey) ?? stats[0]
  if (!r) return null
  return (
    <div className="bg-navy-800 rounded-lg p-3">
      <p className="text-xs font-semibold text-faint uppercase tracking-wider mb-2">Activity</p>
      <div className="flex gap-1 mb-3 overflow-x-auto no-scrollbar -mx-0.5 px-0.5">
        {stats.map((s) => (
          <button
            key={s.key}
            onClick={() => setRangeKey(s.key)}
            className={
              'flex-none px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ' +
              (s.key === r.key ? 'bg-amber/20 text-amber' : 'bg-navy-900 text-faint hover:text-ink')
            }
          >
            {RANGE_SHORT[s.key] ?? s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {METRICS.map((m) => (
          <div key={m.label}>
            <p className={'font-display font-bold text-[15px] tabular-nums leading-tight ' + (m.accent ? 'text-amber' : 'text-ink')}>
              {m.fmt(r)}
            </p>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[10px] text-faint border-t border-navy-700/50 pt-2">
        {parkedLabel && <span className={'block mb-1 font-mono text-[11px] tracking-wide ' + (movingNow ? 'text-teal' : 'text-muted')}>{parkedLabel}</span>}
        *fuel estimated at {mpg} mpg + idle burn until OBD fuel data is wired
      </p>
    </div>
  )
}

/** Cockpit strip: engine + tracker vitals off the latest ping's raw
 *  telemetry — RPM, fuel, 12V, tracker odometer, altitude. Renders only
 *  when the device actually served something (real OBD units). */
function EngineWidget({ asset }: { asset: AssetWithLocation }) {
  const raw = (asset.location?.raw ?? null) as Record<string, unknown> | null
  if (!raw || asset.type === 'tool' || asset.type === 'personnel') return null
  const num = (k: string) => (typeof raw[k] === 'number' && Number.isFinite(raw[k] as number) ? (raw[k] as number) : null)

  const p = vehiclePower(raw)
  const rpm = num('obd.rpm') ?? num('can.engine.rpm')
  const fuelPct = num('fuel.level')
  const altM = num('position.altitude')
  // Teltonika total odometer arrives in meters — distance the TRACKER has
  // seen, not the dash odometer.
  const odoM = num('vehicle.mileage') ?? num('can.vehicle.mileage')
  if (rpm == null && fuelPct == null && altM == null && odoM == null && p.volts == null && p.engineOn == null) return null

  const cells: { label: string; value: string; accent?: string }[] = []
  if (p.engineOn != null) cells.push({ label: 'Engine', value: p.engineOn ? 'RUNNING' : 'OFF', accent: p.engineOn ? 'text-[#34d399]' : 'text-faint' })
  if (rpm != null) cells.push({ label: 'RPM', value: rpm.toLocaleString() })
  if (fuelPct != null) cells.push({ label: 'Fuel', value: `${Math.round(fuelPct)}%`, accent: fuelPct < 15 ? 'text-alert' : undefined })
  if (p.volts != null) cells.push({ label: '12V batt', value: `${p.volts.toFixed(1)} V`, accent: p.health === 'low' ? 'text-alert' : p.health === 'weak' ? 'text-amber' : undefined })
  if (odoM != null) cells.push({ label: 'Odo (tracker)', value: `${Math.round(odoM / 1609.34).toLocaleString()} mi` })
  if (altM != null) cells.push({ label: 'Altitude', value: `${Math.round(altM * 3.28084).toLocaleString()} ft` })

  return (
    <div className="rounded-xl border border-navy-700 bg-gradient-to-b from-navy-800 to-navy-900 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {p.engineOn && <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-blink" />}
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-teal">Engine · live</p>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
        {cells.map((c) => (
          <div key={c.label}>
            <p className={'font-display font-bold text-[15px] tabular-nums ' + (c.accent ?? 'text-ink')}>{c.value}</p>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-navy-800 rounded-lg p-3 flex items-start gap-2">
      {icon}
      <div>
        <p className="text-xs text-faint">{label}</p>
        <p className="text-sm font-semibold text-ink">{value}</p>
      </div>
    </div>
  )
}
