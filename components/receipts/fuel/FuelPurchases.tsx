'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock, HelpCircle } from 'lucide-react'
import { toast } from '@/components/ui/feedback'
import { NO_REPLY } from '@/lib/action-reply'
import { CHECK_KINDS, KIND_SHORT, MISSING_LABEL, type CheckOutcome, type StoredCheck } from '@/lib/fuel-check'
import type { FuelPilotView, FuelTxnView } from '@/lib/db/fuel-check'
import { excludeFuelTxnAction, setFuelTxnVehicleAction } from '@/lib/actions/fuel-check'
import { money, whenWords } from './FuelPilot'

/**
 * Every purchase with its four checks — a pip per check (passed, exception,
 * couldn't check, waiting), the sentences behind them on a tap, and the two
 * fixes a person can make here: read it against another vehicle, or mark it
 * "not a fuel purchase" (the store, not the pump).
 */
const PIP: Record<CheckOutcome, { icon: typeof Check; cls: string; word: string }> = {
  pass: { icon: Check, cls: 'border-teal/50 text-teal', word: 'passed' },
  exception: { icon: AlertTriangle, cls: 'border-red-400/60 bg-red-400/10 text-red-300', word: 'exception' },
  unknown: { icon: HelpCircle, cls: 'border-navy-600 text-faint', word: "couldn't check" },
  pending: { icon: Clock, cls: 'border-navy-600 text-faint', word: 'waiting' },
}
type Filter = 'all' | 'flagged' | 'unchecked' | 'excluded'

export function FuelPurchases({ view, tz, writable }: { view: FuelPilotView; tz: string; writable: boolean }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(40)
  const [openId, setOpenId] = useState<string | null>(null)
  const flagged = (t: FuelTxnView) => !!t.checks?.r.some((r) => r.o === 'exception')
  const list = useMemo(() => view.txns.filter((t) =>
    filter === 'excluded' ? t.excluded
      : t.excluded ? false
      : filter === 'flagged' ? flagged(t)
      : filter === 'unchecked' ? !t.checks
      : true), [view.txns, filter])
  const counts: Record<Filter, number> = {
    all: view.txns.filter((t) => !t.excluded).length,
    flagged: view.txns.filter((t) => !t.excluded && flagged(t)).length,
    unchecked: view.txns.filter((t) => !t.excluded && !t.checks).length,
    excluded: view.txns.filter((t) => t.excluded).length,
  }
  const LABEL: Record<Filter, string> = { all: 'All', flagged: 'Flagged', unchecked: 'Not checked', excluded: 'Not fuel' }
  return (
    <section className="space-y-2">
      <h2 className="font-display font-bold text-ink text-[15px]">Every purchase</h2>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(LABEL) as Filter[]).filter((f) => f === 'all' || counts[f] > 0).map((f) => (
          <button key={f} type="button" onClick={() => { setFilter(f); setShown(40) }}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${filter === f ? 'border-amber/50 bg-amber/10 text-amber' : 'border-navy-700 text-muted hover:text-ink'}`}>
            {LABEL[f]} <span className="font-normal text-faint">{counts[f]}</span>
          </button>
        ))}
      </div>
      <ul className="rounded-2xl border border-navy-700 bg-navy-850 divide-y divide-navy-800">
        {list.length === 0 && <li className="px-4 py-4 text-center text-[12.5px] text-muted">Nothing here.</li>}
        {list.slice(0, shown).map((t) => (
          <Row key={t.id} t={t} tz={tz} open={openId === t.id} onToggle={() => setOpenId((o) => (o === t.id ? null : t.id))} view={view} writable={writable} />
        ))}
      </ul>
      {list.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 60)} className="w-full rounded-xl border border-navy-700 bg-navy-900 py-2 text-[12.5px] text-muted hover:text-ink">
          Show more ({list.length - shown} left)
        </button>
      )}
    </section>
  )
}

function Row({ t, tz, open, onToggle, view, writable }: {
  t: FuelTxnView; tz: string; open: boolean; onToggle: () => void; view: FuelPilotView; writable: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const byKind = new Map((t.checks?.r ?? []).map((r) => [r.k, r]))
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | undefined>, done: string) => start(async () => {
    const r = await fn()
    if (!r?.ok) { toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
    toast(done, { variant: 'success' })
    router.refresh()
  })
  return (
    <li className={t.excluded ? 'opacity-60' : ''}>
      <button type="button" onClick={onToggle} className="w-full px-3 py-2.5 text-left" aria-expanded={open}>
        <div className="flex items-baseline gap-2">
          <span className="flex-1 min-w-0 truncate text-[13px] text-ink">{t.placeLabel ?? t.merchant}</span>
          <span className="flex-none font-semibold tabular-nums text-[13px] text-ink">{money(t.amount)}</span>
        </div>
        <div className="mt-1 flex items-start gap-2">
          <span className="flex-1 min-w-0 text-[11.5px] text-faint">
            {whenWords(t, tz)}{t.gallons != null ? ` · ${t.gallonsEstimated ? '~' : ''}${t.gallons.toFixed(1)} gal` : ''} · {t.assetName ?? (t.cardLast4 ? `…${t.cardLast4}, no vehicle` : 'no vehicle')}
          </span>
          <span className="flex-none flex items-center gap-1" aria-label="The four checks">
            {CHECK_KINDS.map((k) => {
              const r = byKind.get(k)
              const p = PIP[r?.o ?? 'pending']
              const Icon = r ? p.icon : Clock
              return (
                <span key={k} title={`${KIND_SHORT[k]}: ${r ? p.word : 'not checked yet'}`}
                  className={`grid h-5 w-5 place-items-center rounded-full border ${r ? p.cls : 'border-navy-700 text-navy-600'}`}>
                  <Icon className="h-3 w-3" />
                </span>
              )
            })}
            {open ? <ChevronUp className="h-3.5 w-3.5 text-faint" /> : <ChevronDown className="h-3.5 w-3.5 text-faint" />}
          </span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {!t.checks && <p className="text-[12px] text-faint">Not checked yet — the nightly run (or Re-check) gets to it.</p>}
          {CHECK_KINDS.map((k) => {
            const r = byKind.get(k) as StoredCheck | undefined
            if (!r) return null
            const p = PIP[r.o]
            return (
              <div key={k} className="flex gap-2">
                <span className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border ${p.cls}`}><p.icon className="h-3 w-3" /></span>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-ink">{KIND_SHORT[k]} <span className="font-normal text-faint">· {p.word}{r.o === 'exception' && r.d ? ` · ${money(r.d)} at risk` : ''}</span></p>
                  <p className="text-[12px] text-muted leading-snug">{r.e}</p>
                  {r.m.length > 0 && <p className="text-[10.5px] text-faint">Missing: {r.m.map((c) => MISSING_LABEL[c] ?? c).join(' · ')}</p>}
                </div>
              </div>
            )
          })}
          {(t.vehicleText || t.driverText) && <p className="text-[11px] text-faint">The export said: {[t.vehicleText && `vehicle “${t.vehicleText}”`, t.driverText && `driver “${t.driverText}”`].filter(Boolean).join(', ')}.</p>}
          {writable && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                value={t.assetSource === 'row' ? t.assetId ?? '' : ''}
                disabled={pending}
                onChange={(e) => act(() => setFuelTxnVehicleAction(t.id, e.target.value || null), 'Checked against that vehicle.')}
                className="flex-1 min-w-[160px] rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-[12px] text-ink" aria-label="Vehicle this purchase is checked against">
                <option value="">{t.assetSource === 'card' && t.assetName ? `The card's vehicle (${t.assetName})` : "The card's vehicle"}</option>
                {view.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button type="button" disabled={pending}
                onClick={() => act(() => excludeFuelTxnAction(t.id, !t.excluded, null), t.excluded ? 'Back in the pilot.' : 'Left out of the pilot.')}
                className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-1.5 text-[12px] text-muted hover:text-ink">
                {t.excluded ? 'It is fuel — put it back' : 'Not a fuel purchase'}
              </button>
            </div>
          )}
          {t.excluded && t.excludedReason && <p className="text-[11px] text-faint">Left out: {t.excludedReason}</p>}
        </div>
      )}
    </li>
  )
}
