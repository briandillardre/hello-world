'use client'

import { useState, useTransition } from 'react'
import { Wrench, Plus, X } from 'lucide-react'
import {
  createWorkOrderAction, updateWorkOrderAction, completeWorkOrderAction, cancelWorkOrderAction,
  type WorkOrder,
} from '@/lib/actions/workorders'
import { toast, confirmSheet } from '@/components/ui/feedback'

/** Failures (incl. demo mode) surface as a toast by the acting button — not a
 *  detached red string at the bottom of the section. */
function showError(e: string | null) {
  if (!e) return
  toast(e === 'Demo mode' ? 'Demo — changes aren’t saved.' : e, { variant: 'error' })
}

const STATUS_META: Record<WorkOrder['status'], { label: string; cls: string; next?: WorkOrder['status'] }> = {
  open:          { label: 'Open',          cls: 'bg-amber/15 border-amber/40 text-amber', next: 'in_progress' },
  in_progress:   { label: 'In progress',   cls: 'bg-teal/15 border-teal/40 text-teal', next: 'waiting_parts' },
  waiting_parts: { label: 'Waiting parts', cls: 'bg-violet-400/15 border-violet-400/40 text-violet-300', next: 'in_progress' },
  done:          { label: 'Done',          cls: 'bg-navy-800 border-navy-600 text-faint' },
  canceled:      { label: 'Canceled',      cls: 'bg-navy-800 border-navy-600 text-faint' },
}

const SOURCE_BADGE: Record<WorkOrder['source'], string | null> = {
  manual: null, schedule: 'auto · schedule', fault: 'auto · fault code', health: 'auto · health',
}

/**
 * Work orders — schedule → work order → cost → history, on one screen.
 * Overdue schedules open these automatically with the machine's real
 * reading attached; completing one writes the service record and restarts
 * the schedule clock. No per-seat fees for whoever turns the wrench.
 */
export function WorkOrders({ orders: initial, members, assetNames, available, canViewCosts }: {
  orders: WorkOrder[]
  members: { id: string; name: string }[]
  assetNames: Record<string, string>
  available: boolean
  /** Closed-order dollar totals hide for roles without cost permission. */
  canViewCosts: boolean
}) {
  const [orders, setOrders] = useState(initial)
  const [, start] = useTransition()
  const [showNew, setShowNew] = useState(false)
  const [completing, setCompleting] = useState<WorkOrder | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const open = orders.filter((o) => o.status !== 'done' && o.status !== 'canceled')
  const closed = orders.filter((o) => o.status === 'done' || o.status === 'canceled').slice(0, 20)
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? 'Unassigned'
  const today = new Date().toISOString().slice(0, 10)

  function patchLocal(id: string, p: Partial<WorkOrder>) {
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, ...p } : o)))
  }

  if (!available) {
    return (
      <section className="p-4">
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          Work orders unlock on the next app update — nothing for you to run.
        </p>
      </section>
    )
  }

  return (
    <section className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-amber" />
        <h2 className="font-display font-bold text-sm text-ink flex-1">
          Work orders
          {open.length > 0 && <span className="ml-2 rounded-full bg-amber/15 border border-amber/30 text-amber px-2 text-[10px] align-middle">{open.length} open</span>}
        </h2>
        <button type="button" onClick={() => setShowNew((s) => !s)}
          className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5 inline-flex items-center gap-1">
          <Plus className="h-3.5 w-3.5" /> Work order
        </button>
      </div>

      {showNew && (
        <NewWorkOrderForm
          assetNames={assetNames} members={members}
          onDone={(wo) => { if (wo) setOrders((os) => [wo, ...os]); setShowNew(false) }}
          onError={showError}
        />
      )}

      {open.length === 0 && !showNew ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          Nothing on the board. Overdue services open work orders here automatically.
        </p>
      ) : (
        <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
          {open.map((o) => {
            const meta = STATUS_META[o.status]
            const late = o.due_date && o.due_date < today
            return (
              <div key={o.id} className="p-3 space-y-2">
                <div className="flex items-start gap-2.5 flex-wrap">
                  <button
                    type="button"
                    title={meta.next ? `Move to ${STATUS_META[meta.next].label}` : undefined}
                    aria-label="advance status"
                    onClick={() => {
                      if (!meta.next) return
                      const prev = o.status
                      patchLocal(o.id, { status: meta.next })
                      start(async () => {
                        const r = await updateWorkOrderAction(o.id, { status: meta.next })
                        if (!r.ok) { patchLocal(o.id, { status: prev }); showError(r.error ?? 'Failed') }
                      })
                    }}
                    className={`flex-none rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}
                  >
                    {meta.label}{meta.next && <span aria-hidden> ›</span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink font-medium">
                      {o.priority !== 'normal' && <span className={`mr-1 font-bold ${o.priority === 'urgent' ? 'text-red-400' : 'text-amber'}`}>!</span>}
                      {o.title}
                    </p>
                    <p className="text-[11px] text-faint">
                      {assetNames[o.asset_id] ?? 'Asset'}
                      {o.reading != null && <> · reading {Number(o.reading).toLocaleString()}</>}
                      {SOURCE_BADGE[o.source] && <> · <span className="text-teal">{SOURCE_BADGE[o.source]}</span></>}
                      {o.due_date && <span className={late ? 'text-red-400 font-semibold' : ''}> · due {o.due_date}{late ? ' — late' : ''}</span>}
                    </p>
                    {o.detail && <p className="text-[11.5px] text-muted mt-0.5">{o.detail}</p>}
                  </div>
                  <div className="flex-none flex items-center gap-1.5">
                    <select
                      value={o.assignee_id ?? ''}
                      onChange={(e) => {
                        const prev = o.assignee_id
                        patchLocal(o.id, { assignee_id: e.target.value || null })
                        start(async () => {
                          const r = await updateWorkOrderAction(o.id, { assigneeId: e.target.value || null })
                          if (!r.ok) { patchLocal(o.id, { assignee_id: prev }); showError(r.error ?? 'Failed') }
                        })
                      }}
                      className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1 text-[11px] text-muted max-w-[120px]"
                      aria-label="Assignee"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setCompleting(o)}
                      className="rounded-lg bg-teal/15 border border-teal/40 text-teal font-bold text-[11px] px-2.5 py-1">
                      Complete
                    </button>
                    <button type="button" aria-label="Cancel work order"
                      onClick={async () => {
                        if (!(await confirmSheet({ title: 'Cancel this work order?', confirmLabel: 'Cancel it', destructive: true }))) return
                        const prev = o.status
                        patchLocal(o.id, { status: 'canceled' })
                        start(async () => {
                          const r = await cancelWorkOrderAction(o.id)
                          if (!r.ok) { patchLocal(o.id, { status: prev }); showError(r.error ?? 'Failed') }
                        })
                      }}
                      className="text-faint hover:text-red-400 p-1">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowClosed((s) => !s)} className="text-[11px] text-faint hover:text-muted">
            {showClosed ? '▾' : '▸'} {closed.length} recently closed
          </button>
          {showClosed && (
            <div className="mt-2 rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800 opacity-70">
              {closed.map((o) => (
                <div key={o.id} className="px-3 py-2 flex items-center gap-2 text-[12px]">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_META[o.status].cls}`}>{STATUS_META[o.status].label}</span>
                  <span className="text-muted flex-1 truncate">{o.title}</span>
                  <span className="text-faint">{memberName(o.assignee_id)}</span>
                  {canViewCosts && o.status === 'done' && (
                    <span className="font-mono text-faint">${(Number(o.parts_cost) + Number(o.labor_hours) * Number(o.labor_rate ?? 0)).toFixed(0)}</span>
                  )}
                  <button type="button"
                    onClick={() => {
                      const prev = o.status
                      patchLocal(o.id, { status: 'open' })
                      start(async () => {
                        const r = await updateWorkOrderAction(o.id, { status: 'open' })
                        if (!r.ok) { patchLocal(o.id, { status: prev }); showError(r.error ?? 'Failed') }
                      })
                    }}
                    className="text-[11px] font-semibold text-teal hover:underline flex-none">
                    Reopen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {completing && (
        <CompleteDialog
          wo={completing} assetName={assetNames[completing.asset_id] ?? 'Asset'}
          onClose={() => setCompleting(null)}
          onDone={(id) => { patchLocal(id, { status: 'done' }); setCompleting(null) }}
          onError={showError}
        />
      )}
    </section>
  )
}

function NewWorkOrderForm({ assetNames, members, onDone, onError }: {
  assetNames: Record<string, string>
  members: { id: string; name: string }[]
  onDone: (wo: WorkOrder | null) => void
  onError: (e: string | null) => void
}) {
  const [assetId, setAssetId] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<WorkOrder['priority']>('normal')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [pending, start] = useTransition()
  const inp = 'rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink'
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 flex flex-wrap gap-2">
      <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={inp}>
        <option value="">Machine…</option>
        {Object.entries(assetNames).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing"
        className={`${inp} flex-1 min-w-[160px]`} />
      <select value={priority} onChange={(e) => setPriority(e.target.value as WorkOrder['priority'])} className={inp}>
        <option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
      </select>
      <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inp}>
        <option value="">Assign to…</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inp} />
      <button type="button" disabled={pending || !assetId || !title.trim()}
        onClick={() => start(async () => {
          const r = await createWorkOrderAction({ assetId, title, priority, assigneeId: assignee || undefined, dueDate: due || undefined })
          if (r.ok) { onError(null); onDone(r.wo ?? null) } else onError(r.error ?? 'Failed')
        })}
        className="rounded-lg bg-amber text-[#1a1100] font-bold text-sm px-3.5 py-2 disabled:opacity-40">
        {pending ? '…' : 'Open it'}
      </button>
    </div>
  )
}

function CompleteDialog({ wo, assetName, onClose, onDone, onError }: {
  wo: WorkOrder; assetName: string
  onClose: () => void; onDone: (id: string) => void; onError: (e: string | null) => void
}) {
  const [parts, setParts] = useState('')
  const [hours, setHours] = useState('')
  const [rate, setRate] = useState('')
  const [vendor, setVendor] = useState('')
  const [notes, setNotes] = useState('')
  const [reading, setReading] = useState(wo.reading != null ? String(wo.reading) : '')
  const [pending, start] = useTransition()
  const total = (Number(parts) || 0) + (Number(hours) || 0) * (Number(rate) || 0)
  const inp = 'w-full rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink'
  const lbl = 'block text-[10px] font-mono uppercase tracking-[0.1em] text-faint mb-1'
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4" role="dialog" aria-label="Complete work order">
      <div className="absolute inset-0 bg-navy-950/70" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-navy-700 bg-navy-900 p-4 space-y-3">
        <p className="font-display font-bold text-ink">Complete: {wo.title}</p>
        <p className="text-[11.5px] text-faint -mt-2">{assetName} — writes the service record and restarts the schedule clock.</p>
        <div className="grid grid-cols-3 gap-2">
          <label><span className={lbl}>Parts $</span><input inputMode="decimal" value={parts} onChange={(e) => setParts(e.target.value.replace(/[^0-9.]/g, ''))} className={inp} /></label>
          <label><span className={lbl}>Labor hrs</span><input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))} className={inp} /></label>
          <label><span className={lbl}>Rate $/hr</span><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} className={inp} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label><span className={lbl}>Vendor / shop</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inp} /></label>
          <label><span className={lbl}>Hours/odometer now</span><input inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value.replace(/[^0-9.]/g, ''))} className={inp} /></label>
        </div>
        <label><span className={lbl}>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} placeholder="What was done" /></label>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-sm text-muted flex-1">Total <span className="text-ink font-bold">${total.toFixed(2)}</span></span>
          <button type="button" onClick={onClose} className="text-xs text-faint px-2">Cancel</button>
          <button type="button" disabled={pending}
            onClick={() => start(async () => {
              const r = await completeWorkOrderAction(wo.id, {
                partsCost: Number(parts) || 0, laborHours: Number(hours) || 0, laborRate: Number(rate) || 0,
                vendor, notes, reading: reading === '' ? undefined : Number(reading),
              })
              if (r.ok) { onError(null); onDone(wo.id) } else onError(r.error ?? 'Failed')
            })}
            className="rounded-lg bg-teal text-[#001523] font-bold text-sm px-3.5 py-2 disabled:opacity-40">
            {pending ? 'Saving…' : 'Complete & log service'}
          </button>
        </div>
      </div>
    </div>
  )
}
