'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { cartoTiles, cartoAttribution, cartoMaxZoom } from '@/lib/map-layers'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Play, Pause } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { SpeedControl } from '@/components/ui/speed-control'
import { speedsForWindow, defaultSpeedForWindow } from '@/lib/trails'
import type { SharedReplayProps, SharePoint } from './SharedReplay'

/**
 * The public replay player: one asset, one window, no login. Deliberately
 * lean — a dark basemap, the route, a moving head, and a scrubber. The
 * recipient watches the trip; the sender's account stays sealed shut.
 */

function positionAt(points: SharePoint[], ms: number): { lng: number; lat: number; mph: number | null } {
  if (ms <= points[0].ms) return { lng: points[0].lng, lat: points[0].lat, mph: points[0].mph ?? null }
  const last = points[points.length - 1]
  if (ms >= last.ms) return { lng: last.lng, lat: last.lat, mph: last.mph ?? null }
  let lo = 0, hi = points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].ms <= ms) lo = mid
    else hi = mid
  }
  const a = points[lo], b = points[hi]
  const f = b.ms === a.ms ? 0 : (ms - a.ms) / (b.ms - a.ms)
  return {
    lng: a.lng + (b.lng - a.lng) * f,
    lat: a.lat + (b.lat - a.lat) * f,
    mph: a.mph ?? null,
  }
}

export function SharedReplayInner({ name, points, fromMs, toMs, startT }: SharedReplayProps) {
  const mapDiv = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(startT)
  const tRef = useRef(startT)
  const windowSeconds = (toMs - fromMs) / 1000
  const speeds = useMemo(() => speedsForWindow(windowSeconds), [windowSeconds])
  const [speed, setSpeed] = useState(() => defaultSpeedForWindow(windowSeconds))
  const speedRef = useRef(speed)
  speedRef.current = speed

  const place = useCallback((v: number) => {
    const ms = fromMs + v * (toMs - fromMs)
    const p = positionAt(points, ms)
    marker.current?.setLngLat([p.lng, p.lat])
    return p
  }, [points, fromMs, toMs])

  useEffect(() => {
    if (!mapDiv.current || map.current) return
    const m = new maplibregl.Map({
      container: mapDiv.current,
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: [cartoTiles('dark_all')],
            tileSize: 256,
            maxzoom: cartoMaxZoom('dark_all'),
            attribution: cartoAttribution(),
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      attributionControl: false,
    })
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    const bounds = points.reduce(
      (b, p) => b.extend([p.lng, p.lat]),
      new maplibregl.LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat])
    )
    m.fitBounds(bounds, { padding: 70, maxZoom: 16, duration: 0 })

    m.on('load', () => {
      m.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) }, properties: {} },
      })
      m.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': '#2dd4bf', 'line-width': 7, 'line-opacity': 0.15, 'line-blur': 3 } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#2dd4bf', 'line-width': 2.2, 'line-opacity': 0.8 } })

      const el = document.createElement('div')
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#ff9e16;border:2.5px solid #001523;box-shadow:0 0 12px #ff9e16'
      marker.current = new maplibregl.Marker({ element: el }).setLngLat([points[0].lng, points[0].lat]).addTo(m)
      setReady(true)
    })
    map.current = m
    return () => { m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Park the head at the shared scrub position as soon as the map is up.
  useEffect(() => { if (ready) place(tRef.current) }, [ready, place])

  const [hud, setHud] = useState<{ clock: string; mph: number | null }>({ clock: '', mph: null })
  const updateHud = useCallback((v: number) => {
    const ms = fromMs + v * (toMs - fromMs)
    const p = positionAt(points, ms)
    setHud({
      clock: new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      mph: p.mph,
    })
  }, [points, fromMs, toMs])
  useEffect(() => { updateHud(tRef.current) }, [updateHud])

  // Playback loop — t advances at `speed`× wall clock across the real window.
  useEffect(() => {
    if (!playing || !ready) return
    let raf = 0
    let last = performance.now()
    let hudAt = 0
    const frame = (now: number) => {
      const dt = now - last
      last = now
      let v = tRef.current + (dt * speedRef.current) / (toMs - fromMs)
      if (v >= 1) { v = 1; setPlaying(false) }
      tRef.current = v
      setT(v)
      place(v)
      if (now - hudAt > 400) { hudAt = now; updateHud(v) }
      if (v < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, ready, place, updateHud, fromMs, toMs])

  const seek = (v: number) => {
    setPlaying(false)
    tRef.current = v
    setT(v)
    place(v)
    updateHud(v)
  }

  const dates = `${new Date(fromMs).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(toMs).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div className="fixed inset-0 bg-navy-950 text-ink">
      <div ref={mapDiv} className="absolute inset-0" />

      {/* header card */}
      <div className="absolute top-3 left-3 z-10 rounded-xl bg-navy-950/85 backdrop-blur border border-navy-700 shadow-panel px-4 py-3 max-w-[calc(100%-24px)]">
        <div className="flex items-center gap-3">
          <Logo size={22} href={null} />
          <div className="min-w-0">
            <p className="font-display font-bold text-[15px] leading-tight truncate">{name}</p>
            <p className="font-mono text-[10px] text-faint tracking-wide">SHARED REPLAY · {dates}</p>
          </div>
        </div>
      </div>

      {/* player bar */}
      <div className="absolute left-3 right-3 bottom-3 z-10 rounded-2xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel px-4 py-3">
        <div className="flex items-center gap-1.5 mb-1 font-display font-bold text-amber text-[13px] tabular-nums">
          {hud.clock}
          {playing && hud.mph != null && <span className="font-mono text-[11px] text-teal ml-2">{Math.round(hud.mph)} mph</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { if (tRef.current >= 1) seek(0); setPlaying((p) => !p) }}
            className="flex-none grid place-items-center w-10 h-10 rounded-full bg-amber text-[#1a1100] shadow-glow-amber hover:brightness-110 transition"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>
          <input
            type="range" min={0} max={1000} value={Math.round(t * 1000)}
            onChange={(e) => seek(Number(e.target.value) / 1000)}
            className="slider-heat flex-1 h-[17px] cursor-pointer"
            aria-label="Replay position"
          />
          <SpeedControl speeds={speeds} value={speed} onChange={setSpeed} />
        </div>
        <p className="mt-1.5 font-mono text-[9px] text-faint">
          Times shown in your local timezone · link expires 7 days after sharing ·{' '}
          <a href="/demo" className="text-teal hover:underline">tracked with HammerTrack</a>
        </p>
      </div>
    </div>
  )
}
