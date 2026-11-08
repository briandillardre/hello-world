'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import type { Camera } from './PageCanvas'
import type { PlanMark, TakeoffItem } from '@/lib/db/takeoff'
import { kindFor, markQty, rollup, MEASURE_LABEL, type SheetFeet, type MarkGeom } from '@/lib/plans/measure'
import { createMarkAction, updateMarkAction, deleteMarksAction, confirmMarksAction } from '@/lib/actions/takeoff'

type UV = [number, number]

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 }))
const money = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function pointInRing(p: UV, ring: UV[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function segDist(p: UV, a: UV, b: UV, ax: number, ay: number): number {
  // Distance in page units (ax, ay scale u, v back to units).
  const px = p[0] * ax, py = p[1] * ay, x1 = a[0] * ax, y1 = a[1] * ay, x2 = b[0] * ax, y2 = b[1] * ay
  const dx = x2 - x1, dy = y2 - y1
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/**
 * Measuring on a sheet (migration 146): pick an item, tap the corners, Done.
 * The quantity shown while drawing is the same arithmetic the server stores
 * (lib/plans/measure.ts). Tapping an existing mark picks it — change its
 * item, delete it, or say it looks right when it was carried or suggested.
 */
export function useMeasure({ versionId, prevVersionId, items, allMarks, setAllMarks, feet, blocked, canEdit, canCosts, pageW, pageH, firstPass }: {
  versionId: string
  /** The version this one replaced, for the legend's Δ. */
  prevVersionId: string | null
  items: TakeoffItem[]
  /** Every mark on the sheet's versions — the viewer owns the list. */
  allMarks: PlanMark[]
  setAllMarks: (f: (ms: PlanMark[]) => PlanMark[]) => void
  feet: SheetFeet | null
  blocked: string | null
  canEdit: boolean
  canCosts: boolean
  pageW: number
  pageH: number
  /** The first pass (vector PDF pages only): run it, and what it last said. */
  firstPass?: { run: () => void; busy: boolean; note: string | null } | null
}) {
  const [on, setOn] = useState(false)
  const [itemId, setItemId] = useState<string>('')
  const [draft, setDraft] = useState<UV[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const marks = useMemo(() => allMarks.filter((m) => m.versionId === versionId), [allMarks, versionId])
  const prevMarks = useMemo(() => (prevVersionId ? allMarks.filter((m) => m.versionId === prevVersionId) : []), [allMarks, prevVersionId])
  const setMarks = setAllMarks
  useEffect(() => { setSelected(null); setDraft([]) }, [versionId])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const item = itemById.get(itemId) ?? null
  const kind = item ? kindFor(item.measure) : null
  const drawing = on && !!item && canEdit && !blocked
  const sel = selected ? marks.find((m) => m.id === selected) ?? null : null

  const draftQty = item && feet && draft.length ? markQty(item, kindFor(item.measure), { pts: draft }, feet) : null

  function onTap(pt: [number, number], cam: Camera) {
    const uv: UV = [pt[0] / pageW, pt[1] / pageH]
    if (drawing) {
      setSelected(null)
      setDraft((d) => [...d, uv])
      return
    }
    // Pick the mark under the finger: an area containing it, else the
    // nearest line or count point within ~12 px on screen.
    const tol = 12 / cam.s
    let best: { id: string; d: number } | null = null
    for (const m of marks) {
      if (m.kind === 'area' && pointInRing(uv, m.geom.pts)) { best = { id: m.id, d: 0 }; break }
      if (m.kind === 'line') {
        for (let i = 1; i < m.geom.pts.length; i++) {
          const d = segDist(uv, m.geom.pts[i - 1], m.geom.pts[i], pageW, pageH)
          if (d < tol && (!best || d < best.d)) best = { id: m.id, d }
        }
      }
      if (m.kind === 'count') {
        for (const p of m.geom.pts) {
          const d = Math.hypot((p[0] - uv[0]) * pageW, (p[1] - uv[1]) * pageH)
          if (d < tol && (!best || d < best.d)) best = { id: m.id, d }
        }
      }
    }
    setSelected(best?.id ?? null)
  }

  async function finish() {
    if (!item || !draft.length) return
    setBusy(true); setError(null)
    const r = await createMarkAction({ versionId, itemId: item.id, geom: { pts: draft } }).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setError(r && !r.ok ? r.error : 'Couldn’t save the mark — try again.'); return }
    setMarks((ms) => [...ms, r.mark])
    setDraft([])
  }
  async function removeSelected() {
    if (!sel) return
    const r = await deleteMarksAction([sel.id]).catch(() => null)
    if (!r?.ok) { setError(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    setMarks((ms) => ms.filter((m) => m.id !== sel.id)); setSelected(null)
  }
  async function confirm(ids: string[]) {
    const r = await confirmMarksAction(ids).catch(() => null)
    if (!r?.ok) { setError(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setMarks((ms) => ms.map((m) => (ids.includes(m.id) ? { ...m, status: 'ok' } : m)))
  }
  async function retype(newItemId: string) {
    if (!sel) return
    const r = await updateMarkAction(sel.id, { itemId: newItemId }).catch(() => null)
    if (!r?.ok) { setError(r && !r.ok ? r.error : 'Couldn’t change it — try again.'); return }
    setMarks((ms) => ms.map((m) => (m.id === sel.id ? r.mark : m)))
  }

  // The legend: this version's totals per item, against the previous version.
  const legend = useMemo(() => {
    const now = rollup(marks.map((m) => ({ itemId: m.itemId, qty: m.qty, status: m.status })))
    const before = new Map(rollup(prevMarks.map((m) => ({ itemId: m.itemId, qty: m.qty, status: m.status }))).map((r) => [r.itemId, r.qty]))
    return now.map((r) => ({ ...r, item: itemById.get(r.itemId), delta: prevMarks.length ? r.qty - (before.get(r.itemId) ?? 0) : null }))
      .filter((r) => r.item)
      .sort((a, b) => (a.item!.section ?? '').localeCompare(b.item!.section ?? '') || a.item!.code.localeCompare(b.item!.code))
  }, [marks, prevMarks, itemById])
  const pending = marks.filter((m) => m.status !== 'ok')

  const sections = useMemo(() => {
    const g = new Map<string, TakeoffItem[]>()
    for (const it of items) { const k = it.section ?? 'Other'; if (!g.has(k)) g.set(k, []); g.get(k)!.push(it) }
    return Array.from(g.entries())
  }, [items])

  const overlay = (cam: Camera): ReactNode => {
    const W = pageW, H = pageH
    const r = 6 / cam.s
    const ptsStr = (pts: UV[]) => pts.map((p) => `${p[0] * W},${p[1] * H}`).join(' ')
    return (
      <svg className="absolute inset-0 pointer-events-none overflow-visible" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {marks.map((m) => {
          const it = m.itemId ? itemById.get(m.itemId) : undefined
          const c = it?.color ?? '#9fb6cc'
          const isSel = m.id === selected
          const dash = m.status === 'suggested' ? '2 4' : m.status === 'check' ? '8 5' : undefined
          const sw = isSel ? 4 : 2.2
          if (m.kind === 'area') return (
            <g key={m.id}>
              <polygon points={ptsStr(m.geom.pts)} fill={c} fillOpacity={m.status === 'suggested' ? 0.12 : 0.28} stroke={isSel ? '#fff' : c} strokeWidth={sw} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
              {(m.geom.holes ?? []).map((h, i) => <polygon key={i} points={ptsStr(h)} fill="#fff" fillOpacity={0.6} stroke={c} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
            </g>
          )
          if (m.kind === 'line') return <polyline key={m.id} points={ptsStr(m.geom.pts)} fill="none" stroke={isSel ? '#fff' : c} strokeWidth={isSel ? 5 : 3} strokeDasharray={dash} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          return (
            <g key={m.id}>
              {m.geom.pts.map((p, i) => <circle key={i} cx={p[0] * W} cy={p[1] * H} r={r} fill={c} fillOpacity={0.85} stroke={isSel ? '#fff' : '#001523'} strokeWidth={isSel ? 3 : 1.5} vectorEffect="non-scaling-stroke" />)}
            </g>
          )
        })}
        {draft.length > 0 && item && (
          <g>
            {kind === 'area' && draft.length > 2 && <polygon points={ptsStr(draft)} fill={item.color} fillOpacity={0.2} stroke="none" />}
            {kind !== 'count' && <polyline points={ptsStr(kind === 'area' && draft.length > 2 ? [...draft, draft[0]] : draft)} fill="none" stroke="#ff9e16" strokeWidth={2.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
            {draft.map((p, i) => <circle key={i} cx={p[0] * W} cy={p[1] * H} r={r * 0.8} fill="#ff9e16" stroke="#001523" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
          </g>
        )}
      </svg>
    )
  }

  const panel = on ? (
    // Capped: a long legend scrolls inside the panel instead of shrinking the sheet to a sliver on a phone.
    <div className="px-3 py-2 bg-navy-900 border-b border-navy-800 text-[12px] space-y-2 max-h-[38dvh] overflow-y-auto overscroll-contain">
      {blocked && <p className="text-amber">{blocked}</p>}
      {canEdit && !blocked && (
        <div className="flex items-center gap-2 flex-wrap">
          <select value={itemId} onChange={(e) => { setItemId(e.target.value); setDraft([]) }} aria-label="Item to measure"
            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink max-w-[18rem]">
            <option value="">Pick an item to measure…</option>
            {sections.map(([sec, its]) => (
              <optgroup key={sec} label={sec}>
                {its.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name} ({it.unit})</option>)}
              </optgroup>
            ))}
          </select>
          {item && (
            <span className="text-faint">
              {MEASURE_LABEL[item.measure]} · {kind === 'count' ? 'tap each one' : kind === 'line' ? 'tap along the line' : 'tap the corners'}
              {draftQty !== null && <b className="text-ink"> · {fmt(draftQty)} {item.unit}</b>}
            </span>
          )}
          {draft.length > 0 && (
            <>
              <button type="button" onClick={() => setDraft((d) => d.slice(0, -1))} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-muted"><Undo2 className="h-3.5 w-3.5" /> Undo</button>
              <button type="button" onClick={() => setDraft([])} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-muted"><X className="h-3.5 w-3.5" /> Clear</button>
              <button type="button" disabled={busy} onClick={() => void finish()} className="inline-flex items-center gap-1 rounded-lg bg-amber text-[#1a1100] font-bold px-2.5 py-1 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Done</button>
            </>
          )}
        </div>
      )}
      {items.length === 0 && <p className="text-faint">No items in the library yet — add them on the plan room’s Items tab.</p>}
      {canEdit && !blocked && firstPass && items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" disabled={firstPass.busy} onClick={firstPass.run}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal/50 text-teal px-2.5 py-1 disabled:opacity-50">
            <Sparkles className="h-3.5 w-3.5" /> {firstPass.busy ? 'Reading the layers…' : 'First pass: measure this sheet’s layers'}
          </button>
          {firstPass.note && <span className="text-faint">{firstPass.note}</span>}
        </div>
      )}
      {sel && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-navy-700 px-2 py-1.5">
          <span className="text-ink font-semibold">{sel.qty !== null ? `${fmt(sel.qty)} ${sel.itemId ? itemById.get(sel.itemId)?.unit ?? '' : ''}` : 'no quantity'}</span>
          {sel.status === 'check' && <span className="text-amber">carried from the last version — the drawing changed here</span>}
          {sel.status === 'suggested' && <span className="text-faint">suggested by the first pass</span>}
          {canEdit && (
            <>
              <select value={sel.itemId ?? ''} onChange={(e) => e.target.value && void retype(e.target.value)} aria-label="Change item"
                className="rounded bg-navy-950 border border-navy-700 px-1.5 py-1 text-ink max-w-[14rem]">
                {items.filter((it) => kindFor(it.measure) === sel.kind).map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
              </select>
              {sel.status !== 'ok' && <button type="button" onClick={() => void confirm([sel.id])} className="rounded-lg border border-teal/50 text-teal px-2 py-1">Looks right</button>}
              <button type="button" onClick={() => void removeSelected()} aria-label="Delete mark" className="rounded-lg p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      )}
      {legend.length > 0 && (
        <table className="w-full text-left">
          <thead><tr className="text-faint text-[10.5px] uppercase tracking-wide"><th className="py-1">Item</th><th className="text-right">Qty</th><th></th>{canCosts && <th className="text-right">$</th>}{prevMarks.length > 0 && <th className="text-right">Δ vs last</th>}</tr></thead>
          <tbody>
            {legend.map((r) => (
              <tr key={r.itemId} className="border-t border-navy-800">
                <td className="py-1 pr-2"><span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5 align-middle" style={{ background: r.item!.color }} />{r.item!.code} <span className="text-faint">{r.item!.name}</span>{r.check > 0 && <span className="text-amber"> · {r.check} to check</span>}</td>
                <td className="text-right font-mono text-ink">{fmt(r.qty)}</td>
                <td className="pl-1 text-faint">{r.item!.unit}</td>
                {canCosts && <td className="text-right font-mono text-muted">{r.item!.unitPrice !== null ? money(r.qty * r.item!.unitPrice) : '—'}</td>}
                {prevMarks.length > 0 && <td className={'text-right font-mono ' + (r.delta ? (r.delta > 0 ? 'text-amber' : 'text-teal') : 'text-faint')}>{r.delta ? `${r.delta > 0 ? '+' : ''}${fmt(r.delta)}` : '0'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && pending.length > 0 && (
        <button type="button" onClick={() => void confirm(pending.map((m) => m.id))} className="text-teal underline">
          Accept all {pending.length} flagged / suggested mark{pending.length === 1 ? '' : 's'} on this sheet
        </button>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  ) : null

  return { on, setOn, panel, overlay, onTap, drawing, count: marks.length }
}

export type { MarkGeom }
