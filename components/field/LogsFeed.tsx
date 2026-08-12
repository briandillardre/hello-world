'use client'

import { useMemo, useState } from 'react'
import { ClipboardList, ShieldAlert, Fuel, Receipt, AlarmClock, Download, Check, X } from 'lucide-react'
import type { TimeEntry, DailyLog } from '@/lib/field-types'
import type { PairSegment } from '@/lib/pairing'
import { decidePairAction, type PairDecision } from '@/lib/actions/pairs'
import { toast } from '@/components/ui/feedback'

/**
 * The office's morning read: every crew day grouped date → project, with the
 * writeup, photos, safety issues in red, fuel answers, and an hours table.
 * "Still clocked in" is rendered as a shame badge on purpose.
 */

interface Props {
  entries: TimeEntry[]
  logs: DailyLog[]
  zoneNames: Record<string, string>
  tz: string
  /** Who-ran-what beta: GPS co-movement segments (empty until phones track). */
  pairs?: PairSegment[]
  /** Foreman decisions on pairs (confirm/reject), keyed by day+person+machine. */
  pairDecisions?: PairDecision[]
}

const CATEGORY_LABEL: Record<string, string> = {
  project: 'Project', shop: 'Shop', overhead: 'Overhead', maintenance: 'Maintenance',
}

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
function dayLabel(key: string, tz: string): string {
  const d = new Date(`${key}T12:00:00`)
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(d)
}
function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}
function hoursOf(e: TimeEntry, now: number): number {
  const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : now
  return Math.max(0, (end - new Date(e.clock_in_at).getTime()) / 3_600_000)
}

export function LogsFeed({ entries, logs, zoneNames, tz, pairs = [], pairDecisions = [] }: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  const now = Date.now()
  // Foreman's confirm/reject on pairs — optimistic on top of the server rows.
  const [localDecisions, setLocalDecisions] = useState<Record<string, 'confirmed' | 'rejected'>>({})
  const decisionOf = (day: string, personId: string, machineId: string): 'confirmed' | 'rejected' | null => {
    const k = `${day}|${personId}|${machineId}`
    if (localDecisions[k]) return localDecisions[k]
    return pairDecisions.find((d) => d.day === day && d.person_asset_id === personId && d.machine_asset_id === machineId)?.status ?? null
  }
  const decide = async (day: string, personId: string, machineId: string, status: 'confirmed' | 'rejected') => {
    const k = `${day}|${personId}|${machineId}`
    setLocalDecisions((p) => ({ ...p, [k]: status }))
    const res = await decidePairAction(day, personId, machineId, status)
    if (!res.ok) {
      setLocalDecisions((p) => { const n = { ...p }; delete n[k]; return n })
      toast(res.error ?? 'Could not save that decision.', { variant: 'error' })
    }
  }

  // Payroll handoff: every entry in the window as a CSV the bookkeeper can
  // drop straight into payroll (or QuickBooks Time import).
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows = entries.map((e) => {
      const where = e.category === 'project'
        ? zoneNames[e.project_geofence_id ?? ''] ?? 'Project'
        : CATEGORY_LABEL[e.category]
      return [
        dayKey(e.clock_in_at, tz), e.person_name, where,
        timeLabel(e.clock_in_at, tz),
        e.clock_out_at ? timeLabel(e.clock_out_at, tz) : 'STILL ON',
        hoursOf(e, now).toFixed(2),
      ].map(esc).join(',')
    })
    const csv = ['Date,Name,Where,Clock in,Clock out,Hours', ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `hours-${dayKey(new Date().toISOString(), tz)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // This week's total per person — the number the Monday meeting starts with.
  const weekTotals = useMemo(() => {
    const start = new Date(now - 7 * 86_400_000).toISOString()
    const totals = new Map<string, number>()
    for (const e of entries) {
      if (e.clock_in_at < start) continue
      totals.set(e.person_name, (totals.get(e.person_name) ?? 0) + hoursOf(e, now))
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  }, [entries, now])

  const days = useMemo(() => {
    const logByEntry = new Map(logs.filter((l) => l.time_entry_id).map((l) => [l.time_entry_id as string, l]))
    const byDay = new Map<string, { entry: TimeEntry; log: DailyLog | null }[]>()
    for (const e of entries) {
      const k = dayKey(e.clock_in_at, tz)
      if (!byDay.has(k)) byDay.set(k, [])
      byDay.get(k)!.push({ entry: e, log: logByEntry.get(e.id) ?? null })
    }
    return Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, rows]) => {
        // Group the day's rows by where the time went.
        const byPlace = new Map<string, typeof rows>()
        for (const r of rows) {
          const place = r.entry.category === 'project'
            ? (zoneNames[r.entry.project_geofence_id ?? ''] ?? 'Project (zone deleted)')
            : CATEGORY_LABEL[r.entry.category] ?? r.entry.category
          if (!byPlace.has(place)) byPlace.set(place, [])
          byPlace.get(place)!.push(r)
        }
        return { key, places: Array.from(byPlace.entries()), rows }
      })
  }, [entries, logs, zoneNames, tz])

  if (!days.length) {
    return (
      <div className="rounded-xl border border-navy-700 bg-navy-950 p-8 text-center">
        <ClipboardList className="h-8 w-8 text-faint mx-auto mb-2" />
        <p className="text-sm text-muted">No clock-ins yet. The crew clocks in at <span className="font-mono text-teal">/clock</span> — their daily logs land here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {weekTotals.length > 0 && (
        <div className="rounded-xl border border-navy-800 bg-navy-950 px-3 py-2.5 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">Last 7 days</span>
          {weekTotals.map(([name, hrs]) => (
            <span key={name} className="rounded-full bg-navy-900 border border-navy-700 px-2.5 py-1 text-[11.5px] text-muted tabular-nums">
              {name} <b className="text-ink">{hrs.toFixed(1)}h</b>
            </span>
          ))}
          <button
            onClick={exportCsv}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 px-2.5 py-1.5 text-[11.5px] font-semibold text-muted hover:text-ink hover:border-teal/50 transition"
          >
            <Download className="h-3.5 w-3.5 text-teal" /> Hours CSV
          </button>
        </div>
      )}
      {days.map(({ key, places, rows }) => (
        <section key={key}>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-display font-bold text-ink">{dayLabel(key, tz)}</h2>
            <span className="font-mono text-[11px] text-faint tabular-nums">
              {rows.length} {rows.length === 1 ? 'entry' : 'entries'} · {rows.reduce((s, r) => s + hoursOf(r.entry, now), 0).toFixed(1)} h
            </span>
          </div>

          {/* hours table — who, where, in/out, hours */}
          <div className="rounded-xl border border-navy-800 overflow-hidden mb-3">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-navy-900 text-faint font-mono text-[10px] uppercase tracking-[0.1em]">
                  <th className="text-left px-3 py-1.5">Who</th>
                  <th className="text-left px-3 py-1.5">Where</th>
                  <th className="text-right px-3 py-1.5">In</th>
                  <th className="text-right px-3 py-1.5">Out</th>
                  <th className="text-right px-3 py-1.5">Hrs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entry }) => (
                  <tr key={entry.id} className="border-t border-navy-800/60">
                    <td className="px-3 py-1.5 text-ink font-medium">{entry.person_name}</td>
                    <td className="px-3 py-1.5 text-muted">
                      {entry.category === 'project'
                        ? zoneNames[entry.project_geofence_id ?? ''] ?? 'Project'
                        : CATEGORY_LABEL[entry.category]}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted tabular-nums">{timeLabel(entry.clock_in_at, tz)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {entry.clock_out_at
                        ? <span className="text-muted">{timeLabel(entry.clock_out_at, tz)}</span>
                        : <span className="text-alert font-semibold inline-flex items-center gap-1"><AlarmClock className="h-3 w-3" /> STILL ON</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink font-semibold tabular-nums">{hoursOf(entry, now).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* who ran what (beta) — GPS co-movement evidence */}
          {(() => {
            const dayPairs = pairs.filter((pr) => dayKey(new Date(pr.fromMs).toISOString(), tz) === key)
            if (!dayPairs.length) return null
            return (
              <div className="rounded-xl border border-navy-800 bg-navy-950 px-3 py-2.5 mb-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint mb-1.5">Who ran what · confirm below</p>
                <ul className="space-y-1">
                  {dayPairs.map((pr, i) => {
                    const decision = decisionOf(key, pr.personId, pr.machineId)
                    if (decision === 'rejected') {
                      return (
                        <li key={i} className="flex items-center gap-2 text-[11.5px] text-faint line-through opacity-50">
                          <span>{pr.personName} ↔ {pr.machineName}</span>
                          <button onClick={() => decide(key, pr.personId, pr.machineId, 'confirmed')} className="ml-auto no-underline font-mono text-[10px] hover:text-teal">undo</button>
                        </li>
                      )
                    }
                    return (
                      <li key={i} className="flex items-center gap-2 text-[12.5px]">
                        <span className="text-ink font-medium">{pr.personName}</span>
                        <span className="text-faint">↔</span>
                        <span className="text-ink font-medium truncate flex-1">{pr.machineName}</span>
                        <span className="font-mono text-muted tabular-nums">{timeLabel(new Date(pr.fromMs).toISOString(), tz)}–{timeLabel(new Date(pr.toMs).toISOString(), tz)}</span>
                        {decision === 'confirmed' ? (
                          <span className="flex items-center gap-1 font-mono text-[10px] text-teal flex-none"><Check className="h-3 w-3" /> confirmed</span>
                        ) : (
                          <>
                            <span className="font-mono text-faint tabular-nums">{Math.round(pr.confidence * 100)}%</span>
                            <span className="flex items-center gap-0.5 flex-none">
                              <button onClick={() => decide(key, pr.personId, pr.machineId, 'confirmed')} title="Confirm — yes, they ran it" className="grid place-items-center w-6 h-6 rounded-md bg-teal/15 text-teal hover:bg-teal/30 transition-colors">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => decide(key, pr.personId, pr.machineId, 'rejected')} title="Reject — the GPS guessed wrong" className="grid place-items-center w-6 h-6 rounded-md bg-navy-800 text-faint hover:text-alert hover:bg-alert/15 transition-colors">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })()}

          {/* per-project log cards */}
          {places.map(([place, list]) => (
            <div key={place} className="mb-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-teal mb-1.5">{place}</p>
              <div className="space-y-2">
                {list.map(({ entry, log }) => (
                  <article key={entry.id} className="rounded-xl border border-navy-800 bg-navy-950 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-semibold text-ink">{entry.person_name}</span>
                      <span className="font-mono text-[10.5px] text-faint tabular-nums">{hoursOf(entry, now).toFixed(1)} h</span>
                    </div>
                    {entry.plan && <p className="text-[12px] text-faint mb-1">Plan: {entry.plan}</p>}
                    {log ? (
                      <>
                        <p className="text-[13px] text-muted whitespace-pre-line">{log.writeup}</p>
                        {log.safety && (
                          <p className="mt-1.5 text-[12.5px] text-alert flex items-start gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-none" /> {log.safety}
                          </p>
                        )}
                        {(log.trucks_fueled !== null || log.equipment_fueled !== null) && (
                          <p className="mt-1.5 text-[11.5px] text-faint flex items-center gap-2">
                            <Fuel className="h-3 w-3" />
                            {log.trucks_fueled !== null && <span className={log.trucks_fueled ? '' : 'text-amber'}>trucks {log.trucks_fueled ? 'fueled' : 'NOT fueled'}</span>}
                            {log.equipment_fueled !== null && <span className={log.equipment_fueled ? '' : 'text-amber'}>equipment {log.equipment_fueled ? 'fueled' : 'NOT fueled'}</span>}
                          </p>
                        )}
                        {/* Custom form answers (admin-built questions, 059) —
                            self-describing {label, value} pairs. */}
                        {Array.isArray(log.answers) && log.answers.length > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {log.answers.map((a) => (
                              <p key={a.id} className="text-[11.5px] text-muted">
                                <span className="text-faint">{a.label}:</span>{' '}
                                {typeof a.value === 'boolean' ? (a.value ? 'Yes' : 'No')
                                  : Array.isArray(a.value) ? a.value.join(', ')
                                  : String(a.value)}
                              </p>
                            ))}
                          </div>
                        )}
                        {log.photos.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {log.photos.map((p, i) => (
                              <button key={i} onClick={() => setLightbox(p.url)} className="relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.url} alt={p.kind} className="h-16 w-16 object-cover rounded-md border border-navy-700" />
                                {p.kind === 'receipt' && (
                                  <span className="absolute bottom-0 inset-x-0 bg-amber/90 text-[#1a1100] text-[8.5px] font-bold text-center rounded-b-md flex items-center justify-center gap-0.5">
                                    <Receipt className="h-2.5 w-2.5" /> RECEIPT
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[12.5px] text-amber">No daily log{entry.clock_out_at ? '' : ' yet — still clocked in'}.</p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {lightbox && (
        <button className="fixed inset-0 z-[70] bg-black/85 grid place-items-center p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="log photo" className="max-h-[90vh] max-w-full rounded-lg" />
        </button>
      )}
    </div>
  )
}
