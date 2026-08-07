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
  //    0 = point A on the PHOTO, 1 = point A on the MAP,
  //    2 = point B on the PHOTO, 3 = point B on the MAP.
  // Precision model (Aug 6 rev 2): no direct tapping — pan/pinch the photo or
  // map UNDER a fixed center crosshair, then press "Set point". Thumb-taps
  // were too coarse zoomed out, and you couldn't zoom while picking.
  const [alignStage, setAlignStage] = useState<number | null>(null)
  const alignPts = useRef<{ img: [number, number][]; map: [number, number][] }>({ img: [], map: [] })
  const alignMarkers = useRef<maplibregl.Marker[]>([])
  const stageRef = useRef<number | null>(null)
  stageRef.current = alignStage
  // The photo pick surface is a PLAIN <img> under a CSS transform with our
  // own pan/pinch handlers — no WebGL. It started as a mini MapLibre
  // instance, but iPad WebKit composited it to nothing while swearing it had
  // painted ("photo 3000×2143 · painted" over a blank pane, Aug 7). An <img>
  // is the same rendering path as the thumbnails that work on every device.
  const photoEl = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  const tRef = useRef({ s: 1, tx: 0, ty: 0 })
  const panePtrs = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ d: number; s: number } | null>(null)
  const [paneImgUrl, setPaneImgUrl] = useState<string | null>(null)
  // Live diagnostic shown in the pane's corner — if the photo ever fails to
  // appear again, the stuck step names the culprit (and the badge existing at
  // all proves the device is running current code, not a stale tab).
  const [paneStatus, setPaneStatus] = useState('')

  const applyT = () => {
    const { s, tx, ty } = tRef.current
    if (viewRef.current) viewRef.current.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
    // The A badge lives in image space — inverse-scale it so it stays 22px.
    if (badgeRef.current) badgeRef.current.style.transform = `translate(-50%, -50%) scale(${1 / s})`
  }

  /** Fit + center the photo in the pane once its pixels are known. */
  const initPaneFit = () => {
    const pane = photoEl.current, img = imgRef.current
    if (!pane || !img || !img.naturalWidth) return
    natural.current = { w: img.naturalWidth, h: img.naturalHeight }
    setAspect(img.naturalHeight / img.naturalWidth)
    const s = Math.min(pane.clientWidth / img.naturalWidth, pane.clientHeight / img.naturalHeight) * 0.96
    tRef.current = { s, tx: (pane.clientWidth - img.naturalWidth * s) / 2, ty: (pane.clientHeight - img.naturalHeight * s) / 2 }
    applyT()
    setPaneStatus(`photo ${img.naturalWidth}×${img.naturalHeight} · shown`)
  }

  const zoomPaneAt = (mx: number, my: number, ns: number) => {
    const t = tRef.current
    const clamped = Math.min(12, Math.max(0.02, ns))
    t.tx = mx - ((mx - t.tx) / t.s) * clamped
    t.ty = my - ((my - t.ty) / t.s) * clamped
    t.s = clamped
    applyT()
  }

  const onPanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    panePtrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (panePtrs.current.size === 2) {
      const [a, b] = Array.from(panePtrs.current.values())
      pinchRef.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: tRef.current.s }
    }
  }
  const onPanePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = panePtrs.current.get(e.pointerId)
    if (!prev) return
    const np = { x: e.clientX, y: e.clientY }
    panePtrs.current.set(e.pointerId, np)
    if (panePtrs.current.size === 1) {
      tRef.current.tx += np.x - prev.x
      tRef.current.ty += np.y - prev.y
      applyT()
    } else if (panePtrs.current.size === 2 && pinchRef.current && photoEl.current) {
      const [a, b] = Array.from(panePtrs.current.values())
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < 1) return
      const rect = photoEl.current.getBoundingClientRect()
      zoomPaneAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, pinchRef.current.s * (d / pinchRef.current.d))
    }
  }
  const onPanePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    panePtrs.current.delete(e.pointerId)
    pinchRef.current = null
  }
  const onPaneWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!photoEl.current) return
    const rect = photoEl.current.getBoundingClientRect()
    zoomPaneAt(e.clientX - rect.left, e.clientY - rect.top, tRef.current.s * Math.exp(-e.deltaY * 0.002))
  }

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

  // Photo pick surface loader — runs when a photo stage opens, torn down
  // with the align flow. The blob is fetched here (not left to the <img>
  // tag) so a poisoned no-CORS cache entry or a transient miss gets a forced
  // network retry, and a hard failure surfaces as a visible error instead of
  // a navy void.
  useEffect(() => {
    if (alignStage !== 0 && alignStage !== 2) return
    let dead = false
    let objUrl: string | null = null
    ;(async () => {
      try {
        setPaneStatus('loading photo…')
        let res = await fetch(imageUrl, { mode: 'cors' }).catch(() => null)
        if (!res || !res.ok) {
          // Poisoned-cache or transient miss — force a fresh network hit.
          res = await fetch(imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'nocache=1', { mode: 'cors', cache: 'reload' })
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (dead) return
        objUrl = URL.createObjectURL(blob)
        setPaneImgUrl(objUrl) // <img onLoad={initPaneFit}> takes it from here
      } catch {
        if (!dead) {
          setPaneStatus('load failed')
          setError('The image couldn’t load for point-picking — check signal and try again, or line it up with the sliders.')
        }
      }
    })()
    return () => {
      dead = true
      setPaneImgUrl(null)
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignStage, imageUrl])

  // "Set point" — reads whichever surface the stage is on at its crosshair.
  const setAlignPoint = () => {
    const st = stageRef.current
    if (st === 0 || st === 2) {
      const pane = photoEl.current
      if (!pane || !paneImgUrl) return
      // Whatever image pixel sits under the fixed center crosshair.
      const { s, tx, ty } = tRef.current
      const { w, h } = natural.current
      const px = Math.max(0, Math.min(w, (pane.clientWidth / 2 - tx) / s))
      const py = Math.max(0, Math.min(h, (pane.clientHeight / 2 - ty) / s))
      alignPts.current.img.push([px, py])
      setAlignStage(st === 0 ? 1 : 3)
    } else if (st === 1 || st === 3) {
      const m = mapRef.current
      if (!m) return
      const c = m.getCenter()
      alignPts.current.map.push([c.lng, c.lat])
      const el = document.createElement('div')
      const label = st === 1 ? 'A' : 'B'
      const color = st === 1 ? '#ff9e16' : '#2dd4bf'
      el.innerHTML = `<div style="width:22px;height:22px;border-radius:50%;background:${color};color:#001523;font:800 12px system-ui;display:grid;place-items:center;border:2px solid #001523;box-shadow:0 0 0 2px ${color}55">${label}</div>`
      const mk = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(m)
      alignMarkers.current.push(mk)
      if (st === 1) setAlignStage(2)
      else finishAlign()
    }
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
          <div ref={mapEl} className="h-[300px] md:h-[380px] w-full" style={alignStage === 1 || alignStage === 3 ? { cursor: 'crosshair' } : undefined} />
          {/* Crosshair — the photo is pinned here; pan the map to move it. */}
          {alignStage === null && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-amber text-lg leading-none select-none">+</div>
          )}

          {/* ── 2-point align: photo pick surface (own pan/zoom engine) ── */}
          {/* z-10 keeps the placer map's zoom buttons from bleeding through */}
          {(alignStage === 0 || alignStage === 2) && (
            <div
              ref={photoEl}
              className="absolute inset-0 z-10 overflow-hidden bg-navy-950 touch-none cursor-grab"
              onPointerDown={onPanePointerDown}
              onPointerMove={onPanePointerMove}
              onPointerUp={onPanePointerEnd}
              onPointerCancel={onPanePointerEnd}
              onWheel={onPaneWheel}
            >
              <div ref={viewRef} className="absolute left-0 top-0 origin-top-left will-change-transform">
                {paneImgUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    ref={imgRef} src={paneImgUrl} alt="" draggable={false}
                    onLoad={initPaneFit}
                    className="block max-w-none select-none pointer-events-none"
                  />
                )}
                {/* Point A stays visible in image space while picking B */}
                {alignStage === 2 && alignPts.current.img[0] && (
                  <div
                    ref={badgeRef}
                    className="absolute"
                    style={{ left: alignPts.current.img[0][0], top: alignPts.current.img[0][1], transform: 'translate(-50%, -50%)' }}
                  >
                    <div className="grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-[#001523] bg-amber text-[12px] font-extrabold text-[#001523]">A</div>
                  </div>
                )}
              </div>
              <span className="absolute bottom-1.5 left-2 z-20 font-mono text-[9px] text-faint/80 pointer-events-none select-none">{paneStatus}</span>
            </div>
          )}

          {/* Fixed center crosshair during every pick stage — pan/pinch the
              surface under it, then press Set. Big thin lines beat a thumb. */}
          {alignStage !== null && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
              {(() => {
                const c = alignStage < 2 ? '#ff9e16' : '#2dd4bf'
                return (
                  <span className="relative block w-[46px] h-[46px]">
                    <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2" style={{ background: c }} />
                    <span className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2" style={{ background: c }} />
                    <span className="absolute left-1/2 top-1/2 w-[10px] h-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ borderColor: c }} />
                  </span>
                )
              })()}
            </div>
          )}

          {/* Set-point button — the precise commit, instead of a thumb tap. */}
          {alignStage !== null && (
            <button
              type="button"
              onClick={setAlignPoint}
              className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-xl px-4 py-2.5 text-[13px] font-display font-bold text-[#001523] shadow-panel"
              style={{ backgroundColor: alignStage < 2 ? '#ff9e16' : '#2dd4bf' }}
            >
              ✓ Set point {alignStage < 2 ? 'A' : 'B'} here
            </button>
          )}

          {/* Step banner — screams which surface you're picking on. */}
          {alignStage !== null && (
            <div className={
              'absolute top-2 left-2 right-2 z-20 rounded-lg px-3 py-2 text-[12px] font-bold text-center border ' +
              (alignStage === 0 || alignStage === 2
                ? 'bg-navy-900/95 border-amber/60 text-amber'
                : 'bg-navy-900/95 border-teal/60 text-teal')
            }>
              {alignStage === 0 && <>Point <span className="text-[#ff9e16]">A</span> · 1 of 4 — ON THE PHOTO: pinch/pan a landmark under the crosshair</>}
              {alignStage === 1 && <>Point <span className="text-[#ff9e16]">A</span> · 2 of 4 — ON THE MAP: center that SAME spot under the crosshair</>}
              {alignStage === 2 && <>Point <span className="text-[#2dd4bf]">B</span> · 3 of 4 — ON THE PHOTO: a second landmark, far from A</>}
              {alignStage === 3 && <>Point <span className="text-[#2dd4bf]">B</span> · 4 of 4 — ON THE MAP: center that SAME spot</>}
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
