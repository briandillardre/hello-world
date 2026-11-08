'use client'

/**
 * The project log — every job by stage, from the bid to the final lien waiver
 * (migration 152). A row opens the job; "Start a job" puts a site on the log;
 * Managers keep the company's checklist template here.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Briefcase, Plus, Search, ChevronRight, ListChecks, Trash2, AlertTriangle, X, Landmark } from 'lucide-react'
import type { LogRow, Member } from '@/lib/db/jobs'
import {
  BUCKETS, BUCKET_WORDS, bucketOf, CHECK_STAGES, CHECK_WORDS, DEFAULT_CHECKLIST, LINK_KEYS, LINK_WORDS, progressOf, sectionsNow, STAGE_WORDS,
  type Bucket, type CheckItem, type LinkKey, type TemplateItem,
} from '@/lib/jobs/job'
import { createJobAction, saveTemplateAction } from '@/lib/actions/jobs'
import { moneyFull } from '@/lib/projects'

const fmtDay = (d: string | null) => {
  if (!d) return null
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const STAGE_TONE: Record<Bucket, string> = {
  bidding: 'bg-sky-400/15 text-sky-300', won: 'bg-amber/15 text-amber', active: 'bg-teal/15 text-teal',
  closing: 'bg-violet-400/15 text-violet-300', closed: 'bg-navy-700 text-muted', lost: 'bg-navy-800 text-faint',
}

type View = 'open' | Bucket

export function JobsLog({ rows, members, available, sites, template, templateCustom, canEdit, canManage, canCosts, demo }: {
  rows: LogRow[]; members: Member[]; available: boolean; sites: { id: string; name: string }[]
  template: TemplateItem[]; templateCustom: boolean; canEdit: boolean; canManage: boolean; canCosts: boolean; demo: boolean
}) {
  const router = useRouter()
  const [view, setView] = useState<View>('open')
  const [q, setQ] = useState('')
  const [starting, setStarting] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(false)
  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members])

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { bidding: 0, won: 0, active: 0, closing: 0, closed: 0, lost: 0 }
    for (const r of rows) c[bucketOf(r.job.stage)]++
    return c
  }, [rows])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      const b = bucketOf(r.job.stage)
      if (view === 'open' ? b === 'closed' || b === 'lost' : b !== view) return false
      if (!needle) return true
      return [r.zoneName, r.job.number, r.job.customer, r.job.customerJobNo].some((v) => v && v.toLowerCase().includes(needle))
    })
  }, [rows, view, q])
  const groups = useMemo(() => {
    const order: Bucket[] = view === 'open' ? ['bidding', 'won', 'active', 'closing'] : [view as Bucket]
    return order.map((b) => ({
      b,
      rows: shown.filter((r) => bucketOf(r.job.stage) === b).sort((x, y) => {
        // Bids by due date; the rest newest number first.
        if (b === 'bidding') return (x.job.bidDue ?? '9999').localeCompare(y.job.bidDue ?? '9999')
        return (y.job.number ?? '').localeCompare(x.job.number ?? '', 'en-US', { numeric: true }) || x.zoneName.localeCompare(y.zoneName)
      }),
    })).filter((g) => g.rows.length)
  }, [shown, view])
  const contractOpen = canCosts ? rows.filter((r) => ['won', 'active', 'closing'].includes(bucketOf(r.job.stage))).reduce((s, r) => s + (r.money?.contractAmount ?? 0), 0) : 0
  const bidding = canCosts ? rows.filter((r) => bucketOf(r.job.stage) === 'bidding').reduce((s, r) => s + (r.money?.bidAmount ?? 0), 0) : 0

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          <div className="min-w-0 sm:flex-1">
            <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Briefcase className="h-5 w-5 text-amber" /> Jobs</h1>
            <p className="text-[12.5px] text-faint">Every job from the bid to the final lien waiver — where it stands, what is left on its checklist, who runs it.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canManage && (
              <button type="button" onClick={() => setEditingTemplate((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">
                <ListChecks className="h-4 w-4" /> Checklist template
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={() => setStarting((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-amber px-3 py-2 text-[12.5px] font-semibold text-navy-950">
                <Plus className="h-4 w-4" /> Start a job
              </button>
            )}
          </div>
        </div>

        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">Demo mode — sign in to keep your jobs here.</p>}
        {!available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-[12.5px] text-amber">Jobs are being set up — try again in a minute.</p>}
        {starting && <StartJob sites={sites} onDone={(zoneId) => router.push(`/jobs/${zoneId}`)} onCancel={() => setStarting(false)} />}
        {editingTemplate && <TemplateEditor initial={template} custom={templateCustom} onDone={() => { setEditingTemplate(false); router.refresh() }} />}

        {canCosts && (contractOpen > 0 || bidding > 0) && (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Out to bid" value={moneyFull(bidding)} sub={`${counts.bidding} bid${counts.bidding === 1 ? '' : 's'}`} />
            <Stat label="Contracts won, not closed" value={moneyFull(contractOpen)} sub={`${counts.won + counts.active + counts.closing} job${counts.won + counts.active + counts.closing === 1 ? '' : 's'}`} />
          </div>
        )}
        {canCosts && (
          <Link href="/jobs/portfolio" className="flex items-center gap-2 rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2 text-[12.5px] hover:border-navy-600">
            <Landmark className="h-4 w-4 text-teal flex-none" />
            <span className="flex-1"><span className="text-ink font-semibold">Money across jobs</span> <span className="text-faint">— what customers owe and how late, the WIP schedule, cash by month</span></span>
            <ChevronRight className="h-4 w-4 text-faint" />
          </Link>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {(['open', ...BUCKETS] as View[]).map((v) => {
            const n = v === 'open' ? counts.bidding + counts.won + counts.active + counts.closing : counts[v as Bucket]
            return (
              <button key={v} type="button" onClick={() => setView(v)}
                className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (view === v ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>
                {v === 'open' ? 'Open' : BUCKET_WORDS[v as Bucket]} <span className="opacity-70">{n}</span>
              </button>
            )
          })}
          <label className="ml-auto flex items-center gap-1.5 rounded-xl border border-navy-700 bg-navy-900/60 px-2.5 py-1.5 text-[12.5px]">
            <Search className="h-3.5 w-3.5 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, name or customer" className="bg-transparent outline-none text-ink w-44" />
          </label>
        </div>

        {!rows.length && available && !demo && (
          <div className="rounded-xl border border-navy-800 bg-navy-900/60 p-4 text-[12.5px] text-muted space-y-1">
            <p className="text-ink font-semibold">No jobs on the log yet.</p>
            <p>Start one from a site — draw the site on the map first if it isn&apos;t there. Each job carries its stage, the contract, its contacts and a checklist from the bid to closeout.</p>
          </div>
        )}
        {rows.length > 0 && !groups.length && <p className="text-[12.5px] text-faint">Nothing here.</p>}

        {groups.map((g) => (
          <section key={g.b} className="space-y-1.5">
            {view === 'open' && <h2 className="text-[11px] uppercase tracking-wider text-faint font-semibold">{BUCKET_WORDS[g.b]} · {g.rows.length}</h2>}
            {g.rows.map((r) => <Row key={r.job.id} r={r} pm={r.job.pmId ? nameOf.get(r.job.pmId) ?? null : null} canCosts={canCosts} />)}
          </section>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-faint">{label}</p>
      <p className="font-mono text-ink text-[15px]">{value}</p>
      <p className="text-[11.5px] text-faint">{sub}</p>
    </div>
  )
}

function Row({ r, pm, canCosts }: { r: LogRow; pm: string | null; canCosts: boolean }) {
  const j = r.job
  const b = bucketOf(j.stage)
  const items = r.checks.map((c, i) => ({ id: String(i), stage: c.stage, text: '', link: null, required: c.required, doneAt: c.done ? 'x' : null, doneBy: null, note: null, sort: i })) as CheckItem[]
  const now = sectionsNow(j.stage)
  const p = progressOf(items, now)
  const when = b === 'bidding' ? (j.bidDue ? `Bid due ${fmtDay(j.bidDue)}` : null)
    : b === 'won' ? (j.startDate ? `Starts ${fmtDay(j.startDate)}` : j.awardDate ? `Awarded ${fmtDay(j.awardDate)}` : null)
      : b === 'active' ? (j.targetCompletion ? `Due ${fmtDay(j.targetCompletion)}` : j.startDate ? `Started ${fmtDay(j.startDate)}` : null)
        : j.actualCompletion ? `Done ${fmtDay(j.actualCompletion)}` : null
  const amount = canCosts ? (b === 'bidding' ? r.money?.bidAmount : r.money?.contractAmount) ?? null : null
  return (
    <Link href={`/jobs/${j.zoneId}`} className="flex items-center gap-3 rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2.5 hover:border-navy-600">
      <div className="min-w-0 flex-1">
        <p className="text-ink text-[13.5px] font-semibold line-clamp-2 break-words">{j.number && !r.zoneName.startsWith(j.number) ? `${j.number} · ` : ''}{r.zoneName}</p>
        <p className="text-[12px] text-faint truncate">
          {[j.customer, when, pm ? `PM ${pm}` : null].filter(Boolean).join(' · ') || 'No customer yet'}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-none">
        <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + STAGE_TONE[b]}>{STAGE_WORDS[j.stage]}</span>
        <span className="text-[11.5px] text-faint whitespace-nowrap">
          {amount !== null ? <span className="font-mono text-muted">{moneyFull(amount)}</span> : null}
          {p.total > 0 && <> {amount !== null ? '· ' : ''}{p.done}/{p.total}{p.requiredOpen > 0 && <span className="text-amber"> · {p.requiredOpen} must-do</span>}</>}
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-faint flex-none" />
    </Link>
  )
}

function StartJob({ sites, onDone, onCancel }: { sites: { id: string; name: string }[]; onDone: (zoneId: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const list = sites.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60)
  async function start(id: string) {
    setBusy(id); setErr(null)
    const r = await createJobAction(id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t start the job — try again.'); return }
    onDone(id)
  }
  return (
    <div className="rounded-xl border border-amber/40 bg-navy-900 p-3 space-y-2 text-[12.5px]">
      <div className="flex items-center gap-2">
        <p className="text-ink font-semibold flex-1">Which site is the job on?</p>
        <button type="button" aria-label="Close" onClick={onCancel} className="rounded p-1 text-faint hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-faint">A job goes on a site zone. New site? Draw it on the map first (Zones → draw), then come back here.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a site" className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2.5 py-1.5 text-ink outline-none" />
      {err && <p className="text-red-300">{err}</p>}
      <div className="max-h-72 overflow-y-auto divide-y divide-navy-800 rounded-lg border border-navy-800">
        {list.map((s) => (
          <button key={s.id} type="button" disabled={!!busy} onClick={() => void start(s.id)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-navy-800 disabled:opacity-50">
            <span className="flex-1 truncate text-ink">{s.name}</span>
            <span className="text-teal text-[12px]">{busy === s.id ? 'Starting…' : 'Start'}</span>
          </button>
        ))}
        {!list.length && <p className="px-2.5 py-2 text-faint">{sites.length ? 'No site by that name.' : 'Every site already has a job.'}</p>}
      </div>
    </div>
  )
}

function TemplateEditor({ initial, custom, onDone }: { initial: TemplateItem[]; custom: boolean; onDone: () => void }) {
  const [items, setItems] = useState<TemplateItem[]>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (i: number, patch: Partial<TemplateItem>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  async function save() {
    setBusy(true); setErr(null)
    const r = await saveTemplateAction(items.filter((x) => x.text.trim())).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    onDone()
  }
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 space-y-3 text-[12.5px]">
      <div>
        <p className="text-ink font-semibold">The checklist every new job starts with</p>
        <p className="text-faint">{custom ? 'Your company’s own.' : 'The built-in one, from a site contractor’s project checklist.'} Jobs already on the log keep their own copy.</p>
      </div>
      {CHECK_STAGES.map((st) => (
        <div key={st} className="space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-faint font-semibold">{CHECK_WORDS[st]}</p>
          {items.map((it, i) => it.stage !== st ? null : (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <input value={it.text} onChange={(e) => set(i, { text: e.target.value.slice(0, 300) })} className="flex-1 min-w-[12rem] rounded-lg border border-navy-700 bg-navy-950 px-2 py-1 text-ink outline-none" />
              <select value={it.link ?? ''} onChange={(e) => set(i, { link: (e.target.value || null) as LinkKey | null })} className="rounded-lg border border-navy-700 bg-navy-950 px-1.5 py-1 text-muted">
                <option value="">No link</option>
                {LINK_KEYS.map((k) => <option key={k} value={k}>{LINK_WORDS[k]}</option>)}
              </select>
              <label className="inline-flex items-center gap-1 text-muted"><input type="checkbox" checked={it.required} onChange={(e) => set(i, { required: e.target.checked })} /> must-do</label>
              <button type="button" aria-label="Remove" onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setItems((xs) => [...xs, { stage: st, text: '', link: null, required: false }])} className="text-teal">+ Add to {CHECK_WORDS[st].toLowerCase()}</button>
        </div>
      ))}
      {err && <p className="flex items-center gap-1.5 text-red-300"><AlertTriangle className="h-4 w-4" /> {err}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy ? 'Saving…' : 'Save the template'}</button>
        <button type="button" onClick={() => setItems(DEFAULT_CHECKLIST)} className="rounded-xl border border-navy-700 px-3 py-1.5 text-muted">Start from the built-in one</button>
      </div>
    </div>
  )
}
