'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'
import type { Asset, AssetType } from '@/lib/types'
import { reassignTrackerAction, type ReassignTrackerInput } from '@/lib/actions/assets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** A local "now" in the value shape a datetime-local input wants. */
function nowLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Move a tracker to a different vehicle and split the history at the swap
 * moment, so each vehicle keeps only its own past. Handles both directions —
 * the tracker leaving this record, or this record keeping it and spinning off
 * an earlier vehicle's history (the fix for a record renamed onto a new truck).
 */
export function ReassignTracker({ asset, trackerlessAssets }: { asset: Asset; trackerlessAssets: Pick<Asset, 'id' | 'name'>[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [role, setRole] = useState<'old' | 'new'>('old')
  const [swapAt, setSwapAt] = useState(nowLocal())
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [otherName, setOtherName] = useState('')
  const [otherType, setOtherType] = useState<AssetType>('vehicle')
  const [existingId, setExistingId] = useState<string>('')
  // The box that went IN when this one came out. Optional — plenty of swaps
  // are one-way (device pulled for repair) — but a two-way swap is the common
  // case and used to need a second trip through the edit form.
  const [replacement, setReplacement] = useState('')

  const otherLabel = mode === 'existing'
    ? (trackerlessAssets.find((a) => a.id === existingId)?.name ?? 'the other vehicle')
    : (otherName.trim() || 'the new vehicle')
  const swapText = useMemo(() => {
    const t = Date.parse(swapAt)
    return Number.isNaN(t) ? 'the swap' : new Date(t).toLocaleString()
  }, [swapAt])

  const rep = replacement.trim()
  const summary = role === 'old'
    ? `"${asset.name}" keeps all history before ${swapText}. The tracker and everything after moves to ${otherLabel}.` +
      (rep ? ` "${asset.name}" then reports on tracker ${rep}.` : '')
    : `"${asset.name}" keeps the tracker and all history after ${swapText}. Everything before moves to ${otherLabel}.`

  const canSubmit = !saving && !!Date.parse(swapAt) &&
    (mode === 'existing' ? !!existingId : otherName.trim().length > 0)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const other: ReassignTrackerInput['other'] = mode === 'existing'
        ? { mode: 'existing', assetId: existingId }
        : { mode: 'new', name: otherName.trim(), type: otherType }
      const res = await reassignTrackerAction(asset.id, {
        swapAtIso: new Date(swapAt).toISOString(),
        currentRole: role,
        other,
        newTrackerForCurrent: role === 'old' && rep ? rep : undefined,
      })
      if (!res.ok) { setError(res.error ?? 'Could not reassign.'); return }
      setOpen(false)
      if (res.otherId) router.push(`/assets/${res.otherId}`)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Reassign tracker to another vehicle"
        className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-ink text-sm font-semibold px-3 py-2 hover:bg-navy-800 transition-colors"
      >
        <ArrowLeftRight className="h-4 w-4" /> <span className="hidden sm:inline">Reassign tracker</span>
      </button>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Reassign tracker</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1 text-sm">
              <p className="text-muted leading-snug">
                The tracker <span className="font-mono text-ink">{asset.tracker_id}</span> and its history are attached to
                this record. Moving it to a different vehicle <span className="text-ink font-medium">splits the history at
                the swap time</span> so each vehicle keeps only its own past.
              </p>

              <div className="space-y-1.5">
                <Label>What happened?</Label>
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('old')}
                    className={'text-left rounded-lg border p-2.5 transition-colors ' + (role === 'old' ? 'border-amber bg-amber/10' : 'border-navy-700 hover:border-navy-600')}
                  >
                    <p className="font-semibold text-ink">The tracker moved OFF this vehicle</p>
                    <p className="text-[12px] text-faint">This record keeps its history; the tracker + new data go to the other vehicle.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('new')}
                    className={'text-left rounded-lg border p-2.5 transition-colors ' + (role === 'new' ? 'border-amber bg-amber/10' : 'border-navy-700 hover:border-navy-600')}
                  >
                    <p className="font-semibold text-ink">This vehicle kept the tracker — split off an earlier vehicle</p>
                    <p className="text-[12px] text-faint">Use this if this record was renamed onto a new truck. The older history moves to a separate record; the tracker stays here.</p>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="swap-at">Swap date &amp; time</Label>
                <Input id="swap-at" type="datetime-local" value={swapAt} onChange={(e) => setSwapAt(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Other vehicle</Label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMode('new')}
                    className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (mode === 'new' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>
                    Create new
                  </button>
                  <button type="button" onClick={() => setMode('existing')} disabled={trackerlessAssets.length === 0}
                    className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors disabled:opacity-40 ' + (mode === 'existing' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>
                    Use existing
                  </button>
                </div>
                {mode === 'new' ? (
                  <div className="grid grid-cols-[1fr_130px] gap-2">
                    <Input placeholder="e.g. Bryson's Ram 3500" value={otherName} onChange={(e) => setOtherName(e.target.value)} />
                    <Select value={otherType} onValueChange={(v) => setOtherType(v as AssetType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vehicle">🚛 Vehicle</SelectItem>
                        <SelectItem value="equipment">🏗️ Equipment</SelectItem>
                        <SelectItem value="personnel">👷 Personnel</SelectItem>
                        <SelectItem value="tool">🔧 Tool</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <Select value={existingId} onValueChange={setExistingId}>
                    <SelectTrigger><SelectValue placeholder="Pick a vehicle without a tracker" /></SelectTrigger>
                    <SelectContent>
                      {trackerlessAssets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {role === 'old' && (
                <div className="space-y-1.5">
                  <Label htmlFor="replacement-tracker">
                    New tracker in this vehicle <span className="text-faint font-normal">— optional</span>
                  </Label>
                  <Input
                    id="replacement-tracker"
                    inputMode="text"
                    placeholder="IMEI or tag ID of the box that went IN"
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                  />
                  <p className="text-[12px] text-faint leading-snug">
                    Leave blank if nothing replaced it. Fill it in and &ldquo;{asset.name}&rdquo; starts
                    reporting on the new device the moment it checks in — no second trip through Edit.
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-amber/40 bg-amber/5 p-3">
                <p className="text-[12px] text-amber font-semibold mb-0.5">This will:</p>
                <p className="text-[12.5px] text-ink leading-snug">{summary}</p>
              </div>

              {error && <p className="text-[12.5px] text-alert">{error}</p>}

              <div className="flex gap-3 pt-1">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1" disabled={saving}>Cancel</Button>
                <Button type="button" onClick={submit} className="flex-1" disabled={!canSubmit}>
                  {saving ? 'Reassigning…' : 'Reassign tracker'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
