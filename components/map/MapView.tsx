'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AssetWithLocation, AssetType, Geofence } from '@/lib/types'
import { DEMO_MAP_CENTER, DEMO_MAP_ZOOM } from '@/lib/mock-data'
import {
  type AssetTrack, type TimeRange, type TrailMode, positionAt, trailUpTo,
  rangeWindowSeconds, defaultSpeed,
} from '@/lib/trails'
import {
  type WeatherFrames, type Conditions, type RadarFrame,
  fetchWeatherFrames, fetchConditions, weatherTileUrl, liveFrameIndex, frameLabel,
} from '@/lib/weather'
import { PROJECTS, periodCost, RANGE_COST_LABEL } from '@/lib/projects'
import { MOCK_SITE_DEVICES, DEVICE_META, devicePopupHTML } from '@/lib/site-devices'
import { geofencePresence, presencePopupHTML } from '@/lib/site-presence'
import { AssetPanel } from './AssetPanel'
import { FilterBar } from './FilterBar'
import { GeofenceDrawer } from './GeofenceDrawer'
import { TimelinePlayback } from './TimelinePlayback'
import { WeatherControl, type BaseStyle } from './WeatherControl'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const ASSET_COLORS: Record<AssetType, string> = {
  vehicle: '#ff9e16',
  equipment: '#60a5fa',
  personnel: '#34d399',
  tool: '#a78bfa',
}

// MapLibre layers that represent the live (non-playback) asset view
const LIVE_LAYERS = ['clusters', 'cluster-count', 'unclustered-circle', 'unclustered-label']
const HEAD_LAYERS = ['trail-heads', 'trail-head-labels']

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

function pointsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const tr of tracks) {
    if (!filter.has(tr.type)) continue
    for (const p of tr.points) {
      if (p.t > t) break
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: {} })
    }
  }
  return { type: 'FeatureCollection', features }
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

// Build label anchor points at the TOP edge of each geofence so the zone name
// floats above the busy interior instead of being covered by clustered pins.
function geofenceLabelPoints(geofences: Geofence[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geofences.map((g) => {
      const ring = g.geometry.coordinates[0] as [number, number][]
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
      const area = (maxLng - minLng) * (maxLat - minLat)
      // smaller sort key = placed first = wins collisions, so bigger zones win
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [(minLng + maxLng) / 2, maxLat] }, properties: { name: g.name, color: g.color, pri: -area } }
    }),
  }
}

interface MapViewProps {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  tracks?: AssetTrack[]
  toolGateways?: Record<string, { name: string; lastSeen: string }>
  onGeofenceSave?: (name: string, geometry: GeoJSON.Polygon, color: string) => void
  kiosk?: boolean
}

export function MapView({ assets, geofences, tracks = [], toolGateways, onGeofenceSave, kiosk = false }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  // Flipped once the style + custom layers exist, so mutation effects that fired
  // too early re-apply instead of silently dropping the change.
  const [mapReady, setMapReady] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<AssetWithLocation | null>(null)
  const [filter, setFilter] = useState<Set<AssetType>>(new Set<AssetType>(['vehicle', 'equipment', 'personnel', 'tool']))
  const [showZones, setShowZones] = useState(true)
  const [isDrawing, setIsDrawing] = useState(false)
  const drawCoords = useRef<[number, number][]>([])
  const drawPreviewSource = useRef<string>('draw-preview')

  // ── Timeline playback state ───────────────────────────────────────────────
  const [range, setRange] = useState<TimeRange>('live')
  // Custom From/To window (defaults to the last 7 days). Epoch ms.
  const [customFrom, setCustomFrom] = useState(() => Date.now() - 7 * 86_400_000)
  const [customTo, setCustomTo] = useState(() => Date.now())
  const customDays = Math.max(1, Math.round((customTo - customFrom) / 86_400_000))
  const pbActive = range !== 'live'
  const [trailMode, setTrailMode] = useState<TrailMode>('off')
  const [pbPlaying, setPbPlaying] = useState(false)
  const [pbT, setPbT] = useState(0)
  const [pbSpeed, setPbSpeed] = useState(500)
  // How much of the window is revealed: full when live, scrubbed when replaying
  const displayT = pbActive ? pbT : 1
  // Project cost shown inside the timeline (tracks the current range + scrub)
  const costTotal = PROJECTS.reduce((s, p) => s + periodCost(p, range, pbT, customDays).total, 0)
  const costLabel = range === 'custom' ? `${customDays}-day window` : RANGE_COST_LABEL[range]
  const tracksRef = useRef(tracks)
  const filterRef = useRef(filter)
  const speedRef = useRef(pbSpeed)
  const tRef = useRef(pbT)
  const rangeRef = useRef(range)
  const windowRef = useRef(rangeWindowSeconds(range))
  // Click handlers are bound once in the init effect; read assets via ref so
  // they see live data instead of the first render's array.
  const assetsRef = useRef(assets)
  const geofencesRef = useRef(geofences)
  tracksRef.current = tracks
  filterRef.current = filter
  speedRef.current = pbSpeed
  tRef.current = pbT
  rangeRef.current = range
  windowRef.current = rangeWindowSeconds(range)
  assetsRef.current = assets
  geofencesRef.current = geofences

  // Fit the map to everything — assets, zones, and site devices.
  const fitAll = useCallback(() => {
    const m = map.current
    if (!m) return
    const pts: [number, number][] = []
    for (const a of assetsRef.current) if (a.location) pts.push([a.location.lng, a.location.lat])
    for (const d of MOCK_SITE_DEVICES) pts.push([d.lng, d.lat])
    for (const g of geofencesRef.current) {
      const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
      if (ring) for (const c of ring) pts.push([c[0], c[1]])
    }
    if (!pts.length) return
    const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
    m.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 600 })
  }, [])

  // ── Basemap + weather layer state ─────────────────────────────────────────
  // Default to satellite — real aerial imagery reads as "the actual jobsite"
  const [base, setBase] = useState<BaseStyle>('satellite')
  const [radarOn, setRadarOn] = useState(false)
  const [weatherFrames, setWeatherFrames] = useState<WeatherFrames | null>(null)
  const [conditions, setConditions] = useState<Conditions | null>(null)
  const [wxPlace, setWxPlace] = useState('Nashville, TN')
  const wxAdded = useRef(false)

  const activeFrames: RadarFrame[] = useMemo(() => weatherFrames?.radar ?? [], [weatherFrames])

  // Radar is a live overlay only — free RainViewer keeps just ~2h of history,
  // so we always show the latest real frame rather than faking the past.
  const currentFrame: RadarFrame | null = useMemo(() => {
    if (activeFrames.length === 0) return null
    return activeFrames[liveFrameIndex(activeFrames)]
  }, [activeFrames])

  // Free, no-key basemap: CARTO dark raster. (Satellite + 3D buildings are added
  // on load from free sources — no paid MapTiler key required.)
  const mapStyle = {
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

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')
    map.current.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')

    // Zoom-to-all control (sits below the geolocate button)
    const fitAllControl: maplibregl.IControl = {
      onAdd() {
        const div = document.createElement('div')
        div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.title = 'Zoom to all'
        btn.setAttribute('aria-label', 'Zoom to all')
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
        btn.onclick = () => fitAll()
        div.appendChild(btn)
        return div
      },
      onRemove() {},
    }
    map.current.addControl(fitAllControl, 'top-right')
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.current.on('load', () => {
      const m = map.current!

      // ── Free basemap layers stacked over the CARTO dark base ──
      // Streets (labeled, no imagery) — CARTO Voyager
      m.addSource('streets-base', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'streets-base', type: 'raster', source: 'streets-base', layout: { visibility: 'none' } })

      // Satellite (aerial) imagery — Esri World Imagery
      m.addSource('sat-base', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, attribution: 'Esri, Maxar' })
      m.addLayer({ id: 'sat-base', type: 'raster', source: 'sat-base', layout: { visibility: 'none' } })

      // Reference labels (roads / places) — transparent overlay for Hybrid
      m.addSource('labels-overlay', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
      })
      m.addLayer({ id: 'labels-overlay', type: 'raster', source: 'labels-overlay', layout: { visibility: 'none' } })

      // 3D building extrusions from OpenFreeMap (free vector tiles, no key).
      // OpenMapTiles schema: 'building' layer with render_height / render_min_height.
      m.addSource('ofm', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
      m.addLayer({
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'ofm',
        'source-layer': 'building',
        minzoom: 13,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#2a3f57',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      })

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
      m.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } })
      m.addLayer({ id: 'geofence-outline', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [3, 2] } })
      // Labels anchored to the top edge of each zone (added last so they sit above pins)
      m.addSource('geofence-label-pts', { type: 'geojson', data: geofenceLabelPoints(geofences) })

      // ── Trail / heatmap layers (hidden until a movement mode is on) ──
      m.addSource('trails', { type: 'geojson', data: trailsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-line', type: 'line', source: 'trails',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85, 'line-blur': 0.3 },
      })
      // Heatmap of movement density (alternative to trails)
      m.addSource('trail-points', { type: 'geojson', data: pointsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-heat', type: 'heatmap', source: 'trail-points',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 16, 34],
          'heatmap-opacity': 0.85,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(7,58,90,0.6)',
            0.4, '#2dd4bf',
            0.7, '#ff9e16',
            1, '#fb5d5d',
          ],
        },
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
      // soft glow under each pin so assets pop off the satellite imagery
      m.addLayer({
        id: 'asset-glow', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.22, 'circle-radius': 24, 'circle-blur': 0.7 },
      })
      m.addLayer({
        id: 'unclustered-circle', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 14, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#04121d' },
      })
      m.addLayer({
        id: 'unclustered-label', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['match', ['get', 'type'], 'vehicle', '🚛', 'equipment', '🏗️', 'personnel', '👷', 'tool', '🔧', '📍'],
          'text-size': 14, 'text-allow-overlap': true,
        },
      })

      // ── Site devices (cameras + sensors) ──
      m.addSource('devices', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: MOCK_SITE_DEVICES.map((d) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
            properties: { id: d.id, color: DEVICE_META[d.type].color, emoji: DEVICE_META[d.type].emoji },
          })),
        },
      })
      m.addLayer({
        id: 'device-bg', type: 'circle', source: 'devices',
        paint: { 'circle-color': '#001523', 'circle-radius': 13, 'circle-stroke-width': 2, 'circle-stroke-color': ['get', 'color'] },
      })
      m.addLayer({
        id: 'device-icon', type: 'symbol', source: 'devices',
        layout: { 'text-field': ['get', 'emoji'], 'text-size': 14, 'text-allow-overlap': true },
      })

      // Zone labels — anchored above each zone, with collision avoidance so
      // nearby labels don't overlap (the larger/billable zone wins).
      m.addLayer({
        id: 'geofence-labels', type: 'symbol', source: 'geofence-label-pts',
        layout: {
          'text-field': ['get', 'name'], 'text-size': 13,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'bottom', 'text-offset': [0, -0.5],
          'text-allow-overlap': false, 'text-ignore-placement': false,
          'text-padding': 6, 'symbol-sort-key': ['get', 'pri'],
        },
        paint: { 'text-color': '#e8f0f7', 'text-halo-color': '#001016', 'text-halo-width': 2.4 },
      })

      // Draw preview
      m.addSource(drawPreviewSource.current, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'draw-fill', type: 'fill', source: drawPreviewSource.current, paint: { 'fill-color': '#ff9e16', 'fill-opacity': 0.15 } })
      m.addLayer({ id: 'draw-line', type: 'line', source: drawPreviewSource.current, paint: { 'line-color': '#ff9e16', 'line-width': 2 } })

      // Only one popover on the map at a time — clears any open popup + asset panel
      const showPopup = (lngLat: maplibregl.LngLatLike, html: string) => {
        popupRef.current?.remove()
        setSelectedAsset(null)
        popupRef.current = new maplibregl.Popup({ offset: 16, closeButton: true, closeOnClick: true, maxWidth: '240px' })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(m)
      }

      // Click handlers
      m.on('click', 'unclustered-circle', (e) => {
        const props = e.features?.[0]?.properties
        if (!props) return
        const asset = assetsRef.current.find((a) => a.id === props.id)
        if (asset) {
          popupRef.current?.remove() // close any zone/device popover first
          setSelectedAsset(asset)
        }
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
      // Device pin → themed popover
      m.on('click', 'device-bg', (e) => {
        const id = e.features?.[0]?.properties?.id
        const device = MOCK_SITE_DEVICES.find((d) => d.id === id)
        if (!device) return
        showPopup([device.lng, device.lat], devicePopupHTML(device))
      })

      // Geofence zone → live presence + cost popover (cost matches the timeline)
      m.on('click', 'geofence-fill', (e) => {
        // Don't hijack clicks that land on an asset/cluster — let the pin win so
        // assets inside a zone stay selectable.
        if (m.queryRenderedFeatures(e.point, { layers: ['unclustered-circle', 'clusters'] }).length) return
        const id = e.features?.[0]?.properties?.id
        const fence = geofences.find((g) => g.id === id)
        if (!fence) return
        const r = rangeRef.current
        const t = r === 'live' ? 1 : tRef.current
        showPopup(e.lngLat, presencePopupHTML(fence, geofencePresence(fence, assetsRef.current), r, t))
      })

      for (const layer of ['unclustered-circle', 'clusters', 'trail-heads', 'device-bg', 'device-icon', 'geofence-fill']) {
        m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = '' })
      }

      // Always frame the jobsite — fit to asset + device bounds
      const pts: [number, number][] = [
        ...assets.filter((a) => a.location).map((a) => [a.location!.lng, a.location!.lat] as [number, number]),
        ...MOCK_SITE_DEVICES.map((d) => [d.lng, d.lat] as [number, number]),
      ]
      if (pts.length > 0) {
        const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
        m.fitBounds(bounds, { padding: 70, maxZoom: 16, duration: 0 })
      }

      setMapReady(true)
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Update live asset source when assets or filter change
  useEffect(() => {
    if (!mapReady) return
    const source = map.current?.getSource('assets') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildGeoJSON(assets, filter))
  }, [mapReady, assets, filter])

  // Re-render geofences when the prop changes (e.g. a newly saved zone)
  useEffect(() => {
    if (!mapReady) return
    const source = map.current?.getSource('geofences') as maplibregl.GeoJSONSource | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: geofences.map((g) => ({
        type: 'Feature', geometry: g.geometry, properties: { id: g.id, name: g.name, color: g.color },
      })),
    })
    ;(map.current?.getSource('geofence-label-pts') as maplibregl.GeoJSONSource | undefined)?.setData(geofenceLabelPoints(geofences))
  }, [mapReady, geofences])

  // Show live pins vs trails vs heatmap based on the movement-display mode
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const set = (l: string, v: boolean) => m.getLayer(l) && m.setLayoutProperty(l, 'visibility', v ? 'visible' : 'none')
    LIVE_LAYERS.forEach((l) => set(l, trailMode === 'off'))
    set('trails-line', trailMode === 'trails')
    set('trails-heat', trailMode === 'heatmap')
    HEAD_LAYERS.forEach((l) => set(l, trailMode !== 'off'))
  }, [mapReady, trailMode])

  // Write movement geometry straight into the map sources. Called from the
  // RAF loop during playback (bypassing React) and from the effect below for
  // discrete changes (seek, filter, mode).
  const trailModeRef = useRef(trailMode)
  trailModeRef.current = trailMode
  const updateMovementSources = useCallback((t: number) => {
    const m = map.current
    const mode = trailModeRef.current
    if (mode === 'off' || !m) return
    ;(m.getSource('trail-heads') as maplibregl.GeoJSONSource | undefined)?.setData(headsGeoJSON(tracksRef.current, filterRef.current, t))
    if (mode === 'trails') {
      ;(m.getSource('trails') as maplibregl.GeoJSONSource | undefined)?.setData(trailsGeoJSON(tracksRef.current, filterRef.current, t))
    } else {
      ;(m.getSource('trail-points') as maplibregl.GeoJSONSource | undefined)?.setData(pointsGeoJSON(tracksRef.current, filterRef.current, t))
    }
  }, [])

  // Push trail/heat/head geometry on discrete changes (seek, filter, mode)
  useEffect(() => {
    if (!mapReady) return
    updateMovementSources(displayT)
  }, [mapReady, trailMode, displayT, filter, tracks, updateMovementSources])

  // Fetch weather frames + conditions once
  useEffect(() => {
    let cancelled = false
    fetchWeatherFrames().then((f) => { if (!cancelled) setWeatherFrames(f) })
    fetchConditions(DEMO_MAP_CENTER[1], DEMO_MAP_CENTER[0]).then((c) => { if (!cancelled) setConditions(c) })
    return () => { cancelled = true }
  }, [])

  // Change the weather location: geocode the name (free Open-Meteo geocoder),
  // refetch conditions for it, and fly the map there.
  const handlePlaceChange = useCallback(async (name: string) => {
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)
      const json = await res.json()
      const hit = json?.results?.[0]
      if (!hit) return
      const label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ')
      setWxPlace(label)
      fetchConditions(hit.latitude, hit.longitude).then((c) => setConditions(c))
      map.current?.flyTo({ center: [hit.longitude, hit.latitude], zoom: 12, duration: 1200 })
    } catch {
      /* ignore geocode failures */
    }
  }, [])

  // Switch basemap layers (dark / streets / satellite / hybrid / 3D) + camera tilt
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m?.getLayer('sat-base')) return
    const set = (id: string, on: boolean) => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    set('streets-base', base === 'streets')
    set('sat-base', base === 'satellite' || base === 'hybrid')
    set('labels-overlay', base === 'hybrid')
    set('buildings-3d', base === '3d')
    // Tilt for 3D, flatten otherwise.
    m.easeTo({ pitch: base === '3d' ? 55 : 0, duration: 600 })
  }, [mapReady, base])

  // Toggle visibility of all geofence layers at once
  useEffect(() => {
    const m = map.current
    if (!mapReady) return
    for (const id of ['geofence-fill', 'geofence-outline', 'geofence-labels']) {
      if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', showZones ? 'visible' : 'none')
    }
  }, [mapReady, showZones])

  // Add / update / toggle the rain-radar raster layer
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return

    if (!radarOn || !currentFrame || !weatherFrames) {
      if (wxAdded.current && m.getLayer('wx-layer')) m.setLayoutProperty('wx-layer', 'visibility', 'none')
      return
    }

    const url = weatherTileUrl(weatherFrames.host, currentFrame)
    if (!wxAdded.current) {
      m.addSource('wx', { type: 'raster', tiles: [url], tileSize: 256 })
      // Draw radar above the basemap but beneath geofences/assets
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      m.addLayer({ id: 'wx-layer', type: 'raster', source: 'wx', paint: { 'raster-opacity': 0.7 } }, beforeId)
      wxAdded.current = true
    } else {
      ;(m.getSource('wx') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
      m.setLayoutProperty('wx-layer', 'visibility', 'visible')
    }
  }, [mapReady, radarOn, currentFrame, weatherFrames])

  // Animation loop: map sources update every frame (smooth movement), but
  // React state — scrubber, labels, cost panel — only ~10Hz, so the whole
  // overlay tree isn't re-rendered 60 times a second.
  useEffect(() => {
    if (!pbPlaying) return
    let raf = 0
    let last = performance.now()
    let lastReact = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      let next = tRef.current + (dt * speedRef.current) / windowRef.current
      if (next >= 1) { next = 1; setPbPlaying(false) }
      tRef.current = next
      updateMovementSources(next)
      if (next >= 1 || now - lastReact > 100) {
        lastReact = now
        setPbT(next)
      }
      if (next < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pbPlaying, updateMovementSources])

  const handleRange = useCallback((r: TimeRange) => {
    setRange(r)
    if (r === 'live') {
      setPbPlaying(false)
    } else {
      tRef.current = 0
      setPbT(0)
      setPbSpeed(defaultSpeed(r)) // sensible multiplier for this range
      setPbPlaying(true) // auto-play the replay
      // give immediate visual feedback if no movement layer is on yet
      setTrailMode((prev) => (prev === 'off' ? 'trails' : prev))
    }
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
    const pts = drawCoords.current
    drawCoords.current = []
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
    if (pts.length < 3) return null
    return { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
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
    <div className={'relative w-full h-full bg-navy-950' + (kiosk ? ' kiosk-map' : '')}>
      <div ref={mapContainer} className="w-full h-full" />

      {!kiosk && <FilterBar filter={filter} onChange={setFilter} showZones={showZones} onToggleZones={() => setShowZones((v) => !v)} />}

      <WeatherControl
        base={base}
        onBase={setBase}
        radarOn={radarOn}
        onRadar={setRadarOn}
        conditions={conditions}
        frameTime={currentFrame ? frameLabel(currentFrame.time) : null}
        place={wxPlace}
        onPlaceChange={handlePlaceChange}
        top={kiosk ? 70 : 58}
      />


      {!kiosk && !pbActive && (
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
          range={range}
          onRange={handleRange}
          trailMode={trailMode}
          onTrailMode={setTrailMode}
          t={pbT}
          playing={pbPlaying}
          speed={pbSpeed}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onSpeed={setPbSpeed}
          customFrom={customFrom}
          customTo={customTo}
          onCustom={(from, to) => { setCustomFrom(from); setCustomTo(to) }}
          costTotal={costTotal}
          costLabel={costLabel}
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
