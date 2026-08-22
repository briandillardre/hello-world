'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Clock, HardHat, Camera, Receipt, LogIn, LogOut, ShieldAlert, Fuel, Check, Images, CloudOff, WifiOff } from 'lucide-react'
import { clockInAction, clockOutAction } from '@/lib/actions/fieldops'
import { enqueue, pending, stashFormData, newIdempotencyKey, type QueueFlushDetail } from '@/lib/offline-queue'
import { toast } from '@/components/ui/feedback'
import { busy as trackBusy } from '@/lib/busy'
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
  { key: 'overhead', label: 'Office / other' }, // display label only — 'overhead' is the stored key
  { key: 'maintenance', label: 'Maintenance' },
]

function elapsedLabel(sinceIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 60_000))
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

export function ClockCard({ openEntry, zones, available, personName, demo = false, form = [] }: {
  openEntry: TimeEntry | null
  zones: { id: string; name: string; center?: [number, number] | null }[]
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
  // GPS preselect: rank job sites by distance to the phone and pick the
  // nearest — a fast-tapping crew was coding hours to the alphabetical
  // first zone. Runs once; a manual change is never overridden.
  const [nearestApplied, setNearestApplied] = useState(false)
  // A manual zone pick must NEVER be overridden — a cold GPS fix can land
  // seconds after a fast worker already chose (ship-check P1, Aug 18).
  const userPickedZoneRef = useRef(false)
  useEffect(() => {
    if (nearestApplied || demo || !zones.some((z) => z.center)) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition((pos) => {
      setNearestApplied(true)
      if (userPickedZoneRef.current) return
      const { latitude, longitude } = pos.coords
      let best: { id: string; d: number } | null = null
      for (const z of zones) {
        if (!z.center) continue
        const d = Math.hypot((z.center[1] - latitude) * 111_320, (z.center[0] - longitude) * 111_320 * Math.cos(latitude * Math.PI / 180))
        if (!best || d < best.d) best = { id: z.id, d }
      }
      if (best) setZoneId(best.id)
    }, () => setNearestApplied(true), { enableHighAccuracy: false, timeout: 6000, maximumAge: 120_000 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [plan, setPlan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [now, setNow] = useState(Date.now())
  const formRef = useRef<HTMLFormElement>(null)
  // Picked log photos, per form field — accumulated across picks (a camera-
  // forced input that replaces its FileList was silently eating photo 1 when
  // the crew took photo 2). Object URLs live alongside for the thumbnails.
  const [photoFiles, setPhotoFiles] = useState<Record<string, { file: File; url: string }[]>>({})
  const photoFilesRef = useRef(photoFiles)
  photoFilesRef.current = photoFiles

  // ── Offline queue awareness: coverage indicator + pending-sync counts ──
  // (starts true/zero so server + client render the same HTML on hydration)
  const [online, setOnline] = useState(true)
  const [queued, setQueued] = useState({ in: 0, out: 0 })
  useEffect(() => {
    const syncOnline = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    const recount = () => setQueued({ in: pending('clock-in').length, out: pending('clock-out').length })
    syncOnline()
    recount()
    const onFlushed = (e: Event) => {
      const d = (e as CustomEvent<QueueFlushDetail>).detail
      if (d.entry.action !== 'clock-in' && d.entry.action !== 'clock-out') return
      if (d.ok) toast(d.entry.action === 'clock-in' ? 'Back in coverage — clock-in synced.' : 'Back in coverage — daily log synced, you’re clocked out.', { variant: 'success' })
      else toast(d.error ?? 'A saved entry couldn’t sync.', { variant: 'error', ttl: 6000 })
      router.refresh()
    }
    window.addEventListener('online', syncOnline)
    window.addEventListener('offline', syncOnline)
    window.addEventListener('ht:queue-changed', recount)
    window.addEventListener('ht:queue-flushed', onFlushed)
    return () => {
      window.removeEventListener('online', syncOnline)
      window.removeEventListener('offline', syncOnline)
      window.removeEventListener('ht:queue-changed', recount)
      window.removeEventListener('ht:queue-flushed', onFlushed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Revoke every thumbnail object URL on unmount.
  useEffect(() => () => {
    for (const list of Object.values(photoFilesRef.current)) {
      for (const f of list) URL.revokeObjectURL(f.url)
    }
  }, [])

  const addPhotos = (name: string, picked: FileList | null) => {
    if (!picked?.length) return
    const added = Array.from(picked).map((file) => ({ file, url: URL.createObjectURL(file) }))
    setPhotoFiles((p) => ({ ...p, [name]: [...(p[name] ?? []), ...added] }))
  }
  const removePhoto = (name: string, idx: number) => {
    setPhotoFiles((p) => {
      const list = [...(p[name] ?? [])]
      const [gone] = list.splice(idx, 1)
      if (gone) URL.revokeObjectURL(gone.url)
      return { ...p, [name]: list }
    })
  }

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
            <Link
              href="/register"
              className="inline-block mt-3 rounded-lg bg-amber text-[#1a1100] font-display font-bold px-5 py-2.5 hover:brightness-110 transition"
            >
              Start free →
            </Link>
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
    const input = {
      category,
      projectGeofenceId: category === 'project' ? zoneId || null : null,
      plan,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
    }
    const key = newIdempotencyKey()
    const saveOffline = () => {
      // Transport failure (dead zone) — never a server "no". Queue it.
      const entry = enqueue('clock-in', input, key)
      if (!entry) setError('No signal — and this phone is blocking offline storage. Try again in coverage.')
      setBusy(false)
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return saveOffline()
    try {
      const res = await clockInAction({ ...input, idempotencyKey: key })
      setBusy(false)
      if (!res.ok) setError(res.error ?? 'Clock-in failed') // server said no — show it
      else router.refresh()
    } catch {
      saveOffline()
    }
  }

  const clearLogForm = () => {
    for (const list of Object.values(photoFiles)) for (const f of list) URL.revokeObjectURL(f.url)
    setPhotoFiles({})
    setLoggingOut(false)
  }

  const submitLog = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    // Global amber sweep while photos upload + the log files (task #9) —
    // the local button spinner alone read as frozen on big uploads.
    const doneBar = trackBusy('Filing your daily log…')
    const fd = new FormData(e.currentTarget)
    // Photos come from accumulated state, not the (nameless, value-cleared)
    // file inputs — append them under the field names the action expects.
    for (const [name, list] of Object.entries(photoFiles)) {
      for (const { file } of list) fd.append(name, file)
    }
    const pos = await getPos()
    if (pos) { fd.set('lat', String(pos.lat)); fd.set('lng', String(pos.lng)) }
    const key = newIdempotencyKey()
    fd.set('idempotencyKey', key)
    const saveOffline = () => {
      // Dead zone: queue the TEXT of the log in localStorage; the photo Files
      // ride along in a memory-only stash (files can't survive an app close —
      // the amber panel below says so honestly).
      const fields: Record<string, string[]> = {}
      fd.forEach((v, k) => { if (typeof v === 'string') (fields[k] ??= []).push(v) })
      const entry = enqueue('clock-out', { fields }, key)
      doneBar()
      setBusy(false)
      if (!entry) { setError('No signal — and this phone is blocking offline storage. Try again in coverage.'); return }
      stashFormData(key, fd)
      clearLogForm()
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return saveOffline()
    try {
      const res = await clockOutAction(fd)
      setBusy(false)
      if (!res.ok) setError(res.error ?? 'Clock-out failed') // server said no — show it
      else {
        clearLogForm()
        router.refresh()
      }
    } catch {
      saveOffline()
    } finally {
      doneBar()
    }
  }

  // Subtle header chip when the phone has no coverage (dead-zone jobsites).
  const offlineChip = !online ? (
    <span className="flex flex-none items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-amber">
      <WifiOff className="h-3 w-3" /> Offline
    </span>
  ) : null

  // ── Not clocked in ──
  if (!openEntry) {
    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
    return (
      <div className="rounded-xl border border-navy-700 bg-navy-950 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-amber flex-none" />
          <p className="font-display font-bold text-ink flex-1">{greeting}, {personName.split(' ')[0]}. Where&apos;s the day going?</p>
          {offlineChip}
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
              onChange={(e) => { userPickedZoneRef.current = true; setZoneId(e.target.value) }}
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

        {queued.in > 0 ? (
          <div className="rounded-xl border border-amber/40 bg-amber/10 p-4 space-y-1.5">
            <p className="flex items-center gap-2 font-display font-bold text-amber">
              <CloudOff className="h-5 w-5 flex-none" /> Saved on your phone
              <span className="ml-auto rounded-full border border-amber/40 bg-amber/15 px-2 py-0.5 font-mono text-[11px] tabular-nums">{queued.in}</span>
            </p>
            <p className="text-[12.5px] text-muted leading-snug">
              Your clock-in will sync when you&apos;re back in coverage — nothing else to do.
            </p>
          </div>
        ) : (
          <button
            onClick={clockIn}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold text-lg py-4 disabled:opacity-50 hover:brightness-110 transition"
          >
            <LogIn className="h-5 w-5" /> {busy ? 'Clocking in…' : 'Clock in'}
          </button>
        )}
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
        <div className="flex items-center gap-2">
          {offlineChip}
          <span className="grid place-items-center w-11 h-11 rounded-full bg-teal/15 border border-teal/40">
            <Clock className="h-5 w-5 text-teal" />
          </span>
        </div>
      </div>
      {openEntry.plan && (
        <p className="text-[13px] text-muted border-l-2 border-navy-700 pl-2.5">Today&apos;s plan: {openEntry.plan}</p>
      )}

      {queued.out > 0 ? (
        <div className="rounded-xl border border-amber/40 bg-amber/10 p-4 space-y-1.5">
          <p className="flex items-center gap-2 font-display font-bold text-amber">
            <CloudOff className="h-5 w-5 flex-none" /> Saved on your phone
            <span className="ml-auto rounded-full border border-amber/40 bg-amber/15 px-2 py-0.5 font-mono text-[11px] tabular-nums">{queued.out}</span>
          </p>
          <p className="text-[12.5px] text-muted leading-snug">
            Your daily log and clock-out will sync when you&apos;re back in coverage.
            Photos attach only if sync happens before you close the app — the writeup itself is safe either way.
          </p>
        </div>
      ) : !loggingOut ? (
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
                  {/* Same segmented-button pattern as the category picker —
                      real radios stay in the form (sr-only) so the FormData
                      field name/value and `required` are unchanged. */}
                  <div className="grid grid-cols-2 gap-2">
                    {(['yes', 'no'] as const).map((v) => (
                      <label key={v} className="cursor-pointer">
                        <input type="radio" name={name} value={v} required={req} className="peer sr-only" />
                        <span className="flex items-center justify-center min-h-[44px] rounded-lg text-sm font-semibold border transition bg-navy-950 text-muted border-navy-700 peer-checked:bg-amber/15 peer-checked:text-amber peer-checked:border-amber/40 peer-focus-visible:ring-1 peer-focus-visible:ring-amber/60">
                          {v === 'yes' ? 'Yes' : 'No'}
                        </span>
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
                  {/* Row-sized tap targets — real checkboxes stay in the form
                      (sr-only) so FormData names/values are unchanged. */}
                  <div className="space-y-1.5">
                    {(it.options ?? []).map((o) => (
                      <label key={o} className="block cursor-pointer">
                        <input type="checkbox" name={name} value={o} className="peer sr-only" />
                        <span className="flex items-center gap-2.5 min-h-[44px] rounded-lg border px-3 text-sm font-semibold transition bg-navy-950 text-muted border-navy-700 peer-checked:bg-amber/15 peer-checked:text-amber peer-checked:border-amber/40 peer-focus-visible:ring-1 peer-focus-visible:ring-amber/60 peer-checked:[&_svg]:opacity-100">
                          <span className="grid place-items-center w-5 h-5 rounded border border-navy-600 flex-none">
                            <Check className="h-3.5 w-3.5 opacity-0 transition-opacity" />
                          </span>
                          {o}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            }

            // photos (standard photos/receipts + custom photo questions).
            // Inputs are nameless and cleared after every pick — the files
            // accumulate in photoFiles and submitLog appends them under
            // `name`, so photo 2 no longer replaces photo 1.
            const isReceipts = it.std === 'receipts'
            const picked = photoFiles[name] ?? []
            return (
              <div key={it.id} className="rounded-lg border border-dashed border-navy-600 bg-navy-900 p-3 space-y-2">
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  {isReceipts ? <Receipt className="h-4 w-4 text-amber" /> : <Camera className="h-4 w-4 text-teal" />}
                  {label}{req && !picked.length && <span className="text-amber">*</span>}
                </p>
                {picked.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {picked.map((f, i) => (
                      <span key={f.url} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={`${label} ${i + 1}`} className="h-14 w-14 object-cover rounded-md border border-navy-700" />
                        <button type="button" onClick={() => removePhoto(name, i)} aria-label="Remove photo"
                          className="absolute -top-1.5 -right-1.5 grid place-items-center w-5 h-5 rounded-full bg-navy-800 border border-navy-600 text-muted text-[12px] leading-none hover:text-alert hover:border-alert/50 transition">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex items-center justify-center gap-1.5 rounded-lg border border-navy-700 bg-navy-950 py-2.5 text-[12.5px] font-semibold text-muted cursor-pointer hover:text-ink transition ${isReceipts ? 'hover:border-amber/50' : 'hover:border-teal/50'}`}>
                    <Camera className={`h-4 w-4 ${isReceipts ? 'text-amber' : 'text-teal'}`} /> Take photo
                    <input type="file" accept="image/*" capture="environment" multiple hidden
                      onChange={(e) => { addPhotos(name, e.target.files); e.target.value = '' }} />
                  </label>
                  <label className={`flex items-center justify-center gap-1.5 rounded-lg border border-navy-700 bg-navy-950 py-2.5 text-[12.5px] font-semibold text-muted cursor-pointer hover:text-ink transition ${isReceipts ? 'hover:border-amber/50' : 'hover:border-teal/50'}`}>
                    <Images className={`h-4 w-4 ${isReceipts ? 'text-amber' : 'text-teal'}`} /> From gallery
                    <input type="file" accept="image/*" multiple hidden
                      onChange={(e) => { addPhotos(name, e.target.files); e.target.value = '' }} />
                  </label>
                </div>
              </div>
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
