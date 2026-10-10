'use client'

/**
 * The site takeoff editor's map: Esri imagery underneath (hand tracing only),
 * the picked drone shot pinned by its four corners, the zone outline, every
 * mark coloured by its line item, and the shape being drawn. It draws and
 * reports taps — the editor owns the design.
 */
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ensureMapLibreWorkerShims } from '@/lib/maplibre-setup'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

interface Props {
  ring: [number, number][] | null
  ortho: { url: string; corners: [number, number][] } | null
  orthoOpacity: number
  marks: GeoJSON.FeatureCollection
  draft: { coords: [number, number][]; color: string; closed: boolean } | null
  onClick: (p: [number, number]) => void
  onDblClick: () => void
  onPick: (id: string | null) => void
  picking: boolean
}

export default function SiteTakeoffMap(props: Props) {
  const el = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const live = useRef(props)
  live.current = props
  const orthoKey = useRef<string | null>(null)

  useEffect(() => {
    if (!el.current || mapRef.current) return
    const ring = props.ring
    const pts = props.ortho?.corners ?? ring ?? []
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
      center,
      zoom: 18,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      doubleClickZoom: false,
      maxZoom: 23,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 110 }), 'bottom-left')
    m.on('load', () => {
      m.addLayer({ id: 'ortho-anchor', type: 'background', paint: { 'background-opacity': 0 } })
      m.addSource('zone', { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } })
      m.addSource('marks', { type: 'geojson', data: EMPTY })
      m.addSource('draft', { type: 'geojson', data: EMPTY })
      m.addLayer({
        id: 'mk-fill', type: 'fill', source: 'marks', filter: ['==', ['get', 'g'], 'ar'],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.45, ['==', ['get', 'minus'], 1], 0.08, 0.28] },
      })
      m.addLayer({
        id: 'mk-ar-line', type: 'line', source: 'marks', filter: ['==', ['get', 'g'], 'ar'],
        paint: {
          'line-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', ['get', 'color']],
          'line-width': ['case', ['==', ['get', 'sel'], 1], 3, 2],
          'line-dasharray': ['case', ['==', ['get', 'minus'], 1], ['literal', [2, 2]], ['literal', [1, 0]]],
        },
      })
      m.addLayer({ id: 'mk-ln-casing', type: 'line', source: 'marks', filter: ['==', ['get', 'g'], 'ln'], paint: { 'line-color': '#04121d', 'line-width': 5, 'line-opacity': 0.5 } })
      m.addLayer({
        id: 'mk-ln', type: 'line', source: 'marks', filter: ['==', ['get', 'g'], 'ln'],
        paint: { 'line-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', ['get', 'color']], 'line-width': ['case', ['==', ['get', 'sel'], 1], 3.5, 2.5] },
      })
      m.addLayer({
        id: 'mk-pt', type: 'circle', source: 'marks', filter: ['==', ['get', 'g'], 'pt'],
        paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 7, 5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#04121d', 'circle-stroke-width': 1.5 },
      })
      m.addLayer({ id: 'dr-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 } })
      m.addLayer({ id: 'dr-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [2, 1] } })
      m.addLayer({ id: 'dr-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
      ready.current = true
      sync()
      const ring2 = live.current.ring
      const fit = live.current.ortho?.corners ?? (ring2 && ring2.length >= 3 ? ring2 : null)
      if (fit) {
        const b = new maplibregl.LngLatBounds(fit[0], fit[0])
        for (const p of fit) b.extend(p)
        m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 21 })
      }
    })
    m.on('click', (e) => {
      const p = live.current
      if (p.picking) {
        const hit = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['mk-pt', 'mk-ln', 'mk-fill'] })
        p.onPick(hit.length ? String(hit[0].properties?.id ?? '') || null : null)
        return
      }
      p.onClick([e.lngLat.lng, e.lngLat.lat])
    })
    m.on('dblclick', (e) => { e.preventDefault(); live.current.onDblClick() })
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null; ready.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function sync() {
    const m = mapRef.current
    if (!m || !ready.current) return
    const p = live.current
    const zoneSrc = m.getSource('zone') as maplibregl.GeoJSONSource | undefined
    zoneSrc?.setData(p.ring && p.ring.length >= 3
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...p.ring, p.ring[0]] } }
      : EMPTY)
    ;(m.getSource('marks') as maplibregl.GeoJSONSource | undefined)?.setData(p.marks)
    const d = p.draft
    const dfs: GeoJSON.Feature[] = []
    if (d && d.coords.length) {
      const props = { color: d.color }
      for (const c of d.coords) dfs.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } })
      if (d.coords.length >= 2) {
        dfs.push(d.closed && d.coords.length >= 3
          ? { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[...d.coords, d.coords[0]]] } }
          : { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: d.coords } })
      }
    }
    ;(m.getSource('draft') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: dfs })

    const key = p.ortho ? `${p.ortho.url}|${JSON.stringify(p.ortho.corners)}` : null
    if (key !== orthoKey.current) {
      if (m.getLayer('ortho')) m.removeLayer('ortho')
      if (m.getSource('ortho')) m.removeSource('ortho')
      if (p.ortho) {
        m.addSource('ortho', { type: 'image', url: p.ortho.url, coordinates: p.ortho.corners as [[number, number], [number, number], [number, number], [number, number]] })
        m.addLayer({ id: 'ortho', type: 'raster', source: 'ortho', paint: { 'raster-opacity': p.orthoOpacity, 'raster-fade-duration': 0 } }, 'ortho-anchor')
      }
      orthoKey.current = key
    } else if (p.ortho && m.getLayer('ortho')) {
      m.setPaintProperty('ortho', 'raster-opacity', p.orthoOpacity)
    }
    m.getCanvas().style.cursor = p.picking ? 'pointer' : 'crosshair'
  }

  useEffect(sync)

  return <div ref={el} className="h-full w-full" />
}
