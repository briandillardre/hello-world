'use client'

/**
 * 811 locate tickets per site. South Carolina: dig no sooner than 3 full
 * working days after the call, and the ticket is good for 15 working days —
 * re-call before it runs out. The form fills both from the call date (it
 * can't know holidays — the dates stay editable), and each ticket says in
 * words whether you can dig today.
 */
import { useMemo, useState } from 'react'
import { Construction } from 'lucide-react'
import { addWorkdays, daysUntil, isDay } from '@/lib/beta/registers'
import type { BetaRecord } from '@/lib/db/beta'
import { AddButton, BetaPage, Notice, RecordEditor, RowActions, StatePill, card, fmtDay } from './ui'

type Opt = { id: string; name: string }

export function ticketState(d: Record<string, unknown>, today: string): { state: 'overdue' | 'urgent' | 'soon' | 'ok' | 'waiting'; words: string } {
  const valid = isDay(d.validThrough) ? String(d.validThrough) : null
  const begins = isDay(d.workBegins) ? String(d.workBegins) : null
  if (begins && begins > today) return { state: 'waiting', words: `Can dig from ${fmtDay(begins)}` }
  if (!valid) return { state: 'waiting', words: 'No expiry typed' }
  const left = daysUntil(today, valid)
  if (left < 0) return { state: 'overdue', words: `Ran out ${fmtDay(valid)} — re-call before digging` }
  if (left <= 2) return { state: 'urgent', words: left === 0 ? 'Runs out today — re-call now' : `Runs out in ${left} ${left === 1 ? 'day' : 'days'} — re-call now` }
  if (left <= 5) return { state: 'soon', words: `Good through ${fmtDay(valid)} — re-call soon` }
  return { state: 'ok', words: `Good to dig through ${fmtDay(valid)}` }
}

export function LocatesView({ rows, sites, today, demo, canWrite, canRemoveAny }: { rows: BetaRecord[]; sites: Opt[]; today: string; demo: boolean; canWrite: boolean; canRemoveAny: boolean }) {
  const [editing, setEditing] = useState<BetaRecord | 'new' | null>(null)
  const [site, setSite] = useState('')
  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites])
  const shown = rows.filter((r) => !site || r.siteId === site).sort((a, b) => String(a.dueOn ?? '9').localeCompare(String(b.dueOn ?? '9')))
  const live = shown.filter((r) => !r.dueOn || r.dueOn >= addWorkdays(today, -10))
  const old = shown.filter((r) => !live.includes(r))
  return (
    <BetaPage title="811 locate tickets" icon={<Construction className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="Every locate ticket on every site: when you may dig, when it runs out, and a nudge to re-call in time. SC: wait 3 full working days after the call; a ticket is good for 15 working days.">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && editing === null && <AddButton onClick={() => setEditing('new')}>Add a ticket</AddButton>}
        <select className="rounded-lg border border-navy-700 bg-navy-950 px-2 py-2 text-ink text-[13px]" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {editing !== null && (
        <RecordEditor kind="locate" record={editing === 'new' ? null : editing} sites={sites} fixed={site && editing === 'new' ? { siteId: site } : {}} withMoney={false} onDone={() => setEditing(null)}
          defaults={{ called: today, kind: 'normal' }}
          derive={(v, changed) => (changed === 'called' && isDay(v.called) ? { ...v, workBegins: addWorkdays(String(v.called), 3), validThrough: addWorkdays(String(v.called), 15) } : v)} />
      )}
      {!live.length && !old.length && <Notice tone="info">No tickets yet. Add the ticket number the day you call 811 — HammerTrack counts the days from there.</Notice>}
      <div className="space-y-2">
        {live.map((r) => <TicketRow key={r.id} r={r} site={r.siteId ? siteName.get(r.siteId) ?? null : null} today={today} canWrite={canWrite} canRemoveAny={canRemoveAny} onEdit={() => setEditing(r)} />)}
      </div>
      {old.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-muted">Older tickets ({old.length})</summary>
          <div className="space-y-2 mt-2">{old.map((r) => <TicketRow key={r.id} r={r} site={r.siteId ? siteName.get(r.siteId) ?? null : null} today={today} canWrite={canWrite} canRemoveAny={canRemoveAny} onEdit={() => setEditing(r)} />)}</div>
        </details>
      )}
      <p className="text-faint text-[11.5px]">Holidays aren’t counted out of the working days — check the dates SC811 gives you on the ticket.</p>
    </BetaPage>
  )
}

function TicketRow({ r, site, today, canWrite, canRemoveAny, onEdit }: { r: BetaRecord; site: string | null; today: string; canWrite: boolean; canRemoveAny: boolean; onEdit: () => void }) {
  const d = r.data
  const s = ticketState(d, today)
  return (
    <div className={`${card} flex flex-wrap items-start justify-between gap-2`}>
      <div className="min-w-0">
        <p className="font-semibold text-ink">#{String(d.ticket ?? '')} <span className="font-normal text-muted">· {site ?? 'site'}</span></p>
        <p className="text-faint text-[12px]">Called {fmtDay(String(d.called ?? ''))}{d.where ? ` · ${String(d.where)}` : ''}{d.kind && d.kind !== 'normal' ? ` · ${String(d.kind)}` : ''}</p>
        {d.utilities ? <p className="text-faint text-[12px]">Utilities: {String(d.utilities)}</p> : null}
        {d.notes ? <p className="text-muted text-[12px] mt-1 whitespace-pre-wrap">{String(d.notes)}</p> : null}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <StatePill state={s.state}>{s.words}</StatePill>
        {canWrite && <RowActions id={r.id} onEdit={onEdit} canRemove={canRemoveAny} />}
      </div>
    </div>
  )
}
