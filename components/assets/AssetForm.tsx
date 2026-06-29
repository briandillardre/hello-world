'use client'

import { useState } from 'react'
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
}

interface AssetFormProps {
  onClose: () => void
  onSubmit: (data: AssetFormData) => void
  initial?: { name: string; type: AssetType; tracker_id: string; category?: string; serial?: string; photo_url?: string }
}

export function AssetForm({ onClose, onSubmit, initial }: AssetFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<AssetType>(initial?.type ?? 'vehicle')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [serial, setSerial] = useState(initial?.serial ?? '')
  const [photoUrl, setPhotoUrl] = useState(initial?.photo_url ?? '')
  const [trackerId, setTrackerId] = useState(initial?.tracker_id ?? '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(), type,
      category: category.trim(), serial: serial.trim(), photo_url: photoUrl.trim(),
      tracker_id: trackerId.trim(), metadata: {},
    })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
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
            <Label htmlFor="asset-photo">Photo URL</Label>
            <Input
              id="asset-photo"
              placeholder="https://… (paste a photo link)"
              value={photoUrl}
              onChange={e => setPhotoUrl(e.target.value)}
            />
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

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()} className="flex-1">
              {initial ? 'Save Changes' : 'Add Asset'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
