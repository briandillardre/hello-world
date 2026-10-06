'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, CreditCard, Gauge, Settings2, Truck } from 'lucide-react'
import { toast } from '@/components/ui/feedback'
import { NO_REPLY } from '@/lib/action-reply'
import type { FuelCardView, FuelPilotView, FuelVehicleView } from '@/lib/db/fuel-check'
import { assignFuelCardAction, saveFuelPilotAction, setTankSizeAction } from '@/lib/actions/fuel-check'
import { money } from './FuelPilot'

/**
 * Cards & tanks: which vehicle each card fuels (from a date — a card that
 * moves to another truck keeps its history), each vehicle's tank size, and
 * the pilot's few settings. Without the first two, most checks can only say
 * "can't check" — the missing list above says which.
 */
export function FuelSetup({ view, todayKey, writable }: { view: FuelPilotView; todayKey: string; writable: boolean }) {
  const needs = view.cards.filter((c) => !c.assetId && c.purchases > 0).length + view.vehicles.filter((v) => !v.tankGal).length
  const [open, setOpen] = useState(view.txns.length > 0 && needs > 0)
  const firstOn = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of view.txns) if (t.cardLast4 && (!m.has(t.cardLast4) || t.txnDate < m.get(t.cardLast4)!)) m.set(t.cardLast4, t.txnDate)
    return m
  }, [view.txns])
  const nameOf = useMemo(() => new Map(view.vehicles.map((v) => [v.id, v.name])), [view.vehicles])
  return (
    <section className="rounded-2xl border border-navy-700 bg-navy-850">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Settings2 className="h-4 w-4 text-amber flex-none" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-ink text-[13.5px]">Cards &amp; tanks</span>
          <span className="block text-[11.5px] text-faint">{needs ? `${needs} thing${needs === 1 ? '' : 's'} to set — each one makes more purchases checkable` : 'Every card has a vehicle and every tank a size.'}</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
      </button>
      {open && (
        <div className="border-t border-navy-700 px-4 py-3 space-y-4">
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><CreditCard className="h-3.5 w-3.5 text-teal" /> Which vehicle each card fuels</p>
            {view.cards.length === 0 && <p className="text-[12px] text-faint">Cards show up here once purchases with a card number are imported.</p>}
            {view.cards.map((c) => (
              <CardRow key={c.last4} card={c} vehicles={view.vehicles} nameOf={nameOf} defaultFrom={firstOn.get(c.last4) ?? todayKey} todayKey={todayKey} writable={writable} />
            ))}
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><Gauge className="h-3.5 w-3.5 text-teal" /> Tank sizes</p>
            {view.vehicles.length === 0 && <p className="text-[12px] text-faint">No vehicles or machines on this account yet.</p>}
            {view.vehicles.map((v) => <TankRow key={v.id} v={v} writable={writable} />)}
          </div>
          <PilotSettings view={view} writable={writable} todayKey={todayKey} />
        </div>
      )}
    </section>
  )
}

function CardRow({ card, vehicles, nameOf, defaultFrom, todayKey, writable }: {
  card: FuelCardView; vehicles: FuelVehicleView[]; nameOf: Map<string, string>; defaultFrom: string; todayKey: string; writable: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [asset, setAsset] = useState(card.assetId ?? '')
  const [from, setFrom] = useState(card.assetId ? todayKey : defaultFrom)
  useEffect(() => { setAsset(card.assetId ?? '') }, [card.assetId])
  const changed = asset !== (card.assetId ?? '')
  const save = () => start(async () => {
    const r = await assignFuelCardAction(card.last4, asset || null, from)
    if (!r?.ok) { toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
    toast(`Card …${card.last4} saved — its purchases were checked again.`, { variant: 'success' })
    router.refresh()
  })
  const history = card.history.length > 1 ? card.history.map((h) => `${h.assetId ? nameOf.get(h.assetId) ?? 'a vehicle' : 'no vehicle'} from ${h.validFrom}`).join(' → ') : null
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900 px-3 py-2 space-y-1.5">
      <div className="flex items-baseline gap-2 text-[12.5px]">
        <span className="font-mono text-ink">…{card.last4}</span>
        <span className="flex-1 min-w-0 truncate text-faint">{[card.label, card.holder].filter(Boolean).join(' · ')}</span>
        <span className="flex-none text-faint tabular-nums">{card.purchases} · {money(card.dollars)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={asset} onChange={(e) => setAsset(e.target.value)} disabled={!writable || pending}
          className="flex-1 min-w-[150px] rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-[12.5px] text-ink disabled:opacity-50" aria-label={`Vehicle for card ending ${card.last4}`}>
          <option value="">No vehicle (a person&apos;s card)</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {changed && (
          <>
            <label className="flex items-center gap-1 text-[11.5px] text-faint">from
              <input type="date" value={from} max={todayKey} onChange={(e) => setFrom(e.target.value)} disabled={!writable || pending}
                className="rounded-lg border border-navy-700 bg-navy-950 px-2 py-1 text-[12px] text-ink" />
            </label>
            <button type="button" onClick={save} disabled={!writable || pending || !from}
              className="rounded-lg bg-amber px-3 py-1.5 text-[12px] font-bold text-navy-950 disabled:opacity-40">{pending ? 'Saving…' : 'Save'}</button>
          </>
        )}
      </div>
      {history && <p className="text-[11px] text-faint">{history}</p>}
    </div>
  )
}

function TankRow({ v, writable }: { v: FuelVehicleView; writable: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [val, setVal] = useState(v.tankGal != null ? String(v.tankGal) : '')
  useEffect(() => { setVal(v.tankGal != null ? String(v.tankGal) : '') }, [v.tankGal])
  const changed = val.trim() !== (v.tankGal != null ? String(v.tankGal) : '')
  const save = () => {
    if (!changed) return
    const n = val.trim() ? Number(val) : null
    if (n != null && !(n >= 3 && n <= 400)) { toast('A fuel tank is between 3 and 400 gallons.', { variant: 'error' }); return }
    start(async () => {
      const r = await setTankSizeAction(v.id, n)
      if (!r?.ok) { toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
      router.refresh()
    })
  }
  const gauge = !v.hasTracker ? 'no tracker' : v.reportsFuel === true ? 'sends fuel level' : v.reportsFuel === false ? 'no fuel level' : 'not reporting'
  return (
    <div className="flex items-center gap-2">
      <Truck className="h-3.5 w-3.5 flex-none text-faint" />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[12.5px] text-ink">{v.name}</span>
        <span className={`block text-[11px] ${v.reportsFuel ? 'text-teal' : 'text-faint'}`}>{gauge}{v.fuelType ? ` · ${v.fuelType}` : ''}{v.tankSource === 'notes' ? ' · size from its notes' : ''}</span>
      </span>
      <input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        placeholder="gal" disabled={!writable || pending} aria-label={`Tank size of ${v.name} in gallons`}
        className={`w-20 flex-none rounded-lg border bg-navy-950 px-2 py-1.5 text-right text-[12.5px] text-ink tabular-nums disabled:opacity-50 ${v.tankGal ? 'border-navy-700' : 'border-amber/40'}`} />
      <span className="flex-none text-[11px] text-faint w-6">gal</span>
    </div>
  )
}

function PilotSettings({ view, writable, todayKey }: { view: FuelPilotView; writable: boolean; todayKey: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const s = view.settings
  const init = { startedOn: s.startedOn ?? '', gasPrice: String(s.gasPrice), dieselPrice: String(s.dieselPrice), areaMiles: String(s.areaMiles), runtimeHours: String(s.runtimeHours) }
  const [f, setF] = useState(init)
  const changed = JSON.stringify(f) !== JSON.stringify(init)
  const save = () => start(async () => {
    const r = await saveFuelPilotAction({
      startedOn: f.startedOn || null, gasPrice: Number(f.gasPrice), dieselPrice: Number(f.dieselPrice),
      areaMiles: Number(f.areaMiles), runtimeHours: Number(f.runtimeHours),
    })
    if (!r?.ok) { toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
    toast('Saved — the next check uses them.', { variant: 'success' })
    router.refresh()
  })
  const input = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-[12.5px] text-ink tabular-nums disabled:opacity-50'
  const field = (k: keyof typeof init, label: string, hint: string, type = 'text') => (
    <label className="block">
      <span className="block text-[11.5px] text-muted">{label}</span>
      <input type={type} inputMode={type === 'text' ? 'decimal' : undefined} value={f[k]} max={type === 'date' ? todayKey : undefined}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} disabled={!writable || pending} className={input} />
      <span className="block text-[10.5px] text-faint">{hint}</span>
    </label>
  )
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><Settings2 className="h-3.5 w-3.5 text-teal" /> Pilot settings</p>
      <div className="grid grid-cols-2 gap-2">
        {field('startedOn', 'Pilot started', 'Day 1 of 90; set by the first import', 'date')}
        {field('areaMiles', 'Approved area (mi)', 'From a site, yard, place or the day’s route')}
        {field('gasPrice', 'Gas $/gal', 'Only to estimate gallons a line lacks')}
        {field('dieselPrice', 'Diesel $/gal', 'Only to estimate gallons a line lacks')}
        {field('runtimeHours', 'Ran-after window (h)', 'A fill or running must show up by then')}
      </div>
      {writable && changed && (
        <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-amber px-4 py-2 text-[12.5px] font-bold text-navy-950 disabled:opacity-40">
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      )}
    </div>
  )
}
