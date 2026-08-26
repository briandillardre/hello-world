'use client'

import { useState, useTransition } from 'react'
import { ClipboardList, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import { saveLogFormAction } from '@/lib/actions/company'
import { LOG_ITEM_TYPES, type LogFormItem, type LogItemType } from '@/lib/log-form'

/**
 * Settings → Daily log builder. The admin composes the crew's clock-out form
 * like a Google Form: toggle the standard construction-log sections on/off,
 * mark items required, rename them, reorder, and add custom questions of any
 * type. Autosaves on every change (same pattern as Weekly summaries).
 */
export function DailyLogBuilder({ initial, editable }: { initial: LogFormItem[]; editable: boolean }) {
  const [items, setItems] = useState(initial)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()
  // Custom-question composer
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<LogItemType>('text')
  const [newOptions, setNewOptions] = useState('')
  const [newRequired, setNewRequired] = useState(false)

  function save(next: LogFormItem[]) {
    setItems(next)
    if (!editable) return
    setSaved('saving')
    start(async () => {
      const r = await saveLogFormAction(next).catch(() => ({ ok: false as const, error: 'Save failed' }))
      if (r.ok) { setSaved('saved'); setError(null) }
      else { setSaved('error'); setError(r.error ?? 'Save failed') }
    })
  }

  const patch = (id: string, p: Partial<LogFormItem>) =>
    save(items.map((it) => (it.id === id ? { ...it, ...p } : it)))
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    save(next)
  }

  function addCustom() {
    const label = newLabel.trim()
    if (!label) return
    const needsOptions = newType === 'choice' || newType === 'checklist'
    const options = newOptions.split(',').map((s) => s.trim()).filter(Boolean)
    if (needsOptions && options.length < 2) { setError('Give the question at least two options (comma-separated).'); return }
    const item: LogFormItem = {
      id: `c_${Math.random().toString(36).slice(2, 9)}`,
      label, type: newType, enabled: true, required: newRequired,
      ...(needsOptions ? { options } : {}),
    }
    setNewLabel(''); setNewOptions(''); setNewRequired(false)
    save([...items, item])
  }

  return (
    <section className="bg-navy-900 rounded-xl border border-navy-800 p-4">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList className="h-4 w-4 text-amber" />
        <h2 className="font-display font-bold text-ink text-sm flex-1">Daily log form</h2>
        <span className="text-[10.5px] text-faint">
          {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved ✓' : saved === 'error' ? '' : ''}
        </span>
      </div>
      <p className="text-[12px] text-faint mb-3 max-w-[62ch]">
        What the crew fills out to clock out — every submission is stamped with who, when, and
        where (GPS), lands on the map&apos;s Field activity layer, and feeds the AI. Required items
        block clock-out until answered.
      </p>

      <div className="divide-y divide-navy-800 rounded-lg border border-navy-800 bg-navy-950">
        {items.map((it, idx) => (
          // Phone (<sm): the title spans the full row next to the reorder arrows
          // and the On/Required pair wraps onto its own line, so question titles
          // never hard-clip mid-letter. Desktop (sm+): the original single row.
          <div key={it.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${it.enabled ? '' : 'opacity-50'}`}>
            <div className="flex flex-col -my-1">
              <button type="button" disabled={!editable || idx === 0} onClick={() => move(idx, -1)}
                aria-label="Move up" className="text-faint hover:text-ink disabled:opacity-30 p-0.5"><ChevronUp className="h-3.5 w-3.5" /></button>
              <button type="button" disabled={!editable || idx === items.length - 1} onClick={() => move(idx, 1)}
                aria-label="Move down" className="text-faint hover:text-ink disabled:opacity-30 p-0.5"><ChevronDown className="h-3.5 w-3.5" /></button>
            </div>
            <div className="min-w-0 grow basis-[calc(100%-2.25rem)] sm:basis-0">
              <input
                value={it.label}
                disabled={!editable}
                onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== initial.find((x) => x.id === it.id)?.label) patch(it.id, { label: v }) }}
                className="w-full bg-transparent text-[13px] text-ink outline-none focus:border-b focus:border-amber/50"
              />
              <p className="text-[10px] text-faint">
                {LOG_ITEM_TYPES.find((t) => t.key === it.type)?.label ?? it.type}
                {it.options?.length ? ` · ${it.options.join(' / ')}` : ''}
                {it.std ? '' : ' · custom'}
              </p>
            </div>
            <label className="flex items-center gap-1 text-[11px] text-muted cursor-pointer">
              <input type="checkbox" checked={it.enabled} disabled={!editable}
                onChange={(e) => patch(it.id, { enabled: e.target.checked, ...(e.target.checked ? {} : { required: false }) })}
                className="accent-amber" />
              On
            </label>
            <label className={`flex items-center gap-1 text-[11px] cursor-pointer ${it.enabled ? 'text-muted' : 'text-faint'}`}>
              <input type="checkbox" checked={it.required} disabled={!editable || !it.enabled || it.type === 'photos'}
                onChange={(e) => patch(it.id, { required: e.target.checked })}
                className="accent-amber" />
              Required
            </label>
            {!it.std && (
              <button type="button" disabled={!editable} aria-label={`Delete ${it.label}`}
                onClick={() => save(items.filter((x) => x.id !== it.id))}
                className="text-faint hover:text-red-400 p-1 disabled:opacity-30">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <div className="mt-3 rounded-lg border border-dashed border-navy-700 p-3 flex flex-wrap items-center gap-2">
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Add a custom question…"
            className="flex-1 min-w-[160px] rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-1.5 text-xs text-ink placeholder:text-faint" />
          <select value={newType} onChange={(e) => setNewType(e.target.value as LogItemType)}
            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-ink">
            {LOG_ITEM_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {(newType === 'choice' || newType === 'checklist') && (
            <input value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="Options, comma-separated"
              className="flex-1 min-w-[160px] rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-1.5 text-xs text-ink placeholder:text-faint" />
          )}
          <label className="flex items-center gap-1 text-[11px] text-muted cursor-pointer">
            <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} className="accent-amber" />
            Required
          </label>
          <button type="button" onClick={addCustom} disabled={!newLabel.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-2.5 py-1.5 disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  )
}
