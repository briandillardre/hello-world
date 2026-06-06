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
  if (pct === null) return 'text-faint'
  if (pct > 50) return 'text-[#34d399]'
  if (pct > 20) return 'text-amber'
  return 'text-alert'
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
        <div className="bg-navy-900 rounded-t-2xl shadow-2xl px-5 pt-4 pb-6 mx-2 border border-navy-800">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{TYPE_EMOJI[asset.type]}</span>
                <h2 className="text-base font-bold text-ink">{asset.name}</h2>
              </div>
              <Badge variant="secondary" className="mt-1">{TYPE_LABELS[asset.type]}</Badge>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-navy-800 rounded-full">
              <X className="h-4 w-4" />
            </button>
          </div>
          <AssetDetails asset={asset} loc={loc} meta={meta} gateway={gateway} />
        </div>
      </div>

      {/* Desktop: right sidebar panel */}
      <div className="absolute top-0 right-0 bottom-0 z-20 hidden md:block w-72">
        <div className="bg-navy-900 h-full shadow-2xl border-l border-navy-800 flex flex-col">
          <div className="flex items-start justify-between p-5 border-b border-navy-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{TYPE_EMOJI[asset.type]}</span>
                <h2 className="text-base font-bold text-ink">{asset.name}</h2>
              </div>
              <Badge variant="secondary" className="mt-1">{TYPE_LABELS[asset.type]}</Badge>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-navy-800 rounded-full">
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
        <div className="bg-[#60a5fa]/15 border border-[#60a5fa]/30 rounded-lg p-3 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-[#60a5fa] flex-shrink-0" />
          <div className="text-sm">
            <span className="text-[#93c5fd]">Currently with </span>
            <span className="font-semibold text-[#93c5fd]">{gateway.name}</span>
            <span className="text-[#60a5fa] text-xs"> · {formatRelativeTime(gateway.lastSeen)}</span>
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
        {asset.tracker_id && (
          <StatTile
            icon={<Wifi className="h-4 w-4 text-[#60a5fa]" />}
            label="Tracker"
            value={asset.tracker_id}
          />
        )}
      </div>

      {Object.keys(meta).length > 0 && (
        <div className="bg-navy-800 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-faint uppercase tracking-wider mb-2">Details</p>
          {Object.entries(meta).map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-muted capitalize">{k.replace(/_/g, ' ')}</span>
              <span className="text-ink font-medium">{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {loc && (
        <div className="text-xs text-faint text-center">
          {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
          {loc.accuracy && ` ±${loc.accuracy}m`}
        </div>
      )}
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
