'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Battery, Clock, ChevronRight, Cpu } from 'lucide-react'
import type { AssetWithLocation, AssetType } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { toolIsFresh } from '@/lib/tools-resolve'
import { deriveLiveStatus } from '@/lib/live-status'
import { createAssetAction } from '@/lib/actions/assets'
import { busy as trackBusy } from '@/lib/busy'
import { SearchInput, SortPills } from '@/components/ui/list-controls'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AssetForm, type AssetFormData, type NewPhoto, photosToFormData } from './AssetForm'

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}
const PILL_LABEL: Record<AssetType, string> = {
  vehicle: 'Vehicles', equipment: 'Equipment', personnel: 'Personnel', tool: 'Tools',
}
const TYPE_COLORS: Record<AssetType, string> = {
  vehicle: 'default', equipment: 'secondary', personnel: 'success', tool: 'outline',
} as Record<AssetType, 'default' | 'secondary' | 'success' | 'outline'>

interface AssetListProps {
  assets: AssetWithLocation[]
  /** Gateway id → # tools riding ("🔧 2 aboard" chip on trucks/machines). */
  toolCounts?: Record<string, number>
  /** Tool id → current/last carrier ("with Chevy 1500" chip on tools; stale
   *  sightings render as "last seen with", never a live custody claim). */
  carriers?: Record<string, { name: string; lastSeen: string }>
  /** Asset id → name of the zone it's sitting in ("at Creekside" meta line). */
  zoneNames?: Record<string, string>
  onAdd?: (data: AssetFormData) => void
}

type AssetSort = 'name' | 'seen' | 'type'
type AssetFilter = AssetType | 'all' | 'attention'

/** Coarse age for list rows — "45m", "2h", "3d". */
const coarseAge = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Live status for a list row — same brain the detail page uses (a parked
 *  tracker naps ~hourly, so only 6h+ silence is "No signal"), compacted to
 *  "Moving" / "Parked · 2h" / "No signal · 3d". */
function rowStatus(asset: AssetWithLocation) {
  const fixMs = asset.location ? Date.parse(asset.location.timestamp) : null
  const status = deriveLiveStatus({
    speedMph: asset.location?.speed ?? null,
    lastFixMs: fixMs,
    assetType: asset.type,
  })
  const age = fixMs != null ? Date.now() - fixMs : 0
  const label =
    status.key === 'moving' ? 'Moving'
      : status.key === 'idling' ? 'Idling'
        : status.key === 'stopped' ? 'Stopped'
          : status.key === 'parked' ? `Parked · ${coarseAge(age)}`
            : status.key === 'offline' ? `No signal · ${coarseAge(age)}`
              : 'No data'
  return { key: status.key, color: status.color, label }
}

/** "Needs attention" = overdue service, dead-silent tracker, or battery <15%. */
const needsAttention = (a: AssetWithLocation) =>
  (a.maintOverdue ?? 0) > 0 ||
  rowStatus(a).key === 'offline' ||
  (a.location?.battery != null && a.location.battery < 15)

export function AssetList({ assets, toolCounts, carriers, zoneNames, onAdd }: AssetListProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AssetSort>('name')
  const [typeFilter, setTypeFilter] = useState<AssetFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async (data: AssetFormData, photos?: NewPhoto[]) => {
    // Allow a parent to override persistence (e.g. tests / custom flows).
    if (onAdd) {
      onAdd(data)
      setShowForm(false)
      return
    }
    setSaving(true)
    setError(null)
    const doneBar = trackBusy('Saving asset…')
    try {
      // Blobs can't ride in a plain server-action argument — wrap in FormData.
      const photoForm = photosToFormData(photos ?? [])
      const result = await createAssetAction(data, photoForm)
      if (!result.ok) {
        // Keep the form open so nothing typed is lost — the message says why
        // (most commonly a tracker/tag ID that's already on another asset).
        setError(result.error ?? 'Could not save asset. Please try again.')
        return
      }
      setShowForm(false)
      router.refresh()
    } catch (err) {
      console.error('Failed to save asset', err)
      setError('Could not save asset. Please try again.')
    } finally {
      setSaving(false)
      doneBar()
    }
  }

  const seenMs = (a: AssetWithLocation) => (a.location ? new Date(a.location.timestamp).getTime() : 0)
  const q = query.toLowerCase()
  const matchesQuery = (a: AssetWithLocation) => {
    const vin = a.metadata?.vin
    return a.name.toLowerCase().includes(q) ||
      (a.tracker_id?.toLowerCase().includes(q) ?? false) ||
      (a.category?.toLowerCase().includes(q) ?? false) ||
      (a.serial?.toLowerCase().includes(q) ?? false) ||
      (typeof vin === 'string' && vin.toLowerCase().includes(q))
  }
  // Pill counts respect the search box, so "excavator" + the pills add up.
  const searched = assets.filter(matchesQuery)
  const pillCount = (t: AssetFilter) =>
    t === 'all' ? searched.length
      : t === 'attention' ? searched.filter(needsAttention).length
        : searched.filter(a => a.type === t).length
  const filtered = searched
    .filter(a =>
      typeFilter === 'all' ||
      (typeFilter === 'attention' ? needsAttention(a) : a.type === typeFilter))
    .sort((a, b) =>
      sort === 'seen' ? seenMs(b) - seenMs(a)
        : sort === 'type' ? a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name, undefined, { numeric: true }))

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-navy-800 space-y-3 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Assets</h1>
          <span className="text-sm text-faint">{assets.length} total</span>
          {/* Registering an asset and bringing a tracker online are different
              jobs — the hardware side has its own checklist and live status. */}
          <Button asChild size="sm" variant="outline" className="ml-auto gap-1">
            <Link href="/assets/onboard"><Cpu className="h-4 w-4" /> Hardware</Link>
          </Button>
          <Button size="sm" onClick={() => { setError(null); setShowForm(true) }} className="gap-1">
            <Plus className="h-4 w-4" /> Add Asset
          </Button>
        </div>

        {/* While the dialog is open the error renders INSIDE it (this banner
            was hiding behind the modal — a duplicate tracker ID looked like a
            dead Add button). Header banner only after the dialog closes. */}
        {error && !showForm && (
          <p className="text-xs text-alert bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, tracker, serial, VIN…" />
          <SortPills<AssetSort>
            options={[['name', 'A → Z'], ['seen', 'Last seen'], ['type', 'Type']]}
            value={sort}
            onChange={setSort}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {(['all', 'vehicle', 'equipment', 'personnel', 'tool', 'attention'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-amber text-[#1a1100]'
                  : 'bg-navy-800 text-muted hover:bg-navy-700'
              }`}
            >
              {t === 'all' ? 'All'
                : t === 'attention' ? '⚠ Needs attention'
                  : TYPE_EMOJI[t] + ' ' + PILL_LABEL[t]}
              {' '}{pillCount(t)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-navy-800 pb-32 md:pb-28">
        {filtered.length === 0 ? (
          assets.length === 0 ? (
            <div className="p-8 max-w-sm mx-auto text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-amber/10 border border-amber/25 grid place-items-center mb-3 text-2xl">🚛</div>
              <p className="text-ink font-display font-bold">Put your first machine on the map</p>
              <p className="text-sm text-faint mt-1.5 leading-relaxed">
                Add a truck, machine, or tagged tool with its tracker ID — it appears on the live map
                the moment the tracker reports.
              </p>
              <button
                onClick={() => { setError(null); setShowForm(true) }}
                className="mt-4 rounded-xl bg-amber text-[#1a1100] font-display font-bold text-sm px-5 py-2.5 hover:bg-amber-600 transition-colors"
              >
                + Add your first asset
              </button>
            </div>
          ) : (
            <div className="p-8 text-center text-faint">
              <p className="text-4xl mb-2">🔍</p>
              <p className="text-sm">Nothing matches that search or filter.</p>
            </div>
          )
        ) : (
          filtered.map(asset => (
            <AssetRow
              key={asset.id}
              asset={asset}
              toolCount={toolCounts?.[asset.id]}
              carrier={carriers?.[asset.id]}
              zoneName={zoneNames?.[asset.id]}
            />
          ))
        )}
      </div>

      {showForm && (
        <AssetForm
          onClose={() => setShowForm(false)}
          onSubmit={handleAdd}
          saving={saving}
          error={error}
        />
      )}
    </div>
  )
}

function AssetRow({ asset, toolCount, carrier, zoneName }: { asset: AssetWithLocation; toolCount?: number; carrier?: { name: string; lastSeen: string }; zoneName?: string }) {
  const status = rowStatus(asset)
  const battery = asset.location?.battery
  return (
    <Link href={`/assets/${asset.id}`} className="flex items-center gap-3 p-4 hover:bg-navy-800 transition-colors">
      {asset.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.photo_url} alt={asset.name} className="w-10 h-10 rounded-lg object-cover bg-navy-800 flex-shrink-0" />
      ) : (
        <div className="text-2xl w-10 h-10 flex items-center justify-center bg-navy-800 rounded-lg flex-shrink-0">
          {TYPE_EMOJI[asset.type]}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {/* Title row: name + type badge only. The aboard/carrier chips used to
            sit here as flex-shrink-0 siblings and squeezed the name down to a
            few characters — they live on the meta line now. */}
        <div className="flex items-center gap-2">
          <p className="font-medium text-ink truncate min-w-0 flex-1">{asset.name}</p>
          <Badge variant={TYPE_COLORS[asset.type] as 'default' | 'secondary' | 'success' | 'outline'}>
            {asset.type}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-faint min-w-0">
          {(toolCount ?? 0) > 0 && (
            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-[#a78bfa]/15 border border-[#a78bfa]/35 text-[#c4b5fd] text-[11px] font-semibold px-2 py-0.5">
              🔧 {toolCount} aboard
            </span>
          )}
          {carrier && (toolIsFresh(carrier.lastSeen) ? (
            <span className="inline-flex items-center rounded-full bg-[#60a5fa]/15 border border-[#60a5fa]/35 text-[#93c5fd] text-[11px] font-semibold px-2 py-0.5 max-w-[160px] truncate">
              with {carrier.name}
            </span>
          ) : (
            // No Bluetooth ping in 25+ min — it was LEFT somewhere. Say so
            // instead of claiming it's still riding the truck.
            <span className="inline-flex items-center rounded-full bg-navy-800/70 border border-navy-700 text-faint text-[11px] font-medium px-2 py-0.5 max-w-[180px] truncate">
              last seen with {carrier.name}
            </span>
          ))}
          {(asset.maintOverdue ?? 0) > 0 && (
            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-amber/15 border border-amber/35 text-amber text-[11px] font-semibold px-2 py-0.5">
              🛠 {asset.maintOverdue} overdue
            </span>
          )}
          {/* Place beats IMEI: "at Creekside" when inside a zone, otherwise
              the relative last-seen. Tracker ID stays searchable + on the
              detail page — it just doesn't lead the row anymore. */}
          {zoneName ? (
            <span className="truncate">at {zoneName}</span>
          ) : (
            asset.location?.timestamp && (
              <span className="flex items-center gap-0.5 flex-shrink-0" suppressHydrationWarning>
                <Clock className="h-3 w-3" />
                {formatRelativeTime(asset.location.timestamp)}
              </span>
            )
          )}
        </div>
      </div>
      {battery !== null && battery !== undefined && (
        <div className={`flex items-center gap-1 text-xs flex-shrink-0 ${
          battery < 15 ? 'text-alert' : battery < 30 ? 'text-amber' : 'text-muted'
        }`}>
          <Battery className="h-3 w-3" />
          {battery}%
        </div>
      )}
      {/* Real status from deriveLiveStatus — the old 30-min green/gray dot
          called every parked tracker's normal hourly nap "offline". */}
      <span
        className="text-[11px] font-semibold flex-shrink-0"
        style={{ color: status.color }}
        suppressHydrationWarning
      >
        {status.label}
      </span>
      <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />
    </Link>
  )
}
