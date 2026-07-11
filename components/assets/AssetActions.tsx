'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import type { Asset } from '@/lib/types'
import { updateAssetAction, deleteAssetAction } from '@/lib/actions/assets'
import { AssetForm, type AssetFormData } from './AssetForm'

/** Edit + Delete controls on the asset detail page. Edit reuses the full
 *  AssetForm (all attributes, cost structure, photo add/change/remove). */
export function AssetActions({ asset }: { asset: Asset }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async (data: AssetFormData, photo?: Blob | null) => {
    setSaving(true)
    try {
      let photoForm: FormData | undefined
      if (photo && photo.size > 0) {
        photoForm = new FormData()
        photoForm.append('photo', photo, 'photo.jpg')
      }
      await updateAssetAction(asset.id, data, photoForm)
      setEditing(false)
      router.refresh()
    } catch (err) {
      console.error('Failed to update asset', err)
      alert('Could not save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${asset.name}"? This removes its location history, maintenance records, and alerts. This cannot be undone.`)) return
    try {
      await deleteAssetAction(asset.id)
      router.push('/assets')
      router.refresh()
    } catch (err) {
      console.error('Failed to delete asset', err)
      alert('Could not delete the asset. Please try again.')
    }
  }

  return (
    <>
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-ink text-sm font-semibold px-3 py-2 hover:bg-navy-800 transition-colors"
      >
        <Pencil className="h-4 w-4" /> Edit
      </button>
      <button
        onClick={handleDelete}
        title="Delete asset"
        className="inline-flex items-center gap-1.5 rounded-lg border border-alert/40 text-alert text-sm font-semibold px-3 py-2 hover:bg-alert/10 transition-colors"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {editing && (
        <AssetForm
          onClose={() => setEditing(false)}
          onSubmit={handleSave}
          saving={saving}
          initial={{
            name: asset.name,
            type: asset.type,
            tracker_id: asset.tracker_id ?? '',
            category: asset.category ?? undefined,
            serial: asset.serial ?? undefined,
            photo_url: asset.photo_url ?? undefined,
            metadata: (asset.metadata ?? {}) as Record<string, unknown>,
            hourly_rate: asset.hourly_rate,
            mileage_rate: asset.mileage_rate,
            daily_cost: asset.daily_cost,
            purchase_value: asset.purchase_value,
          }}
        />
      )}
    </>
  )
}
