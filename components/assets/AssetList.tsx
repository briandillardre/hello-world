'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Battery, Clock, ChevronRight, ScanLine, Table2, MapPin } from 'lucide-react'
import type { AssetWithLocation, AssetType } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { toolIsFresh } from '@/lib/tools-resolve'
import { deriveLiveStatus } from '@/lib/live-status'
import { placeKey } from '@/lib/place-label'
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
  /** Asset id → name of the zone it's sitting in ("at Creekside"). */
  zoneNames?: Record<string, string>
  /** Asset id → place label for rows outside every zone, from what the
   *  geocode cache already knew at render ("near 304 N Church St, Greenville"
   *  / "in Greenville, SC"). Rows missing here are asked for client-side. */
  placeNames?: Record<string, string>
  onAdd?: (data: AssetFormData) => void
}

type AssetSort = 'name' | 'seen' | 'type'
type AssetFilter = AssetType | 'all' | 'attention' | 'untracked'

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

export function AssetList({ assets, toolCounts, carriers, zoneNames, placeNames, onAdd }: AssetListProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AssetSort>('name')
  const [typeFilter, setTypeFilter] = useState<AssetFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // "Where is it" for rows outside every zone (Brian, Sep 4: zone → close
  // address → city, state). The server hands over what the cache already
  // knew; anything new is asked here in one batch per load and fills in as
  // it arrives. Keys already asked this load are not asked again (a cell the
  // geocoder could not answer stays blank until the next visit).
  const [places, setPlaces] = useState<Record<string, string>>({})
  const asked = useRef(new Set<string>())
  const pendingKeys = Array.from(new Set(assets
    .filter((a) => a.location && !zoneNames?.[a.id] && !placeNames?.[a.id] && !(a.id in places))
    .map((a) => placeKey(a.location!.lat, a.location!.lng)))).filter((k) => !asked.current.has(k))
  const pendingSig = pendingKeys.join(';')
  useEffect(() => {
    if (!pendingSig) return
    const keys = pendingSig.split(';')
    for (const k of keys) asked.current.add(k)
    let cancelled = false
    const run = async () => {
      const found: Record<string, string | null> = {}
      for (let i = 0; i < keys.length; i += 100) {
        try {
          const r = await fetch(`/api/reverse-geocode?pts=${keys.slice(i, i + 100).join(';')}`)
          if (!r.ok) continue
          const j = (await r.json()) as { places?: Record<string, string | null> }
          Object.assign(found, j.places ?? {})
        } catch { /* offline — the row keeps its time stamp */ }
      }
      if (cancelled) return
      setPlaces((prev) => {
        const next = { ...prev }
        for (const a of assets) {
          if (!a.location || next[a.id] !== undefined) continue
          const k = placeKey(a.location.lat, a.location.lng)
          if (k in found) next[a.id] = found[k] ?? ''
        }
        return next
      })
    }
    run()
    return () => { cancelled = true }
  }, [pendingSig, assets])
  /** "at <zone>" first, then the geocoded label; null while unknown. */
  const whereOf = (a: AssetWithLocation): string | null => {
    const zone = zoneNames?.[a.id]
    if (zone) return `at ${zone}`
    return placeNames?.[a.id] || places[a.id] || null
  }

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
      (whereOf(a)?.toLowerCase().includes(q) ?? false) ||
      (a.tracker_id?.toLowerCase().includes(q) ?? false) ||
      (a.category?.toLowerCase().includes(q) ?? false) ||
      (crewOf(a)?.toLowerCase().includes(q) ?? false) ||
      (a.serial?.toLowerCase().includes(q) ?? false) ||
      (typeof vin === 'string' && vin.toLowerCase().includes(q))
  }
  // Pill counts respect the search box, so "excavator" + the pills add up.
  const searched = assets.filter(matchesQuery)
  const pillCount = (t: AssetFilter) =>
    t === 'all' ? searched.length
      : t === 'attention' ? searched.filter(needsAttention).length
        : t === 'untracked' ? searched.filter(a => !a.tracker_id).length
          : searched.filter(a => a.type === t).length
  const filtered = searched
    .filter(a =>
      typeFilter === 'all' ||
      (typeFilter === 'attention' ? needsAttention(a)
        : typeFilter === 'untracked' ? !a.tracker_id
          : a.type === typeFilter))
    .sort((a, b) =>
      sort === 'seen' ? seenMs(b) - seenMs(a)
        : sort === 'type' ? a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name, undefined, { numeric: true }))

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 sm:p-4 border-b border-navy-800 space-y-2.5 sm:space-y-3 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-bold text-ink">Assets</h1>
          <span className="text-xs sm:text-sm text-faint">{assets.length} total</span>
          {/* Labels hide below sm — four items in this row clipped the Add
              button off-screen at 360px widths (header can't scroll). The
              two bulk doors: a box in your hand → Scan · a list in a
              spreadsheet → Bulk add. */}
          <Button asChild size="sm" variant="outline" className="ml-auto gap-1">
            <Link href="/assets/import" aria-label="Bulk add from a spreadsheet" title="Bulk add from a spreadsheet">
              <Table2 className="h-4 w-4" /><span className="hidden lg:inline">Bulk add</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1">
            <Link href="/assets/scan" aria-label="Scan trackers" title="Scan trackers">
              <ScanLine className="h-4 w-4" /><span className="hidden sm:inline">Scan trackers</span>
            </Link>
          </Button>
          <Button size="sm" onClick={() => { setError(null); setShowForm(true) }} className="gap-1" aria-label="Add asset" title="Add asset">
            <Plus className="h-4 w-4" /><span className="hidden sm:inline">Add Asset</span>
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
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, place, tracker, serial, VIN…" />
          <SortPills<AssetSort>
            options={[['name', 'A → Z'], ['seen', 'Last seen'], ['type', 'Type']]}
            value={sort}
            onChange={setSort}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {(['all', 'vehicle', 'equipment', 'personnel', 'tool', 'attention', 'untracked'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`flex-shrink-0 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-[11px] sm:text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-amber text-[#1a1100]'
                  : 'bg-navy-800 text-muted hover:bg-navy-700'
              }`}
            >
              {t === 'all' ? 'All'
                : t === 'attention' ? '⚠ Needs attention'
                  : t === 'untracked' ? '📵 No tracker'
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
              where={whereOf(asset)}
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
          crewOptions={Array.from(new Set(assets.map((a) => crewOf(a)).filter(Boolean) as string[])).sort()}
        />
      )}
    </div>
  )
}

/** metadata.crew, or null. */
const crewOf = (a: { metadata?: Record<string, unknown> | null }): string | null =>
  typeof a.metadata?.crew === 'string' && a.metadata.crew ? (a.metadata.crew as string) : null

function AssetRow({ asset, toolCount, carrier, where }: { asset: AssetWithLocation; toolCount?: number; carrier?: { name: string; lastSeen: string }; where: string | null }) {
  const status = rowStatus(asset)
  const battery = asset.location?.battery
  const fixIso = asset.location?.timestamp
  const fixMs = fixIso ? Date.parse(fixIso) : NaN
  // Past a day, "22d ago" stops being useful — a dead tracker's row says
  // exactly when it last spoke (Brian: absolute last-seen on the list).
  const stale = Number.isFinite(fixMs) && Date.now() - fixMs > 24 * 3_600_000
  const fixLabel = !fixIso ? null
    : stale ? new Date(fixMs).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : formatRelativeTime(fixIso)
  // No tracker ID = nothing can ever put this asset on the map. Make the row
  // obviously different (Brian, Sep 4) instead of a quiet "No data".
  const untracked = !asset.tracker_id
  return (
    <Link
      href={`/assets/${asset.id}`}
      className={
        'flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 transition-colors ' +
        (untracked ? 'bg-amber/[0.07] border-l-[3px] border-l-amber hover:bg-amber/[0.12]' : 'hover:bg-navy-800')
      }
    >
      {asset.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.photo_url} alt={asset.name} className="w-10 h-10 rounded-lg object-cover bg-navy-800 flex-shrink-0" />
      ) : (
        <div className="text-xl w-10 h-10 flex items-center justify-center bg-navy-800 rounded-lg flex-shrink-0">
          {TYPE_EMOJI[asset.type]}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {/* Phone density (Brian, Sep 3: "shrink font — it needs to show more
            info and be more readable"): 13px name over two full lines, the
            type badge only from sm up (the meta line carries it on phones),
            and status + battery stacked in ONE right-hand column so the name
            keeps the width. A 360px phone used to fit "2003 Chevrolet…". */}
        <div className="flex items-start gap-2">
          <p className="font-semibold text-ink text-[13px] sm:text-sm min-w-0 flex-1 line-clamp-2 leading-tight">{asset.name}</p>
          <Badge className="hidden sm:inline-flex" variant={TYPE_COLORS[asset.type] as 'default' | 'secondary' | 'success' | 'outline'}>
            {asset.type}
          </Badge>
        </div>
        {/* Where it is, on its own line (Brian, Sep 4: "easily and quickly
            see where each asset is"): the zone it sits in, else the nearest
            address, else the city and state. Nothing while unknown — a fix
            with no words yet is not a claim. */}
        {where && (
          <p className="flex items-center gap-1 mt-0.5 text-[12px] leading-snug text-ink/90 min-w-0">
            <MapPin className="h-3 w-3 text-teal flex-shrink-0" />
            <span className="truncate">{where}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] leading-snug text-faint min-w-0">
          <span className="sm:hidden uppercase tracking-wide text-[10px] font-semibold text-muted">{asset.type}</span>
          {untracked && (
            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-amber/15 border border-amber/50 text-amber text-[10px] font-semibold px-1.5 py-px">
              📵 No tracker
            </span>
          )}
          {(toolCount ?? 0) > 0 && (
            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-[#a78bfa]/15 border border-[#a78bfa]/35 text-[#c4b5fd] text-[10px] font-semibold px-1.5 py-px">
              🔧 {toolCount} aboard
            </span>
          )}
          {carrier && (toolIsFresh(carrier.lastSeen) ? (
            <span className="inline-flex items-center rounded-full bg-[#60a5fa]/15 border border-[#60a5fa]/35 text-[#93c5fd] text-[10px] font-semibold px-1.5 py-px max-w-full truncate">
              with {carrier.name}
            </span>
          ) : (
            // No Bluetooth ping in 25+ min — it was LEFT somewhere. Say so
            // instead of claiming it's still riding the truck.
            <span className="inline-flex items-center rounded-full bg-navy-800/70 border border-navy-700 text-faint text-[10px] font-medium px-1.5 py-px max-w-full truncate">
              last seen with {carrier.name}
            </span>
          ))}
          {(asset.maintOverdue ?? 0) > 0 && (
            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-amber/15 border border-amber/35 text-amber text-[10px] font-semibold px-1.5 py-px">
              🛠 {asset.maintOverdue} overdue
            </span>
          )}
          {/* Time of the last fix (place is the line above). Tracker ID stays
              searchable + on the detail page. */}
          {crewOf(asset) && <span className="min-w-0 max-w-full truncate text-teal">👷 {crewOf(asset)}</span>}
          {fixLabel && (
            <span className="flex items-center gap-0.5 flex-shrink-0" suppressHydrationWarning>
              <Clock className="h-3 w-3" />
              {fixLabel}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0 text-right">
        {/* Real status from deriveLiveStatus — the old 30-min green/gray dot
            called every parked tracker's normal hourly nap "offline". */}
        <span
          className="text-[11px] font-semibold whitespace-nowrap"
          style={{ color: status.color }}
          suppressHydrationWarning
        >
          {status.label}
        </span>
        {battery !== null && battery !== undefined && (
          <span className={`flex items-center gap-0.5 text-[11px] ${
            battery < 15 ? 'text-alert' : battery < 30 ? 'text-amber' : 'text-muted'
          }`}>
            <Battery className="h-3 w-3" />
            {battery}%
          </span>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />
    </Link>
  )
}
