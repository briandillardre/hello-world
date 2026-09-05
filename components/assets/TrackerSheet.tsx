'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Radio, ArrowLeftRight, Inbox, ArrowRight, Scissors, PlugZap } from 'lucide-react'
import type { Asset, AssetType } from '@/lib/types'
import type { DeviceModel } from '@/lib/devices'
import { MODELS } from '@/lib/devices'
import { changeTrackerAction } from '@/lib/actions/trackers'
import type { TrackerChange, Destination } from '@/lib/trackers-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/feedback'
import { formatRelativeTime } from '@/lib/utils'

export interface TrackerChoices {
  drawer: { imei: string; model: DeviceModel | null; label: string | null; lastSeen: string | null; unassignedSince: string | null }[]
  onOthers: { imei: string; assetId: string; assetName: string }[]
  trackerless: { id: string; name: string; type: AssetType }[]
}

type Case = 'attach' | 'swap' | 'detach' | 'move' | 'split'

const CASES: Record<Case, { title: string; blurb: string; icon: typeof Radio; needsTracker: boolean }> = {
  attach: { title: 'Put a tracker on this machine', blurb: 'From the drawer, off another machine, or a new box you just unpacked.', icon: PlugZap, needsTracker: false },
  swap:   { title: 'Swap for a different tracker', blurb: 'A different box went in as this one came out. Say where the old one went.', icon: ArrowLeftRight, needsTracker: true },
  detach: { title: 'Take the tracker out', blurb: 'It goes in the Unassigned drawer. Anything it reports from there is kept for when it goes on the next machine.', icon: Inbox, needsTracker: true },
  move:   { title: 'Move it to another machine', blurb: 'This record keeps its history up to the move; the other machine takes the tracker and everything after.', icon: ArrowRight, needsTracker: true },
  split:  { title: 'This record was renamed onto a new machine', blurb: 'The tracker stays here. The OLD machine’s history before the date splits off to its own record.', icon: Scissors, needsTracker: true },
}

function nowLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function toLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const short = (imei: string) => `…${imei.slice(-4)}`

/**
 * The one door for every tracker change on an asset (092). Five plain cases,
 * each explained before anything moves, each reversible for 30 days from
 * /trackers. Replaces ReassignTracker, whose "moved OFF / kept it" framing
 * needed a diagram (Brian, Sep 4: "make this transition easier").
 */
export function TrackerSheet({ asset, choices, compact = false }: { asset: Asset; choices: TrackerChoices; compact?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const has = !!asset.tracker_id

  const [kase, setKase] = useState<Case | null>(null)
  const [when, setWhen] = useState(nowLocal())
  // Which box goes ON (attach / swap): picked from a list or typed.
  const [pickImei, setPickImei] = useState<string>('')
  const [typedImei, setTypedImei] = useState('')
  // Where the OLD one went (swap / move), or the other record (split).
  const [destMode, setDestMode] = useState<'drawer' | 'asset' | 'new'>('drawer')
  const [destAsset, setDestAsset] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AssetType>('vehicle')

  const reset = (c: Case | null) => {
    setKase(c); setError(null); setPickImei(''); setTypedImei(''); setDestAsset(''); setNewName('')
    setDestMode(c === 'move' || c === 'split' ? (choices.trackerless.length ? 'asset' : 'new') : 'drawer')
    setWhen(nowLocal())
  }

  const incoming = (pickImei === '__typed' ? typedImei : pickImei).trim()
  const pickedDrawer = choices.drawer.find((d) => d.imei === pickImei)
  const pickedOther = choices.onOthers.find((o) => o.imei === pickImei)

  // Sensible default for "since when": a drawer tracker's pull date.
  const sinceHint = pickedDrawer?.unassignedSince
    ? `In the drawer since ${new Date(pickedDrawer.unassignedSince).toLocaleString()} — use that if it went straight in.`
    : pickedOther ? `Everything "${pickedOther.assetName}" recorded after this time moves here.` : null

  const dest = (): Destination | null => {
    if (destMode === 'drawer') return { mode: 'drawer' }
    if (destMode === 'asset') return destAsset ? { mode: 'asset', assetId: destAsset } : null
    return newName.trim() ? { mode: 'new', name: newName.trim(), type: newType } : null
  }

  const whenText = useMemo(() => {
    const t = Date.parse(when)
    return Number.isNaN(t) ? 'the time you pick' : new Date(t).toLocaleString()
  }, [when])

  const destText = destMode === 'drawer' ? 'the Unassigned drawer'
    : destMode === 'asset' ? `"${choices.trackerless.find((a) => a.id === destAsset)?.name ?? '…'}"`
    : `a new record "${newName.trim() || '…'}"`

  const summary = (): string | null => {
    const cur = asset.tracker_id ? short(asset.tracker_id) : ''
    switch (kase) {
      case 'attach':
        return incoming ? `Tracker ${short(incoming)} goes on "${asset.name}" as of ${whenText}.${pickedOther ? ` It comes OFF "${pickedOther.assetName}", and that machine's pings after ${whenText} move here.` : ''}${pickedDrawer?.lastSeen ? ' Pings it sent from the drawer since then land here too.' : ''}` : null
      case 'swap':
        return incoming ? `As of ${whenText}: tracker ${cur} comes off "${asset.name}" and goes to ${destText}; tracker ${short(incoming)} goes on.${destMode !== 'drawer' ? ` "${asset.name}"'s pings after ${whenText} move with the old tracker.` : ''}` : null
      case 'detach':
        return `Tracker ${cur} comes off "${asset.name}" as of ${whenText} and waits in the Unassigned drawer. This record keeps all its history.`
      case 'move':
        return `Tracker ${cur} moves to ${destText}. "${asset.name}" keeps everything before ${whenText}; the other machine gets the tracker and everything after.`
      case 'split':
        return `"${asset.name}" keeps tracker ${cur} and everything after ${whenText}. Everything before moves to ${destText}.`
      default: return null
    }
  }

  const canSubmit = (): boolean => {
    if (saving || Number.isNaN(Date.parse(when))) return false
    switch (kase) {
      case 'attach': return !!incoming
      case 'swap': return !!incoming && dest() !== null
      case 'detach': return true
      case 'move': case 'split': return destMode !== 'drawer' && dest() !== null
      default: return false
    }
  }

  const submit = async () => {
    const sinceIso = new Date(when).toISOString()
    let change: TrackerChange | null = null
    const d = dest()
    switch (kase) {
      case 'attach': change = { kind: 'attach', imei: incoming, sinceIso }; break
      case 'swap': if (d) change = { kind: 'swap', imei: incoming, sinceIso, oldTo: d }; break
      case 'detach': change = { kind: 'detach', sinceIso }; break
      case 'move': if (d && d.mode !== 'drawer') change = { kind: 'move', sinceIso, to: d }; break
      case 'split': if (d && d.mode !== 'drawer') change = { kind: 'split_history', sinceIso, other: d }; break
    }
    if (!change) return
    setSaving(true); setError(null)
    try {
      const res = await changeTrackerAction(asset.id, change)
      if (!res.ok) { setError(res.error ?? 'Could not make that change.'); return }
      setOpen(false)
      const bits: string[] = []
      if (res.moved) bits.push(`${res.moved.toLocaleString()} pings moved`)
      if (res.buffered) bits.push(`${res.buffered.toLocaleString()} drawer pings landed`)
      toast(`Done${bits.length ? ` — ${bits.join(', ')}` : ''}. Undo within 30 days from Trackers.`, { variant: 'success' })
      if (res.goTo && res.goTo !== asset.id) router.push(`/assets/${res.goTo}`)
      router.refresh()
    } catch {
      setError('Something went wrong. Nothing was changed.')
    } finally { setSaving(false) }
  }

  const trackerPicker = (
    <div className="space-y-1.5">
      <Label>Which tracker went in?</Label>
      <Select value={pickImei} onValueChange={setPickImei}>
        <SelectTrigger><SelectValue placeholder="Pick from the drawer, another machine, or type one" /></SelectTrigger>
        <SelectContent>
          {choices.drawer.length > 0 && <p className="px-2 pt-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">Unassigned drawer</p>}
          {choices.drawer.map((t) => (
            <SelectItem key={t.imei} value={t.imei}>
              {t.model ? MODELS[t.model].name : 'Tracker'} {short(t.imei)}{t.label ? ` · ${t.label}` : ''}{t.lastSeen ? ` · seen ${formatRelativeTime(t.lastSeen)}` : ''}
            </SelectItem>
          ))}
          {choices.onOthers.length > 0 && <p className="px-2 pt-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">On another machine (take it)</p>}
          {choices.onOthers.map((t) => (
            <SelectItem key={t.imei} value={t.imei}>{short(t.imei)} · on {t.assetName}</SelectItem>
          ))}
          <SelectItem value="__typed">Type an ID…</SelectItem>
        </SelectContent>
      </Select>
      {pickImei === '__typed' && (
        <Input placeholder="15-digit IMEI from the label" inputMode="numeric" value={typedImei} onChange={(e) => setTypedImei(e.target.value)} autoFocus />
      )}
      {sinceHint && <p className="text-[12px] text-faint leading-snug">{sinceHint}</p>}
    </div>
  )

  const destPicker = (label: string, allowDrawer: boolean) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1.5">
        {allowDrawer && (
          <button type="button" onClick={() => setDestMode('drawer')} className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (destMode === 'drawer' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>The drawer</button>
        )}
        <button type="button" onClick={() => setDestMode('asset')} disabled={choices.trackerless.length === 0} className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors disabled:opacity-40 ' + (destMode === 'asset' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>A machine I have</button>
        <button type="button" onClick={() => setDestMode('new')} className={'flex-1 px-2 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ' + (destMode === 'new' ? 'border-teal bg-teal/10 text-teal' : 'border-navy-700 text-faint hover:text-ink')}>A new machine</button>
      </div>
      {destMode === 'asset' && (
        <Select value={destAsset} onValueChange={setDestAsset}>
          <SelectTrigger><SelectValue placeholder="Pick a machine without a tracker" /></SelectTrigger>
          <SelectContent>
            {choices.trackerless.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {destMode === 'new' && (
        <div className="grid grid-cols-[1fr_130px] gap-2">
          <Input placeholder="e.g. F750 Service Truck" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Select value={newType} onValueChange={(v) => setNewType(v as AssetType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vehicle">🚛 Vehicle</SelectItem>
              <SelectItem value="equipment">🏗️ Equipment</SelectItem>
              <SelectItem value="personnel">👷 Personnel</SelectItem>
              <SelectItem value="tool">🔧 Tool</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )

  const cases = (Object.keys(CASES) as Case[]).filter((c) => CASES[c].needsTracker === has)

  return (
    <>
      <button
        onClick={() => { reset(null); setOpen(true) }}
        title={has ? `Tracker …${asset.tracker_id!.slice(-4)} — swap, move, or take it out` : 'Put a tracker on this machine'}
        className={'inline-flex items-center gap-1.5 rounded-lg border text-sm font-semibold px-3 py-2 transition-colors whitespace-nowrap ' + (has ? 'border-navy-700 text-ink hover:bg-navy-800' : 'border-amber/50 bg-amber/10 text-amber hover:bg-amber/20')}
      >
        <Radio className="h-4 w-4" /> {has ? (compact ? 'Tracker' : `Tracker ${short(asset.tracker_id!)}`) : 'Add tracker'}
      </button>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-h-[88dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{has ? `Tracker ${short(asset.tracker_id!)} on "${asset.name}"` : `No tracker on "${asset.name}"`}</DialogTitle>
            </DialogHeader>

            {!kase ? (
              <div className="space-y-2 pt-1">
                <p className="text-[12.5px] text-muted leading-snug">
                  {has
                    ? <>Full ID <span className="font-mono text-ink">{asset.tracker_id}</span>. What happened?</>
                    : <>Reports from a tracker only become this machine&apos;s dots once it is assigned here. Pings from a tracker in the drawer are kept for 30 days and land on the machine when you assign it.</>}
                </p>
                {cases.map((c) => {
                  const C = CASES[c]; const Icon = C.icon
                  return (
                    <button key={c} type="button" onClick={() => reset(c)} className="w-full text-left rounded-lg border border-navy-700 hover:border-amber/60 p-3 transition-colors flex items-start gap-3">
                      <Icon className="h-4 w-4 text-amber flex-none mt-0.5" />
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink text-[14px]">{C.title}</span>
                        <span className="block text-[12px] text-faint leading-snug">{C.blurb}</span>
                      </span>
                    </button>
                  )
                })}
                <p className="text-[11.5px] text-faint pt-1">
                  Every change here can be undone for 30 days from <Link href="/trackers" className="text-teal underline">Trackers</Link>.
                </p>
              </div>
            ) : (
              <div className="space-y-4 pt-1 text-sm">
                <button type="button" onClick={() => reset(null)} className="text-[12px] text-teal">← All options</button>
                <div>
                  <p className="font-semibold text-ink">{CASES[kase].title}</p>
                  <p className="text-[12px] text-faint leading-snug">{CASES[kase].blurb}</p>
                </div>

                {(kase === 'attach' || kase === 'swap') && trackerPicker}

                <div className="space-y-1.5">
                  <Label htmlFor="tracker-when">When did it happen?</Label>
                  <div className="flex gap-2">
                    <Input id="tracker-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="flex-1" />
                    {pickedDrawer?.unassignedSince && (
                      <button type="button" onClick={() => setWhen(toLocal(pickedDrawer.unassignedSince!))} className="px-2 rounded-lg border border-navy-700 text-[11px] font-semibold text-teal whitespace-nowrap">Since pulled</button>
                    )}
                  </div>
                  <p className="text-[11.5px] text-faint">History is cut at this moment, so get it close — you can undo and redo.</p>
                </div>

                {kase === 'swap' && destPicker(`Where did the old tracker ${short(asset.tracker_id!)} go?`, true)}
                {kase === 'move' && destPicker('Which machine did it go to?', false)}
                {kase === 'split' && destPicker('The OLD machine’s record', false)}

                {summary() && (
                  <div className="rounded-lg border border-amber/40 bg-amber/5 p-3">
                    <p className="text-[12px] text-amber font-semibold mb-0.5">This will:</p>
                    <p className="text-[12.5px] text-ink leading-snug">{summary()}</p>
                  </div>
                )}

                {error && <p className="text-[12.5px] text-alert">{error}</p>}

                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1" disabled={saving}>Cancel</Button>
                  <Button type="button" onClick={submit} className="flex-1" disabled={!canSubmit()}>
                    {saving ? 'Working…' : 'Do it'}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
