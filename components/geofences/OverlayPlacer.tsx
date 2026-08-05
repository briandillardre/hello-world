'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { X } from 'lucide-react'
import { saveOverlayBoundsAction } from '@/lib/actions/imagery'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

type Corner = [number, number]
export type Corners = [Corner, Corner, Corner, Corner]

// Meters per degree at a latitude — close enough for a few-hundred-meter photo.
const M_PER_DEG_LAT = 110_540
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

/** Ground corners [[TL],[TR],[BR],[BL]] from center + width(m) + aspect + clockwise rotation. */
function cornersFrom(center: [number, number], widthM: number, aspect: number, rotDeg: number): Corners {
  const halfW = widthM / 2
  const halfH = (widthM * aspect) / 2
  const phi = (rotDeg * Math.PI) / 180
  const cos = Math.cos(phi), sin = Math.sin(phi)
  const local: Corner[] = [[-halfW, halfH], [halfW, halfH], [halfW, -halfH], [-halfW, -halfH]]
  const kLng = mPerDegLng(center[1]), kLat = M_PER_DEG_LAT
  return local.map(([x, y]) => {
    const rx = x * cos + y * sin   // clockwise (compass-style) rotation
    const ry = -x * sin + y * cos
    return [center[0] + rx / kLng, center[1] + ry / kLat] as Corner
  }) as Corners
}

/** Inverse of cornersFrom — recover center/width/rotation from saved corners. */
function paramsFrom(c: Corners) {
  const center: [number, number] = [
    (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4,
    (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4,
  ]
  const kLng = mPerDegLng(center[1])
  const dx = (c[1][0] - c[0][0]) * kLng
  const dy = (c[1][1] - c[0][1]) * M_PER_DEG_LAT
  return { center, widthM: Math.hypot(dx, dy) || 120, rotDeg: (Math.atan2(-dy, dx) * 180) / Math.PI }
}

/**
 * "Place on map" — pin a drone shot to the ground. The photo stays glued to
 * the mini-map's center: pan the map to position it, sliders set size and
 * rotation, the opacity slider lets you line fences/roads up against the
 * satellite base. Save writes the 4 ground corners (053) and the shot appears
 * on /map under the Site imagery layer.
 */
export function OverlayPlacer({ zoneId, imageId, imageUrl, ring, initialBounds, hint = null, onClose, onSaved }: {
  zoneId: string
  imageId: string
  imageUrl: string
  /** Zone ring for reference + initial framing. */
  ring: Corner[] | null
  initialBounds: Corners | null
  /** One-line context above the instructions (e.g. smart-placement notice). */
  hint?: string | null
  onClose: () => void
  onSaved: (bounds: Corners | null) => void
}) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [aspect, setAspect] = useState(0.75) // h/w until the real image loads
  const init = initialBounds ? paramsFrom(initialBounds) : null
  const [widthM, setWidthM] = useState(init?.widthM ?? 150)
  const [rotDeg, setRotDeg] = useState(Math.round(init?.rotDeg ?? 0))
  const [opacity, setOpacity] = useState(0.85)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Live values for map-event callbacks without re-subscribing.
  const live = useRef({ widthM, rotDeg, aspect })
  live.current = { widthM, rotDeg, aspect }

  useEffect(() => {
    const img = new Image()
    img.onload = () => { if (img.naturalWidth > 0) setAspect(img.naturalHeight / img.naturalWidth) }
    img.src = imageUrl
  }, [imageUrl])

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const ringCenter: [number, number] = ring?.length
      ? [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
      : [-82.4, 34.85]
    const startCenter = init?.center ?? ringCenter
    const m = new maplibregl.Map({
      container: mapEl.current,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar' } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      center: startCenter,
      zoom: 16.5,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    m.on('load', () => {
      if (ring && ring.length >= 3) {
        m.addSource('zone', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, properties: {} } })
        m.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#ff9e16', 'line-width': 2, 'line-dasharray': [2, 2] } })
      }
      const c = m.getCenter()
      m.addSource('place', { type: 'image', url: imageUrl, coordinates: cornersFrom([c.lng, c.lat], live.current.widthM, live.current.aspect, live.current.rotDeg) })
      m.addLayer({ id: 'place-layer', type: 'raster', source: 'place', paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
        m.getLayer('zone-line') ? 'zone-line' : undefined)
      // If re-placing, frame what's already there; else frame the zone.
      if (init) m.setCenter(init.center)
      else if (ring && ring.length >= 3) {
        const b = ring.reduce((bb, p) => bb.extend(p as [number, number]), new maplibregl.LngLatBounds(ring[0], ring[0]))
        m.fitBounds(b, { padding: 60, duration: 0, maxZoom: 18 })
      }
    })
    // The image rides the crosshair: every pan re-pins it to map center.
    m.on('move', () => {
      const src = m.getSource('place') as maplibregl.ImageSource | undefined
      if (!src) return
      const c = m.getCenter()
      src.setCoordinates(cornersFrom([c.lng, c.lat], live.current.widthM, live.current.aspect, live.current.rotDeg))
    })
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sliders → live re-pin (same math as the move handler).
  useEffect(() => {
    const m = mapRef.current
    const src = m?.getSource('place') as maplibregl.ImageSource | undefined
    if (!m || !src) return
    const c = m.getCenter()
    src.setCoordinates(cornersFrom([c.lng, c.lat], widthM, aspect, rotDeg))
  }, [widthM, rotDeg, aspect])
  useEffect(() => {
    const m = mapRef.current
    if (m?.getLayer('place-layer')) m.setPaintProperty('place-layer', 'raster-opacity', opacity)
  }, [opacity])

  async function save() {
    const m = mapRef.current
    if (!m) return
    setBusy(true); setError(null)
    const c = m.getCenter()
    const bounds = cornersFrom([c.lng, c.lat], widthM, aspect, rotDeg)
    const r = await saveOverlayBoundsAction(zoneId, imageId, bounds)
    setBusy(false)
    if (r.ok) onSaved(bounds)
    else setError(r.error ?? 'Save failed')
  }

  async function removePlacement() {
    setBusy(true); setError(null)
    const r = await saveOverlayBoundsAction(zoneId, imageId, null)
    setBusy(false)
    if (r.ok) onSaved(null)
    else setError(r.error ?? 'Save failed')
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-2xl rounded-2xl border border-navy-700 bg-navy-950 shadow-panel overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-navy-800">
          <p className="font-display font-bold text-ink text-sm flex-1">Place on map</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border border-navy-700 p-1 text-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative">
          <div ref={mapEl} className="h-[300px] md:h-[380px] w-full" />
          {/* Crosshair — the photo is pinned here; pan the map to move it. */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-amber text-lg leading-none select-none">+</div>
        </div>
        <div className="p-4 space-y-3">
          {hint && <p className="text-[11.5px] font-semibold text-teal">{hint}</p>}
          <p className="text-[11.5px] text-faint">
            Drag the map until the photo sits over the site, then size and rotate it until
            fences and roads line up with the satellite view underneath.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-[11px] text-muted">
              Size <span className="text-faint">· {widthM >= 1000 ? `${(widthM / 1000).toFixed(1)} km` : `${Math.round(widthM)} m`} wide</span>
              <input type="range" min={0} max={100} value={Math.round(Math.log(widthM / 20) / Math.log(3000 / 20) * 100)}
                onChange={(e) => setWidthM(20 * Math.pow(3000 / 20, Number(e.target.value) / 100))}
                className="w-full accent-amber" aria-label="Photo width" />
            </label>
            <label className="text-[11px] text-muted">
              Rotate <span className="text-faint">· {rotDeg}°</span>
              <input type="range" min={-180} max={180} value={rotDeg}
                onChange={(e) => setRotDeg(Number(e.target.value))}
                className="w-full accent-amber" aria-label="Photo rotation" />
            </label>
            <label className="text-[11px] text-muted">
              See-through <span className="text-faint">· {Math.round(opacity * 100)}%</span>
              <input type="range" min={20} max={100} value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                className="w-full accent-amber" aria-label="Photo opacity" />
            </label>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={save}
              className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3.5 py-2 disabled:opacity-40">
              {busy ? 'Saving…' : 'Save placement'}
            </button>
            {initialBounds && (
              <button type="button" disabled={busy} onClick={removePlacement}
                className="rounded-lg border border-navy-700 text-muted hover:text-red-400 text-xs px-3 py-2 disabled:opacity-40">
                Remove from map
              </button>
            )}
            <button type="button" onClick={onClose} className="ml-auto text-xs text-faint hover:text-ink">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}
