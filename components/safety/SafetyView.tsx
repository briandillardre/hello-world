'use client'

/**
 * Safety (migration 159), phone first: hold a toolbox talk from the library
 * (read the points, everyone signs with a finger), and report an incident,
 * a near miss or a hazard in under a minute. A report being typed is kept on
 * the phone until it files, so a dead zone never loses it.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ChevronDown, ChevronRight, HardHat, PenLine, Trash2, UserPlus } from 'lucide-react'
import {
  maybeRecordable, REPORT_KINDS, REPORT_WORDS, TALK_GROUPS, TALK_TOPICS, TREATMENTS, TREATMENT_WORDS, topicByKey,
  type ReportKind, type Treatment,
} from '@/lib/safety/talks'
import type { SafetyData, TalkRow } from '@/lib/db/safety'
import { closeReportAction, fileReportAction, removeTalkAction, reopenReportAction, signTalkAction, startTalkAction } from '@/lib/actions/safety'
import { SignatureMark, SignaturePad } from './SignaturePad'

const box = 'rounded-lg border border-navy-700 bg-navy-950 px-2 py-2 text-ink outline-none text-[14px] w-full'
const btn = 'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-50'
const primary = 'rounded-xl bg-amber px-4 py-2.5 font-semibold text-navy-950 disabled:opacity-50 text-[14px]'
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const localInput = (ms: number) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

const DRAFT = 'ht-safety-report-draft'
type ReportForm = { kind: ReportKind | null; what: string; when: string; siteId: string; injury: boolean; treatment: Treatment; people: string; actions: string; idem: string }
const newReport = (): ReportForm => ({ kind: null, what: '', when: localInput(Date.now()), siteId: '', injury: false, treatment: 'none', people: '', actions: '', idem: Math.random().toString(36).slice(2, 14) })

export function SafetyView({ data, sites, canWrite, canClose, seesAll, canRemoveAny, demo }: {
  data: SafetyData; sites: { id: string; name: string }[]; canWrite: boolean; canClose: boolean; seesAll: boolean; canRemoveAny: boolean; demo: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'talks' | 'reports'>('talks')
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function run<T extends { ok: boolean; error?: string }>(key: string, fn: () => Promise<T | null | undefined>, fail: string, after?: (r: T) => void) {
    setBusy(key); setErr(null); setNote(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || fail); return false }
    after?.(r); router.refresh(); return true
  }

  const openReports = data.reports.filter((r) => r.status === 'open').length

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4 text-[13px]">
        <div>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><HardHat className="h-5 w-5 text-amber" /> Safety</h1>
          <p className="text-faint">Toolbox talks the crew signs on the phone, and reports from the field. Same login as the time clock — no tablet, no paper.</p>
        </div>
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-muted">Demo mode — sample talks and reports. Sign in to hold your own.</p>}
        {!data.available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber">Safety is being set up — try again in a minute.</p>}
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}
        {note && <p className="flex items-start gap-2 rounded-xl border border-teal/40 bg-teal/5 px-3 py-2 text-teal"><Check className="h-4 w-4 mt-0.5 flex-none" /> {note}</p>}

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-navy-800 bg-navy-900/60 p-1">
          {(['talks', 'reports'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={'rounded-lg py-2 font-semibold ' + (tab === t ? 'bg-amber text-navy-950' : 'text-muted')}>
              {t === 'talks' ? 'Toolbox talks' : `Reports${openReports ? ` (${openReports} open)` : ''}`}
            </button>
          ))}
        </div>

        {tab === 'talks'
          ? <Talks data={data} sites={sites} canWrite={canWrite} canRemoveAny={canRemoveAny} busy={busy} run={run} />
          : <Reports data={data} sites={sites} canWrite={canWrite} canClose={canClose} seesAll={seesAll} busy={busy} run={run} onFiled={(paged) => setNote(paged ? 'Filed — the office’s phones were paged.' : 'Filed. Thank you — this is how the next one doesn’t happen.')} />}
      </div>
    </div>
  )
}

type Run = <T extends { ok: boolean; error?: string }>(key: string, fn: () => Promise<T | null | undefined>, fail: string, after?: (r: T) => void) => Promise<boolean>

// ── Talks ───────────────────────────────────────────────────────────────────

function Talks({ data, sites, canWrite, canRemoveAny, busy, run }: { data: SafetyData; sites: { id: string; name: string }[]; canWrite: boolean; canRemoveAny: boolean; busy: string | null; run: Run }) {
  const [holding, setHolding] = useState(false)
  const [topicKey, setTopicKey] = useState<string>(TALK_TOPICS[0].key)
  const [own, setOwn] = useState('')
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : '')
  const [notes, setNotes] = useState('')
  const [sig, setSig] = useState('')
  const topic = topicByKey(topicKey)
  const thisWeek = useMemo(() => {
    const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)
    return data.talks.filter((t) => t.heldOn >= since).length
  }, [data.talks])

  return (
    <div className="space-y-3">
      {canWrite && !holding && <button type="button" className={primary + ' w-full'} onClick={() => setHolding(true)}>Hold a toolbox talk</button>}
      {holding && (
        <section className="rounded-xl border border-amber/40 bg-navy-900/60 p-3 space-y-3">
          <label className="block space-y-1"><span className="text-faint text-[12px]">Topic</span>
            <select className={box} value={topicKey} onChange={(e) => setTopicKey(e.target.value)}>
              {TALK_GROUPS.map((g) => <optgroup key={g} label={g}>{TALK_TOPICS.filter((t) => t.group === g).map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}</optgroup>)}
              <option value="">My own topic…</option>
            </select>
          </label>
          {!topic && <input className={box} placeholder="What you're talking about" maxLength={160} value={own} onChange={(e) => setOwn(e.target.value)} />}
          {topic && (
            <div className="rounded-lg bg-navy-950/70 p-3 space-y-1.5">
              <p className="text-faint text-[11px] uppercase tracking-wider">Read these out</p>
              <ol className="list-decimal pl-5 space-y-1 text-ink text-[14px] leading-snug">{topic.points.map((p) => <li key={p}>{p}</li>)}</ol>
              {topic.ref && <p className="text-faint text-[11px]">{topic.ref}</p>}
            </div>
          )}
          <label className="block space-y-1"><span className="text-faint text-[12px]">Site</span>
            <select className={box} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Not at a site</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <textarea className={box} rows={2} maxLength={4000} placeholder="Notes (optional) — questions the crew asked, what you'll change" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div><p className="text-faint text-[12px] mb-1">You led it — sign</p><SignaturePad value={sig} onChange={setSig} /></div>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={!!busy || !sig || (!topic && !own.trim())} onClick={() => void run('start', () => startTalkAction({ topicKey: topic?.key ?? null, topic: own, siteId, notes, signature: sig }), 'Couldn’t start it — try again.', () => { setHolding(false); setNotes(''); setSig(''); setOwn('') })}>{busy === 'start' ? 'Saving…' : 'Start — the crew signs next'}</button>
            <button type="button" className={btn} onClick={() => setHolding(false)}>Cancel</button>
          </div>
        </section>
      )}
      <p className="text-faint">{thisWeek} talk{thisWeek === 1 ? '' : 's'} in the last 7 days.</p>
      {!data.talks.length && <p className="text-muted">No talks yet. {TALK_TOPICS.length} ready-to-read topics are in the library — trenching, struck-by, heat, lightning, silica and more.</p>}
      {data.talks.map((t) => <TalkCard key={t.id} t={t} me={data.me} canWrite={canWrite} canRemove={canRemoveAny || (!!data.me && t.ledBy === data.me)} busy={busy} run={run} />)}
    </div>
  )
}

function TalkCard({ t, me, canWrite, canRemove, busy, run }: { t: TalkRow; me: string | null; canWrite: boolean; canRemove: boolean; busy: string | null; run: Run }) {
  const [open, setOpen] = useState(false)
  const [signing, setSigning] = useState<'me' | 'guest' | null>(null)
  const [sig, setSig] = useState('')
  const [guest, setGuest] = useState('')
  const signed = !!me && t.signatures.some((s) => s.userId === me)
  const topic = topicByKey(t.topicKey)
  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4 mt-0.5 text-faint" /> : <ChevronRight className="h-4 w-4 mt-0.5 text-faint" />}
        <div className="flex-1 min-w-0">
          <p className="text-ink font-semibold">{t.topic}</p>
          <p className="text-faint">{[fmtDay(t.heldOn), t.siteName, t.leaderName ? `led by ${t.leaderName}` : null].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="rounded-full bg-teal/15 px-2 py-0.5 text-teal text-[12px] whitespace-nowrap">{t.signatures.length} signed</span>
      </button>
      {open && (
        <div className="space-y-2 pl-6">
          {topic && <ol className="list-decimal pl-5 space-y-0.5 text-muted">{topic.points.map((p) => <li key={p}>{p}</li>)}</ol>}
          {t.notes && <p className="text-muted whitespace-pre-wrap">{t.notes}</p>}
          <ul className="space-y-1">{t.signatures.map((s) => (
            <li key={s.id} className="flex items-center gap-2"><SignatureMark d={s.signature} /><span className="text-ink">{s.name}</span>{!s.userId && <span className="text-faint text-[11px]">no login</span>}<span className="text-faint text-[11px] ml-auto">{fmtWhen(s.signedAt)}</span></li>
          ))}</ul>
          {canRemove && canWrite && <button type="button" className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-red-400" onClick={() => { if (window.confirm('Remove this talk and its signatures?')) void run('rm', () => removeTalkAction(t.id), 'Couldn’t remove it.') }}><Trash2 className="h-3.5 w-3.5" /> Remove</button>}
        </div>
      )}
      {canWrite && !signing && (
        <div className="flex gap-2 flex-wrap">
          {!signed && <button type="button" className={btn + ' border-amber/50 text-amber'} onClick={() => setSigning('me')}><PenLine className="h-3.5 w-3.5" /> Sign it</button>}
          <button type="button" className={btn} onClick={() => setSigning('guest')}><UserPlus className="h-3.5 w-3.5" /> Someone without a login signs</button>
        </div>
      )}
      {signing && (
        <div className="space-y-2 rounded-lg border border-navy-700 bg-navy-950/60 p-2">
          {signing === 'guest' && <input className={box} placeholder="Their name" maxLength={80} value={guest} onChange={(e) => setGuest(e.target.value)} />}
          <SignaturePad value={sig} onChange={setSig} />
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={!!busy || !sig || (signing === 'guest' && !guest.trim())}
              onClick={() => void run('sign', () => signTalkAction(t.id, { signature: sig, guestName: signing === 'guest' ? guest : undefined }), 'Couldn’t save the signature — try again.', () => { setSigning(null); setSig(''); setGuest('') })}>{busy === 'sign' ? 'Saving…' : 'Save signature'}</button>
            <button type="button" className={btn} onClick={() => { setSigning(null); setSig('') }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Reports ─────────────────────────────────────────────────────────────────

function Reports({ data, sites, canWrite, canClose, seesAll, busy, run, onFiled }: {
  data: SafetyData; sites: { id: string; name: string }[]; canWrite: boolean; canClose: boolean; seesAll: boolean; busy: string | null; run: Run; onFiled: (paged: boolean) => void
}) {
  const [f, setF] = useState<ReportForm | null>(null)
  const [closing, setClosing] = useState<{ id: string; note: string } | null>(null)
  // one draft per login — a shared crew phone never hands one person's report to the next
  const key = `${DRAFT}:${data.me ?? 'anon'}`
  useEffect(() => {
    try { const v = localStorage.getItem(key); if (v) setF(JSON.parse(v) as ReportForm) } catch { /* none */ }
  }, [key])
  function edit(patch: Partial<ReportForm>) {
    setF((prev) => {
      const next = { ...(prev ?? newReport()), ...patch }
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* private window */ }
      return next
    })
  }
  function clear() { setF(null); try { localStorage.removeItem(key) } catch { /* */ } }

  async function file() {
    if (!f?.kind || busy) return
    const when = Date.parse(f.when)
    await run('file', () => fileReportAction({
      kind: f.kind, what: f.what, occurredAt: Number.isFinite(when) ? new Date(when).toISOString() : undefined, siteId: f.siteId || null,
      injury: f.kind === 'incident' && f.injury, treatment: f.kind === 'incident' ? f.treatment : 'none', people: f.people, actions: f.actions, idem: f.idem,
    }), 'Couldn’t file it — it’s kept on this phone; try again when you have signal.', (r) => { clear(); onFiled(!!(r as { paged?: boolean }).paged) })
  }

  return (
    <div className="space-y-3">
      {canWrite && !f && (
        <div className="grid grid-cols-3 gap-2">
          {REPORT_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => edit({ ...newReport(), kind: k })} className="rounded-xl border border-navy-700 bg-navy-900/60 px-2 py-3 text-center hover:border-amber/60">
              <span className="block text-[22px]">{REPORT_WORDS[k].emoji}</span>
              <span className="block text-ink font-semibold">{REPORT_WORDS[k].label}</span>
              <span className="block text-faint text-[11px] leading-tight">{REPORT_WORDS[k].hint}</span>
            </button>
          ))}
        </div>
      )}
      {f && (
        <section className="rounded-xl border border-amber/40 bg-navy-900/60 p-3 space-y-2.5">
          <div className="flex gap-1">{REPORT_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => edit({ kind: k })} className={'flex-1 rounded-lg py-1.5 text-[12.5px] font-semibold ' + (f.kind === k ? 'bg-amber text-navy-950' : 'border border-navy-700 text-muted')}>{REPORT_WORDS[k].emoji} {REPORT_WORDS[k].label}</button>
          ))}</div>
          <textarea className={box} rows={3} maxLength={4000} placeholder="What happened? Where exactly?" value={f.what} onChange={(e) => edit({ what: e.target.value })} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1"><span className="text-faint text-[12px]">When</span><input type="datetime-local" className={box} value={f.when} max={localInput(Date.now())} onChange={(e) => edit({ when: e.target.value })} /></label>
            <label className="block space-y-1"><span className="text-faint text-[12px]">Site</span>
              <select className={box} value={f.siteId} onChange={(e) => edit({ siteId: e.target.value })}><option value="">No site / somewhere else</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          </div>
          {f.kind === 'incident' && (
            <div className="space-y-2 rounded-lg bg-navy-950/60 p-2">
              <label className="flex items-center gap-2 text-ink"><input type="checkbox" className="h-5 w-5" checked={f.injury} onChange={(e) => edit({ injury: e.target.checked })} /> Someone was hurt</label>
              <label className="block space-y-1"><span className="text-faint text-[12px]">Treatment</span>
                <select className={box} value={f.treatment} onChange={(e) => edit({ treatment: e.target.value as Treatment })}>{TREATMENTS.map((t) => <option key={t} value={t}>{TREATMENT_WORDS[t]}</option>)}</select>
              </label>
              {maybeRecordable(f.treatment) && <p className="text-amber text-[12px]">Treatment past first aid or missed work may be OSHA-recordable — the office should check the 300 log.</p>}
              {(f.injury || f.treatment !== 'none') && <p className="text-faint text-[12px]">Filing this pages the office&apos;s phones right away.</p>}
            </div>
          )}
          <input className={box} maxLength={500} placeholder="Who was involved or saw it (optional)" value={f.people} onChange={(e) => edit({ people: e.target.value })} />
          <textarea className={box} rows={2} maxLength={4000} placeholder="What was done about it (optional)" value={f.actions} onChange={(e) => edit({ actions: e.target.value })} />
          <p className="text-faint text-[11.5px]">Kept on this phone until it files.</p>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={!!busy || !f.what.trim()} onClick={() => void file()}>{busy === 'file' ? 'Filing…' : 'File the report'}</button>
            <button type="button" className={btn} onClick={() => { if (!f.what.trim() || window.confirm('Throw this report away?')) clear() }}>Discard</button>
          </div>
        </section>
      )}
      <p className="text-faint">{seesAll ? 'Every report filed in the company.' : 'The reports you have filed. Foremen and up read them all.'}</p>
      {!data.reports.length && <p className="text-muted">No reports. Near misses are the ones worth filing — they&apos;re the free lesson.</p>}
      {data.reports.map((r) => (
        <section key={r.id} className={'rounded-xl border bg-navy-900/60 p-3 space-y-1.5 ' + (r.status === 'open' && r.kind === 'incident' ? 'border-red-400/40' : 'border-navy-800')}>
          <div className="flex items-start gap-2">
            <span className="text-[18px] leading-none">{REPORT_WORDS[r.kind].emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-ink font-semibold">{REPORT_WORDS[r.kind].label}{r.injury ? ' · injury' : ''}{r.treatment !== 'none' ? ` · ${TREATMENT_WORDS[r.treatment].toLowerCase()}` : ''}</p>
              <p className="text-faint">{[fmtWhen(r.occurredAt), r.siteName, r.reporterName ? `by ${r.reporterName}` : null].filter(Boolean).join(' · ')}</p>
            </div>
            <span className={'rounded-full px-2 py-0.5 text-[12px] ' + (r.status === 'open' ? 'bg-amber/15 text-amber' : 'bg-teal/15 text-teal')}>{r.status === 'open' ? 'Open' : 'Closed'}</span>
          </div>
          <p className="text-ink whitespace-pre-wrap">{r.what}</p>
          {r.people && <p className="text-muted">Involved: {r.people}</p>}
          {r.actions && <p className="text-muted">Done about it: {r.actions}</p>}
          {maybeRecordable(r.treatment) && <p className="text-amber text-[12px]">May be OSHA-recordable — check the 300 log.</p>}
          {r.status === 'closed' && <p className="text-faint">Closed{r.closerName ? ` by ${r.closerName}` : ''}{r.closedAt ? ` ${fmtWhen(r.closedAt)}` : ''}{r.closeNote ? ` — ${r.closeNote}` : ''}</p>}
          {canClose && r.status === 'open' && (closing?.id === r.id ? (
            <div className="flex gap-2 flex-wrap">
              <input className={box + ' flex-1 min-w-[180px]'} maxLength={2000} placeholder="What fixed it" value={closing.note} onChange={(e) => setClosing({ id: r.id, note: e.target.value })} />
              <button type="button" className={btn} disabled={!!busy} onClick={() => void run('close', () => closeReportAction(r.id, closing.note), 'Couldn’t close it.', () => setClosing(null))}>Close it</button>
            </div>
          ) : <button type="button" className={btn} onClick={() => setClosing({ id: r.id, note: '' })}>Close…</button>)}
          {canClose && r.status === 'closed' && <button type="button" className="text-[12px] text-faint hover:text-ink" onClick={() => void run('reopen', () => reopenReportAction(r.id), 'Couldn’t reopen it.')}>Reopen</button>}
        </section>
      ))}
    </div>
  )
}
