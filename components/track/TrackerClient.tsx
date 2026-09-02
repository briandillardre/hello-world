'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import { cartoTiles, cartoAttribution, cartoMaxZoom } from '@/lib/map-layers'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Play, Square, Gauge, Crosshair, Clock, Route, AlertTriangle, Navigation, RotateCcw, Radio } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { confirmSheet } from '@/components/ui/feedback'
import { pushPhoneLocation, stopPhoneShare } from '@/lib/actions/tracker'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const SHARE_INTERVAL_MS = 8000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DARK_STYLE: any = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [cartoTiles('dark_all')],
      tileSize: 256,
      maxzoom: cartoMaxZoom('dark_all'),
      attribution: cartoAttribution(),
    },
  },
  layers: [{ id: 'carto-base', type: 'raster', source: 'carto-dark' }],
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const la1 = rad(a[1])
  const la2 = rad(b[1])
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
}

export function TrackerClient() {
  const mapDiv = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null)
  const ready = useRef(false)
  const watchId = useRef<number | null>(null)
  const trail = useRef<[number, number][]>([])
  const lastPos = useRef<[number, number] | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLock = useRef<any>(null)

  const [name, setName] = useState('')
  const [tracking, setTracking] = useState(false)
  const [pos, setPos] = useState<{ speed: number; accuracy: number } | null>(null)
  const [dist, setDist] = useState(0)
  const [topSpeed, setTopSpeed] = useState(0)
  const [start, setStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [firstFix, setFirstFix] = useState(false)
  const [summary, setSummary] = useState<{ duration: number; miles: string; topSpeed: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // ── Share to fleet map (authenticated) ──
  const [share, setShare] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [liveConfirmed, setLiveConfirmed] = useState(false)
  const shareRef = useRef(false); shareRef.current = share
  const signedInRef = useRef<boolean | null>(null); signedInRef.current = signedIn
  const lastPush = useRef(0)

  useEffect(() => {
    const n = typeof window !== 'undefined' ? localStorage.getItem('ht-emp-name') : null
    if (n) setName(n)
  }, [])

  // Can this device broadcast to the fleet map? Only when signed in on a real
  // (non-demo) deployment — sharing writes to the company's database.
  useEffect(() => {
    if (isMock) { setSignedIn(false); return }
    ;(async () => {
      try {
        const { createClient } = await import('@/lib/supabase')
        const { data } = await createClient().auth.getUser()
        setSignedIn(!!data.user)
      } catch { setSignedIn(false) }
    })()
  }, [])

  // Init map (maplibre loaded client-side only)
  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    ;(async () => {
      const maplibregl = (await import('maplibre-gl')).default
      if (cancelled || !mapDiv.current || map.current) return
      const m = new maplibregl.Map({
        container: mapDiv.current,
        style: DARK_STYLE,
        center: [-86.78, 36.16],
        zoom: 14,
        attributionControl: false,
      })
      map.current = m
      m.on('load', () => {
        m.addSource('trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        m.addLayer({ id: 'trail-line', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff9e16', 'line-width': 4, 'line-opacity': 0.9 } })
        m.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        m.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-color': '#2dd4bf', 'circle-opacity': 0.18, 'circle-radius': 22 } })
        m.addLayer({ id: 'me-dot', type: 'circle', source: 'me', paint: { 'circle-color': '#2dd4bf', 'circle-radius': 8, 'circle-stroke-width': 3, 'circle-stroke-color': '#001523' } })
        ready.current = true
        m.resize()
      })
      // Keep the canvas matched to the container — fixes the "map only renders in a
      // thin strip" bug when the map mounts before mobile layout settles.
      ro = new ResizeObserver(() => map.current?.resize())
      ro.observe(mapDiv.current)
      requestAnimationFrame(() => map.current?.resize())
      setTimeout(() => map.current?.resize(), 400)
    })()
    return () => { cancelled = true; ro?.disconnect(); map.current?.remove(); map.current = null }
  }, [])

  // On-the-clock timer
  useEffect(() => {
    if (!tracking || !start) return
    const id = setInterval(() => setElapsed(Date.now() - start), 1000)
    return () => clearInterval(id)
  }, [tracking, start])

  // Keep the screen awake while on the clock — without this, the phone dims and
  // the OS suspends GPS. Re-acquire when the tab returns to the foreground.
  const acquireWake = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wl = (navigator as any).wakeLock
      if (wl) wakeLock.current = await wl.request('screen')
    } catch { /* not supported / denied — fine */ }
  }, [])
  useEffect(() => {
    if (!tracking) return
    const onVis = () => { if (document.visibilityState === 'visible') acquireWake() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [tracking, acquireWake])

  const onPos = useCallback((p: GeolocationPosition) => {
    const lng = p.coords.longitude
    const lat = p.coords.latitude
    const speed = p.coords.speed != null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 2.23694) : 0
    const accuracy = Math.round(p.coords.accuracy)
    const prev = trail.current[trail.current.length - 1]
    if (prev) setDist((d) => d + haversine(prev, [lng, lat]))
    trail.current.push([lng, lat])
    lastPos.current = [lng, lat]
    setPos({ speed, accuracy })
    setTopSpeed((t) => Math.max(t, speed))
    setFirstFix(true)

    // Broadcast to the fleet map (throttled) when sharing is on + signed in.
    if (shareRef.current && signedInRef.current) {
      const now = Date.now()
      if (now - lastPush.current >= SHARE_INTERVAL_MS) {
        lastPush.current = now
        pushPhoneLocation({ lat, lng, speed, accuracy, heading: p.coords.heading ?? null })
          .then((r) => {
            if (r.ok) setLiveConfirmed(true)
            else if (r.reason === 'auth') { setSignedIn(false); setShare(false); setLiveConfirmed(false) }
          })
          .catch(() => { /* transient network — next fix retries */ })
      }
    }

    const m = map.current
    if (m && ready.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(m.getSource('me') as any)?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }] })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(m.getSource('trail') as any)?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: trail.current }, properties: {} }] })
      m.easeTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 16), duration: 700 })
    }
  }, [])

  const clockIn = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setErr('This device has no GPS / geolocation support.')
      return
    }
    localStorage.setItem('ht-emp-name', name || 'Me')
    setErr(null)
    setSummary(null)
    trail.current = []
    lastPos.current = null
    setDist(0)
    setTopSpeed(0)
    setPos(null)
    setFirstFix(false)
    setStart(Date.now())
    setElapsed(0)
    setTracking(true)
    lastPush.current = 0 // push the first fix to the fleet map immediately
    acquireWake()
    watchId.current = navigator.geolocation.watchPosition(
      onPos,
      (e) => setErr(e.message || 'Location blocked — allow location access for this site.'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    )
  }, [name, onPos, acquireWake])

  const clockOut = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    wakeLock.current?.release?.()
    wakeLock.current = null
    if (shareRef.current) { stopPhoneShare().catch(() => {}); setLiveConfirmed(false) }
    setSummary({ duration: elapsed, miles: (dist / 1609.34).toFixed(2), topSpeed })
    setTracking(false)
  }, [elapsed, dist, topSpeed])

  // Toggle broadcasting to the fleet map. Turning off drops the pin right away.
  const toggleShare = useCallback(() => {
    setShare((s) => {
      const next = !s
      if (next) { lastPush.current = 0 } // push on the next fix
      else { stopPhoneShare().catch(() => {}); setLiveConfirmed(false) }
      return next
    })
  }, [])

  const recenter = useCallback(() => {
    if (lastPos.current && map.current) map.current.easeTo({ center: lastPos.current, zoom: 16, duration: 500 })
  }, [])

  const miles = (dist / 1609.34).toFixed(2)

  return (
    <div className="fixed inset-0 flex flex-col bg-navy-950 text-ink">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-navy-800 bg-navy-950/90 backdrop-blur z-10">
        <Logo size={24} href={null} />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Field Tracker</span>
        <span className={'flex items-center gap-1.5 font-mono text-[11px] ' + (tracking ? 'text-teal' : 'text-faint')}>
          <span className={'w-2 h-2 rounded-full ' + (tracking ? 'bg-teal animate-blink' : 'bg-navy-700')} />
          {tracking ? 'TRACKING LIVE' : 'OFF'}
        </span>
      </div>

      {/* map */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapDiv} className="absolute inset-0" />
        {!tracking && !summary && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <p className="font-mono text-[12px] text-faint bg-navy-950/70 px-3 py-1.5 rounded-full">Start tracking to record your GPS trail</p>
          </div>
        )}
        {tracking && !firstFix && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <p className="font-mono text-[12px] text-teal bg-navy-950/80 px-3 py-1.5 rounded-full flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-teal border-t-transparent rounded-full animate-spin" /> Acquiring GPS…
            </p>
          </div>
        )}
        {(tracking || summary) && (
          <button onClick={recenter} className="absolute bottom-3 right-3 grid place-items-center w-11 h-11 rounded-xl bg-navy-950/85 backdrop-blur border border-navy-700 text-teal active:scale-95" aria-label="Recenter">
            <Navigation className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* control panel */}
      <div className="p-4 space-y-3 border-t border-navy-800">
        {err && (
          <div className="flex items-start gap-2 text-[12.5px] text-alert bg-alert/10 border border-alert/30 rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 flex-none mt-0.5" /> <span>{err}</span>
          </div>
        )}

        {tracking ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              <Stat icon={<Clock className="h-3.5 w-3.5" />} label="Tracking" value={clock(elapsed)} mono />
              <Stat icon={<Route className="h-3.5 w-3.5" />} label="Distance" value={`${miles} mi`} />
              <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Speed" value={`${pos?.speed ?? 0}`} unit="mph" />
              <Stat icon={<Crosshair className="h-3.5 w-3.5" />} label="Accuracy" value={pos?.accuracy ? `${pos.accuracy}` : '—'} unit={pos?.accuracy ? 'm' : undefined} />
            </div>
            <ShareRow signedIn={signedIn} share={share} onToggle={toggleShare} live={liveConfirmed} />
            <button
              onClick={async () => {
                const ok = await confirmSheet({
                  title: 'Stop tracking?',
                  message: "The trail ends here — you can't resume it.",
                  confirmLabel: 'Stop tracking',
                  destructive: true,
                })
                if (ok) clockOut()
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-alert text-white font-display font-bold py-3.5 hover:brightness-110 transition"
            >
              <Square className="h-5 w-5" /> Stop tracking
            </button>
          </>
        ) : summary ? (
          <>
            <div className="rounded-xl border border-teal/30 bg-teal/[0.06] p-3.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-teal mb-2">Trail complete</div>
              <div className="grid grid-cols-3 gap-2">
                <Stat icon={<Clock className="h-3.5 w-3.5" />} label="Tracked" value={clock(summary.duration)} mono />
                <Stat icon={<Route className="h-3.5 w-3.5" />} label="Distance" value={`${summary.miles} mi`} />
                <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Top speed" value={`${summary.topSpeed}`} unit="mph" />
              </div>
            </div>
            <button onClick={() => setSummary(null)} className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3.5 hover:brightness-110 transition">
              <RotateCcw className="h-5 w-5" /> Start new trail
            </button>
          </>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="done"
              className="w-full bg-navy-900 border border-navy-700 rounded-xl px-4 py-3 text-ink placeholder:text-faint outline-none focus:border-amber/50"
            />
            <ShareRow signedIn={signedIn} share={share} onToggle={toggleShare} live={liveConfirmed} />
            <button onClick={clockIn} className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3.5 hover:brightness-110 transition">
              <Play className="h-5 w-5" /> Start tracking
            </button>
            <p className="text-center font-mono text-[10px] text-faint">
              GPS trail only — this doesn&apos;t record work hours. Clock in on the{' '}
              <Link href="/clock" className="text-teal underline underline-offset-2 hover:brightness-110">Time clock</Link>.
            </p>
            <p className="text-center font-mono text-[10px] text-faint">We keep the screen awake while you&apos;re tracking. Full background tracking comes with the native app.</p>
          </>
        )}
      </div>
    </div>
  )
}

/** "Show me on the fleet map" toggle. Only actionable when signed in — a field
 *  worker who isn't gets a sign-in link instead of a dead switch. */
function ShareRow({ signedIn, share, onToggle, live }: { signedIn: boolean | null; share: boolean; onToggle: () => void; live: boolean }) {
  if (signedIn === false) {
    return (
      <a
        href="/login?next=/track"
        className="flex items-center justify-center gap-2 rounded-xl border border-navy-700 bg-navy-900 px-3 py-2.5 text-[12.5px] text-faint hover:text-ink hover:border-teal/40 transition-colors"
      >
        <Radio className="h-4 w-4" /> Sign in to show yourself on the fleet map →
      </a>
    )
  }
  if (signedIn === null) return null
  return (
    <button
      onClick={onToggle}
      className={
        'w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-colors ' +
        (share ? 'border-teal/50 bg-teal/[0.08]' : 'border-navy-700 bg-navy-900 hover:border-navy-600')
      }
    >
      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <Radio className={'h-4 w-4 ' + (share ? 'text-teal' : 'text-faint')} />
        {share ? (live ? 'Live on the fleet map' : 'Sharing — waiting for GPS…') : 'Show me on the fleet map'}
      </span>
      <span className={'w-9 h-5 rounded-full transition-colors relative flex-none ' + (share ? 'bg-teal/40' : 'bg-navy-700')}>
        <span className={'absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ' + (share ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

function Stat({ icon, label, value, unit, mono }: { icon: React.ReactNode; label: string; value: string; unit?: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-navy-900 border border-navy-800 px-2 py-2 text-center">
      <div className="flex items-center justify-center gap-1 text-faint mb-0.5">{icon}</div>
      <div className={(mono ? 'font-mono ' : 'font-display font-bold ') + 'text-ink text-[15px] leading-none tabular-nums'}>{value}<span className="text-[10px] text-faint font-mono">{unit ? ` ${unit}` : ''}</span></div>
      <div className="font-mono text-[8.5px] uppercase tracking-wider text-faint mt-1">{label}</div>
    </div>
  )
}
