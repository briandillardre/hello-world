'use client'

import { useEffect, useState } from 'react'
import { X, Search, MapPin, Hexagon, Shield, ChevronDown, ChevronRight } from 'lucide-react'
import type { ZoneFormOpts } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ColorSwatches } from '@/components/ui/color-swatches'
import { toast } from '@/components/ui/feedback'

// Swatches + custom well come from the shared picker (lib/colors) — one
// palette for every zone/asset color choice in the app.
const DEFAULT_COLOR = '#F59E0B'

interface GeofenceDrawerProps {
  isDrawing: boolean
  onFinishDraw: () => GeoJSON.Polygon | null
  onCancelDraw: () => void
  onSave?: (name: string, geometry: GeoJSON.Polygon, color: string, kind: 'site' | 'boundary' | 'yard' | 'vendor', opts?: ZoneFormOpts) => void
  /** Fly the map to an address hit so the user can draw around it. */
  /** Fly to the hit AND drop a marker there, so the searched address stays
   *  visible while you click out the corners around it. */
  onLocate?: (lng: number, lat: number, label: string) => void
  /** Existing zones, so a new one can be nested under a parent site — same
   *  choice the zone-edit page offers (add/edit parity, owner ask Jul 30). */
  zones?: { id: string; name: string }[]
}

interface AddressHit { label: string; lng: number; lat: number }

export function GeofenceDrawer({
  isDrawing,
  onFinishDraw,
  onCancelDraw,
  onSave,
  onLocate,
  zones = [],
}: GeofenceDrawerProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [pendingGeom, setPendingGeom] = useState<GeoJSON.Polygon | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [kind, setKind] = useState<'site' | 'boundary' | 'yard' | 'vendor'>('site')
  const [personal, setPersonal] = useState(false)
  // Project document folder (Dropbox/Drive/OneDrive) — one link per job, so
  // plans and photos are a tap from the zone everywhere it appears.
  const [folderUrl, setFolderUrl] = useState('')
  // Everything the zone-edit page can set, set here too — the add and edit
  // forms drifted apart and the owner caught it (Jul 30). Secondary fields sit
  // behind a disclosure so the common "name it and go" path stays one screen.
  const [notes, setNotes] = useState('')
  const [parent, setParent] = useState('')
  const [activeFrom, setActiveFrom] = useState('')
  const [activeUntil, setActiveUntil] = useState('')
  const [more, setMore] = useState(false)

  // Address search while drawing — type a street address, jump there, click
  // out the corners. Free Photon geocoder (OSM data, CORS-open, no key).
  // Collapsed behind its icon so the draw toolbar stays one tidy row.
  const [searchOpen, setSearchOpen] = useState(false)
  const [addr, setAddr] = useState('')
  const [hits, setHits] = useState<AddressHit[]>([])
  useEffect(() => {
    if (!isDrawing) { setAddr(''); setHits([]); setSearchOpen(false); return }
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
      toast('Tap at least 3 corners to outline the zone', { variant: 'info' })
      return
    }
    setPendingGeom(geom)
    setShowDialog(true)
  }

  const handleSave = () => {
    if (!pendingGeom || !name.trim()) return
    onSave?.(name.trim(), pendingGeom, color, kind, {
      personal,
      folderUrl: folderUrl.trim() || undefined,
      notes: notes.trim() || undefined,
      parentId: parent || null,
      active_from: activeFrom ? new Date(activeFrom + 'T00:00:00').toISOString() : null,
      active_until: activeUntil ? new Date(activeUntil + 'T23:59:59').toISOString() : null,
    })
    setShowDialog(false)
    setName('')
    setKind('site')
    setPersonal(false)
    setFolderUrl('')
    setNotes('')
    setParent('')
    setActiveFrom('')
    setActiveUntil('')
    setMore(false)
    setPendingGeom(null)
  }

  return (
    <>
      {/* The draw TRIGGER lives in the FilterBar ("+ New zone", beside Zones).
          In-progress controls mirror the measure tool's slim top strip
          (the floating green/red circles + banner "looked mickey mouse",
          "needs similar feel to the measurements button" — Brian, Aug 11):
          toolbar row with X + amber Done, amber mono hint line under it,
          address search folded behind a chip on the hint row. Phones get
          the full-bleed strip; md+ floats the same card centered. */}
      {isDrawing && (
        <div className="absolute top-[var(--ht-map-top,0px)] inset-x-0 z-30 md:top-2 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[440px]">
          <div className="bg-navy-950/95 backdrop-blur md:border md:border-navy-700 md:rounded-xl md:shadow-panel md:overflow-hidden">
            <div className="flex items-center gap-1 px-1.5 py-1 border-b border-amber/30">
              <button onClick={onCancelDraw} className="p-1.5 text-faint hover:text-ink flex-none" aria-label="Cancel zone drawing"><X className="h-4 w-4" /></button>
              <Hexagon className="h-3.5 w-3.5 text-amber flex-none" />
              <span className="font-display font-bold text-[12px] text-ink flex-none">New zone</span>
              <span className="flex-1" />
              <button
                onClick={handleFinish}
                className="flex-none rounded-md bg-amber text-[#1a1100] font-display font-bold text-[11.5px] px-3 py-1.5 hover:bg-amber-600 transition-colors"
              >
                Done
              </button>
            </div>
            {/* hint line — same treatment as the measure readout strip */}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-navy-950/85 border-b border-navy-800">
              <span className="font-mono text-[11.5px] text-amber truncate flex-1">Tap corners to outline the zone</span>
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className={'flex-none flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors ' + (searchOpen ? 'bg-navy-800 text-teal' : 'text-faint hover:text-ink')}
                aria-label="Jump to address"
                aria-expanded={searchOpen}
              >
                <Search className="h-3 w-3" /> address
              </button>
            </div>
            {/* jump to an address, then tap out the corners around it */}
            {searchOpen && (
              <div className="bg-navy-950/85 border-b border-navy-800">
                <div className="flex items-center gap-1.5 px-3 py-2">
                  <Search className="h-3.5 w-3.5 text-teal flex-none" />
                  <input
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                    placeholder="Jump to address…"
                    autoFocus
                    className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-faint outline-none"
                  />
                </div>
                {hits.length > 0 && (
                  <div className="border-t border-navy-800">
                    {hits.map((h, i) => (
                      <button
                        key={i}
                        onMouseDown={(e) => { e.preventDefault(); onLocate?.(h.lng, h.lat, h.label); setAddr(''); setHits([]); setSearchOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-muted hover:bg-navy-900 hover:text-ink"
                      >
                        <MapPin className="h-3 w-3 text-faint flex-none" />
                        <span className="truncate">{h.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        {/* Cap the height: the form now carries every field the zone-edit page
            has, which overflows a phone screen without this. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Save zone</DialogTitle>
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
              <Label htmlFor="fence-folder">Project folder link <span className="text-faint font-normal">(optional)</span></Label>
              <Input
                id="fence-folder"
                type="url"
                inputMode="url"
                placeholder="Dropbox / Drive / OneDrive folder URL"
                value={folderUrl}
                onChange={e => setFolderUrl(e.target.value)}
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
                <button
                  type="button"
                  onClick={() => setKind('yard')}
                  className={'rounded-lg border p-2.5 text-left transition-colors ' + (kind === 'yard' ? 'border-[#60a5fa] bg-[#60a5fa]/10' : 'border-navy-700 hover:border-navy-600')}
                >
                  <span className="block text-[12.5px] font-semibold text-ink">Yard / storage</span>
                  <span className="block text-[10.5px] text-faint mt-0.5">Where iron sleeps — presence &amp; alerts, no job costs</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKind('vendor')}
                  className={'rounded-lg border p-2.5 text-left transition-colors ' + (kind === 'vendor' ? 'border-[#a78bfa] bg-[#a78bfa]/10' : 'border-navy-700 hover:border-navy-600')}
                >
                  <span className="block text-[12.5px] font-semibold text-ink">Vendor / supplier</span>
                  <span className="block text-[10.5px] text-faint mt-0.5">Supply house — names every stop, never job time</span>
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <ColorSwatches value={color} onChange={setColor} />
            </div>
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setPersonal(false)}
                  className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (!personal ? 'border-amber bg-amber/10 text-amber' : 'border-navy-700 text-faint hover:text-ink')}>
                  🌐 Global (whole team)
                </button>
                <button type="button" onClick={() => setPersonal(true)}
                  className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (personal ? 'border-[#a78bfa] bg-[#a78bfa]/10 text-[#c4b5fd]' : 'border-navy-700 text-faint hover:text-ink')}>
                  🔒 Personal (only me)
                </button>
              </div>
              {personal && (
                <p className="text-[10.5px] text-amber/90 leading-snug rounded-lg bg-amber/5 border border-amber/30 px-2.5 py-2">
                  ⚠️ A personal zone is private to you: teammates won&apos;t see it, it won&apos;t fire theft / enter-exit
                  alerts, and it won&apos;t appear in shared reports or the daily site log. For your own reference only.
                </p>
              )}
            </div>
            {/* Secondary settings — same ones the zone page offers. Collapsed by
                default so naming a zone and hitting Save stays a two-tap job. */}
            <div className="border-t border-navy-800 pt-3">
              <button
                type="button"
                onClick={() => setMore((v) => !v)}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink"
              >
                {more ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                More options
                <span className="font-normal text-faint">(notes, project dates{zones.length ? ', parent zone' : ''})</span>
              </button>
              {more && (
                <div className="space-y-3 pt-3">
                  <div className="space-y-2">
                    <Label htmlFor="fence-notes">
                      Notes <span className="text-faint font-normal">(gate codes, access — the AI reads these)</span>
                    </Label>
                    <textarea
                      id="fence-notes" rows={3}
                      placeholder="Gate code 4188 · call before 7am · no trucks on the east drive"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-ink placeholder:text-faint outline-none focus:border-amber resize-y"
                    />
                  </div>
                  {kind !== 'boundary' && (
                    <div className="space-y-2">
                      <Label>Project window <span className="text-faint font-normal">(optional — blank = ongoing)</span></Label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] text-faint">Start</span>
                          <Input type="date" value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-faint">End</span>
                          <Input type="date" value={activeUntil} onChange={(e) => setActiveUntil(e.target.value)} />
                        </div>
                      </div>
                      <p className="text-[10.5px] text-faint leading-snug">Job-cost totals count activity in this window; a past end date archives the zone off the live map.</p>
                    </div>
                  )}
                  {zones.length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="fence-parent">Parent zone <span className="text-faint font-normal">(optional — nest under a larger site)</span></Label>
                      <select
                        id="fence-parent" value={parent} onChange={(e) => setParent(e.target.value)}
                        className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
                      >
                        <option value="">None (top level)</option>
                        {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
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
