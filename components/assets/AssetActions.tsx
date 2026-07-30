'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import type { Asset, AssetPhoto } from '@/lib/types'
import { updateAssetAction, deleteAssetAction, deleteAssetPhotoAction, reorderAssetPhotosAction } from '@/lib/actions/assets'
import { AssetForm, type AssetFormData, type NewPhoto, photosToFormData } from './AssetForm'

/** Edit + Delete controls on the asset detail page. Edit reuses the full
 *  AssetForm (all attributes, cost structure, labeled photo gallery). */
export function AssetActions({ asset, photos = [] }: { asset: Asset; photos?: AssetPhoto[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async (data: AssetFormData, newPhotos?: NewPhoto[]) => {
    setSaving(true)
    try {
      await updateAssetAction(asset.id, data, photosToFormData(newPhotos ?? []))
      setEditing(false)
      router.refresh()
    } catch (err) {
      console.error('Failed to update asset', err)
      alert('Could not save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Remove a saved gallery photo; the action re-picks the thumbnail (first
  // remaining photo) so the map thumbnail never points at a deleted file.
  const handleDeletePhoto = async (photo: AssetPhoto) => {
    await deleteAssetPhotoAction(asset.id, photo.id)
    router.refresh()
  }

  // Persist a drag / make-thumbnail reorder; first photo becomes the thumbnail.
  const handleReorderPhotos = async (orderedIds: string[]) => {
    await reorderAssetPhotosAction(asset.id, orderedIds)
    router.refresh()
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
            folder_url: asset.folder_url ?? null,
            metadata: (asset.metadata ?? {}) as Record<string, unknown>,
            hourly_rate: asset.hourly_rate,
            mileage_rate: asset.mileage_rate,
            daily_cost: asset.daily_cost,
            purchase_price: asset.purchase_price,
            purchase_value: asset.purchase_value,
          }}
          initialPhotos={photos}
          onDeleteExistingPhoto={handleDeletePhoto}
          onReorderPhotos={handleReorderPhotos}
        />
      )}
    </>
  )
}
