'use client'

import { useState } from 'react'
import { Search, Plus, Battery, Clock } from 'lucide-react'
import type { AssetWithLocation, AssetType } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AssetForm } from './AssetForm'

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}
const TYPE_COLORS: Record<AssetType, string> = {
  vehicle: 'default', equipment: 'secondary', personnel: 'success', tool: 'outline',
} as Record<AssetType, 'default' | 'secondary' | 'success' | 'outline'>

interface AssetListProps {
  assets: AssetWithLocation[]
  onAdd?: (data: { name: string; type: AssetType; tracker_id: string; metadata: Record<string, unknown> }) => void
}

export function AssetList({ assets, onAdd }: AssetListProps) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all')
  const [showForm, setShowForm] = useState(false)

  const filtered = assets.filter(a => {
    const matchesQ = a.name.toLowerCase().includes(query.toLowerCase()) ||
      (a.tracker_id?.toLowerCase().includes(query.toLowerCase()) ?? false)
    const matchesType = typeFilter === 'all' || a.type === typeFilter
    return matchesQ && matchesType
  })

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

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <Input
            placeholder="Search assets or tracker ID…"
            className="pl-9"
            value={query}
            onChange={e => setQuery(e.target.value)}
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

      <div className="flex-1 overflow-y-auto divide-y divide-navy-800">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-faint">
            <p className="text-4xl mb-2">📦</p>
            <p>No assets found</p>
          </div>
        ) : (
          filtered.map(asset => (
            <AssetRow key={asset.id} asset={asset} />
          ))
        )}
      </div>

      {showForm && (
        <AssetForm
          onClose={() => setShowForm(false)}
          onSubmit={(data) => {
            onAdd?.(data)
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function AssetRow({ asset }: { asset: AssetWithLocation }) {
  return (
    <div className="flex items-center gap-3 p-4 hover:bg-navy-800 transition-colors">
      <div className="text-2xl w-10 h-10 flex items-center justify-center bg-navy-800 rounded-lg flex-shrink-0">
        {TYPE_EMOJI[asset.type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-ink truncate">{asset.name}</p>
          <Badge variant={TYPE_COLORS[asset.type] as 'default' | 'secondary' | 'success' | 'outline'}>
            {asset.type}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-faint">
          {asset.tracker_id && <span className="truncate">ID: {asset.tracker_id}</span>}
          {asset.location?.timestamp && (
            <span className="flex items-center gap-0.5">
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
    </div>
  )
}
