'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Sparkles } from 'lucide-react'
import type { TakeoffItem } from '@/lib/db/takeoff'
import { MEASURE_UNITS, MEASURE_LABEL, type Measure, type Unit } from '@/lib/plans/measure'
import { saveTakeoffItemAction, deleteTakeoffItemAction, seedStarterItemsAction } from '@/lib/actions/takeoff'

const MEASURES = Object.keys(MEASURE_UNITS) as Measure[]
const money = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

interface Draft { id?: string; code: string; name: string; measure: Measure; unit: Unit; color: string; unitPrice: string; wastePct: string; depthIn: string; tonsPerCy: string; section: string }

const blank = (): Draft => ({ code: '', name: '', measure: 'area', unit: 'SY', color: '#ff9e16', unitPrice: '', wastePct: '0', depthIn: '', tonsPerCy: '', section: '' })
const toDraft = (i: TakeoffItem): Draft => ({
  id: i.id, code: i.code, name: i.name, measure: i.measure, unit: i.unit, color: i.color,
  unitPrice: i.unitPrice === null ? '' : String(i.unitPrice), wastePct: String(i.wastePct), depthIn: i.depthIn === null ? '' : String(i.depthIn),
  tonsPerCy: i.tonsPerCy === null ? '' : String(i.tonsPerCy), section: i.section ?? '',
})

/**
 * The company's item library (Bluebeam's Tool Chest): every item one code,
 * one look, one unit — and the depth the dirt takeoff deducts for an area
 * with a section. Prices show and save only for a login that can see costs.
 */
export function ItemLibrary({ items, canEdit, canSeed = canEdit, canCosts }: {
  items: TakeoffItem[]
  /** Managers and above: the library is company-wide (a depth change re-measures every mark). */
  canEdit: boolean
  /** Any editor may start an EMPTY library with the sitework set. */
  canSeed?: boolean
  canCosts: boolean
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!draft) return
    setBusy(true); setErr(null)
    const n = (s: string) => (s.trim() === '' ? null : Number(s))
    const r = await saveTakeoffItemAction({
      id: draft.id, code: draft.code, name: draft.name, measure: draft.measure, unit: draft.unit, color: draft.color,
      ...(canCosts ? { unitPrice: n(draft.unitPrice) } : {}),
      wastePct: Number(draft.wastePct) || 0, depthIn: n(draft.depthIn), tonsPerCy: n(draft.tonsPerCy), section: draft.section || null,
    }).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setDraft(null); router.refresh()
  }
  async function remove(i: TakeoffItem) {
    if (!window.confirm(`Delete ${i.code} from the library? Marks already made with it keep their shapes but lose their item.`)) return
    const r = await deleteTakeoffItemAction(i.id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    router.refresh()
  }
  async function seed() {
    setBusy(true)
    const r = await seedStarterItemsAction().catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t add them — try again.'); return }
    router.refresh()
  }

  const bySection = new Map<string, TakeoffItem[]>()
  for (const i of items) { const k = i.section ?? 'Other'; if (!bySection.has(k)) bySection.set(k, []); bySection.get(k)!.push(i) }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[12.5px] text-faint flex-1 min-w-[14rem]">One library for the whole company. Each item keeps its code, so spreadsheet formulas that look items up by code never break.</p>
        {canSeed && items.length === 0 && (
          <button type="button" disabled={busy} onClick={() => void seed()} className="inline-flex items-center gap-1.5 rounded-xl border border-teal/50 text-teal px-3 py-2 text-[12.5px] disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> Start with a sitework set
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => { setDraft(blank()); setErr(null) }} className="inline-flex items-center gap-1.5 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-3 py-2 text-[12.5px]">
            <Plus className="h-4 w-4" /> New item
          </button>
        )}
      </div>

      {draft && (
        <div className="rounded-xl border border-amber/40 bg-navy-900 p-3 space-y-2 text-[12.5px]">
          <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
            <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().slice(0, 16) })} placeholder="PAV-HD" aria-label="Code" className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 font-mono text-ink" />
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 120) })} placeholder="Heavy duty asphalt (3&quot; on 8&quot; stone)" aria-label="Name" className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={draft.measure} onChange={(e) => { const m = e.target.value as Measure; setDraft({ ...draft, measure: m, unit: MEASURE_UNITS[m][0] }) }} aria-label="Measure" className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink">
              {MEASURES.map((m) => <option key={m} value={m}>{MEASURE_LABEL[m]}</option>)}
            </select>
            <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as Unit })} aria-label="Unit" className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink">
              {MEASURE_UNITS[draft.measure].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <label className="flex items-center gap-1 text-faint">Colour <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-7 w-9 rounded bg-transparent" /></label>
            <input value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value.slice(0, 40) })} placeholder="Section (Paving…)" aria-label="Section" className="w-36 rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(draft.measure === 'volume' || draft.measure === 'area') && (
              <label className="flex items-center gap-1 text-faint">{draft.measure === 'volume' ? 'Depth' : 'Section depth (for the dirt)'} <input value={draft.depthIn} onChange={(e) => setDraft({ ...draft, depthIn: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="w-14 rounded bg-navy-950 border border-navy-700 px-1.5 py-1 text-ink" /> in</label>
            )}
            {draft.unit === 'TON' && (
              <label className="flex items-center gap-1 text-faint">Tons per CY <input value={draft.tonsPerCy} onChange={(e) => setDraft({ ...draft, tonsPerCy: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="w-14 rounded bg-navy-950 border border-navy-700 px-1.5 py-1 text-ink" /></label>
            )}
            <label className="flex items-center gap-1 text-faint">Waste <input value={draft.wastePct} onChange={(e) => setDraft({ ...draft, wastePct: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="w-12 rounded bg-navy-950 border border-navy-700 px-1.5 py-1 text-ink" /> %</label>
            {canCosts && (
              <label className="flex items-center gap-1 text-faint">Unit price $ <input value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="w-20 rounded bg-navy-950 border border-navy-700 px-1.5 py-1 text-ink" /> / {draft.unit}</label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5 disabled:opacity-50">Save item</button>
            <button type="button" onClick={() => setDraft(null)} className="text-faint hover:text-ink">Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-red-400">{err}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">No items yet. Start with the sitework set and edit it, or add your own.</p>
      ) : (
        Array.from(bySection.entries()).map(([sec, its]) => (
          <section key={sec}>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5">{sec}</h3>
            <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
              {its.map((i) => (
                <div key={i.id} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
                  <span className="h-3 w-3 rounded-sm flex-none" style={{ background: i.color }} />
                  <span className="font-mono font-bold text-ink w-20 truncate flex-none">{i.code}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-ink truncate">{i.name}</span>
                    <span className="block text-faint truncate">{MEASURE_LABEL[i.measure].split(' ')[0]} · {i.unit}{i.depthIn ? ` · ${i.depthIn}"` : ''}{i.wastePct ? ` · ${i.wastePct}% waste` : ''}</span>
                  </span>
                  {canCosts && <span className="font-mono text-muted w-20 text-right flex-none">{i.unitPrice !== null ? money(i.unitPrice) : '—'}</span>}
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => { setDraft(toDraft(i)); setErr(null) }} aria-label={`Edit ${i.code}`} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => void remove(i)} aria-label={`Delete ${i.code}`} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
