'use client'

import { useState } from 'react'
import { Layers3, Plus, Archive, RotateCcw, Check, X } from 'lucide-react'
import type { Division } from '@/lib/types'
import { DIVISION_SWATCHES as SWATCHES } from '@/lib/divisions'
import {
  createDivisionAction, updateDivisionAction, setDivisionArchivedAction,
} from '@/lib/actions/divisions'

/**
 * Settings → Divisions (migration 106).
 *
 * Brian, Sep 11: "keep track of DCG Coastal vs Upstate for example." A
 * division is an operating unit inside one company — trucks, job sites and
 * places carry one, and every list plus the map can filter to it.
 *
 * Archive rather than delete: the label stays readable on everything that
 * ever wore it, and Restore puts it back in the pickers.
 */


export function DivisionsCard({ initial, counts, canEdit }: {
  initial: Division[]
  counts: Record<string, { assets: number; zones: number }>
  canEdit: boolean
}) {
  const [rows, setRows] = useState<Division[]>(initial)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(SWATCHES[0])
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const live = rows.filter((d) => !d.archived_at)
  const archived = rows.filter((d) => d.archived_at)

  const add = async () => {
    const clean = name.trim()
    if (!clean || busy) return
    setBusy(true); setMsg(null)
    const r = await createDivisionAction(clean, color)
    setBusy(false)
    if (!r.ok || !r.id) { setMsg(r.error ?? 'Could not create it.'); return }
    setRows((p) => [...p, { id: r.id!, name: clean, color }])
    setName(''); setAdding(false)
  }

  const rename = async (id: string) => {
    const clean = editName.trim()
    if (!clean) { setEditId(null); return }
    setBusy(true); setMsg(null)
    const r = await updateDivisionAction(id, { name: clean })
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? 'Could not rename it.'); return }
    setRows((p) => p.map((d) => (d.id === id ? { ...d, name: clean } : d)))
    setEditId(null)
  }

  const recolor = async (id: string, c: string) => {
    setRows((p) => p.map((d) => (d.id === id ? { ...d, color: c } : d)))
    const r = await updateDivisionAction(id, { color: c })
    if (!r.ok) setMsg(r.error ?? 'Could not change the colour.')
  }

  const setArchived = async (id: string, archive: boolean) => {
    setBusy(true); setMsg(null)
    const r = await setDivisionArchivedAction(id, archive)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? 'Could not do that.'); return }
    setRows((p) => p.map((d) => (d.id === id ? { ...d, archived_at: archive ? new Date().toISOString() : null } : d)))
  }

  return (
    <div className="rounded-2xl border border-navy-800 bg-navy-900 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Layers3 className="h-4 w-4 text-amber mt-0.5 flex-none" />
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-ink text-sm">Divisions</h2>
          <p className="text-[12px] text-muted mt-0.5">
            Operating units inside this company — Upstate vs Coastal, say. Label a truck, a job site or a
            saved place with one and every list plus the map can filter to it. Nothing is required: rows
            without a division just show as unassigned.
          </p>
        </div>
      </div>

      {live.length > 0 && (
        <ul className="divide-y divide-navy-800 rounded-xl border border-navy-800 overflow-hidden">
          {live.map((d) => {
            const c = counts[d.id]
            return (
              <li key={d.id} className="flex items-center gap-2.5 px-3 py-2.5 bg-navy-950/40">
                <span className="h-3.5 w-3.5 rounded-full flex-none ring-2 ring-navy-950" style={{ background: d.color }} />
                {editId === d.id ? (
                  <>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') rename(d.id); if (e.key === 'Escape') setEditId(null) }}
                      autoFocus
                      className="flex-1 min-w-0 bg-navy-950 border border-navy-700 rounded-md text-[13px] text-ink px-2 py-1 outline-none focus:border-amber/50"
                    />
                    <button onClick={() => rename(d.id)} className="text-teal p-1" aria-label="Save name"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setEditId(null)} className="text-faint p-1" aria-label="Cancel"><X className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] text-ink truncate">{d.name}</span>
                      <span className="block text-[11px] text-faint">
                        {c ? `${c.assets} asset${c.assets === 1 ? '' : 's'} · ${c.zones} zone${c.zones === 1 ? '' : 's'}` : 'nothing labelled yet'}
                      </span>
                    </span>
                    {canEdit && (
                      <>
                        <span className="hidden sm:flex items-center gap-1">
                          {SWATCHES.slice(0, 6).map((s) => (
                            <button key={s} type="button" onClick={() => recolor(d.id, s)} aria-label={`Colour ${s}`}
                              className={'h-4 w-4 rounded-full border ' + (d.color.toLowerCase() === s.toLowerCase() ? 'border-ink' : 'border-navy-700')}
                              style={{ background: s }} />
                          ))}
                        </span>
                        <button onClick={() => { setEditId(d.id); setEditName(d.name) }} className="text-[11px] text-faint hover:text-ink px-1.5 py-1">Rename</button>
                        <button onClick={() => setArchived(d.id, true)} disabled={busy} className="text-faint hover:text-alert p-1" aria-label="Archive">
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (adding ? (
        <div className="rounded-xl border border-navy-800 bg-navy-950/40 p-3 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            placeholder="Division name (e.g. Coastal)"
            autoFocus
            className="w-full bg-navy-950 border border-navy-700 rounded-md text-[13px] text-ink px-2.5 py-2 outline-none focus:border-amber/50"
          />
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-faint">Colour</span>
            {SWATCHES.map((s) => (
              <button key={s} type="button" onClick={() => setColor(s)} aria-label={`Colour ${s}`}
                className={'h-5 w-5 rounded-full border-2 ' + (color === s ? 'border-ink scale-110' : 'border-navy-700')}
                style={{ background: s }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={add} disabled={busy || !name.trim()} className="flex-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[12.5px] py-2 disabled:opacity-50">
              {busy ? 'Adding…' : 'Add division'}
            </button>
            <button onClick={() => { setAdding(false); setName('') }} className="flex-1 rounded-lg border border-navy-700 text-faint hover:text-ink text-[12.5px] py-2">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-ink text-[12.5px] font-semibold px-3 py-2 hover:border-amber/50">
          <Plus className="h-3.5 w-3.5" /> {live.length ? 'Add another division' : 'Add a division'}
        </button>
      ))}

      {archived.length > 0 && (
        <div className="pt-1">
          <p className="font-mono text-[9px] uppercase tracking-wider text-faint mb-1">Archived</p>
          <ul className="space-y-1">
            {archived.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-[12px] text-faint">
                <span className="h-2.5 w-2.5 rounded-full flex-none opacity-60" style={{ background: d.color }} />
                <span className="flex-1 truncate">{d.name}</span>
                {canEdit && (
                  <button onClick={() => setArchived(d.id, false)} className="inline-flex items-center gap-1 text-teal hover:underline">
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="text-[12px] text-alert">{msg}</p>}
    </div>
  )
}
