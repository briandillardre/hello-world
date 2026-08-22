'use client'

import { useEffect, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { Ruler, MapPin, Spline, Hexagon, Undo2, Check, Trash2, X, Globe, Lock, Box } from 'lucide-react'
import {
  toStatePlaneSC, polylineLengthFt, polygonAreaSqFt, lengthIn, areaIn, takeoff,
  LENGTH_LABEL, AREA_LABEL, MATERIALS, fmt, type LengthUnit, type AreaUnit,
} from '@/lib/measure'
import { saveMeasurementAction, updateMeasurementAction } from '@/lib/actions/measurements'

type Mode = 'point' | 'line' | 'area'
const M_TO_FT = 3.280839895

const DRAFT_SRC = 'measure-draft'

/**
 * Map measure + takeoff tool. Point (live northing/easting/elevation), line
 * (length), area (SF/SY/acre) — with a material×depth takeoff that returns
 * cubic yards and tonnage, and an optional 3D extrusion to see the lift.
 * Saves to the company (global) or just you (personal).
 *
 * Two layouts: md+ keeps the side card; phones get a slim top strip with the
 * readout + a bottom save sheet, so the MAP stays visible while measuring
 * (Brian's Fields-app reference, Jul 18). Per-segment lengths label the edges
 * directly on the map in both layouts.
 */
export interface SavedMeasureLite {
  id: string
  name: string
  kind: Mode
  personal: boolean
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon
  props: import('@/lib/db/measurements').MeasureProps
}

export function MeasureTool({
  map, active, onClose, onSaved, terrainOn, initial = null,
}: {
  map: maplibregl.Map | null
  active: boolean
  onClose: () => void
  onSaved: (saved?: SavedMeasureLite) => void
  /** True when the DEM terrain is on — enables the live elevation readout. */
  terrainOn: boolean
  /** Editing an EXISTING measurement (tap-to-edit from the saved layer):
   *  loads its shape into the tool and Save becomes an update-in-place. */
  initial?: { id: string; name: string; kind: Mode; personal: boolean; coords: [number, number][] } | null
}) {
  const [mode, setMode] = useState<Mode>('area')
  const [pts, setPts] = useState<[number, number][]>([])
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [elev, setElev] = useState<number | null>(null)
  // Finished shape: clicks stop adding, the rubber-band stops following.
  // PC double-clicks to finish; phone taps the ✓ (owner ask, Jul 22).
  const [done, setDone] = useState(false)
  const doneRef = useRef(false)
  doneRef.current = done
  // Approximate elevation of the DROPPED point — free DEM lookup (~90m grid),
  // so it works without the heavy 3D terrain turned on (owner ask, Jul 22).
  const [clickElev, setClickElev] = useState<number | null>(null)
  const [lenUnit, setLenUnit] = useState<LengthUnit>('ft')
  const [areaUnit, setAreaUnit] = useState<AreaUnit>('sf')
  // Auto-promote ft/yd → miles once the shape is highway-scale ("4,077,654.1
  // ft" — Brian, Aug 23). A hand-picked unit always wins; the auto-step only
  // runs while the user hasn't touched the unit buttons, and steps back down
  // when the shape shrinks again.
  const unitTouched = useRef(false)
  const autoMi = useRef(false)
  const [material, setMaterial] = useState('asphalt')
  const [depthIn, setDepthIn] = useState('2')
  const [extrude, setExtrude] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [personal, setPersonal] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Phone-only: the save/takeoff details live in a dismissible bottom sheet.
  const [sheetOpen, setSheetOpen] = useState(false)
  const ptsRef = useRef(pts)
  ptsRef.current = pts
  // Set when a vertex drag just ended — the mouseup/touchend can still emit a
  // map 'click', which must NOT add a new point on top of the drop spot.
  const justDraggedRef = useRef(0)
  // Latest draft geometry — replayed into the source right after the layers
  // finally attach (they can attach late, see the idle-retry below).
  const fcRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })

  // Build the working geometry (committed pts + rubber-band to the cursor —
  // unless the shape is finished, then what you clicked is what you get).
  const live: [number, number][] = hover && mode !== 'point' && !done ? [...pts, hover] : pts
  const lengthFt = mode === 'line' ? polylineLengthFt(live) : 0
  const areaSqFt = mode === 'area' && live.length >= 3 ? polygonAreaSqFt(live) : 0
  const perimFt = mode === 'area' && live.length >= 3 ? polylineLengthFt([...live, live[0]]) : 0
  const depth = Number(depthIn) || 0
  const to = mode === 'area' && areaSqFt > 0 && depth > 0 ? takeoff(areaSqFt, depth, material) : null
  const sp = mode === 'point' && pts[0] ? toStatePlaneSC(pts[0][0], pts[0][1]) : hover ? toStatePlaneSC(hover[0], hover[1]) : null

  // The auto-unit step (see unitTouched/autoMi above): ≥2 miles flips the
  // readout + map labels to miles; shrinking back under 1 mile restores ft.
  useEffect(() => {
    if (unitTouched.current) return
    const ft = mode === 'area' ? perimFt : lengthFt
    if (lenUnit !== 'mi' && ft >= 10_560) { autoMi.current = true; setLenUnit('mi') }
    else if (lenUnit === 'mi' && autoMi.current && ft > 0 && ft < 5_280) { autoMi.current = false; setLenUnit('ft') }
  }, [lengthFt, perimFt, lenUnit, mode])

  // ── Map interaction ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !active) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      setHover(ll)
      if (terrainOn && map.queryTerrainElevation) {
        const m = map.queryTerrainElevation(e.lngLat)
        setElev(m != null ? m * M_TO_FT : null)
      } else setElev(null)
    }
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (Date.now() - justDraggedRef.current < 200) return // drag drop, not a new point
      if (doneRef.current && mode !== 'point') return // finished — Undo/Clear to edit
      const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      if (mode === 'point') { setPts([ll]); return }
      setPts((p) => [...p, ll])
    }
    // Double-click finishes the line/area (PC). The double-click's own pair of
    // 'click' events already planted the end point twice — drop the duplicate
    // so the LAST CLICKED spot is the end, exactly once (owner ask, Jul 22).
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault() // never zoom while measuring
      if (mode === 'point' || doneRef.current) return
      let p = ptsRef.current
      if (p.length >= 2) {
        const a = map.project({ lng: p[p.length - 1][0], lat: p[p.length - 1][1] })
        const b = map.project({ lng: p[p.length - 2][0], lat: p[p.length - 2][1] })
        if (Math.hypot(a.x - b.x, a.y - b.y) < 12) { p = p.slice(0, -1); setPts(p) }
      }
      if (p.length >= (mode === 'line' ? 2 : 3)) { setDone(true); setHover(null) }
    }

    map.on('mousemove', onMove)
    map.on('click', onClick)
    map.on('dblclick', onDbl)
    map.doubleClickZoom.disable()
    return () => {
      map.off('mousemove', onMove)
      map.off('click', onClick)
      map.off('dblclick', onDbl)
      map.doubleClickZoom.enable()
      canvas.style.cursor = ''
    }
  }, [map, active, mode, terrainOn])

  // ── Draw the draft geometry ──────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    if (live.length) {
      if (mode === 'area' && live.length >= 3) {
        fc.features.push({ type: 'Feature', properties: { h: extrude && depth > 0 ? depth / 12 * 8 : 0 }, geometry: { type: 'Polygon', coordinates: [[...live, live[0]]] } })
      } else if (live.length >= 2) {
        fc.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: live } })
      }
      pts.forEach((p, i) => fc.features.push({ type: 'Feature', properties: { vertex: 1, vi: i }, geometry: { type: 'Point', coordinates: p } }))
      // Per-edge length labels at segment midpoints (the Fields-app treatment:
      // read the dimensions off the map, not out of a panel). Closing edge
      // included once the polygon has 3+ corners.
      if (mode !== 'point' && live.length >= 2) {
        const edges: [number, number][][] = []
        for (let i = 1; i < live.length; i++) edges.push([live[i - 1], live[i]])
        if (mode === 'area' && live.length >= 3) edges.push([live[live.length - 1], live[0]])
        for (const [a, b] of edges) {
          const ft = polylineLengthFt([a, b])
          if (ft < 1) continue
          fc.features.push({
            type: 'Feature',
            properties: { lbl: `${fmt(lengthIn(ft, lenUnit), lenUnit === 'mi' ? 2 : 0)} ${LENGTH_LABEL[lenUnit]}` },
            geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
          })
        }
      }
    }
    fcRef.current = fc
    const src = map.getSource(DRAFT_SRC) as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(fc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pts, hover, mode, extrude, depth, lenUnit])

  // Ensure source + layers exist while active; remove on teardown.
  useEffect(() => {
    if (!map || !active) return
    const add = () => {
      if (!map.getSource(DRAFT_SRC)) map.addSource(DRAFT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer('measure-fill')) map.addLayer({ id: 'measure-fill', type: 'fill', source: DRAFT_SRC, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.18 } })
      if (!map.getLayer('measure-extrude')) map.addLayer({ id: 'measure-extrude', type: 'fill-extrusion', source: DRAFT_SRC, filter: ['all', ['==', '$type', 'Polygon'], ['>', ['get', 'h'], 0]], paint: { 'fill-extrusion-color': '#f5a623', 'fill-extrusion-opacity': 0.35, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0 } })
      if (!map.getLayer('measure-line')) map.addLayer({ id: 'measure-line', type: 'line', source: DRAFT_SRC, paint: { 'line-color': '#ffb648', 'line-width': 2.5, 'line-dasharray': [2, 1] } })
      if (!map.getLayer('measure-verts')) map.addLayer({ id: 'measure-verts', type: 'circle', source: DRAFT_SRC, filter: ['==', 'vertex', 1], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#f5a623', 'circle-stroke-width': 2 } })
      // Invisible fat hit ring over each vertex — a thumb-sized drag target
      // (the visible 6px dot is unhittable on a phone).
      if (!map.getLayer('measure-verts-hit')) map.addLayer({ id: 'measure-verts-hit', type: 'circle', source: DRAFT_SRC, filter: ['==', 'vertex', 1], paint: { 'circle-radius': 18, 'circle-color': '#000', 'circle-opacity': 0.001 } })
      if (!map.getLayer('measure-seglabels')) map.addLayer({
        id: 'measure-seglabels', type: 'symbol', source: DRAFT_SRC, filter: ['has', 'lbl'],
        layout: { 'text-field': ['get', 'lbl'], 'text-size': 11, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': '#ffe0b0', 'text-halo-color': '#04121d', 'text-halo-width': 1.8 },
      })
    }
    // isStyleLoaded() reports false during ANY pending style mutation, and the
    // old `once('load')` fallback never fires again after startup — so
    // activating measure mid-churn silently added NO layers: the panel counted
    // corners while the map drew nothing (found via headless drag test, Jul 18).
    // 'idle' always fires again, so retry there until the add sticks.
    let disposed = false
    const ensure = () => {
      if (disposed) return
      try {
        add()
        ;(map.getSource(DRAFT_SRC) as maplibregl.GeoJSONSource | undefined)?.setData(fcRef.current)
      } catch {
        map.once('idle', ensure) // style mid-mutation — try again when it settles
      }
    }
    ensure()
    return () => {
      disposed = true
      for (const l of ['measure-fill', 'measure-extrude', 'measure-line', 'measure-verts', 'measure-verts-hit', 'measure-seglabels']) if (map.getLayer(l)) map.removeLayer(l)
      if (map.getSource(DRAFT_SRC)) map.removeSource(DRAFT_SRC)
    }
  }, [map, active])

  // ── Drag a vertex to adjust it (mouse + touch) ─────────────────────────────
  // Grab the fat hit ring, dragPan pauses, the point follows the pointer, and
  // all readouts/edge labels update live. The post-drag click is swallowed via
  // justDraggedRef so dropping a corner never plants a new one.
  useEffect(() => {
    if (!map || !active) return
    let dragVi: number | null = null
    let moved = false
    const move = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (dragVi == null) return
      moved = true
      const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      setHover(null)
      setPts((p) => p.map((q, i) => (i === dragVi ? ll : q)))
    }
    const end = () => {
      if (dragVi == null) return
      dragVi = null
      if (moved) justDraggedRef.current = Date.now()
      moved = false
      map.dragPan.enable()
      map.off('mousemove', move)
      map.off('touchmove', move)
    }
    const start = (e: (maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) & { preventDefault: () => void }) => {
      const vi = e.features?.[0]?.properties?.vi
      if (typeof vi !== 'number') return
      e.preventDefault()
      dragVi = vi
      moved = false
      map.dragPan.disable()
      map.on('mousemove', move)
      map.on('touchmove', move)
      map.once('mouseup', end)
      map.once('touchend', end)
    }
    const enter = () => { map.getCanvas().style.cursor = 'move' }
    const leave = () => { map.getCanvas().style.cursor = 'crosshair' }
    map.on('mousedown', 'measure-verts-hit', start)
    map.on('touchstart', 'measure-verts-hit', start)
    map.on('mouseenter', 'measure-verts-hit', enter)
    map.on('mouseleave', 'measure-verts-hit', leave)
    return () => {
      map.off('mousedown', 'measure-verts-hit', start)
      map.off('touchstart', 'measure-verts-hit', start)
      map.off('mouseenter', 'measure-verts-hit', enter)
      map.off('mouseleave', 'measure-verts-hit', leave)
      map.off('mousemove', move)
      map.off('touchmove', move)
      map.dragPan.enable()
    }
  }, [map, active])

  // Approximate elevation for the dropped point — open-meteo's free DEM
  // (Copernicus 90m). Refetches if the point is dragged somewhere new.
  useEffect(() => {
    if (mode !== 'point' || !pts[0]) { setClickElev(null); return }
    let cancelled = false
    const [lng, lat] = pts[0]
    fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(6)}&longitude=${lng.toFixed(6)}`)
      .then((r) => r.json())
      .then((j) => {
        const m = Array.isArray(j?.elevation) ? j.elevation[0] : null
        if (!cancelled && typeof m === 'number') setClickElev(m * M_TO_FT)
      })
      .catch(() => { /* offline / blocked — readout just stays blank */ })
    return () => { cancelled = true }
  }, [mode, pts])

  const reset = () => { setPts([]); setHover(null); setName(''); setMsg(null); setSheetOpen(false); setDone(false) }
  // Loading a saved shape flips `mode`, which would fire the reset below and
  // wipe the points we just loaded — skip exactly that one reset.
  const skipResetRef = useRef(false)
  useEffect(() => {
    if (skipResetRef.current) { skipResetRef.current = false; return }
    reset()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the tool without saving must not leave a stale draft — the next
  // open would show the old shape and Save would DUPLICATE it (ship-check
  // P1, Aug 18).
  useEffect(() => {
    if (!active) { reset(); skipResetRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Tap-to-edit: load the saved measurement into the tool, finished.
  useEffect(() => {
    if (!active || !initial) return
    // Skip the mode-change reset ONLY if the mode will actually change —
    // a same-mode load leaves setMode a no-op and the stale flag would eat
    // the NEXT manual mode switch's reset.
    skipResetRef.current = initial.kind !== mode
    setMode(initial.kind)
    setPts(initial.coords)
    setHover(null)
    setDone(initial.kind !== 'point')
    setName(initial.name)
    setPersonal(initial.personal)
    setMsg(null)
    setSheetOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initial])

  const canSave = mode === 'point' ? pts.length === 1 : mode === 'line' ? pts.length >= 2 : pts.length >= 3

  const save = async () => {
    if (!canSave) return
    setSaving(true); setMsg(null)
    const geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon =
      mode === 'point' ? { type: 'Point', coordinates: pts[0] }
      : mode === 'line' ? { type: 'LineString', coordinates: pts }
      : { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
    const props = {
      lengthUnit: lenUnit, areaUnit,
      lengthFt: mode === 'line' ? polylineLengthFt(pts) : undefined,
      areaSqFt: mode === 'area' ? polygonAreaSqFt(pts) : undefined,
      statePlane: mode === 'point' ? toStatePlaneSC(pts[0][0], pts[0][1]) : undefined,
      elevationFt: mode === 'point' ? (clickElev ?? elev) : undefined,
      takeoff: mode === 'area' && depth > 0 ? takeoff(polygonAreaSqFt(pts), depth, material) : null,
    }
    const finalName = name || defaultName(mode, props)
    if (initial?.id) {
      const r = await updateMeasurementAction(initial.id, { name: finalName, geometry, props })
      setSaving(false)
      if (!r.ok) { setMsg(r.error ?? 'Update failed.'); return }
      onSaved({ id: initial.id, name: finalName, kind: mode, personal, geometry, props })
      reset()
      setMsg('Updated ✓')
      return
    }
    const r = await saveMeasurementAction({ name: finalName, kind: mode, personal, geometry, props })
    setSaving(false)
    if (!r.ok) { setMsg(r.error ?? 'Save failed.'); return }
    onSaved(r.id ? { id: r.id, name: finalName, kind: mode, personal, geometry, props } : undefined)
    reset()
    setMsg('Saved ✓')
  }

  if (!active) return null

  // One-line readout for the phone strip. Dropped point → approx DEM
  // elevation; hovering with 3D terrain on → live mesh elevation.
  const shownElev = pts.length && mode === 'point' ? clickElev : elev
  const stripReadout = mode === 'point'
    ? (sp ? `N ${fmt(sp.northing, 1)} · E ${fmt(sp.easting, 1)}${shownElev != null ? ` · ~${fmt(shownElev, 0)} ft` : ''}` : 'Tap the map to drop a point')
    : mode === 'line'
      ? (pts.length ? `${fmt(lengthIn(lengthFt, lenUnit), lenUnit === 'mi' ? 3 : 1)} ${LENGTH_LABEL[lenUnit]} · ${pts.length} pt${pts.length === 1 ? '' : 's'}` : 'Tap to add points')
      : (pts.length >= 3
          ? `${fmt(areaIn(areaSqFt, areaUnit), areaUnit === 'acre' ? 3 : 0)} ${AREA_LABEL[areaUnit]} · perim ${fmt(lengthIn(perimFt, lenUnit), lenUnit === 'mi' ? 2 : 0)} ${LENGTH_LABEL[lenUnit]}`
          : pts.length ? `${pts.length} corner${pts.length === 1 ? '' : 's'} — keep tapping` : 'Tap corners to outline the area')

  const modeBtns = ([['point', MapPin], ['line', Spline], ['area', Hexagon]] as const)

  return (
    <>
      {/* ── PHONE: slim top strip — the map stays fully visible ── */}
      <div className="md:hidden absolute top-0 inset-x-0 z-30">
        <div className="flex items-center gap-1 px-1.5 py-1 bg-navy-950/95 backdrop-blur border-b border-amber/30">
          <button onClick={onClose} className="p-1.5 text-faint hover:text-ink flex-none" aria-label="Close measure"><X className="h-4 w-4" /></button>
          <Ruler className="h-3.5 w-3.5 text-amber flex-none" />
          <span className="flex items-center gap-0.5 bg-navy-900 rounded-md p-0.5 border border-navy-800 flex-none">
            {modeBtns.map(([m, Icon]) => (
              <button key={m} onClick={() => setMode(m)} aria-label={m}
                className={'p-1.5 rounded ' + (mode === m ? 'bg-amber/25 text-amber' : 'text-faint')}>
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </span>
          <button onClick={() => { setPts((p) => p.slice(0, -1)); setDone(false) }} disabled={!pts.length || mode === 'point'} className="p-1.5 text-faint disabled:opacity-30 flex-none" aria-label="Undo"><Undo2 className="h-4 w-4" /></button>
          <button onClick={reset} disabled={!pts.length} className="p-1.5 text-faint disabled:opacity-30 flex-none" aria-label="Clear"><Trash2 className="h-4 w-4" /></button>
          {/* ✓ = finish the shape at the last tapped point (phone's double-click) */}
          {mode !== 'point' && (
            <button
              onClick={() => { setDone(true); setHover(null) }}
              disabled={!canSave || done}
              className={'p-1.5 flex-none disabled:opacity-30 ' + (done ? 'text-teal' : 'text-amber')}
              aria-label="Finish shape"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={() => setSheetOpen(true)}
            disabled={!canSave}
            className="flex-none rounded-md bg-amber text-[#1a1100] font-display font-bold text-[11.5px] px-3 py-1.5 disabled:opacity-35"
          >
            Next
          </button>
        </div>
        {/* readout line — tap the unit chip to cycle */}
        <div className="flex items-center gap-2 px-2.5 py-1 bg-navy-950/85 backdrop-blur border-b border-navy-800">
          <span className="font-mono text-[11.5px] text-amber tabular-nums truncate flex-1">{stripReadout}</span>
          {mode === 'line' && <UnitBtns opts={['ft', 'yd', 'mi']} labels={LENGTH_LABEL} val={lenUnit} set={(u) => { unitTouched.current = true; autoMi.current = false; setLenUnit(u as LengthUnit) }} />}
          {mode === 'area' && <UnitBtns opts={['sf', 'sy', 'acre']} labels={AREA_LABEL} val={areaUnit} set={(u) => setAreaUnit(u as AreaUnit)} />}
        </div>
      </div>

      {/* ── PHONE: save/takeoff bottom sheet (only after Next) ── */}
      {sheetOpen && canSave && (
        <div className="md:hidden absolute inset-x-2 bottom-16 z-40 rounded-xl bg-navy-950/97 backdrop-blur border border-navy-700 shadow-panel p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-[13px] text-ink flex-1">
              {mode === 'point' ? 'Save point' : mode === 'line' ? `Save line — ${fmt(lengthIn(polylineLengthFt(pts), lenUnit), 1)} ${LENGTH_LABEL[lenUnit]}` : `Save area — ${fmt(areaIn(polygonAreaSqFt(pts), areaUnit), areaUnit === 'acre' ? 3 : 0)} ${AREA_LABEL[areaUnit]}`}
            </span>
            <button onClick={() => setSheetOpen(false)} className="text-faint hover:text-ink p-1"><X className="h-4 w-4" /></button>
          </div>
          {mode === 'area' && (
            <div className="rounded-lg bg-navy-900 p-2 space-y-1.5">
              <p className="font-mono text-[9px] uppercase tracking-wider text-faint flex items-center gap-1"><Box className="h-3 w-3" /> Takeoff</p>
              <div className="flex gap-1.5">
                <select value={material} onChange={(e) => setMaterial(e.target.value)} className="flex-1 bg-navy-950 border border-navy-700 rounded-md text-[11.5px] text-ink px-2 py-1 outline-none">
                  {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <div className="flex items-center bg-navy-950 border border-navy-700 rounded-md px-1.5">
                  <input value={depthIn} onChange={(e) => setDepthIn(e.target.value)} inputMode="decimal" className="w-9 bg-transparent text-[11.5px] text-ink text-right outline-none" />
                  <span className="text-[10px] text-faint ml-0.5">in</span>
                </div>
              </div>
              {to && (
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-md bg-amber/10 px-2 py-1"><p className="font-display font-bold text-amber text-[15px] tabular-nums leading-none">{fmt(to.tons, 1)}<span className="text-[10px] font-normal ml-0.5">tons</span></p></div>
                  <div className="rounded-md bg-teal/10 px-2 py-1"><p className="font-display font-bold text-teal text-[15px] tabular-nums leading-none">{fmt(to.cubicYd, 1)}<span className="text-[10px] font-normal ml-0.5">CY</span></p></div>
                </div>
              )}
            </div>
          )}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Lot A — 2&quot; asphalt)" className="w-full bg-navy-950 border border-navy-700 rounded-md text-[12px] text-ink px-2 py-1.5 outline-none focus:border-amber/50" />
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPersonal(false)} className={'flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold border ' + (!personal ? 'bg-teal/20 text-teal border-teal/40' : 'text-faint border-navy-700')}><Globe className="h-3 w-3" /> Everyone</button>
            <button onClick={() => setPersonal(true)} className={'flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold border ' + (personal ? 'bg-[#a78bfa]/20 text-[#c4b5fd] border-[#a78bfa]/40' : 'text-faint border-navy-700')}><Lock className="h-3 w-3" /> Just me</button>
          </div>
          <button onClick={save} disabled={saving} className="w-full flex items-center justify-center gap-1.5 rounded-md bg-amber text-[#1a1100] font-display font-bold text-[12.5px] py-2 disabled:opacity-50">
            <Check className="h-4 w-4" /> {saving ? 'Saving…' : initial?.id ? 'Update measurement' : 'Save measurement'}
          </button>
          {msg && <p className={'text-[11px] ' + (msg.includes('✓') ? 'text-teal' : 'text-alert')}>{msg}</p>}
        </div>
      )}

      {/* ── DESKTOP: the full side card ── */}
      <div className="hidden md:block absolute left-3 bottom-28 z-30 w-[290px] rounded-xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-navy-800">
        <Ruler className="h-4 w-4 text-amber" />
        <span className="font-display font-bold text-[13px] text-ink flex-1">{initial?.id ? `Editing “${initial.name}”` : <>Measure &amp; takeoff</>}</span>
        <button onClick={onClose} className="text-faint hover:text-ink"><X className="h-4 w-4" /></button>
      </div>

      {/* mode switch */}
      <div className="grid grid-cols-3 gap-1 p-2">
        {([['point', 'Point', MapPin], ['line', 'Length', Spline], ['area', 'Area', Hexagon]] as const).map(([m, label, Icon]) => (
          <button key={m} onClick={() => setMode(m)}
            className={'flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ' + (mode === m ? 'bg-amber/20 text-amber border-amber/40' : 'text-faint border-navy-700 hover:text-ink')}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-3 space-y-2">
        {/* POINT readout */}
        {mode === 'point' && (
          <div className="rounded-lg bg-navy-900 p-2.5 font-mono text-[11.5px] space-y-1">
            {sp ? (
              <>
                <Row k="Northing" v={`${fmt(sp.northing, 2)} ft`} />
                <Row k="Easting" v={`${fmt(sp.easting, 2)} ft`} />
                <Row k="Elevation" v={pts.length
                  ? (clickElev != null ? `~${fmt(clickElev, 0)} ft` : 'looking up…')
                  : elev != null ? `${fmt(elev, 1)} ft` : 'click to read'} />
                <Row k="Lat, Lng" v={`${(pts[0]?.[1] ?? hover?.[1] ?? 0).toFixed(6)}, ${(pts[0]?.[0] ?? hover?.[0] ?? 0).toFixed(6)}`} />
                <p className="text-[9.5px] text-faint pt-0.5">SC State Plane (EPSG:2273, US ft){shownElev != null ? ' · elev approx (DEM)' : ''}</p>
              </>
            ) : <p className="text-faint">Hover the map, then click to drop the point.</p>}
          </div>
        )}

        {/* LINE readout */}
        {mode === 'line' && (
          <div className="rounded-lg bg-navy-900 p-2.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display font-black text-amber text-xl tabular-nums">{lengthFt > 0 ? fmt(lengthIn(lengthFt, lenUnit), lenUnit === 'mi' ? 3 : 1) : '0.0'}</span>
              <UnitBtns opts={['ft', 'yd', 'mi']} labels={LENGTH_LABEL} val={lenUnit} set={(u) => { unitTouched.current = true; autoMi.current = false; setLenUnit(u as LengthUnit) }} />
            </div>
            <p className="text-[10px] text-faint mt-0.5">{pts.length} point{pts.length === 1 ? '' : 's'} · click to add, double-click or Finish to end</p>
          </div>
        )}

        {/* AREA readout + takeoff */}
        {mode === 'area' && (
          <>
            <div className="rounded-lg bg-navy-900 p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="font-display font-black text-amber text-xl tabular-nums">{areaSqFt > 0 ? fmt(areaIn(areaSqFt, areaUnit), areaUnit === 'acre' ? 3 : 0) : '0'}</span>
                <UnitBtns opts={['sf', 'sy', 'acre']} labels={AREA_LABEL} val={areaUnit} set={(u) => setAreaUnit(u as AreaUnit)} />
              </div>
              <p className="text-[10px] text-faint mt-0.5">{pts.length} corner{pts.length === 1 ? '' : 's'}{areaSqFt > 0 ? ` · ${fmt(areaIn(areaSqFt, 'sf'), 0)} SF · perim ${fmt(lengthIn(perimFt, 'ft'), 0)} ft` : ''}{done ? ' · finished' : ' · double-click or Finish to end'}</p>
            </div>
            {/* Takeoff */}
            <div className="rounded-lg bg-navy-900 p-2.5 space-y-1.5">
              <p className="font-mono text-[9px] uppercase tracking-wider text-faint flex items-center gap-1"><Box className="h-3 w-3" /> Takeoff</p>
              <div className="flex gap-1.5">
                <select value={material} onChange={(e) => setMaterial(e.target.value)} className="flex-1 bg-navy-950 border border-navy-700 rounded-md text-[11.5px] text-ink px-2 py-1 outline-none">
                  {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <div className="flex items-center bg-navy-950 border border-navy-700 rounded-md px-1.5">
                  <input value={depthIn} onChange={(e) => setDepthIn(e.target.value)} inputMode="decimal" className="w-9 bg-transparent text-[11.5px] text-ink text-right outline-none" />
                  <span className="text-[10px] text-faint ml-0.5">in</span>
                </div>
              </div>
              {to ? (
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <div className="rounded-md bg-amber/10 px-2 py-1"><p className="font-display font-bold text-amber text-[15px] tabular-nums leading-none">{fmt(to.tons, 1)}<span className="text-[10px] font-normal ml-0.5">tons</span></p></div>
                  <div className="rounded-md bg-teal/10 px-2 py-1"><p className="font-display font-bold text-teal text-[15px] tabular-nums leading-none">{fmt(to.cubicYd, 1)}<span className="text-[10px] font-normal ml-0.5">CY</span></p></div>
                </div>
              ) : <p className="text-[10px] text-faint">Close the area + set a depth for tonnage.</p>}
              <button onClick={() => setExtrude((v) => !v)} className={'w-full flex items-center justify-center gap-1 rounded-md py-1 text-[10.5px] font-semibold border ' + (extrude ? 'bg-amber/20 text-amber border-amber/40' : 'text-faint border-navy-700 hover:text-ink')}>
                <Box className="h-3 w-3" /> {extrude ? '3D lift on' : 'Show 3D lift'}
              </button>
              <p className="text-[9px] text-faint">Estimate — verify against your supplier ticket.</p>
            </div>
          </>
        )}

        {/* controls */}
        <div className="flex items-center gap-1.5">
          {mode !== 'point' && (
            <button onClick={() => { setPts((p) => p.slice(0, -1)); setDone(false) }} disabled={!pts.length} className="flex items-center gap-1 rounded-md border border-navy-700 text-faint hover:text-ink text-[11px] px-2 py-1 disabled:opacity-40">
              <Undo2 className="h-3 w-3" /> Undo
            </button>
          )}
          <button onClick={reset} disabled={!pts.length} className="flex items-center gap-1 rounded-md border border-navy-700 text-faint hover:text-alert text-[11px] px-2 py-1 disabled:opacity-40">
            <Trash2 className="h-3 w-3" /> Clear
          </button>
          {mode !== 'point' && (
            <button
              onClick={() => { setDone(true); setHover(null) }}
              disabled={!canSave || done}
              className={'ml-auto flex items-center gap-1 rounded-md border text-[11px] px-2 py-1 disabled:opacity-40 ' +
                (done ? 'border-teal/40 text-teal' : 'border-amber/40 text-amber hover:bg-amber/10')}
            >
              <Check className="h-3 w-3" /> {done ? 'Finished' : 'Finish'}
            </button>
          )}
        </div>

        {/* save */}
        {canSave && (
          <div className="space-y-1.5 pt-1 border-t border-navy-800">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Lot A — 2&quot; asphalt)" className="w-full bg-navy-950 border border-navy-700 rounded-md text-[12px] text-ink px-2 py-1.5 outline-none focus:border-amber/50" />
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPersonal(false)} className={'flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold border ' + (!personal ? 'bg-teal/20 text-teal border-teal/40' : 'text-faint border-navy-700')}><Globe className="h-3 w-3" /> Everyone</button>
              <button onClick={() => setPersonal(true)} className={'flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold border ' + (personal ? 'bg-[#a78bfa]/20 text-[#c4b5fd] border-[#a78bfa]/40' : 'text-faint border-navy-700')}><Lock className="h-3 w-3" /> Just me</button>
            </div>
            <button onClick={save} disabled={saving} className="w-full flex items-center justify-center gap-1.5 rounded-md bg-amber text-[#1a1100] font-display font-bold text-[12.5px] py-2 disabled:opacity-50">
              <Check className="h-4 w-4" /> {saving ? 'Saving…' : initial?.id ? 'Update measurement' : 'Save measurement'}
            </button>
          </div>
        )}
        {msg && <p className={'text-[11px] ' + (msg.includes('✓') ? 'text-teal' : 'text-alert')}>{msg}</p>}
      </div>
      </div>
    </>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><span className="text-faint">{k}</span><span className="text-ink">{v}</span></div>
}
function UnitBtns<T extends string>({ opts, labels, val, set }: { opts: T[]; labels: Record<T, string>; val: T; set: (u: T) => void }) {
  return (
    <span className="flex items-center gap-0.5 bg-navy-950 rounded-md p-0.5 border border-navy-800 flex-none">
      {opts.map((o) => (
        <button key={o} onClick={() => set(o)} className={'px-1.5 py-0.5 rounded text-[10px] font-semibold ' + (val === o ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')}>{labels[o]}</button>
      ))}
    </span>
  )
}
function defaultName(mode: Mode, props: { lengthFt?: number; areaSqFt?: number }): string {
  if (mode === 'point') return 'Point'
  if (mode === 'line') return `Line — ${fmt(props.lengthFt ?? 0, 0)} ft`
  return `Area — ${fmt(props.areaSqFt ?? 0, 0)} SF`
}
