'use client'

/**
 * The lien clock, job by job: South Carolina's notice-of-furnishing, lien and
 * suit deadlines (or, on a public job, the payment-bond notice and suit),
 * counted from the first and last day our machines or crew were on the site —
 * the dates HammerTrack already has from GPS and the time clock. Each job can
 * override them, mark what was served or filed, and stop the clock when paid.
 */
import { useState } from 'react'
import { Scale } from 'lucide-react'
import type { Deadline, DeadlineState } from '@/lib/beta/lien'
import type { BetaRecord } from '@/lib/db/beta'
import { BetaPage, Notice, RecordEditor, StatePill, btn, card, fmtDay } from './ui'

export interface LienRow {
  siteId: string; siteName: string; jobNumber: string | null; stage: string | null; customer: string | null
  sheet: BetaRecord | null
  clock: { first: string | null; last: string | null; lastMoving: boolean; deadlines: Deadline[]; stopped: boolean }
  worst: DeadlineState | null
  gpsFirst: string | null; gpsLast: string | null
}

const ROLE: Record<string, string> = { prime: 'Prime', sub: 'Sub', sub2: 'Sub-sub', supplier: 'Supplier' }

export function LiensView({ rows, today, demo, canWrite }: { rows: LienRow[]; today: string; demo: boolean; canWrite: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  const urgent = rows.filter((r) => r.worst === 'overdue' || r.worst === 'urgent').length
  return (
    <BetaPage title="Lien clock" icon={<Scale className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="Your lien rights on every job, counted from the days you were really there. SC: notice of furnishing within 90 days of first furnishing, the lien within 90 days of last, suit within 6 months of filing; on public jobs, the bond instead.">
      <Notice tone="warn">A reminder, not legal advice. The day counts follow the statute; your attorney decides what gets served and filed.</Notice>
      {urgent > 0 && <Notice tone="bad">{urgent} {urgent === 1 ? 'job has' : 'jobs have'} a deadline inside a week or already past.</Notice>}
      {!rows.length && <Notice tone="info">No jobs on the books yet. Jobs that are awarded or running show here — start one on the Jobs page.</Notice>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.siteId} className={`${card} space-y-2`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{r.siteName}{r.jobNumber ? <span className="text-muted font-normal"> · {r.jobNumber}</span> : null}</p>
                <p className="text-faint text-[12px]">
                  {r.sheet?.data.role ? `${ROLE[String(r.sheet.data.role)] ?? ''} · ` : 'Role not set (counted as a sub) · '}
                  {r.sheet?.data.public ? 'Public job · ' : ''}
                  First on site {fmtDay(r.clock.first)}{r.sheet?.data.firstFurnished ? ' (typed)' : r.gpsFirst ? ' (GPS / time clock)' : ''}
                  {' · '}Last {r.clock.lastMoving ? 'today — still working' : fmtDay(r.clock.last)}{r.sheet?.data.lastFurnished ? ' (typed)' : ''}
                </p>
              </div>
              {canWrite && editing !== r.siteId && <button type="button" className={btn} onClick={() => setEditing(r.siteId)}>{r.sheet ? 'Edit' : 'Set up'}</button>}
            </div>
            {editing === r.siteId && (
              <RecordEditor kind="lien" record={r.sheet} fixed={{ siteId: r.siteId }} withMoney={false} onDone={() => setEditing(null)} defaults={{ role: 'sub' }} label={`Lien sheet · ${r.siteName}`} />
            )}
            <div className="grid gap-1.5">
              {r.clock.deadlines.map((d) => (
                <div key={d.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-800 pt-1.5">
                  <span className="min-w-0"><span className="text-ink">{d.label}</span> <span className="text-faint text-[11.5px]">· {d.basis}</span></span>
                  <span className="flex items-center gap-2">
                    {d.due && d.state !== 'done' && <span className="text-muted text-[12px]">by {fmtDay(d.due)}</span>}
                    <StatePill state={d.state}>{d.words}</StatePill>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-faint text-[11.5px]">“Last furnished” keeps moving while a job is running. When the work is done, type the last day on the job’s sheet (or let the GPS say it) and the clock fixes. Today is {fmtDay(today)}.</p>
    </BetaPage>
  )
}
