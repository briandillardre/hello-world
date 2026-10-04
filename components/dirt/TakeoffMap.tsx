'use client'

/**
 * The takeoff editor's map: satellite, the zone's placed plan sheets, the
 * cut/fill picture, every traced feature, and the trace in progress. It draws
 * and reports clicks — the editor owns the design.
 */
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ensureMapLibreWorkerShims } from '@/lib/maplibre-setup'
import type { Shape } from '@/lib/dirt/features'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const FONT = ['Open Sans Bold', 'Arial Unicode MS Bold']
const SNAP_PX = 12
const FEATURE_LAYERS = ['feat-pt', 'feat-ln', 'feat-ar-line', 'feat-ar-fill']
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export interface MapSheet { id: string; url: string; corners: [number, number][]; visible: boolean; opacity: number }

interface Props {
  ring: [number, number][] | null
  sheets: MapSheet[]
  features: GeoJSON.FeatureCollection
  draft: { shape: Shape; coords: [number, number][]; color: string } | null
  heat: { url: string; corners: [number, number][] } | null
  heatVisible: boolean
  heatOpacity: number
  /** Results step: cut/fill over the plan sheets. Tracing: under them, so the plan's lines read. */
  heatOverSheets: boolean
  drawing: boolean
  snapTo: [number, number][]
  /** `mpp`: ground metres per screen pixel where the tap landed (how big a fingertip is there). */
  onClick: (p: [number, number], meta: { closesRing: boolean; mpp: number }) => void
  onDblClick: () => void
  onPick: (id: string | null) => void
  /** Bumped to re-frame the map on these coordinates. */
  frame?: { key: number; coords: [number, number][] }
  /** What the plan reader found (components/dirt/PlanReader.tsx), drawn over everything. */
  readOverlay?: GeoJSON.FeatureCollection | null
  /** A read contour tapped. */
  /** A read contour tapped, by its key. */
  onPickRead?: (rk: string) => void
}

/** Screen distance from a point to a segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export default function TakeoffMap(props: Props) {
  const el = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const live = useRef(props)
  live.current = props
  const cursor = useRef<[number, number] | null>(null)
  const sheetIds = useRef<Set<string>>(new Set())

  // ── Init ──
  useEffect(() => {
    if (!el.current || mapRef.current) return
    const ring = props.ring
    const center: [number, number] = ring?.length
      ? [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
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
      zoom: 17,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      maxZoom: 22,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 110 }), 'bottom-left')
    m.on('load', () => {
      m.addSource('heat', { type: 'image', url: TRANSPARENT_PNG, coordinates: [[0, 0.0001], [0.0001, 0.0001], [0.0001, 0], [0, 0]] })
      m.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } })
      // Plan sheets go under this (invisible) anchor; the heat moves above or below them.
      m.addLayer({ id: 'sheets-top', type: 'background', paint: { 'background-opacity': 0 } })
      m.addSource('feat', { type: 'geojson', data: EMPTY })
      m.addSource('draft', { type: 'geojson', data: EMPTY })
      const isArea: maplibregl.ExpressionSpecification = ['==', ['get', 'g'], 'ar']
      m.addLayer({
        id: 'feat-ar-fill', type: 'fill', source: 'feat', filter: ['all', isArea, ['!=', ['get', 'kind'], 'boundary']],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.28, 0.12] },
      })
      m.addLayer({
        id: 'feat-ar-line', type: 'line', source: 'feat', filter: isArea,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['==', ['get', 'sel'], 1], 3.2, ['==', ['get', 'kind'], 'boundary'], 2.2, 1.6],
          'line-dasharray': ['case', ['==', ['get', 'kind'], 'boundary'], ['literal', [3, 2]], ['literal', [1, 0]]],
        },
      })
      m.addLayer({
        id: 'feat-ln-casing', type: 'line', source: 'feat', filter: ['==', ['get', 'g'], 'ln'],
        paint: { 'line-color': '#04121d', 'line-width': ['case', ['==', ['get', 'sel'], 1], 6, 4], 'line-opacity': 0.55 },
      })
      m.addLayer({
        id: 'feat-ln', type: 'line', source: 'feat', filter: ['==', ['get', 'g'], 'ln'],
        paint: {
          'line-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', ['get', 'color']],
          'line-width': ['case', ['==', ['get', 'sel'], 1], 3.4, 2],
          'line-dasharray': ['case', ['==', ['get', 'kind'], 'eg_contour'], ['literal', [2, 1.5]], ['literal', [1, 0]]],
        },
      })
      m.addLayer({
        id: 'feat-pt', type: 'circle', source: 'feat', filter: ['==', ['get', 'g'], 'pt'],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 7, 5],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#04121d',
          'circle-stroke-width': 1.5,
        },
      })
      m.addLayer({
        id: 'feat-ln-label', type: 'symbol', source: 'feat', filter: ['==', ['get', 'g'], 'ln'],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 180, 'text-field': ['get', 'lbl'], 'text-size': 11, 'text-font': FONT, 'text-keep-upright': true },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#04121d', 'text-halo-width': 1.6 },
      })
      m.addLayer({
        id: 'feat-pt-label', type: 'symbol', source: 'feat', filter: ['in', ['get', 'g'], ['literal', ['pt', 'al']]],
        layout: { 'text-field': ['get', 'lbl'], 'text-size': 11, 'text-font': FONT, 'text-offset': ['case', ['==', ['get', 'g'], 'pt'], ['literal', [0, -1.2]], ['literal', [0, 0]]], 'text-allow-overlap': false },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#04121d', 'text-halo-width': 1.6 },
      })
      // The plan reader's overlay: contours coloured by elevation (white dashed = not named yet,
      // red edge = something to check), spot grades, the pad and the limit it found.
      m.addSource('read', { type: 'geojson', data: EMPTY })
      const ct: maplibregl.ExpressionSpecification = ['==', ['get', 'k'], 'ct']
      m.addLayer({ id: 'read-pen', type: 'line', source: 'read', filter: ['==', ['get', 'k'], 'pen'], paint: { 'line-color': '#22d3ee', 'line-width': 3, 'line-opacity': 0.75 } })
      m.addLayer({
        id: 'read-ar', type: 'line', source: 'read', filter: ['in', ['get', 'k'], ['literal', ['pad', 'limit']]],
        paint: { 'line-color': ['case', ['==', ['get', 'k'], 'pad'], '#c084fc', '#ffffff'], 'line-width': 2.4, 'line-dasharray': [3, 2] },
      })
      m.addLayer({
        id: 'read-ln-casing', type: 'line', source: 'read', filter: ['all', ct, ['==', ['get', 'ex'], 0]],
        paint: {
          'line-color': ['case', ['==', ['get', 'flag'], 1], '#ef4444', '#04121d'],
          'line-width': ['case', ['==', ['get', 'sel'], 1], 7, ['==', ['get', 'flag'], 1], 5.5, 4],
          'line-opacity': ['case', ['==', ['get', 'flag'], 1], 0.9, 0.55],
        },
      })
      m.addLayer({
        id: 'read-ln', type: 'line', source: 'read', filter: ct,
        paint: {
          'line-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', ['get', 'color']],
          'line-width': ['case', ['==', ['get', 'sel'], 1], 3.6, ['==', ['get', 'ex'], 1], 1.2, 2],
          'line-opacity': ['case', ['==', ['get', 'ex'], 1], 0.45, 1],
          'line-dasharray': ['case', ['==', ['get', 'unk'], 1], ['literal', [1.5, 1.5]], ['==', ['get', 'eg'], 1], ['literal', [3, 1]], ['literal', [1, 0]]],
        },
      })
      m.addLayer({
        id: 'read-pt', type: 'circle', source: 'read', filter: ['==', ['get', 'k'], 'spot'],
        paint: { 'circle-radius': 3.5, 'circle-color': ['case', ['==', ['get', 'eg'], 1], '#9fb6cc', '#ff9e16'], 'circle-stroke-color': '#04121d', 'circle-stroke-width': 1 },
      })
      m.addLayer({
        id: 'read-ln-label', type: 'symbol', source: 'read', filter: ['all', ct, ['!=', ['get', 'lbl'], '']],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 220, 'text-field': ['get', 'lbl'], 'text-size': 11, 'text-font': FONT, 'text-keep-upright': true },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#04121d', 'text-halo-width': 1.8 },
      })
      m.addLayer({
        id: 'read-pt-label', type: 'symbol', source: 'read', filter: ['in', ['get', 'k'], ['literal', ['spot', 'pad']]], minzoom: 18,
        layout: { 'text-field': ['get', 'lbl'], 'text-size': 10, 'text-font': FONT, 'text-offset': [0, -1], 'text-allow-overlap': false },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#04121d', 'text-halo-width': 1.5 },
      })
      m.addLayer({
        id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 2.2, 'line-dasharray': [2, 1] },
      })
      m.addLayer({
        id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': ['case', ['==', ['get', 'first'], 1], 6, 4], 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 },
      })
      ready.current = true
      if (ring && ring.length >= 3) {
        const b = ring.reduce((bb, p) => bb.extend(p as [number, number]), new maplibregl.LngLatBounds(ring[0], ring[0]))
        m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 19 })
      }
      syncAll()
    })

    const snap = (lngLat: maplibregl.LngLat, point: maplibregl.Point): { p: [number, number]; closesRing: boolean } => {
      const p = live.current
      let best: [number, number] | null = null
      let bestD = SNAP_PX
      let closes = false
      const d0 = p.draft
      if (d0 && d0.shape === 'area' && d0.coords.length >= 3) {
        const q = m.project(d0.coords[0] as [number, number])
        const d = Math.hypot(q.x - point.x, q.y - point.y)
        if (d < bestD) { best = d0.coords[0]; bestD = d; closes = true }
      }
      for (const v of p.snapTo) {
        const q = m.project(v as [number, number])
        const d = Math.hypot(q.x - point.x, q.y - point.y)
        if (d < bestD) { best = v; bestD = d; closes = false }
      }
      return { p: best ?? [lngLat.lng, lngLat.lat], closesRing: closes }
    }

    m.on('click', (e) => {
      const p = live.current
      if (p.drawing) {
        const s = snap(e.lngLat, e.point)
        const mpp = (40075016.686 * Math.cos((e.lngLat.lat * Math.PI) / 180)) / (512 * 2 ** m.getZoom())
        p.onClick(s.p, { closesRing: s.closesRing, mpp })
        return
      }
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]] // a fingertip, not a mouse pointer
      if (p.readOverlay && p.onPickRead && m.getLayer('read-ln')) {
        const rh = m.queryRenderedFeatures(box, { layers: ['read-ln'] })
        // The nearest line to the finger, not the first drawn — measured to its segments, not its
        // vertices (a straight contour has few, far apart).
        let best: string | null = null, bestD = Infinity
        for (const h of rh) {
          const g = h.geometry
          if (g.type !== 'LineString') continue
          let prev: maplibregl.Point | null = null
          for (const c of g.coordinates) {
            const q = m.project(c as [number, number])
            const d = prev ? segDist(e.point.x, e.point.y, prev.x, prev.y, q.x, q.y) : Math.hypot(q.x - e.point.x, q.y - e.point.y)
            if (d < bestD) { bestD = d; best = String(h.properties?.rk ?? '') }
            prev = q
          }
        }
        if (best) { p.onPickRead(best); return }
      }
      const hits = m.queryRenderedFeatures(box, { layers: FEATURE_LAYERS.filter(l => m.getLayer(l)) })
      const order = ['feat-pt', 'feat-ln', 'feat-ar-line', 'feat-ar-fill']
      hits.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id))
      p.onPick((hits[0]?.properties?.id as string | undefined) ?? null)
    })
    m.on('dblclick', (e) => {
      if (!live.current.drawing) return
      e.preventDefault()
      live.current.onDblClick()
    })
    let raf = 0
    m.on('mousemove', (e) => {
      if (!live.current.drawing) return
      cursor.current = [e.lngLat.lng, e.lngLat.lat]
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; syncDraft() })
    })
    m.on('mouseout', () => { cursor.current = null; syncDraft() })

    mapRef.current = m
    // Local browser tests drive the map through this; production builds drop it.
    if (process.env.NODE_ENV === 'development') (window as unknown as { __takeoffMap?: maplibregl.Map }).__takeoffMap = m
    return () => { if (raf) cancelAnimationFrame(raf); m.remove(); mapRef.current = null; ready.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function syncDraft() {
    const m = mapRef.current
    if (!m || !ready.current) return
    const d = live.current.draft
    const src = m.getSource('draft') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    if (!d || !d.coords.length) { src.setData(EMPTY); return }
    const feats: GeoJSON.Feature[] = []
    const line = [...d.coords]
    if (cursor.current && live.current.drawing) line.push(cursor.current)
    if (d.shape === 'area' && d.coords.length >= 2) line.push(d.coords[0])
    if (line.length >= 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { color: d.color } })
    d.coords.forEach((c, i) => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { color: d.color, first: i === 0 ? 1 : 0 } }))
    src.setData({ type: 'FeatureCollection', features: feats })
  }

  function syncSheets() {
    const m = mapRef.current
    if (!m || !ready.current) return
    const want = new Set(live.current.sheets.filter(s => s.visible).map(s => s.id))
    for (const id of Array.from(sheetIds.current)) {
      if (!want.has(id)) {
        if (m.getLayer(`sheet-${id}`)) m.removeLayer(`sheet-${id}`)
        if (m.getSource(`sheet-${id}`)) m.removeSource(`sheet-${id}`)
        sheetIds.current.delete(id)
      }
    }
    for (const s of live.current.sheets) {
      if (!s.visible) continue
      const sid = `sheet-${s.id}`
      if (!m.getSource(sid)) {
        m.addSource(sid, { type: 'image', url: s.url, coordinates: s.corners as [[number, number], [number, number], [number, number], [number, number]] })
        m.addLayer({ id: sid, type: 'raster', source: sid, paint: { 'raster-opacity': s.opacity, 'raster-fade-duration': 0 } }, 'sheets-top')
        sheetIds.current.add(s.id)
      } else {
        m.setPaintProperty(sid, 'raster-opacity', s.opacity)
      }
    }
    syncOrder()
  }

  function syncOrder() {
    const m = mapRef.current
    if (!m || !ready.current || !m.getLayer('heat')) return
    if (live.current.heatOverSheets) { m.moveLayer('heat', 'sheets-top'); return }
    const bottom = Array.from(sheetIds.current)[0] // added in order, each just under the anchor
    if (bottom && m.getLayer(`sheet-${bottom}`)) m.moveLayer('heat', `sheet-${bottom}`)
  }

  // The picture is re-sent only when it changes: updateImage refetches and
  // re-uploads the texture, which made every render (a slider drag, a tap) janky.
  const shownHeat = useRef('')
  function syncHeat() {
    const m = mapRef.current
    if (!m || !ready.current) return
    const h = live.current.heat
    const src = m.getSource('heat') as maplibregl.ImageSource | undefined
    if (!src) return
    const sig = h ? `${h.url}|${h.corners.flat().join(',')}` : ''
    if (h && sig !== shownHeat.current) {
      src.updateImage({ url: h.url, coordinates: h.corners as [[number, number], [number, number], [number, number], [number, number]] })
      shownHeat.current = sig
    }
    m.setPaintProperty('heat', 'raster-opacity', h && live.current.heatVisible ? live.current.heatOpacity : 0)
  }

  function syncAll() {
    const m = mapRef.current
    if (!m || !ready.current) return
    ;(m.getSource('feat') as maplibregl.GeoJSONSource | undefined)?.setData(live.current.features)
    ;(m.getSource('read') as maplibregl.GeoJSONSource | undefined)?.setData(live.current.readOverlay ?? EMPTY)
    syncSheets()
    syncHeat()
    syncDraft()
  }

  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready.current) return
    ;(m.getSource('feat') as maplibregl.GeoJSONSource | undefined)?.setData(props.features)
  }, [props.features])
  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready.current) return
    ;(m.getSource('read') as maplibregl.GeoJSONSource | undefined)?.setData(props.readOverlay ?? EMPTY)
  }, [props.readOverlay])
  useEffect(() => { syncDraft() }, [props.draft]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncSheets() }, [props.sheets]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncHeat() }, [props.heat?.url, props.heat?.corners, props.heatVisible, props.heatOpacity]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncOrder() }, [props.heatOverSheets]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    if (props.drawing) { m.doubleClickZoom.disable(); m.getCanvas().style.cursor = 'crosshair' }
    else { m.doubleClickZoom.enable(); m.getCanvas().style.cursor = ''; cursor.current = null; syncDraft() }
  }, [props.drawing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = mapRef.current
    const c = props.frame?.coords
    if (!m || !c?.length) return
    const b = c.reduce((bb, p) => bb.extend(p as [number, number]), new maplibregl.LngLatBounds(c[0], c[0]))
    m.fitBounds(b, { padding: 50, duration: 400, maxZoom: 19 })
  }, [props.frame?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // maplibre's own CSS makes its container position: relative — so the
  // absolute box is a wrapper and the map fills it.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" />
    </div>
  )
}

// 1×1 transparent PNG — the heat source exists from load so updates are cheap.
const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
