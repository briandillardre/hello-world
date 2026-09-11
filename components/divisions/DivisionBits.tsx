'use client'

import { useEffect, useState } from 'react'
import { Layers3 } from 'lucide-react'
import type { Division } from '@/lib/types'
import { setRowDivisionAction } from '@/lib/actions/divisions'

/**
 * The three small pieces every division surface reuses (migration 106):
 * a chip that names one, a filter that picks one, and a picker that assigns
 * one. All three render NOTHING when the company has no divisions, so a
 * company that never creates one sees the app exactly as before.
 */

/** The label as it appears on a row — colour dot + name. */
export function DivisionChip({ division, className = '' }: { division?: Division | null; className?: string }) {
  if (!division) return null
  return (
    <span
      className={'inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.08em] ' + className}
      style={{ borderColor: `${division.color}66`, color: division.color, background: `${division.color}14` }}
      title={`Division: ${division.name}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: division.color }} />
      {division.name}
    </span>
  )
}

export const DIVISION_ALL = null
/** 'none' is a real choice — "show me what nobody has labelled yet". */
export type DivisionPick = string | null

/**
 * The filter. Remembers the choice per device and per surface key, because
 * an Upstate foreman looking at the map wants it filtered every morning
 * without re-picking.
 */
export function useDivisionFilter(storeKey: string): [DivisionPick, (v: DivisionPick) => void] {
  const key = `ht_div_${storeKey}`
  const [pick, setPick] = useState<DivisionPick>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) setPick(raw)
    } catch { /* private mode */ }
  }, [key])
  const set = (v: DivisionPick) => {
    setPick(v)
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key) } catch { /* private mode */ }
  }
  return [pick, set]
}

export function DivisionFilter({ divisions, value, onChange, compact = false }: {
  divisions: Division[]
  value: DivisionPick
  onChange: (v: DivisionPick) => void
  /** Map/toolbar variant: dark glass pill instead of a form row. */
  compact?: boolean
}) {
  if (!divisions.length) return null
  const current = value && value !== 'none' ? divisions.find((d) => d.id === value) : null
  const dot = value === 'none' ? '#6f88a0' : current?.color ?? null

  return (
    <label
      className={
        compact
          ? 'inline-flex items-center gap-1.5 rounded-full border border-navy-700 bg-navy-950/90 backdrop-blur pl-2 pr-1 py-1 shadow-panel'
          : 'inline-flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 pl-2 pr-1 py-1'
      }
      title="Filter by division"
    >
      {dot
        ? <span className="h-2.5 w-2.5 rounded-full flex-none" style={{ background: dot }} />
        : <Layers3 className="h-3.5 w-3.5 text-faint flex-none" />}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
        className="bg-transparent text-[12px] text-ink outline-none pr-1 max-w-[9rem]"
      >
        <option value="">All divisions</option>
        {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        <option value="none">Unassigned</option>
      </select>
    </label>
  )
}

/**
 * Assigns a division to one row (asset / zone / place). Saves on change —
 * no separate Save button, same as the other one-field controls on those
 * pages.
 */
export function DivisionPicker({ divisions, table, rowId, value, canEdit, label = 'Division' }: {
  divisions: Division[]
  table: 'assets' | 'geofences' | 'places'
  rowId: string
  value: string | null | undefined
  canEdit: boolean
  label?: string
}) {
  const [pick, setPick] = useState<string | null>(value ?? null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)
  if (!divisions.length) return null

  const current = divisions.find((d) => d.id === pick) ?? null

  const change = async (next: string | null) => {
    const prev = pick
    setPick(next); setState('saving'); setErr(null)
    const r = await setRowDivisionAction(table, rowId, next)
    if (!r.ok) {
      setPick(prev); setState('error'); setErr(r.error ?? 'Could not save it.')
      return
    }
    setState('saved')
    setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1600)
  }

  if (!canEdit) {
    return current ? (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wider text-faint">{label}</span>
        <DivisionChip division={current} />
      </div>
    ) : null
  }

  return (
    <div className="space-y-1">
      <p className="font-mono text-[9px] uppercase tracking-wider text-faint">{label}</p>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full flex-none ring-2 ring-navy-950" style={{ background: current?.color ?? '#0a3a5c' }} />
        <select
          value={pick ?? ''}
          onChange={(e) => change(e.target.value ? e.target.value : null)}
          disabled={state === 'saving'}
          className="flex-1 bg-navy-950 border border-navy-700 rounded-md text-[12.5px] text-ink px-2 py-1.5 outline-none focus:border-amber/50 disabled:opacity-60"
        >
          <option value="">Unassigned</option>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {state === 'saved' && <span className="text-[11px] text-teal flex-none">Saved</span>}
      </div>
      {err && <p className="text-[11px] text-alert">{err}</p>}
    </div>
  )
}
