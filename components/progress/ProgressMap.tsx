'use client'

/**
 * One flight's cut / fill-to-grade picture over the satellite, with the site
 * outline — the picture swaps as the timeline moves.
 */
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ensureMapLibreWorkerShims } from '@/lib/maplibre-setup'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export default function ProgressMap({ ring, picture, opacity }: {
  ring: [number, number][] | null
  picture: { url: string; corners: [number, number][] } | null
  opacity: number
}) {
  const el = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const live = useRef({ picture, opacity })
  live.current = { picture, opacity }

  const sync = () => {
    const m = mapRef.current
    if (!m || !ready.current) return
    const p = live.current.picture
    const src = m.getSource('heat') as maplibregl.ImageSource | undefined
    if (!p) {
      if (m.getLayer('heat')) m.removeLayer('heat')
      if (src) m.removeSource('heat')
      return
    }
    const coordinates = p.corners as [[number, number], [number, number], [number, number], [number, number]]
    if (src) src.updateImage({ url: p.url, coordinates })
    else {
      m.addSource('heat', { type: 'image', url: p.url, coordinates })
      m.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': live.current.opacity, 'raster-fade-duration': 0 } }, 'zone-line')
    }
    if (m.getLayer('heat')) m.setPaintProperty('heat', 'raster-opacity', live.current.opacity)
  }

  useEffect(() => {
    if (!el.current || mapRef.current) return
    const pts = picture?.corners ?? ring ?? []
    const center: [number, number] = pts.length
      ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
      : [-82.4, 34.85]
    ensureMapLibreWorkerShims(maplibregl)
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar' } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      center, zoom: 17, attributionControl: false, pitchWithRotate: false, dragRotate: false, maxZoom: 22,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 110 }), 'bottom-left')
    m.on('load', () => {
      m.addSource('zone', { type: 'geojson', data: ring && ring.length >= 3
        ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } }
        : { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } })
      ready.current = true
      sync()
      const fit = live.current.picture?.corners ?? (ring && ring.length >= 3 ? ring : null)
      if (fit) {
        const b = new maplibregl.LngLatBounds(fit[0], fit[0])
        for (const p of fit) b.extend(p)
        m.fitBounds(b, { padding: 30, duration: 0, maxZoom: 20 })
      }
    })
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null; ready.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(sync, [picture?.url, opacity]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="h-72 w-full overflow-hidden rounded-2xl border border-navy-700 md:h-96" />
}
