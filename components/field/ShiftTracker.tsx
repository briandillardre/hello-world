'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { isNativeApp, nativePlatform } from '@/lib/native'

/**
 * Mandatory shift tracking (Brian, Sep 9: "clock in also a must and mandatory
 * tracking thru app while clocked in"). Mounted once in the dashboard shell.
 * While the signed-in person has an OPEN time entry, this records where the
 * phone goes and posts the fixes to /api/clock/fix — they land on the
 * person's own `phone-<uid>` asset, which is what the time card's GPS column
 * and the crew map read. Clocking out stops it; there is no switch.
 *
 * Two engines, picked at runtime (the app loads the live site, so the same
 * code runs in a browser and in the shell):
 *  • Native shell with @capacitor-community/background-geolocation present:
 *    a foreground-service watcher keeps recording with the screen off or
 *    the app in the background. Play's prominent-disclosure rule: the first
 *    time, a sheet explains what is collected and why BEFORE the OS prompt.
 *  • Anywhere else (browser, PWA, an older app build): watchPosition while
 *    the page is open — honest about being foreground-only.
 * Denied location while clocked in = an amber bar that does not go away
 * until location is on or the person clocks out.
 */
export const CLOCK_EVENT = 'ht:clock'
export const SHIFT_STATUS_EVENT = 'ht:shift-status'
export interface ShiftStatus { open: boolean; engine: 'native' | 'web' | 'off'; fixes: number; denied: boolean; lastFixAt: number | null }

const DISCLOSURE_KEY = 'ht_shift_disclosure_done'
const POLL_MS = 60_000
/** Push cadence: one fix per 30 s, or sooner after a real move (≥ 40 m, ≥ 10 s). */
const MIN_PUSH_MS = 30_000
const MOVE_PUSH_MS = 10_000
const MIN_MOVE_M = 40
const QUEUE_CAP = 200

interface BgLocation { latitude: number; longitude: number; accuracy?: number; speed?: number | null; bearing?: number | null; time?: number | null }
interface BgError { code?: string; message?: string }
interface BgPlugin {
  addWatcher(opts: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number }, cb: (loc?: BgLocation, err?: BgError) => void): Promise<string>
  removeWatcher(opts: { id: string }): Promise<void>
  openSettings(): Promise<void>
}
function bgPlugin(): BgPlugin | null {
  if (typeof window === 'undefined') return null
  const cap = (window as unknown as { Capacitor?: { Plugins?: { BackgroundGeolocation?: BgPlugin } } }).Capacitor
  const p = cap?.Plugins?.BackgroundGeolocation
  return p && typeof p.addWatcher === 'function' ? p : null
}

type Fix = { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; at: string }
type OpenShift = { id: string; since: string }

function metersBetween(a: [number, number], b: [number, number]): number {
  const R = 6_371_000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function ShiftTracker() {
  const [open, setOpen] = useState<OpenShift | null>(null)
  const [consent, setConsent] = useState<boolean | null>(null) // null until read
  const [askConsent, setAskConsent] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [denied, setDenied] = useState(false)
  const [fixes, setFixes] = useState(0)
  const engineRef = useRef<'native' | 'web' | 'off'>('off')
  const lastFixRef = useRef<number | null>(null)

  useEffect(() => {
    try { setConsent(localStorage.getItem(DISCLOSURE_KEY) === '1') } catch { setConsent(true) }
  }, [])

  // Am I clocked in? On load, every minute, when the clock card says so, and
  // whenever the app comes back to the foreground.
  const lastOpenRef = useRef(false)
  const tickRef = useRef(0)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/clock/state', { cache: 'no-store' })
        const j = await r.json().catch(() => null) as { open?: boolean; entry?: { id: string; since: string } | null } | null
        if (!alive || !j) return
        lastOpenRef.current = !!(j.open && j.entry)
        setOpen((cur) => {
          const next = j.open && j.entry ? { id: j.entry.id, since: j.entry.since } : null
          return cur?.id === next?.id ? cur : next
        })
      } catch { /* offline — keep the last answer */ }
    }
    void load()
    // Cheap when idle: no poll while the tab is hidden, and only every fifth
    // minute while nobody is clocked in (the clock card's event covers the
    // transition; another device's clock-in shows within 5 min).
    const t = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      tickRef.current++
      if (!lastOpenRef.current && tickRef.current % 5 !== 0) return
      void load()
    }, POLL_MS)
    const onClock = () => { void load() }
    const onVis = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener(CLOCK_EVENT, onClock)
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; window.clearInterval(t); window.removeEventListener(CLOCK_EVENT, onClock); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const publish = useCallback((extra?: Partial<ShiftStatus>) => {
    const detail: ShiftStatus = { open: !!open, engine: engineRef.current, fixes, denied, lastFixAt: lastFixRef.current, ...extra }
    window.dispatchEvent(new CustomEvent(SHIFT_STATUS_EVENT, { detail }))
  }, [open, fixes, denied])
  useEffect(() => { publish() }, [publish])

  // The recorder. Keyed on the open shift + consent so a fresh clock-in (or
  // a granted disclosure) restarts it cleanly.
  useEffect(() => {
    if (!open || consent == null) return
    const native = isNativeApp()
    const plugin = native ? bgPlugin() : null
    if (plugin && !consent) {
      if (!declined) setAskConsent(true)
      engineRef.current = 'off'
      return
    }

    let stopped = false
    let watcherId: string | null = null
    let webWatch: number | null = null
    let lastPushAt = 0
    let lastPos: [number, number] | null = null
    const pending: Fix[] = []
    let flushing = false

    const flush = async () => {
      if (flushing || !pending.length) return
      flushing = true
      const batch = pending.splice(0, 50)
      try {
        const r = await fetch('/api/clock/fix', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fixes: batch }), keepalive: true })
        if (r.status === 401 || r.status === 403) { pending.length = 0 } // signed out / no view level — nothing to keep
        else if (r.status === 409) { pending.length = 0; lastOpenRef.current = false; setOpen(null) } // clocked out elsewhere — stop
        else if (r.status === 429) { /* over the hourly cap — this batch is dropped */ }
        else if (!r.ok) { pending.unshift(...batch) }
        else { setFixes((n) => n + batch.length); lastFixRef.current = Date.now() }
      } catch {
        pending.unshift(...batch) // dead zone — try again with the next fix
      } finally {
        if (pending.length > QUEUE_CAP) pending.splice(0, pending.length - QUEUE_CAP)
        flushing = false
      }
    }

    const onFix = (lat: number, lng: number, accuracy: number | null, speedMs: number | null, heading: number | null, atMs: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      if (accuracy != null && accuracy > 1000) return
      const now = Date.now()
      const moved = lastPos ? metersBetween(lastPos, [lng, lat]) : Infinity
      const due = now - lastPushAt >= MIN_PUSH_MS || (moved >= MIN_MOVE_M && now - lastPushAt >= MOVE_PUSH_MS)
      if (!due) return
      lastPushAt = now
      lastPos = [lng, lat]
      setDenied(false)
      pending.push({
        lat, lng,
        accuracy: accuracy != null && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        speed: speedMs != null && Number.isFinite(speedMs) && speedMs >= 0 ? Math.round(speedMs * 2.23694) : null,
        heading: heading != null && Number.isFinite(heading) && heading >= 0 ? Math.round(heading) : null,
        at: new Date(Number.isFinite(atMs) ? atMs : now).toISOString(),
      })
      void flush()
    }

    const startWeb = () => {
      if (stopped) return // cleaned up while the native watcher was still starting
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { engineRef.current = 'off'; setDenied(true); return }
      engineRef.current = 'web'
      webWatch = navigator.geolocation.watchPosition(
        (p) => { if (!stopped) onFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? null, p.coords.speed ?? null, p.coords.heading ?? null, p.timestamp) },
        (e) => { if (e.code === 1) setDenied(true) },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
      )
    }

    const start = async () => {
      if (plugin) {
        try {
          engineRef.current = 'native'
          watcherId = await plugin.addWatcher({
            backgroundTitle: 'HammerTrack · on the clock',
            backgroundMessage: 'Recording your shift location until you clock out.',
            requestPermissions: true,
            stale: false,
            distanceFilter: 20,
          }, (loc, err) => {
            if (stopped) return
            if (err) { if (err.code === 'NOT_AUTHORIZED') setDenied(true); return }
            if (loc) onFix(loc.latitude, loc.longitude, loc.accuracy ?? null, loc.speed ?? null, loc.bearing ?? null, loc.time ?? Date.now())
          })
          if (stopped && watcherId) { void plugin.removeWatcher({ id: watcherId }); watcherId = null }
          return
        } catch {
          // Plugin present but unusable — fall back to the page's own GPS.
        }
      }
      startWeb()
    }
    void start()
    setFixes(0)

    return () => {
      stopped = true
      if (watcherId && plugin) void plugin.removeWatcher({ id: watcherId }).catch(() => {})
      if (webWatch != null) navigator.geolocation.clearWatch(webWatch)
      engineRef.current = 'off'
      void flush()
    }
  }, [open?.id, consent, declined]) // eslint-disable-line react-hooks/exhaustive-deps

  const accept = () => {
    try { localStorage.setItem(DISCLOSURE_KEY, '1') } catch { /* private mode */ }
    setAskConsent(false); setDeclined(false); setConsent(true)
  }
  const decline = () => { setAskConsent(false); setDeclined(true) }
  const openSettings = () => {
    const p = bgPlugin()
    if (p) void p.openSettings().catch(() => {})
  }

  if (!open) return null
  const platform = nativePlatform()
  const settingsPath = platform === 'ios' ? 'Settings → HammerTrack → Location → Always'
    : platform === 'android' ? 'Settings → Apps → HammerTrack → Permissions → Location → Allow all the time'
      : 'your browser’s site settings → Location → Allow'

  return (
    <>
      {askConsent && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-labelledby="shift-disclosure-title">
          <div className="w-full max-w-md rounded-2xl border border-navy-700 bg-navy-900 p-5 shadow-panel" style={{ marginBottom: 'calc(var(--ht-safe-bottom, 0px) + 8px)' }}>
            <p className="text-2xl mb-1">📍</p>
            <h2 id="shift-disclosure-title" className="font-display font-bold text-lg text-ink">Location while you&apos;re on the clock</h2>
            <p className="mt-2 text-[13.5px] text-muted leading-relaxed">
              HammerTrack collects this phone&apos;s location <span className="text-ink font-semibold">while you are clocked in — including when the app is closed or not in use</span> — to record where your shift happens, verify your time card and show you on the crew map. Tracking stops when you clock out. It is never sold or used for ads.
            </p>
            <p className="mt-2 text-[12px] text-faint">Next, your phone will ask for location permission. Choose <span className="text-ink font-semibold">Allow all the time</span> so a shift keeps recording with the screen off.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={decline} className="flex-1 rounded-xl border border-navy-700 py-3 text-sm font-semibold text-muted">Not now</button>
              <button type="button" onClick={accept} className="flex-1 rounded-xl bg-amber py-3 text-sm font-display font-bold text-[#1a1100]">Continue</button>
            </div>
          </div>
        </div>
      )}

      {(denied || declined) && !askConsent && (
        <div
          data-shift-denied
          className="fixed left-2 right-2 z-[40] md:left-auto md:right-4 md:w-[420px] rounded-xl border border-amber/50 bg-[#2a1d05]/95 backdrop-blur px-3 py-2.5 shadow-panel"
          style={{ bottom: 'calc(var(--ht-safe-bottom, 0px) + 62px)' }}
        >
          <p className="text-[13px] text-amber font-semibold">📍 Location is required while you&apos;re clocked in.</p>
          <p className="mt-0.5 text-[12px] text-amber/80">Your shift is on the clock but this phone isn&apos;t recording where it goes. Turn location on ({settingsPath}) — or clock out.</p>
          <div className="mt-2 flex gap-2">
            {declined ? (
              <button type="button" onClick={() => { setDeclined(false); setAskConsent(true) }} className="rounded-lg bg-amber px-3 py-1.5 text-[12px] font-display font-bold text-[#1a1100]">Turn on location</button>
            ) : isNativeApp() && bgPlugin() ? (
              <button type="button" onClick={openSettings} className="rounded-lg bg-amber px-3 py-1.5 text-[12px] font-display font-bold text-[#1a1100]">Open settings</button>
            ) : null}
            <Link href="/clock" className="rounded-lg border border-amber/40 px-3 py-1.5 text-[12px] font-semibold text-amber">Clock out</Link>
          </div>
        </div>
      )}
    </>
  )
}
