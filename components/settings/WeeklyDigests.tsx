'use client'

import { useState, useTransition } from 'react'
import { CalendarClock } from 'lucide-react'
import { saveDigestPrefsAction } from '@/lib/actions/company'
import type { DigestPrefs } from '@/lib/weekly-digest'

const HOURS: { v: number; l: string }[] = Array.from({ length: 12 }, (_, i) => {
  const v = i + 11 // 11:00–22:00 — the plausible send window
  return { v, l: `${((v + 11) % 12) + 1}:00 ${v < 12 ? 'AM' : 'PM'}` }
})

// Briefing sends in the early morning — a different window than the digests.
const MORNING_HOURS: { v: number; l: string }[] = Array.from({ length: 7 }, (_, i) => {
  const v = i + 4 // 4:00–10:00 AM
  return { v, l: `${v}:00 AM` }
})

const TZS = [
  { v: 'America/New_York', l: 'Eastern' },
  { v: 'America/Chicago', l: 'Central' },
  { v: 'America/Denver', l: 'Mountain' },
  { v: 'America/Phoenix', l: 'Arizona' },
  { v: 'America/Los_Angeles', l: 'Pacific' },
]

/**
 * Weekly summaries — Friday wrap-up (email/text) + Sunday week-ahead email.
 * Sends go to the company alert email/phone set in Company settings above.
 */
export function WeeklyDigests({ initial, editable }: { initial: DigestPrefs; editable: boolean }) {
  const [p, setP] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save(next: DigestPrefs) {
    setP(next)
    setSaved(false)
    start(async () => {
      const r = await saveDigestPrefsAction(next)
      if (r.ok) { setSaved(true); setError(null); setTimeout(() => setSaved(false), 2000) }
      else setError(r.error ?? 'Save failed')
    })
  }

  const row = 'flex flex-wrap items-center gap-x-3 gap-y-2'
  const sel = 'rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-ink disabled:opacity-40'
  const chk = 'h-4 w-4 accent-amber'

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-amber" />
        <h2 className="font-display font-bold text-sm text-ink flex-1">Weekly summaries</h2>
        {pending && <span className="text-[11px] text-faint">Saving…</span>}
        {saved && <span className="text-[11px] text-teal">Saved ✓</span>}
      </div>
      <p className="text-[11.5px] text-faint -mt-2">
        Sent to the company alert email/phone above. Times are local to the timezone picked here.
      </p>

      <div className={row}>
        <label className="flex items-center gap-2 text-sm text-ink font-medium min-w-[190px]">
          <input type="checkbox" className={chk} disabled={!editable}
            checked={p.friday.enabled}
            onChange={(e) => save({ ...p, friday: { ...p.friday, enabled: e.target.checked } })} />
          Friday wrap-up
        </label>
        <select className={sel} disabled={!editable || !p.friday.enabled} value={p.friday.hour}
          onChange={(e) => save({ ...p, friday: { ...p.friday, hour: Number(e.target.value) } })}>
          {HOURS.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className={chk} disabled={!editable || !p.friday.enabled}
            checked={p.friday.email}
            onChange={(e) => save({ ...p, friday: { ...p.friday, email: e.target.checked } })} />
          Email
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className={chk} disabled={!editable || !p.friday.enabled}
            checked={p.friday.sms}
            onChange={(e) => save({ ...p, friday: { ...p.friday, sms: e.target.checked } })} />
          Text
        </label>
      </div>
      <p className="text-[11px] text-faint -mt-2 pl-6">The week that happened: hours, jobs, punch items done, alerts, missing receipts.</p>

      <div className={row}>
        <label className="flex items-center gap-2 text-sm text-ink font-medium min-w-[190px]">
          <input type="checkbox" className={chk} disabled={!editable}
            checked={p.sunday.enabled}
            onChange={(e) => save({ ...p, sunday: { ...p.sunday, enabled: e.target.checked } })} />
          Sunday week-ahead
        </label>
        <select className={sel} disabled={!editable || !p.sunday.enabled} value={p.sunday.hour}
          onChange={(e) => save({ ...p, sunday: { ...p.sunday, hour: Number(e.target.value) } })}>
          {HOURS.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
        </select>
        <span className="text-xs text-faint">Email only</span>
      </div>
      <p className="text-[11px] text-faint -mt-2 pl-6">What needs to happen this week: open punch items, milestones due, maintenance, receipts to chase.</p>

      <div className={row}>
        <label className="flex items-center gap-2 text-sm text-ink font-medium min-w-[190px]">
          <input type="checkbox" className={chk} disabled={!editable}
            checked={p.briefing.enabled}
            onChange={(e) => save({ ...p, briefing: { ...p.briefing, enabled: e.target.checked } })} />
          Morning site briefing
        </label>
        <select className={sel} disabled={!editable || !p.briefing.enabled} value={p.briefing.hour}
          onChange={(e) => save({ ...p, briefing: { ...p.briefing, hour: Number(e.target.value) } })}>
          {MORNING_HOURS.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className={chk} disabled={!editable || !p.briefing.enabled}
            checked={p.briefing.email}
            onChange={(e) => save({ ...p, briefing: { ...p.briefing, email: e.target.checked } })} />
          Email
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className={chk} disabled={!editable || !p.briefing.enabled}
            checked={p.briefing.sms}
            onChange={(e) => save({ ...p, briefing: { ...p.briefing, sms: e.target.checked } })} />
          Text
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className={chk} disabled={!editable || !p.briefing.enabled}
            checked={p.briefing.weekdaysOnly}
            onChange={(e) => save({ ...p, briefing: { ...p.briefing, weekdaysOnly: e.target.checked } })} />
          Weekdays only
        </label>
      </div>
      <p className="text-[11px] text-faint -mt-2 pl-6">Every workday morning: weather at each active site, yesterday&apos;s hours &amp; cost per job, punch items due today, silent trackers &amp; overdue service.</p>

      <div className={row}>
        <span className="text-xs text-muted min-w-[190px] pl-6">Timezone</span>
        <select className={sel} disabled={!editable} value={p.tz}
          onChange={(e) => save({ ...p, tz: e.target.value })}>
          {TZS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  )
}
