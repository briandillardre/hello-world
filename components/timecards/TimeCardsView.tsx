'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, MapPin, Pencil, Satellite, Upload } from 'lucide-react'
import { toast } from '@/components/ui/feedback'
import { fmtDay } from '@/lib/dates'
import { addDaysKey } from '@/lib/dates'
import { FLAG_LABEL, categoryLabel, clockTime, summarizeCards, weekLabel, type PersonCard, type TimeCardFlag, type TimeCardRow } from '@/lib/timecards'
import { adjustTimeEntryAction } from '@/lib/actions/timecards'
import { pushQboDayAction } from '@/lib/actions/qbo-time'

/**
 * /timecards — GPS-verified hours, week by week (Workyard's "GPS-verified
 * time cards straight to payroll", Brian Sep 9). One card per person: the
 * week's paid hours split regular / overtime, how much of the clocked time
 * the phone actually placed on the job site, every day's entries with where
 * the clock-in and clock-out happened, plain-word flags. Managers correct
 * an entry here (the original stays on the record), export the week as CSV
 * for payroll, or push a day to QuickBooks as TimeActivity rows.
 */
const FLAG_TONE: Record<TimeCardFlag, string> = {
  open: 'border-teal/40 text-teal bg-teal/10',
  no_gps: 'border-red-400/40 text-red-300 bg-red-400/10',
  off_site: 'border-amber/40 text-amber bg-amber/10',
  long: 'border-amber/40 text-amber bg-amber/10',
  edited: 'border-navy-600 text-muted bg-navy-900',
  no_site: 'border-navy-600 text-muted bg-navy-900',
}
const h1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

export function TimeCardsView({ cards, verified, week, tz, canEdit, canPushQbo, seesAll, myId, demo = false }: {
  cards: PersonCard[]
  verified: boolean
  /** Monday day key of the week shown. */
  week: string
  tz: string
  canEdit: boolean
  canPushQbo: boolean
  seesAll: boolean
  myId: string | null
  demo?: boolean
}) {
  const router = useRouter()
  const totals = useMemo(() => summarizeCards(cards), [cards])
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(cards.length <= 3 ? cards.map((c) => c.userId) : cards.filter((c) => c.userId === myId).map((c) => c.userId)))
  const [editing, setEditing] = useState<TimeCardRow | null>(null)
  const [pushing, setPushing] = useState<string | null>(null)
  const toggle = (id: string) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const go = (k: string) => router.push(`/timecards?week=${k}`)
  const thisWeek = useMemo(() => {
    const now = new Date()
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now))
    return addDaysKey(key, -(wd < 0 ? 0 : wd))
  }, [tz])

  const pushDay = async (day: string) => {
    if (pushing) return
    setPushing(day)
    try {
      const r = await pushQboDayAction(day, tz)
      if ('error' in r) toast(r.error, { variant: 'error' })
      else toast(`QuickBooks: ${r.pushed} pushed${r.skipped ? `, ${r.skipped} already there` : ''}${r.failed.length ? `, ${r.failed.length} failed` : ''}`)
    } finally { setPushing(null) }
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-8">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><CalendarClock className="h-5 w-5 text-amber" /> Time cards</h1>
            <p className="text-[12.5px] text-faint">GPS-verified hours, week by week. Export for payroll or push a day to QuickBooks.</p>
          </div>
          <a
            href={`/api/timecards/export?week=${week}`}
            className="flex-none inline-flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[12px] font-semibold text-ink hover:border-amber/50"
            title="Download this week as a CSV (one row per entry)"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </a>
        </div>

        {/* Week nav */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(addDaysKey(week, -7))} aria-label="Previous week" className="rounded-lg border border-navy-700 bg-navy-900 p-2 text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex-1 text-center">
            <p className="font-display font-bold text-ink">{weekLabel(week)}</p>
            {week !== thisWeek && <button type="button" onClick={() => go(thisWeek)} className="text-[11.5px] text-teal underline-offset-2 hover:underline">This week</button>}
            {week === thisWeek && <p className="text-[11.5px] text-faint">This week</p>}
          </div>
          <button type="button" onClick={() => go(addDaysKey(week, 7))} disabled={week >= thisWeek} aria-label="Next week" className="rounded-lg border border-navy-700 bg-navy-900 p-2 text-muted hover:text-ink disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>

        {/* Totals */}
        {seesAll && cards.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              ['People', String(totals.people)],
              ['Hours', h1(totals.hours)],
              ['Overtime', h1(totals.overtime)],
              ['On-site', totals.verifiedPct == null ? '—' : `${totals.verifiedPct}%`],
              ['Flags', String(totals.flagged)],
              ['On the clock', String(totals.openNow)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-navy-800 bg-navy-950 px-2.5 py-2">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{k}</p>
                <p className="font-display font-bold text-ink text-lg tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        )}

        {!verified && cards.length > 0 && (
          <p className="text-[12px] text-faint rounded-lg border border-navy-800 bg-navy-950 px-3 py-2">GPS verification appears once the latest build&apos;s database update (migration 103) has run.</p>
        )}

        {cards.length === 0 && (
          <div className="rounded-xl border border-navy-800 bg-navy-950 p-6 text-center">
            <p className="text-3xl mb-2">🕒</p>
            <p className="font-display font-bold text-ink">No hours this week{seesAll ? '' : ' on your card'}.</p>
            <p className="text-[12.5px] text-faint mt-1">
              {demo ? 'Sign in on the live app to see real time cards.' : <>Clock in on the <Link href="/clock" className="text-teal underline-offset-2 hover:underline">Time clock</Link>; the phone records where the shift goes and the card fills in here.</>}
            </p>
          </div>
        )}

        {cards.map((c) => {
          const isOpen = openIds.has(c.userId)
          return (
            <section key={c.userId} className="rounded-xl border border-navy-800 bg-navy-950 overflow-hidden">
              <button type="button" onClick={() => toggle(c.userId)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy-900/60">
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-ink truncate flex items-center gap-2">
                    {c.personName}
                    {c.openNow && <span className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-teal"><span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse" /> on the clock</span>}
                  </p>
                  <p className="text-[11.5px] text-faint truncate">
                    {c.sites.slice(0, 3).map((s) => `${s.label} ${h1(s.hours)} h`).join(' · ')}{c.sites.length > 3 ? ` · +${c.sites.length - 3}` : ''}
                  </p>
                </div>
                <div className="text-right flex-none">
                  <p className="font-display font-bold text-ink text-lg tabular-nums">{h1(c.hours)} <span className="text-[11px] text-faint font-mono">h</span></p>
                  <p className="text-[11px] text-faint tabular-nums">
                    {c.overtime > 0 ? <><span className="text-amber">{h1(c.overtime)} OT</span> · </> : null}
                    {c.verifiedPct == null ? (verified ? <span className="text-red-300">no GPS</span> : '—') : <span className={c.verifiedPct >= 80 ? 'text-teal' : c.verifiedPct >= 50 ? 'text-amber' : 'text-red-300'}>{c.verifiedPct}% on-site</span>}
                  </p>
                </div>
                {isOpen ? <ChevronUp className="h-4 w-4 text-faint flex-none" /> : <ChevronDown className="h-4 w-4 text-faint flex-none" />}
              </button>

              {isOpen && (
                <div className="border-t border-navy-800 divide-y divide-navy-800/70">
                  {c.days.map((d) => {
                    const closed = d.entries.filter((e) => e.outAt)
                    return (
                      <div key={d.dayKey} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted flex-1">{fmtDay(Date.parse(d.dayKey + 'T12:00:00Z'), 'UTC')}</p>
                          <p className="font-display font-bold text-ink text-sm tabular-nums">{h1(d.hours)} h</p>
                          {canPushQbo && closed.length > 0 && (
                            <button type="button" onClick={() => pushDay(d.dayKey)} disabled={!!pushing} title="Push this day's completed entries to QuickBooks as TimeActivity" className="inline-flex items-center gap-1 rounded-md border border-navy-700 px-2 py-1 text-[10.5px] font-semibold text-muted hover:text-ink disabled:opacity-40">
                              <Upload className="h-3 w-3" /> {pushing === d.dayKey ? 'Pushing…' : 'QuickBooks'}
                            </button>
                          )}
                        </div>
                        <ul className="mt-1.5 space-y-1.5">
                          {d.entries.map((e) => (
                            <li key={e.id} className="rounded-lg border border-navy-800/80 bg-navy-900/50 px-3 py-2">
                              <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] text-ink tabular-nums">
                                    {clockTime(e.inAt, tz)} → {e.outAt ? clockTime(e.outAt, tz) : <span className="text-teal">now</span>}
                                    <span className="text-faint"> · </span><span className="font-semibold">{h1(e.hours)} h</span>
                                    {e.breakMinutes > 0 && <span className="text-faint"> · {e.breakMinutes} min break</span>}
                                    <span className="text-faint"> · </span>{e.category === 'project' ? (e.zoneName ?? 'no site') : categoryLabel(e.category)}
                                  </p>
                                  {(e.inPlace || e.outPlace) && (
                                    <p className="text-[11.5px] text-muted truncate flex items-center gap-1"><MapPin className="h-3 w-3 text-faint flex-none" />{e.inPlace ?? '—'}{e.outAt ? <> → {e.outPlace ?? '—'}</> : null}</p>
                                  )}
                                  {e.gps && (
                                    <p className="text-[11.5px] text-muted flex items-center gap-1">
                                      <Satellite className="h-3 w-3 text-faint flex-none" />
                                      {e.gps.fixes === 0 ? 'No phone fixes during the shift' : <>{e.gps.fixes} fixes{e.onSitePct != null ? <> · <span className={e.onSitePct >= 80 ? 'text-teal' : e.onSitePct >= 50 ? 'text-amber' : 'text-red-300'}>{e.onSitePct}% on {e.zoneName}</span></> : null}</>}
                                    </p>
                                  )}
                                  {e.plan && <p className="text-[11.5px] text-faint truncate">Plan: {e.plan}</p>}
                                  {e.edited && (
                                    <p className="text-[11px] text-faint">Edited by {e.edited.by ?? 'someone'}{e.edited.note ? ` — “${e.edited.note}”` : ''}{e.edited.originalIn ? ` · recorded ${clockTime(e.edited.originalIn, tz)} → ${e.edited.originalOut ? clockTime(e.edited.originalOut, tz) : 'open'}` : ''}</p>
                                  )}
                                  {e.flags.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {e.flags.map((f) => <span key={f} className={`rounded-full border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.1em] ${FLAG_TONE[f]}`}>{FLAG_LABEL[f]}</span>)}
                                    </div>
                                  )}
                                </div>
                                {canEdit && (
                                  <button type="button" onClick={() => setEditing(e)} aria-label="Edit this entry" className="flex-none rounded-md border border-navy-700 p-1.5 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {editing && <EditEntrySheet row={editing} tz={tz} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh() }} />}
    </div>
  )
}

// ── Edit sheet ──────────────────────────────────────────────────────────────
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function EditEntrySheet({ row, tz, onClose, onSaved }: { row: TimeCardRow; tz: string; onClose: () => void; onSaved: () => void }) {
  const [inAt, setInAt] = useState(toLocalInput(row.inAt))
  const [outAt, setOutAt] = useState(toLocalInput(row.outAt))
  const [brk, setBrk] = useState(String(row.breakMinutes || 0))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const save = async () => {
    setBusy(true); setErr(null)
    const inMs = new Date(inAt).getTime()
    const outMs = outAt ? new Date(outAt).getTime() : null
    if (!Number.isFinite(inMs)) { setErr('Clock-in time is not valid.'); setBusy(false); return }
    const res = await adjustTimeEntryAction({
      id: row.id,
      clockInAt: new Date(inMs).toISOString(),
      clockOutAt: outMs != null && Number.isFinite(outMs) ? new Date(outMs).toISOString() : null,
      breakMinutes: Number(brk) || 0,
      note,
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? 'Save failed'); return }
    toast('Time entry updated — the original times stay on the record.')
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-navy-700 bg-navy-900 p-5 shadow-panel space-y-3" style={{ marginBottom: 'calc(var(--ht-safe-bottom, 0px) + 8px)' }}>
        <div>
          <h2 className="font-display font-bold text-lg text-ink">Correct this entry</h2>
          <p className="text-[12px] text-faint">{row.personName} · recorded {clockTime(row.inAt, tz)} → {row.outAt ? clockTime(row.outAt, tz) : 'open'}. The recorded times stay beside your correction.</p>
        </div>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Clock in</span>
          <input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2.5 text-sm text-ink" />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Clock out <span className="normal-case tracking-normal">(blank = still open)</span></span>
          <input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2.5 text-sm text-ink" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Unpaid break (min)</span>
            <input type="number" inputMode="numeric" min={0} max={720} value={brk} onChange={(e) => setBrk(e.target.value)} className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2.5 text-sm text-ink" />
          </label>
          <p className="self-end text-[11px] text-faint pb-2">Times are in this device&apos;s zone ({deviceTz}).</p>
        </div>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Why (required, stays on the record)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Forgot to clock out — left the site at 4:10" className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2.5 text-sm text-ink" />
        </label>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-navy-700 py-3 text-sm font-semibold text-muted">Cancel</button>
          <button type="button" onClick={save} disabled={busy || note.trim().length < 3} className="flex-1 rounded-xl bg-amber py-3 text-sm font-display font-bold text-[#1a1100] disabled:opacity-40">{busy ? 'Saving…' : 'Save correction'}</button>
        </div>
      </div>
    </div>
  )
}
