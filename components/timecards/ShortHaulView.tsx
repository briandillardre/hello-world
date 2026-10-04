'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, FileCheck2, Info, Truck } from 'lucide-react'
import { toast } from '@/components/ui/feedback'
import { isNativeApp } from '@/lib/native'
import { addDaysKey, fmtDay, fmtTime } from '@/lib/dates'
import {
  DRIVER_CLASS_LABEL, ISSUE_LABEL, LOG_ISSUES, eldWords,
  type DriverClass, type ShortHaulDay, type ShortHaulIssue, type ShortHaulRecord,
} from '@/lib/short-haul'
import { setDriverClassAction } from '@/lib/actions/short-haul'

/**
 * /timecards/short-haul — the carrier's DOT time records under the federal
 * short-haul exception (49 CFR 395.1(e)), straight off the time clock. Most
 * contractor drivers need these, not an ELD: one row per driver per day —
 * reported for duty, released, hours on duty, the prior 7 days, how far the
 * phone went from where the day started — and a verdict per day. A day that
 * misses the exception needs a paper log; past 8 in 30, an ELD.
 */
const h1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

const ISSUE_TONE = (i: ShortHaulIssue) => LOG_ISSUES.includes(i)
  ? 'border-red-400/40 text-red-300 bg-red-400/10'
  : 'border-navy-600 text-muted bg-navy-900'

export interface ShortHaulPerson {
  id: string
  name: string
  driverClass: DriverClass | null
  canSet: boolean
}

export function ShortHaulView({ records, people, toKey, todayKey, tz, verified, ready, seesAll, canSetup, demo = false }: {
  records: ShortHaulRecord[]
  /** The team, with each person's driver type — the setup list. */
  people: ShortHaulPerson[]
  /** The window's last day (local day key); the window is the 30 days ending here. */
  toKey: string
  todayKey: string
  tz: string
  /** The radius function answered (migration 126). */
  verified: boolean
  /** The database has migration 126. */
  ready: boolean
  seesAll: boolean
  canSetup: boolean
  demo?: boolean
}) {
  const router = useRouter()
  const [native, setNative] = useState(false)
  useEffect(() => { setNative(isNativeApp()) }, [])
  const drivers = people.filter((p) => p.driverClass)
  const [setupOpen, setSetupOpen] = useState(drivers.length === 0)
  const fromKey = addDaysKey(toKey, -29)
  const go = (k: string) => router.push(`/timecards/short-haul?to=${k}`)
  const logTotal = records.reduce((n, r) => n + r.days.filter((d) => d.logNeeded).length, 0)

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-8">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Link href="/timecards" className="text-[11.5px] text-teal underline-offset-2 hover:underline">← Time cards</Link>
            <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-amber" /> DOT short-haul records</h1>
            <p className="text-[12.5px] text-faint">Daily time records for commercial drivers, kept from the time clock — what the short-haul exception asks for instead of an ELD.</p>
          </div>
          {native ? (
            <span className="flex-none text-[11px] text-faint text-right max-w-[120px]">CSV export: open this page on a computer</span>
          ) : records.length > 0 ? (
            <a
              href={`/api/timecards/short-haul/export?to=${toKey}`}
              className="flex-none inline-flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[12px] font-semibold text-ink hover:border-amber/50"
              title="Download these 30 days as a CSV — one row per driver per day"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
          ) : null}
        </div>

        <RuleCard />

        {!ready && !demo && (
          <p className="rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">The database is still updating for this page — check back in a few minutes.</p>
        )}
        {demo && (
          <p className="rounded-xl border border-navy-700 bg-navy-900 px-3 py-2 text-[12.5px] text-muted">Demo mode: sign in to a real company to keep short-haul records.</p>
        )}
        {ready && !verified && records.length > 0 && (
          <p className="rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">The 150-mile radius check isn’t available right now — hours are shown, distances are not.</p>
        )}

        {/* Window nav */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(addDaysKey(toKey, -30))} aria-label="Previous 30 days" className="rounded-lg border border-navy-700 bg-navy-900 p-2 text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex-1 text-center">
            <p className="font-display font-bold text-ink">{fmtDay(Date.parse(`${fromKey}T12:00:00Z`), 'UTC')} – {fmtDay(Date.parse(`${toKey}T12:00:00Z`), 'UTC')}</p>
            {toKey !== todayKey && <button type="button" onClick={() => go(todayKey)} className="text-[11.5px] text-teal underline-offset-2 hover:underline">Last 30 days</button>}
          </div>
          <button
            type="button"
            onClick={() => go(addDaysKey(toKey, 30) > todayKey ? todayKey : addDaysKey(toKey, 30))}
            disabled={toKey >= todayKey}
            aria-label="Next 30 days"
            className="rounded-lg border border-navy-700 bg-navy-900 p-2 text-muted hover:text-ink disabled:opacity-40"
          ><ChevronRight className="h-4 w-4" /></button>
        </div>

        {/* Setup: who drives a commercial vehicle */}
        {seesAll && ready && (
          <section className="rounded-2xl border border-navy-700 bg-navy-850">
            <button type="button" onClick={() => setSetupOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
              <Truck className="h-4 w-4 text-amber flex-none" />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-ink text-[13.5px]">Who drives a commercial vehicle?</span>
                <span className="block text-[11.5px] text-faint">{drivers.length ? `${drivers.length} driver${drivers.length === 1 ? '' : 's'} marked` : 'Nobody marked yet — only marked drivers get records.'}</span>
              </span>
              {setupOpen ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
            </button>
            {setupOpen && (
              <div className="border-t border-navy-700 px-4 py-3 space-y-2">
                <p className="text-[11.5px] text-faint">A commercial vehicle is 10,001 lb or more GVWR — or a truck and trailer that add up to it. A pickup under that with no trailer is not one.</p>
                {people.map((p) => <DriverRow key={p.id} person={p} disabled={!canSetup || !p.canSet} />)}
                {!canSetup && <p className="text-[11.5px] text-faint">Someone who manages the team sets this.</p>}
              </div>
            )}
          </section>
        )}

        {ready && records.length === 0 && (
          <div className="rounded-2xl border border-navy-700 bg-navy-850 px-4 py-6 text-center">
            <p className="font-semibold text-ink">{drivers.length ? 'No clocked shifts for these drivers in these 30 days.' : 'Mark your commercial drivers to start keeping records.'}</p>
            <p className="mt-1 text-[12px] text-faint">{drivers.length ? 'Records build themselves from the time clock: clock-in is reporting for duty, clock-out is release.' : 'Every shift they clock from then on becomes a record here.'}</p>
          </div>
        )}

        {records.length > 0 && (
          <p className="text-[12px] text-muted">{logTotal ? `${logTotal} day${logTotal === 1 ? '' : 's'} in this window need a paper log (record of duty status).` : 'Every day in this window met the short-haul exception or is still on duty.'}</p>
        )}

        {records.map((r) => <DriverCard key={r.userId} record={r} tz={tz} />)}
      </div>
    </div>
  )
}

function RuleCard() {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-2xl border border-navy-700 bg-navy-900 px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <Info className="h-4 w-4 text-teal flex-none" />
        <span className="flex-1 text-[12.5px] text-muted">A day meets the short-haul exception when the driver stays within <b className="text-ink">150 air-miles</b>, comes back, and is released within <b className="text-ink">14 hours</b>.</span>
        {open ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-[12px] text-faint list-disc pl-5">
          <li><b className="text-muted">CDL drivers</b> (49 CFR 395.1(e)(1)): within 150 air-miles of where they report, back and released within 14 hours, and 10 hours off between shifts.</li>
          <li><b className="text-muted">Commercial drivers without a CDL</b> (395.1(e)(2)): within 150 air-miles and back each day; past 14 hours on at most 2 days in any 7, never past 16.</li>
          <li>A day that misses any of these needs a paper log (record of duty status). More than 8 such days in any 30 means the driver needs an ELD.</li>
          <li>Keep these records 6 months. Where the day started = the first clock-in; how far = the phone’s GPS during the shift; hours = the clocked hours.</li>
          <li>Federal rules. South Carolina’s rules for trucks that never leave the state can differ — ask your safety advisor.</li>
        </ul>
      )}
    </section>
  )
}

function DriverRow({ person, disabled }: { person: ShortHaulPerson; disabled: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState<DriverClass | ''>(person.driverClass ?? '')
  const [pending, start] = useTransition()
  useEffect(() => { setValue(person.driverClass ?? '') }, [person.driverClass])
  const save = (next: DriverClass | '') => {
    const prev = value
    setValue(next)
    start(async () => {
      const r = await setDriverClassAction(person.id, next || null)
      if (!r?.ok) { setValue(prev); toast(r?.error ?? 'Could not save that.', { variant: 'error' }); return }
      router.refresh()
    })
  }
  return (
    <label className="flex items-center gap-3">
      <span className="flex-1 min-w-0 truncate text-[13px] text-ink">{person.name}</span>
      <select
        value={value}
        disabled={disabled || pending}
        onChange={(e) => save(e.target.value as DriverClass | '')}
        className="flex-none rounded-lg border border-navy-700 bg-navy-900 px-2 py-1.5 text-[12.5px] text-ink disabled:opacity-50"
        aria-label={`Driver type for ${person.name}`}
      >
        <option value="">Not a commercial driver</option>
        <option value="cdl">{DRIVER_CLASS_LABEL.cdl}</option>
        <option value="cmv">{DRIVER_CLASS_LABEL.cmv}</option>
      </select>
    </label>
  )
}

function DriverCard({ record, tz }: { record: ShortHaulRecord; tz: string }) {
  const [open, setOpen] = useState(true)
  const tone = record.eld === 'needed' ? 'border-red-400/40 text-red-300 bg-red-400/10'
    : record.eld === 'warn' ? 'border-amber/40 text-amber bg-amber/10'
    : 'border-teal/40 text-teal bg-teal/10'
  return (
    <section className="rounded-2xl border border-navy-700 bg-navy-850">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-ink text-[14px] truncate">{record.personName}</span>
          <span className="block text-[11.5px] text-faint">{DRIVER_CLASS_LABEL[record.driverClass]} · {h1(record.windowH)} h on duty in these 30 days</span>
        </span>
        <span className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
          {record.eld === 'needed' ? 'ELD needed' : `${record.logDays30} of 8 log days`}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-faint mt-0.5" /> : <ChevronDown className="h-4 w-4 text-faint mt-0.5" />}
      </button>
      {open && (
        <div className="border-t border-navy-700">
          <p className={`px-4 py-2 text-[12px] ${record.eld === 'ok' ? 'text-faint' : record.eld === 'warn' ? 'text-amber' : 'text-red-300'}`}>
            {record.eld !== 'ok' && <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}{eldWords(record)}
          </p>
          <ul className="divide-y divide-navy-700">
            {record.days.map((d) => <DayRow key={d.dayKey} day={d} tz={tz} cdl={record.driverClass === 'cdl'} />)}
          </ul>
        </div>
      )}
    </section>
  )
}

function DayRow({ day, tz, cdl }: { day: ShortHaulDay; tz: string; cdl: boolean }) {
  const verdict = day.logNeeded ? { text: 'Log needed', cls: 'text-red-300' }
    : day.open ? { text: 'On duty', cls: 'text-teal' }
    : day.issues.length ? { text: 'Can’t verify', cls: 'text-amber' }
    : { text: 'Met', cls: 'text-teal' }
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="w-[86px] flex-none text-[12.5px] font-semibold text-ink">{fmtDay(Date.parse(`${day.dayKey}T12:00:00Z`), 'UTC')}</span>
        <span className="flex-1 min-w-0 text-[12.5px] text-muted">
          {fmtTime(Date.parse(day.startAt), tz)} – {day.releaseAt ? fmtTime(Date.parse(day.releaseAt), tz) : 'now'}
          <span className="text-faint"> · {h1(day.onDutyH)} h on duty{day.reachAirMi != null ? ` · ${h1(day.reachAirMi)} air-mi out` : ''}</span>
        </span>
        <span className={`flex-none text-[12px] font-semibold ${verdict.cls}`}>{verdict.text}</span>
      </div>
      <p className="mt-0.5 pl-[94px] text-[11px] text-faint">
        {day.open ? 'Since start' : 'Start to release'} {h1(day.spanH)} h · prior 7 days {h1(day.prior7H)} h{cdl && day.restH != null ? ` · ${h1(day.restH)} h off before` : ''}{day.shifts > 1 ? ` · ${day.shifts} shifts` : ''}
      </p>
      {day.issues.length > 0 && (
        <div className="mt-1 pl-[94px] space-y-1">
          <div className="flex flex-wrap gap-1">
            {day.issues.map((i) => <span key={i} className={`rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold ${ISSUE_TONE(i)}`}>{ISSUE_LABEL[i]}</span>)}
          </div>
          {day.notes.map((n, k) => <p key={k} className="text-[11.5px] text-muted">{n}</p>)}
        </div>
      )}
    </li>
  )
}
