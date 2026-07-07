'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DollarSign, Pencil } from 'lucide-react'
import type { Asset } from '@/lib/types'
import { updateAssetAction } from '@/lib/actions/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { COST_FIELDS, parseCost } from './AssetForm'

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** Cost structure display + inline edit on the asset detail page. */
export function CostCard({ asset }: { asset: Asset }) {
  const router = useRouter()
  const fields = COST_FIELDS[asset.type]
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, asset[f.key] != null ? String(asset[f.key]) : '']))
  )

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateAssetAction(asset.id, {
        hourly_rate: parseCost(values.hourly_rate ?? ''),
        mileage_rate: parseCost(values.mileage_rate ?? ''),
        daily_cost: parseCost(values.daily_cost ?? ''),
        purchase_value: parseCost(values.purchase_value ?? ''),
      })
      setEditing(false)
      router.refresh()
    } catch (err) {
      console.error('Failed to save cost structure', err)
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Cost structure</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-teal hover:underline"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>

      <div className="rounded-xl border border-navy-800 bg-navy-900 p-4">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`cc-${f.key}`} className="text-xs">{f.label}</Label>
                  <Input
                    id={`cc-${f.key}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  <p className="text-[10px] text-faint leading-tight">{f.hint}</p>
                </div>
              ))}
            </div>
            {error && <p className="text-xs text-alert">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save rates'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {fields.map((f) => (
              <div key={f.key}>
                <div className="flex items-center gap-1 text-faint">
                  <DollarSign className="h-3 w-3" />
                  <span className="text-[11px]">{f.label}</span>
                </div>
                <p className="font-display font-bold text-ink text-[15px] mt-0.5">{fmt(asset[f.key])}</p>
              </div>
            ))}
            {fields.every((f) => asset[f.key] == null) && (
              <p className="col-span-full text-xs text-faint">
                No rates set — the map&apos;s cost tracker stays at $0 for this asset until you add them.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
