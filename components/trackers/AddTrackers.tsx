'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CircleAlert, Keyboard, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { registerTrackerAction } from '@/lib/actions/trackers'
import { parseTrackerId } from '@/lib/devices'
import { Scanner } from './Scanner'

type Row =
  | { kind: 'added'; id: string; modelName: string }
  | { kind: 'existed'; id: string; modelName: string; onAsset: string | null }
  | { kind: 'error'; text: string }

/**
 * Step one for a new customer: scan every box. Each one lands in the
 * drawer with its model already known from the number on the label; naming
 * the machine is the next tap, on the row. Batch-first — unbox ten, scan
 * ten, done — and the typed path is always there for a scuffed label.
 */
export function AddTrackers() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // The camera re-fires the same code ~3×/s while the box is in frame.
  const cooldown = useRef<Map<string, number>>(new Map())

  const pushError = (text: string) =>
    setRows((r) => (r[0]?.kind === 'error' && r[0].text === text ? r : [{ kind: 'error', text }, ...r]))

  const submit = async (raw: string): Promise<'submitted' | 'dropped' | 'invalid'> => {
    const parsed = parseTrackerId(raw)
    if ('error' in parsed) return 'invalid'
    const now = Date.now()
    const until = cooldown.current.get(parsed.id)
    if ((until && now < until) || busyRef.current) return 'dropped'
    busyRef.current = true
    cooldown.current.set(parsed.id, now + 6000)
    setBusy(true)
    try {
      const res = await registerTrackerAction(raw)
      if (!res.ok) { pushError(res.error); return 'submitted' }
      cooldown.current.set(parsed.id, Infinity)
      setRows((r) => [res.existed
        ? { kind: 'existed', id: res.id, modelName: res.modelName, onAsset: res.onAsset?.name ?? null }
        : { kind: 'added', id: res.id, modelName: res.modelName }, ...r])
      router.refresh()
    } catch {
      pushError('Network hiccup — keep the label in frame, or type the number.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    return 'submitted'
  }

  const submitManual = async () => {
    const outcome = await submit(manual)
    if (outcome === 'submitted') setManual('')
    else if (outcome === 'invalid') pushError('That needs the 15-digit IMEI from a truck/machine unit, or the 12-character MAC from a tool tag.')
  }

  const short = (id: string) => `…${id.slice(-4)}`

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Add trackers</Button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-h-[88dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add trackers</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-[12.5px] text-muted leading-snug">
                Scan the label on every box — the sticker with the barcode. Truck and machine units carry a 15-digit IMEI;
                tool tags carry a 12-character MAC. Each one lands in your drawer with its type already known. Naming the machine is the next tap.
              </p>
              <Scanner onCode={(raw) => { if (!('error' in parseTrackerId(raw))) void submit(raw) }} />
              <div className="rounded-xl border border-navy-800 bg-navy-950/60 p-3 space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5">
                  <Keyboard className="h-3.5 w-3.5" /> Or type the number on the label
                </p>
                <div className="flex gap-2">
                  <input
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) void submitManual() }}
                    placeholder="IMEI or MAC"
                    className="flex-1 min-w-0 bg-navy-900 border border-navy-700 rounded-lg px-3 py-2 text-[16px] text-ink placeholder:text-faint outline-none focus:border-amber/50 font-mono"
                  />
                  <Button disabled={!manual.trim() || busy} onClick={() => void submitManual()}>Add</Button>
                </div>
              </div>
              {rows.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{rows.length} this session</p>
                  {rows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-lg border border-navy-800 bg-navy-950/60 px-3 py-2">
                      {row.kind === 'error'
                        ? <CircleAlert className="h-4 w-4 text-alert flex-none" />
                        : <CheckCircle2 className={'h-4 w-4 flex-none ' + (row.kind === 'added' ? 'text-teal' : 'text-amber')} />}
                      {row.kind === 'error' ? (
                        <span className="text-[12.5px] text-muted">{row.text}</span>
                      ) : (
                        <span className="text-[12.5px] text-ink min-w-0">
                          <span className="font-semibold">{row.modelName}</span> <span className="font-mono text-muted">{short(row.id)}</span>
                          <span className="text-faint"> · {row.kind === 'added' ? 'in the drawer' : row.onAsset ? `already on ${row.onAsset}` : 'already in the drawer'}</span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>Done — put them on machines</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
