'use client'

import type { AssetType } from '@/lib/types'
import { cn } from '@/lib/utils'

const FILTERS: { type: AssetType; label: string; emoji: string; color: string }[] = [
  { type: 'vehicle', label: 'Vehicles', emoji: '🚛', color: 'bg-amber-100 border-amber-400 text-amber-800' },
  { type: 'equipment', label: 'Equipment', emoji: '🏗️', color: 'bg-blue-100 border-blue-400 text-blue-800' },
  { type: 'personnel', label: 'Personnel', emoji: '👷', color: 'bg-green-100 border-green-400 text-green-800' },
  { type: 'tool', label: 'Tools', emoji: '🔧', color: 'bg-purple-100 border-purple-400 text-purple-800' },
]

interface FilterBarProps {
  filter: Set<AssetType>
  onChange: (f: Set<AssetType>) => void
}

export function FilterBar({ filter, onChange }: FilterBarProps) {
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
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border-2 shadow-md transition-all active:scale-95',
              filter.has(type) ? color : 'bg-white border-slate-300 text-slate-400 opacity-70'
            )}
          >
            <span>{emoji}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
