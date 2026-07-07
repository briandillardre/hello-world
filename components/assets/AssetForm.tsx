'use client'

import { useRef, useState } from 'react'
import type { AssetType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
  initial?: { name: string; type: AssetType; tracker_id: string; category?: string; serial?: string; photo_url?: string }
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

export function AssetForm({ onClose, onSubmit, saving = false, initial }: AssetFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<AssetType>(initial?.type ?? 'vehicle')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [serial, setSerial] = useState(initial?.serial ?? '')
  const [photoUrl, setPhotoUrl] = useState(initial?.photo_url ?? '')
  const [trackerId, setTrackerId] = useState(initial?.tracker_id ?? '')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Cost inputs kept as strings while typing; parsed on submit.
  const [costs, setCosts] = useState<Record<string, string>>({})

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
      tracker_id: trackerId.trim(), metadata: {},
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
            {photoPreview ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Asset photo preview" className="h-16 w-16 rounded-lg object-cover border border-navy-700" />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    Change
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={clearPhoto}>
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
            {!photo && (
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
