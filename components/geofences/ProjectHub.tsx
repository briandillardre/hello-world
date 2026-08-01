'use client'

import { useMemo, useState, useTransition } from 'react'
import { ClipboardList, Flag, Trash2, CircleDollarSign } from 'lucide-react'
import {
  addTaskAction, toggleTaskAction, deleteTaskAction,
  addMilestoneAction, toggleMilestoneAction, deleteMilestoneAction,
  saveBudgetAction, type ProjectTask, type ProjectMilestone,
} from '@/lib/actions/projects'

/**
 * Project Hub — the forward-looking half of the job cockpit: punch list,
 * milestone schedule, budget burn. The backward-looking half (usage, site
 * log, weather, invoicing) already self-feeds from the trackers above it.
 * Design rationale: docs/PROJECT-MANAGEMENT.md.
 */
export function ProjectHub({ zoneId, tasks: initialTasks, milestones: initialMilestones, members, budget: initialBudget, trackedCost, trackedDays, receiptsTotal, canViewCosts }: {
  zoneId: string
  tasks: ProjectTask[]
  milestones: ProjectMilestone[]
  members: { id: string; name: string }[]
  budget: number | null
  /** Equipment cost accrued in the zone over the usage window (same engine as invoicing). */
  trackedCost: number
  trackedDays: number
  receiptsTotal: number
  canViewCosts: boolean
}) {
  const [tasks, setTasks] = useState(initialTasks)
  const [milestones, setMilestones] = useState(initialMilestones)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? null
  const today = new Date().toISOString().slice(0, 10)
  const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  // ── Punch list state ──
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [high, setHigh] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const open = tasks.filter((t) => t.status === 'open')
  const done = tasks.filter((t) => t.status === 'done')

  function addTask() {
    if (!title.trim()) return
    start(async () => {
      const r = await addTaskAction(zoneId, { title, assigneeId: assignee || undefined, dueDate: due || undefined, high })
      if (r.ok && r.task) { setTasks((ts) => [r.task!, ...ts]); setTitle(''); setDue(''); setHigh(false); setError(null) }
      else setError(r.error ?? 'Failed')
    })
  }

  // ── Milestones state ──
  const [msName, setMsName] = useState('')
  const [msDate, setMsDate] = useState('')
  const msDone = milestones.filter((m) => m.done_at).length
  const nextMs = useMemo(() => milestones.find((m) => !m.done_at), [milestones])

  // ── Budget state ──
  const [budget, setBudget] = useState(initialBudget)
  const [budgetDraft, setBudgetDraft] = useState(initialBudget != null ? String(initialBudget) : '')
  const [editingBudget, setEditingBudget] = useState(false)
  const actual = trackedCost + receiptsTotal
  const pct = budget && budget > 0 ? Math.min(100, (actual / budget) * 100) : null
  const over = budget != null && budget > 0 && actual > budget

  return (
    <div className="space-y-6">
      {/* ── Punch list ─────────────────────────────────────────────── */}
      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2 flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5" /> Punch list
          {open.length > 0 && <span className="rounded-full bg-amber/15 border border-amber/30 text-amber px-1.5 text-[10px]">{open.length} open</span>}
        </h2>
        <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
          <div className="p-3 border-b border-navy-800 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask() }}
              placeholder="Add a punch item… (Enter to save)"
              className="w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2 text-sm text-ink placeholder:text-faint"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
                className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-muted">
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
                className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-muted" />
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
                <input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} className="accent-red-500" />
                High priority
              </label>
              <button type="button" onClick={addTask} disabled={!title.trim()}
                className="ml-auto rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5 disabled:opacity-40">
                Add
              </button>
            </div>
          </div>

          {open.length === 0 && done.length === 0 ? (
            <p className="p-4 text-sm text-faint">Nothing on the list — either the job&apos;s perfect or nobody wrote it down yet.</p>
          ) : (
            <div className="divide-y divide-navy-800">
              {open.map((t) => {
                const overdue = t.due_date && t.due_date < today
                return (
                  <div key={t.id} className="flex items-start gap-2.5 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-teal cursor-pointer"
                      onChange={() => {
                        setTasks((ts) => ts.map((x) => x.id === t.id ? { ...x, status: 'done' as const, done_at: new Date().toISOString() } : x))
                        start(async () => { await toggleTaskAction(zoneId, t.id, true) })
                      }}
                      aria-label={`Mark done: ${t.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {t.priority === 'high' && <span className="text-red-400 font-bold mr-1">!</span>}
                        {t.title}
                      </p>
                      <p className="text-[11px] text-faint">
                        {memberName(t.assignee_id) ?? 'Unassigned'}
                        {t.due_date && <span className={overdue ? 'text-red-400 font-semibold' : ''}> · due {fmtDay(t.due_date)}{overdue ? ' — overdue' : ''}</span>}
                      </p>
                    </div>
                    <button type="button" className="text-faint hover:text-red-400 mt-0.5"
                      onClick={() => {
                        setTasks((ts) => ts.filter((x) => x.id !== t.id))
                        start(async () => { await deleteTaskAction(zoneId, t.id) })
                      }}
                      aria-label={`Delete: ${t.title}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
              {done.length > 0 && (
                <button type="button" onClick={() => setShowDone((s) => !s)}
                  className="w-full px-3 py-2 text-left text-[11px] text-faint hover:text-muted">
                  {showDone ? '▾' : '▸'} {done.length} completed
                </button>
              )}
              {showDone && done.map((t) => (
                <div key={t.id} className="flex items-start gap-2.5 px-3 py-2 opacity-60">
                  <input
                    type="checkbox" checked className="mt-0.5 h-4 w-4 accent-teal cursor-pointer"
                    onChange={() => {
                      setTasks((ts) => ts.map((x) => x.id === t.id ? { ...x, status: 'open' as const, done_at: null } : x))
                      start(async () => { await toggleTaskAction(zoneId, t.id, false) })
                    }}
                    aria-label={`Reopen: ${t.title}`}
                  />
                  <p className="text-sm text-muted line-through flex-1">{t.title}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Milestones ─────────────────────────────────────────────── */}
      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2 flex items-center gap-1.5">
          <Flag className="h-3.5 w-3.5" /> Milestones
          {milestones.length > 0 && <span className="text-faint normal-case tracking-normal">{msDone}/{milestones.length}</span>}
        </h2>
        <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
          {milestones.length > 0 && (
            <div className="px-3 pt-3">
              <div className="h-1.5 rounded-full bg-navy-950 overflow-hidden">
                <div className="h-full bg-teal transition-all" style={{ width: `${milestones.length ? (msDone / milestones.length) * 100 : 0}%` }} />
              </div>
              {nextMs && (
                <p className="text-[11px] text-faint mt-1.5">
                  Next: <span className="text-muted">{nextMs.name}</span>
                  {nextMs.target_date && <span className={nextMs.target_date < today ? 'text-red-400 font-semibold' : ''}> — {fmtDay(nextMs.target_date)}{nextMs.target_date < today ? ' (slipped)' : ''}</span>}
                </p>
              )}
            </div>
          )}
          <div className="divide-y divide-navy-800">
            {milestones.map((m) => {
              const slipped = !m.done_at && m.target_date && m.target_date < today
              return (
                <div key={m.id} className="flex items-center gap-2.5 px-3 py-2.5">
                  <input
                    type="checkbox" checked={!!m.done_at}
                    className="h-4 w-4 accent-teal cursor-pointer"
                    onChange={(e) => {
                      const v = e.target.checked
                      setMilestones((ms) => ms.map((x) => x.id === m.id ? { ...x, done_at: v ? new Date().toISOString() : null } : x))
                      start(async () => { await toggleMilestoneAction(zoneId, m.id, v) })
                    }}
                    aria-label={`Toggle milestone: ${m.name}`}
                  />
                  <span className={`text-sm flex-1 ${m.done_at ? 'text-muted line-through' : 'text-ink'}`}>{m.name}</span>
                  {m.target_date && (
                    <span className={`text-[11px] ${slipped ? 'text-red-400 font-semibold' : 'text-faint'}`}>{fmtDay(m.target_date)}</span>
                  )}
                  <button type="button" className="text-faint hover:text-red-400"
                    onClick={() => {
                      setMilestones((ms) => ms.filter((x) => x.id !== m.id))
                      start(async () => { await deleteMilestoneAction(zoneId, m.id) })
                    }}
                    aria-label={`Delete milestone: ${m.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 p-3 border-t border-navy-800">
            <input value={msName} onChange={(e) => setMsName(e.target.value)}
              placeholder="Milestone (e.g. “Base down”)"
              className="flex-1 min-w-0 rounded-lg bg-navy-950 border border-navy-700 px-3 py-2 text-sm text-ink placeholder:text-faint" />
            <input type="date" value={msDate} onChange={(e) => setMsDate(e.target.value)}
              className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-muted" />
            <button type="button" disabled={!msName.trim()}
              onClick={() => start(async () => {
                const r = await addMilestoneAction(zoneId, { name: msName, targetDate: msDate || undefined })
                if (r.ok && r.milestone) {
                  setMilestones((ms) => [...ms, r.milestone!].sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999')))
                  setMsName(''); setMsDate(''); setError(null)
                } else setError(r.error ?? 'Failed')
              })}
              className="rounded-lg bg-navy-700 text-ink font-semibold text-xs px-3 py-1.5 disabled:opacity-40">
              Add
            </button>
          </div>
        </div>
      </section>

      {/* ── Budget ─────────────────────────────────────────────────── */}
      {canViewCosts && (
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2 flex items-center gap-1.5">
            <CircleDollarSign className="h-3.5 w-3.5" /> Budget
          </h2>
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
            {budget == null && !editingBudget ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-faint">No budget set — set one and the tracked costs burn against it automatically.</p>
                <button type="button" onClick={() => setEditingBudget(true)}
                  className="rounded-lg bg-navy-700 text-ink font-semibold text-xs px-3 py-1.5 flex-none">Set budget</button>
              </div>
            ) : editingBudget ? (
              <div className="flex items-center gap-2">
                <span className="text-muted">$</span>
                <input
                  value={budgetDraft} inputMode="decimal" autoFocus
                  onChange={(e) => setBudgetDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="w-36 rounded-lg bg-navy-950 border border-navy-700 px-3 py-2 text-sm text-ink"
                />
                <button type="button"
                  onClick={() => start(async () => {
                    const v = budgetDraft.trim() === '' ? null : Number(budgetDraft)
                    const r = await saveBudgetAction(zoneId, v)
                    if (r.ok) { setBudget(v); setEditingBudget(false); setError(null) }
                    else setError(r.error ?? 'Failed')
                  })}
                  className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-2">Save</button>
                <button type="button" onClick={() => setEditingBudget(false)} className="text-xs text-faint">Cancel</button>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm text-muted">
                    <span className={`font-display font-bold text-lg ${over ? 'text-red-400' : 'text-ink'}`}>${actual.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className="text-faint"> of ${Number(budget).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    {over && <span className="ml-2 rounded-full bg-red-500/15 border border-red-500/40 text-red-400 text-[10px] font-bold px-2 py-0.5">OVER BUDGET</span>}
                  </p>
                  <button type="button" onClick={() => { setBudgetDraft(budget != null ? String(budget) : ''); setEditingBudget(true) }}
                    className="text-xs text-faint hover:text-muted">Edit</button>
                </div>
                {pct != null && (
                  <div className="h-2 rounded-full bg-navy-950 overflow-hidden">
                    <div className={`h-full transition-all ${over ? 'bg-red-500' : pct > 80 ? 'bg-amber' : 'bg-teal'}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                <p className="text-[11px] text-faint">
                  Actual = tracked equipment cost (last {trackedDays} days: ${trackedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                  + job-coded receipts (all time: ${receiptsTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}). Labor from the clock adds in a later pass.
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
