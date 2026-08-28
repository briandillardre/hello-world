'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Check, AlertTriangle, Radio, Trash2, ChevronRight, Cpu } from 'lucide-react'
import {
  MODELS, MODEL_ORDER, pipeline, nextAction, imeiLooksValid, modelFromImei, radioNote,
  type DeviceModel, type Stage,
} from '@/lib/devices'
import type { DeviceWithLive } from '@/lib/db/devices'
import { addDeviceAction, setDeviceStepAction, deleteDeviceAction } from '@/lib/actions/devices'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast, confirmSheet } from '@/components/ui/feedback'

const STAGE_TINT: Record<Stage['state'], string> = {
  done: 'bg-teal',
  waiting: 'bg-amber',
  blocked: 'bg-navy-700',
}

/** Compact pipeline bar — one segment per stage, so a whole device's health
 *  reads at a glance without expanding the row. */
function PipelineBar({ stages }: { stages: Stage[] }) {
  return (
    <div className="flex gap-[3px]" aria-hidden>
      {stages.map((s) => (
        <span key={s.key} className={`h-1.5 flex-1 rounded-full ${STAGE_TINT[s.state]}`} />
      ))}
    </div>
  )
}

function DeviceCard({ device }: { device: DeviceWithLive }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const spec = MODELS[device.model] ?? MODELS.OTHER
  const stages = useMemo(() => pipeline(spec, device.steps, device.live), [spec, device.steps, device.live])
  const blocking = nextAction(stages)
  const allDone = stages.every((s) => s.state === 'done')

  const toggle = (key: string, done: boolean) => {
    start(async () => {
      const res = await setDeviceStepAction(device.imei, key, done)
      if (!res.ok && res.error) toast(res.error, { variant: 'error' })
    })
  }

  const remove = async () => {
    if (!(await confirmSheet({
      title: `Remove ${device.label || device.imei}?`,
      message: 'This only removes it from the onboarding list. The asset and its history stay exactly as they are.',
      confirmLabel: 'Remove',
      destructive: true,
    }))) return
    start(async () => { await deleteDeviceAction(device.imei) })
  }

  return (
    <div className={`rounded-xl border bg-navy-900 ${allDone ? 'border-teal/40' : 'border-navy-800'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 space-y-2.5"
        aria-expanded={open}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display font-semibold text-ink text-[15px] truncate">
                {device.label || spec.name}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-faint border border-navy-700 rounded px-1.5 py-0.5">
                {device.model === 'OTHER' ? 'device' : device.model}
              </span>
              {allDone && (
                <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-teal">live</span>
              )}
            </div>
            <p className="text-[11.5px] font-mono text-faint mt-0.5">{device.imei}</p>
          </div>
          <ChevronRight className={`h-4 w-4 text-faint shrink-0 mt-1 transition-transform ${open ? 'rotate-90' : ''}`} />
        </div>

        <PipelineBar stages={stages} />

        {/* The one line that matters: what is actually blocking this device. */}
        <p className={`text-[12.5px] leading-snug ${allDone ? 'text-teal' : 'text-faint'}`}>
          {blocking}
        </p>
      </button>

      {open && (
        <div className="border-t border-navy-800 p-4 space-y-4">
          <div className="text-[12px] text-faint leading-relaxed">
            <p className="text-ink/90">{spec.role}</p>
            <p className="mt-1">
              <span className="text-faint">Power:</span> {spec.power}
            </p>
            {spec.sim && (
              <p>
                <span className="text-faint">SIM:</span> {spec.sim}
                {radioNote(device.model) ? ` · ${radioNote(device.model)}` : ''}
              </p>
            )}
            {device.iccid && (
              <p className="font-mono text-[11px] mt-1">ICCID {device.iccid}</p>
            )}
          </div>

          {/* Manual half — the physical and vendor-console steps. */}
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              Your steps
            </p>
            {spec.prep.map((step) => {
              const done = !!device.steps[step.key]
              return (
                <div
                  key={step.key}
                  className={`rounded-lg border p-2.5 ${done ? 'border-navy-800 bg-navy-900' : step.gotcha ? 'border-amber/30 bg-amber/[0.04]' : 'border-navy-800'}`}
                >
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={pending}
                      onChange={(e) => toggle(step.key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#f0b429]"
                    />
                    <span className="min-w-0">
                      <span className={`block text-[13px] ${done ? 'text-faint line-through' : 'text-ink'}`}>
                        {step.gotcha && !done && (
                          <AlertTriangle className="inline h-3.5 w-3.5 text-amber mr-1 -mt-0.5" />
                        )}
                        {step.label}
                      </span>
                      {!done && (
                        <>
                          <span className="block text-[12px] text-faint mt-1 leading-relaxed">{step.detail}</span>
                          {step.ifSkipped && (
                            <span className="block text-[11.5px] text-amber/80 mt-1 leading-relaxed">
                              If skipped: {step.ifSkipped}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </label>
                </div>
              )
            })}
          </div>

          {/* Automatic half — read from our own telemetry, nothing to tick. */}
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              What we can see
            </p>
            {stages.map((s) => (
              <div key={s.key} className="flex items-start gap-2.5 text-[12.5px]">
                <span
                  className={`mt-[3px] h-3.5 w-3.5 rounded-full shrink-0 flex items-center justify-center ${
                    s.state === 'done' ? 'bg-teal' : s.state === 'waiting' ? 'bg-amber/30 border border-amber' : 'bg-navy-800 border border-navy-700'
                  }`}
                >
                  {s.state === 'done' && <Check className="h-2.5 w-2.5 text-[#04121d]" strokeWidth={4} />}
                </span>
                <span className="min-w-0">
                  <span className={s.state === 'done' ? 'text-faint' : 'text-ink'}>{s.label}</span>
                  <span className="block text-faint text-[11.5px] leading-relaxed">{s.note}</span>
                </span>
              </div>
            ))}
          </div>

          {device.notes && (
            <p className="text-[12px] text-faint italic border-l-2 border-navy-700 pl-2.5">{device.notes}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            {device.live.assetId && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/assets/${device.live.assetId}`}>Open asset</Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={remove} disabled={pending} className="text-faint">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddDeviceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [imei, setImei] = useState('')
  const [model, setModel] = useState<DeviceModel>('FMM00A')
  const [label, setLabel] = useState('')
  const [iccid, setIccid] = useState('')
  // Tracks whether the user has overridden the IMEI-derived model guess, so
  // scanning a second device doesn't silently stomp a deliberate choice.
  const [touchedModel, setTouchedModel] = useState(false)
  const [pending, start] = useTransition()

  const check = imei ? imeiLooksValid(imei) : { ok: false as const, reason: undefined }

  const onImei = (v: string) => {
    setImei(v)
    if (touchedModel) return
    const guess = modelFromImei(v)
    if (guess) setModel(guess)
  }

  const submit = () => {
    start(async () => {
      const res = await addDeviceAction({ imei, model, label, iccid })
      if (!res.ok) { toast(res.error ?? 'Could not add that device.', { variant: 'error' }); return }
      toast('Device added to the checklist.')
      setImei(''); setLabel(''); setIccid(''); setTouchedModel(false)
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add hardware</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label htmlFor="dev-imei">IMEI</Label>
            <Input
              id="dev-imei"
              inputMode="numeric"
              autoComplete="off"
              placeholder="15 digits from the device label"
              value={imei}
              onChange={(e) => onImei(e.target.value)}
              className="font-mono mt-1"
            />
            {imei && !check.ok && check.reason && (
              <p className="text-[12px] text-alert mt-1">{check.reason}</p>
            )}
            {imei && check.ok && (
              <p className="text-[12px] text-teal mt-1">Valid IMEI.</p>
            )}
          </div>

          <div>
            <Label>Model</Label>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              {MODEL_ORDER.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setModel(m); setTouchedModel(true) }}
                  className={`rounded-lg border px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                    model === m ? 'border-amber bg-amber/10 text-ink' : 'border-navy-700 text-faint hover:bg-navy-800'
                  }`}
                >
                  {m === 'OTHER' ? 'Other' : m}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-faint mt-1.5 leading-relaxed">{MODELS[model].role}</p>
          </div>

          <div>
            <Label htmlFor="dev-label">Going on (optional)</Label>
            <Input
              id="dev-label"
              placeholder="Chevy 1500, tool trailer…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="dev-iccid">SIM ICCID (optional)</Label>
            <Input
              id="dev-iccid"
              inputMode="numeric"
              placeholder="From the SIM card"
              value={iccid}
              onChange={(e) => setIccid(e.target.value)}
              className="font-mono mt-1"
            />
            <p className="text-[11.5px] text-faint mt-1 leading-relaxed">
              Log it now while the card is in your hand — nothing else links a SIM to a device afterwards.
            </p>
          </div>

          <Button onClick={submit} disabled={pending || !check.ok} className="w-full">
            {pending ? 'Adding…' : 'Add device'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DeviceOnboard({
  devices,
  counts,
}: {
  devices: DeviceWithLive[]
  counts: { total: number; online: number; waiting: number; stuck: number }
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display font-bold text-xl text-ink">Hardware setup</h1>
            <p className="text-[12.5px] text-faint mt-0.5 leading-relaxed">
              Every tracker, what it still needs, and why it isn&apos;t reporting yet — without opening a vendor console.
            </p>
          </div>
          <Button onClick={() => setAdding(true)} size="sm" className="shrink-0">
            <Plus className="h-4 w-4 mr-1.5" /> Add
          </Button>
        </div>

        {counts.total > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { n: counts.online, label: 'reporting', tint: 'text-teal' },
              { n: counts.waiting, label: 'on their timer', tint: 'text-amber' },
              { n: counts.stuck, label: 'need you', tint: counts.stuck ? 'text-alert' : 'text-faint' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-navy-800 bg-navy-900 px-3 py-2.5">
                <p className={`font-display font-bold text-xl ${s.tint}`}>{s.n}</p>
                <p className="text-[11px] text-faint">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {devices.length === 0 ? (
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-8 text-center">
            <Cpu className="h-8 w-8 text-faint mx-auto mb-3" />
            <p className="text-ink text-[14px] font-medium">No hardware logged yet</p>
            <p className="text-[12.5px] text-faint mt-1.5 leading-relaxed max-w-sm mx-auto">
              Add a tracker by its IMEI and you&apos;ll get a per-device checklist — the physical gotchas for that
              exact model, plus live status pulled from your own fleet data.
            </p>
            <Button onClick={() => setAdding(true)} className="mt-4">
              <Plus className="h-4 w-4 mr-1.5" /> Add your first device
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {devices.map((d) => <DeviceCard key={d.imei} device={d} />)}
          </div>
        )}

        <div className="rounded-xl border border-navy-800 bg-navy-900 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint mb-2 flex items-center gap-1.5">
            <Radio className="h-3 w-3" /> Why a device stays dark
          </p>
          <p className="text-[12.5px] text-faint leading-relaxed">
            Almost every failure looks the same from the outside — the device simply never appears. The order above is
            the order to check: a device can&apos;t report before its SIM is active, can&apos;t be placed before an
            asset carries its IMEI, and can&apos;t show a position before it sees sky. The first unfinished line is
            always the real problem, not the last one.
          </p>
        </div>
      </div>

      <AddDeviceDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}
