'use client'

import { useEffect, useState } from 'react'
import { X, Check, Search, MapPin, Hexagon, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Last two are "boundary" colors — they render outline-only (no fill), for a
// large perimeter around the whole yard/work area (anti-theft) that shouldn't
// tint the map. Keep these in sync with OUTLINE_ONLY in MapView + ZonePanel.
const COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#0a0a0a', '#9ca3af']

interface GeofenceDrawerProps {
  isDrawing: boolean
  onFinishDraw: () => GeoJSON.Polygon | null
  onCancelDraw: () => void
  onSave?: (name: string, geometry: GeoJSON.Polygon, color: string, kind: 'site' | 'boundary') => void
  /** Fly the map to an address hit so the user can draw around it. */
  onLocate?: (lng: number, lat: number) => void
}

interface AddressHit { label: string; lng: number; lat: number }

export function GeofenceDrawer({
  isDrawing,
  onFinishDraw,
  onCancelDraw,
  onSave,
  onLocate,
}: GeofenceDrawerProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [pendingGeom, setPendingGeom] = useState<GeoJSON.Polygon | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [kind, setKind] = useState<'site' | 'boundary'>('site')

  // Address search while drawing — type a street address, jump there, click
  // out the corners. Free Photon geocoder (OSM data, CORS-open, no key).
  const [addr, setAddr] = useState('')
  const [hits, setHits] = useState<AddressHit[]>([])
  useEffect(() => {
    if (!isDrawing) { setAddr(''); setHits([]); return }
  }, [isDrawing])
  useEffect(() => {
    const q = addr.trim()
    if (q.length < 4) { setHits([]); return }
    const id = setTimeout(() => {
      fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=4&lang=en`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j?.features) { setHits([]); return }
          setHits(j.features.map((f: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }) => ({
            label: [f.properties.name ?? f.properties.street, f.properties.housenumber, f.properties.city, f.properties.state]
              .filter(Boolean).join(' ').slice(0, 64),
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })))
        })
        .catch(() => setHits([]))
    }, 300)
    return () => clearTimeout(id)
  }, [addr])

  const handleFinish = () => {
    const geom = onFinishDraw()
    if (!geom) {
      alert('Draw at least 3 points to create a geofence.')
      return
    }
    setPendingGeom(geom)
    setShowDialog(true)
  }

  const handleSave = () => {
    if (!pendingGeom || !name.trim()) return
    onSave?.(name.trim(), pendingGeom, color, kind)
    setShowDialog(false)
    setName('')
    setKind('site')
    setPendingGeom(null)
  }

  return (
    <>
      {/* The draw TRIGGER lives in the FilterBar ("+ New zone", beside Zones).
          These are the in-progress finish/cancel controls only. */}
      {isDrawing && (
        <div className="absolute bottom-[150px] left-3 z-10 flex flex-col gap-2 md:bottom-[140px] md:left-4">
          <button
            onClick={handleFinish}
            className="flex items-center justify-center w-12 h-12 bg-green-500 text-white rounded-full shadow-lg hover:bg-green-600 transition-colors"
            title="Finish geofence"
          >
            <Check className="h-5 w-5" />
          </button>
          <button
            onClick={onCancelDraw}
            className="flex items-center justify-center w-12 h-12 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-colors"
            title="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {isDrawing && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 w-[300px] flex flex-col items-center gap-1.5">
          <div className="bg-navy-950/90 backdrop-blur border border-navy-700 text-ink text-sm px-4 py-2 rounded-full shadow-panel pointer-events-none whitespace-nowrap">
            Click to add points • ✓ to finish • ✕ to cancel
          </div>
          {/* jump to an address, then click out the corners around it */}
          <div className="w-full bg-navy-950/90 backdrop-blur border border-navy-700 rounded-xl shadow-panel overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-teal flex-none" />
              <input
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder="Jump to address…"
                className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-faint outline-none"
              />
            </div>
            {hits.length > 0 && (
              <div className="border-t border-navy-800">
                {hits.map((h, i) => (
                  <button
                    key={i}
                    onMouseDown={(e) => { e.preventDefault(); onLocate?.(h.lng, h.lat); setAddr(''); setHits([]) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-muted hover:bg-navy-900 hover:text-ink"
                  >
                    <MapPin className="h-3 w-3 text-faint flex-none" />
                    <span className="truncate">{h.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Geofence</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="fence-name">Zone name</Label>
              <Input
                id="fence-name"
                placeholder="e.g. Main Site, Equipment Yard"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Zone type</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind('site')}
                  className={'rounded-lg border p-2.5 text-left transition-colors ' + (kind === 'site' ? 'border-amber bg-amber/10' : 'border-navy-700 hover:border-navy-600')}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Hexagon className="h-3.5 w-3.5 text-amber" /> Job site</span>
                  <span className="block mt-0.5 text-[10.5px] text-faint leading-snug">Site log, usage hours, invoicing</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKind('boundary')}
                  className={'rounded-lg border p-2.5 text-left transition-colors ' + (kind === 'boundary' ? 'border-teal bg-teal/10' : 'border-navy-700 hover:border-navy-600')}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Shield className="h-3.5 w-3.5 text-teal" /> Boundary</span>
                  <span className="block mt-0.5 text-[10.5px] text-faint leading-snug">Outline only — exit &amp; after-hours alerts</span>
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? '#e8f0f7' : 'rgba(255,255,255,0.18)',
                    }}
                    title={c === '#0a0a0a' ? 'Black outline (no fill)' : c === '#9ca3af' ? 'Gray outline (no fill)' : undefined}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowDialog(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!name.trim()} className="flex-1">
                Save Zone
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
