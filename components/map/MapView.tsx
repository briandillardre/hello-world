'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AssetWithLocation, AssetType, Geofence } from '@/lib/types'
import { DEMO_MAP_CENTER, DEMO_MAP_ZOOM } from '@/lib/mock-data'
import { AssetPanel } from './AssetPanel'
import { FilterBar } from './FilterBar'
import { GeofenceDrawer } from './GeofenceDrawer'

const ASSET_COLORS: Record<AssetType, string> = {
  vehicle: '#F59E0B',
  equipment: '#3B82F6',
  personnel: '#10B981',
  tool: '#8B5CF6',
}


function buildGeoJSON(assets: AssetWithLocation[], filter: Set<AssetType>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: assets
      .filter(a => filter.has(a.type) && a.location)
      .map(a => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [a.location!.lng, a.location!.lat],
        },
        properties: {
          id: a.id,
          name: a.name,
          type: a.type,
          color: ASSET_COLORS[a.type],
          battery: a.location!.battery,
          speed: a.location!.speed,
          timestamp: a.location!.timestamp,
        },
      })),
  }
}

interface MapViewProps {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  toolGateways?: Record<string, { name: string; lastSeen: string }>
  onGeofenceSave?: (name: string, geometry: GeoJSON.Polygon, color: string) => void
}

export function MapView({ assets, geofences, toolGateways, onGeofenceSave }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<AssetWithLocation | null>(null)
  const [filter, setFilter] = useState<Set<AssetType>>(new Set<AssetType>(['vehicle', 'equipment', 'personnel', 'tool']))
  const [isDrawing, setIsDrawing] = useState(false)
  const drawCoords = useRef<[number, number][]>([])
  const drawPreviewSource = useRef<string>('draw-preview')

  const tileKey = process.env.NEXT_PUBLIC_MAPTILER_KEY
  const mapStyle = (tileKey && tileKey !== 'YOUR_MAPTILER_KEY')
    ? `https://api.maptiler.com/maps/streets/style.json?key=${tileKey}`
    : {
        version: 8 as const,
        sources: {
          'carto-voyager': {
            type: 'raster' as const,
            tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
          },
        },
        layers: [{ id: 'carto-base', type: 'raster' as const, source: 'carto-voyager' }],
      }

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

      // Asset cluster source
      m.addSource('assets', {
        type: 'geojson',
        data: buildGeoJSON(assets, filter),
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 40,
      })

      // Cluster circles
      m.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'assets',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#0F172A',
          'circle-radius': ['step', ['get', 'point_count'], 20, 5, 26, 20, 32],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#F59E0B',
        },
      })

      m.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'assets',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 13,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#F59E0B' },
      })

      // Individual asset circles
      m.addLayer({
        id: 'unclustered-circle',
        type: 'circle',
        source: 'assets',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 14,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Asset type emoji labels
      m.addLayer({
        id: 'unclustered-label',
        type: 'symbol',
        source: 'assets',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': [
            'match', ['get', 'type'],
            'vehicle', '🚛', 'equipment', '🏗️', 'personnel', '👷', 'tool', '🔧', '📍',
          ],
          'text-size': 14,
          'text-allow-overlap': true,
        },
      })

      // Geofence layers
      m.addSource('geofences', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: geofences.map(g => ({
            type: 'Feature',
            geometry: g.geometry,
            properties: { id: g.id, name: g.name, color: g.color },
          })),
        },
      })

      m.addLayer({
        id: 'geofence-fill',
        type: 'fill',
        source: 'geofences',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.12,
        },
      }, 'clusters')

      m.addLayer({
        id: 'geofence-outline',
        type: 'line',
        source: 'geofences',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-dasharray': [3, 2],
        },
      }, 'clusters')

      m.addLayer({
        id: 'geofence-labels',
        type: 'symbol',
        source: 'geofences',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-font': ['Open Sans SemiBold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#0F172A', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      }, 'clusters')

      // Draw preview source
      m.addSource(drawPreviewSource.current, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      m.addLayer({
        id: 'draw-fill',
        type: 'fill',
        source: drawPreviewSource.current,
        paint: { 'fill-color': '#F59E0B', 'fill-opacity': 0.15 },
      })
      m.addLayer({
        id: 'draw-line',
        type: 'line',
        source: drawPreviewSource.current,
        paint: { 'line-color': '#F59E0B', 'line-width': 2 },
      })

      // Click handlers
      m.on('click', 'unclustered-circle', (e) => {
        const props = e.features?.[0]?.properties
        if (!props) return
        const asset = assets.find(a => a.id === props.id)
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

      m.on('mouseenter', 'unclustered-circle', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'unclustered-circle', () => { m.getCanvas().style.cursor = '' })
      m.on('mouseenter', 'clusters', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'clusters', () => { m.getCanvas().style.cursor = '' })
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update asset source when assets or filter changes
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    const source = map.current.getSource('assets') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildGeoJSON(assets, filter))
  }, [assets, filter])

  // Drawing mode click handler
  const handleDrawClick = useCallback((e: maplibregl.MapMouseEvent) => {
    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    drawCoords.current.push(coords)
    const pts = drawCoords.current

    if (!map.current) return
    const preview: GeoJSON.FeatureCollection = pts.length >= 3
      ? {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[...pts, pts[0]]],
            },
            properties: {},
          }],
        }
      : {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: pts },
            properties: {},
          }],
        }
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
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      <FilterBar filter={filter} onChange={setFilter} />

      <GeofenceDrawer
        isDrawing={isDrawing}
        onStartDraw={startDrawing}
        onFinishDraw={finishDrawing}
        onCancelDraw={cancelDrawing}
        onSave={onGeofenceSave}
      />

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
