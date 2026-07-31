'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Pencil, Check, Trash2, X, PenTool } from 'lucide-react'
import { MapSheet, SparkBars } from './MapSheet'
import type { Geofence } from '@/lib/types'
import type { TimeRange } from '@/lib/trails'
import type { SitePresence } from '@/lib/site-presence'
import { PROJECTS, periodCost, presenceCost, moneyFull, RANGE_COST_LABEL } from '@/lib/projects'
import { bucketSpanLabel } from '@/lib/activity'
import { ColorSwatches } from '@/components/ui/color-swatches'


export interface ZoneReal {
  total: number
  activeHours: number
  idleHours?: number
  asOf?: string
  hoursSeries?: number[]
  costSeries?: number[]
  windowSec?: number
}

const STAT = [
  { emoji: '👷', label: 'Crew', key: 'personnel' },
  { emoji: '🏗️', label: 'Equipment', key: 'equipment' },
  { emoji: '🚛', label: 'Vehicles', key: 'vehicle' },
  { emoji: '🔧', label: 'Tools', key: 'tool' },
] as const

/** A job-site zone in the shared sheet: who's on site now + cost accruing,
 *  live-synced to the timeline (cost + charts update as you scrub). Editable
 *  inline — rename, recolor, or delete right from the map. */
export function ZonePanel({
  fence, presence, range, t, real, onClose, canEdit = false, onEdit, onDelete, showCosts = true,
  insideAssets = [], onPickAsset,
}: {
  fence: Geofence
  presence: SitePresence
  range: TimeRange
  t: number
  real?: ZoneReal | null
  onClose: () => void
  canEdit?: boolean
  onEdit?: (id: string, name: string, color: string) => void
  onDelete?: (id: string) => void
  /** False = viewer lacks the $-costs permission; show presence/hours only. */
  showCosts?: boolean
  /** Assets physically inside the zone right now — shown by name. */
  insideAssets?: { id: string; name: string; type: string }[]
  /** Tap an on-site asset to open its panel. */
  onPickAsset?: (id: string) => void
}) {
  const EMOJI: Record<string, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(fence.name)
  const [color, setColor] = useState(fence.color)
  const [confirmDel, setConfirmDel] = useState(false)

  const save = () => {
    const n = name.trim()
    if (n) onEdit?.(fence.id, n, color)
    setEditing(false)
  }

  return (
    <MapSheet
      icon={<span className="w-3 h-3 rounded-sm flex-none" style={{ backgroundColor: fence.color }} />}
      title={fence.name}
      subtitle={
        <span className="font-mono">
          <span className="font-display font-black text-lg text-ink">{presence.total}</span> on site
        </span>
      }
      onClose={onClose}
    >
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">Zone name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="mt-1 w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-sm px-3 py-2 outline-none focus:border-amber/60"
            />
          </div>
          <div>
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">Color</label>
            <div className="mt-1.5">
              <ColorSwatches value={color} onChange={setColor} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2.5 hover:bg-amber-600 transition-colors">
              <Check className="h-4 w-4" /> Save
            </button>
            <button onClick={() => { setEditing(false); setName(fence.name); setColor(fence.color) }} className="rounded-lg bg-navy-800 border border-navy-700 text-faint hover:text-ink px-3 py-2.5">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Link
            href={`/geofences/${fence.id}`}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-navy-700 text-teal text-sm font-medium py-2.5 hover:bg-navy-800 transition-colors"
          >
            <PenTool className="h-3.5 w-3.5" /> Reshape corners · full editor
          </Link>
          {onDelete && (
            confirmDel ? (
              <button onClick={() => onDelete(fence.id)} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-alert/15 border border-alert/40 text-alert text-sm font-semibold py-2.5">
                <Trash2 className="h-4 w-4" /> Tap again to delete this zone
              </button>
            ) : (
              <button onClick={() => setConfirmDel(true)} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-navy-700 text-faint hover:text-alert text-sm font-medium py-2.5 transition-colors">
                <Trash2 className="h-4 w-4" /> Delete zone
              </button>
            )
          )}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {STAT.map((s) => (
              <div key={s.key} className="flex items-center gap-2 font-mono text-[12px] text-muted">
                <span>{s.emoji}</span>
                <span className="flex-1">{s.label}</span>
                <span className="text-ink font-bold">{presence.byType[s.key]}</span>
              </div>
            ))}
          </div>

          {/* On site now — by name, tappable */}
          {insideAssets.length > 0 && (
            <div className="mt-3 rounded-lg bg-navy-800/60 p-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint mb-1.5 px-1">On site now</p>
              <div className="space-y-0.5">
                {insideAssets.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onPickAsset?.(a.id)}
                    className="w-full flex items-center gap-2 text-left rounded-md px-1.5 py-1 hover:bg-navy-700/60 transition-colors"
                  >
                    <span className="flex-none">{EMOJI[a.type] ?? '📍'}</span>
                    <span className="flex-1 min-w-0 truncate text-[12.5px] text-ink font-medium">{a.name}</span>
                    {onPickAsset && <span className="text-faint text-[10px]">view →</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {fence.notes && (
            <p className="mt-3 rounded-lg bg-navy-800/70 px-3 py-2 text-[12px] text-muted whitespace-pre-line leading-snug">
              📝 {fence.notes}
            </p>
          )}

          {showCosts
            ? (real ? <RealCost real={real} /> : <DemoCost fence={fence} presence={presence} range={range} t={t} />)
            : real?.hoursSeries?.some((v) => v > 0) && (
                <div className="mt-4 pt-3 border-t border-navy-800">
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint mb-1">
                    Hours on site · per {real.windowSec ? bucketSpanLabel(real.windowSec, real.hoursSeries.length) : 'interval'}
                  </p>
                  <SparkBars series={real.hoursSeries} color="#2dd4bf" />
                </div>
              )}

          <Link
            href={`/geofences/${fence.id}`}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal/50 text-teal text-sm font-semibold py-2.5 hover:bg-teal/10 transition-colors"
          >
            📊 See full details — hours, costs, charts, history
          </Link>

          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy-800 border border-navy-700 text-ink text-sm font-medium py-2.5 hover:bg-navy-700 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit zone
            </button>
          )}
        </>
      )}
    </MapSheet>
  )
}

function CostHeadline({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mt-4 pt-3 border-t border-navy-800">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">{label}</p>
      <p className="font-display font-black text-2xl text-amber leading-tight">{value}</p>
      {sub && <p className="font-mono text-[10px] text-faint mt-0.5">{sub}</p>}
    </div>
  )
}

function RealCost({ real }: { real: ZoneReal }) {
  const span = real.windowSec ? bucketSpanLabel(real.windowSec, real.hoursSeries?.length ?? 96) : 'interval'
  const hasHours = real.hoursSeries?.some((v) => v > 0)
  const hasCost = real.costSeries?.some((v) => v > 0)
  return (
    <>
      {real.total > 0 ? (
        <CostHeadline
          label={`Cost on site · from asset rates${real.asOf ? ` · as of ${real.asOf}` : ''}`}
          value={moneyFull(real.total)}
          sub={`${real.activeHours.toFixed(1)}h active · ${(real.idleHours ?? 0).toFixed(1)}h idle inside this zone`}
        />
      ) : (
        <p className="mt-4 pt-3 border-t border-navy-800 font-mono text-[11px] text-faint">
          {(real.idleHours ?? 0) > 0.05
            ? `${(real.idleHours ?? 0).toFixed(1)}h idle inside this zone · no billed activity${real.asOf ? ` (as of ${real.asOf})` : ''}`
            : `No activity in this zone yet${real.asOf ? ` (as of ${real.asOf})` : ''}`}
        </p>
      )}
      {hasHours && (
        <div className="mt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint mb-1">Hours on site · per {span}</p>
          <SparkBars series={real.hoursSeries!} color="#2dd4bf" />
        </div>
      )}
      {hasCost && (
        <div className="mt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint mb-1">Cost · per {span}</p>
          <SparkBars series={real.costSeries!} color="#ff9e16" />
        </div>
      )}
    </>
  )
}

function DemoCost({ fence, presence, range, t }: { fence: Geofence; presence: SitePresence; range: TimeRange; t: number }) {
  const project = PROJECTS.find((pr) => pr.geofenceId === fence.id)
  const cost = project ? periodCost(project, range, t) : presenceCost(presence.byType, range, t)
  if (cost.total <= 0) {
    return <p className="mt-4 pt-3 border-t border-navy-800 font-mono text-[11px] text-faint">No assets on site</p>
  }
  return (
    <CostHeadline
      label={`${project ? 'Cost' : 'Est. cost'} · ${RANGE_COST_LABEL[range]}`}
      value={moneyFull(cost.total)}
      sub={`${moneyFull(cost.labor)} labor + ${moneyFull(cost.equip)} equipment`}
    />
  )
}
