'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, HardHat, Camera, Receipt, LogIn, LogOut, ShieldAlert, Fuel } from 'lucide-react'
import { clockInAction, clockOutAction } from '@/lib/actions/fieldops'
import type { ClockCategory, TimeEntry } from '@/lib/field-types'
import type { LogFormItem } from '@/lib/log-form'

/** Best-effort phone GPS — resolves null on denial/timeout, never blocks the
 *  crew from clocking. Every field event carries where it happened. */
function getPos(timeoutMs = 6000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    const done = (v: { lat: number; lng: number } | null) => { clearTimeout(t); resolve(v) }
    const t = setTimeout(() => resolve(null), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => done(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    )
  })
}

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

export function ClockCard({ openEntry, zones, available, personName, demo = false, form = [] }: {
  openEntry: TimeEntry | null
  zones: { id: string; name: string }[]
  available: boolean
  personName: string
  /** Demo mode: show the pitch, not internal setup instructions. */
  demo?: boolean
  /** The admin-built daily-log form (enabled items only, in order). */
  form?: LogFormItem[]
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
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})

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
    const pos = await getPos()
    const res = await clockInAction({
      category,
      projectGeofenceId: category === 'project' ? zoneId || null : null,
      plan,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
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
    const fd = new FormData(e.currentTarget)
    const pos = await getPos()
    if (pos) { fd.set('lat', String(pos.lat)); fd.set('lng', String(pos.lng)) }
    const res = await clockOutAction(fd)
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

          {/* The admin-built form (Settings → Daily log form). Standard items
              keep their legacy field names so the whole downstream pipeline
              (safety push, receipts inbox, digests) is untouched; custom
              items post as a_<id> / f_<id>. */}
          {form.map((it) => {
            const name = it.std === 'writeup' ? 'writeup'
              : it.std === 'safety' ? 'safety'
              : it.std === 'trucks_fueled' ? 'trucksFueled'
              : it.std === 'equipment_fueled' ? 'equipmentFueled'
              : it.std === 'photos' ? 'photos'
              : it.std === 'receipts' ? 'receipts'
              : it.type === 'photos' ? `f_${it.id}` : `a_${it.id}`
            const req = it.required
            const label = it.label + (req ? '' : '')

            if (it.type === 'longtext' || it.type === 'text') {
              const isSafety = it.std === 'safety'
              const field = it.type === 'longtext' ? (
                <textarea name={name} rows={it.std === 'writeup' ? 4 : 2} required={req}
                  placeholder={(it.hint ?? label) + (req ? '' : ' (optional)')}
                  className={`w-full bg-navy-900 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none resize-none ${isSafety ? 'focus:border-alert/50' : 'focus:border-amber/50'}`} />
              ) : (
                <input name={name} type="text" required={req} placeholder={(it.hint ?? label) + (req ? '' : ' (optional)')}
                  className="w-full bg-navy-900 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber/50" />
              )
              return (
                <div key={it.id}>
                  <p className="text-[11px] text-faint mb-1 flex items-center gap-1.5">
                    {isSafety && <ShieldAlert className="h-3.5 w-3.5 text-alert" />}
                    {label}{req && <span className="text-amber">*</span>}
                  </p>
                  {field}
                </div>
              )
            }

            if (it.type === 'number') {
              return (
                <div key={it.id}>
                  <p className="text-[11px] text-faint mb-1">{label}{req && <span className="text-amber">*</span>}</p>
                  <input name={name} type="number" inputMode="decimal" step="any" required={req}
                    placeholder={it.hint ?? ''}
                    className="w-full bg-navy-900 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber/50" />
                </div>
              )
            }

            if (it.type === 'yesno') {
              return (
                <fieldset key={it.id} className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[13px]">
                  <legend className="sr-only">{label}</legend>
                  <p className="text-faint flex items-center gap-1 mb-1">
                    {it.std ? <Fuel className="h-3.5 w-3.5" /> : null} {label}{req && <span className="text-amber">*</span>}
                  </p>
                  <div className="flex gap-3">
                    {(['yes', 'no'] as const).map((v) => (
                      <label key={v} className="flex items-center gap-1.5 text-ink cursor-pointer">
                        <input type="radio" name={name} value={v} required={req} className="accent-amber" />
                        {v === 'yes' ? 'Yes' : 'No'}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            }

            if (it.type === 'choice') {
              return (
                <div key={it.id}>
                  <p className="text-[11px] text-faint mb-1">{label}{req && <span className="text-amber">*</span>}</p>
                  <select name={name} required={req} defaultValue=""
                    className="w-full bg-navy-900 border border-navy-700 rounded-lg px-3 py-3 text-sm text-ink outline-none focus:border-amber/50">
                    <option value="" disabled={req}>{req ? 'Pick one…' : '—'}</option>
                    {(it.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              )
            }

            if (it.type === 'checklist') {
              return (
                <fieldset key={it.id} className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[13px]">
                  <legend className="sr-only">{label}</legend>
                  <p className="text-faint mb-1">{label}{req && <span className="text-amber">*</span>}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {(it.options ?? []).map((o) => (
                      <label key={o} className="flex items-center gap-1.5 text-ink cursor-pointer">
                        <input type="checkbox" name={name} value={o} className="accent-amber" /> {o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            }

            // photos (standard photos/receipts + custom photo questions)
            const isReceipts = it.std === 'receipts'
            const count = fileCounts[name] ?? 0
            return (
              <label key={it.id} className={`flex items-center justify-center gap-2 rounded-lg border border-dashed border-navy-600 bg-navy-900 py-3 text-[13px] text-muted cursor-pointer hover:text-ink transition ${isReceipts ? 'hover:border-amber/50' : 'hover:border-teal/50'}`}>
                {isReceipts ? <Receipt className="h-4 w-4 text-amber" /> : <Camera className="h-4 w-4 text-teal" />}
                {count ? `${count} added` : label}{req && !count && <span className="text-amber">*</span>}
                <input type="file" name={name} accept="image/*" capture="environment" multiple hidden
                  onChange={(e) => setFileCounts((c) => ({ ...c, [name]: e.target.files?.length ?? 0 }))} />
              </label>
            )
          })}

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
