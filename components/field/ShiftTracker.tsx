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
 *    a location FOREGROUND service (persistent notification) keeps recording
 *    with the screen off or the app in the background — "While using the
 *    app" permission is all it needs, no background-location permission.
 *    Play's prominent-disclosure rule: the first time, a sheet explains what
 *    is collected and why BEFORE the OS prompt.
 *  • Anywhere else (browser, PWA, an older app build): watchPosition while
 *    the page is open — honest about being foreground-only.
 * Denied location while clocked in = an amber bar that does not go away
 * until location is on or the person clocks out.
 *
 * Hard-won (ship-check, Sep 9): the native watcher survives a page reload
 * (Capacitor forgets its callbacks, the service does not), so its id is kept
 * in localStorage and any orphan is removed before a new one starts; the
 * fix queue is persisted too (Android throttles WebView HTTP after ~5 min in
 * the background — the batch goes out through CapacitorHttp when available).
 */
export const CLOCK_EVENT = 'ht:clock'
export const SHIFT_STATUS_EVENT = 'ht:shift-status'
/** Anyone (the clock card on mount) may ask for the current status. */
export const SHIFT_STATUS_QUERY = 'ht:shift-status?'
export interface ShiftStatus { open: boolean; engine: 'native' | 'web' | 'off'; fixes: number; denied: boolean; lastFixAt: number | null }

const DISCLOSURE_KEY = 'ht_shift_disclosure_done'
const WATCHER_KEY = 'ht_shift_watcher'
const QUEUE_KEY = 'ht_shift_queue'
const POLL_MS = 60_000
/** Push cadence: one fix per 30 s, or sooner after a real move (≥ 40 m, ≥ 10 s). */
const MIN_PUSH_MS = 30_000
const MOVE_PUSH_MS = 10_000
const MIN_MOVE_M = 40
/** ~16 h of a screen-off shift at the 30 s cadence. */
const QUEUE_CAP = 2000

interface BgLocation { latitude: number; longitude: number; accuracy?: number; speed?: number | null; bearing?: number | null; time?: number | null }
interface BgError { code?: string; message?: string }
interface BgPlugin {
  addWatcher(opts: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number }, cb: (loc?: BgLocation, err?: BgError) => void): Promise<string>
  removeWatcher(opts: { id: string }): Promise<void>
  openSettings(): Promise<void>
}
interface NativeHttp { post(opts: { url: string; headers?: Record<string, string>; data?: unknown }): Promise<{ status: number }> }
interface CapGlobal { isNativePlatform?: () => boolean; Plugins?: { BackgroundGeolocation?: BgPlugin; CapacitorHttp?: NativeHttp } }
const cap = (): CapGlobal | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapGlobal }).Capacitor)
function bgPlugin(): BgPlugin | null {
  const p = cap()?.Plugins?.BackgroundGeolocation
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

const validFix = (f: unknown): f is Fix => !!f && typeof f === 'object' && Number.isFinite((f as Fix).lat) && Number.isFinite((f as Fix).lng) && typeof (f as Fix).at === 'string'
/** The queue belongs to ONE person (a shared crew phone must not post user
 *  A's leftovers as user B) and never replays anything older than a day
 *  (the server would clamp Friday's fixes to Sunday morning). */
function loadQueue(uid: string): Fix[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const wrap = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as { uid?: unknown; fixes?: unknown } : null
    if (!wrap || wrap.uid !== uid || !Array.isArray(wrap.fixes)) return []
    const cutoff = Date.now() - 24 * 3_600_000
    return wrap.fixes.filter(validFix).filter((f) => Date.parse(f.at) >= cutoff).slice(-QUEUE_CAP)
  } catch { return [] }
}
function saveQueue(uid: string, q: Fix[]) {
  try { if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify({ uid, fixes: q.slice(-QUEUE_CAP) })); else localStorage.removeItem(QUEUE_KEY) } catch { /* private mode */ }
}
/** A watcher from before a page reload is still running in the service —
 *  stop it before starting another, and whenever no shift is open. */
async function killOrphanWatcher(plugin: BgPlugin) {
  let id: string | null = null
  try { id = localStorage.getItem(WATCHER_KEY) } catch { /* private mode */ }
  if (!id) return
  try { await plugin.removeWatcher({ id }) } catch { /* already gone */ }
  try { localStorage.removeItem(WATCHER_KEY) } catch { /* private mode */ }
}
/** POST a batch; native HTTP first inside the shell (the WebView's fetch is
 *  throttled after ~5 min in the background), the page's fetch otherwise. */
async function postFixes(batch: Fix[]): Promise<number> {
  const body = { fixes: batch }
  const c = cap()
  const http = c?.isNativePlatform?.() ? c.Plugins?.CapacitorHttp : undefined
  if (http?.post) {
    try {
      const r = await http.post({ url: `${window.location.origin}/api/clock/fix`, headers: { 'content-type': 'application/json' }, data: body })
      if (typeof r?.status === 'number' && r.status !== 401) return r.status // 401 = the native jar lacks the session cookie → use the WebView
    } catch { /* fall through to fetch */ }
  }
  const r = await fetch('/api/clock/fix', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
  return r.status
}

export function ShiftTracker() {
  const [open, setOpen] = useState<OpenShift | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [consent, setConsent] = useState<boolean | null>(null) // null until read
  const [askConsent, setAskConsent] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [denied, setDenied] = useState(false)
  const [fixes, setFixes] = useState(0)
  const engineRef = useRef<'native' | 'web' | 'off'>('off')
  const lastFixRef = useRef<number | null>(null)
  const lastOpenRef = useRef(false)
  const tickRef = useRef(0)
  const uidRef = useRef<string | null>(null)
  const [nagOffset, setNagOffset] = useState(0)

  useEffect(() => {
    try { setConsent(localStorage.getItem(DISCLOSURE_KEY) === '1') } catch { setConsent(true) }
  }, [])

  // Am I clocked in? On load, when the clock card says so, on foreground, and
  // on a timer that stays cheap while idle: no poll with the tab hidden, only
  // every fifth minute while nobody is clocked in.
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/clock/state', { cache: 'no-store' })
        const j = await r.json().catch(() => null) as { open?: boolean; entry?: { id: string; since: string } | null; uid?: string | null } | null
        if (!alive || !j) return
        if (typeof j.uid === 'string') uidRef.current = j.uid
        lastOpenRef.current = !!(j.open && j.entry)
        setOpen((cur) => {
          const next = j.open && j.entry ? { id: j.entry.id, since: j.entry.since } : null
          return cur?.id === next?.id ? cur : next
        })
        setLoaded(true)
      } catch { /* offline — keep the last answer */ }
    }
    void load()
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

  const publish = useCallback(() => {
    const detail: ShiftStatus = { open: !!open, engine: engineRef.current, fixes, denied, lastFixAt: lastFixRef.current }
    window.dispatchEvent(new CustomEvent(SHIFT_STATUS_EVENT, { detail }))
  }, [open, fixes, denied])
  useEffect(() => { publish() }, [publish])
  useEffect(() => {
    const h = () => publish()
    window.addEventListener(SHIFT_STATUS_QUERY, h)
    return () => window.removeEventListener(SHIFT_STATUS_QUERY, h)
  }, [publish])

  // No shift open (as far as the server knows) → make sure no watcher from a
  // previous page life is still recording.
  useEffect(() => {
    if (!loaded || open) return
    const plugin = isNativeApp() ? bgPlugin() : null
    if (plugin) void killOrphanWatcher(plugin)
  }, [loaded, open])

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
    let webFallbackUsed = false
    let lastPushAt = 0
    let lastPos: [number, number] | null = null
    const uid = uidRef.current ?? ''
    const pending: Fix[] = uid ? loadQueue(uid) : [] // whatever a previous page life could not send
    let flushing = false
    let retryNotBefore = 0

    const flush = async () => {
      if (flushing || !pending.length || Date.now() < retryNotBefore) return
      flushing = true
      const batch = pending.splice(0, 50)
      try {
        const status = await postFixes(batch)
        if (status === 401 || status === 403) { pending.length = 0 } // signed out / no view level — nothing to keep
        else if (status === 409) { pending.length = 0; lastOpenRef.current = false; setOpen(null) } // clocked out elsewhere — stop
        else if (status === 429) { pending.unshift(...batch); retryNotBefore = Date.now() + 5 * 60_000 } // over the hourly cap — keep them, try later
        else if (status < 200 || status >= 300) { pending.unshift(...batch) }
        else { setFixes((n) => n + batch.length); lastFixRef.current = Date.now() }
      } catch {
        pending.unshift(...batch) // dead zone — try again with the next fix
      } finally {
        if (pending.length > QUEUE_CAP) pending.splice(0, pending.length - QUEUE_CAP)
        if (uid) saveQueue(uid, pending)
        flushing = false
      }
    }

    const onFix = (lat: number, lng: number, accuracy: number | null, speedMs: number | null, heading: number | null, atMs: number) => {
      if (stopped || !Number.isFinite(lat) || !Number.isFinite(lng)) return
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
      if (uid) saveQueue(uid, pending)
      void flush()
    }

    const startWeb = () => {
      if (stopped || webWatch != null) return
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { engineRef.current = 'off'; setDenied(true); return }
      engineRef.current = 'web'
      webWatch = navigator.geolocation.watchPosition(
        (p) => onFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy ?? null, p.coords.speed ?? null, p.coords.heading ?? null, p.timestamp),
        (e) => { if (!stopped && e.code === 1) setDenied(true) },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
      )
      publish()
    }

    const start = async () => {
      if (plugin) {
        await killOrphanWatcher(plugin)
        if (stopped) return
        try {
          engineRef.current = 'native'
          const id = await plugin.addWatcher({
            backgroundTitle: 'HammerTrack · on the clock',
            backgroundMessage: 'Recording your shift location until you clock out.',
            requestPermissions: true,
            stale: false,
            distanceFilter: 20,
          }, (loc, err) => {
            if (stopped) return
            if (err) {
              if (err.code === 'NOT_AUTHORIZED') { setDenied(true); return }
              // "Service not running." and friends — the native watcher is
              // not delivering; the page's own GPS takes over, once.
              if (!webFallbackUsed) { webFallbackUsed = true; startWeb() }
              return
            }
            if (loc) onFix(loc.latitude, loc.longitude, loc.accuracy ?? null, loc.speed ?? null, loc.bearing ?? null, loc.time ?? Date.now())
          })
          // Cleaned up while the OS dialog held addWatcher open: remove this
          // watcher and leave the stored id alone — it may already belong to
          // a newer recorder (ship-check).
          if (stopped) { void plugin.removeWatcher({ id }).catch(() => {}); return }
          watcherId = id
          try { localStorage.setItem(WATCHER_KEY, id) } catch { /* private mode */ }
          publish()
          void flush()
          return
        } catch {
          // Plugin present but unusable — fall back to the page's own GPS.
        }
      }
      startWeb()
      void flush()
    }
    void start()
    setFixes(0)

    return () => {
      stopped = true
      if (watcherId && plugin) { void plugin.removeWatcher({ id: watcherId }).catch(() => {}); try { localStorage.removeItem(WATCHER_KEY) } catch { /* private mode */ } }
      if (webWatch != null) navigator.geolocation.clearWatch(webWatch)
      engineRef.current = 'off'
      void flush()
    }
  }, [open?.id, consent, declined]) // eslint-disable-line react-hooks/exhaustive-deps

  // Both "until it is done" bars live under the top bar; when the receipt
  // chase is showing, this one steps below it instead of covering it.
  useEffect(() => {
    if (!(denied || declined)) return
    const tick = () => {
      const el = document.querySelector('[data-receipt-nag]') as HTMLElement | null
      setNagOffset(el ? Math.round(el.getBoundingClientRect().height) + 8 : 0)
    }
    tick()
    const t = window.setInterval(tick, 2000)
    return () => window.clearInterval(t)
  }, [denied, declined])

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
  const settingsPath = platform === 'ios' ? 'Settings → HammerTrack → Location → While Using the App'
    : platform === 'android' ? 'Settings → Apps → HammerTrack → Permissions → Location → Allow only while using the app'
      : 'your browser’s site settings → Location → Allow'

  return (
    <>
      {askConsent && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-labelledby="shift-disclosure-title">
          <div className="w-full max-w-md rounded-2xl border border-navy-700 bg-navy-900 p-5 shadow-panel" style={{ marginBottom: 'calc(var(--ht-safe-bottom, 0px) + 8px)' }}>
            <p className="text-2xl mb-1">📍</p>
            <h2 id="shift-disclosure-title" className="font-display font-bold text-lg text-ink">Location while you&apos;re on the clock</h2>
            <p className="mt-2 text-[13.5px] text-muted leading-relaxed">
              HammerTrack collects this phone&apos;s location <span className="text-ink font-semibold">while you are clocked in — including when the app is closed or not in use</span> — to record where your shift happens, verify your time card and show you on the crew map. A notification shows the whole time a shift is recording, and it stops when you clock out. Never sold, never used for ads.
            </p>
            <p className="mt-2 text-[12px] text-faint">Next, your phone asks for location permission — choose <span className="text-ink font-semibold">While using the app</span>. That is all the shift recorder needs.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={decline} className="flex-1 rounded-xl border border-navy-700 py-3 text-sm font-semibold text-muted">Not now</button>
              <button type="button" onClick={accept} className="flex-1 rounded-xl bg-amber py-3 text-sm font-display font-bold text-[#1a1100]">Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* Under the top bar (like the receipt chase), never over the bottom of
          a page — it used to sit on the clock-out button it pointed at. */}
      {(denied || declined) && !askConsent && (
        <div
          data-shift-denied
          className="fixed left-2 right-2 z-[39] md:left-auto md:right-4 md:w-[440px] rounded-xl border border-amber/50 bg-[#2a1d05]/95 backdrop-blur px-3 py-2 shadow-panel flex items-center gap-2"
          style={{ top: `calc(var(--ht-safe-top, 0px) + ${62 + nagOffset}px)` }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] text-amber font-semibold leading-tight">📍 Location is required while you&apos;re clocked in.</p>
            <p className="text-[11px] text-amber/80 leading-tight truncate" title={settingsPath}>Turn it on ({settingsPath}) or clock out.</p>
          </div>
          {declined ? (
            <button type="button" onClick={() => { setDeclined(false); setAskConsent(true) }} className="flex-none rounded-lg bg-amber px-2.5 py-1.5 text-[11.5px] font-display font-bold text-[#1a1100]">Turn on</button>
          ) : isNativeApp() && bgPlugin() ? (
            <button type="button" onClick={openSettings} className="flex-none rounded-lg bg-amber px-2.5 py-1.5 text-[11.5px] font-display font-bold text-[#1a1100]">Settings</button>
          ) : null}
          <Link href="/clock" className="flex-none rounded-lg border border-amber/40 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber">Clock out</Link>
        </div>
      )}
    </>
  )
}
