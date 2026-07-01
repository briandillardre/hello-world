'use client'

import { Hexagon, Cctv } from 'lucide-react'
import type { AssetType } from '@/lib/types'
import { cn } from '@/lib/utils'

const FILTERS: { type: AssetType; label: string; emoji: string; color: string }[] = [
  { type: 'vehicle', label: 'Vehicles', emoji: '🚛', color: 'bg-amber/20 border-amber text-amber' },
  { type: 'equipment', label: 'Equipment', emoji: '🏗️', color: 'bg-[#60a5fa]/20 border-[#60a5fa] text-[#93c5fd]' },
  { type: 'personnel', label: 'Personnel', emoji: '👷', color: 'bg-[#34d399]/20 border-[#34d399] text-[#6ee7b7]' },
  { type: 'tool', label: 'Tools', emoji: '🔧', color: 'bg-[#a78bfa]/20 border-[#a78bfa] text-[#c4b5fd]' },
]

interface FilterBarProps {
  filter: Set<AssetType>
  onChange: (f: Set<AssetType>) => void
  showZones: boolean
  onToggleZones: () => void
  showDevices: boolean
  onToggleDevices: () => void
}

export function FilterBar({ filter, onChange, showZones, onToggleZones, showDevices, onToggleDevices }: FilterBarProps) {
  const toggle = (type: AssetType) => {
    const next = new Set(filter)
    if (next.has(type)) { next.delete(type) } else { next.add(type) }
    onChange(next)
  }

  return (
    <div className="absolute top-3 left-3 right-16 z-10 flex flex-col gap-2 pointer-events-none">
      <div className="flex gap-2 flex-wrap pointer-events-auto">
        {FILTERS.map(({ type, label, emoji, color }) => (
          <button
            key={type}
            onClick={() => toggle(type)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border backdrop-blur transition-all active:scale-95',
              filter.has(type) ? color : 'bg-navy-950/70 border-navy-700 text-faint opacity-75'
            )}
          >
            <span>{emoji}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
        <button
          onClick={onToggleZones}
          title={showZones ? 'Hide all zones' : 'Show all zones'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border backdrop-blur transition-all active:scale-95',
            showZones ? 'bg-amber/20 border-amber text-amber' : 'bg-navy-950/70 border-navy-700 text-faint opacity-75'
          )}
        >
          <Hexagon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Zones</span>
        </button>
        <button
          onClick={onToggleDevices}
          title={showDevices ? 'Hide site IoT (cameras, fuel, generators, weather station)' : 'Show site IoT'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border backdrop-blur transition-all active:scale-95',
            showDevices ? 'bg-teal/20 border-teal text-teal' : 'bg-navy-950/70 border-navy-700 text-faint opacity-75'
          )}
        >
          <Cctv className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Site IoT</span>
        </button>
      </div>
    </div>
  )
}
