'use client'

import 'maplibre-gl/dist/maplibre-gl.css'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Square, Gauge, Crosshair, Clock, Route, AlertTriangle } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DARK_STYLE: any = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
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

  const [name, setName] = useState('')
  const [tracking, setTracking] = useState(false)
  const [pos, setPos] = useState<{ speed: number; accuracy: number } | null>(null)
  const [dist, setDist] = useState(0)
  const [start, setStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const n = typeof window !== 'undefined' ? localStorage.getItem('ht-emp-name') : null
    if (n) setName(n)
  }, [])

  // Init map (maplibre loaded client-side only)
  useEffect(() => {
    let cancelled = false
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
      })
    })()
    return () => { cancelled = true; map.current?.remove(); map.current = null }
  }, [])

  // On-the-clock timer
  useEffect(() => {
    if (!tracking || !start) return
    const id = setInterval(() => setElapsed(Date.now() - start), 1000)
    return () => clearInterval(id)
  }, [tracking, start])

  const onPos = useCallback((p: GeolocationPosition) => {
    const lng = p.coords.longitude
    const lat = p.coords.latitude
    const speed = p.coords.speed != null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 2.23694) : 0
    const accuracy = Math.round(p.coords.accuracy)
    const prev = trail.current[trail.current.length - 1]
    if (prev) setDist((d) => d + haversine(prev, [lng, lat]))
    trail.current.push([lng, lat])
    setPos({ speed, accuracy })
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
    trail.current = []
    setDist(0)
    setPos(null)
    setStart(Date.now())
    setElapsed(0)
    setTracking(true)
    watchId.current = navigator.geolocation.watchPosition(
      onPos,
      (e) => setErr(e.message || 'Location blocked — allow location access for this site.'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    )
  }, [name, onPos])

  const clockOut = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    setTracking(false)
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
          {tracking ? 'ON CLOCK' : 'OFF'}
        </span>
      </div>

      {/* map */}
      <div className="relative flex-1">
        <div ref={mapDiv} className="absolute inset-0" />
        {!tracking && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <p className="font-mono text-[12px] text-faint bg-navy-950/70 px-3 py-1.5 rounded-full">Clock in to start tracking</p>
          </div>
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
              <Stat icon={<Clock className="h-3.5 w-3.5" />} label="On clock" value={clock(elapsed)} mono />
              <Stat icon={<Route className="h-3.5 w-3.5" />} label="Distance" value={`${miles} mi`} />
              <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Speed" value={`${pos?.speed ?? 0}`} unit="mph" />
              <Stat icon={<Crosshair className="h-3.5 w-3.5" />} label="GPS ±" value={`${pos?.accuracy ?? '—'}`} unit="m" />
            </div>
            <button onClick={clockOut} className="w-full flex items-center justify-center gap-2 rounded-xl bg-alert text-white font-display font-bold py-3.5 hover:brightness-110 transition">
              <Square className="h-5 w-5" /> Clock Out
            </button>
          </>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-navy-900 border border-navy-700 rounded-xl px-4 py-3 text-ink placeholder:text-faint outline-none focus:border-amber/50"
            />
            <button onClick={clockIn} className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3.5 hover:brightness-110 transition">
              <Play className="h-5 w-5" /> Clock In & Track
            </button>
            <p className="text-center font-mono text-[10px] text-faint">Keep this screen on while working — web tracking pauses when the phone locks.</p>
          </>
        )}
      </div>
    </div>
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
