'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetType, AssetPhoto } from '@/lib/types'
import { ASSET_ICONS, ICON_GROUPS, TYPE_DEFAULT_ICON, iconPreviewDataUrl } from '@/lib/asset-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ColorSwatches } from '@/components/ui/color-swatches'

export interface AssetFormData {
  name: string
  type: AssetType
  category: string
  serial: string
  photo_url: string
  /** Document folder (Dropbox/Drive/OneDrive) — same field zones carry. */
  folder_url: string
  tracker_id: string
  metadata: Record<string, unknown>
  hourly_rate: number | null
  mileage_rate: number | null
  daily_cost: number | null
  purchase_price: number | null
  purchase_value: number | null
}

/** A photo chosen in the form but not yet uploaded (blob + its label). */
export interface NewPhoto {
  blob: Blob
  preview: string
  label: string
}

/** Suggested labels for the different shots a truck/asset needs. Free-text via
 *  "Other" isn't offered here — these six cover the field's real needs. */
export const PHOTO_LABELS: [string, string][] = [
  ['truck', 'Truck / unit'],
  ['gvwr', 'GVWR sticker'],
  ['vin', 'VIN plate'],
  ['engine', 'Engine'],
  ['issue', 'Issue / damage'],
  ['other', 'Other'],
]
const labelText = (v: string | null) => PHOTO_LABELS.find(([k]) => k === v)?.[1] ?? (v || 'Photo')

/** Pack new photos into FormData (repeatable `photo` + parallel `labels` JSON)
 *  for the create/update server actions. Undefined when there are none. */
export function photosToFormData(photos: NewPhoto[]): FormData | undefined {
  if (!photos.length) return undefined
  const fd = new FormData()
  photos.forEach((p, i) => fd.append('photo', p.blob, `photo-${i}.jpg`))
  fd.append('labels', JSON.stringify(photos.map((p) => p.label || null)))
  return fd
}

/** Which cost fields make sense per asset type, with owner-friendly labels. */
export const COST_FIELDS: Record<AssetType, { key: 'hourly_rate' | 'mileage_rate' | 'daily_cost' | 'purchase_price' | 'purchase_value'; label: string; hint: string }[]> = {
  vehicle: [
    { key: 'hourly_rate', label: 'Operating $/hr', hint: 'fuel + wear while running' },
    { key: 'mileage_rate', label: '$/mile', hint: 'per-mile cost (IRS-style)' },
    { key: 'daily_cost', label: 'Ownership $/day', hint: 'payment, insurance, depreciation' },
    { key: 'purchase_price', label: 'Purchase price $', hint: 'what you paid for it' },
    { key: 'purchase_value', label: 'Replacement $', hint: 'what it costs to replace today' },
  ],
  equipment: [
    { key: 'hourly_rate', label: 'Operating $/engine-hr', hint: 'fuel + wear per engine hour' },
    { key: 'daily_cost', label: 'Ownership $/day', hint: 'payment, insurance, depreciation' },
    { key: 'purchase_price', label: 'Purchase price $', hint: 'what you paid for it' },
    { key: 'purchase_value', label: 'Replacement $', hint: 'what it costs to replace today' },
  ],
  personnel: [
    { key: 'hourly_rate', label: 'Loaded labor $/hr', hint: 'wage + burden (taxes, insurance)' },
  ],
  tool: [
    { key: 'purchase_price', label: 'Purchase price $', hint: 'what you paid for it' },
    { key: 'purchase_value', label: 'Replacement $', hint: 'what it costs to replace today' },
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
  onSubmit: (data: AssetFormData, photos?: NewPhoto[]) => void
  saving?: boolean
  /** Save error from the parent — rendered next to the buttons INSIDE the
   *  dialog (a header banner behind the modal looked like a dead Add button). */
  error?: string | null
  initial?: { name: string; type: AssetType; tracker_id: string; category?: string; serial?: string; photo_url?: string; folder_url?: string | null;
    metadata?: Record<string, unknown>;
    hourly_rate?: number | null; mileage_rate?: number | null; daily_cost?: number | null; purchase_price?: number | null; purchase_value?: number | null }
  /** Existing gallery photos (edit mode). */
  initialPhotos?: AssetPhoto[]
  /** Delete an already-saved gallery photo (edit mode); resolves on success. */
  onDeleteExistingPhoto?: (photo: AssetPhoto) => Promise<void>
  /** Persist a new order of saved photos (drag / make-thumbnail). */
  onReorderPhotos?: (orderedIds: string[]) => Promise<void>
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

// Map-dot colors by type — mirrors the map's ASSET_COLORS so the picker
// previews exactly what the dot will look like on the live map.
const TYPE_PUCK_COLORS: Record<AssetType, string> = {
  vehicle: '#ff9e16', equipment: '#60a5fa', personnel: '#34d399', tool: '#a78bfa',
}

function IconPicker({ value, type, puck, onChange }: {
  value: string; type: AssetType; puck: string; onChange: (key: string) => void
}) {
  // Previews are canvas-rendered — client only, so SSR markup stays stable.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  // Deferred: dragging the rainbow color well fires input events at pointer
  // rate, and each puck change re-encodes 28 canvases — defer so the grid
  // repaints once per settled color, not per pointer move (ship-check).
  const settledPuck = useDeferredValue(puck)
  const previews = useMemo(() => {
    if (!mounted) return {} as Record<string, string>
    return Object.fromEntries(Object.keys(ASSET_ICONS).map((k) => [k, iconPreviewDataUrl(k, settledPuck)]))
  }, [mounted, settledPuck])
  const autoKey = TYPE_DEFAULT_ICON[type]
  return (
    <div className="space-y-1.5">
      <Label>Map icon</Label>
      <div className="rounded-lg border border-navy-800 bg-navy-950/50 p-2.5 space-y-2">
        <button
          type="button"
          onClick={() => onChange('')}
          className={
            'flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border text-[11px] font-semibold transition-colors ' +
            (!value ? 'border-teal text-teal bg-teal/10' : 'border-navy-700 text-faint hover:text-muted')
          }
        >
          {mounted && previews[autoKey]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={previews[autoKey]} alt="" width={24} height={24} className="rounded-full" draggable={false} />
            : <span className="inline-block w-6 h-6 rounded-full bg-navy-800" />}
          Auto — follows type ({ASSET_ICONS[autoKey]?.label ?? 'default'})
        </button>
        {ICON_GROUPS.map((group) => {
          const entries = Object.entries(ASSET_ICONS).filter(([, d]) => d.group === group)
          if (!entries.length) return null
          return (
            <div key={group}>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint mb-1">{group}</p>
              <div className="flex flex-wrap gap-1.5">
                {entries.map(([k, d]) => (
                  <button
                    key={k} type="button" title={d.label} aria-label={d.label}
                    onClick={() => onChange(value === k ? '' : k)}
                    className={
                      'grid place-items-center w-10 h-10 rounded-lg border transition-colors ' +
                      (value === k ? 'border-amber bg-amber/10' : 'border-navy-700 hover:border-navy-500')
                    }
                  >
                    {mounted && previews[k]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={previews[k]} alt={d.label} width={30} height={30} draggable={false} />
                      : <span className="inline-block w-[30px] h-[30px] rounded-full bg-navy-800" />}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        <p className="text-[10px] text-faint leading-tight">Shows inside the asset&rsquo;s dot on the live map and replays. Tap the selected icon again to go back to Auto.</p>
      </div>
    </div>
  )
}

export function AssetForm({ onClose, onSubmit, saving = false, error = null, initial, initialPhotos = [], onDeleteExistingPhoto, onReorderPhotos }: AssetFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<AssetType>(initial?.type ?? 'vehicle')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [serial, setSerial] = useState(initial?.serial ?? '')
  const [trackerId, setTrackerId] = useState(initial?.tracker_id ?? '')
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

  // Model typeahead: once a make (and ideally year) is picked, pull its model
  // list from the federal vehicle database (vPIC — free, keyless, CORS-open).
  // Filtering by year gives the right generation's models. Equipment brands
  // mostly aren't in it; the field stays free text either way.
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const modelFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadModels = (make: string, year: string) => {
    if (modelFetchTimer.current) clearTimeout(modelFetchTimer.current)
    const mk = make.trim()
    if (mk.length < 3) { setModelOptions([]); return }
    const yr = year.trim()
    modelFetchTimer.current = setTimeout(() => {
      const url = /^(19|20)\d{2}$/.test(yr)
        ? `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(mk)}/modelyear/${yr}?format=json`
        : `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(mk)}?format=json`
      fetch(url)
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

  // AI advisor — infers service specs or cost structure from the entered
  // identity (year/make/model/engine/type). Fills only EMPTY fields so it
  // advises without stomping anything typed. Cost is meant to be the last
  // thing done, after the identity is in.
  const [advising, setAdvising] = useState<null | 'service' | 'cost'>(null)
  const advise = async (scope: 'service' | 'cost') => {
    if (advising) return
    setAdvising(scope)
    setDecodeMsg(null)
    try {
      const r = await fetch('/api/asset-advisor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type, specs }),
      })
      const j = await r.json()
      if (!r.ok) { setDecodeMsg(j.error === 'AI key not configured' ? 'Needs the AI key in Vercel first.' : (j.error ?? 'Advisor failed.')); return }
      if (scope === 'service') {
        setSpecs((prev) => {
          const next = { ...prev }
          for (const k of ['oil', 'oil_capacity', 'oil_filter', 'air_filter', 'fuel_filter', 'hydraulic_oil', 'hydraulic_filter', 'coolant', 'tires']) {
            if (j.service?.[k] && !String(next[k] ?? '').trim()) next[k] = j.service[k]
          }
          if (j.value_range && !next.value_range) next.value_range = j.value_range
          return next
        })
        setDecodeMsg(Object.keys(j.service ?? {}).length ? `⚠ Service specs suggested — AI can make mistakes. Confirm oils, capacities, and part numbers against the operator's manual before servicing.${j.note ? ` ${j.note}` : ''}` : 'No confident service specs for this one.')
      } else {
        setCosts((prev) => {
          const next = { ...prev }
          for (const f of COST_FIELDS[type]) {
            const v = j.costs?.[f.key]
            if (v != null && !String(next[f.key] ?? '').trim()) next[f.key] = String(v)
          }
          return next
        })
        // Persist the assumptions the AI used so they show on the asset screen.
        if (j.note) setSpecs((prev) => ({ ...prev, cost_basis: j.note }))
        setDecodeMsg(Object.keys(j.costs ?? {}).length ? `✓ Costs suggested — review before saving${j.note ? `. ${j.note}` : ''}` : 'Not enough to suggest costs yet.')
      }
    } catch {
      setDecodeMsg('Advisor unreachable.')
    } finally {
      setAdvising(null)
    }
  }

  // ── Photos ──────────────────────────────────────────────────────────────
  const [existingPhotos, setExistingPhotos] = useState<AssetPhoto[]>(initialPhotos)
  const [newPhotos, setNewPhotos] = useState<NewPhoto[]>([])
  const [photoBusy, setPhotoBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Persist a reordered existing-photo list; first photo = thumbnail.
  const applyOrder = (next: AssetPhoto[]) => {
    setExistingPhotos(next)
    onReorderPhotos?.(next.map((p) => p.id)).catch(() => setDecodeMsg('Could not save the new order.'))
  }
  const moveExisting = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= existingPhotos.length || to >= existingPhotos.length) return
    const next = existingPhotos.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    applyOrder(next)
  }
  const makeThumbnail = (i: number) => moveExisting(i, 0)

  // Shared by the file picker AND drag-and-drop: resize each image and append.
  const addFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    setPhotoBusy(true)
    try {
      for (const file of imgs) {
        const resized = await resizePhoto(file)
        const preview = URL.createObjectURL(resized)
        // Default the first-ever photo to "Truck / unit", the rest to "Other".
        setNewPhotos((prev) => [...prev, { blob: resized, preview, label: prev.length + existingPhotos.length === 0 ? 'truck' : 'other' }])
      }
    } finally {
      setPhotoBusy(false)
    }
  }

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await addFiles(Array.from(e.target.files ?? []))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Drag-and-drop upload (dropping image FILES from the desktop). Distinct from
  // the in-gallery reorder drag — that carries no files, so we ignore it here.
  const [dropActive, setDropActive] = useState(false)
  const dragHasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const handleFileDrop = async (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return
    e.preventDefault()
    setDropActive(false)
    await addFiles(Array.from(e.dataTransfer.files))
  }

  const removeNewPhoto = (i: number) =>
    setNewPhotos((prev) => {
      URL.revokeObjectURL(prev[i].preview)
      return prev.filter((_, idx) => idx !== i)
    })

  const setNewPhotoLabel = (i: number, label: string) =>
    setNewPhotos((prev) => prev.map((p, idx) => (idx === i ? { ...p, label } : p)))

  const removeExistingPhoto = async (photo: AssetPhoto) => {
    if (!onDeleteExistingPhoto || deletingId) return
    setDeletingId(photo.id)
    try {
      await onDeleteExistingPhoto(photo)
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    } catch {
      setDecodeMsg('Could not remove that photo.')
    } finally {
      setDeletingId(null)
    }
  }

  // Cost inputs kept as strings while typing; parsed on submit.
  const [costs, setCosts] = useState<Record<string, string>>(() => ({
    hourly_rate: initial?.hourly_rate != null ? String(initial.hourly_rate) : '',
    mileage_rate: initial?.mileage_rate != null ? String(initial.mileage_rate) : '',
    daily_cost: initial?.daily_cost != null ? String(initial.daily_cost) : '',
    purchase_price: initial?.purchase_price != null ? String(initial.purchase_price) : '',
    purchase_value: initial?.purchase_value != null ? String(initial.purchase_value) : '',
  }))
  // Document folder — rides the SAME save as the rest of the form, exactly
  // like zones after the Jul 30 one-save consolidation.
  const [folderUrl, setFolderUrl] = useState(initial?.folder_url ?? '')

  // Optional sections start collapsed on CREATE (the form was a wall of
  // inputs); on EDIT they open only when they already hold values, so nothing
  // saved ever hides. Collapsing doesn't touch state — values still submit.
  const initMeta = initial?.metadata ?? {}
  const [showIdSpecs, setShowIdSpecs] = useState(
    () => !!initial && ['year', 'make', 'model', 'trim', 'fuel'].some((k) => String(initMeta[k] ?? '').trim() !== '')
  )
  const [showService, setShowService] = useState(
    () => !!initial && ['oil', 'oil_capacity', 'oil_filter', 'air_filter', 'fuel_filter', 'hydraulic_oil', 'hydraulic_filter', 'coolant', 'tires'].some((k) => String(initMeta[k] ?? '').trim() !== '')
  )
  const [showCosts, setShowCosts] = useState(
    () => !!initial && [initial.hourly_rate, initial.mileage_rate, initial.daily_cost, initial.purchase_price, initial.purchase_value].some((v) => v != null)
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(), type,
      category: category.trim(), serial: serial.trim(),
      // Hero stays whatever it was; the server sets it from the first upload
      // when the asset has none. Keep legacy hero so edits don't wipe it.
      photo_url: initial?.photo_url ?? '',
      folder_url: folderUrl.trim(),
      tracker_id: trackerId.trim(), metadata: specs,
      hourly_rate: parseCost(costs.hourly_rate ?? ''),
      mileage_rate: parseCost(costs.mileage_rate ?? ''),
      daily_cost: parseCost(costs.daily_cost ?? ''),
      purchase_price: parseCost(costs.purchase_price ?? ''),
      purchase_value: parseCost(costs.purchase_value ?? ''),
    }, newPhotos)
  }

  const hasVehicleId = (type === 'vehicle' || type === 'equipment')

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
              placeholder="e.g. Bryson's Ram 3500, CAT Excavator"
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

          {/* Tracker ID up top — it's the field that makes the asset REAL on
              the map, not an afterthought below the photos. */}
          <div className="space-y-2">
            <Label htmlFor="tracker-id">Tracker ID</Label>
            <Input
              id="tracker-id"
              placeholder="e.g. obd-001, bt-042, gps-007"
              value={trackerId}
              onChange={e => setTrackerId(e.target.value)}
            />
            <p className="text-xs text-faint">
              The ID number printed on the tracker in this machine. Reports with this ID become this asset&apos;s dots on the map.
            </p>
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

          {Object.keys(specs).filter((k) => k !== 'notes' && k !== 'color' && k !== 'icon' && k !== 'cost_basis').length > 0 && (
            <div className="rounded-lg border border-navy-800 bg-navy-950/50 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Specs</p>
                <button
                  type="button"
                  onClick={() => setSpecs((prev) => {
                    // Clear decoded/typed specs but keep the keys with their
                    // own inputs/surfaces: notes, color, icon, and cost_basis
                    // (the AI cost note — the chip strip never shows it, so
                    // clearing it here silently killed the cost-card note).
                    const kept: Record<string, unknown> = {}
                    if (prev.notes != null) kept.notes = prev.notes
                    if (prev.color != null) kept.color = prev.color
                    if (prev.icon != null) kept.icon = prev.icon
                    if (prev.cost_basis != null) kept.cost_basis = prev.cost_basis
                    return kept
                  })}
                  className="text-[11px] text-faint hover:text-alert"
                >clear</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(specs).filter(([k]) => k !== 'notes' && k !== 'color' && k !== 'icon' && k !== 'cost_basis').map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 rounded-md bg-navy-800 text-[11px] text-muted">
                    <span className="text-faint">{k.replace(/_/g, ' ')}:</span> <span className="text-ink">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Year / Make / Model / Trim / Fuel — typeahead for vehicles &
              equipment. Make suggests common brands; picking make + year
              live-loads that generation's model list from the federal vehicle
              database (vPIC). Trim + fuel capture "3500" / "Diesel" as real
              structured specs instead of burying them in the name. */}
          {hasVehicleId && (
            <div className="rounded-lg border border-navy-800 bg-navy-950/50">
              <button
                type="button"
                onClick={() => setShowIdSpecs((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Year · Make · Model (optional)</span>
                <span className="text-[11px] text-faint">{showIdSpecs ? '▾' : '▸'}</span>
              </button>
              {showIdSpecs && (
              <div className="px-3 pb-3 space-y-2">
              <div className="grid grid-cols-[70px_1fr_1fr] gap-2">
                <input
                  value={String(specs.year ?? '')}
                  onChange={(e) => { setSpecField('year', e.target.value); loadModels(String(specs.make ?? ''), e.target.value) }}
                  placeholder="Year"
                  inputMode="numeric"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
                <input
                  value={String(specs.make ?? '')}
                  onChange={(e) => { setSpecField('make', e.target.value); loadModels(e.target.value, String(specs.year ?? '')) }}
                  placeholder="Make"
                  list="asset-make-suggestions"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
                <input
                  value={String(specs.model ?? '')}
                  onChange={(e) => setSpecField('model', e.target.value)}
                  placeholder="Model (e.g. 3500)"
                  list="asset-model-suggestions"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={String(specs.trim ?? '')}
                  onChange={(e) => setSpecField('trim', e.target.value)}
                  placeholder="Trim / config (e.g. Laramie, 4x4)"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
                <input
                  value={String(specs.fuel ?? '')}
                  onChange={(e) => setSpecField('fuel', e.target.value)}
                  placeholder="Fuel / engine (e.g. Diesel 6.7L)"
                  list="asset-fuel-suggestions"
                  className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-amber/50 min-w-0"
                />
              </div>
              <datalist id="asset-make-suggestions">
                {MAKE_SUGGESTIONS.map((mk) => <option key={mk} value={mk} />)}
              </datalist>
              <datalist id="asset-model-suggestions">
                {modelOptions.map((mo) => <option key={mo} value={mo} />)}
              </datalist>
              <datalist id="asset-fuel-suggestions">
                {['Diesel', 'Gasoline', 'Flex Fuel', 'Electric', 'Hybrid', 'Propane', 'CNG'].map((f) => <option key={f} value={f} />)}
              </datalist>
              {modelOptions.length > 0 && (
                <p className="text-[10.5px] text-faint">{modelOptions.length} known models for {String(specs.make)}{/^(19|20)\d{2}$/.test(String(specs.year ?? '')) ? ` ${String(specs.year)}` : ''} — keep typing to filter.</p>
              )}
              </div>
              )}
            </div>
          )}

          {/* Map color — one choice drives the dot, the trail line, and the
              Command Center radar blip. Auto = the stable per-asset palette. */}
          <div className="space-y-1.5">
            <Label>Dot &amp; trail color</Label>
            <ColorSwatches
              value={String(specs.color ?? '')}
              onChange={(c) => setSpecField('color', c)}
              leading={
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
              }
            />
            <p className="text-[10px] text-faint leading-tight">Used on the map dot, trail line, and radar dial. Auto assigns a stable color; the rainbow well picks anything.</p>
          </div>

          {/* Map icon — the silhouette INSIDE the dot (Brian, Aug 28: "guys
              would like to see different options here — dump truck, day cab,
              mower"). Auto follows the asset type; a pick is metadata.icon. */}
          <IconPicker
            value={typeof specs.icon === 'string' ? specs.icon : ''}
            type={type}
            puck={/^#[0-9a-fA-F]{3,8}$/.test(String(specs.color ?? '')) ? String(specs.color) : TYPE_PUCK_COLORS[type]}
            onChange={(k) => setSpecField('icon', k)}
          />

          <div className="space-y-2">
            <Label htmlFor="asset-folder">Project folder link <span className="text-faint font-normal">(optional)</span></Label>
            <Input
              id="asset-folder" type="url" inputMode="url"
              placeholder="Dropbox / Drive / OneDrive folder URL"
              value={folderUrl}
              onChange={(e) => setFolderUrl(e.target.value)}
            />
            <p className="text-[10.5px] text-faint -mt-1">Manuals, receipts, photos — one tap from this asset everywhere it appears.</p>
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
              filter, what tires. AI can pre-fill them from the make/model, or
              type them once; receipts can fill them later. */}
          <div className="rounded-lg border border-navy-800 bg-navy-950/50">
            <button
              type="button"
              onClick={() => setShowService((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Service specs (optional)</span>
              <span className="text-[11px] text-faint">{showService ? '▾' : '▸'}</span>
            </button>
            {showService && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center justify-end gap-3">
                {hasVehicleId && (
                  <button
                    type="button"
                    onClick={() => advise('service')}
                    disabled={advising !== null || (!name.trim() && !specs.make)}
                    className="text-[11px] font-semibold text-teal hover:text-ink disabled:opacity-40"
                  >
                    {advising === 'service' ? 'Thinking…' : '✨ AI fill from make/model'}
                  </button>
                )}
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
              {([
                ['oil', 'Oil (e.g. 15W-40 diesel)'], ['oil_capacity', 'Oil capacity (e.g. 9.5 qt)'],
                ['oil_filter', 'Oil filter #'], ['air_filter', 'Air filter #'],
                ['fuel_filter', 'Fuel filter #'], ['hydraulic_oil', 'Hydraulic oil (e.g. ISO 46)'],
                ['hydraulic_filter', 'Hydraulic filter #'], ['coolant', 'Coolant type'],
                ['tires', 'Tire size'],
              ] as const).map(([key, ph]) => (
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
            <p className="text-[10.5px] text-faint">
              AI-filled values are suggestions and can be wrong — confirm oils, capacities, and
              part numbers against the operator&apos;s manual before servicing.
            </p>
            </div>
            )}
          </div>

          {/* Photos — the whole set: truck shot, GVWR sticker, VIN plate,
              engine, damage. The first becomes the hero on the map + list.
              Drop image files anywhere in here to upload. */}
          <div
            className="space-y-2"
            onDragEnter={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setDropActive(true) } }}
            onDragOver={(e) => { if (dragHasFiles(e)) e.preventDefault() }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setDropActive(false) }}
            onDrop={handleFileDrop}
          >
            <Label>Photos</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handlePhotoPick}
            />
            {(existingPhotos.length > 0 || newPhotos.length > 0) && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {existingPhotos.map((p, i) => (
                  <div
                    key={p.id}
                    draggable={!!onReorderPhotos}
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => { if (dragIndex !== null) e.preventDefault() }}
                    onDrop={(e) => { if (dragIndex !== null) { e.preventDefault(); e.stopPropagation(); moveExisting(dragIndex, i); setDragIndex(null) } }}
                    onDragEnd={() => setDragIndex(null)}
                    className={
                      'relative rounded-lg border overflow-hidden ' +
                      (i === 0 ? 'border-amber/70 ' : 'border-navy-700 ') +
                      (onReorderPhotos ? 'cursor-grab active:cursor-grabbing ' : '') +
                      (dragIndex === i ? 'opacity-50 ' : '')
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={labelText(p.label)} className="h-24 w-full object-cover pointer-events-none" />
                    {i === 0 ? (
                      <span className="absolute top-1 left-1 rounded bg-amber text-[#1a1100] text-[9px] font-bold px-1.5 py-0.5">★ THUMBNAIL</span>
                    ) : onReorderPhotos && (
                      <button
                        type="button"
                        onClick={() => makeThumbnail(i)}
                        className="absolute top-1 left-1 rounded bg-navy-950/85 text-teal text-[9px] font-semibold px-1.5 py-0.5 hover:bg-teal hover:text-[#04222a]"
                      >★ Make thumbnail</button>
                    )}
                    <span className="absolute bottom-0 inset-x-0 bg-navy-950/80 text-[10px] text-muted px-1.5 py-0.5 truncate">{labelText(p.label)}</span>
                    {onDeleteExistingPhoto && (
                      <button
                        type="button"
                        onClick={() => removeExistingPhoto(p)}
                        disabled={deletingId === p.id}
                        aria-label="Remove photo"
                        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-navy-950/80 text-alert text-xs font-bold flex items-center justify-center hover:bg-alert hover:text-white disabled:opacity-50"
                      >×</button>
                    )}
                  </div>
                ))}
                {newPhotos.map((p, i) => (
                  <div key={i} className="relative rounded-lg border border-teal/50 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt={labelText(p.label)} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeNewPhoto(i)}
                      aria-label="Remove photo"
                      className="absolute top-1 right-1 h-6 w-6 rounded-full bg-navy-950/80 text-alert text-xs font-bold flex items-center justify-center hover:bg-alert hover:text-white"
                    >×</button>
                    <select
                      value={p.label}
                      onChange={(e) => setNewPhotoLabel(i, e.target.value)}
                      className="absolute bottom-0 inset-x-0 bg-navy-950/85 text-[11px] text-ink px-1 py-1 outline-none border-t border-navy-700"
                    >
                      {PHOTO_LABELS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={photoBusy}
              onClick={() => fileInputRef.current?.click()}
              className={
                'w-full rounded-lg border-2 border-dashed px-3 py-4 text-sm font-medium transition-colors disabled:opacity-60 ' +
                (dropActive
                  ? 'border-teal bg-teal/10 text-teal'
                  : 'border-navy-700 text-muted hover:border-navy-600 hover:text-ink')
              }
            >
              {photoBusy
                ? 'Processing…'
                : dropActive
                ? '⬇ Drop photos to upload'
                : '📷 Add photos — tap, or drag & drop (truck, GVWR, VIN, engine, issues…)'}
            </button>
            {onReorderPhotos && existingPhotos.length > 1 && (
              <p className="text-[10px] text-faint leading-tight">Drag a photo to reorder · the first photo (★) is the thumbnail on the map &amp; list.</p>
            )}
          </div>

          {/* Cost structure — the last thing to fill in, once the identity is
              set. AI can advise the numbers from the year/make/model. */}
          <div className="rounded-lg border border-navy-800">
            <button
              type="button"
              onClick={() => setShowCosts((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
              <span className="text-sm font-medium text-ink">Cost structure <span className="text-faint font-normal">(powers job-cost tracking)</span></span>
              <span className="text-[11px] text-faint">{showCosts ? '▾' : '▸'}</span>
            </button>
            {showCosts && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => advise('cost')}
                  disabled={advising !== null || (!name.trim() && !specs.make)}
                  className="text-[11px] font-semibold text-teal hover:text-ink disabled:opacity-40 whitespace-nowrap"
                >
                  {advising === 'cost' ? 'Thinking…' : '✨ AI advise from specs'}
                </button>
              </div>
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
            )}
          </div>

          {/* Sticky footer — Save stays reachable no matter how long the form
              scrolls, and the save error surfaces HERE (it used to render in
              the page header, hidden behind this dialog). */}
          <div className="sticky bottom-0 -mx-6 -mb-6 px-6 pt-3 pb-5 bg-navy-900 border-t border-navy-800 space-y-2">
            {error && (
              <p className="text-xs text-alert bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || saving} className="flex-1">
                {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Asset'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
