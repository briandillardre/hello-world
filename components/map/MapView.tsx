'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AssetWithLocation, AssetType, Geofence } from '@/lib/types'
import { DEMO_MAP_CENTER, DEMO_MAP_ZOOM } from '@/lib/mock-data'
import {
  type AssetTrack, clockLabel, positionAt, trailUpTo, PLAYBACK_WINDOW_SECONDS,
} from '@/lib/trails'
import {
  type WeatherFrames, type Conditions, type RadarFrame,
  fetchWeatherFrames, fetchConditions, weatherTileUrl, liveFrameIndex, frameLabel,
} from '@/lib/weather'
import { PROJECTS, LIVE_DAY_FRACTION } from '@/lib/projects'
import { AssetPanel } from './AssetPanel'
import { FilterBar } from './FilterBar'
import { GeofenceDrawer } from './GeofenceDrawer'
import { TimelinePlayback } from './TimelinePlayback'
import { WeatherControl, type WeatherMode } from './WeatherControl'
import { ProjectsPanel } from './ProjectsPanel'

const ASSET_COLORS: Record<AssetType, string> = {
  vehicle: '#ff9e16',
  equipment: '#60a5fa',
  personnel: '#34d399',
  tool: '#a78bfa',
}

// MapLibre layers that represent the live (non-playback) asset view
const LIVE_LAYERS = ['clusters', 'cluster-count', 'unclustered-circle', 'unclustered-label']
const TRAIL_LAYERS = ['trails-line', 'trail-heads', 'trail-head-labels']

function buildGeoJSON(assets: AssetWithLocation[], filter: Set<AssetType>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: assets
      .filter((a) => filter.has(a.type) && a.location)
      .map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.location!.lng, a.location!.lat] },
        properties: {
          id: a.id, name: a.name, type: a.type, color: ASSET_COLORS[a.type],
          battery: a.location!.battery, speed: a.location!.speed, timestamp: a.location!.timestamp,
        },
      })),
  }
}

function trailsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((tr) => filter.has(tr.type))
      .map((tr) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: trailUpTo(tr, t) },
        properties: { id: tr.assetId, color: tr.color },
      })),
  }
}

function headsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((tr) => filter.has(tr.type))
      .map((tr) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: positionAt(tr, t) },
        properties: { id: tr.assetId, name: tr.name, color: tr.color },
      })),
  }
}

interface MapViewProps {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  tracks?: AssetTrack[]
  toolGateways?: Record<string, { name: string; lastSeen: string }>
  onGeofenceSave?: (name: string, geometry: GeoJSON.Polygon, color: string) => void
}

export function MapView({ assets, geofences, tracks = [], toolGateways, onGeofenceSave }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<AssetWithLocation | null>(null)
  const [filter, setFilter] = useState<Set<AssetType>>(new Set<AssetType>(['vehicle', 'equipment', 'personnel', 'tool']))
  const [isDrawing, setIsDrawing] = useState(false)
  const drawCoords = useRef<[number, number][]>([])
  const drawPreviewSource = useRef<string>('draw-preview')

  // ── Timeline playback state ───────────────────────────────────────────────
  const [pbActive, setPbActive] = useState(false)
  const [pbPlaying, setPbPlaying] = useState(false)
  const [pbT, setPbT] = useState(0)
  const [pbSpeed, setPbSpeed] = useState(500)
  const tracksRef = useRef(tracks)
  const filterRef = useRef(filter)
  const speedRef = useRef(pbSpeed)
  const tRef = useRef(pbT)
  tracksRef.current = tracks
  filterRef.current = filter
  speedRef.current = pbSpeed
  tRef.current = pbT

  // ── Weather layer state ───────────────────────────────────────────────────
  const [weatherMode, setWeatherMode] = useState<WeatherMode>('off')
  const [weatherFrames, setWeatherFrames] = useState<WeatherFrames | null>(null)
  const [conditions, setConditions] = useState<Conditions | null>(null)
  const wxAdded = useRef(false)

  const activeFrames: RadarFrame[] = useMemo(() => {
    if (!weatherFrames) return []
    return weatherMode === 'satellite' ? weatherFrames.satellite : weatherFrames.radar
  }, [weatherFrames, weatherMode])

  const currentFrame: RadarFrame | null = useMemo(() => {
    if (activeFrames.length === 0) return null
    const idx = pbActive
      ? Math.min(activeFrames.length - 1, Math.round(pbT * (activeFrames.length - 1)))
      : liveFrameIndex(activeFrames)
    return activeFrames[idx]
  }, [activeFrames, pbActive, pbT])

  const tileKey = process.env.NEXT_PUBLIC_MAPTILER_KEY
  const mapStyle = (tileKey && tileKey !== 'YOUR_MAPTILER_KEY')
    ? `https://api.maptiler.com/maps/streets-dark/style.json?key=${tileKey}`
    : {
        version: 8 as const,
        sources: {
          'carto-dark': {
            type: 'raster' as const,
            tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png'],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
          },
        },
        layers: [{ id: 'carto-base', type: 'raster' as const, source: 'carto-dark' }],
      }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyle as maplibregl.StyleSpecification,
      center: DEMO_MAP_CENTER,
      zoom: DEMO_MAP_ZOOM,
      attributionControl: false,
    })

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.current.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.current.on('load', () => {
      const m = map.current!

      // Geofences (drawn under everything)
      m.addSource('geofences', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: geofences.map((g) => ({
            type: 'Feature', geometry: g.geometry, properties: { id: g.id, name: g.name, color: g.color },
          })),
        },
      })
      m.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } })
      m.addLayer({ id: 'geofence-outline', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } })
      m.addLayer({
        id: 'geofence-labels', type: 'symbol', source: 'geofences',
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Open Sans SemiBold', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': '#e8f0f7', 'text-halo-color': '#001523', 'text-halo-width': 1.5 },
      })

      // ── Trail layers (hidden until playback) ──
      m.addSource('trails', { type: 'geojson', data: trailsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-line', type: 'line', source: 'trails',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85, 'line-blur': 0.3 },
      })
      m.addSource('trail-heads', { type: 'geojson', data: headsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trail-heads', type: 'circle', source: 'trail-heads',
        layout: { visibility: 'none' },
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#001523' },
      })
      m.addLayer({
        id: 'trail-head-labels', type: 'symbol', source: 'trail-heads',
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', visibility: 'none' },
        paint: { 'text-color': '#e8f0f7', 'text-halo-color': '#001523', 'text-halo-width': 1.5 },
      })

      // ── Live asset cluster source ──
      m.addSource('assets', { type: 'geojson', data: buildGeoJSON(assets, filterRef.current), cluster: true, clusterMaxZoom: 15, clusterRadius: 40 })
      m.addLayer({
        id: 'clusters', type: 'circle', source: 'assets', filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#001523',
          'circle-radius': ['step', ['get', 'point_count'], 20, 5, 26, 20, 32],
          'circle-stroke-width': 2, 'circle-stroke-color': '#ff9e16',
        },
      })
      m.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'assets', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 13, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': '#ff9e16' },
      })
      m.addLayer({
        id: 'unclustered-circle', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 14, 'circle-stroke-width': 2, 'circle-stroke-color': '#001523' },
      })
      m.addLayer({
        id: 'unclustered-label', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['match', ['get', 'type'], 'vehicle', '🚛', 'equipment', '🏗️', 'personnel', '👷', 'tool', '🔧', '📍'],
          'text-size': 14, 'text-allow-overlap': true,
        },
      })

      // Draw preview
      m.addSource(drawPreviewSource.current, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'draw-fill', type: 'fill', source: drawPreviewSource.current, paint: { 'fill-color': '#ff9e16', 'fill-opacity': 0.15 } })
      m.addLayer({ id: 'draw-line', type: 'line', source: drawPreviewSource.current, paint: { 'line-color': '#ff9e16', 'line-width': 2 } })

      // Click handlers
      m.on('click', 'unclustered-circle', (e) => {
        const props = e.features?.[0]?.properties
        if (!props) return
        const asset = assets.find((a) => a.id === props.id)
        if (asset) setSelectedAsset(asset)
      })
      m.on('click', 'clusters', (e) => {
        const features = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        const clusterId = features[0]?.properties?.cluster_id
        if (!clusterId) return
        const source = m.getSource('assets') as maplibregl.GeoJSONSource
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number]
          m.easeTo({ center: coords, zoom: zoom ?? m.getZoom() + 2 })
        })
      })
      for (const layer of ['unclustered-circle', 'clusters', 'trail-heads']) {
        m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = '' })
      }
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Update live asset source when assets or filter change
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    const source = map.current.getSource('assets') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildGeoJSON(assets, filter))
  }, [assets, filter])

  // Toggle live vs trail layers when entering/leaving playback
  useEffect(() => {
    const m = map.current
    if (!m?.isStyleLoaded()) return
    LIVE_LAYERS.forEach((l) => m.getLayer(l) && m.setLayoutProperty(l, 'visibility', pbActive ? 'none' : 'visible'))
    TRAIL_LAYERS.forEach((l) => m.getLayer(l) && m.setLayoutProperty(l, 'visibility', pbActive ? 'visible' : 'none'))
  }, [pbActive])

  // Push trail/head geometry on time or filter change while in playback
  useEffect(() => {
    const m = map.current
    if (!pbActive || !m?.isStyleLoaded()) return
    ;(m.getSource('trails') as maplibregl.GeoJSONSource | undefined)?.setData(trailsGeoJSON(tracks, filter, pbT))
    ;(m.getSource('trail-heads') as maplibregl.GeoJSONSource | undefined)?.setData(headsGeoJSON(tracks, filter, pbT))
  }, [pbActive, pbT, filter, tracks])

  // Fetch weather frames + conditions once
  useEffect(() => {
    let cancelled = false
    fetchWeatherFrames().then((f) => { if (!cancelled) setWeatherFrames(f) })
    fetchConditions(DEMO_MAP_CENTER[1], DEMO_MAP_CENTER[0]).then((c) => { if (!cancelled) setConditions(c) })
    return () => { cancelled = true }
  }, [])

  // Add / update / toggle the weather raster layer
  useEffect(() => {
    const m = map.current
    if (!m?.isStyleLoaded()) return

    if (weatherMode === 'off' || !currentFrame || !weatherFrames) {
      if (wxAdded.current && m.getLayer('wx-layer')) m.setLayoutProperty('wx-layer', 'visibility', 'none')
      return
    }

    const url = weatherTileUrl(weatherFrames.host, currentFrame, weatherMode)
    if (!wxAdded.current) {
      m.addSource('wx', { type: 'raster', tiles: [url], tileSize: 256 })
      // Draw weather above the basemap but beneath geofences/assets
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      m.addLayer(
        { id: 'wx-layer', type: 'raster', source: 'wx', paint: { 'raster-opacity': weatherMode === 'satellite' ? 0.55 : 0.7 } },
        beforeId
      )
      wxAdded.current = true
    } else {
      ;(m.getSource('wx') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
      m.setPaintProperty('wx-layer', 'raster-opacity', weatherMode === 'satellite' ? 0.55 : 0.7)
      m.setLayoutProperty('wx-layer', 'visibility', 'visible')
    }
  }, [weatherMode, currentFrame, weatherFrames])

  // Animation loop
  useEffect(() => {
    if (!pbPlaying) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      let next = tRef.current + (dt * speedRef.current) / PLAYBACK_WINDOW_SECONDS
      if (next >= 1) { next = 1; setPbPlaying(false) }
      tRef.current = next
      setPbT(next)
      if (next < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pbPlaying])

  const togglePlayback = useCallback(() => {
    setPbActive((prev) => {
      const next = !prev
      if (next && tRef.current >= 1) { tRef.current = 0; setPbT(0) }
      if (!next) setPbPlaying(false)
      return next
    })
  }, [])

  const handlePlayPause = useCallback(() => {
    setPbPlaying((p) => {
      if (!p && tRef.current >= 1) { tRef.current = 0; setPbT(0) }
      return !p
    })
  }, [])

  const handleSeek = useCallback((v: number) => {
    setPbPlaying(false)
    tRef.current = v
    setPbT(v)
  }, [])

  // ── Geofence drawing ──
  const handleDrawClick = useCallback((e: maplibregl.MapMouseEvent) => {
    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    drawCoords.current.push(coords)
    const pts = drawCoords.current
    if (!map.current) return
    const preview: GeoJSON.FeatureCollection = pts.length >= 3
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: {} }] }
      : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }] }
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData(preview)
  }, [])

  const startDrawing = useCallback(() => {
    if (!map.current) return
    drawCoords.current = []
    setIsDrawing(true)
    map.current.getCanvas().style.cursor = 'crosshair'
    map.current.on('click', handleDrawClick)
  }, [handleDrawClick])

  const finishDrawing = useCallback((): GeoJSON.Polygon | null => {
    if (!map.current) return null
    map.current.off('click', handleDrawClick)
    map.current.getCanvas().style.cursor = ''
    setIsDrawing(false)
    if (drawCoords.current.length < 3) return null
    return { type: 'Polygon', coordinates: [[...drawCoords.current, drawCoords.current[0]]] }
  }, [handleDrawClick])

  const cancelDrawing = useCallback(() => {
    if (!map.current) return
    map.current.off('click', handleDrawClick)
    map.current.getCanvas().style.cursor = ''
    drawCoords.current = []
    setIsDrawing(false)
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
  }, [handleDrawClick])

  return (
    <div className="relative w-full h-full bg-navy-950">
      <div ref={mapContainer} className="w-full h-full" />

      <FilterBar filter={filter} onChange={setFilter} />

      <WeatherControl
        mode={weatherMode}
        onMode={setWeatherMode}
        conditions={conditions}
        frameTime={currentFrame ? frameLabel(currentFrame.time) : null}
        scrubbing={pbActive}
      />

      <ProjectsPanel projects={PROJECTS} t={pbActive ? pbT : LIVE_DAY_FRACTION} scrubbing={pbActive} />

      {!pbActive && (
        <GeofenceDrawer
          isDrawing={isDrawing}
          onStartDraw={startDrawing}
          onFinishDraw={finishDrawing}
          onCancelDraw={cancelDrawing}
          onSave={onGeofenceSave}
        />
      )}

      {tracks.length > 0 && (
        <TimelinePlayback
          active={pbActive}
          t={pbT}
          playing={pbPlaying}
          speed={pbSpeed}
          label={clockLabel(pbT)}
          onToggleActive={togglePlayback}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onSpeed={setPbSpeed}
        />
      )}

      {selectedAsset && (
        <AssetPanel
          asset={selectedAsset}
          gateway={toolGateways?.[selectedAsset.id]}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  )
}
