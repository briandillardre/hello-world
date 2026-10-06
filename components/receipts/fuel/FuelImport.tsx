'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, FileUp, Plus, Upload } from 'lucide-react'
import { toast } from '@/components/ui/feedback'
import { NO_REPLY } from '@/lib/action-reply'
import { FIELD_LABEL, FUEL_FIELDS, parseFuelCsv, type FuelField, type FuelProduct } from '@/lib/fuel-check'
import type { FuelVehicleView } from '@/lib/db/fuel-check'
import { addFuelTxnAction, importFuelCsvAction } from '@/lib/actions/fuel-check'
import { money } from './FuelPilot'

/**
 * The doors in: paste or upload an export (a fleet card's transactions, or a
 * bank/card statement), see how every column was read and change any of
 * them, see which lines are fuel and why the rest were left out — then
 * import. The preview runs the same parser the server runs, with the same
 * column choices, so what you see is what gets written.
 */
export function FuelImport({ tz, todayKey, writable, defaultOpen, vehicles }: {
  tz: string
  todayKey: string
  writable: boolean
  defaultOpen: boolean
  vehicles: FuelVehicleView[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(defaultOpen)
  const [tab, setTab] = useState<'file' | 'one'>('file')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [mapping, setMapping] = useState<(FuelField | null)[] | null>(null)
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (text.trim() ? parseFuelCsv(text, { tz, mapping }) : null), [text, tz, mapping])

  const load = (t: string, name: string | null) => { setText(t); setFileName(name); setMapping(null) }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 3_000_000) { toast('That file is over 3 MB — export a shorter date range.', { variant: 'error' }); return }
    load(await f.text(), f.name)
  }
  const sample = (i: number) => preview?.sampleRow[i] ?? ''
  const doImport = () => start(async () => {
    if (!preview) return
    const r = await importFuelCsvAction(text, preview.mapping)
    if (!r?.ok) { toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
    const parts = [
      `${r.imported ?? 0} imported`,
      r.enriched ? `${r.enriched} matched a card alert` : '',
      r.duplicates ? `${r.duplicates} already in` : '',
      `${r.checked ?? 0} checked`,
      r.remaining ? `${r.remaining} finish tonight` : '',
    ].filter(Boolean)
    toast(parts.join(' · '), { variant: 'success', ttl: 6000 })
    load('', null)
    router.refresh()
  })
  const skippedWhy = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of preview?.skipped ?? []) m.set(s.reason, (m.get(s.reason) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [preview])

  return (
    <section className="rounded-2xl border border-navy-700 bg-navy-850">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Upload className="h-4 w-4 text-amber flex-none" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-ink text-[13.5px]">Import purchases</span>
          <span className="block text-[11.5px] text-faint">A fleet-card export or a bank/card statement (CSV). Re-importing the same file adds nothing.</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
      </button>
      {open && (
        <div className="border-t border-navy-700 px-4 py-3 space-y-3">
          {!writable && <p className="text-[12px] text-faint">Someone with the edit ability imports purchases.</p>}
          <div className="flex gap-2">
            {(['file', 'one'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${tab === k ? 'border-amber/50 bg-amber/10 text-amber' : 'border-navy-700 text-muted hover:text-ink'}`}>
                {k === 'file' ? 'An export' : 'One purchase'}
              </button>
            ))}
          </div>
          {tab === 'one' ? <AddOne todayKey={todayKey} vehicles={vehicles} writable={writable} /> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={!writable}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[12px] font-semibold text-ink hover:border-amber/50 disabled:opacity-40">
                  <FileUp className="h-3.5 w-3.5" /> Choose a CSV
                </button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden"
                  onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
                <span className="text-[11.5px] text-faint truncate">{fileName ?? 'or paste below'}</span>
              </div>
              <textarea
                value={fileName ? '' : text} onChange={(e) => load(e.target.value, null)} rows={4} disabled={!writable || !!fileName}
                placeholder={'Transaction Date,Description,Amount\n10/01/2026,SPINX #0156 GREENVILLE SC,-84.20'}
                className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-amber/50 disabled:opacity-50"
              />
              {preview && (
                <div className="space-y-3">
                  {preview.warnings.map((w) => <p key={w} className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-[12px] text-amber">{w}</p>)}
                  {preview.header.length > 0 && (
                    <div>
                      <p className="text-[12px] font-semibold text-ink">How each column was read <span className="font-normal text-faint">— {preview.shape === 'fleet' ? 'a fleet-card export' : 'a bank/card statement'}{preview.signFlipped ? ', charges written as negatives' : ''}</span></p>
                      <div className="mt-1.5 space-y-1">
                        {preview.header.map((h, i) => (
                          <label key={i} className="flex items-center gap-2">
                            <span className="w-[38%] min-w-0 truncate text-[12px] text-muted" title={h}>{h || `Column ${i + 1}`}</span>
                            <select
                              value={preview.mapping[i] ?? ''}
                              disabled={!writable}
                              onChange={(e) => {
                                const next = preview.mapping.slice()
                                const v = (e.target.value || null) as FuelField | null
                                // One column per field: taking it here frees it elsewhere.
                                if (v) for (let j = 0; j < next.length; j++) if (next[j] === v) next[j] = null
                                next[i] = v
                                setMapping(next)
                              }}
                              className="w-[34%] min-w-0 rounded-lg border border-navy-700 bg-navy-900 px-2 py-1 text-[12px] text-ink"
                              aria-label={`What the ${h || `column ${i + 1}`} column holds`}
                            >
                              <option value="">Ignore</option>
                              {FUEL_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                            <span className="flex-1 min-w-0 truncate text-[11px] text-faint font-mono">{sample(i)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-[12px] text-ink"><b>{preview.rows.length}</b> fuel purchase{preview.rows.length === 1 ? '' : 's'} · {money(preview.rows.reduce((a, r) => a + r.amount, 0))}
                      {preview.skipped.length ? <span className="text-faint"> · {preview.skipped.length} line{preview.skipped.length === 1 ? '' : 's'} left out</span> : null}
                      {preview.rows.length ? <span className="text-faint"> · {Math.round((preview.rows.filter((r) => r.hasTime).length / preview.rows.length) * 100)}% with a time, {Math.round((preview.rows.filter((r) => r.gallons != null).length / preview.rows.length) * 100)}% with gallons</span> : null}
                    </p>
                    {skippedWhy.length > 0 && (
                      <ul className="mt-1 text-[11.5px] text-faint list-disc pl-5">
                        {skippedWhy.map(([why, n]) => <li key={why}>{why}: {n}</li>)}
                      </ul>
                    )}
                    <ul className="mt-2 divide-y divide-navy-800 rounded-lg border border-navy-700 bg-navy-900">
                      {preview.rows.slice(0, 5).map((r) => (
                        <li key={r.dedupeKey} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                          <span className="flex-none w-[78px] text-faint tabular-nums">{r.txnDate.slice(5)}{r.hasTime && r.txnAtMs != null ? ` ${new Date(r.txnAtMs).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                          <span className="flex-1 min-w-0 truncate text-ink">{r.merchant}</span>
                          <span className="flex-none text-muted tabular-nums">{money(r.amount)}{r.gallons != null ? ` · ${r.gallons.toFixed(1)} gal` : ''}</span>
                        </li>
                      ))}
                      {preview.rows.length > 5 && <li className="px-3 py-1.5 text-[11.5px] text-faint">and {preview.rows.length - 5} more</li>}
                    </ul>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={doImport} disabled={!writable || pending || !preview.rows.length}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber px-4 py-2 text-[12.5px] font-bold text-navy-950 disabled:opacity-40">
                      {pending ? 'Importing and checking…' : `Import ${preview.rows.length}`}
                    </button>
                    <button type="button" onClick={() => load('', null)} className="text-[12px] text-faint hover:text-ink">Clear</button>
                    {pending && <span className="text-[11.5px] text-faint">Placing stations and reading the trucks — up to a minute.</span>}
                  </div>
                  <p className="text-[11px] text-faint">Columns we don&apos;t need are kept with the purchase, never shown elsewhere. {FIELD_LABEL.gallons} and the time of day make the checks much stronger.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function AddOne({ todayKey, vehicles, writable }: { todayKey: string; vehicles: FuelVehicleView[]; writable: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const blank = { date: todayKey, time: '', merchant: '', address: '', city: '', state: '', amount: '', gallons: '', product: '' as FuelProduct | '', last4: '', assetId: '' }
  const [f, setF] = useState(blank)
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const save = () => start(async () => {
    const r = await addFuelTxnAction({
      date: f.date, time: f.time || null, merchant: f.merchant, address: f.address || null, city: f.city || null, state: f.state || null,
      amount: Number(f.amount), gallons: f.gallons ? Number(f.gallons) : null, product: f.product || null, last4: f.last4 || null, assetId: f.assetId || null,
    })
    if (!r?.ok) { toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
    toast('Added and checked.', { variant: 'success' })
    setF({ ...blank, date: f.date })
    router.refresh()
  })
  const input = 'min-w-0 rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-[12.5px] text-ink outline-none focus:border-amber/50 disabled:opacity-50'
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={f.date} max={todayKey} onChange={set('date')} disabled={!writable} className={input} aria-label="Date" />
        <input value={f.time} onChange={set('time')} placeholder="Time (7:42 AM)" disabled={!writable} className={input} aria-label="Time" />
      </div>
      <input value={f.merchant} onChange={set('merchant')} placeholder="Station (Spinx #0156)" disabled={!writable} className={`${input} w-full`} aria-label="Station" />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input value={f.city} onChange={set('city')} placeholder="City" disabled={!writable} className={input} aria-label="City" />
        <input value={f.state} onChange={set('state')} placeholder="ST" maxLength={2} disabled={!writable} className={`${input} w-16 uppercase`} aria-label="State" />
      </div>
      <input value={f.address} onChange={set('address')} placeholder="Street address (optional — places it exactly)" disabled={!writable} className={`${input} w-full`} aria-label="Street address" />
      <div className="grid grid-cols-3 gap-2">
        <input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="$ amount" disabled={!writable} className={input} aria-label="Amount" />
        <input inputMode="decimal" value={f.gallons} onChange={set('gallons')} placeholder="Gallons" disabled={!writable} className={input} aria-label="Gallons" />
        <select value={f.product} onChange={set('product')} disabled={!writable} className={input} aria-label="Product">
          <option value="">Fuel</option><option value="diesel">Diesel</option><option value="gas">Gas</option><option value="def">DEF</option>
        </select>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <input inputMode="numeric" value={f.last4} onChange={set('last4')} placeholder="Card …" maxLength={4} disabled={!writable} className={`${input} w-24`} aria-label="Card last four" />
        <select value={f.assetId} onChange={set('assetId')} disabled={!writable} className={input} aria-label="Vehicle">
          <option value="">The card&apos;s vehicle</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <button type="button" onClick={save} disabled={!writable || pending || !f.merchant.trim() || !(Number(f.amount) > 0)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber px-4 py-2 text-[12.5px] font-bold text-navy-950 disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> {pending ? 'Adding…' : 'Add and check'}
      </button>
    </div>
  )
}
