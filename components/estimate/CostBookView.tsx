'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BookOpen, Plus, Pencil, Trash2, ClipboardPaste, MapPin } from 'lucide-react'
import type { CostBook, CostPrice } from '@/lib/db/estimate'
import { PRICE_UNITS, crewKeyOf, type Markups, type Material, type PriceUnit, type Settings } from '@/lib/estimate/engine'
import { PLACE_KIND_META } from '@/components/map/PlaceSheet'
import {
  saveMaterialAction, deleteMaterialAction, savePriceAction, deletePriceAction, importPricesAction,
  saveCostSettingsAction, saveMarkupDefaultsAction,
} from '@/lib/actions/estimate'

const money = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const today = () => new Date().toLocaleDateString('en-CA')
const n = (s: string) => (s.trim() === '' ? null : Number(s))
const kindLabel = (k: string) => (PLACE_KIND_META as Record<string, { label: string; emoji: string }>)[k] ?? { label: k, emoji: '📍' }
const input = 'rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink text-[12.5px]'

/**
 * The cost book (migration 147). Company-wide: what DCG buys and where, at
 * what price on what date; the haul truck and the crews; and — for Admins —
 * the margins. Sources are places on the map, because a price is only worth
 * something with a road distance to the site.
 */
export function CostBookView({ book, canEdit, canManage, canMargins, showMargins, demo }: {
  book: CostBook
  canEdit: boolean
  canManage: boolean
  canMargins: boolean
  showMargins: boolean
  demo: boolean
}) {
  const [tab, setTab] = useState<'prices' | 'materials' | 'haul' | 'margins'>('prices')
  const tabs = (['prices', 'materials', 'haul', ...(showMargins ? ['margins'] : [])] as const) as readonly ('prices' | 'materials' | 'haul' | 'margins')[]
  const label = { prices: 'Sources & prices', materials: `Materials (${book.materials.length})`, haul: 'Haul & crews', margins: 'Margins' } as const
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href="/plans" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Plans</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><BookOpen className="h-5 w-5 text-amber" /> Cost book</h1>
          <p className="text-[12.5px] text-faint">What you buy and where, at what price on what date — the estimate prices every line from here, with the haul from each source by road.</p>
        </div>
        {!book.available && !demo && <p className="text-sm text-amber">The cost book isn’t ready on this database yet.</p>}
        {demo && <p className="text-sm text-faint">The demo has no cost book — sign in to a real company.</p>}
        <div className="flex gap-1.5 flex-wrap">
          {tabs.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (tab === t ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>{label[t]}</button>
          ))}
        </div>
        {tab === 'prices' && <Prices book={book} canEdit={canEdit} canManage={canManage} />}
        {tab === 'materials' && <Materials materials={book.materials} canEdit={canEdit} canManage={canManage} />}
        {tab === 'haul' && <Haul settings={book.settings} canEdit={canManage} />}
        {tab === 'margins' && showMargins && <Margins markups={book.markupDefaults} canEdit={canMargins} />}
      </div>
    </div>
  )
}

// ── Sources & prices ────────────────────────────────────────────────────────

interface PriceDraft { id?: string; placeId: string; materialId: string; price: string; unit: PriceUnit; basis: 'pickup' | 'delivered'; minCharge: string; fuelPct: string; quotedOn: string; note: string }

function Prices({ book, canEdit, canManage }: { book: CostBook; canEdit: boolean; canManage: boolean }) {
  const router = useRouter()
  const [draft, setDraft] = useState<PriceDraft | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [paste, setPaste] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const matName = useMemo(() => new Map(book.materials.map((m) => [m.id, m])), [book.materials])
  const bySource = useMemo(() => {
    const g = new Map<string, CostPrice[]>()
    for (const p of book.prices) { if (!g.has(p.placeId)) g.set(p.placeId, []); g.get(p.placeId)!.push(p) }
    return g
  }, [book.prices])

  const blank = (placeId: string): PriceDraft => {
    const m = book.materials[0]
    return { placeId, materialId: m?.id ?? '', price: '', unit: m?.unit ?? 'TON', basis: 'pickup', minCharge: '', fuelPct: '', quotedOn: today(), note: '' }
  }
  async function save() {
    if (!draft) return
    setErr(null)
    const r = await savePriceAction({
      id: draft.id, placeId: draft.placeId, materialId: draft.materialId, price: draft.price.trim() === '' ? null : Number(draft.price), unit: draft.unit, basis: draft.basis,
      minCharge: n(draft.minCharge), fuelPct: n(draft.fuelPct), quotedOn: draft.quotedOn, note: draft.note || null,
    }).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setDraft(null); router.refresh()
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this price?')) return
    const r = await deletePriceAction(id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    router.refresh()
  }
  async function importIt() {
    if (!paste?.trim()) return
    setErr(null); setResult(null)
    const r = await importPricesAction(paste).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t import — try again.'); return }
    setResult(`${r.added} price${r.added === 1 ? '' : 's'} added.${r.skipped.length ? ` ${r.skipped.length} row${r.skipped.length === 1 ? '' : 's'} skipped: ${r.skipped.slice(0, 6).map((s) => `row ${s.row} — ${s.why}`).join(' · ')}` : ''}`)
    setPaste(null); router.refresh()
  }

  return (
    <div className="space-y-3 text-[12.5px]">
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setPaste(paste === null ? '' : null)} className="inline-flex items-center gap-1.5 rounded-xl border border-teal/50 text-teal px-3 py-2"><ClipboardPaste className="h-4 w-4" /> Paste a price list</button>
          <Link href="/map" className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink"><MapPin className="h-4 w-4" /> Add a source on the map</Link>
        </div>
      )}
      {paste !== null && (
        <div className="rounded-xl border border-teal/40 bg-navy-900 p-3 space-y-2">
          <p className="text-faint">Copy the rows from Excel or Sheets — columns: <b className="text-muted">Source · Material · Price · Unit · Pickup or Delivered · Quoted date · Note</b>. Sources must already be places on the map; a new material is added to the book.</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value.slice(0, 200_000))} rows={6} className={input + ' w-full font-mono'} placeholder={'Quarry A\tABC stone\t21.50\tTON\tpickup\t2026-10-01'} />
          <div className="flex gap-2"><button type="button" onClick={() => void importIt()} className="rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5">Import</button><button type="button" onClick={() => setPaste(null)} className="text-faint hover:text-ink">Cancel</button></div>
        </div>
      )}
      {result && <p className="text-teal">{result}</p>}
      {err && <p className="text-red-400">{err}</p>}
      {book.sources.length === 0 ? (
        <p className="text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No sources yet. Drop a pin on the map for each quarry, asphalt or concrete plant, borrow pit, landfill — and the shop — and save it as a place of that kind. Their prices go here, and the estimate measures the road to each.
        </p>
      ) : book.sources.map((s) => {
        const ps = bySource.get(s.id) ?? []
        const k = kindLabel(s.kind)
        return (
          <section key={s.id} className="rounded-xl border border-navy-800 bg-navy-900">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-navy-800">
              <span>{k.emoji}</span>
              <span className="font-semibold text-ink flex-1 min-w-0 truncate">{s.name}</span>
              <span className="text-faint">{k.label}</span>
              {canEdit && book.materials.length > 0 && <button type="button" onClick={() => { setDraft(blank(s.id)); setErr(null) }} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /> Price</button>}
            </div>
            {ps.length === 0 && draft?.placeId !== s.id && <p className="px-3 py-2 text-faint">No prices yet.</p>}
            {ps.map((p) => {
              const m = matName.get(p.materialId)
              const stale = Date.now() - Date.parse(`${p.quotedOn}T12:00:00Z`) > 180 * 86_400_000
              return (
                <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-navy-800 first:border-t-0">
                  <span className="flex-1 min-w-0">
                    <span className="block text-ink truncate">{m?.name ?? 'Material removed'}</span>
                    <span className={'block truncate ' + (stale ? 'text-amber' : 'text-faint')}>{p.basis === 'delivered' ? 'delivered' : 'picked up'} · quoted {fmtDay(p.quotedOn)}{stale ? ' (old quote)' : ''}{p.fuelPct ? ` · +${p.fuelPct}% fuel` : ''}{p.minCharge ? ` · min ${money(p.minCharge)}` : ''}{p.note ? ` · ${p.note}` : ''}</span>
                  </span>
                  <span className="font-mono text-ink whitespace-nowrap">{money(p.price)} / {p.unit}</span>
                  {canEdit && <>
                    <button type="button" aria-label="Edit price" onClick={() => setDraft({ id: p.id, placeId: p.placeId, materialId: p.materialId, price: String(p.price), unit: p.unit, basis: p.basis, minCharge: p.minCharge === null ? '' : String(p.minCharge), fuelPct: p.fuelPct === null ? '' : String(p.fuelPct), quotedOn: p.quotedOn, note: p.note ?? '' })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                    {canManage && <button type="button" aria-label="Delete price" onClick={() => void remove(p.id)} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </>}
                </div>
              )
            })}
            {draft?.placeId === s.id && (
              <div className="px-3 py-2.5 border-t border-amber/40 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={draft.materialId} onChange={(e) => { const m = matName.get(e.target.value); setDraft({ ...draft, materialId: e.target.value, unit: m?.unit ?? draft.unit }) }} aria-label="Material" className={input}>
                    {book.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <span className="text-faint">$</span>
                  <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" aria-label="Price" className={input + ' w-24'} />
                  <span className="text-faint">per</span>
                  <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as PriceUnit })} aria-label="Unit" className={input}>
                    {PRICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <select value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value as 'pickup' | 'delivered' })} aria-label="Pickup or delivered" className={input}>
                    <option value="pickup">picked up</option><option value="delivered">delivered</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1 text-faint">Quoted <input type="date" value={draft.quotedOn} onChange={(e) => setDraft({ ...draft, quotedOn: e.target.value })} className={input} /></label>
                  <label className="flex items-center gap-1 text-faint">Min $ <input value={draft.minCharge} onChange={(e) => setDraft({ ...draft, minCharge: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className={input + ' w-20'} /></label>
                  <label className="flex items-center gap-1 text-faint">Fuel <input value={draft.fuelPct} onChange={(e) => setDraft({ ...draft, fuelPct: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className={input + ' w-14'} /> %</label>
                  <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value.slice(0, 200) })} placeholder="Note (quote #, contact)" aria-label="Note" className={input + ' flex-1 min-w-[10rem]'} />
                </div>
                <div className="flex gap-2"><button type="button" onClick={() => void save()} className="rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5">Save price</button><button type="button" onClick={() => setDraft(null)} className="text-faint hover:text-ink">Cancel</button></div>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

// ── Materials ───────────────────────────────────────────────────────────────

function Materials({ materials, canEdit, canManage }: { materials: Material[]; canEdit: boolean; canManage: boolean }) {
  const router = useRouter()
  const [draft, setDraft] = useState<{ id?: string; name: string; unit: PriceUnit; tonsPerCy: string; wastePct: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!draft) return
    setErr(null)
    const r = await saveMaterialAction({ id: draft.id, name: draft.name, unit: draft.unit, tonsPerCy: n(draft.tonsPerCy), wastePct: Number(draft.wastePct) || 0 }).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setDraft(null); router.refresh()
  }
  async function remove(m: Material) {
    if (!window.confirm(`Delete ${m.name} and its prices from the book?`)) return
    const r = await deleteMaterialAction(m.id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    router.refresh()
  }
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-faint flex-1 min-w-[14rem]">Tons per CY turns a takeoff&apos;s area × depth into tons (ABC stone ~1.9, asphalt ~2.0); waste is added on top of the measured quantity.</p>
        {canEdit && <button type="button" onClick={() => { setDraft({ name: '', unit: 'TON', tonsPerCy: '', wastePct: '0' }); setErr(null) }} className="inline-flex items-center gap-1.5 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-3 py-2"><Plus className="h-4 w-4" /> New material</button>}
      </div>
      {draft && (
        <div className="rounded-xl border border-amber/40 bg-navy-900 p-3 flex items-center gap-2 flex-wrap">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 80) })} placeholder="#57 stone" aria-label="Name" className={input + ' flex-1 min-w-[10rem]'} />
          <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as PriceUnit })} aria-label="Sold by" className={input}>{PRICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
          <label className="flex items-center gap-1 text-faint">t/CY <input value={draft.tonsPerCy} onChange={(e) => setDraft({ ...draft, tonsPerCy: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className={input + ' w-14'} /></label>
          <label className="flex items-center gap-1 text-faint">Waste <input value={draft.wastePct} onChange={(e) => setDraft({ ...draft, wastePct: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className={input + ' w-12'} /> %</label>
          <button type="button" onClick={() => void save()} className="rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5">Save</button>
          <button type="button" onClick={() => setDraft(null)} className="text-faint hover:text-ink">Cancel</button>
        </div>
      )}
      {err && <p className="text-red-400">{err}</p>}
      {materials.length === 0 ? <p className="text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">No materials yet — add them here, or paste a price list and they are added for you.</p> : (
        <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
          {materials.map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2">
              <span className="text-ink flex-1 min-w-0 truncate">{m.name}</span>
              <span className="text-faint whitespace-nowrap">per {m.unit}{m.tonsPerCy ? ` · ${m.tonsPerCy} t/CY` : ''}{m.wastePct ? ` · ${m.wastePct}% waste` : ''}</span>
              {canEdit && <button type="button" aria-label={`Edit ${m.name}`} onClick={() => setDraft({ id: m.id, name: m.name, unit: m.unit, tonsPerCy: m.tonsPerCy === null ? '' : String(m.tonsPerCy), wastePct: String(m.wastePct) })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>}
              {canManage && <button type="button" aria-label={`Delete ${m.name}`} onClick={() => void remove(m)} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Haul and crews ──────────────────────────────────────────────────────────

function Haul({ settings, canEdit }: { settings: Settings; canEdit: boolean }) {
  const router = useRouter()
  const [s, setS] = useState(settings)
  const [crewName, setCrewName] = useState('')
  const [crewRate, setCrewRate] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const field = (labelTxt: string, v: number, on: (x: number) => void, unit = '') => (
    <label className="flex items-center gap-1.5 text-faint">{labelTxt}
      <input defaultValue={String(v)} disabled={!canEdit} onBlur={(e) => { const x = Number(e.target.value); if (Number.isFinite(x) && x >= 0) on(x) }} inputMode="decimal" className={input + ' w-20'} />{unit}
    </label>
  )
  async function save() {
    setMsg(null)
    const r = await saveCostSettingsAction(s).catch(() => null)
    setMsg(r?.ok ? 'Saved.' : r && !r.ok ? r.error : 'Couldn’t save — try again.')
    if (r?.ok) router.refresh()
  }
  return (
    <div className="space-y-3 text-[12.5px]">
      <section className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2">
        <h3 className="text-ink font-semibold">Haul truck</h3>
        <div className="flex items-center gap-3 flex-wrap">
          {field('Carries', s.haul.truckTons, (x) => setS({ ...s, haul: { ...s.haul, truckTons: x } }), 'tons')}
          {field('or', s.haul.truckCy, (x) => setS({ ...s, haul: { ...s.haul, truckCy: x } }), 'CY')}
          {field('Costs', s.haul.ratePerHr, (x) => setS({ ...s, haul: { ...s.haul, ratePerHr: x } }), '$/hr')}
          {field('Load + dump', s.haul.loadMin, (x) => setS({ ...s, haul: { ...s.haul, loadMin: x } }), 'min')}
        </div>
        <p className="text-faint">A load&apos;s haul = (drive there + back + load and dump) × the truck&apos;s $/hr. Drive times are road minutes with no traffic.</p>
      </section>
      <section className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2">
        <h3 className="text-ink font-semibold">Lowboy (mobilization)</h3>
        <div className="flex items-center gap-3 flex-wrap">
          {field('Costs', s.lowboy.ratePerHr, (x) => setS({ ...s, lowboy: { ...s.lowboy, ratePerHr: x } }), '$/hr')}
          {field('Load + unload', s.lowboy.loadMin, (x) => setS({ ...s, lowboy: { ...s.lowboy, loadMin: x } }), 'min')}
          {field('Working day', s.hoursPerDay, (x) => setS({ ...s, hoursPerDay: x }), 'hours')}
        </div>
      </section>
      <section className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2">
        <h3 className="text-ink font-semibold">Crews</h3>
        <p className="text-faint">A crew&apos;s $/hr is its people and machines together; each estimate line says how much the crew does in a day.</p>
        {s.crews.map((c) => (
          <div key={c.key} className="flex items-center gap-2">
            <span className="text-ink flex-1">{c.name}</span>
            <span className="font-mono text-muted">{money(c.ratePerHr)}/hr</span>
            {canEdit && <button type="button" aria-label={`Remove ${c.name}`} onClick={() => setS({ ...s, crews: s.crews.filter((x) => x.key !== c.key) })} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <input value={crewName} onChange={(e) => setCrewName(e.target.value.slice(0, 60))} placeholder="Paving crew" aria-label="Crew name" className={input + ' flex-1 min-w-[10rem]'} />
            <input value={crewRate} onChange={(e) => setCrewRate(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="$/hr" inputMode="decimal" aria-label="Crew $/hr" className={input + ' w-24'} />
            <button type="button" disabled={!crewName.trim() || !(Number(crewRate) > 0)} onClick={() => {
              const key = crewKeyOf(crewName)
              setS({ ...s, crews: [...s.crews.filter((x) => x.key !== key), { key, name: crewName.trim(), ratePerHr: Number(crewRate) }] })
              setCrewName(''); setCrewRate('')
            }} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1.5 text-muted disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add crew</button>
          </div>
        )}
      </section>
      {canEdit ? (
        <div className="flex items-center gap-3"><button type="button" onClick={() => void save()} className="rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2">Save haul and crews</button>{msg && <span className={msg === 'Saved.' ? 'text-teal' : 'text-red-400'}>{msg}</span>}</div>
      ) : <p className="text-faint">Managers and above change these.</p>}
    </div>
  )
}

// ── Margins (Admins) ────────────────────────────────────────────────────────

export function MarkupFields({ value, onChange, disabled }: { value: Markups; onChange: (m: Markups) => void; disabled?: boolean }) {
  const f = (k: keyof Markups, labelTxt: string) => (
    <label className="flex items-center gap-1.5 text-faint">{labelTxt}
      <input defaultValue={String(value[k])} disabled={disabled} onBlur={(e) => { const x = Number(e.target.value); if (Number.isFinite(x) && x >= 0 && x <= 100) onChange({ ...value, [k]: x }) }} inputMode="decimal" className={input + ' w-16'} /> %
    </label>
  )
  return (
    <div className="flex items-center gap-3 flex-wrap text-[12.5px]">
      {f('overheadPct', 'Overhead')}{f('contingencyPct', 'Contingency')}{f('profitPct', 'Profit')}{f('taxPct', 'Sales tax on materials')}{f('bondPct', 'Bond')}
    </div>
  )
}

function Margins({ markups, canEdit }: { markups: Markups | null; canEdit: boolean }) {
  const [m, setM] = useState<Markups>(markups ?? { overheadPct: 0, contingencyPct: 0, profitPct: 0, bondPct: 0, taxPct: 0 })
  const [msg, setMsg] = useState<string | null>(null)
  async function save() {
    const r = await saveMarkupDefaultsAction(m).catch(() => null)
    setMsg(r?.ok ? 'Saved.' : r && !r.ok ? r.error : 'Couldn’t save — try again.')
  }
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-3 text-[12.5px]">
      <p className="text-faint">Every new estimate starts with these; each estimate can change its own. Only Admins see margins — Managers see costs, Foremen no dollars.</p>
      <MarkupFields value={m} onChange={setM} disabled={!canEdit} />
      <p className="text-faint">Overhead and contingency on the direct cost, profit on that, sales tax on materials, the bond on the total.</p>
      {canEdit && <div className="flex items-center gap-3"><button type="button" onClick={() => void save()} className="rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2">Save margins</button>{msg && <span className={msg === 'Saved.' ? 'text-teal' : 'text-red-400'}>{msg}</span>}</div>}
    </div>
  )
}
