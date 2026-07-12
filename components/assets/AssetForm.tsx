'use client'

import { useRef, useState } from 'react'
import type { AssetType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TRAIL_PALETTE } from '@/lib/trails'

export interface AssetFormData {
  name: string
  type: AssetType
  category: string
  serial: string
  photo_url: string
  tracker_id: string
  metadata: Record<string, unknown>
  hourly_rate: number | null
  mileage_rate: number | null
  daily_cost: number | null
  purchase_value: number | null
}

/** Which cost fields make sense per asset type, with owner-friendly labels. */
export const COST_FIELDS: Record<AssetType, { key: 'hourly_rate' | 'mileage_rate' | 'daily_cost' | 'purchase_value'; label: string; hint: string }[]> = {
  vehicle: [
    { key: 'hourly_rate', label: 'Operating $/hr', hint: 'fuel + wear while running' },
    { key: 'mileage_rate', label: '$/mile', hint: 'per-mile cost (IRS-style)' },
    { key: 'daily_cost', label: 'Ownership $/day', hint: 'payment, insurance, depreciation' },
    { key: 'purchase_value', label: 'Replacement $', hint: 'what it costs to replace' },
  ],
  equipment: [
    { key: 'hourly_rate', label: 'Operating $/engine-hr', hint: 'fuel + wear per engine hour' },
    { key: 'daily_cost', label: 'Ownership $/day', hint: 'payment, insurance, depreciation' },
    { key: 'purchase_value', label: 'Replacement $', hint: 'what it costs to replace' },
  ],
  personnel: [
    { key: 'hourly_rate', label: 'Loaded labor $/hr', hint: 'wage + burden (taxes, insurance)' },
  ],
  tool: [
    { key: 'purchase_value', label: 'Replacement $', hint: 'what it costs to replace' },
    { key: 'daily_cost', label: 'Ownership $/day', hint: 'optional — rental-equivalent' },
  ],
}

/** Parse a cost input: '' → null, otherwise a non-negative number or null. */
export function parseCost(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

interface AssetFormProps {
  onClose: () => void
  onSubmit: (data: AssetFormData, photo?: Blob | null) => void
  saving?: boolean
  initial?: { name: string; type: AssetType; tracker_id: string; category?: string; serial?: string; photo_url?: string;
    metadata?: Record<string, unknown>;
    hourly_rate?: number | null; mileage_rate?: number | null; daily_cost?: number | null; purchase_value?: number | null }
}

/**
 * Downscale a chosen photo to ≤maxDim px and re-encode as JPEG so phone
 * camera shots (5-10 MB HEIC/JPEG) become a few hundred KB before upload.
 * Falls back to the original file if decoding fails (e.g. exotic formats).
 */
async function resizePhoto(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality)
    )
  } catch {
    return file
  }
}

// Common truck makes + the equipment brands a GC actually owns. Free text
// still works — these just save the typing.
const MAKE_SUGGESTIONS = [
  'Ford', 'Chevrolet', 'GMC', 'Ram', 'Toyota', 'Nissan', 'Honda', 'Jeep', 'Dodge', 'Volkswagen',
  'Freightliner', 'International', 'Kenworth', 'Peterbilt', 'Mack', 'Isuzu', 'Hino',
  'Caterpillar', 'John Deere', 'Bobcat', 'Kubota', 'Case', 'Komatsu', 'Volvo', 'JCB',
  'New Holland', 'Takeuchi', 'Yanmar', 'Doosan', 'Develon', 'Hitachi', 'Link-Belt',
  'Genie', 'JLG', 'Skyjack', 'Vermeer', 'Ditch Witch', 'Wacker Neuson', 'Multiquip', 'Toro',
]

export function AssetForm({ onClose, onSubmit, saving = false, initial }: AssetFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<AssetType>(initial?.type ?? 'vehicle')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [serial, setSerial] = useState(initial?.serial ?? '')
  const [photoUrl, setPhotoUrl] = useState(initial?.photo_url ?? '')
  const [trackerId, setTrackerId] = useState(initial?.tracker_id ?? '')
  const [photo, setPhoto] = useState<Blob | null>(null)
  // Specs (year/make/model/engine…) — hand-entered on edit or filled by the
  // free NHTSA VIN decoder. Rendered as Details rows on the asset page.
  const [specs, setSpecs] = useState<Record<string, unknown>>(initial?.metadata ?? {})
  const [decoding, setDecoding] = useState(false)
  const [decodeMsg, setDecodeMsg] = useState<string | null>(null)

  const setSpecField = (key: string, value: string) =>
    setSpecs((prev) => {
      const next = { ...prev }
      if (value.trim() === '') delete next[key]
      else next[key] = value
      return next
    })

  // Model typeahead: once a make is picked, pull its model list from the
  // federal vehicle database (vPIC — free, keyless, CORS-open). Equipment
  // brands mostly aren't in it; the field stays free text either way.
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const modelFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadModels = (make: string) => {
    if (modelFetchTimer.current) clearTimeout(modelFetchTimer.current)
    const mk = make.trim()
    if (mk.length < 3) { setModelOptions([]); return }
    modelFetchTimer.current = setTimeout(() => {
      fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(mk)}?format=json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { Results?: { Model_Name?: string }[] } | null) => {
          const names = Array.from(new Set((j?.Results ?? []).map((x) => x.Model_Name).filter((n): n is string => !!n))).sort()
          setModelOptions(names.slice(0, 200))
        })
        .catch(() => setModelOptions([]))
    }, 350)
  }

  const decodeVin = async () => {
    setDecoding(true)
    setDecodeMsg(null)
    try {
      const r = await fetch(`/api/vin-decode?vin=${encodeURIComponent(serial.trim())}`)
      const j = await r.json()
      if (!r.ok) { setDecodeMsg(j.error ?? 'Decode failed.'); return }
      setSpecs((prev) => ({ ...prev, ...j.specs }))
      if (!name.trim() && j.suggestedName) setName(j.suggestedName)
      setDecodeMsg(`✓ ${Object.keys(j.specs).length} specs added`)
    } catch {
      setDecodeMsg('Decoder unreachable.')
    } finally {
      setDecoding(false)
    }
  }
  const [valuing, setValuing] = useState(false)
  const estimateValue = async () => {
    if (!name.trim() || valuing) return
    setValuing(true)
    setDecodeMsg(null)
    try {
      const r = await fetch('/api/value-estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, specs }),
      })
      const j = await r.json()
      if (!r.ok) { setDecodeMsg(j.error === 'AI key not configured' ? 'Needs the AI key in Vercel first.' : (j.error ?? 'Estimate failed.')); return }
      setSpecs((prev) => ({ ...prev, value_range: j.range }))
      setDecodeMsg(`✓ Market value ${j.range}${j.note ? ` — ${j.note}` : ''}`)
    } catch {
      setDecodeMsg('Estimator unreachable.')
    } finally {
      setValuing(false)
    }
  }
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Cost inputs kept as strings while typing; parsed on submit.
  const [costs, setCosts] = useState<Record<string, string>>(() => ({
    hourly_rate: initial?.hourly_rate != null ? String(initial.hourly_rate) : '',
    mileage_rate: initial?.mileage_rate != null ? String(initial.mileage_rate) : '',
    daily_cost: initial?.daily_cost != null ? String(initial.daily_cost) : '',
    purchase_value: initial?.purchase_value != null ? String(initial.purchase_value) : '',
  }))

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoBusy(true)
    try {
      const resized = await resizePhoto(file)
      setPhoto(resized)
      if (photoPreview) URL.revokeObjectURL(photoPreview)
      setPhotoPreview(URL.createObjectURL(resized))
    } finally {
      setPhotoBusy(false)
    }
  }

  const clearPhoto = () => {
    setPhoto(null)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(), type,
      category: category.trim(), serial: serial.trim(), photo_url: photoUrl.trim(),
      tracker_id: trackerId.trim(), metadata: specs,
      hourly_rate: parseCost(costs.hourly_rate ?? ''),
      mileage_rate: parseCost(costs.mileage_rate ?? ''),
      daily_cost: parseCost(costs.daily_cost ?? ''),
      purchase_value: parseCost(costs.purchase_value ?? ''),
    }, photo)
  }

  return (
    <Dialog open onOpenChange={onClose}>
      {/* Form grew past small viewports (cost section) — scroll inside the dialog */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Asset' : 'Add New Asset'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="asset-name">Asset name *</Label>
            <Input
              id="asset-name"
              placeholder="e.g. F-350 Truck #1, CAT Excavator"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-type">Type *</Label>
            <Select value={type} onValueChange={v => setType(v as AssetType)}>
              <SelectTrigger id="asset-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vehicle">🚛 Vehicle</SelectItem>
                <SelectItem value="equipment">🏗️ Equipment</SelectItem>
                <SelectItem value="personnel">👷 Personnel</SelectItem>
                <SelectItem value="tool">🔧 Small Tool</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="asset-category">Category</Label>
              <Input
                id="asset-category"
                placeholder="e.g. Dozers, Pickups, Crew A"
                value={category}
                onChange={e => setCategory(e.target.value)}
                list="asset-category-suggestions"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-serial">Serial / VIN</Label>
              <Input
                id="asset-serial"
                placeholder="e.g. 1FT8W3DT5..."
                value={serial}
                onChange={e => setSerial(e.target.value)}
              />
              {type === 'vehicle' && serial.trim().length >= 11 && (
                <button
                  type="button"
                  onClick={decodeVin}
                  disabled={decoding}
                  className="text-[12px] font-semibold text-teal hover:underline disabled:opacity-50"
                >
                  {decoding ? 'Decoding…' : 'Decode VIN → fill specs'}
                </button>
              )}
              {decodeMsg && <p className="text-[11px] text-faint">{decodeMsg}</p>}
            </div>
          </div>

          {Object.keys(specs).filter((k) => k !== 'notes' && k !== 'color').length > 0 && (
            <div className="rounded-lg border border-navy-800 bg-navy-950/50 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Specs</p>
                <button
                  type="button"
                  onClick={() => setSpecs((prev) => {
                    // Clear decoded/typed specs but keep notes + color — they
                    // have their own inputs and aren't part of this chip strip.
                    const kept: Record<string, unknown> = {}
                    if (prev.notes != null) kept.notes = prev.notes
                    if (prev.color != null) kept.color = prev.color
                    return kept
                  })}
                  className="text-[11px] text-faint hover:text-alert"
                >clear</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(specs).filter(([k]) => k !== 'notes' && k !== 'color').map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 rounded-md bg-navy-800 text-[11px] text-muted">
                    <span className="text-faint">{k.replace(/_/g, ' ')}:</span> <span className="text-ink">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Year / Make / Model — typeahead for vehicles & equipment. Make
              suggests common truck + equipment brands; picking one live-loads
              its model list from the federal vehicle database (vPIC). No VIN
              needed — name-based entry gets real specs too. */}
          {(type === 'vehicle' || type === 'equipment') && (
            <div className="rounded-lg border border-navy-800 bg-navy-950/50 p-3 space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Year · Make · Model (optional)</p>
              <div className="grid grid-cols-[70px_1fr_1fr] gap-2">
                <input
                  value={String(specs.year ?? '')}
                  onChange={(e) => setSpecField('year', e.target.value)}
                  placeholder="Year"
                  inputMode="numeric"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
                <input
                  value={String(specs.make ?? '')}
                  onChange={(e) => { setSpecField('make', e.target.value); loadModels(e.target.value) }}
                  placeholder="Make"
                  list="asset-make-suggestions"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
                <input
                  value={String(specs.model ?? '')}
                  onChange={(e) => setSpecField('model', e.target.value)}
                  placeholder="Model"
                  list="asset-model-suggestions"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
              </div>
              <datalist id="asset-make-suggestions">
                {MAKE_SUGGESTIONS.map((mk) => <option key={mk} value={mk} />)}
              </datalist>
              <datalist id="asset-model-suggestions">
                {modelOptions.map((mo) => <option key={mo} value={mo} />)}
              </datalist>
              {modelOptions.length > 0 && (
                <p className="text-[10.5px] text-faint">{modelOptions.length} known models for {String(specs.make)} — keep typing to filter.</p>
              )}
            </div>
          )}

          {/* Map color — one choice drives the dot, the trail line, and the
              Command Center radar blip. Auto = the stable per-asset palette. */}
          <div className="space-y-1.5">
            <Label>Dot &amp; trail color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSpecField('color', '')}
                className={
                  'h-7 px-2.5 rounded-full border text-[11px] font-semibold transition-colors ' +
                  (!specs.color
                    ? 'border-teal text-teal bg-teal/10'
                    : 'border-navy-700 text-faint hover:text-muted')
                }
              >
                Auto
              </button>
              {TRAIL_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use color ${c}`}
                  onClick={() => setSpecField('color', c)}
                  className={
                    'h-7 w-7 rounded-full border-2 transition-transform ' +
                    (specs.color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105')
                  }
                  style={{ background: c, boxShadow: specs.color === c ? `0 0 8px ${c}` : undefined }}
                />
              ))}
            </div>
            <p className="text-[10px] text-faint leading-tight">Used on the map dot, trail line, and radar dial. Auto assigns a stable color.</p>
          </div>

          {/* Open-ended notes — the AI reads these, so "V6 engine, takes
              0W-20, spare key in office" becomes something you can ask about. */}
          <div className="space-y-1.5">
            <Label htmlFor="asset-notes">Notes (the AI reads these)</Label>
            <textarea
              id="asset-notes"
              value={String(specs.notes ?? '')}
              onChange={(e) => setSpecField('notes', e.target.value)}
              rows={2}
              placeholder="e.g. V6 engine · takes 0W-20 · spare key in office · pulls the 12k trailer"
              className="w-full bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 resize-y"
            />
          </div>

          {/* Service specs — the numbers on the shop wall: what oil, which
              filter, what tires. Hand-typed once; receipts can fill them later. */}
          <div className="rounded-lg border border-navy-800 bg-navy-950/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Service specs (optional)</p>
              <button
                type="button"
                onClick={estimateValue}
                disabled={valuing || !name.trim()}
                className="text-[11px] font-semibold text-teal hover:text-ink disabled:opacity-40"
              >
                {valuing ? 'Estimating…' : specs.value_range ? `Value: ${String(specs.value_range)} ↻` : 'AI market value'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([['oil', 'Oil (e.g. 0W-30 Euro)'], ['oil_filter', 'Oil filter #'], ['air_filter', 'Air filter #'], ['tires', 'Tire size']] as const).map(([key, ph]) => (
                <input
                  key={key}
                  value={String(specs[key] ?? '')}
                  onChange={(e) => setSpecs((prev) => {
                    const next = { ...prev }
                    if (e.target.value.trim() === '') delete next[key]
                    else next[key] = e.target.value
                    return next
                  })}
                  placeholder={ph}
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-photo-file">Photo</Label>
            <input
              ref={fileInputRef}
              id="asset-photo-file"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoPick}
            />
            {photoPreview || photoUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview ?? photoUrl} alt="Asset photo preview" className="h-16 w-16 rounded-lg object-cover border border-navy-700" />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Change
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => { clearPhoto(); setPhotoUrl('') }}>
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={photoBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {photoBusy ? 'Processing…' : '📷 Take photo or choose from library'}
              </Button>
            )}
            {!photo && !photoUrl && (
              <Input
                id="asset-photo"
                placeholder="…or paste a photo URL"
                value={photoUrl}
                onChange={e => setPhotoUrl(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tracker-id">Tracker ID</Label>
            <Input
              id="tracker-id"
              placeholder="e.g. obd-001, bt-042, gps-007"
              value={trackerId}
              onChange={e => setTrackerId(e.target.value)}
            />
            <p className="text-xs text-faint">
              The tracker_id sent in POST /api/ingest/location payloads.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-navy-800 p-3">
            <p className="text-sm font-medium text-ink">Cost structure <span className="text-faint font-normal">(powers job-cost tracking)</span></p>
            <div className="grid grid-cols-2 gap-3">
              {COST_FIELDS[type].map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`cost-${f.key}`} className="text-xs">{f.label}</Label>
                  <Input
                    id={`cost-${f.key}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={costs[f.key] ?? ''}
                    onChange={(e) => setCosts((c) => ({ ...c, [f.key]: e.target.value }))}
                  />
                  <p className="text-[10px] text-faint leading-tight">{f.hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving} className="flex-1">
              {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Asset'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
