'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Trash2, Save } from 'lucide-react'
import { saveGeofenceAction, deleteGeofenceAction } from '@/lib/actions/zones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ColorSwatches } from '@/components/ui/color-swatches'

const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

interface GeofenceEditorProps {
  id: string
  name: string
  color: string
  parentId: string | null
  kind?: 'site' | 'boundary' | 'yard' | 'vendor'
  /** Personal zone owner (this user sees it only); null = global. */
  ownerId?: string | null
  /** Whether the current viewer owns this personal zone (can keep it personal). */
  isOwnedByMe?: boolean
  activeFrom?: string | null
  activeUntil?: string | null
  /** Project document folder (Dropbox/Drive/OneDrive) URL. */
  folderUrl?: string | null
  /** Owner notes — gate codes, access, anything the AI should know. */
  notes?: string | null
  /** Other zones that may serve as a parent (self + descendants excluded). */
  parentOptions?: { id: string; name: string }[]
  /** Closed ring [[lng,lat],…] (first == last). */
  ring: [number, number][]
}

/** ISO → the yyyy-MM-dd a date input wants (or ''). */
function dayInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/**
 * Zone editor: rename, recolor, and reshape. Vertices (solid dots) drag to
 * move — works with touch for iPad. Midpoints (hollow dots) tap to add a
 * vertex. Tap a vertex to select it, then "Delete vertex" removes it (min 3).
 */
export function GeofenceEditor({ id, name: initialName, color: initialColor, parentId, kind: initialKind = 'site', ownerId = null, isOwnedByMe = false, activeFrom: initialActiveFrom = null, activeUntil: initialActiveUntil = null, folderUrl: initialFolderUrl = null, notes: initialNotes = null, parentOptions = [], ring: initialRing }: GeofenceEditorProps) {
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
  const [kind, setKind] = useState<'site' | 'boundary' | 'yard' | 'vendor'>(initialKind)
  const [personal, setPersonal] = useState<boolean>(!!ownerId)
  const [activeFrom, setActiveFrom] = useState<string>(dayInput(initialActiveFrom))
  const [activeUntil, setActiveUntil] = useState<string>(dayInput(initialActiveUntil))
  // Folder + notes used to be two separate cards further down the page, each
  // with its own Save. They're plain zone fields, so they belong here and go
  // out with the one Save ("this needs to be more intuitive" — owner, Jul 30).
  const [folderUrl, setFolderUrl] = useState(initialFolderUrl ?? '')
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [parent, setParent] = useState<string>(parentId ?? '')
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
      // Hybrid by default: imagery + street/place labels, so you can read
      // WHICH road you're dragging the corner to.
      style: {
        version: 8,
        sources: {
          sat: { type: 'raster', tiles: [SAT], tileSize: 256, maxzoom: 19 },
          labels: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}@2x.png'], tileSize: 256, maxzoom: 19 },
        },
        layers: [
          { id: 'sat', type: 'raster', source: 'sat' },
          { id: 'labels', type: 'raster', source: 'labels' },
        ],
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
      await saveGeofenceAction(id, name.trim() || initialName, color, parent || null, {
        type: 'Polygon',
        coordinates: [closed],
      }, kind, {
        // Only the owner can keep a personal zone personal; a global zone can be
        // made personal by anyone who can edit it.
        personal: (isOwnedByMe || !ownerId) ? personal : undefined,
        active_from: activeFrom ? new Date(activeFrom + 'T00:00:00').toISOString() : null,
        active_until: activeUntil ? new Date(activeUntil + 'T23:59:59').toISOString() : null,
        clear_dates: !activeFrom && !activeUntil,
        folderUrl: folderUrl.trim(),
        notes,
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
      router.push('/zones')
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
        <div className="relative">
          <div ref={mapContainer} className="h-[320px] w-full" />
          {/* Delete vertex rides ON the mini map — you tap a corner up here,
              the delete belongs up here too (owner ask, Aug 6). */}
          {selected !== null && (
            <button
              type="button"
              onClick={deleteVertex}
              disabled={verts.length <= 3}
              className="absolute top-2 right-2 z-10 rounded-lg bg-navy-950/90 backdrop-blur border border-red-500/50 text-red-400 text-xs font-semibold px-2.5 py-1.5 shadow-md disabled:opacity-40 hover:bg-red-500/15"
            >
              Delete vertex #{selected + 1}
            </button>
          )}
        </div>
        <div className="p-3 space-y-3">
          <p className="text-[11px] text-faint">
            Drag a <span className="text-ink font-semibold">solid dot</span> to move a corner · tap a{' '}
            <span className="text-ink font-semibold">hollow dot</span> to add one · tap a corner and a Delete button appears on the map.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[160px]">
              <Label htmlFor="zone-name" className="text-xs">Zone name</Label>
              <Input id="zone-name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} />
            </div>
          <div className="space-y-1.5">
            <Label>Zone type</Label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => { setKind('site'); setDirty(true) }}
                className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (kind === 'site' ? 'border-amber bg-amber/10 text-amber' : 'border-navy-700 text-faint hover:text-ink')}>
                Job site
              </button>
              <button type="button" onClick={() => { setKind('boundary'); setDirty(true) }}
                className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (kind === 'boundary' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>
                Boundary
              </button>
          <button
            type="button"
            onClick={() => setKind('yard')}
            className={'px-2.5 py-1.5 rounded-lg border text-[11.5px] font-semibold transition-colors ' + (kind === 'yard' ? 'border-[#60a5fa] bg-[#60a5fa]/10 text-[#60a5fa]' : 'border-navy-700 text-faint hover:text-ink')}
          >
            Yard
          </button>
          <button
            type="button"
            onClick={() => { setKind('vendor'); setDirty(true) }}
            className={'px-2.5 py-1.5 rounded-lg border text-[11.5px] font-semibold transition-colors ' + (kind === 'vendor' ? 'border-[#a78bfa] bg-[#a78bfa]/10 text-[#c4b5fd]' : 'border-navy-700 text-faint hover:text-ink')}
          >
            Vendor
          </button>
            </div>
            <p className="text-[10.5px] text-faint leading-snug">Boundaries draw outline-only and skip usage/invoicing — use for theft perimeters. Vendors (supply houses) name every stop there and never count as job time.</p>
          </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <ColorSwatches value={color} onChange={(c) => { setColor(c); setDirty(true) }} />
            </div>
          </div>
          {/* Visibility — global (everyone) vs personal (only me). */}
          <div className="space-y-1.5 border-t border-navy-800 pt-3">
            <Label className="text-xs">Visibility</Label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => { setPersonal(false); setDirty(true) }}
                className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (!personal ? 'border-amber bg-amber/10 text-amber' : 'border-navy-700 text-faint hover:text-ink')}>
                🌐 Global (whole team)
              </button>
              <button type="button" onClick={() => { setPersonal(true); setDirty(true) }}
                disabled={!!ownerId && !isOwnedByMe}
                className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors disabled:opacity-40 ' + (personal ? 'border-[#a78bfa] bg-[#a78bfa]/10 text-[#c4b5fd]' : 'border-navy-700 text-faint hover:text-ink')}>
                🔒 Personal (only me)
              </button>
            </div>
            {personal && (
              <p className="text-[10.5px] text-amber/90 leading-snug rounded-lg bg-amber/5 border border-amber/30 px-2.5 py-2">
                ⚠️ A personal zone is private to you: teammates won&apos;t see it, it won&apos;t fire theft / enter-exit
                alerts to anyone, and it won&apos;t appear in shared reports or the daily site log. It&apos;s for your own
                reference only — not team coordination.
              </p>
            )}
          </div>

          {/* Optional job-site window — scopes cost totals + auto-archives. */}
          {kind !== 'boundary' && (
            <div className="space-y-1.5 border-t border-navy-800 pt-3">
              <Label className="text-xs">Project window <span className="text-faint font-normal">(optional — leave blank for ongoing)</span></Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] text-faint">Start</span>
                  <Input type="date" value={activeFrom} onChange={(e) => { setActiveFrom(e.target.value); setDirty(true) }} />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-faint">End</span>
                  <Input type="date" value={activeUntil} onChange={(e) => { setActiveUntil(e.target.value); setDirty(true) }} />
                </div>
              </div>
              <p className="text-[10.5px] text-faint leading-snug">Job-cost totals count activity within this window; a past end date archives the zone off the live map (history stays).</p>
            </div>
          )}

          {/* Project folder + notes — same fields the map's save dialog offers,
              so adding and editing a zone ask for the same things. */}
          <div className="space-y-3 border-t border-navy-800 pt-3">
            <div className="space-y-1">
              <Label htmlFor="zone-folder" className="text-xs">
                Project folder link <span className="text-faint font-normal">(optional)</span>
              </Label>
              <Input
                id="zone-folder" type="url" inputMode="url"
                placeholder="Dropbox / Drive / OneDrive folder URL"
                value={folderUrl}
                onChange={(e) => { setFolderUrl(e.target.value); setDirty(true) }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="zone-notes" className="text-xs">
                Notes <span className="text-faint font-normal">(gate codes, access, contacts — the AI reads these)</span>
              </Label>
              <textarea
                id="zone-notes" rows={3}
                placeholder="Gate code 4188 · call the super before 7am · no trucks on the east drive"
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setDirty(true) }}
                className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-ink placeholder:text-faint outline-none focus:border-amber resize-y"
              />
            </div>
            {parentOptions.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="zone-parent" className="text-xs">
                  Parent zone <span className="text-faint font-normal">(optional — nest under a larger site)</span>
                </Label>
                <select
                  id="zone-parent" value={parent}
                  onChange={(e) => { setParent(e.target.value); setDirty(true) }}
                  className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
                >
                  <option value="">None (top level)</option>
                  {parentOptions.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving || !dirty || verts.length < 3} className="gap-1.5">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
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
