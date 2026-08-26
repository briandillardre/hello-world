'use client'

/**
 * Cinematic demo theater for the /demo landing hero.
 *
 * A real MapLibre scene (satellite, tilted 3D camera) plays a ~40s scripted
 * loop: orbit the jobsite → chase a machine through a workday → 2:14 AM the
 * excavator leaves the zone (night tint, red trail, THEFT ALERT + SMS) →
 * recovery pull-back. The same follow/orbit camera engine as the product's
 * timeline playback, so "see it live" is a truthful promise.
 *
 * Loaded client-side only (see DemoCinemaLoader) — the marketing page's first
 * paint stays instant and the map engine streams in after.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowRight, ShieldAlert, MapPin, CheckCircle2 } from 'lucide-react'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Riverside Tower — a real-looking construction site by the Cumberland River
const SITE: [number, number] = [-86.7816, 36.1635]
const ZONE: [number, number][] = [
  [-86.7846, 36.1650], [-86.7796, 36.1656], [-86.7784, 36.1628],
  [-86.7820, 36.1614], [-86.7848, 36.1626], [-86.7846, 36.1650],
]

// Daytime work loop inside/near the zone
const WORK_PATH: [number, number][] = [
  [-86.7828, 36.1638], [-86.7812, 36.1644], [-86.7799, 36.1641],
  [-86.7794, 36.1631], [-86.7808, 36.1622], [-86.7824, 36.1625],
  [-86.7830, 36.1633], [-86.7828, 36.1638],
]

// 2:14 AM — out of the zone, onto the highway
const THEFT_PATH: [number, number][] = [
  [-86.7828, 36.1638], [-86.7840, 36.1652], [-86.7862, 36.1668],
  [-86.7892, 36.1678], [-86.7930, 36.1674], [-86.7962, 36.1690],
]

const LOOP_MS = 40_000
// beat boundaries as fractions of the loop
const B_ORBIT = 0.2   // 0.00–0.20 orbit the site
const B_WORK = 0.52   // 0.20–0.52 daytime chase
const B_THEFT = 0.82  // 0.52–0.82 night theft + alert
                      // 0.82–1.0 recovery pull-back

type Beat = 0 | 1 | 2 | 3

function bearingBetween(a: [number, number], b: [number, number]): number {
  const φ1 = (a[1] * Math.PI) / 180, φ2 = (b[1] * Math.PI) / 180
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}
function lerpAngle(from: number, to: number, f: number): number {
  const diff = (((to - from) % 360) + 540) % 360 - 180
  return (from + diff * f + 360) % 360
}
function pathAt(path: [number, number][], t: number): [number, number] {
  const f = Math.min(0.9999, Math.max(0, t)) * (path.length - 1)
  const i = Math.floor(f)
  const frac = f - i
  const a = path[i], b = path[i + 1]
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]
}
function traveled(path: [number, number][], t: number): [number, number][] {
  const f = Math.min(0.9999, Math.max(0, t)) * (path.length - 1)
  const coords = path.slice(0, Math.floor(f) + 1)
  coords.push(pathAt(path, t))
  return coords
}

const BEAT_CLOCK = ['4:47 PM', '4:52 PM', '2:14 AM', '2:36 AM']

export default function DemoCinema() {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [beat, setBeat] = useState<Beat>(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const m = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar' },
        },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      center: SITE,
      zoom: 15.2,
      pitch: reduced ? 45 : 0,
      interactive: false,
      attributionControl: false,
    })
    mapRef.current = m

    // the machine — an HTML marker so it glows without needing glyphs
    const dot = document.createElement('div')
    dot.className = 'demo-cinema-dot'
    dot.textContent = '🏗️'
    const marker = new maplibregl.Marker({ element: dot }).setLngLat(WORK_PATH[0]).addTo(m)
    markerRef.current = marker

    let raf = 0
    let cleanup = () => {}

    m.on('load', () => {
      m.addSource('zone', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ZONE] }, properties: {} },
      })
      m.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone', paint: { 'fill-color': '#ff9e16', 'fill-opacity': 0.1 } })
      m.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#ff9e16', 'line-width': 2.5, 'line-dasharray': [3, 2] } })

      m.addSource('trail-day', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'trail-day', type: 'line', source: 'trail-day',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ff9e16', 'line-width': 3.5, 'line-opacity': 0.9 },
      })
      m.addSource('trail-theft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'trail-theft', type: 'line', source: 'trail-theft',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fb5d5d', 'line-width': 4, 'line-opacity': 0.95 },
      })

      setReady(true)

      const setLine = (id: string, coords: [number, number][]) => {
        ;(m.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(
          coords.length >= 2
            ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
            : { type: 'FeatureCollection', features: [] }
        )
      }

      if (reduced) {
        // No camera flight — hold a tilted site view and just cycle the story.
        m.jumpTo({ center: SITE, zoom: 15.2, pitch: 45, bearing: 20 })
        setLine('trail-day', WORK_PATH)
        marker.setLngLat(WORK_PATH[0])
        let b = 0
        const id = setInterval(() => { b = (b + 1) % 4; setBeat(b as Beat) }, 6000)
        cleanup = () => clearInterval(id)
        return
      }

      // Smoothed camera state — targets change per beat, camera glides after them.
      const cam = { lng: SITE[0], lat: SITE[1], zoom: 15.2, pitch: 0, bearing: 0 }
      let lastBeat: Beat = 0
      const start = performance.now()

      const tick = (now: number) => {
        const p = ((now - start) % LOOP_MS) / LOOP_MS
        let target: { c: [number, number]; zoom: number; pitch: number; bearing?: number } // bearing undefined = keep drifting
        let pos: [number, number] | null = null
        let nextBeat: Beat

        if (p < B_ORBIT) {
          nextBeat = 0
          cam.bearing = (cam.bearing + 0.07) % 360 // slow orbit
          target = { c: SITE, zoom: 15.6, pitch: 55 }
          pos = WORK_PATH[0]
          if (lastBeat === 3) { setLine('trail-day', []); setLine('trail-theft', []) } // loop reset
        } else if (p < B_WORK) {
          nextBeat = 1
          const t = (p - B_ORBIT) / (B_WORK - B_ORBIT)
          pos = pathAt(WORK_PATH, t)
          const ahead = pathAt(WORK_PATH, Math.min(1, t + 0.02))
          cam.bearing = lerpAngle(cam.bearing, bearingBetween(pos, ahead), 0.06)
          target = { c: pos, zoom: 16.6, pitch: 62 }
          setLine('trail-day', traveled(WORK_PATH, t))
        } else if (p < B_THEFT) {
          nextBeat = 2
          const t = (p - B_WORK) / (B_THEFT - B_WORK)
          pos = pathAt(THEFT_PATH, t)
          const ahead = pathAt(THEFT_PATH, Math.min(1, t + 0.02))
          cam.bearing = lerpAngle(cam.bearing, bearingBetween(pos, ahead), 0.06)
          target = { c: pos, zoom: 16.1, pitch: 58 }
          setLine('trail-theft', traveled(THEFT_PATH, t))
        } else {
          nextBeat = 3
          cam.bearing = (cam.bearing + 0.05) % 360
          target = { c: [-86.789, 36.1662], zoom: 14.6, pitch: 35 }
          pos = THEFT_PATH[THEFT_PATH.length - 1]
        }

        // glide toward targets
        cam.lng += (target.c[0] - cam.lng) * 0.06
        cam.lat += (target.c[1] - cam.lat) * 0.06
        cam.zoom += (target.zoom - cam.zoom) * 0.04
        cam.pitch += (target.pitch - cam.pitch) * 0.04
        m.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing })
        if (pos) marker.setLngLat(pos)

        if (nextBeat !== lastBeat) { lastBeat = nextBeat; setBeat(nextBeat) }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      cleanup = () => cancelAnimationFrame(raf)
    })

    return () => {
      cleanup()
      m.remove()
      mapRef.current = null
    }
  }, [])

  const night = beat === 2 || beat === 3

  return (
    <div className="relative rounded-2xl overflow-hidden border border-navy-800 shadow-panel ring-1 ring-teal/10 bg-[#001120]">
      <div ref={container} className="aspect-[16/11] sm:aspect-[16/10] w-full" />

      {/* night falls for the theft beat */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-[1500ms] bg-[#010916] ${night ? 'opacity-60' : 'opacity-0'}`}
      />

      {/* header bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2.5 bg-gradient-to-b from-[#001120]/90 to-transparent">
        <span className="font-mono text-[11px] text-teal flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full bg-teal shadow-glow-teal animate-blink" />
          RIVERSIDE TOWER · REPLAY DEMO
        </span>
        <span className={`font-mono text-[12px] font-bold tabular-nums px-2 py-0.5 rounded-md border transition-colors duration-700 ${night ? 'text-alert border-alert/40 bg-alert/10' : 'text-ink border-navy-700 bg-navy-950/60'}`}>
          {BEAT_CLOCK[beat]}
        </span>
      </div>

      {/* story cards */}
      <div className="absolute left-3 right-3 bottom-14 sm:left-4 sm:right-auto sm:max-w-[330px] space-y-2 pointer-events-none">
        {beat === 0 && (
          <StoryCard tone="teal" icon={<MapPin className="h-4 w-4" />} title="Every machine on one live map"
            body="12 assets on site · zones armed · AI watching for after-hours movement." />
        )}
        {beat === 1 && (
          <StoryCard tone="amber" icon={<span className="text-[15px] leading-none">🏗️</span>} title="Excavator 320 — working"
            body="14 mph · trail records every move · hours auto-billed to Riverside Tower." />
        )}
        {beat === 2 && (
          <>
            <StoryCard tone="alert" icon={<ShieldAlert className="h-4 w-4" />} title="THEFT ALERT — 2:14 AM"
              body="Excavator 320 left Riverside Tower outside work hours. Moving northwest." pulse />
            <div className="demo-sms rounded-2xl rounded-bl-md bg-[#1c9b45] text-white px-3.5 py-2.5 text-[12.5px] leading-snug shadow-xl max-w-[300px]">
              <span className="font-semibold">HammerTrack:</span> 🚨 Excavator 320 moving OFF-SITE at 2:14 AM.
              Live location → hammertrack.app/t/9X2
            </div>
          </>
        )}
        {beat === 3 && (
          <StoryCard tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} title="Recovered in 22 minutes"
            body="Hand deputies the live pin and the route replay — that's an $82,000 machine coming back, not an insurance claim." />
        )}
      </div>

      {/* CTA bar */}
      <Link
        href="/live"
        className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2 px-4 py-3 bg-[#001120]/85 backdrop-blur border-t border-navy-800 font-display font-bold text-[13.5px] text-amber hover:bg-amber/10 transition-colors"
      >
        Scripted demo, real map engine — see the real thing live
        <ArrowRight className="h-4 w-4" />
      </Link>

      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-[#001120]">
          <span className="font-mono text-xs text-faint animate-pulse">loading satellite…</span>
        </div>
      )}
    </div>
  )
}

const TONE = {
  teal: 'border-teal/40 bg-[#001a2e]/90 text-teal',
  amber: 'border-amber/40 bg-[#001a2e]/90 text-amber',
  alert: 'border-alert/50 bg-[#2a0a12]/95 text-alert',
  ok: 'border-[#34d399]/40 bg-[#02180f]/95 text-[#34d399]',
}

function StoryCard({ tone, icon, title, body, pulse }: {
  tone: keyof typeof TONE
  icon: React.ReactNode
  title: string
  body: string
  pulse?: boolean
}) {
  return (
    <div className={`demo-card rounded-xl border backdrop-blur px-3.5 py-3 shadow-2xl ${TONE[tone]} ${pulse ? 'animate-pulse-ring' : ''}`}>
      <p className="flex items-center gap-2 font-display font-bold text-[13px]">{icon}{title}</p>
      <p className="text-[12px] text-ink/85 mt-1 leading-snug">{body}</p>
    </div>
  )
}
