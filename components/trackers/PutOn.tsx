'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { AssetType } from '@/lib/types'
import type { DeviceModel } from '@/lib/devices'
import { MODELS } from '@/lib/devices'
import { putOnAction } from '@/lib/actions/trackers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/feedback'

const TYPE_LABEL: Record<AssetType, string> = { vehicle: '🚛 Truck', equipment: '🏗️ Machine', tool: '🔧 Tool / trailer', personnel: '👷 Person' }

/**
 * The second tap: a drawer tracker goes on a machine. Pick one you already
 * have (without a tracker) or name a new one — type defaults from the
 * tracker's model, so a tool tag becomes a Tool and an OBD unit a Truck.
 */
export function PutOn({ trackerId, model, trackerless }: {
  trackerId: string
  model: DeviceModel | null
  trackerless: { id: string; name: string; type: AssetType }[]
}) {
  const router = useRouter()
  const spec = MODELS[model ?? 'OTHER']
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'new' | 'existing'>(trackerless.length ? 'existing' : 'new')
  const [assetId, setAssetId] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<AssetType>(spec.assetType)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const can = !saving && (mode === 'existing' ? !!assetId : name.trim().length > 0)

  const go = async () => {
    setSaving(true); setError(null)
    try {
      const res = await putOnAction(trackerId, mode === 'existing' ? { mode: 'asset', assetId } : { mode: 'new', name: name.trim(), type })
      if (!res.ok) { setError(res.error ?? 'Could not do that.'); return }
      setOpen(false)
      toast('On the machine. It shows on the map at its next report.', { variant: 'success' })
      if (res.assetId) router.push(`/assets/${res.assetId}`)
      router.refresh()
    } catch { setError('Something went wrong. Check Assets before trying again.') }
    finally { setSaving(false) }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-amber text-[#1a1100] text-[12px] font-bold px-2.5 py-1.5 min-h-9 hover:brightness-110 whitespace-nowrap">
        Put on a machine <ArrowRight className="h-3.5 w-3.5" />
      </button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{spec.name} …{trackerId.slice(-4)} goes on…</DialogTitle></DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setMode('existing')} disabled={!trackerless.length} className={'flex-1 px-2 py-2 rounded-lg border text-[12.5px] font-semibold transition-colors disabled:opacity-40 ' + (mode === 'existing' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>A machine I already added</button>
                <button type="button" onClick={() => setMode('new')} className={'flex-1 px-2 py-2 rounded-lg border text-[12.5px] font-semibold transition-colors ' + (mode === 'new' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>A new one</button>
              </div>
              {mode === 'existing' ? (
                <div className="space-y-1.5">
                  <Label>Which machine?</Label>
                  <Select value={assetId} onValueChange={setAssetId}>
                    <SelectTrigger><SelectValue placeholder="Pick one without a tracker" /></SelectTrigger>
                    <SelectContent>
                      {trackerless.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid grid-cols-[1fr_150px] gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="puton-name">Name it</Label>
                    <Input id="puton-name" placeholder={spec.assetType === 'tool' ? 'e.g. Dump trailer' : spec.assetType === 'equipment' ? 'e.g. Roller' : 'e.g. White F-250'} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={type} onValueChange={(v) => setType(v as AssetType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['vehicle', 'equipment', 'tool'] as AssetType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <p className="text-[11.5px] text-faint leading-snug">Rename, add a photo, or set rates any time from the machine&apos;s page. Undo within 30 days from Recent changes below.</p>
              {error && <p className="text-[12.5px] text-alert">{error}</p>}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
                <Button type="button" className="flex-1" onClick={go} disabled={!can}>{saving ? 'Working…' : 'Put it on'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
