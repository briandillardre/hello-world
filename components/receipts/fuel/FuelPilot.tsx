'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, Fuel, HelpCircle, Info, RefreshCw, XCircle } from 'lucide-react'
import { toast } from '@/components/ui/feedback'
import { NO_REPLY } from '@/lib/action-reply'
import { isNativeApp } from '@/lib/native'
import { fmtDay, fmtTime } from '@/lib/dates'
import { CHECK_KINDS, KIND_LABEL, MISSING_LABEL, VERDICT_LABEL, type CheckKind, type Verdict } from '@/lib/fuel-check'
import type { FuelExceptionView, FuelPilotView, FuelTxnView } from '@/lib/db/fuel-check'
import { recheckFuelAction, setFuelVerdictAction } from '@/lib/actions/fuel-check'
import { FuelImport } from './FuelImport'
import { FuelSetup } from './FuelSetup'
import { FuelPurchases } from './FuelPurchases'

/**
 * /receipts/fuel — the fuel reconciliation pilot. Top: the pilot's three
 * numbers (recoverable dollars, false-positive rate, what's missing). Then
 * the queue: every exception waiting for Valid / False alarm / Unsure. Then
 * the doors in (import, setup) and every purchase with its four checks.
 */
export const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`)
export const SEVERITY_TONE: Record<string, string> = {
  high: 'border-red-400/40 bg-red-400/10 text-red-300',
  medium: 'border-amber/40 bg-amber/10 text-amber',
  low: 'border-navy-600 bg-navy-900 text-muted',
}

export function whenWords(t: Pick<FuelTxnView, 'txnDate' | 'txnAtMs'>, tz: string): string {
  const day = fmtDay(Date.parse(`${t.txnDate}T12:00:00Z`), 'UTC')
  return t.txnAtMs != null ? `${day} · ${fmtTime(t.txnAtMs, tz)}` : day
}

export function FuelPilot({ view, tz, todayKey, canEdit, previewing, demo }: {
  view: FuelPilotView
  tz: string
  todayKey: string
  canEdit: boolean
  previewing: boolean
  demo: boolean
}) {
  const [native, setNative] = useState(false)
  useEffect(() => { setNative(isNativeApp()) }, [])
  const txnById = useMemo(() => new Map(view.txns.map((t) => [t.id, t])), [view.txns])
  const empty = view.ready && view.txns.length === 0
  const writable = canEdit && !demo

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-8">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Link href="/receipts" className="text-[11.5px] text-teal underline-offset-2 hover:underline">← Receipts</Link>
            <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Fuel className="h-5 w-5 text-amber" /> Fuel check</h1>
            <p className="text-[12.5px] text-faint">Every fuel purchase read against where the truck was, what its tank could hold, and whether it ran after. Nothing is declined — you decide.</p>
          </div>
          {!native && !demo && view.exceptions.length > 0 && (
            <a
              href="/api/receipts/fuel/export"
              className="flex-none inline-flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[12px] font-semibold text-ink hover:border-amber/50"
              title="Every exception and its verdict, as a CSV"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
          )}
        </div>

        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900 px-3 py-2 text-[12.5px] text-muted">Demo mode: a made-up fleet three weeks into the pilot. Sign in to a real company to run your own.</p>}
        {previewing && <p className="rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">You are previewing as someone else — read-only.</p>}
        {!view.ready && !demo && <p className="rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">The database is still updating for this page — check back in a few minutes.</p>}

        {view.ready && (empty ? <StartCard /> : <Scorecard view={view} writable={writable} />)}
        {!empty && <Queue view={view} txnById={txnById} tz={tz} writable={writable} />}
        {view.ready && <FuelImport tz={tz} todayKey={todayKey} writable={writable} defaultOpen={empty} vehicles={view.vehicles} />}
        {view.ready && <FuelSetup view={view} todayKey={todayKey} writable={writable} />}
        {!empty && <FuelPurchases view={view} tz={tz} writable={writable} />}
      </div>
    </div>
  )
}

function StartCard() {
  return (
    <section className="rounded-2xl border border-amber/30 bg-amber/[0.04] px-4 py-4 space-y-2">
      <p className="font-display font-bold text-ink text-[15px]">Import your last 90 days of fuel purchases to start the pilot.</p>
      <ul className="text-[12.5px] text-muted space-y-1 list-disc pl-5">
        <li><b className="text-ink">A fleet fuel card</b> (WEX, Fuelman, Comdata…): export transactions with the time, the station&apos;s address, gallons and the vehicle — the best evidence.</li>
        <li><b className="text-ink">A bank or credit card</b>: download the statement as CSV (Date, Description, Amount). Only the fuel lines are kept.</li>
        <li>Then tie each card to the truck it fuels and type each tank size once (Cards &amp; tanks, below).</li>
      </ul>
      <p className="text-[11.5px] text-faint">Each purchase gets four checks; only what fails one comes to you. Mark each Valid or False alarm for 30 days — that is the pilot.</p>
    </section>
  )
}

function Scorecard({ view, writable }: { view: FuelPilotView; writable: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const m = view.metrics
  const [showMissing, setShowMissing] = useState(false)
  const recheck = () => start(async () => {
    const r = await recheckFuelAction(14)
    if (!r?.ok) { toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
    toast(`Checked ${r.checked ?? 0} purchase${r.checked === 1 ? '' : 's'}${r.remaining ? ` — ${r.remaining} left for tonight's run` : ''}.`, { variant: 'success' })
    router.refresh()
  })
  const pilotPct = Math.min(100, (m.daysIn / m.pilotDays) * 100)
  const classifyPct = Math.min(100, (m.daysIn / m.classifyDays) * 100)
  return (
    <section className="rounded-2xl border border-navy-700 bg-navy-850 px-4 py-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-ink text-[15px]">{m.startedOn ? `Pilot day ${m.daysIn} of ${m.pilotDays}` : 'Pilot not started'}</p>
          <p className="text-[11.5px] text-faint">
            {m.classifyDaysLeft > 0 ? `${m.classifyDaysLeft} day${m.classifyDaysLeft === 1 ? '' : 's'} left of the 30-day classification window` : 'The 30-day classification window is over — verdicts still count.'}
            {' · '}{m.transactions} purchase{m.transactions === 1 ? '' : 's'} · {money(m.dollars)}
          </p>
        </div>
        {writable && (
          <button type="button" onClick={recheck} disabled={pending}
            className="flex-none inline-flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[12px] font-semibold text-ink hover:border-amber/50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} /> {pending ? 'Checking…' : 'Re-check 14 days'}
          </button>
        )}
      </div>
      <div className="space-y-1.5" aria-hidden>
        <Bar label="90-day pilot" pct={pilotPct} tone="bg-teal" />
        <Bar label="30 days of verdicts" pct={classifyPct} tone="bg-amber" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Recoverable" value={money(m.recoverable)} sub={`${m.valid} valid exception${m.valid === 1 ? '' : 's'}`} strong />
        <Tile label="False-positive rate" value={pct(m.falsePositiveRate)} sub={m.classified ? `${m.falseAlarms} false of ${m.classified} decided` : 'no verdicts yet'} />
        <Tile label="Classified" value={m.exceptions ? `${m.classified} of ${m.exceptions}` : '—'} sub={m.exceptions ? `${pct(m.classifiedPct)} decided${m.unsure ? ` · ${m.unsure} unsure` : ''}` : 'nothing flagged yet'} />
        <Tile label="Waiting on you" value={money(m.awaiting)} sub={`${m.unclassified} need${m.unclassified === 1 ? 's' : ''} a verdict`} />
      </div>
      <div className="rounded-xl border border-navy-700 bg-navy-900 divide-y divide-navy-800">
        {CHECK_KINDS.map((k) => {
          const s = m.byKind[k]
          return (
            <div key={k} className="px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="flex-1 min-w-0 text-[12.5px] text-ink">{KIND_LABEL[k]}</span>
                <span className="flex-none tabular-nums text-[12px] text-muted" title="False alarms ÷ decided">{s.fpRate == null ? '—' : `${Math.round(s.fpRate * 100)}% false`}</span>
              </div>
              <p className="text-[11px] text-faint tabular-nums">{s.unclassified} to decide · {s.valid} valid · {s.false} false alarm{s.false === 1 ? '' : 's'}</p>
            </div>
          )
        })}
      </div>
      {(view.unplaced > 0 || view.unchecked > 0) && (
        <p className="text-[11.5px] text-faint flex items-start gap-1.5"><Info className="h-3.5 w-3.5 flex-none mt-0.5" />
          {[view.unplaced ? `${view.unplaced} station${view.unplaced === 1 ? '' : 's'} still being placed on the map` : '', view.unchecked ? `${view.unchecked} purchase${view.unchecked === 1 ? '' : 's'} not checked yet` : ''].filter(Boolean).join(' · ')} — the nightly run finishes them.
        </p>
      )}
      {view.missing.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowMissing((o) => !o)} className="w-full flex items-center gap-2 text-left">
            <AlertTriangle className="h-4 w-4 text-amber flex-none" />
            <span className="flex-1 text-[13px] font-semibold text-ink">What the checks are missing</span>
            <span className="text-[11.5px] text-faint">{view.missing.length}</span>
            {showMissing ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
          </button>
          <ol className="mt-2 space-y-1.5">
            {(showMissing ? view.missing : view.missing.slice(0, 3)).map((i) => (
              <li key={i.code} className="text-[12px] text-muted">
                <span className="text-ink">{i.text}</span> <span className="text-faint">{i.fix}</span>
                <span className="block text-[11px] text-faint tabular-nums">{i.purchases} purchase{i.purchases === 1 ? '' : 's'} · {money(i.dollars)} it limited</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

function Bar({ label, pct: p, tone }: { label: string; pct: number; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 flex-none text-[11px] text-faint">{label}</span>
      <span className="flex-1 h-1.5 rounded-full bg-navy-800 overflow-hidden"><span className={`block h-full ${tone}`} style={{ width: `${p}%` }} /></span>
    </div>
  )
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900 px-3 py-2.5 min-w-0">
      <p className="text-[10.5px] uppercase tracking-wide text-faint">{label}</p>
      <p className={`font-display font-bold tabular-nums truncate ${strong ? 'text-amber text-[19px]' : 'text-ink text-[17px]'}`}>{value}</p>
      <p className="text-[11px] text-faint truncate">{sub}</p>
    </div>
  )
}

function Queue({ view, txnById, tz, writable }: { view: FuelPilotView; txnById: Map<string, FuelTxnView>; tz: string; writable: boolean }) {
  const [showDecided, setShowDecided] = useState(false)
  const live = view.exceptions.filter((e) => !e.clearedAtMs && txnById.has(e.transactionId) && !txnById.get(e.transactionId)!.excluded)
  const waiting = live.filter((e) => e.verdict == null || e.verdict === 'unsure')
    .sort((a, b) => Number(a.verdict === 'unsure') - Number(b.verdict === 'unsure') || b.firstSeenAtMs - a.firstSeenAtMs)
  const decided = view.exceptions.filter((e) => (e.verdict === 'valid' || e.verdict === 'false') && txnById.has(e.transactionId))
    .sort((a, b) => (b.verdictAtMs ?? 0) - (a.verdictAtMs ?? 0))
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="font-display font-bold text-ink text-[15px] flex-1">Needs a verdict</h2>
        <span className="text-[11.5px] text-faint">{waiting.length ? `${waiting.length} waiting` : 'all caught up'}</span>
      </div>
      {waiting.length === 0 && (
        <p className="rounded-2xl border border-navy-700 bg-navy-850 px-4 py-4 text-center text-[12.5px] text-muted">
          {view.exceptions.length ? 'Every exception has a verdict.' : 'No exceptions yet — every checked purchase passed or couldn’t be checked (see what’s missing above).'}
        </p>
      )}
      {waiting.map((e) => <ExceptionCard key={e.id} e={e} t={txnById.get(e.transactionId)!} tz={tz} writable={writable} />)}
      {decided.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDecided((o) => !o)} className="w-full flex items-center gap-2 py-1 text-left text-[12.5px] text-muted hover:text-ink">
            {showDecided ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} Decided ({decided.length})
          </button>
          {showDecided && <div className="space-y-2 mt-1">{decided.map((e) => <ExceptionCard key={e.id} e={e} t={txnById.get(e.transactionId)!} tz={tz} writable={writable} />)}</div>}
        </div>
      )}
    </section>
  )
}

const VERDICT_BTN: { v: Verdict; icon: typeof CheckCircle2; on: string }[] = [
  { v: 'valid', icon: CheckCircle2, on: 'border-red-400/60 bg-red-400/15 text-red-200' },
  { v: 'false', icon: XCircle, on: 'border-teal/60 bg-teal/15 text-teal' },
  { v: 'unsure', icon: HelpCircle, on: 'border-navy-600 bg-navy-700 text-ink' },
]

function ExceptionCard({ e, t, tz, writable }: { e: FuelExceptionView; t: FuelTxnView; tz: string; writable: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [verdict, setVerdict] = useState<Verdict | null>(e.verdict)
  const [note, setNote] = useState(e.verdictNote ?? '')
  const [editing, setEditing] = useState(false)
  useEffect(() => { setVerdict(e.verdict); setNote(e.verdictNote ?? '') }, [e.verdict, e.verdictNote])
  const save = (v: Verdict | null, n = note) => {
    const prev = verdict
    setVerdict(v)
    start(async () => {
      const r = await setFuelVerdictAction(e.id, v, n)
      if (!r?.ok) { setVerdict(prev); toast(r?.error ?? NO_REPLY, { variant: 'error' }); return }
      setEditing(false)
      router.refresh()
    })
  }
  const vehicle = t.assetName ?? (t.cardLast4 ? `card …${t.cardLast4}, no vehicle` : 'no vehicle')
  return (
    <article className="rounded-2xl border border-navy-700 bg-navy-850 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className={`flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${SEVERITY_TONE[e.severity] ?? SEVERITY_TONE.low}`}>{e.severity}</span>
        <p className="flex-1 min-w-0 font-semibold text-ink text-[13.5px]">{KIND_LABEL[e.kind as CheckKind]}</p>
        <p className="flex-none font-display font-bold tabular-nums text-amber text-[14px]" title="Dollars at risk">{money(e.dollarsAtRisk)}</p>
      </div>
      <p className="text-[11.5px] text-faint">
        {whenWords(t, tz)} · {t.placeLabel ?? t.merchant} · {money(t.amount)}{t.gallons != null ? ` · ${t.gallonsEstimated ? '~' : ''}${t.gallons.toFixed(1)} gal` : ''} · {vehicle}
      </p>
      <p className="text-[13px] text-muted leading-snug">{e.text}</p>
      {e.missing.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {e.missing.map((c) => <span key={c} className="rounded-full border border-navy-700 bg-navy-900 px-2 py-0.5 text-[10.5px] text-faint">{MISSING_LABEL[c] ?? c}</span>)}
        </div>
      )}
      {(e.verdict === 'valid' || e.verdict === 'false') && !editing ? (
        <div className="flex items-start gap-2 text-[12px]">
          <span className={`flex-none rounded-full border px-2 py-0.5 font-semibold ${VERDICT_BTN.find((b) => b.v === e.verdict)!.on}`}>{VERDICT_LABEL[e.verdict]}</span>
          <span className="flex-1 min-w-0 pt-0.5 text-faint">{[e.verdictBy, e.verdictAtMs ? fmtDay(e.verdictAtMs, tz) : null].filter(Boolean).join(' · ')}{e.verdictNote ? <> — <span className="text-muted">“{e.verdictNote}”</span></> : null}</span>
          {writable && <button type="button" onClick={() => setEditing(true)} className="flex-none pt-0.5 text-teal hover:underline">Change</button>}
        </div>
      ) : writable ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {VERDICT_BTN.map(({ v, icon: Icon, on }) => (
              <button key={v} type="button" disabled={pending} onClick={() => save(verdict === v ? null : v)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[12px] font-semibold disabled:opacity-50 ${verdict === v ? on : 'border-navy-700 bg-navy-900 text-muted hover:text-ink'}`}
                aria-pressed={verdict === v}>
                <Icon className="h-3.5 w-3.5" /> {VERDICT_LABEL[v]}
              </button>
            ))}
          </div>
          {verdict && (
            <div className="flex gap-2">
              <input value={note} onChange={(ev) => setNote(ev.target.value.slice(0, 500))} placeholder="What you found (optional)"
                className="flex-1 min-w-0 rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-[12.5px] text-ink outline-none focus:border-amber/50" />
              <button type="button" disabled={pending || note === (e.verdictNote ?? '')} onClick={() => save(verdict, note)}
                className="flex-none rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[12px] font-semibold text-ink disabled:opacity-40">Save note</button>
            </div>
          )}
        </div>
      ) : e.verdict === 'unsure' ? <p className="text-[12px] text-faint">Marked unsure.</p> : null}
    </article>
  )
}
