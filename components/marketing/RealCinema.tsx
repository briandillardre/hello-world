'use client'

/**
 * The splash flythrough, rebuilt on the REAL map engine (Brian, Aug 3:
 * "cinematic flythru is not accurate to what i have actually seen on my
 * map"). Same MapLibre, same Esri satellite tiles, same glowing dot
 * markers, trail colors, and dashed zone the product draws — the camera
 * follows a truck around the demo job site in the product's Follow-mode
 * orbit. What a visitor sees here IS what they get after signup.
 * Non-interactive; pauses off-screen; honors reduced motion.
 */

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
// The demo job site (same block the /live demo fleet works).
const SITE: [number, number] = [-86.7816, 36.1627]
// A loop the "truck" drives — city blocks around the site.
const PATH: [number, number][] = [
  [-86.7870, 36.1602], [-86.7826, 36.1600], [-86.7788, 36.1604],
  [-86.7776, 36.1630], [-86.7782, 36.1655], [-86.7820, 36.1662],
  [-86.7858, 36.1656], [-86.7874, 36.1632],
]
const ZONE: [number, number][] = [
  [-86.7846, 36.1614], [-86.7794, 36.1612], [-86.7790, 36.1646],
  [-86.7842, 36.1650], [-86.7846, 36.1614],
]
const IDLE_DOTS: { c: [number, number]; color: string; name: string }[] = [
  { c: [-86.7830, 36.1631], color: '#2dd4bf', name: 'Link-Belt 130X2' },
  { c: [-86.7807, 36.1624], color: '#a78bfa', name: 'Sakai SW990' },
  { c: [-86.7818, 36.1641], color: '#f472b6', name: 'Drill Kit A' },
]

// Shared marker-label look — same name chips the real map draws on dots.
const LABEL_CSS = 'position:absolute;top:15px;left:50%;transform:translateX(-50%);white-space:nowrap;font:600 10px/1.2 ui-monospace,SFMono-Regular,monospace;color:#e8f1f8;text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 6px rgba(0,0,0,.8);pointer-events:none'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function pointAt(t: number): { p: [number, number]; bearing: number } {
  const n = PATH.length
  const f = ((t % 1) + 1) % 1 * n
  const i = Math.floor(f) % n
  const j = (i + 1) % n
  const k = f - Math.floor(f)
  const p: [number, number] = [lerp(PATH[i][0], PATH[j][0], k), lerp(PATH[i][1], PATH[j][1], k)]
  const dx = PATH[j][0] - PATH[i][0], dy = PATH[j][1] - PATH[i][1]
  return { p, bearing: (Math.atan2(dx, dy) * 180) / Math.PI }
}

export function RealCinema() {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let raf = 0
    let map: import('maplibre-gl').Map | null = null
    let truckEl: HTMLDivElement | null = null
    let marker: import('maplibre-gl').Marker | null = null
    let visible = true

    const io = new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true }, { threshold: 0.1 })
    if (el.current) io.observe(el.current)

    ;(async () => {
      const maplibregl = (await import('maplibre-gl')).default
      await import('maplibre-gl/dist/maplibre-gl.css' as string).catch(() => {})
      if (disposed || !el.current) return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      map = new maplibregl.Map({
        container: el.current,
        style: {
          version: 8,
          sources: { sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, attribution: 'Esri, Maxar' } },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#04121f' } },
            { id: 'sat', type: 'raster', source: 'sat' },
          ],
        },
        center: SITE, zoom: 15.6, pitch: 55, bearing: -20,
        interactive: false, attributionControl: false,
      })
      // Top-right keeps Esri credit clear of the CTA and the site label.
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right')

      map.on('load', () => {
        if (!map) return
        // Zone — the product's dashed amber job-site outline.
        map.addSource('zone', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ZONE] } } })
        map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone', paint: { 'fill-color': '#ff9e16', 'fill-opacity': 0.08 } })
        map.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#ff9e16', 'line-width': 2, 'line-dasharray': [2, 1.6] } })
        // The truck's trail, in its asset color — exactly the map's trail look.
        map.addSource('trail', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: PATH.concat([PATH[0]]) } } })
        map.addLayer({ id: 'trail', type: 'line', source: 'trail', paint: { 'line-color': '#ff9e16', 'line-width': 3, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })

        // 3D buildings over the imagery (Brian, Aug 5) — the same free
        // OpenFreeMap extrusions the real map's 3D toggle uses.
        map.addSource('ofm', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
        map.addLayer({
          id: 'buildings-3d', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 13,
          paint: {
            'fill-extrusion-color': '#3a4f67',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.55,
          },
        }, 'zone-fill')
        // Live traffic flow when the TomTom key is configured (site layer).
        const tomtom = process.env.NEXT_PUBLIC_TOMTOM_KEY
        if (tomtom) {
          map.addSource('traffic', {
            type: 'raster', tileSize: 256,
            tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${tomtom}`],
          })
          map.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', paint: { 'raster-opacity': 0.75 } }, 'zone-fill')
        }

        // Idle machines — steady product dots, name-labeled like the real map.
        for (const d of IDLE_DOTS) {
          const wrap = document.createElement('div')
          wrap.style.cssText = 'position:relative'
          const dot = document.createElement('div')
          dot.style.cssText = `width:13px;height:13px;border-radius:50%;background:${d.color};border:2px solid rgba(2,12,21,.9);box-shadow:0 0 10px ${d.color}aa`
          const lbl = document.createElement('span')
          lbl.textContent = d.name
          lbl.style.cssText = LABEL_CSS
          wrap.appendChild(dot)
          wrap.appendChild(lbl)
          new maplibregl.Marker({ element: wrap }).setLngLat(d.c).addTo(map!)
        }
        // The moving truck — the pulsing live dot, labeled (label on the
        // wrapper so it doesn't pulse with the dot).
        truckEl = document.createElement('div')
        truckEl.style.cssText = 'position:relative'
        const truckDot = document.createElement('div')
        truckDot.style.cssText = 'width:15px;height:15px;border-radius:50%;background:#ff9e16;border:2px solid rgba(2,12,21,.9);box-shadow:0 0 14px #ff9e16;animation:ht-pulse 1.6s ease-in-out infinite'
        const truckLbl = document.createElement('span')
        truckLbl.textContent = 'RAM 3500 Dump'
        truckLbl.style.cssText = LABEL_CSS
        truckEl.appendChild(truckDot)
        truckEl.appendChild(truckLbl)
        const styleTag = document.createElement('style')
        styleTag.textContent = '@keyframes ht-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}'
        document.head.appendChild(styleTag)
        marker = new maplibregl.Marker({ element: truckEl }).setLngLat(pointAt(0).p).addTo(map!)

        if (reduced) { marker.setLngLat(pointAt(0.15).p); return }
        const t0 = performance.now()
        const frame = (now: number) => {
          if (disposed) return
          raf = requestAnimationFrame(frame)
          if (!visible || !map || !marker) return
          const t = ((now - t0) / 60_000) % 1 // one lap a minute
          const { p } = pointAt(t)
          marker.setLngLat(p)
          // Follow-mode orbit: track the truck, slow continuous rotation.
          map.jumpTo({ center: [lerp(p[0], SITE[0], 0.45), lerp(p[1], SITE[1], 0.45)], bearing: -20 + ((now - t0) / 1000) * 1.7, pitch: 55, zoom: 15.6 })
        }
        raf = requestAnimationFrame(frame)
      })
    })()

    return () => { disposed = true; cancelAnimationFrame(raf); io.disconnect(); map?.remove() }
  }, [])

  return (
    <div className="relative rounded-2xl overflow-hidden border border-navy-800 shadow-panel">
      <div ref={el} className="aspect-[16/8] w-full bg-[#04121f]" />
      {/* Product chrome — the same badges a customer sees */}
      <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
        <span className="rounded-full bg-navy-950/85 border border-navy-700 px-3 py-1 font-mono text-[11px] text-teal flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-teal animate-blink" /> LIVE
        </span>
        <span className="rounded-full bg-navy-950/85 border border-navy-700 px-3 py-1 font-mono text-[11px] text-muted">Follow · F-350 Truck #1</span>
      </div>
      <div className="absolute bottom-3 left-3 pointer-events-none rounded-lg bg-navy-950/85 border border-navy-700 px-3 py-1.5">
        <p className="font-mono text-[10.5px] text-faint">Riverfront Tower <span className="text-amber">· zone</span> · 4 assets on site</p>
      </div>
      <Link
        href="/live"
        className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[13px] px-3.5 py-2 hover:bg-amber-600 transition-colors"
      >
        This is the real map — open it <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
