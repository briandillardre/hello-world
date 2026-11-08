'use client'

/**
 * A job's billing (migration 154): the applications for payment, the schedule
 * of values they bill against, and the change orders. A draft application is
 * computed live as you type (this period in dollars or as % complete to date,
 * stored material); sending it freezes the numbers on the server. PDF and
 * Excel come straight off the screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, FileSpreadsheet, Plus, Send, Trash2, Pencil, AlertTriangle, Receipt } from 'lucide-react'
import {
  APP_STATUS_WORDS, CO_STATUSES, CO_STATUS_WORDS, CO_TYPES, CO_TYPE_WORDS, counts, lineMath, linesFor, money, readDollars, thisPeriodFromPct, totalsFor, appWarnings,
  type AppView, type ChangeOrder, type SovLine,
} from '@/lib/jobs/payapp'
import type { DocInfo } from '@/lib/jobs/payapp-docs'
import {
  deleteChangeOrderAction, deleteDraftAction, deleteSovLineAction, newPayAppAction, payAppStatusAction, saveChangeOrderAction,
  savePayAppAction, saveSovLineAction, sovFromEstimateAction, submitPayAppAction, voidPayAppAction,
} from '@/lib/actions/payapps'
import { isNativeApp } from '@/lib/native'
import { publishExport } from '@/lib/export-upload'

type Tab = 'apps' | 'sov' | 'cos'
const fmtDay = (d: string | null) => {
  if (!d) return ''
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const inp = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none text-[13px]'
const btn = 'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-50'
const STATUS_TONE: Record<string, string> = { draft: 'bg-navy-700 text-muted', submitted: 'bg-sky-400/15 text-sky-300', approved: 'bg-teal/15 text-teal', paid: 'bg-emerald-400/15 text-emerald-300', void: 'bg-navy-800 text-faint line-through' }

async function deliver(blob: Blob, name: string, kind: 'pdf' | 'xlsx', title: string): Promise<string | null> {
  if (isNativeApp()) {
    // The app's WebView has no download door — the file goes up as a private export link.
    const r = await publishExport(blob, name, kind, title)
    if (!r.ok) return r.error
    window.location.href = r.link.fileUrl
    return null
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return null
}

export function BillingView({ zone, info, contract, billing, canEdit, canManage, demo }: {
  zone: { id: string; name: string }
  info: DocInfo
  contract: number | null
  billing: { available: boolean; sov: SovLine[]; cos: ChangeOrder[]; apps: AppView[] }
  canEdit: boolean; canManage: boolean; demo: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(billing.sov.length ? 'apps' : 'sov')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const apps = billing.apps
  const draft = apps.find((a) => a.status === 'draft') ?? null
  const [openId, setOpenId] = useState<string | null>(draft?.id ?? apps.filter((a) => a.status !== 'void').at(-1)?.id ?? null)
  const open = apps.find((a) => a.id === openId) ?? null
  const sovTotal = billing.sov.reduce((s, l) => s + Math.round(l.scheduled * 100), 0) / 100
  const billed = [...apps].reverse().find((a) => counts(a.status))
  const paidTotal = apps.filter((a) => counts(a.status)).reduce((s, a) => s + (a.paidAmount ?? 0), 0)

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>, fail: string, after?: () => void) {
    setBusy(key); setErr(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || fail); return false }
    after?.(); router.refresh(); return true
  }
  // The open draft's unsaved entries live in its panel — leaving the tab or opening another application unmounts it.
  const draftDirty = useRef(false)
  const onDirty = useCallback((d: boolean) => { draftDirty.current = d }, [])
  const leaveOk = () => !draftDirty.current || window.confirm('This pay app has changes that aren’t saved. Leave them?')

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href={`/jobs/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> The job</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Receipt className="h-5 w-5 text-amber flex-none" /> <span className="truncate">Pay apps · {zone.name}</span></h1>
          <p className="text-[12.5px] text-faint">The schedule of values, change orders and each month&apos;s application for payment — the application page and the continuation sheet, as a PDF or an Excel with live formulas.</p>
        </div>
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">Demo mode — sign in to bill a job.</p>}
        {!billing.available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-[12.5px] text-amber">Pay apps are being set up — try again in a minute.</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
          <Stat label="Contract to date" value={money(billed?.totals.contractToDate ?? ((contract ?? sovTotal) + billing.cos.filter((c) => c.status === 'approved').reduce((s, c) => s + (c.approved ?? 0), 0)))} />
          <Stat label="Billed to date" value={money(billed?.totals.completedStored ?? 0)} />
          <Stat label="Retainage held" value={money(billed?.totals.retTotal ?? 0)} />
          <Stat label="Paid" value={money(paidTotal)} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {([['apps', `Applications ${apps.filter((a) => a.status !== 'void').length}`], ['sov', `Schedule of values ${billing.sov.length}`], ['cos', `Change orders ${billing.cos.length}`]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => { if (k !== tab && leaveOk()) setTab(k) }} className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (tab === k ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>{label}</button>
          ))}
        </div>
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-[12.5px] text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        {tab === 'apps' && (
          <section className="space-y-3">
            {!billing.sov.length && <p className="text-[12.5px] text-faint">Set up the schedule of values first — every application bills against it.</p>}
            {canEdit && billing.sov.length > 0 && !draft && (
              <button type="button" disabled={!!busy} onClick={() => void run('new', async () => { const r = await newPayAppAction(zone.id); if (r?.ok) setOpenId(r.id); return r }, 'Couldn’t start it — try again.')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber px-3 py-2 text-[12.5px] font-semibold text-navy-950 disabled:opacity-50"><Plus className="h-4 w-4" /> {busy === 'new' ? 'Starting…' : `Start pay app ${Math.max(0, ...apps.filter((a) => a.status !== 'void').map((a) => a.appNo)) + 1}`}</button>
            )}
            <div className="space-y-1.5">
              {[...apps].reverse().map((a) => (
                <button key={a.id} type="button" onClick={() => { if (a.id !== openId && leaveOk()) setOpenId(a.id) }}
                  className={'w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-[12.5px] ' + (a.id === openId ? 'border-amber/50 bg-navy-900' : 'border-navy-800 bg-navy-900/60')}>
                  <span className="text-ink font-semibold">Pay app {a.appNo}</span>
                  <span className="text-faint">to {fmtDay(a.periodTo)}</span>
                  <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + STATUS_TONE[a.status]}>{APP_STATUS_WORDS[a.status]}</span>
                  {a.waiver !== 'none' && <span className="text-[11px] text-faint">{a.waiver === 'final' ? 'final waiver' : 'partial waiver'}</span>}
                  <span className="ml-auto font-mono text-ink">{money(a.totals.currentDue)}</span>
                </button>
              ))}
            </div>
            {open && <AppPanel key={open.id} app={open} apps={apps} sov={billing.sov} cos={billing.cos} contract={contract} info={info} canEdit={canEdit} canManage={canManage} run={run} busy={busy} onDirty={onDirty} />}
          </section>
        )}

        {tab === 'sov' && <SovPanel zoneId={zone.id} sov={billing.sov} total={sovTotal} contract={contract} canEdit={canEdit} run={run} busy={busy} />}
        {tab === 'cos' && <CoPanel zoneId={zone.id} cos={billing.cos} canEdit={canEdit} run={run} busy={busy} />}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wider text-faint">{label}</p>
      <p className="font-mono text-ink text-[14px]">{value}</p>
    </div>
  )
}

type Run = (key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>, fail: string, after?: () => void) => Promise<boolean>

function AppPanel({ app, apps, sov, cos, contract, info, canEdit, canManage, run, busy, onDirty }: {
  app: AppView; apps: AppView[]; sov: SovLine[]; cos: ChangeOrder[]; contract: number | null; info: DocInfo
  canEdit: boolean; canManage: boolean; run: Run; busy: string | null; onDirty: (dirty: boolean) => void
}) {
  const isDraft = app.status === 'draft'
  const edit = isDraft && canEdit
  const prior = useMemo(() => apps.filter((a) => a.frozen && a.status !== 'void' && a.appNo < app.appNo).sort((a, b) => b.appNo - a.appNo)[0] ?? null, [apps, app.appNo])
  const [hdr, setHdr] = useState({ appDate: app.appDate, periodTo: app.periodTo, retPct: String(app.retPct), storedRetPct: String(app.storedRetPct), release: app.release, invoiceNo: app.invoiceNo ?? '', note: app.note ?? '' })
  const [entries, setEntries] = useState<Record<string, { thisPeriod: string; stored: string }>>(() =>
    Object.fromEntries(app.lines.map((l) => [l.key, { thisPeriod: l.thisPeriod ? String(l.thisPeriod) : '', stored: l.stored ? String(l.stored) : '' }])))
  const [byPct, setByPct] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Every edit counts; a save only clears "unsaved" when nothing changed while it was on its way.
  const edits = useRef(0)
  const touch = () => { edits.current += 1; setDirty(true) }
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])
  // "% complete to date" as typed — only a cell someone typed in changes the dollars, on leaving it.
  const [pctText, setPctText] = useState<Record<string, string>>({})
  const [paid, setPaid] = useState({ on: app.paidOn ?? '', amount: app.paidAmount !== null ? String(app.paidAmount) : '' })
  const n = (s: string) => { const v = Number(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(v) ? v : 0 }
  // Dollars exactly as the server reads them: "(1,250.00)" and "−500" are negative.
  const amt = (s: string) => { const v = readDollars(s); return v === 'bad' || v === null ? 0 : v }

  // A draft is computed live from what is typed; a sent one is shown as sent.
  const view = useMemo(() => {
    if (!isDraft) return { lines: app.lines, totals: app.totals, warnings: app.warnings }
    const ents = Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, { thisPeriod: amt(e.thisPeriod), stored: amt(e.stored) }]))
    const lines = linesFor({ sov, cos, periodTo: hdr.periodTo, prior: prior?.lines ?? null, entries: ents })
    const totals = totalsFor({ lines, retPct: n(hdr.retPct), storedRetPct: n(hdr.storedRetPct), prevCerts: prior?.totals.earnedLessRet ?? 0, cos, periodTo: hdr.periodTo, prevPeriodTo: prior?.periodTo ?? null, release: hdr.release })
    return { lines, totals, warnings: appWarnings(lines, totals, contract) }
  }, [isDraft, app, entries, hdr, sov, cos, prior, contract])
  const shown: AppView = { ...app, ...view, appDate: hdr.appDate, periodTo: hdr.periodTo, retPct: n(hdr.retPct), storedRetPct: n(hdr.storedRetPct), release: hdr.release, invoiceNo: hdr.invoiceNo || null, note: hdr.note || null }
  const t = view.totals

  const setEntry = (key: string, k: 'thisPeriod' | 'stored', v: string) => { setEntries((e) => ({ ...e, [key]: { ...(e[key] ?? { thisPeriod: '', stored: '' }), [k]: v } })); touch() }
  const save = () => { const at = edits.current; return run('save', () => savePayAppAction(app.id, {
    appDate: hdr.appDate, periodTo: hdr.periodTo, retPct: n(hdr.retPct), storedRetPct: n(hdr.storedRetPct), release: hdr.release,
    invoiceNo: hdr.invoiceNo, note: hdr.note,
    entries: Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, { thisPeriod: e.thisPeriod || 0, stored: e.stored || 0 }])),
  }), 'Couldn’t save — try again.', () => { if (edits.current === at) setDirty(false) }) }

  async function download(kind: 'pdf' | 'xlsx') {
    const D = await import('@/lib/jobs/payapp-docs')
    const blob = kind === 'pdf' ? await D.payAppPdf(info, shown) : new Blob([D.payAppXlsx(info, shown) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    return deliver(blob, D.docName(info, shown, kind), kind, `${info.jobName} — pay app ${app.appNo}`)
  }

  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-3 text-[12.5px]">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-ink font-semibold text-[14px] flex-1">Pay app {app.appNo} <span className="text-faint font-normal">· {APP_STATUS_WORDS[app.status]}</span></h2>
        <button type="button" className={btn} disabled={busy === 'pdf'} onClick={() => void run('pdf', async () => { const e = await download('pdf'); return e ? { ok: false, error: e } : { ok: true } }, 'Couldn’t make the PDF.')}><FileText className="h-4 w-4" /> PDF</button>
        <button type="button" className={btn} disabled={busy === 'xlsx'} onClick={() => void run('xlsx', async () => { const e = await download('xlsx'); return e ? { ok: false, error: e } : { ok: true } }, 'Couldn’t make the workbook.')}><FileSpreadsheet className="h-4 w-4" /> Excel</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <L label="Application date"><input type="date" disabled={!edit} className={inp} value={hdr.appDate} onChange={(e) => { setHdr({ ...hdr, appDate: e.target.value }); touch() }} /></L>
        <L label="Period to"><input type="date" disabled={!edit} className={inp} value={hdr.periodTo} onChange={(e) => { setHdr({ ...hdr, periodTo: e.target.value }); touch() }} /></L>
        <L label="Retainage on work %"><input inputMode="decimal" disabled={!edit || hdr.release} className={inp} value={hdr.retPct} onChange={(e) => { setHdr({ ...hdr, retPct: e.target.value }); touch() }} /></L>
        <L label="On stored material %"><input inputMode="decimal" disabled={!edit || hdr.release} className={inp} value={hdr.storedRetPct} onChange={(e) => { setHdr({ ...hdr, storedRetPct: e.target.value }); touch() }} /></L>
        <L label="Invoice no."><input disabled={!edit} className={inp} value={hdr.invoiceNo} onChange={(e) => { setHdr({ ...hdr, invoiceNo: e.target.value }); touch() }} maxLength={40} /></L>
        <label className="col-span-2 sm:col-span-3 inline-flex items-center gap-1.5 text-muted self-end pb-1.5"><input type="checkbox" disabled={!edit} checked={hdr.release} onChange={(e) => { setHdr({ ...hdr, release: e.target.checked }); touch() }} /> Final application — release all retainage</label>
      </div>

      {edit && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-faint">Enter this period as</span>
          <button type="button" onClick={() => setByPct(false)} className={'rounded-full border px-2.5 py-0.5 ' + (!byPct ? 'border-teal/40 bg-teal/15 text-teal' : 'border-navy-700 text-muted')}>dollars</button>
          <button type="button" onClick={() => setByPct(true)} className={'rounded-full border px-2.5 py-0.5 ' + (byPct ? 'border-teal/40 bg-teal/15 text-teal' : 'border-navy-700 text-muted')}>% complete to date</button>
        </div>
      )}

      <div className="overflow-x-auto -mx-3 px-3">
        <table className="min-w-[860px] w-full text-[12px]">
          <thead className="text-faint text-[10.5px] uppercase tracking-wider">
            <tr className="text-left">
              <th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Description</th>
              <th className="py-1 pr-2 text-right">Scheduled</th><th className="py-1 pr-2 text-right">Previous</th>
              <th className="py-1 pr-2 text-right">{byPct && edit ? '% to date' : 'This period'}</th><th className="py-1 pr-2 text-right">Stored</th>
              <th className="py-1 pr-2 text-right">Completed</th><th className="py-1 pr-2 text-right">%</th><th className="py-1 pr-2 text-right">Balance</th><th className="py-1 text-right">Retainage</th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((l) => {
              const m = lineMath(l, n(hdr.retPct), n(hdr.storedRetPct), hdr.release)
              const e = entries[l.key] ?? { thisPeriod: '', stored: '' }
              return (
                <tr key={l.key} className={'border-t border-navy-800 ' + (l.isCo ? 'text-sky-200' : '')}>
                  <td className="py-1 pr-2 text-faint whitespace-nowrap">{l.itemNo}</td>
                  <td className="py-1 pr-2 text-ink">{l.description}{l.area ? <span className="text-faint"> · {l.area}</span> : null}</td>
                  <td className="py-1 pr-2 text-right font-mono">{money(l.scheduled)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-muted">{money(l.prev)}</td>
                  <td className="py-1 pr-2 text-right">
                    {edit ? (byPct ? (
                      <input inputMode="decimal" className={inp + ' text-right w-24'}
                        value={pctText[l.key] ?? (l.scheduled ? String(Math.round(((l.prev + l.thisPeriod + l.stored) / l.scheduled) * 10000) / 100) : '')}
                        onChange={(ev) => { const v = ev.target.value; setPctText((p) => ({ ...p, [l.key]: v })) }}
                        onBlur={() => {
                          const typed = pctText[l.key]
                          setPctText((p) => { const next = { ...p }; delete next[l.key]; return next })
                          // Tabbing through, or a cell left blank, changes nothing.
                          if (typed === undefined || !typed.trim()) return
                          const p = Number(typed.replace(/[%\s]/g, ''))
                          if (Number.isFinite(p)) setEntry(l.key, 'thisPeriod', String(thisPeriodFromPct({ scheduled: l.scheduled, prev: l.prev, stored: amt(e.stored) }, p)))
                        }} />
                    ) : (
                      <input inputMode="decimal" className={inp + ' text-right w-28'} value={e.thisPeriod} onChange={(ev) => setEntry(l.key, 'thisPeriod', ev.target.value)} />
                    )) : <span className="font-mono">{money(l.thisPeriod)}</span>}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {edit ? <input inputMode="decimal" className={inp + ' text-right w-24'} value={e.stored} onChange={(ev) => setEntry(l.key, 'stored', ev.target.value)} /> : <span className="font-mono">{money(l.stored)}</span>}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono">{money(m.total)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-muted">{m.pct.toFixed(1)}%</td>
                  <td className="py-1 pr-2 text-right font-mono text-muted">{money(m.balance)}</td>
                  <td className="py-1 text-right font-mono text-muted">{money(m.ret)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <dl className="rounded-lg border border-navy-800 bg-navy-950/40 p-2.5 space-y-0.5">
          {([
            ['1 Original contract sum', t.originalSum], ['2 Net change by change orders', t.coNet], ['3 Contract sum to date', t.contractToDate],
            ['4 Completed and stored to date', t.completedStored], ['5 Retainage', t.retTotal], ['6 Earned less retainage', t.earnedLessRet],
            ['7 Less previous certificates', t.prevCerts], ['8 Current payment due', t.currentDue], ['9 Balance to finish + retainage', t.balanceToFinish],
          ] as [string, number][]).map(([k, v], i) => (
            <div key={k} className={'flex gap-2 ' + (i === 7 ? 'text-amber font-semibold' : 'text-muted')}><dt className="flex-1">{k}</dt><dd className="font-mono">{money(v)}</dd></div>
          ))}
        </dl>
        <div className="space-y-2">
          {view.warnings.length > 0 && <ul className="space-y-1 text-amber">{view.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-none" /> {w}</li>)}</ul>}
          {edit && <L label="Note"><textarea className={inp} rows={2} value={hdr.note} onChange={(e) => { setHdr({ ...hdr, note: e.target.value }); touch() }} maxLength={1000} /></L>}
          {!edit && app.note && <p className="text-muted">Note: {app.note}</p>}
        </div>
      </div>

      {edit && (
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" disabled={!!busy || !dirty} onClick={() => void save()} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
          {canManage && (
            <button type="button" disabled={!!busy || dirty} title={dirty ? 'Save first' : undefined}
              onClick={() => { if (window.confirm(`Mark pay app ${app.appNo} sent for ${money(t.currentDue)}? Its numbers freeze — the PDF or Excel goes to the customer from you.`)) void run('send', () => submitPayAppAction(app.id), 'Couldn’t mark it sent — try again.') }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50"><Send className="h-4 w-4" /> {busy === 'send' ? 'Marking sent…' : 'Mark sent — freeze the numbers'}</button>
          )}
          {!canManage && <span className="text-faint">A Manager marks it sent.</span>}
          <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Delete this draft?')) void run('del', () => deleteDraftAction(app.id), 'Couldn’t delete it — try again.') }} className={btn}><Trash2 className="h-4 w-4" /> Delete draft</button>
        </div>
      )}

      {!isDraft && app.status !== 'void' && canEdit && (
        <div className="space-y-2 border-t border-navy-800 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            {app.status === 'submitted' && <button type="button" className={btn} disabled={!!busy} onClick={() => void run('appr', () => payAppStatusAction(app.id, { approved: true }), 'Couldn’t save — try again.')}>Mark approved</button>}
            <span className="text-faint">Lien waiver</span>
            <select className={inp + ' w-auto'} value={app.waiver} onChange={(e) => void run('waiver', () => payAppStatusAction(app.id, { waiver: e.target.value as 'none' | 'partial' | 'final', waiverOn: new Date().toISOString().slice(0, 10) }), 'Couldn’t save — try again.')}>
              <option value="none">Not sent</option><option value="partial">Partial waiver sent</option><option value="final">Final waiver sent</option>
            </select>
            {app.waiverOn && <span className="text-faint">{fmtDay(app.waiverOn)}</span>}
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <L label="Paid on"><input type="date" className={inp} value={paid.on} onChange={(e) => setPaid({ ...paid, on: e.target.value })} /></L>
            <L label="Amount received (blank = in full)"><input inputMode="decimal" className={inp} value={paid.amount} placeholder={String(t.currentDue)} onChange={(e) => setPaid({ ...paid, amount: e.target.value })} /></L>
            <button type="button" className={btn} disabled={!!busy} onClick={() => void run('paid', () => payAppStatusAction(app.id, { paidOn: paid.on || null, paidAmount: paid.amount.trim() === '' ? null : amt(paid.amount) }), 'Couldn’t save — try again.')}>Save payment</button>
            {canManage && apps.every((a) => a.appNo <= app.appNo || a.status === 'void') && (
              <button type="button" className={btn + ' ml-auto'} disabled={!!busy} onClick={() => { if (window.confirm(`Void pay app ${app.appNo}? The next application builds on the one before it.`)) void run('void', () => voidPayAppAction(app.id), 'Couldn’t void it — try again.') }}>Void</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-0.5"><span className="text-[11.5px] text-faint">{label}</span>{children}</label>
}

function SovPanel({ zoneId, sov, total, contract, canEdit, run, busy }: { zoneId: string; sov: SovLine[]; total: number; contract: number | null; canEdit: boolean; run: Run; busy: string | null }) {
  const [d, setD] = useState<{ id: string | null; itemNo: string; area: string; description: string; scheduled: string; retPct: string } | null>(null)
  const off = contract !== null && Math.abs(Math.round(total * 100) - Math.round(contract * 100)) >= 100
  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2 text-[12.5px]">
      <p className="text-muted">Total <span className="font-mono text-ink">{money(total)}</span>{contract !== null ? <> · contract <span className="font-mono text-ink">{money(contract)}</span></> : ' · no contract amount on the job yet'}</p>
      {off && <p className="text-amber flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> The schedule doesn&apos;t add up to the contract.</p>}
      {canEdit && !sov.length && (
        <button type="button" disabled={!!busy} onClick={() => void run('fromEst', () => sovFromEstimateAction(zoneId), 'Couldn’t build it — try again.')} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'fromEst' ? 'Building…' : 'Build it from the won estimate'}</button>
      )}
      <div className="divide-y divide-navy-800">
        {sov.map((l) => (
          <div key={l.id} className="flex items-center gap-2 py-1.5">
            <span className="w-10 text-faint">{l.itemNo}</span>
            <span className="flex-1 min-w-0 text-ink truncate">{l.description}{l.area ? <span className="text-faint"> · {l.area}</span> : null}{l.retPct !== null ? <span className="text-faint"> · {l.retPct}% retainage</span> : null}</span>
            <span className="font-mono text-ink">{money(l.scheduled)}</span>
            {canEdit && <>
              <button type="button" aria-label="Edit" onClick={() => setD({ id: l.id, itemNo: l.itemNo, area: l.area ?? '', description: l.description, scheduled: String(l.scheduled), retPct: l.retPct === null ? '' : String(l.retPct) })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label="Remove" onClick={() => { if (window.confirm(`Remove ${l.description}?`)) void run('delSov', () => deleteSovLineAction(zoneId, l.id), 'Couldn’t remove it — try again.') }} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
            </>}
          </div>
        ))}
      </div>
      {d && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 rounded-lg border border-navy-700 bg-navy-900 p-2">
          <input className={inp} placeholder="Item" value={d.itemNo} onChange={(e) => setD({ ...d, itemNo: e.target.value })} maxLength={12} />
          <input className={inp} placeholder="Area" value={d.area} onChange={(e) => setD({ ...d, area: e.target.value })} maxLength={60} />
          <input className={inp + ' col-span-2'} placeholder="Description" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} maxLength={200} />
          <input className={inp} placeholder="Scheduled $" inputMode="decimal" value={d.scheduled} onChange={(e) => setD({ ...d, scheduled: e.target.value })} />
          <input className={inp} placeholder="Own retainage % (blank = job’s)" inputMode="decimal" value={d.retPct} onChange={(e) => setD({ ...d, retPct: e.target.value })} />
          <div className="col-span-2 sm:col-span-6 flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => void run('sov', () => saveSovLineAction(zoneId, { ...d, retPct: d.retPct === '' ? null : d.retPct }, d.id), 'Couldn’t save — try again.', () => setD(null))} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setD(null)} className={btn}>Cancel</button>
          </div>
        </div>
      )}
      {canEdit && !d && <button type="button" onClick={() => setD({ id: null, itemNo: String(Math.max(0, ...sov.map((l) => parseInt(l.itemNo, 10)).filter((x) => Number.isFinite(x))) + 1), area: '', description: '', scheduled: '', retPct: '' })} className="inline-flex items-center gap-1 text-teal"><Plus className="h-3.5 w-3.5" /> Add a line</button>}
    </section>
  )
}

const blankCo = { id: null as string | null, title: '', customerNo: '', type: '', status: 'potential', identifiedOn: '', submittedOn: '', approvedOn: '', requested: '', approved: '', costImpact: '', costPcat: 'E', scheduleDays: '', description: '', note: '' }

function CoPanel({ zoneId, cos, canEdit, run, busy }: { zoneId: string; cos: ChangeOrder[]; canEdit: boolean; run: Run; busy: string | null }) {
  const [d, setD] = useState<typeof blankCo | null>(null)
  const s = (v: number | null) => (v === null ? '' : String(v))
  return (
    <section className="space-y-2 text-[12.5px]">
      <p className="text-faint">Tracked the moment one comes up; the contract changes only when one is approved — it joins the applications as its own line from its approval date.</p>
      {cos.map((c) => (
        <div key={c.id} className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-ink"><span className="font-semibold">CO{c.number}</span> · {c.title}{c.customerNo ? <span className="text-faint"> · their # {c.customerNo}</span> : null}</p>
            <p className="text-faint text-[11.5px]">
              <span className={'rounded-full px-1.5 py-0.5 mr-1.5 ' + (c.status === 'approved' ? 'bg-teal/15 text-teal' : c.status === 'rejected' || c.status === 'void' ? 'bg-navy-800 text-faint' : 'bg-amber/15 text-amber')}>{CO_STATUS_WORDS[c.status]}</span>
              {c.approved !== null ? `approved ${money(c.approved)}` : c.requested !== null ? `asked ${money(c.requested)}` : 'not priced'}
              {c.approvedOn ? ` · ${fmtDay(c.approvedOn)}` : ''}{c.scheduleDays ? ` · ${c.scheduleDays} days` : ''}{c.type ? ` · ${CO_TYPE_WORDS[c.type]}` : ''}
            </p>
          </div>
          {canEdit && <>
            <button type="button" aria-label="Edit" onClick={() => setD({ id: c.id, title: c.title, customerNo: c.customerNo ?? '', type: c.type ?? '', status: c.status, identifiedOn: c.identifiedOn ?? '', submittedOn: c.submittedOn ?? '', approvedOn: c.approvedOn ?? '', requested: s(c.requested), approved: s(c.approved), costImpact: s(c.costImpact), costPcat: c.costPcat ?? 'E', scheduleDays: s(c.scheduleDays), description: c.description ?? '', note: c.note ?? '' })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
            {c.status !== 'approved' && <button type="button" aria-label="Delete" onClick={() => { if (window.confirm(`Delete CO${c.number}?`)) void run('delCo', () => deleteChangeOrderAction(zoneId, c.id), 'Couldn’t delete it — try again.') }} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
          </>}
        </div>
      ))}
      {!cos.length && !d && <p className="text-faint">No change orders yet.</p>}
      {d && (
        <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2"><L label="What changed"><input className={inp} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} maxLength={200} /></L></div>
            <L label="Their CO number"><input className={inp} value={d.customerNo} onChange={(e) => setD({ ...d, customerNo: e.target.value })} maxLength={40} /></L>
            <L label="Status"><select className={inp} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>{CO_STATUSES.map((x) => <option key={x} value={x}>{CO_STATUS_WORDS[x]}</option>)}</select></L>
            <L label="Type"><select className={inp} value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}><option value="">—</option>{CO_TYPES.map((x) => <option key={x} value={x}>{CO_TYPE_WORDS[x]}</option>)}</select></L>
            <L label="Schedule impact (days)"><input inputMode="numeric" className={inp} value={d.scheduleDays} onChange={(e) => setD({ ...d, scheduleDays: e.target.value })} /></L>
            <L label="Asked for ($, minus for a credit)"><input inputMode="decimal" className={inp} value={d.requested} onChange={(e) => setD({ ...d, requested: e.target.value })} /></L>
            <L label="Approved ($)"><input inputMode="decimal" className={inp} value={d.approved} onChange={(e) => setD({ ...d, approved: e.target.value })} /></L>
            <L label="Cost impact on the budget ($)"><input inputMode="decimal" className={inp} value={d.costImpact} onChange={(e) => setD({ ...d, costImpact: e.target.value })} /></L>
            <L label="…lands on the budget's"><select className={inp} value={d.costPcat} onChange={(e) => setD({ ...d, costPcat: e.target.value })}>{(['L', 'M', 'S', 'E', 'O'] as const).map((p) => <option key={p} value={p}>{({ L: 'Labor', M: 'Material', S: 'Subcontract', E: 'Equipment & trucking', O: 'Other' })[p]}</option>)}</select></L>
            <L label="Came up"><input type="date" className={inp} value={d.identifiedOn} onChange={(e) => setD({ ...d, identifiedOn: e.target.value })} /></L>
            <L label="Submitted"><input type="date" className={inp} value={d.submittedOn} onChange={(e) => setD({ ...d, submittedOn: e.target.value })} /></L>
            <L label="Approved on"><input type="date" className={inp} value={d.approvedOn} onChange={(e) => setD({ ...d, approvedOn: e.target.value })} /></L>
          </div>
          <L label="Description"><textarea className={inp} rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} maxLength={2000} /></L>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => void run('co', () => saveChangeOrderAction(zoneId, { ...d, type: d.type || null }, d.id), 'Couldn’t save — try again.', () => setD(null))} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setD(null)} className={btn}>Cancel</button>
          </div>
        </div>
      )}
      {canEdit && !d && <button type="button" onClick={() => setD({ ...blankCo })} className="inline-flex items-center gap-1 text-teal"><Plus className="h-3.5 w-3.5" /> Add a change order</button>}
    </section>
  )
}
