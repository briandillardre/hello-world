'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Hexagon, Pencil, Trash2, Check, X, ChevronRight, CornerDownRight } from 'lucide-react'
import type { Geofence } from '@/lib/types'
import { saveGeofenceAction, deleteGeofenceAction } from '@/lib/actions/geofences'

const PALETTE = ['#ff9e16', '#2dd4bf', '#60a5fa', '#a78bfa', '#f87171', '#34d399', '#fbbf24', '#f472b6']

interface Props {
  geofences: Geofence[]
  counts: Record<string, number>
  editable: boolean
}

export function GeofencesManager({ geofences, counts, editable }: Props) {
  const parents = geofences.filter((g) => !g.parent_id)
  const childrenOf = (id: string) => geofences.filter((g) => g.parent_id === id)

  return (
    <div className="p-4 space-y-3">
      {geofences.length === 0 && (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No zones yet. Go to the Map and tap the hexagon button to draw one.
        </p>
      )}
      {parents.map((g) => (
        <div key={g.id} className="space-y-2">
          <GeofenceRow fence={g} count={counts[g.id] ?? 0} editable={editable} parents={parents} />
          {childrenOf(g.id).map((c) => (
            <div key={c.id} className="ml-6 flex items-start gap-1.5">
              <CornerDownRight className="h-4 w-4 text-faint mt-4 flex-none" />
              <div className="flex-1">
                <GeofenceRow fence={c} count={counts[c.id] ?? 0} editable={editable} parents={parents} />
              </div>
            </div>
          ))}
        </div>
      ))}

      {!editable && (
        <div className="bg-amber/15 border border-amber/30 rounded-xl p-4 text-xs text-amber">
          You&apos;re viewing the demo. Sign in to your company to rename, recolor, nest, or delete zones.
        </div>
      )}
    </div>
  )
}

function GeofenceRow({
  fence, count, editable, parents,
}: { fence: Geofence; count: number; editable: boolean; parents: Geofence[] }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(fence.name)
  const [color, setColor] = useState(fence.color)
  const [parentId, setParentId] = useState<string | null>(fence.parent_id ?? null)
  const [pending, start] = useTransition()

  const save = () =>
    start(async () => {
      await saveGeofenceAction(fence.id, name.trim() || fence.name, color, parentId)
      setEditing(false)
    })
  const remove = () =>
    start(async () => {
      if (confirm(`Delete zone "${fence.name}"? This can't be undone.`)) {
        await deleteGeofenceAction(fence.id)
      }
    })

  if (editing) {
    return (
      <div className="bg-navy-900 rounded-xl border border-amber/40 p-4 space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-sm px-3 py-2 outline-none focus:border-amber"
          placeholder="Zone name"
          autoFocus
        />
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={'w-6 h-6 rounded-md border-2 ' + (color === c ? 'border-ink' : 'border-transparent')}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
        <select
          value={parentId ?? ''}
          onChange={(e) => setParentId(e.target.value || null)}
          className="w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-xs px-3 py-2 outline-none focus:border-amber"
        >
          <option value="">No parent (top-level site)</option>
          {parents.filter((p) => p.id !== fence.id).map((p) => (
            <option key={p.id} value={p.id}>Sub-zone of: {p.name}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button onClick={save} disabled={pending} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2 hover:bg-amber-600 disabled:opacity-60">
            <Check className="h-4 w-4" /> {pending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} className="px-3 rounded-lg border border-navy-700 text-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-navy-900 rounded-xl border border-navy-800 p-4 flex items-center gap-3">
      <div
        className="w-11 h-11 rounded-lg grid place-items-center flex-none"
        style={{ backgroundColor: fence.color + '22', border: `2px solid ${fence.color}` }}
      >
        <Hexagon className="h-5 w-5" style={{ color: fence.color }} />
      </div>
      <Link href={`/geofences/${fence.id}`} className="flex-1 min-w-0 group">
        <p className="font-semibold text-ink group-hover:text-amber transition-colors truncate">{fence.name}</p>
        <p className="text-xs text-faint mt-0.5">{count} asset{count !== 1 ? 's' : ''} inside</p>
      </Link>
      {editable && (
        <>
          <button onClick={() => setEditing(true)} title="Edit" className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-ink hover:bg-navy-800">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={remove} disabled={pending} title="Delete" className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-alert hover:bg-navy-800">
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
      <Link href={`/geofences/${fence.id}`} className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-ink">
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
