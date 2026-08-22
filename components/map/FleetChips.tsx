'use client'

import { Hexagon, Check, Cctv } from 'lucide-react'
import type { AssetType } from '@/lib/types'

/**
 * Fleet visibility chips — YOUR stuff, zero taps away (Aug 22, task #30).
 * Best-in-class map apps never bury "what of mine is shown" inside a layers
 * menu (Google's category chips, OnX's My Content): the layers panel is now
 * context-only and these chips ride the map surface under the Layers pill.
 * Filled amber + ✓ + live count = on; outline = hidden. Filter state stays
 * session-only (same as the old panel rows — deliberately not persisted).
 */

const TYPES: { t: AssetType; emoji: string; label: string }[] = [
  { t: 'vehicle', emoji: '🚛', label: 'Vehicles' },
  { t: 'equipment', emoji: '🏗️', label: 'Equipment' },
  { t: 'personnel', emoji: '👷', label: 'People' },
  { t: 'tool', emoji: '🔧', label: 'Tools' },
]

interface FleetChipsProps {
  filter: Set<AssetType>
  onFilter: (f: Set<AssetType>) => void
  /** Live count per asset type — the chip row doubles as a fleet summary. */
  counts: Partial<Record<AssetType, number>>
  showZones?: boolean
  onShowZones?: (v: boolean) => void
  zoneCount?: number
  /** Demo-only Site IoT chip. */
  showDevices?: boolean
  onToggleDevices?: () => void
}

function Chip({ on, onClick, children, label }: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${on ? 'Hide' : 'Show'} ${label}`}
      className={
        'flex flex-none items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors whitespace-nowrap ' +
        (on
          ? 'bg-amber text-[#1a1100] border-amber'
          : 'bg-navy-950/80 backdrop-blur text-faint border-navy-700 hover:text-ink hover:border-navy-500')
      }
    >
      {on && <Check className="h-3 w-3 flex-none" />}
      {children}
    </button>
  )
}

export function FleetChips({ filter, onFilter, counts, showZones, onShowZones, zoneCount, showDevices = false, onToggleDevices }: FleetChipsProps) {
  const flip = (t: AssetType) => {
    const next = new Set(filter)
    if (next.has(t)) next.delete(t); else next.add(t)
    onFilter(next)
  }
  return (
    // One-line horizontal scroll — a phone fits 3-4 chips, the rest swipe in.
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[calc(100vw-24px)] pr-2">
      {TYPES.filter(({ t }) => (counts[t] ?? 0) > 0).map(({ t, emoji, label }) => (
        <Chip key={t} on={filter.has(t)} onClick={() => flip(t)} label={label}>
          <span aria-hidden>{emoji}</span>
          <span className="hidden sm:inline">{label}</span>
          <span className="font-mono text-[10px] tabular-nums opacity-80">{counts[t]}</span>
        </Chip>
      ))}
      {onShowZones && (
        <Chip on={!!showZones} onClick={() => onShowZones(!showZones)} label="Zones">
          <Hexagon className="h-3 w-3 flex-none" />
          <span className="hidden sm:inline">Zones</span>
          {zoneCount != null && zoneCount > 0 && (
            <span className="font-mono text-[10px] tabular-nums opacity-80">{zoneCount}</span>
          )}
        </Chip>
      )}
      {onToggleDevices && (
        <Chip on={showDevices} onClick={onToggleDevices} label="Site IoT">
          <Cctv className="h-3 w-3 flex-none" />
          <span className="hidden sm:inline">Site IoT</span>
        </Chip>
      )}
    </div>
  )
}
