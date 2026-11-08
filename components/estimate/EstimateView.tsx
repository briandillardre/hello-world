'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Calculator, Route, BookOpen, Layers, Plus, Trash2, ChevronDown, AlertTriangle } from 'lucide-react'
import type { CostBook } from '@/lib/db/estimate'
import type { EstimateRow } from '@/lib/db/estimate'
import {
  lineCost, sourceOptions, totals, trucksNeeded,
  type Distance, type Line, type LineUnit, type Markups,
} from '@/lib/estimate/engine'
import {
  createEstimateAction, saveEstimateAction, saveEstimateMarkupsAction, refreshDistancesAction, deleteEstimateAction,
} from '@/lib/actions/estimate'
import { MarkupFields } from './CostBookView'

const money = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const money2 = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 }))
const UNITS: LineUnit[] = ['LF', 'SF', 'SY', 'AC', 'EA', 'CY', 'TON', 'LS']
const input = 'rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink text-[12.5px]'
const newId = () => Math.random().toString(36).slice(2, 12)

/**
 * A site's estimate (migration 147; the plan doc's "how a bid price builds
 * up"): one line per takeoff item, each priced from the cost book — the
 * material at the source that delivers it cheapest by road (or one pinned),
 * the haul by the load, the crew by the day, a sub's quote — then the
 * markups. Every number is computed here from the choices (the engine the
 * server would run), and the choices save themselves.
 */
export function EstimateView({ zone, book, estimate, markups, distances, snapshots, canEdit, canManage, canMargins, showMargins, demo }: {
  zone: { id: string; name: string }
  book: CostBook
  estimate: EstimateRow | null
  markups: Markups | null
  distances: Record<string, Distance>
  snapshots: { id: string; name: string; createdAt: string }[]
  canEdit: boolean
  canManage: boolean
  canMargins: boolean
  showMargins: boolean
  demo: boolean
}) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>(estimate?.lines ?? [])
  const [name, setName] = useState(estimate?.name ?? '')
  const [status, setStatus] = useState(estimate?.status ?? 'draft')
  const [mk, setMk] = useState<Markups | null>(markups)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The save waiting on the timer, so leaving the page (or switching estimates)
  // sends it instead of dropping it (ship-check, Nov 8).
  const pending = useRef<{ id: string; data: { lines: Line[]; name: string; status: typeof status } } | null>(null)
  const flush = useRef(() => {})
  flush.current = () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    if (timer.current) clearTimeout(timer.current)
    void saveEstimateAction(p.id, p.data).catch(() => null)
  }
  useEffect(() => {
    const onHide = () => flush.current()
    window.addEventListener('pagehide', onHide)
    return () => { window.removeEventListener('pagehide', onHide); flush.current() }
  }, [])
  useEffect(() => {
    flush.current()
    setLines(estimate?.lines ?? []); setName(estimate?.name ?? ''); setStatus(estimate?.status ?? 'draft')
    // The markups come with the estimate: a new one's (or the next one's after a delete) — never the last one's.
    setMk(markups)
  }, [estimate?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dist = useMemo(() => new Map(Object.entries(distances)), [distances])
  const shop = useMemo(() => {
    const s = book.sources.find((x) => x.kind === 'shop' && dist.has(x.id))
    return s ? dist.get(s.id)! : null
  }, [book.sources, dist])
  const ctx = useMemo(() => ({ materials: book.materials, prices: book.prices, sources: book.sources, distances: dist, settings: book.settings, shop }), [book, dist, shop])
  const costs = useMemo(() => lines.map((line) => ({ line, cost: lineCost(line, ctx) })), [lines, ctx])
  const t = useMemo(() => totals(costs, mk ?? { overheadPct: 0, contingencyPct: 0, profitPct: 0, bondPct: 0, taxPct: 0 }), [costs, mk])
  const sections = useMemo(() => {
    const g = new Map<string, typeof costs>()
    for (const c of costs) { const k = c.line.section ?? 'Other'; if (!g.has(k)) g.set(k, []); g.get(k)!.push(c) }
    return Array.from(g.entries())
  }, [costs])
  const warnings = costs.reduce((n, c) => n + c.cost.warnings.length, 0)
  const distAge = Object.keys(distances).length

  // Save the choices a moment after the last change.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!estimate || !canEdit) return
    setSaved('dirty')
    if (timer.current) clearTimeout(timer.current)
    pending.current = { id: estimate.id, data: { lines, name, status } }
    timer.current = setTimeout(async () => {
      pending.current = null
      setSaved('saving')
      const r = await saveEstimateAction(estimate.id, { lines, name, status }).catch(() => null)
      setSaved(r?.ok ? 'saved' : 'error')
      if (!r?.ok) setErr(r && !r.ok ? r.error : 'Couldn’t save — check signal; your changes are still here.')
    }, 1200)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [lines, name, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  async function start(snapshotId: string | null) {
    setBusy('start'); setErr(null)
    const r = await createEstimateAction(zone.id, snapshotId).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t start the estimate — try again.'); return }
    router.refresh()
  }
  async function distancesNow() {
    setBusy('dist'); setErr(null)
    const r = await refreshDistancesAction(zone.id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t measure the distances — try again.'); return }
    if (r.missing) setErr(`${r.missing} source${r.missing === 1 ? '' : 's'} had no road route (more than ~150 miles away, or past the 60 nearest sources).`)
    router.refresh()
  }
  async function saveMarkups(next: Markups) {
    setMk(next)
    if (!estimate) return
    const r = await saveEstimateMarkupsAction(estimate.id, next).catch(() => null)
    if (!r?.ok) setErr(r && !r.ok ? r.error : 'Couldn’t save the margins — try again.')
  }
  async function drop() {
    if (!estimate || !window.confirm('Delete this estimate? The takeoff and the cost book stay.')) return
    const r = await deleteEstimateAction(estimate.id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    router.refresh()
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href={`/plans/${zone.id}/takeoff`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Takeoff</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Calculator className="h-5 w-5 text-amber" /> Estimate · {zone.name}</h1>
          <p className="text-[12.5px] text-faint">Each line priced from the cost book: material at the source that delivers it cheapest by road (or the one you pin), haul by the load, the crew by the day, a sub&apos;s quote. Drive times are road minutes with no traffic.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
          <Link href="/costbook" className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink"><BookOpen className="h-4 w-4" /> Cost book</Link>
          <Link href={`/plans/${zone.id}/takeoff`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink"><Layers className="h-4 w-4" /> Takeoff</Link>
          {canEdit && (
            <button type="button" disabled={busy === 'dist'} onClick={() => void distancesNow()} className="inline-flex items-center gap-1.5 rounded-xl border border-teal/50 text-teal px-3 py-2 disabled:opacity-50">
              <Route className="h-4 w-4" /> {busy === 'dist' ? 'Measuring the roads…' : distAge ? 'Measure the roads again' : 'Measure the roads to every source'}
            </button>
          )}
          {distAge > 0 && <span className="text-faint">{distAge} source{distAge === 1 ? '' : 's'} measured</span>}
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}

        {!book.available && !demo && <p className="text-sm text-amber">The cost book isn’t ready on this database yet.</p>}
        {demo && <p className="text-sm text-faint">The demo has no estimate — sign in to a real company.</p>}

        {!estimate ? (
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3 text-[12.5px]">
            <p className="text-ink font-semibold">No estimate yet</p>
            <p className="text-faint">Start one from this site&apos;s takeoff — every item becomes a line, plus mobilization. Then pick each line&apos;s material, crew and production.</p>
            {canEdit && (
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" disabled={busy === 'start'} onClick={() => void start(null)} className="rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2 disabled:opacity-50">From the takeoff as it stands</button>
                {snapshots.map((s) => (
                  <button key={s.id} type="button" disabled={busy === 'start'} onClick={() => void start(s.id)} className="rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink disabled:opacity-50">From “{s.name}”</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
              <input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value.slice(0, 120))} aria-label="Estimate name" className={input + ' flex-1 min-w-[12rem] font-semibold'} />
              <select value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status" className={input}>
                <option value="draft">Draft</option><option value="sent">Sent</option><option value="won">Won</option><option value="lost">Lost</option>
              </select>
              <span className={'text-[11.5px] ' + (saved === 'error' ? 'text-red-400' : 'text-faint')}>{saved === 'saving' ? 'Saving…' : saved === 'dirty' ? 'Changes…' : saved === 'error' ? 'Not saved' : 'Saved'}</span>
              {canManage && <button type="button" aria-label="Delete estimate" onClick={() => void drop()} className="rounded-lg p-1.5 text-faint hover:text-red-400"><Trash2 className="h-4 w-4" /></button>}
            </div>
            {warnings > 0 && <p className="text-[12.5px] text-amber flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {warnings} thing{warnings === 1 ? '' : 's'} to settle before this price is whole — see the amber notes on the lines.</p>}

            {sections.map(([sec, cs]) => (
              <section key={sec}>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5 flex items-center gap-2">{sec}<span className="normal-case tracking-normal text-muted">{money(cs.reduce((s, c) => s + c.cost.total, 0))}</span></h2>
                <div className="space-y-2">
                  {cs.map(({ line, cost }) => <LineCard key={line.id} line={line} cost={cost} book={book} dist={dist} canEdit={canEdit} onEdit={(p) => edit(line.id, p)} onDelete={() => setLines((ls) => ls.filter((l) => l.id !== line.id))} />)}
                </div>
              </section>
            ))}
            {canEdit && (
              <button type="button" onClick={() => setLines((ls) => [...ls, { id: newId(), section: 'Other', code: null, name: 'New line', unit: 'LS', qty: 1, depthIn: null, materialId: null, placeId: null, wastePct: null, crewKey: null, perDay: null, subUnit: null, lowboyTrips: null, note: null }])}
                className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink"><Plus className="h-4 w-4" /> Add a line</button>
            )}

            <section className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2 text-[12.5px]">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">The price</h2>
              <Row label="Direct cost" v={t.direct} bold />
              <Row label="  of which materials" v={t.materials} muted />
              {showMargins && mk ? (
                <>
                  <MarkupFields value={mk} onChange={(m) => void saveMarkups(m)} disabled={!canMargins} />
                  <Row label={`Overhead ${mk.overheadPct}%`} v={t.overhead} />
                  <Row label={`Contingency ${mk.contingencyPct}%`} v={t.contingency} />
                  <Row label={`Profit ${mk.profitPct}%`} v={t.profit} />
                  <Row label={`Sales tax on materials ${mk.taxPct}%`} v={t.tax} />
                  <Row label={`Bond ${mk.bondPct}%`} v={t.bond} />
                  <Row label="Bid" v={t.bid} bold big />
                </>
              ) : (
                <p className="text-faint">Margins and the bid total are set by an Admin.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, v, bold, big, muted }: { label: string; v: number; bold?: boolean; big?: boolean; muted?: boolean }) {
  return (
    <div className={'flex items-center justify-between ' + (big ? 'text-[15px] border-t border-navy-700 pt-2' : '')}>
      <span className={muted ? 'text-faint' : 'text-muted'}>{label}</span>
      <span className={'font-mono ' + (bold ? 'text-ink font-bold' : muted ? 'text-faint' : 'text-ink')}>{money(v)}</span>
    </div>
  )
}

function LineCard({ line, cost, book, dist, canEdit, onEdit, onDelete }: {
  line: Line
  cost: ReturnType<typeof lineCost>
  book: CostBook
  dist: Map<string, Distance>
  canEdit: boolean
  onEdit: (p: Partial<Line>) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const opts = useMemo(() => (line.materialId ? sourceOptions(line.materialId, book.materials, book.prices, book.sources, dist, book.settings) : []), [line.materialId, book, dist])
  const crew = line.crewKey ? book.settings.crews.find((c) => c.key === line.crewKey) : undefined
  const trucks = useMemo(() => {
    if (!cost.source || cost.source.basis !== 'pickup' || !cost.loads || !cost.crewDays || cost.crewDays <= 0) return null
    const d = dist.get(cost.source.placeId)
    if (!d) return null
    const loadsPerDay = cost.loads / cost.crewDays
    return loadsPerDay > 0 ? trucksNeeded(d, book.settings, (book.settings.hoursPerDay * 60) / loadsPerDay) : null
  }, [cost, dist, book.settings])
  const numIn = (v: number | null, on: (x: number | null) => void, w = 'w-20', ph = '') => (
    <input defaultValue={v === null ? '' : String(v)} disabled={!canEdit} placeholder={ph} inputMode="decimal"
      onBlur={(e) => { const s = e.target.value.trim(); const x = Number(s); on(s === '' ? null : Number.isFinite(x) && x >= 0 ? x : v) }} className={input + ' ' + w} />
  )
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900 p-2.5 text-[12.5px] space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((x) => !x)} className="flex-1 min-w-0 text-left flex items-center gap-2" aria-expanded={open}>
          <ChevronDown className={'h-4 w-4 text-faint flex-none transition-transform ' + (open ? '' : '-rotate-90')} />
          <span className="min-w-0">
            <span className="block text-ink truncate">{line.code && <b className="font-mono mr-1">{line.code}</b>}{line.name}</span>
            <span className="block text-faint truncate">
              {line.unit === 'LS' ? 'lump sum' : `${fmt(line.qty)} ${line.unit}`}
              {cost.source ? ` · ${cost.source.name}` : ''}{crew ? ` · ${crew.name}` : ''}{line.subUnit ? ' · sub' : ''}
              {cost.unitCost !== null ? ` · ${money2(cost.unitCost)}/${line.unit}` : ''}
            </span>
          </span>
        </button>
        <span className="font-mono font-bold text-ink whitespace-nowrap">{money(cost.total)}</span>
      </div>
      {cost.warnings.map((w, i) => <p key={i} className="text-amber text-[11.5px] pl-6">{w}</p>)}
      {open && (
        <div className="pl-6 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input defaultValue={line.name} disabled={!canEdit} onBlur={(e) => e.target.value.trim() && onEdit({ name: e.target.value.trim().slice(0, 120) })} aria-label="Line name" className={input + ' flex-1 min-w-[10rem]'} />
            <input defaultValue={line.section ?? ''} disabled={!canEdit} onBlur={(e) => onEdit({ section: e.target.value.trim().slice(0, 40) || null })} placeholder="Section" aria-label="Section" className={input + ' w-32'} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-faint">Qty {numIn(line.qty, (x) => onEdit({ qty: x ?? 0 }), 'w-24')}</label>
            <select value={line.unit} disabled={!canEdit} onChange={(e) => onEdit({ unit: e.target.value as LineUnit })} aria-label="Unit" className={input}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
            {(line.unit === 'SY' || line.unit === 'SF' || line.unit === 'AC') && <label className="flex items-center gap-1 text-faint">Depth {numIn(line.depthIn, (x) => onEdit({ depthIn: x }), 'w-14')} in</label>}
            <label className="flex items-center gap-1 text-faint">Waste {numIn(line.wastePct, (x) => onEdit({ wastePct: x }), 'w-14', 'book')} %</label>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={line.materialId ?? ''} disabled={!canEdit} onChange={(e) => onEdit({ materialId: e.target.value || null, placeId: null })} aria-label="Material" className={input + ' max-w-[14rem]'}>
              <option value="">No material</option>
              {book.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {line.materialId && (
              <select value={line.placeId ?? ''} disabled={!canEdit} onChange={(e) => onEdit({ placeId: e.target.value || null })} aria-label="Source" className={input + ' max-w-full'}>
                <option value="">Cheapest delivered{opts[0] ? ` (${opts[0].name})` : ''}</option>
                {opts.map((o) => (
                  <option key={o.placeId} value={o.placeId}>
                    {o.name} — {money2(o.plant)}{o.basis === 'pickup' ? (o.haulPerUnit !== null ? ` + ${money2(o.haulPerUnit)} haul = ${money2(o.delivered ?? 0)}` : ' + haul (no distance yet)') : ' delivered'}/{o.unit}{o.miles !== null ? ` · ${o.miles} mi` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={line.crewKey ?? ''} disabled={!canEdit} onChange={(e) => onEdit({ crewKey: e.target.value || null })} aria-label="Crew" className={input}>
              <option value="">No crew</option>
              {book.settings.crews.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
            {line.crewKey && <label className="flex items-center gap-1 text-faint">does {numIn(line.perDay, (x) => onEdit({ perDay: x }), 'w-20')} {line.unit}/day</label>}
            <label className="flex items-center gap-1 text-faint">Sub $ {numIn(line.subUnit, (x) => onEdit({ subUnit: x }), 'w-20')} /{line.unit}</label>
            {line.unit === 'LS' && <label className="flex items-center gap-1 text-faint">Lowboy trips {numIn(line.lowboyTrips, (x) => onEdit({ lowboyTrips: x }), 'w-14')}</label>}
          </div>
          <div className="rounded-lg bg-navy-950 border border-navy-800 px-2.5 py-2 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            <Part label="Material" v={cost.material} sub={cost.materialQty !== null ? `${fmt(cost.materialQty)} ${cost.materialUnit}` : null} />
            <Part label="Haul" v={cost.haul} sub={cost.loads ? `${cost.loads} load${cost.loads === 1 ? '' : 's'}${trucks ? ` · ~${trucks} trucks` : ''}` : null} />
            <Part label="Install" v={cost.install} sub={cost.crewDays !== null ? `${cost.crewDays} crew-days` : null} />
            <Part label="Sub" v={cost.sub} sub={null} />
            <Part label="Lowboy" v={cost.lowboy} sub={null} />
          </div>
          {canEdit && <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 text-faint hover:text-red-400 text-[11.5px]"><Trash2 className="h-3.5 w-3.5" /> Remove line</button>}
        </div>
      )}
    </div>
  )
}

function Part({ label, v, sub }: { label: string; v: number; sub: string | null }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wide text-faint">{label}</p>
      <p className="font-mono text-ink">{money(v)}</p>
      {sub && <p className="text-[10.5px] text-faint">{sub}</p>}
    </div>
  )
}
