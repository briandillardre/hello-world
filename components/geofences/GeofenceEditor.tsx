'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Trash2, Save } from 'lucide-react'
import { saveGeofenceAction, deleteGeofenceAction } from '@/lib/actions/geofences'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Last two are outline-only "boundary" colors (near-black / gray) — no fill,
// for a large perimeter around the whole work area.
const COLORS = ['#ff9e16', '#2dd4bf', '#a78bfa', '#f87171', '#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#0a0a0a', '#9ca3af']

interface GeofenceEditorProps {
  id: string
  name: string
  color: string
  parentId: string | null
  /** Closed ring [[lng,lat],…] (first == last). */
  ring: [number, number][]
}

/**
 * Zone editor: rename, recolor, and reshape. Vertices (solid dots) drag to
 * move — works with touch for iPad. Midpoints (hollow dots) tap to add a
 * vertex. Tap a vertex to select it, then "Delete vertex" removes it (min 3).
 */
export function GeofenceEditor({ id, name: initialName, color: initialColor, parentId, ring: initialRing }: GeofenceEditorProps) {
  const router = useRouter()
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  // Open ring (no closing duplicate) — easier to edit; re-closed on save.
  const [verts, setVerts] = useState<[number, number][]>(() => {
    const r = initialRing.slice()
    if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop()
    return r
  })
  const vertsRef = useRef(verts)
  vertsRef.current = verts
  const [selected, setSelected] = useState<number | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const colorRef = useRef(color)
  colorRef.current = color
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [ready, setReady] = useState(false)

  const sourceData = useCallback((v: [number, number][], sel: number | null) => {
    const closed = v.length >= 3 ? [...v, v[0]] : v
    const zone: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: v.length >= 3 ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties: {} }] : [],
    }
    const points: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: v.map((p, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p },
        properties: { i, sel: i === sel ? 1 : 0 },
      })),
    }
    const mids: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: v.map((p, i) => {
        const q = v[(i + 1) % v.length]
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] },
          properties: { after: i },
        }
      }),
    }
    return { zone, points, mids }
  }, [])

  // init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return
    const lats = vertsRef.current.map((p) => p[1])
    const lngs = vertsRef.current.map((p) => p[0])
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ]
    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: [SAT], tileSize: 256, maxzoom: 19 } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      bounds,
      fitBoundsOptions: { padding: 60 },
      attributionControl: false,
    })
    map.current = m

    m.on('load', () => {
      const d = sourceData(vertsRef.current, null)
      m.addSource('zone', { type: 'geojson', data: d.zone })
      m.addSource('verts', { type: 'geojson', data: d.points })
      m.addSource('mids', { type: 'geojson', data: d.mids })
      m.addLayer({ id: 'zone-fill', type: 'fill', source: 'zone', paint: { 'fill-color': colorRef.current, 'fill-opacity': 0.18 } })
      m.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': colorRef.current, 'line-width': 2 } })
      m.addLayer({
        id: 'mids-pts', type: 'circle', source: 'mids',
        paint: { 'circle-radius': 7, 'circle-color': '#0b1523', 'circle-opacity': 0.6, 'circle-stroke-color': '#9fb6cc', 'circle-stroke-width': 1.5 },
      })
      m.addLayer({
        id: 'verts-pts', type: 'circle', source: 'verts',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 11, 9],
          'circle-color': ['case', ['==', ['get', 'sel'], 1], '#ff9e16', '#e8f0f7'],
          'circle-stroke-color': '#0b1523', 'circle-stroke-width': 2,
        },
      })

      // drag a vertex (mouse + touch)
      let dragIdx: number | null = null
      const onMove = (ev: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
        if (dragIdx === null) return
        const next = vertsRef.current.slice()
        next[dragIdx] = [ev.lngLat.lng, ev.lngLat.lat]
        setVerts(next)
        setDirty(true)
      }
      const endDrag = () => {
        dragIdx = null
        m.dragPan.enable()
        m.off('mousemove', onMove)
        m.off('touchmove', onMove)
      }
      const startDrag = (e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) => {
        const i = e.features?.[0]?.properties?.i
        if (i === undefined) return
        e.preventDefault()
        dragIdx = Number(i)
        setSelected(Number(i))
        m.dragPan.disable()
        m.on('mousemove', onMove)
        m.on('touchmove', onMove)
        m.once('mouseup', endDrag)
        m.once('touchend', endDrag)
      }
      m.on('mousedown', 'verts-pts', startDrag)
      m.on('touchstart', 'verts-pts', startDrag)

      // tap a midpoint → insert a vertex there
      const addAtMid = (e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) => {
        const after = e.features?.[0]?.properties?.after
        if (after === undefined) return
        const i = Number(after)
        const v = vertsRef.current
        const midpoint: [number, number] = [
          (v[i][0] + v[(i + 1) % v.length][0]) / 2,
          (v[i][1] + v[(i + 1) % v.length][1]) / 2,
        ]
        const next = [...v.slice(0, i + 1), midpoint, ...v.slice(i + 1)]
        setVerts(next)
        setSelected(i + 1)
        setDirty(true)
      }
      m.on('click', 'mids-pts', addAtMid)

      m.on('mouseenter', 'verts-pts', () => { m.getCanvas().style.cursor = 'grab' })
      m.on('mouseleave', 'verts-pts', () => { m.getCanvas().style.cursor = '' })
      setReady(true)
    })

    return () => { m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // push state → map sources
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const d = sourceData(verts, selected)
    ;(m.getSource('zone') as maplibregl.GeoJSONSource | undefined)?.setData(d.zone)
    ;(m.getSource('verts') as maplibregl.GeoJSONSource | undefined)?.setData(d.points)
    ;(m.getSource('mids') as maplibregl.GeoJSONSource | undefined)?.setData(d.mids)
  }, [verts, selected, ready, sourceData])

  // recolor layers live
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    if (m.getLayer('zone-fill')) m.setPaintProperty('zone-fill', 'fill-color', color)
    if (m.getLayer('zone-line')) m.setPaintProperty('zone-line', 'line-color', color)
  }, [color, ready])

  const deleteVertex = () => {
    if (selected === null || verts.length <= 3) return
    setVerts(verts.filter((_, i) => i !== selected))
    setSelected(null)
    setDirty(true)
  }

  const save = async () => {
    if (verts.length < 3) return
    setSaving(true)
    try {
      const closed = [...verts, verts[0]]
      await saveGeofenceAction(id, name.trim() || initialName, color, parentId, {
        type: 'Polygon',
        coordinates: [closed],
      })
      setDirty(false)
      router.refresh()
    } catch (err) {
      console.error('Zone save failed', err)
      alert('Could not save the zone. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const removeZone = async () => {
    if (!confirm(`Delete zone "${initialName}"? Alert rules attached to it are removed too.`)) return
    try {
      await deleteGeofenceAction(id)
      router.push('/geofences')
      router.refresh()
    } catch (err) {
      console.error('Zone delete failed', err)
      alert('Could not delete the zone. Please try again.')
    }
  }

  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Edit zone</h2>
      <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
        <div ref={mapContainer} className="h-[320px] w-full" />
        <div className="p-3 space-y-3">
          <p className="text-[11px] text-faint">
            Drag a <span className="text-ink font-semibold">solid dot</span> to move a corner · tap a{' '}
            <span className="text-ink font-semibold">hollow dot</span> to add one · tap a corner then Delete vertex to remove it.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[160px]">
              <Label htmlFor="zone-name" className="text-xs">Zone name</Label>
              <Input id="zone-name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setColor(c); setDirty(true) }}
                    className={'w-7 h-7 rounded-full border-2 ' + (color === c ? 'border-ink scale-110' : 'border-transparent')}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving || !dirty || verts.length < 3} className="gap-1.5">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button size="sm" variant="outline" onClick={deleteVertex} disabled={selected === null || verts.length <= 3}>
              Delete vertex{selected !== null ? ` #${selected + 1}` : ''}
            </Button>
            <Button size="sm" variant="outline" onClick={removeZone} className="ml-auto text-alert border-alert/40 hover:bg-alert/10 gap-1.5">
              <Trash2 className="h-4 w-4" /> Delete zone
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
