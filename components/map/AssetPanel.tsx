'use client'

import type { ReactNode } from 'react'
import { X, Battery, Zap, Clock, Wifi } from 'lucide-react'
import type { AssetWithLocation, AssetType } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const TYPE_LABELS: Record<AssetType, string> = {
  vehicle: 'Vehicle', equipment: 'Equipment', personnel: 'Personnel', tool: 'Small Tool',
}

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}

const BATTERY_COLOR = (pct: number | null) => {
  if (pct === null) return 'text-slate-400'
  if (pct > 50) return 'text-green-600'
  if (pct > 20) return 'text-amber-500'
  return 'text-red-500'
}

interface AssetPanelProps {
  asset: AssetWithLocation
  gateway?: { name: string; lastSeen: string }
  onClose: () => void
}

export function AssetPanel({ asset, gateway, onClose }: AssetPanelProps) {
  const loc = asset.location
  const meta = asset.metadata ?? {}

  return (
    <>
      {/* Mobile: slide-up sheet */}
      <div className="absolute bottom-[70px] left-0 right-0 z-20 md:hidden">
        <div className="bg-white rounded-t-2xl shadow-2xl px-5 pt-4 pb-6 mx-2 border border-slate-200">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{TYPE_EMOJI[asset.type]}</span>
                <h2 className="text-base font-bold text-slate-900">{asset.name}</h2>
              </div>
              <Badge variant="secondary" className="mt-1">{TYPE_LABELS[asset.type]}</Badge>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
              <X className="h-4 w-4" />
            </button>
          </div>
          <AssetDetails asset={asset} loc={loc} meta={meta} gateway={gateway} />
        </div>
      </div>

      {/* Desktop: right sidebar panel */}
      <div className="absolute top-0 right-0 bottom-0 z-20 hidden md:block w-72">
        <div className="bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
          <div className="flex items-start justify-between p-5 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{TYPE_EMOJI[asset.type]}</span>
                <h2 className="text-base font-bold text-slate-900">{asset.name}</h2>
              </div>
              <Badge variant="secondary" className="mt-1">{TYPE_LABELS[asset.type]}</Badge>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5 flex-1 overflow-y-auto">
            <AssetDetails asset={asset} loc={loc} meta={meta} gateway={gateway} />
          </div>
        </div>
      </div>
    </>
  )
}

function AssetDetails({
  asset,
  loc,
  meta,
  gateway,
}: {
  asset: AssetWithLocation
  loc: AssetWithLocation['location']
  meta: Record<string, unknown>
  gateway?: { name: string; lastSeen: string }
}) {
  return (
    <div className="space-y-3">
      {asset.type === 'tool' && gateway && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-purple-600 flex-shrink-0" />
          <div className="text-sm">
            <span className="text-purple-700">Currently with </span>
            <span className="font-semibold text-purple-900">{gateway.name}</span>
            <span className="text-purple-500 text-xs"> · {formatRelativeTime(gateway.lastSeen)}</span>
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
            icon={<Zap className="h-4 w-4 text-amber-500" />}
            label="Speed"
            value={`${loc.speed} mph`}
          />
        )}
        {loc?.timestamp && (
          <StatTile
            icon={<Clock className="h-4 w-4 text-slate-400" />}
            label="Last Seen"
            value={formatRelativeTime(loc.timestamp)}
          />
        )}
        {asset.tracker_id && (
          <StatTile
            icon={<Wifi className="h-4 w-4 text-blue-500" />}
            label="Tracker"
            value={asset.tracker_id}
          />
        )}
      </div>

      {Object.keys(meta).length > 0 && (
        <div className="bg-slate-50 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Details</p>
          {Object.entries(meta).map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-slate-500 capitalize">{k.replace(/_/g, ' ')}</span>
              <span className="text-slate-800 font-medium">{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {loc && (
        <div className="text-xs text-slate-400 text-center">
          {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
          {loc.accuracy && ` ±${loc.accuracy}m`}
        </div>
      )}
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 flex items-start gap-2">
      {icon}
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm font-semibold text-slate-800">{value}</p>
      </div>
    </div>
  )
}
