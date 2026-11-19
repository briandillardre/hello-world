'use client'

/**
 * Third-party rentals: what is on rent, what it has cost so far (billed the
 * way rental houses bill), and the two leaks — a rented machine that hasn't
 * worked in days (when it wears a tracker, or a tag riding on it), and one
 * past its expected return that nobody called off.
 */
import { useMemo, useState } from 'react'
import { CalendarClock, PhoneOff } from 'lucide-react'
import { rentalView, type RentalData } from '@/lib/beta/rentals'
import type { BetaRecord } from '@/lib/db/beta'
import { saveBetaRecordAction } from '@/lib/actions/beta'
import { useRouter } from 'next/navigation'
import { AddButton, BetaPage, Notice, RecordEditor, RowActions, StatePill, btn, card, fmtDay, money } from './ui'

type Opt = { id: string; name: string }

export function RentalsView({ rows, sites, assets, today, demo, lastWorked, canWrite, canRemoveAny }: {
  rows: BetaRecord[]; sites: Opt[]; assets: Opt[]; today: string; demo: boolean; lastWorked: Record<string, string>; canWrite: boolean; canRemoveAny: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<BetaRecord | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites])
  const assetName = useMemo(() => new Map(assets.map((s) => [s.id, s.name])), [assets])
  const views = rows.map((r) => ({ r, v: rentalView(r.data as RentalData, today, r.assetId ? lastWorked[r.assetId] ?? null : null) }))
  const live = views.filter((x) => x.v.live).sort((a, b) => b.v.flags.length - a.v.flags.length)
  const done = views.filter((x) => !x.v.live)
  const runningCost = live.reduce((t, x) => t + (x.v.charged ?? 0), 0)
  const idleCost = live.reduce((t, x) => t + (x.v.idleCost ?? 0), 0)

  async function callOff(r: BetaRecord) {
    setBusy(r.id); setErr(null)
    const res = await saveBetaRecordAction({ kind: 'rental', id: r.id, siteId: r.siteId, assetId: r.assetId, data: { ...r.data, offRentCalled: today } }).catch(() => null)
    setBusy(null)
    if (!res?.ok) setErr((res && 'error' in res && res.error) || 'Couldn’t save — try again.')
    else router.refresh()
  }

  return (
    <BetaPage title="Rentals" icon={<CalendarClock className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="Everything on rent from someone else: what it has cost so far, and the rented machine that hasn’t moved while the bill keeps running. Put a tracker or a tag on a rental and pick it here — HammerTrack watches whether it works.">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="On rent" value={String(live.length)} />
        <Stat label="Billed so far" value={money(runningCost)} />
        <Stat label="Paid for idle days" value={money(idleCost)} tone={idleCost > 0 ? 'bad' : undefined} />
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {canWrite && editing === null && <AddButton onClick={() => setEditing('new')}>Add a rental</AddButton>}
      {editing !== null && <RecordEditor kind="rental" record={editing === 'new' ? null : editing} sites={sites} assets={assets} withMoney onDone={() => setEditing(null)} defaults={{ onRent: today }} />}
      {!rows.length && <Notice tone="info">Nothing on rent. Add each rental the day it lands — the rates off the contract, and the machine it is if you put a tracker or tag on it.</Notice>}
      <div className="space-y-2">
        {live.map(({ r, v }) => (
          <div key={r.id} className={`${card} space-y-2`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{String(r.data.what ?? '')} <span className="font-normal text-muted">· {String(r.data.vendor ?? '')}</span></p>
                <p className="text-faint text-[12px]">On rent {fmtDay(String(r.data.onRent ?? ''))} · day {v.days}{r.siteId ? ` · ${siteName.get(r.siteId) ?? ''}` : ''}{r.assetId ? ` · tracked as ${assetName.get(r.assetId) ?? 'a machine'}` : ' · no tracker'}{r.data.contract ? ` · ${String(r.data.contract)}` : ''}</p>
                {r.data.expectedOff ? <p className="text-faint text-[12px]">Expected back {fmtDay(String(r.data.expectedOff))}</p> : null}
              </div>
              <div className="text-right">
                <p className="font-semibold text-ink">{money(v.charged)}</p>
                <p className="text-faint text-[11px]">so far</p>
              </div>
            </div>
            {v.flags.map((f) => <StatePill key={f.kind} state={f.kind === 'no_rate' ? 'none' : 'bad'}>{f.words}</StatePill>)}
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn} disabled={busy === r.id} onClick={() => callOff(r)}><PhoneOff className="h-3.5 w-3.5" /> {busy === r.id ? 'Saving…' : 'Called off today'}</button>
                <RowActions id={r.id} onEdit={() => setEditing(r)} canRemove={canRemoveAny} />
              </div>
            )}
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-muted">Returned ({done.length}) · {money(done.reduce((t, x) => t + (x.v.charged ?? 0), 0))}</summary>
          <div className="space-y-1.5 mt-2">
            {done.map(({ r, v }) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-800 pt-1.5">
                <span className="text-muted min-w-0">{String(r.data.what ?? '')} · {String(r.data.vendor ?? '')} · {fmtDay(String(r.data.onRent ?? ''))} → {fmtDay(String(r.data.offRentCalled ?? ''))} ({v.days} days)</span>
                <span className="flex items-center gap-2 text-ink">{money(v.charged)} {canWrite && <RowActions id={r.id} onEdit={() => setEditing(r)} canRemove={canRemoveAny} />}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="text-faint text-[11.5px]">The bill is worked out the way rental houses bill — the cheapest mix of 4-week, week and day rates — plus delivery. Your invoice is the final word.</p>
    </BetaPage>
  )
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2 min-w-0">
      <p className="text-faint text-[11px] truncate">{label}</p>
      <p className={`font-display font-bold text-lg truncate ${tone === 'bad' ? 'text-red-300' : tone === 'good' ? 'text-teal' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
