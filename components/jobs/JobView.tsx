'use client'

/**
 * One job (migration 152): where it stands on the road from the bid to the
 * final lien waiver, what the checklist says is next, every page the work is
 * done on (plans, takeoff, estimate, borings, machine files, drone progress,
 * the site's photos, logs and hours), the contract and who's who.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Briefcase, ChevronDown, ChevronRight, FileStack, MapPin, Ruler, Calculator, Layers, Cpu, Plane, Hash, CheckCircle2, AlertTriangle, Receipt, Wallet, ListChecks, FolderOpen, Gauge } from 'lucide-react'
import {
  bucketOf, CHECK_STAGES, MAIN_PATH, progressOf, readyToStart, sectionsNow, SIDE_STAGES, STAGE_WORDS, type Stage,
} from '@/lib/jobs/job'
import type { JobPage } from '@/lib/db/jobs'
import type { JobExtras } from '@/lib/db/jobwork'
import { expiryWords, DOC_KIND_WORDS, ONE_WORDS } from '@/lib/jobs/documents'
import { money as usd } from '@/lib/jobs/payapp'
import { assignNumberAction, createJobAction, setStageAction } from '@/lib/actions/jobs'
import { JobChecklist } from './JobChecklist'
import { JobDetails } from './JobDetails'
import { JobContacts } from './JobContacts'
import { CloseoutCard } from './CloseoutCard'


const NEXT_WORDS: Partial<Record<Stage, string>> = {
  estimating: 'Bid submitted', submitted: 'We won it', awarded: 'Start the work', active: 'Substantially complete',
  substantial: 'Financial closeout', closeout: 'Close the job', on_hold: 'Back to active',
}
const nextOf = (s: Stage): Stage | null => s === 'on_hold' ? 'active' : (() => { const i = MAIN_PATH.indexOf(s); return i >= 0 && i < MAIN_PATH.length - 1 ? MAIN_PATH[i + 1] : null })()

export function JobView({ zone, page, extras, today, canEdit, canManage, canCosts, canPlans, demo }: {
  zone: { id: string; name: string; kind: string | null }; page: JobPage; extras: JobExtras | null; today: string
  canEdit: boolean; canManage: boolean; canCosts: boolean; canPlans: boolean; demo: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [why, setWhy] = useState('')
  const [allOpen, setAllOpen] = useState(false)
  const job = page.job
  // The stage bar scrolls sideways on a phone — bring the current stage into view.
  const current = useRef<HTMLSpanElement | null>(null)
  useEffect(() => { current.current?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [job?.stage])

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>, fail: string) {
    setBusy(key); setErr(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || fail); return false }
    router.refresh()
    return true
  }

  const header = (
    <div>
      <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Jobs</Link>
      <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Briefcase className="h-5 w-5 text-amber flex-none" /> <span className="truncate">{zone.name}</span></h1>
    </div>
  )

  if (!job) {
    return (
      <div className="h-full overflow-auto pb-[54px] md:pb-20">
        <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
          {header}
          <div className="rounded-xl border border-navy-800 bg-navy-900/60 p-4 text-[12.5px] space-y-2">
            <p className="text-ink font-semibold">This site isn&apos;t on the project log yet.</p>
            <p className="text-muted">Put it on the log to track it from the bid to closeout — the stage, the contract, the contacts and a checklist that walks every step (takeoff, estimate, proposal, the contract, mobilizing, pay apps, closeout).</p>
            {demo && <p className="text-faint">Demo mode — sign in to start jobs.</p>}
            {err && <p className="text-red-300">{err}</p>}
            {canEdit && (
              <button type="button" disabled={!!busy} onClick={() => void run('create', () => createJobAction(zone.id), 'Couldn’t start the job — try again.')}
                className="rounded-xl bg-amber px-3 py-2 font-semibold text-navy-950 disabled:opacity-50">{busy === 'create' ? 'Starting…' : 'Put it on the project log'}</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const stage = job.stage
  const bucket = bucketOf(stage)
  const now = sectionsNow(stage)
  const p = progressOf(page.checklist, now)
  const next = nextOf(stage)
  const ready = stage === 'awarded' && readyToStart(page.checklist)
  const onPath = MAIN_PATH.includes(stage)
  const at = onPath ? MAIN_PATH.indexOf(stage) : -1
  const iss = extras?.issues
  const issuesSub = iss && iss.open + iss.waiting > 0
    ? [`${iss.open + iss.waiting} open`, iss.overdue ? `${iss.overdue} late` : '', iss.high ? `${iss.high} high` : ''].filter(Boolean).join(' · ')
    : 'What came up, who decides'
  const closedBy = job.closedBy ? page.members.find((m) => m.id === job.closedBy)?.name ?? null : null
  const closedLine = job.closedAt
    ? `Closed ${new Date(job.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${closedBy ? ` by ${closedBy}` : ''}${job.closedNote ? ` — closed with items open: ${job.closedNote}` : ''}.`
    : null
  const flow = [
    { href: `/jobs/${zone.id}/billing`, label: 'Pay apps', sub: 'Schedule of values, change orders, G702/G703', Icon: Receipt, show: canCosts },
    { href: `/jobs/${zone.id}/cost`, label: 'Job cost', sub: 'Budget vs actual, WIP', Icon: Wallet, show: canCosts },
    { href: `/jobs/${zone.id}/production`, label: 'Production', sub: canCosts ? 'Quantities by item, unit cost vs bid' : 'Log what got built today', Icon: Gauge, show: true },
    { href: `/jobs/${zone.id}/issues`, label: 'Issues & actions', sub: issuesSub, Icon: ListChecks, show: true },
    { href: `/jobs/${zone.id}/documents`, label: 'Documents', sub: extras?.docCount ? `${extras.docCount} filed` : 'COIs, permits, waivers, warranties', Icon: FolderOpen, show: true },
    { href: `/zones/${zone.id}`, label: 'Site page', sub: 'Map, photos, hours, punch list', Icon: MapPin, show: true },
    { href: `/plans/${zone.id}`, label: 'Plan room', sub: 'Sets, sheets, revisions', Icon: FileStack, show: canPlans },
    { href: `/plans/${zone.id}/takeoff`, label: 'Takeoff', sub: 'Quantities on the sheets', Icon: Ruler, show: canPlans },
    { href: `/plans/${zone.id}/estimate`, label: 'Estimate', sub: 'Sources, haul, crews, margins', Icon: Calculator, show: canPlans && canCosts },
    { href: `/plans/${zone.id}/ground`, label: 'Borings', sub: 'Rock, water, unsuitable', Icon: Layers, show: canPlans },
    { href: `/plans/${zone.id}/machine`, label: 'Machine files', sub: 'What the machines run', Icon: Cpu, show: canPlans },
    { href: `/plans/${zone.id}/progress`, label: 'Drone progress', sub: 'Cut and fill left', Icon: Plane, show: canPlans },
  ].filter((f) => f.show)

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {header}
        <p className="text-[12.5px] text-faint -mt-2">
          {[job.number && !zone.name.startsWith(job.number) ? `Job ${job.number}` : null, job.customer, job.customerJobNo ? `their # ${job.customerJobNo}` : null].filter(Boolean).join(' · ') || 'No customer written down yet'}
        </p>
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-[12.5px] text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        {/* Where it stands */}
        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
            {MAIN_PATH.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-none">
                <span ref={s === stage ? current : undefined} className={'rounded-full px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap ' +
                  (s === stage ? 'bg-amber text-navy-950' : at >= 0 && i < at ? 'bg-teal/15 text-teal' : 'bg-navy-800 text-faint')}>
                  {STAGE_WORDS[s]}
                </span>
                {i < MAIN_PATH.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-navy-600" />}
              </div>
            ))}
          </div>
          {!onPath && <p className="text-[12.5px] text-amber">{STAGE_WORDS[stage]}{job.lostReason ? ` — ${job.lostReason}` : ''}</p>}
          {ready && <p className="flex items-center gap-1.5 text-[12.5px] text-teal"><CheckCircle2 className="h-4 w-4" /> Ready to start — every must-do of the set-up is done.</p>}
          {canEdit && (
            <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
              {next && !(next === 'closed' && extras?.closeout) && (
                <button type="button" disabled={!!busy} onClick={() => void run('next', () => setStageAction(zone.id, next), 'Couldn’t move it — try again.')}
                  className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'next' ? 'Moving…' : NEXT_WORDS[stage] ?? STAGE_WORDS[next]}</button>
              )}
              <button type="button" onClick={() => setMoving((v) => !v)} className="inline-flex items-center gap-1 rounded-xl border border-navy-700 px-3 py-1.5 text-muted">Other stage <ChevronDown className="h-3.5 w-3.5" /></button>
              {!job.number && (
                <button type="button" disabled={!!busy} onClick={() => void run('num', () => assignNumberAction(zone.id), 'Couldn’t give it a number — try again.')}
                  className="inline-flex items-center gap-1 rounded-xl border border-navy-700 px-3 py-1.5 text-muted disabled:opacity-50"><Hash className="h-3.5 w-3.5" /> {busy === 'num' ? 'Numbering…' : 'Give it the next job number'}</button>
              )}
            </div>
          )}
          {moving && canEdit && (
            <div className="space-y-2 text-[12.5px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[...MAIN_PATH, ...SIDE_STAGES].filter((s) => s !== stage).map((s) => (
                  <button key={s} type="button" disabled={!!busy} onClick={() => void run(`to:${s}`, () => setStageAction(zone.id, s, why), 'Couldn’t move it — try again.').then((ok) => { if (ok) setMoving(false) })}
                    className={'rounded-full border px-2.5 py-1 ' + (SIDE_STAGES.includes(s) ? 'border-navy-700 text-faint' : 'border-navy-600 text-muted')}>{STAGE_WORDS[s]}</button>
                ))}
              </div>
              <input value={why} onChange={(e) => setWhy(e.target.value.slice(0, 300))} placeholder="Lost, no bid or cancelled? Why — price, scope, timing (optional)" className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none" />
            </div>
          )}
        </section>

        {/* What needs a look: open issues, papers running out */}
        {extras && (iss!.open + iss!.waiting > 0 || extras.expiring.length > 0) && (
          <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-1 text-[12.5px]">
            {iss!.open + iss!.waiting > 0 && (
              <Link href={`/jobs/${zone.id}/issues`} className={'flex items-center gap-1.5 hover:underline ' + (iss!.overdue || iss!.high ? 'text-amber' : 'text-muted')}>
                <ListChecks className="h-4 w-4 flex-none" /> {issuesSub}{iss!.exposure ? ` · ${usd(iss!.exposure)} exposure` : ''}
              </Link>
            )}
            {extras.expiring.map((d) => (
              <Link key={d.id} href={`/jobs/${zone.id}/documents`} className={'flex items-center gap-1.5 hover:underline ' + (d.expiresOn && d.expiresOn < today ? 'text-red-300' : 'text-amber')}>
                <AlertTriangle className="h-4 w-4 flex-none" /> {ONE_WORDS[d.kind] ?? DOC_KIND_WORDS[d.kind]}: {d.title} — {d.expiresOn ? expiryWords(d.expiresOn, today) : ''}
              </Link>
            ))}
          </section>
        )}

        {extras?.closeout && (
          <CloseoutCard zoneId={zone.id} checks={extras.closeout.checks} closed={stage === 'closed'} closedLine={closedLine} canEdit={canEdit} canManage={canManage} billing={canCosts} />
        )}

        {/* What's next */}
        {now.length > 0 && (
          <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-ink font-semibold text-[14px]">Now</h2>
              <span className="text-[12px] text-faint">{p.done} of {p.total} done{p.requiredOpen > 0 ? ` · ${p.requiredOpen} must-do left` : ''}</span>
            </div>
            <JobChecklist zoneId={zone.id} items={page.checklist} sections={now} members={page.members} canEdit={canEdit} billing={canCosts} />
          </section>
        )}

        {/* Where the work is done */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {flow.map((f) => (
            <Link key={f.href} href={f.href} className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2.5 hover:border-navy-600">
              <p className="flex items-center gap-1.5 text-ink text-[13px] font-semibold"><f.Icon className="h-4 w-4 text-teal" /> {f.label}</p>
              <p className="text-[11.5px] text-faint">{f.sub}</p>
            </Link>
          ))}
        </section>

        <section id="contract" className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2 scroll-mt-20">
          <h2 className="text-ink font-semibold text-[14px]">The contract</h2>
          <JobDetails zoneId={zone.id} job={job} money={page.money} members={page.members} canEdit={canEdit} canCosts={canCosts} />
        </section>

        <section id="contacts" className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2 scroll-mt-20">
          <h2 className="text-ink font-semibold text-[14px]">Contacts</h2>
          <JobContacts zoneId={zone.id} contacts={page.contacts} canEdit={canEdit} />
        </section>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <button type="button" onClick={() => setAllOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
            <h2 className="text-ink font-semibold text-[14px] flex-1">The whole checklist</h2>
            <span className="text-[12px] text-faint">{progressOf(page.checklist, [...CHECK_STAGES]).done} of {page.checklist.length}</span>
            <ChevronDown className={'h-4 w-4 text-faint transition-transform ' + (allOpen ? 'rotate-180' : '')} />
          </button>
          {allOpen && <JobChecklist zoneId={zone.id} items={page.checklist} sections={[...CHECK_STAGES]} members={page.members} canEdit={canEdit} billing={canCosts} />}
        </section>
        {bucket === 'closed' && <p className="text-[12px] text-faint">Closed. Completing the site itself (the Z in front of its name, and the QuickBooks customer) is on the Zones list.</p>}
      </div>
    </div>
  )
}
