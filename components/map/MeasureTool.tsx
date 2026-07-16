'use client'

import { useEffect, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { Ruler, MapPin, Spline, Hexagon, Undo2, Check, Trash2, X, Globe, Lock, Box } from 'lucide-react'
import {
  toStatePlaneSC, polylineLengthFt, polygonAreaSqFt, lengthIn, areaIn, takeoff,
  LENGTH_LABEL, AREA_LABEL, MATERIALS, fmt, type LengthUnit, type AreaUnit,
} from '@/lib/measure'
import { saveMeasurementAction } from '@/lib/actions/measurements'

type Mode = 'point' | 'line' | 'area'
const M_TO_FT = 3.280839895

const DRAFT_SRC = 'measure-draft'

/**
 * Map measure + takeoff tool. Point (live northing/easting/elevation), line
 * (length), area (SF/SY/acre) — with a material×depth takeoff that returns
 * cubic yards and tonnage, and an optional 3D extrusion to see the lift.
 * Saves to the company (global) or just you (personal).
 */
export function MeasureTool({
  map, active, onClose, onSaved, terrainOn,
}: {
  map: maplibregl.Map | null
  active: boolean
  onClose: () => void
  onSaved: () => void
  /** True when the DEM terrain is on — enables the live elevation readout. */
  terrainOn: boolean
}) {
  const [mode, setMode] = useState<Mode>('area')
  const [pts, setPts] = useState<[number, number][]>([])
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [elev, setElev] = useState<number | null>(null)
  const [lenUnit, setLenUnit] = useState<LengthUnit>('ft')
  const [areaUnit, setAreaUnit] = useState<AreaUnit>('sf')
  const [material, setMaterial] = useState('asphalt')
  const [depthIn, setDepthIn] = useState('2')
  const [extrude, setExtrude] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [personal, setPersonal] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const ptsRef = useRef(pts)
  ptsRef.current = pts

  // Build the working geometry (committed pts + rubber-band to the cursor).
  const live: [number, number][] = hover && mode !== 'point' ? [...pts, hover] : pts
  const lengthFt = mode === 'line' ? polylineLengthFt(live) : 0
  const areaSqFt = mode === 'area' && live.length >= 3 ? polygonAreaSqFt(live) : 0
  const depth = Number(depthIn) || 0
  const to = mode === 'area' && areaSqFt > 0 && depth > 0 ? takeoff(areaSqFt, depth, material) : null
  const sp = mode === 'point' && pts[0] ? toStatePlaneSC(pts[0][0], pts[0][1]) : hover ? toStatePlaneSC(hover[0], hover[1]) : null

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
      const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      if (mode === 'point') { setPts([ll]); return }
      setPts((p) => [...p, ll])
    }
    const onDbl = (e: maplibregl.MapMouseEvent) => { e.preventDefault() } // finish handled by button; block zoom

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
      for (const p of pts) fc.features.push({ type: 'Feature', properties: { vertex: 1 }, geometry: { type: 'Point', coordinates: p } })
    }
    const src = map.getSource(DRAFT_SRC) as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(fc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pts, hover, mode, extrude, depth])

  // Ensure source + layers exist while active; remove on teardown.
  useEffect(() => {
    if (!map || !active) return
    const add = () => {
      if (!map.getSource(DRAFT_SRC)) map.addSource(DRAFT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer('measure-fill')) map.addLayer({ id: 'measure-fill', type: 'fill', source: DRAFT_SRC, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.18 } })
      if (!map.getLayer('measure-extrude')) map.addLayer({ id: 'measure-extrude', type: 'fill-extrusion', source: DRAFT_SRC, filter: ['all', ['==', '$type', 'Polygon'], ['>', ['get', 'h'], 0]], paint: { 'fill-extrusion-color': '#f5a623', 'fill-extrusion-opacity': 0.35, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0 } })
      if (!map.getLayer('measure-line')) map.addLayer({ id: 'measure-line', type: 'line', source: DRAFT_SRC, paint: { 'line-color': '#ffb648', 'line-width': 2.5, 'line-dasharray': [2, 1] } })
      if (!map.getLayer('measure-verts')) map.addLayer({ id: 'measure-verts', type: 'circle', source: DRAFT_SRC, filter: ['==', 'vertex', 1], paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#f5a623', 'circle-stroke-width': 2 } })
    }
    if (map.isStyleLoaded()) add(); else map.once('load', add)
    return () => {
      for (const l of ['measure-fill', 'measure-extrude', 'measure-line', 'measure-verts']) if (map.getLayer(l)) map.removeLayer(l)
      if (map.getSource(DRAFT_SRC)) map.removeSource(DRAFT_SRC)
    }
  }, [map, active])

  const reset = () => { setPts([]); setHover(null); setName(''); setMsg(null) }
  useEffect(() => { reset() }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

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
      elevationFt: mode === 'point' ? elev : undefined,
      takeoff: mode === 'area' && depth > 0 ? takeoff(polygonAreaSqFt(pts), depth, material) : null,
    }
    const r = await saveMeasurementAction({ name: name || defaultName(mode, props), kind: mode, personal, geometry, props })
    setSaving(false)
    if (!r.ok) { setMsg(r.error ?? 'Save failed.'); return }
    onSaved(); reset()
    setMsg('Saved ✓')
  }

  if (!active) return null
  return (
    <div className="absolute left-3 bottom-24 md:bottom-28 z-30 w-[290px] rounded-xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-navy-800">
        <Ruler className="h-4 w-4 text-amber" />
        <span className="font-display font-bold text-[13px] text-ink flex-1">Measure &amp; takeoff</span>
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
                <Row k="Elevation" v={elev != null ? `${fmt(elev, 1)} ft` : terrainOn ? '—' : 'turn on Terrain'} />
                <Row k="Lat, Lng" v={`${(pts[0]?.[1] ?? hover?.[1] ?? 0).toFixed(6)}, ${(pts[0]?.[0] ?? hover?.[0] ?? 0).toFixed(6)}`} />
                <p className="text-[9.5px] text-faint pt-0.5">SC State Plane (EPSG:2273, US ft){elev != null ? ' · elev approx (DEM)' : ''}</p>
              </>
            ) : <p className="text-faint">Hover the map, then click to drop the point.</p>}
          </div>
        )}

        {/* LINE readout */}
        {mode === 'line' && (
          <div className="rounded-lg bg-navy-900 p-2.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display font-black text-amber text-xl tabular-nums">{lengthFt > 0 ? fmt(lengthIn(lengthFt, lenUnit), lenUnit === 'mi' ? 3 : 1) : '0.0'}</span>
              <UnitBtns opts={['ft', 'yd', 'mi']} labels={LENGTH_LABEL} val={lenUnit} set={(u) => setLenUnit(u as LengthUnit)} />
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
              <p className="text-[10px] text-faint mt-0.5">{pts.length} corner{pts.length === 1 ? '' : 's'}{areaSqFt > 0 ? ` · ${fmt(areaIn(areaSqFt, 'sf'), 0)} SF` : ''}</p>
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
            <button onClick={() => setPts((p) => p.slice(0, -1))} disabled={!pts.length} className="flex items-center gap-1 rounded-md border border-navy-700 text-faint hover:text-ink text-[11px] px-2 py-1 disabled:opacity-40">
              <Undo2 className="h-3 w-3" /> Undo
            </button>
          )}
          <button onClick={reset} disabled={!pts.length} className="flex items-center gap-1 rounded-md border border-navy-700 text-faint hover:text-alert text-[11px] px-2 py-1 disabled:opacity-40">
            <Trash2 className="h-3 w-3" /> Clear
          </button>
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
              <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save measurement'}
            </button>
          </div>
        )}
        {msg && <p className={'text-[11px] ' + (msg.includes('✓') ? 'text-teal' : 'text-alert')}>{msg}</p>}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><span className="text-faint">{k}</span><span className="text-ink">{v}</span></div>
}
function UnitBtns<T extends string>({ opts, labels, val, set }: { opts: T[]; labels: Record<T, string>; val: T; set: (u: T) => void }) {
  return (
    <span className="flex items-center gap-0.5 bg-navy-950 rounded-md p-0.5 border border-navy-800">
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
