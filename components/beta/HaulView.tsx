'use client'

/**
 * Haul tickets for a site, laid against our trucks' own trips into it. Type
 * (or later scan) each quarry / plant / dump ticket; per truck per day the
 * ticket count and the trip count should agree, and where they don't, the
 * page says which way — a load with no ticket, or a ticket with no load.
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { haulTotals, reconcile, ticketQty, type Ticket } from '@/lib/beta/haul'
import { MATERIALS } from '@/lib/beta/registers'
import type { BetaRecord } from '@/lib/db/beta'
import { AddButton, BetaPage, Notice, RecordEditor, RowActions, StatePill, box, card, fmtDay } from './ui'
import { Stat } from './RentalsView'

type Opt = { id: string; name: string }

export function HaulView({ sites, siteId, from, to, today, rows, trips, assets, demo, canWrite, canRemoveAny }: {
  sites: Opt[]; siteId: string | null; from: string; to: string; today: string; rows: BetaRecord[]; trips: { assetId: string; day: string; arrivals: number }[]
  assets: Opt[]; demo: boolean; canWrite: boolean; canRemoveAny: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<BetaRecord | 'new' | null>(null)
  const names = useMemo(() => new Map(assets.map((a) => [a.id, a.name])), [assets])
  const tickets: Ticket[] = rows.map((r) => ({ id: r.id, day: String(r.data.day), assetId: r.assetId, truckText: r.data.truckText as string | undefined, direction: r.data.direction === 'out' ? 'out' : 'in', material: String(r.data.material ?? 'other'), tons: r.data.tons as number | undefined, cy: r.data.cy as number | undefined }))
  const tot = haulTotals(tickets)
  const rec = reconcile(tickets, trips, names)
  const off = rec.filter((r) => r.state !== 'match')
  const go = (p: Record<string, string>) => router.push(`/beta/haul?${new URLSearchParams({ site: siteId ?? '', from, to, ...p })}`)
  return (
    <BetaPage title="Haul tickets" icon={<Truck className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="Every load in and out of a site, by ticket — checked against your own trucks’ trips into the site’s zone. A load with no ticket can’t be billed; a ticket with no load is a charge to question.">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0"><span className="text-faint text-[12px] block">Site</span>
          <select className={box} value={siteId ?? ''} onChange={(e) => go({ site: e.target.value })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label><span className="text-faint text-[12px] block">From</span><input type="date" className={box} value={from} max={to} onChange={(e) => e.target.value && go({ from: e.target.value })} /></label>
        <label><span className="text-faint text-[12px] block">To</span><input type="date" className={box} value={to} max={today} onChange={(e) => e.target.value && go({ to: e.target.value })} /></label>
      </div>
      {!siteId && <Notice tone="info">Draw a site first — tickets file under a site.</Notice>}
      {siteId && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Loads" value={String(tot.loads)} />
            <Stat label="Hauled in" value={`${tot.inTons.toLocaleString('en-US')} t · ${tot.inCy.toLocaleString('en-US')} CY`} />
            <Stat label="Hauled out" value={`${tot.outTons.toLocaleString('en-US')} t · ${tot.outCy.toLocaleString('en-US')} CY`} />
            <Stat label="Don’t agree" value={String(off.length)} tone={off.length ? 'bad' : 'good'} />
          </div>
          {canWrite && editing === null && <AddButton onClick={() => setEditing('new')}>Add a ticket</AddButton>}
          {editing !== null && <RecordEditor kind="haul_ticket" record={editing === 'new' ? null : editing} fixed={{ siteId }} assets={assets} withMoney={false} onDone={() => setEditing(null)} defaults={{ day: today, direction: 'in', material: 'abc' }} />}
          {rec.length > 0 && (
            <div className={`${card} space-y-1.5`}>
              <p className="font-semibold text-ink">Tickets vs trips (our trucks)</p>
              {rec.map((r) => (
                <div key={`${r.assetId}|${r.day}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-800 pt-1.5 first:border-0">
                  <span className="text-muted min-w-0">{fmtDay(r.day)} · {r.words}</span>
                  <StatePill state={r.state === 'match' ? 'ok' : 'bad'}>{r.state === 'match' ? 'agree' : r.state === 'extra_ticket' ? 'ticket, no trip' : 'trip, no ticket'}</StatePill>
                </div>
              ))}
              <p className="text-faint text-[11.5px]">Trips are entries into the site’s zone from the hours ledger. A hauler’s own truck has no tracker — its tickets are counted, not checked.</p>
            </div>
          )}
          <div className={`${card} space-y-1.5`}>
            <p className="font-semibold text-ink">Tickets ({rows.length})</p>
            {!rows.length && <p className="text-faint">No tickets in these dates.</p>}
            {[...rows].sort((a, b) => String(b.data.day).localeCompare(String(a.data.day))).map((r) => {
              const q = ticketQty({ material: String(r.data.material ?? 'other'), tons: r.data.tons as number | undefined, cy: r.data.cy as number | undefined })
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-800 pt-1.5 first:border-0">
                  <span className="min-w-0 text-ink">#{String(r.data.ticket)} <span className="text-muted">· {fmtDay(String(r.data.day))}{r.data.time ? ` ${String(r.data.time)}` : ''} · {r.data.direction === 'out' ? 'out to' : 'in from'} {String(r.data.source ?? '')} · {MATERIALS.find((m) => m.value === r.data.material)?.label} · {r.assetId ? names.get(r.assetId) ?? 'truck' : String(r.data.truckText ?? 'hauler')}</span></span>
                  <span className="flex items-center gap-2 text-ink">{q.tons} t · {q.cy} CY{q.derived ? <span className="text-faint text-[11px]">({q.derived} est.)</span> : null}
                    {canWrite && <RowActions id={r.id} onEdit={() => setEditing(r)} canRemove={canRemoveAny} />}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </BetaPage>
  )
}
