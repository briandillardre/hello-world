'use client'

import { useState, useTransition } from 'react'
import { BellOff, Check } from 'lucide-react'
import { saveDigestPrefsAction } from '@/lib/actions/company'
import { saveNotifyPrefsByTokenAction, silenceAllByTokenAction } from '@/lib/actions/notify-prefs'
import { allDigestsOff, silenceAll, type DigestPrefs } from '@/lib/weekly-digest'

/**
 * Every recurring summary, one switch each — the whole list in one place.
 *
 * Used twice with the same code so the two can never disagree: signed in at
 * Settings → Notifications, and signed OUT at /n/<token>, the page every
 * digest email and text links to (Brian, Sep 11: "add a link in texts and
 * emails to clients to go straight to turn off or change notifications").
 * With a token it saves through the token action; without one, through the
 * admin action.
 *
 * Autosaves on every change — an unsubscribe page with a Save button people
 * forget to press is not an unsubscribe page.
 */

const EVENING_HOURS = hours(15, 22)
const MORNING_HOURS = hours(4, 10)
const AFTERNOON_HOURS = hours(11, 22)

function hours(from: number, to: number): { v: number; l: string }[] {
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const v = from + i
    return { v, l: `${((v + 11) % 12) + 1}:00 ${v < 12 ? 'AM' : 'PM'}` }
  })
}

const TZS = [
  { v: 'America/New_York', l: 'Eastern' },
  { v: 'America/Chicago', l: 'Central' },
  { v: 'America/Denver', l: 'Mountain' },
  { v: 'America/Phoenix', l: 'Arizona' },
  { v: 'America/Los_Angeles', l: 'Pacific' },
]

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-amber' : 'bg-navy-700'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

function Chip({ on, disabled, onChange, children }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
        on ? 'border-teal/60 bg-teal/15 text-teal' : 'border-navy-700 bg-navy-950 text-faint'
      }`}
    >
      {children}
    </button>
  )
}

interface RowProps {
  title: string
  blurb: string
  on: boolean
  disabled?: boolean
  onToggle: (v: boolean) => void
  hour?: { value: number; options: { v: number; l: string }[]; onChange: (v: number) => void }
  children?: React.ReactNode
}

function Row({ title, blurb, on, disabled, onToggle, hour, children }: RowProps) {
  return (
    <div className="border-t border-navy-800 py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <Toggle on={on} disabled={disabled} onChange={onToggle} label={title} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-sm font-semibold text-ink">{title}</span>
            {hour && (
              <select
                className="rounded-lg border border-navy-700 bg-navy-950 px-2 py-1 text-xs text-ink disabled:opacity-40"
                disabled={disabled || !on} value={hour.value} aria-label={`${title} time`}
                onChange={(e) => hour.onChange(Number(e.target.value))}
              >
                {hour.options.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
              </select>
            )}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{blurb}</p>
          {on && children && <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>}
        </div>
      </div>
    </div>
  )
}

export function NotifyPrefsForm({
  initial,
  editable = true,
  token,
}: {
  initial: DigestPrefs
  editable?: boolean
  /** Present = the signed-out page reached from an email or text. */
  token?: string
}) {
  const [p, setP] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const off = !editable

  function save(next: DigestPrefs) {
    setP(next)
    setSaved(false)
    start(async () => {
      const r = token ? await saveNotifyPrefsByTokenAction(token, next) : await saveDigestPrefsAction(next)
      if (r.ok) { setError(null); setSaved(true); setTimeout(() => setSaved(false), 2200) }
      else setError(r.error ?? 'Save failed')
    })
  }

  function silence() {
    // Optimistic so a thumb on a slow connection sees it take.
    const next = silenceAll(p)
    setP(next)
    setSaved(false)
    start(async () => {
      const r = token ? await silenceAllByTokenAction(token) : await saveDigestPrefsAction(next)
      if (r.ok) { setError(null); setSaved(true); setTimeout(() => setSaved(false), 2200) }
      else { setError(r.error ?? 'Save failed'); setP(p) }
    })
  }

  const quiet = allDigestsOff(p)

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 font-display text-sm font-bold text-ink">Summaries</h2>
        {pending && <span className="text-[11px] text-faint">Saving…</span>}
        {!pending && saved && <span className="flex items-center gap-1 text-[11px] text-teal"><Check className="h-3 w-3" /> Saved</span>}
      </div>
      <p className="-mt-1 mb-3 text-[11.5px] text-faint">
        Emails and texts go to the company alert address and phone. Times are local to the timezone below.
      </p>

      <Row
        title="Evening digest" on={p.evening.enabled} disabled={off}
        blurb="Each evening: what moved, who is still on the clock, open alerts, overdue checks."
        onToggle={(v) => save({ ...p, evening: { ...p.evening, enabled: v } })}
        hour={{ value: p.evening.hour, options: EVENING_HOURS, onChange: (h) => save({ ...p, evening: { ...p.evening, hour: h } }) }}
      >
        <Chip on={p.evening.push} disabled={off} onChange={(v) => save({ ...p, evening: { ...p.evening, push: v } })}>Phone</Chip>
        <Chip on={p.evening.email} disabled={off} onChange={(v) => save({ ...p, evening: { ...p.evening, email: v } })}>Email</Chip>
        <Chip on={p.evening.sms} disabled={off} onChange={(v) => save({ ...p, evening: { ...p.evening, sms: v } })}>Text</Chip>
      </Row>

      <Row
        title="Morning site briefing" on={p.briefing.enabled} disabled={off}
        blurb="Weather at each active site, yesterday's hours and cost, punch items due, silent trackers."
        onToggle={(v) => save({ ...p, briefing: { ...p.briefing, enabled: v } })}
        hour={{ value: p.briefing.hour, options: MORNING_HOURS, onChange: (h) => save({ ...p, briefing: { ...p.briefing, hour: h } }) }}
      >
        <Chip on={p.briefing.email} disabled={off} onChange={(v) => save({ ...p, briefing: { ...p.briefing, email: v } })}>Email</Chip>
        <Chip on={p.briefing.sms} disabled={off} onChange={(v) => save({ ...p, briefing: { ...p.briefing, sms: v } })}>Text</Chip>
        <Chip on={p.briefing.weekdaysOnly} disabled={off} onChange={(v) => save({ ...p, briefing: { ...p.briefing, weekdaysOnly: v } })}>Weekdays only</Chip>
      </Row>

      <Row
        title="Monday agenda" on={p.monday.enabled} disabled={off}
        blurb="Monday morning: last week's problems as this week's to-do list."
        onToggle={(v) => save({ ...p, monday: { ...p.monday, enabled: v } })}
        hour={{ value: p.monday.hour, options: MORNING_HOURS, onChange: (h) => save({ ...p, monday: { ...p.monday, hour: h } }) }}
      >
        <Chip on={p.monday.push} disabled={off} onChange={(v) => save({ ...p, monday: { ...p.monday, push: v } })}>Phone</Chip>
        <Chip on={p.monday.email} disabled={off} onChange={(v) => save({ ...p, monday: { ...p.monday, email: v } })}>Email</Chip>
        <Chip on={p.monday.sms} disabled={off} onChange={(v) => save({ ...p, monday: { ...p.monday, sms: v } })}>Text</Chip>
      </Row>

      <Row
        title="Friday wrap-up" on={p.friday.enabled} disabled={off}
        blurb="The week that happened: hours, jobs, punch items done, alerts, missing receipts."
        onToggle={(v) => save({ ...p, friday: { ...p.friday, enabled: v } })}
        hour={{ value: p.friday.hour, options: AFTERNOON_HOURS, onChange: (h) => save({ ...p, friday: { ...p.friday, hour: h } }) }}
      >
        <Chip on={p.friday.email} disabled={off} onChange={(v) => save({ ...p, friday: { ...p.friday, email: v } })}>Email</Chip>
        <Chip on={p.friday.sms} disabled={off} onChange={(v) => save({ ...p, friday: { ...p.friday, sms: v } })}>Text</Chip>
      </Row>

      <Row
        title="Sunday week-ahead" on={p.sunday.enabled} disabled={off}
        blurb="What needs to happen: open punch items, milestones due, maintenance, receipts to chase. Email only."
        onToggle={(v) => save({ ...p, sunday: { ...p.sunday, enabled: v } })}
        hour={{ value: p.sunday.hour, options: AFTERNOON_HOURS, onChange: (h) => save({ ...p, sunday: { ...p.sunday, hour: h } }) }}
      />

      <Row
        title="Still on the clock" on={p.nag.enabled} disabled={off}
        blurb="One evening reminder naming anyone who never clocked out. Silent when everybody did."
        onToggle={(v) => save({ ...p, nag: { ...p.nag, enabled: v } })}
        hour={{ value: p.nag.hour, options: EVENING_HOURS, onChange: (h) => save({ ...p, nag: { ...p.nag, hour: h } }) }}
      >
        <Chip on={p.nag.push} disabled={off} onChange={(v) => save({ ...p, nag: { ...p.nag, push: v } })}>Phone</Chip>
      </Row>

      <div className="flex flex-wrap items-center gap-3 border-t border-navy-800 pt-3">
        <span className="text-xs text-muted">Timezone</span>
        <select
          className="rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-xs text-ink disabled:opacity-40"
          disabled={off} value={p.tz} aria-label="Timezone"
          onChange={(e) => save({ ...p, tz: e.target.value })}
        >
          {TZS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
      </div>

      <div className="mt-3 border-t border-navy-800 pt-3">
        {quiet ? (
          <p className="flex items-center gap-2 text-xs text-teal">
            <BellOff className="h-3.5 w-3.5" /> All summaries are off. Alerts still come through.
          </p>
        ) : (
          <button
            type="button" onClick={silence} disabled={off || pending}
            className="w-full rounded-lg border border-navy-700 bg-navy-950 px-4 py-2.5 text-sm font-semibold text-ink hover:border-navy-600 disabled:opacity-40 sm:w-auto"
          >
            Turn everything off
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  )
}
