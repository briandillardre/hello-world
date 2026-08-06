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

/**
 * Two-point similarity transform (Tier B alignment): the user marks the SAME
 * two real-world spots on the photo and on the basemap; scale + rotation +
 * position all fall out. Pixel y grows downward, so it's flipped into the
 * ENU frame (y = north) before solving. Returns null for degenerate picks
 * (two image points nearly on top of each other).
 */
function twoPointCorners(
  imgPts: [[number, number], [number, number]],
  mapPts: [[number, number], [number, number]],
  imgW: number,
  imgH: number
): Corners | null {
  const lat0 = mapPts[0][1]
  const kLng = mPerDegLng(lat0), kLat = M_PER_DEG_LAT
  const m2: [number, number] = [(mapPts[1][0] - mapPts[0][0]) * kLng, (mapPts[1][1] - mapPts[0][1]) * kLat]
  const [p1, p2] = imgPts
  const dpx = p2[0] - p1[0], dpy = -(p2[1] - p1[1]) // pixel y down → ENU y up
  const dLen = Math.hypot(dpx, dpy)
  if (dLen < 8) return null
  const s = Math.hypot(m2[0], m2[1]) / dLen
  if (!Number.isFinite(s) || s <= 0) return null
  const phi = Math.atan2(m2[1], m2[0]) - Math.atan2(dpy, dpx)
  const cos = Math.cos(phi), sin = Math.sin(phi)
  const mapOf = ([x, y]: [number, number]): Corner => {
    const vx = (x - p1[0]) * s, vy = -(y - p1[1]) * s
    const rx = vx * cos - vy * sin, ry = vx * sin + vy * cos
    return [mapPts[0][0] + rx / kLng, mapPts[0][1] + ry / kLat]
  }
  return [mapOf([0, 0]), mapOf([imgW, 0]), mapOf([imgW, imgH]), mapOf([0, imgH])]
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
  const natural = useRef({ w: 4000, h: 3000 })

  // ── 2-point alignment (owner ask, Aug 6): stages 0..3 —
  //    0 = tap point A on the PHOTO, 1 = tap point A on the MAP,
  //    2 = tap point B on the PHOTO, 3 = tap point B on the MAP.
  const [alignStage, setAlignStage] = useState<number | null>(null)
  const alignPts = useRef<{ img: [number, number][]; map: [number, number][] }>({ img: [], map: [] })
  const alignMarkers = useRef<maplibregl.Marker[]>([])
  const stageRef = useRef<number | null>(null)
  stageRef.current = alignStage

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth > 0) {
        natural.current = { w: img.naturalWidth, h: img.naturalHeight }
        setAspect(img.naturalHeight / img.naturalWidth)
      }
    }
    img.src = imageUrl
  }, [imageUrl])

  const clearAlign = (m?: maplibregl.Map | null) => {
    for (const mk of alignMarkers.current) mk.remove()
    alignMarkers.current = []
    alignPts.current = { img: [], map: [] }
    setAlignStage(null)
    const mm = m ?? mapRef.current
    if (mm?.getLayer('place-layer')) mm.setLayoutProperty('place-layer', 'visibility', 'visible')
  }

  const startAlign = () => {
    alignPts.current = { img: [], map: [] }
    setAlignStage(0)
    // Hide the crosshair-riding photo while picking — it just distracts.
    const m = mapRef.current
    if (m?.getLayer('place-layer')) m.setLayoutProperty('place-layer', 'visibility', 'none')
  }

  const finishAlign = () => {
    const m = mapRef.current
    const { img, map: mp } = alignPts.current
    if (!m || img.length < 2 || mp.length < 2) { clearAlign(); return }
    const corners = twoPointCorners(
      [img[0], img[1]] as [[number, number], [number, number]],
      [mp[0], mp[1]] as [[number, number], [number, number]],
      natural.current.w, natural.current.h
    )
    clearAlign(m)
    if (!corners) { setError('Those two photo points are too close together — pick spots farther apart.'); return }
    setError(null)
    const p = paramsFrom(corners)
    setWidthM(p.widthM)
    setRotDeg(Math.round(p.rotDeg))
    m.jumpTo({ center: p.center })
    // The image rides the map center, so re-pin with the solved params now.
    const src = m.getSource('place') as maplibregl.ImageSource | undefined
    src?.setCoordinates(cornersFrom(p.center, p.widthM, live.current.aspect, p.rotDeg))
  }

  // Map-side picks (stages 1 and 3). The listener is bound once in the map
  // init effect and dispatches through this ref so it always sees the
  // current stage + handlers.
  const onAlignMapClickRef = useRef<((e: maplibregl.MapMouseEvent) => void) | null>(null)
  onAlignMapClickRef.current = (e) => {
    const m = mapRef.current
    const st = stageRef.current
    if (!m || (st !== 1 && st !== 3)) return
    alignPts.current.map.push([e.lngLat.lng, e.lngLat.lat])
    const el = document.createElement('div')
    const label = st === 1 ? 'A' : 'B'
    const color = st === 1 ? '#ff9e16' : '#2dd4bf'
    el.innerHTML = `<div style="width:22px;height:22px;border-radius:50%;background:${color};color:#001523;font:800 12px system-ui;display:grid;place-items:center;border:2px solid #001523;box-shadow:0 0 0 2px ${color}55">${label}</div>`
    const mk = new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(m)
    alignMarkers.current.push(mk)
    if (st === 1) setAlignStage(2)
    else finishAlign()
  }

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
    m.on('click', (e) => onAlignMapClickRef.current?.(e))
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
          <div ref={mapEl} className="h-[300px] md:h-[380px] w-full" style={alignStage === 1 || alignStage === 3 ? { cursor: 'crosshair' } : undefined} />
          {/* Crosshair — the photo is pinned here; pan the map to move it. */}
          {alignStage === null && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-amber text-lg leading-none select-none">+</div>
          )}

          {/* ── 2-point align: photo pane covers the map during image picks ── */}
          {(alignStage === 0 || alignStage === 2) && (
            <div className="absolute inset-0 bg-navy-950/95 flex items-center justify-center p-2">
              <div className="relative max-w-full max-h-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="Pick an alignment point"
                  className="max-w-full max-h-[292px] md:max-h-[372px] block cursor-crosshair select-none"
                  draggable={false}
                  onClick={(e) => {
                    const el = e.currentTarget
                    const r = el.getBoundingClientRect()
                    const px = ((e.clientX - r.left) / r.width) * natural.current.w
                    const py = ((e.clientY - r.top) / r.height) * natural.current.h
                    alignPts.current.img.push([px, py])
                    setAlignStage((s) => (s === 0 ? 1 : 3))
                  }}
                />
                {/* already-picked photo point(s), shown at their spot */}
                {alignPts.current.img.map(([x, y], i) => (
                  <span
                    key={i}
                    className="absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center w-[22px] h-[22px] rounded-full text-[12px] font-extrabold text-navy-950 border-2 border-navy-950"
                    style={{
                      left: `${(x / natural.current.w) * 100}%`,
                      top: `${(y / natural.current.h) * 100}%`,
                      backgroundColor: i === 0 ? '#ff9e16' : '#2dd4bf',
                    }}
                  >{i === 0 ? 'A' : 'B'}</span>
                ))}
              </div>
            </div>
          )}

          {/* Step banner — screams which surface you're picking on. */}
          {alignStage !== null && (
            <div className={
              'absolute top-2 left-2 right-2 rounded-lg px-3 py-2 text-[12px] font-bold text-center border ' +
              (alignStage === 0 || alignStage === 2
                ? 'bg-navy-900/95 border-amber/60 text-amber'
                : 'bg-navy-900/95 border-teal/60 text-teal')
            }>
              {alignStage === 0 && <>Point <span className="text-[#ff9e16]">A</span> · 1 of 4 — tap a recognizable spot ON THE PHOTO</>}
              {alignStage === 1 && <>Point <span className="text-[#ff9e16]">A</span> · 2 of 4 — now tap that SAME SPOT on the map</>}
              {alignStage === 2 && <>Point <span className="text-[#2dd4bf]">B</span> · 3 of 4 — tap a SECOND spot ON THE PHOTO (far from A)</>}
              {alignStage === 3 && <>Point <span className="text-[#2dd4bf]">B</span> · 4 of 4 — tap that SAME SPOT on the map</>}
              <button
                type="button"
                onClick={() => clearAlign()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint hover:text-ink"
              >cancel</button>
            </div>
          )}
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
          {alignStage === null && (
            <button
              type="button"
              onClick={startAlign}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-teal/60 text-teal text-[11.5px] font-semibold px-2 py-1.5 hover:bg-teal/10 transition-colors"
            >
              ⌖ Align by 2 points — tap the same two spots on the photo and the map
            </button>
          )}
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
