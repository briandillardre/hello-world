'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * Minimal HammerTrack-style map: free basemaps (CARTO dark / Esri satellite),
 * a live weather-radar toggle (Iowa Environmental Mesonet tiles, free), and
 * the standard nav/locate controls. Everything here costs $0/mo in keys.
 */

const BASEMAPS = {
  dark: {
    label: 'Dark',
    tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', 'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
    attribution: '© OpenStreetMap contributors © CARTO',
  },
  satellite: {
    label: 'Satellite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, Maxar, Earthstar Geographics',
  },
} as const

type BaseKey = keyof typeof BASEMAPS

const RADAR_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'

function styleFor(base: BaseKey): maplibregl.StyleSpecification {
  const b = BASEMAPS[base]
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [...b.tiles], tileSize: 256, attribution: b.attribution } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#001523' } },
      { id: 'base', type: 'raster', source: 'base' },
    ],
  }
}

export function MapShell() {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [base, setBase] = useState<BaseKey>('dark')
  const [radar, setRadar] = useState(false)

  useEffect(() => {
    if (!el.current || map.current) return
    map.current = new maplibregl.Map({
      container: el.current,
      style: styleFor('dark'),
      center: [-82.4, 34.85], // Greenville, SC — change me
      zoom: 9,
      attributionControl: { compact: true },
    })
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    map.current.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
    return () => { map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    m.setStyle(styleFor(base))
    // Style swap wipes custom layers — re-add radar after the new style loads.
    if (radar) m.once('styledata', () => addRadar(m))
  }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (radar) addRadar(m)
    else {
      if (m.getLayer('radar')) m.removeLayer('radar')
      if (m.getSource('radar')) m.removeSource('radar')
    }
  }, [radar])

  function addRadar(m: maplibregl.Map) {
    if (m.getSource('radar')) return
    m.addSource('radar', { type: 'raster', tiles: [RADAR_TILES], tileSize: 256, attribution: 'IEM NEXRAD' })
    m.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.72 } })
  }

  return (
    <div className="relative h-screen w-full">
      <div ref={el} className="absolute inset-0" />
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        {(Object.keys(BASEMAPS) as BaseKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setBase(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${base === k ? 'bg-amber text-[#1a1100] border-amber' : 'bg-navy-900/90 text-muted border-navy-700'}`}
          >
            {BASEMAPS[k].label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRadar((r) => !r)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${radar ? 'bg-amber text-[#1a1100] border-amber' : 'bg-navy-900/90 text-muted border-navy-700'}`}
        >
          Radar
        </button>
      </div>
    </div>
  )
}
