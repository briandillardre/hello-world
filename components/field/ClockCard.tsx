'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, HardHat, Camera, Receipt, LogIn, LogOut, ShieldAlert, Fuel } from 'lucide-react'
import { clockInAction, clockOutAction } from '@/lib/actions/fieldops'
import type { ClockCategory, TimeEntry } from '@/lib/field-types'

/**
 * The crew's whole day in one card: clock in (project + plan), live timer,
 * and the clock-out toll gate — no daily log, no clock-out. Built for a phone
 * held in one hand with gloves on: big targets, no typing beyond the writeup.
 */

const CATEGORIES: { key: ClockCategory; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'shop', label: 'Shop' },
  { key: 'overhead', label: 'Overhead' },
  { key: 'maintenance', label: 'Maintenance' },
]

function elapsedLabel(sinceIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 60_000))
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

export function ClockCard({ openEntry, zones, available, personName, demo = false }: {
  openEntry: TimeEntry | null
  zones: { id: string; name: string }[]
  available: boolean
  personName: string
  /** Demo mode: show the pitch, not internal setup instructions. */
  demo?: boolean
}) {
  const router = useRouter()
  const [category, setCategory] = useState<ClockCategory>('project')
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? '')
  const [plan, setPlan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [now, setNow] = useState(Date.now())
  const formRef = useRef<HTMLFormElement>(null)
  const [photoCount, setPhotoCount] = useState(0)
  const [receiptCount, setReceiptCount] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!available) {
    return (
      <div className="rounded-xl border border-navy-700 bg-navy-950 p-6 text-center">
        <Clock className="h-8 w-8 text-faint mx-auto mb-2" />
        {demo ? (
          <>
            <p className="font-display font-bold text-ink mb-1">The crew&apos;s day, in one card.</p>
            <p className="text-sm text-muted">
              Workers clock in to a job site with a plan for the day — and the only way off the
              clock is a daily log: what got done, photos, receipts, safety issues, fuel status.
              Sign in to a live account to use it.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            One quick database update turns the time clock on — run migration{' '}
            <span className="font-mono text-teal">015_field_ops.sql</span> in the Supabase SQL Editor, then reload.
          </p>
        )}
      </div>
    )
  }

  const clockIn = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await clockInAction({
      category,
      projectGeofenceId: category === 'project' ? zoneId || null : null,
      plan,
    })
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Clock-in failed')
    else router.refresh()
  }

  const submitLog = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await clockOutAction(new FormData(e.currentTarget))
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Clock-out failed')
    else {
      setLoggingOut(false)
      router.refresh()
    }
  }

  // ── Not clocked in ──
  if (!openEntry) {
    return (
      <div className="rounded-xl border border-navy-700 bg-navy-950 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-amber" />
          <p className="font-display font-bold text-ink">Morning, {personName.split(' ')[0]}. Where&apos;s the day going?</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={
                'py-3 rounded-lg text-sm font-semibold border transition ' +
                (category === c.key
                  ? 'bg-amber/15 text-amber border-amber/40'
                  : 'bg-navy-900 text-muted border-navy-700 hover:text-ink')
              }
            >
              {c.label}
            </button>
          ))}
        </div>

        {category === 'project' && (
          zones.length ? (
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full bg-navy-900 border border-navy-700 rounded-lg px-3 py-3 text-sm text-ink outline-none focus:border-amber/50"
            >
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          ) : (
            <p className="text-[12px] text-faint">No job-site zones yet — pick Shop, or draw a zone on the map first.</p>
          )
        )}

        <textarea
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          rows={2}
          placeholder="Plan for today (one line — what's getting done?)"
          className="w-full bg-navy-900 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber/50 resize-none"
        />

        {error && <p className="text-[12.5px] text-alert">{error}</p>}

        <button
          onClick={clockIn}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold text-lg py-4 disabled:opacity-50 hover:brightness-110 transition"
        >
          <LogIn className="h-5 w-5" /> {busy ? 'Clocking in…' : 'Clock in'}
        </button>
      </div>
    )
  }

  const zoneName = zones.find((z) => z.id === openEntry.project_geofence_id)?.name
  const whereLabel = openEntry.category === 'project'
    ? (zoneName ?? 'Project')
    : CATEGORIES.find((c) => c.key === openEntry.category)?.label ?? openEntry.category

  // ── Clocked in ──
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-950 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-teal">On the clock · {whereLabel}</p>
          <p className="font-display font-bold text-2xl text-ink tabular-nums">{elapsedLabel(openEntry.clock_in_at, now)}</p>
        </div>
        <span className="grid place-items-center w-11 h-11 rounded-full bg-teal/15 border border-teal/40">
          <Clock className="h-5 w-5 text-teal" />
        </span>
      </div>
      {openEntry.plan && (
        <p className="text-[13px] text-muted border-l-2 border-navy-700 pl-2.5">Today&apos;s plan: {openEntry.plan}</p>
      )}

      {!loggingOut ? (
        <button
          onClick={() => setLoggingOut(true)}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-navy-900 border border-navy-700 text-ink font-display font-bold text-lg py-4 hover:border-amber/50 transition"
        >
          <LogOut className="h-5 w-5" /> Clock out
        </button>
      ) : (
        <form ref={formRef} onSubmit={submitLog} className="space-y-3">
          <p className="font-display font-bold text-ink">Daily log first — then you&apos;re out.</p>

          <textarea
            name="writeup"
            rows={4}
            required
            placeholder="What got done today? Problems? What's queued for tomorrow?"
            className="w-full bg-navy-900 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber/50 resize-none"
          />

          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-alert mt-2.5 flex-none" />
            <textarea
              name="safety"
              rows={1}
              placeholder="Safety issues? (leave blank if none)"
              className="flex-1 bg-navy-900 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-alert/50 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-[13px]">
            {([['trucksFueled', 'Trucks fueled?'], ['equipmentFueled', 'Equipment fueled?']] as const).map(([name, label]) => (
              <fieldset key={name} className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2">
                <legend className="sr-only">{label}</legend>
                <p className="text-faint flex items-center gap-1 mb-1"><Fuel className="h-3.5 w-3.5" /> {label}</p>
                <div className="flex gap-3">
                  {(['yes', 'no'] as const).map((v) => (
                    <label key={v} className="flex items-center gap-1.5 text-ink cursor-pointer">
                      <input type="radio" name={name} value={v} required className="accent-amber" />
                      {v === 'yes' ? 'Yes' : 'No'}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-navy-600 bg-navy-900 py-3 text-[13px] text-muted cursor-pointer hover:text-ink hover:border-teal/50 transition">
              <Camera className="h-4 w-4 text-teal" />
              {photoCount ? `${photoCount} photo${photoCount > 1 ? 's' : ''}` : 'Add photos'}
              <input type="file" name="photos" accept="image/*" capture="environment" multiple hidden
                onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)} />
            </label>
            <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-navy-600 bg-navy-900 py-3 text-[13px] text-muted cursor-pointer hover:text-ink hover:border-amber/50 transition">
              <Receipt className="h-4 w-4 text-amber" />
              {receiptCount ? `${receiptCount} receipt${receiptCount > 1 ? 's' : ''}` : 'Add receipts'}
              <input type="file" name="receipts" accept="image/*" capture="environment" multiple hidden
                onChange={(e) => setReceiptCount(e.target.files?.length ?? 0)} />
            </label>
          </div>

          {error && <p className="text-[12.5px] text-alert">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setLoggingOut(false)}
              className="flex-1 rounded-xl border border-navy-700 text-muted py-3.5 text-sm font-semibold hover:text-ink transition">
              Back
            </button>
            <button type="submit" disabled={busy}
              className="flex-[2] flex items-center justify-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3.5 disabled:opacity-50 hover:brightness-110 transition">
              <LogOut className="h-5 w-5" /> {busy ? 'Saving…' : 'Log it & clock out'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
