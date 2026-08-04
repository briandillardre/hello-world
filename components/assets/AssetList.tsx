'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Battery, Clock, ChevronRight } from 'lucide-react'
import type { AssetWithLocation, AssetType } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { createAssetAction } from '@/lib/actions/assets'
import { SearchInput, SortPills } from '@/components/ui/list-controls'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AssetForm, type AssetFormData, type NewPhoto, photosToFormData } from './AssetForm'

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}
const TYPE_COLORS: Record<AssetType, string> = {
  vehicle: 'default', equipment: 'secondary', personnel: 'success', tool: 'outline',
} as Record<AssetType, 'default' | 'secondary' | 'success' | 'outline'>

interface AssetListProps {
  assets: AssetWithLocation[]
  /** Gateway id → # tools riding ("🔧 2 aboard" chip on trucks/machines). */
  toolCounts?: Record<string, number>
  /** Tool id → carrier name ("with Chevy 1500" chip on tools). */
  carriers?: Record<string, string>
  onAdd?: (data: AssetFormData) => void
}

type AssetSort = 'name' | 'seen' | 'type'

export function AssetList({ assets, toolCounts, carriers, onAdd }: AssetListProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AssetSort>('name')
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all')
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
    }
  }

  const seenMs = (a: AssetWithLocation) => (a.location ? new Date(a.location.timestamp).getTime() : 0)
  const filtered = assets
    .filter(a => {
      const q = query.toLowerCase()
      const matchesQ = a.name.toLowerCase().includes(q) ||
        (a.tracker_id?.toLowerCase().includes(q) ?? false) ||
        (a.category?.toLowerCase().includes(q) ?? false)
      const matchesType = typeFilter === 'all' || a.type === typeFilter
      return matchesQ && matchesType
    })
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
          <Button size="sm" onClick={() => setShowForm(true)} className="ml-auto gap-1">
            <Plus className="h-4 w-4" /> Add Asset
          </Button>
        </div>

        {error && (
          <p className="text-xs text-alert bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={query} onChange={setQuery} placeholder="Search assets or tracker ID…" />
          <SortPills<AssetSort>
            options={[['name', 'A → Z'], ['seen', 'Last seen'], ['type', 'Type']]}
            value={sort}
            onChange={setSort}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {(['all', 'vehicle', 'equipment', 'personnel', 'tool'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-amber text-[#1a1100]'
                  : 'bg-navy-800 text-muted hover:bg-navy-700'
              }`}
            >
              {t === 'all' ? 'All' : TYPE_EMOJI[t] + ' ' + t.charAt(0).toUpperCase() + t.slice(1)}
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
                onClick={() => setShowForm(true)}
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
            />
          ))
        )}
      </div>

      {showForm && (
        <AssetForm
          onClose={() => setShowForm(false)}
          onSubmit={handleAdd}
          saving={saving}
        />
      )}
    </div>
  )
}

function AssetRow({ asset, toolCount, carrier }: { asset: AssetWithLocation; toolCount?: number; carrier?: string }) {
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
        <div className="flex items-center gap-2">
          <p className="font-medium text-ink truncate">{asset.name}</p>
          <Badge variant={TYPE_COLORS[asset.type] as 'default' | 'secondary' | 'success' | 'outline'}>
            {asset.type}
          </Badge>
          {(toolCount ?? 0) > 0 && (
            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-[#a78bfa]/15 border border-[#a78bfa]/35 text-[#c4b5fd] text-[11px] font-semibold px-2 py-0.5">
              🔧 {toolCount} aboard
            </span>
          )}
          {carrier && (
            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-[#60a5fa]/15 border border-[#60a5fa]/35 text-[#93c5fd] text-[11px] font-semibold px-2 py-0.5 max-w-[160px] truncate">
              with {carrier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-faint">
          {asset.tracker_id && <span className="truncate">ID: {asset.tracker_id}</span>}
          {asset.location?.timestamp && (
            <span className="flex items-center gap-0.5" suppressHydrationWarning>
              <Clock className="h-3 w-3" />
              {formatRelativeTime(asset.location.timestamp)}
            </span>
          )}
        </div>
      </div>
      {asset.location?.battery !== null && asset.location?.battery !== undefined && (
        <div className="flex items-center gap-1 text-xs text-muted flex-shrink-0">
          <Battery className="h-3 w-3" />
          {asset.location.battery}%
        </div>
      )}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        asset.location && new Date(asset.location.timestamp).getTime() > Date.now() - 30 * 60000
          ? 'bg-[#34d399]'
          : 'bg-faint'
      }`} />
      <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />
    </Link>
  )
}
