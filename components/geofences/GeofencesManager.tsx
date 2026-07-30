'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Hexagon, Pencil, Trash2, Check, X, ChevronRight, CornerDownRight, Search, Archive, RotateCcw, FolderOpen } from 'lucide-react'
import type { Geofence } from '@/lib/types'
import { saveGeofenceAction, deleteGeofenceAction, setZoneCompletedAction, saveZoneFolderAction } from '@/lib/actions/geofences'
import { parseJobName, compareJobs } from '@/lib/job-code'
import { Input } from '@/components/ui/input'

const PALETTE = ['#ff9e16', '#2dd4bf', '#60a5fa', '#a78bfa', '#f87171', '#34d399', '#fbbf24', '#f472b6']

interface Props {
  geofences: Geofence[]
  counts: Record<string, number>
  editable: boolean
}

type SortKey = 'name' | 'assets'

export function GeofencesManager({ geofences, counts, editable }: Props) {
  // Search + sort mirror the Assets page, so the two lists feel like one app.
  // "Subcategories" are the existing parent/sub-zone nesting: a match on either
  // a parent or any of its children keeps the whole family visible.
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')

  const childrenOf = (id: string) => geofences.filter((g) => g.parent_id === id)
  // A job is "completed" when it carries the Z flip — via completed_at (037)
  // or a legacy hand-typed Z name. Completed jobs live in their own collapsed
  // section, mirroring what the Z prefix does to the Workforce pick list.
  const isDone = (g: Geofence) => !!g.completed_at || parseJobName(g.name).done
  const parents = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (g: Geofence) => g.name.toLowerCase().includes(q)
    const tops = geofences.filter((g) => !g.parent_id)
    const visible = q
      ? tops.filter((p) => matches(p) || geofences.some((c) => c.parent_id === p.id && matches(c)))
      : tops
    return [...visible].sort((a, b) =>
      sort === 'assets' ? (counts[b.id] ?? 0) - (counts[a.id] ?? 0) : compareJobs(a.name, b.name)
    )
  }, [geofences, counts, query, sort])
  const activeParents = parents.filter((g) => !isDone(g))
  const doneParents = parents.filter(isDone)
  const [showDone, setShowDone] = useState(false)

  return (
    <div className="p-4 space-y-3">
      {geofences.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
            <Input
              placeholder="Search zones…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {([['name', 'A → Z'], ['assets', 'Most assets']] as [SortKey, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  sort === k ? 'bg-amber text-[#1a1100]' : 'bg-navy-800 text-muted hover:bg-navy-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {geofences.length === 0 && (
        <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6 max-w-sm mx-auto text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber/10 border border-amber/25 grid place-items-center mb-3 text-2xl">⬡</div>
          <p className="text-ink font-display font-bold">Zones are your tripwires</p>
          <p className="text-sm text-faint mt-1.5 leading-relaxed">
            Outline your yard or a jobsite on the map. Anything that leaves after hours fires a theft
            alert, and every hour inside gets job-costed to that site automatically.
          </p>
          <Link
            href="/map"
            className="inline-block mt-4 rounded-xl bg-amber text-[#1a1100] font-display font-bold text-sm px-5 py-2.5 hover:bg-amber-600 transition-colors"
          >
            Draw your first zone
          </Link>
        </div>
      )}
      {activeParents.map((g) => (
        <div key={g.id} className="space-y-2">
          <GeofenceRow fence={g} count={counts[g.id] ?? 0} editable={editable} parents={parents} done={false} />
          {childrenOf(g.id).map((c) => (
            <div key={c.id} className="ml-6 flex items-start gap-1.5">
              <CornerDownRight className="h-4 w-4 text-faint mt-4 flex-none" />
              <div className="flex-1">
                <GeofenceRow fence={c} count={counts[c.id] ?? 0} editable={editable} parents={parents} done={false} />
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Completed (Z) jobs — collapsed at the bottom, exactly where the Z
          prefix sinks them in the crews' Workforce pick list. */}
      {doneParents.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="w-full flex items-center gap-2 rounded-xl border border-navy-800 bg-navy-900/60 px-4 py-2.5 text-left"
          >
            <Archive className="h-4 w-4 text-faint flex-none" />
            <span className="text-sm font-semibold text-muted flex-1">
              Completed jobs <span className="text-faint font-normal">· {doneParents.length}</span>
            </span>
            <ChevronRight className={'h-4 w-4 text-faint transition-transform ' + (showDone ? 'rotate-90' : '')} />
          </button>
          {showDone && (
            <div className="mt-2 space-y-2 opacity-80">
              {doneParents.map((g) => (
                <div key={g.id} className="space-y-2">
                  <GeofenceRow fence={g} count={counts[g.id] ?? 0} editable={editable} parents={parents} done />
                  {childrenOf(g.id).map((c) => (
                    <div key={c.id} className="ml-6 flex items-start gap-1.5">
                      <CornerDownRight className="h-4 w-4 text-faint mt-4 flex-none" />
                      <div className="flex-1">
                        <GeofenceRow fence={c} count={counts[c.id] ?? 0} editable={editable} parents={parents} done />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {geofences.length > 0 && parents.length === 0 && (
        <p className="text-sm text-faint text-center py-6">No zones match “{query}”.</p>
      )}

      {!editable && (
        <div className="bg-amber/15 border border-amber/30 rounded-xl p-4 text-xs text-amber">
          You&apos;re viewing the demo. Sign in to your company to rename, recolor, nest, or delete zones.
        </div>
      )}
    </div>
  )
}

function GeofenceRow({
  fence, count, editable, parents, done,
}: { fence: Geofence; count: number; editable: boolean; parents: Geofence[]; done: boolean }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(fence.name)
  const [color, setColor] = useState(fence.color)
  const [parentId, setParentId] = useState<string | null>(fence.parent_id ?? null)
  const [folderUrl, setFolderUrl] = useState(fence.folder_url ?? '')
  const [pending, start] = useTransition()
  const [flipNote, setFlipNote] = useState<string | null>(null)

  const save = () =>
    start(async () => {
      await saveGeofenceAction(fence.id, name.trim() || fence.name, color, parentId)
      if (folderUrl.trim() !== (fence.folder_url ?? '')) await saveZoneFolderAction(fence.id, folderUrl)
      setEditing(false)
    })
  const remove = () =>
    start(async () => {
      if (confirm(`Delete zone "${fence.name}"? This can't be undone.`)) {
        await deleteGeofenceAction(fence.id)
      }
    })
  // The Z flip: complete/reopen renames the job here AND (when connected)
  // the matching QuickBooks customer, so the crews' pick list follows.
  const flip = () =>
    start(async () => {
      const msg = done
        ? `Reopen "${fence.name}"? The Z comes off here and in QuickBooks.`
        : `Mark "${fence.name}" complete? It's renamed with a Z here and in QuickBooks, and drops to the bottom of the crews' pick list.`
      if (!confirm(msg)) return
      const r = await setZoneCompletedAction(fence.id, !done)
      setFlipNote(r.ok ? (r.qbo ?? null) : (r.error ?? 'Failed'))
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
        <div className="flex items-center gap-2 bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 focus-within:border-amber">
          <FolderOpen className="h-3.5 w-3.5 text-faint flex-none" />
          <input
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
            type="url"
            inputMode="url"
            placeholder="Project folder link (Dropbox / Drive / OneDrive)"
            className="flex-1 min-w-0 bg-transparent text-xs text-ink placeholder:text-faint outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={pending} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2 hover:bg-amber-600 disabled:opacity-60">
            <Check className="h-4 w-4" /> {pending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} className="px-3 rounded-lg border border-navy-700 text-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* This row is a QUICK edit, not the whole zone — say so, so nobody
            goes looking here for notes, dates, or the boundary itself. */}
        <Link href={`/geofences/${fence.id}`} className="block text-[11px] text-faint hover:text-amber">
          Boundary, notes, project dates, visibility → full zone settings
        </Link>
      </div>
    )
  }

  return (
    <div>
    <div className="bg-navy-900 rounded-xl border border-navy-800 p-4 flex items-center gap-3">
      <div
        className="w-11 h-11 rounded-lg grid place-items-center flex-none"
        style={{ backgroundColor: fence.color + '22', border: `2px solid ${fence.color}` }}
      >
        <Hexagon className="h-5 w-5" style={{ color: fence.color }} />
      </div>
      <Link href={`/geofences/${fence.id}`} className="flex-1 min-w-0 group">
        <p className="font-semibold text-ink group-hover:text-amber transition-colors truncate">{fence.name}</p>
        <p className="text-xs text-faint mt-0.5 flex items-center gap-1.5">
          {/* legacy dark/gray colors predate the kind column — treat as boundary */}
          {(fence.kind === 'boundary' || (!fence.kind && (fence.color === '#0a0a0a' || fence.color === '#9ca3af'))) ? (
            <span className="text-teal/80 font-mono text-[10px] uppercase tracking-[0.08em]">Boundary</span>
          ) : (
            <span className="text-amber/80 font-mono text-[10px] uppercase tracking-[0.08em]">Job site</span>
          )}
          <span>· {count} asset{count !== 1 ? 's' : ''} inside</span>
        </p>
      </Link>
      {editable && (
        <>
          <button
            onClick={flip}
            disabled={pending}
            title={done ? 'Reopen job (remove the Z)' : 'Mark job complete (Z-rename here + QuickBooks)'}
            className={'grid place-items-center w-8 h-8 rounded-lg hover:bg-navy-800 ' + (done ? 'text-teal hover:text-teal' : 'text-faint hover:text-amber')}
          >
            {done ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </button>
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
    {flipNote && <p className="px-4 pt-1 text-[10.5px] text-faint">{flipNote}</p>}
    </div>
  )
}
