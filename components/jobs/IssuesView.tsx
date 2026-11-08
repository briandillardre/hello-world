'use client'

/**
 * Issues & actions (migration 156): the PM Master's tab as a screen. What came
 * up, its kind and priority, who owns it, who has to decide and by when, what
 * it could cost in dollars and days, and how it ended. An issue that is extra
 * work becomes a change order in one tap (Pay apps prices and sends it).
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ListChecks, Plus, Pencil, Trash2, AlertTriangle, ChevronDown, FilePlus2 } from 'lucide-react'
import {
  ISSUE_CATEGORIES, ISSUE_CATEGORY_WORDS, ISSUE_PRIORITIES, ISSUE_PRIORITY_WORDS, ISSUE_STATUSES, ISSUE_STATUS_WORDS,
  isOverdue, issueSummary, sortIssues, type Issue, type IssueCategory, type IssuePriority, type IssueStatus,
} from '@/lib/jobs/issues'
import { money } from '@/lib/jobs/payapp'
import type { Member } from '@/lib/db/jobs'
import { deleteIssueAction, issueToChangeOrderAction, saveIssueAction } from '@/lib/actions/jobissues'

const inp = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none text-[13px]'
const btn = 'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-50'
const fmtDay = (d: string | null) => {
  if (!d) return ''
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

interface Draft {
  id: string | null; title: string; category: IssueCategory; priority: IssuePriority; status: IssueStatus; ownerId: string; decisionFrom: string
  dueOn: string; scheduleDays: string; costExposure: string; detail: string; resolution: string
}
const blank = (): Draft => ({ id: null, title: '', category: 'site', priority: 'medium', status: 'open', ownerId: '', decisionFrom: '', dueOn: '', scheduleDays: '', costExposure: '', detail: '', resolution: '' })
const draftOf = (i: Issue, members: Member[]): Draft => ({
  // Someone who has left the team can't be picked again — the form starts at "Nobody yet" for them.
  id: i.id, title: i.title, category: i.category, priority: i.priority, status: i.status, ownerId: i.ownerId && members.some((m) => m.id === i.ownerId) ? i.ownerId : '', decisionFrom: i.decisionFrom ?? '',
  dueOn: i.dueOn ?? '', scheduleDays: i.scheduleDays === null ? '' : String(i.scheduleDays), costExposure: i.costExposure === null ? '' : String(i.costExposure),
  detail: i.detail ?? '', resolution: i.resolution ?? '',
})

export function IssuesView({ zone, issues, available, members, coNumbers, today, canEdit, canManage, canCosts, demo }: {
  zone: { id: string; name: string }; issues: Issue[]; available: boolean; members: Member[]; coNumbers: Record<string, number>
  today: string; canEdit: boolean; canManage: boolean; canCosts: boolean; demo: boolean
}) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? 'Someone who left' : null)
  const sorted = sortIssues(issues, today)
  const live = sorted.filter((i) => i.status !== 'resolved')
  const done = sorted.filter((i) => i.status === 'resolved')
  const sum = issueSummary(issues, today, canCosts)

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>, fail: string, after?: () => void) {
    setBusy(key); setErr(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || fail); return }
    after?.(); router.refresh()
  }

  function save(d: Draft) {
    const raw: Record<string, unknown> = {
      title: d.title, category: d.category, priority: d.priority, status: d.status, ownerId: d.ownerId || null, decisionFrom: d.decisionFrom,
      dueOn: d.dueOn || null, scheduleDays: d.scheduleDays, detail: d.detail, resolution: d.resolution,
    }
    if (canCosts) raw.costExposure = d.costExposure
    void run('save', () => saveIssueAction(zone.id, raw, d.id), 'Couldn’t save — try again.', () => setDraft(null))
  }

  const row = (i: Issue) => {
    const late = isOverdue(i, today)
    const co = i.changeOrderId ? coNumbers[i.changeOrderId] : undefined
    const expanded = open === i.id
    return (
      <div key={i.id} className="py-2 space-y-1">
        <button type="button" onClick={() => setOpen(expanded ? null : i.id)} className="w-full text-left flex items-start gap-2">
          <span className="w-10 flex-none text-faint font-mono">I-{i.number}</span>
          <span className="flex-1 min-w-0">
            <span className={'block ' + (i.status === 'resolved' ? 'text-muted' : 'text-ink')}>{i.title}</span>
            <span className="block text-[11.5px] text-faint">
              {[ISSUE_CATEGORY_WORDS[i.category], i.status === 'waiting' ? `waiting on ${i.decisionFrom ?? 'a decision'}` : i.status === 'resolved' ? `resolved ${fmtDay(i.resolvedOn)}` : null,
                nameOf(i.ownerId), i.dueOn && i.status !== 'resolved' ? `due ${fmtDay(i.dueOn)}` : null,
                i.scheduleDays ? `${i.scheduleDays > 0 ? '+' : ''}${i.scheduleDays} days` : null,
                canCosts && i.costExposure ? money(i.costExposure) : null, co ? `CO ${co}` : null].filter(Boolean).join(' · ')}
            </span>
          </span>
          {i.status !== 'resolved' && i.priority === 'high' && <span className="flex-none rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">High</span>}
          {late && <span className="flex-none rounded-full bg-amber/15 px-2 py-0.5 text-[11px] text-amber">Late</span>}
          <ChevronDown className={'h-4 w-4 flex-none text-faint transition-transform ' + (expanded ? 'rotate-180' : '')} />
        </button>
        {expanded && (
          <div className="ml-12 space-y-1.5 text-muted">
            {i.detail && <p className="whitespace-pre-wrap">{i.detail}</p>}
            {i.decisionFrom && i.status !== 'waiting' && <p className="text-faint">Decision from: {i.decisionFrom}</p>}
            {i.resolution && <p className="whitespace-pre-wrap text-teal">Resolution: {i.resolution}</p>}
            <p className="text-faint">Opened {fmtDay(i.openedOn)}{co && canCosts ? <> · <Link href={`/jobs/${zone.id}/billing`} className="text-teal hover:underline">Change order {co}</Link></> : null}</p>
            {canEdit && (
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => setDraft(draftOf(i, members))} className={btn}><Pencil className="h-3.5 w-3.5" /> Edit</button>
                {canCosts && !co && (
                  <button type="button" disabled={!!busy} onClick={() => void run(`co:${i.id}`, () => issueToChangeOrderAction(zone.id, i.id), 'Couldn’t start the change order — try again.')} className={btn}>
                    <FilePlus2 className="h-3.5 w-3.5" /> {busy === `co:${i.id}` ? 'Starting…' : 'Make it a change order'}
                  </button>
                )}
                {canManage && (
                  <button type="button" onClick={() => { if (window.confirm(`Remove I-${i.number}?`)) void run(`del:${i.id}`, () => deleteIssueAction(zone.id, i.id), 'Couldn’t remove it — try again.') }} className={btn + ' hover:text-red-400'}><Trash2 className="h-3.5 w-3.5" /> Remove</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4 text-[12.5px]">
        <div>
          <Link href={`/jobs/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> The job</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><ListChecks className="h-5 w-5 text-amber flex-none" /> <span className="truncate">Issues & actions · {zone.name}</span></h1>
          <p className="text-faint">What came up on the job — who owns it, who has to decide and by when, what it could cost in dollars and days, and how it ended. Extra work becomes a change order.</p>
        </div>
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-muted">Demo mode — sign in to track issues.</p>}
        {!available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber">Issues are being set up — try again in a minute.</p>}
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-full bg-navy-800 px-2.5 py-1 text-ink">{sum.open} open</span>
          {sum.waiting > 0 && <span className="rounded-full bg-navy-800 px-2.5 py-1 text-muted">{sum.waiting} waiting on a decision</span>}
          {sum.overdue > 0 && <span className="rounded-full bg-amber/15 px-2.5 py-1 text-amber">{sum.overdue} late</span>}
          {sum.high > 0 && <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-red-300">{sum.high} high</span>}
          {canCosts && sum.exposure ? <span className="rounded-full bg-navy-800 px-2.5 py-1 text-muted">{money(sum.exposure)} exposure</span> : null}
          {canEdit && !draft && <button type="button" onClick={() => setDraft(blank())} className="ml-auto inline-flex items-center gap-1 rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950"><Plus className="h-4 w-4" /> Add an issue</button>}
        </div>

        {draft && (
          <section className="rounded-xl border border-navy-700 bg-navy-900 p-3 space-y-2">
            <h2 className="text-ink font-semibold text-[14px]">{draft.id ? 'Edit the issue' : 'A new issue'}</h2>
            <input className={inp} placeholder="What came up — e.g. Rock at the outfall, 3 ft above the plan" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Kind</span>
                <select className={inp} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as IssueCategory })}>{ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{ISSUE_CATEGORY_WORDS[c]}</option>)}</select></label>
              <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Priority</span>
                <select className={inp} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as IssuePriority })}>{ISSUE_PRIORITIES.map((p) => <option key={p} value={p}>{ISSUE_PRIORITY_WORDS[p]}</option>)}</select></label>
              <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Status</span>
                <select className={inp} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as IssueStatus })}>{ISSUE_STATUSES.map((st) => <option key={st} value={st}>{ISSUE_STATUS_WORDS[st]}</option>)}</select></label>
              <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Owner</span>
                <select className={inp} value={draft.ownerId} onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })}><option value="">Nobody yet</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
              <label className="space-y-0.5 col-span-2"><span className="block text-[11.5px] text-faint">Decision needed from</span>
                <input className={inp} placeholder="Engineer, owner, GC, inspector…" value={draft.decisionFrom} onChange={(e) => setDraft({ ...draft, decisionFrom: e.target.value })} maxLength={120} /></label>
              <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Due</span>
                <input type="date" className={inp} value={draft.dueOn} onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })} /></label>
              <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Schedule (days)</span>
                <input inputMode="numeric" className={inp} placeholder="e.g. 3" value={draft.scheduleDays} onChange={(e) => setDraft({ ...draft, scheduleDays: e.target.value })} /></label>
              {canCosts && (
                <label className="space-y-0.5 col-span-2"><span className="block text-[11.5px] text-faint">Could cost ($ — a saving in parentheses)</span>
                  <input inputMode="decimal" className={inp} placeholder="12,500" value={draft.costExposure} onChange={(e) => setDraft({ ...draft, costExposure: e.target.value })} /></label>
              )}
            </div>
            <textarea className={inp} rows={3} placeholder="What happened, where, what it affects" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} maxLength={2000} />
            {(draft.status === 'resolved' || draft.resolution) && (
              <textarea className={inp} rows={2} placeholder="How it was settled" value={draft.resolution} onChange={(e) => setDraft({ ...draft, resolution: e.target.value })} maxLength={2000} />
            )}
            <div className="flex gap-2">
              <button type="button" disabled={!!busy || !draft.title.trim()} onClick={() => save(draft)} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setDraft(null)} className={btn}>Cancel</button>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-1 divide-y divide-navy-800">
          {live.map(row)}
          {!live.length && <p className="py-2 text-faint">Nothing open{issues.length ? '' : ' — add the first one when something comes up'}.</p>}
        </section>

        {done.length > 0 && (
          <section className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-1">
            <button type="button" onClick={() => setShowResolved((v) => !v)} className="w-full flex items-center gap-2 py-2 text-left">
              <span className="flex-1 text-ink font-semibold">Resolved ({done.length})</span>
              <ChevronDown className={'h-4 w-4 text-faint transition-transform ' + (showResolved ? 'rotate-180' : '')} />
            </button>
            {showResolved && <div className="divide-y divide-navy-800 border-t border-navy-800">{done.map(row)}</div>}
          </section>
        )}
      </div>
    </div>
  )
}
