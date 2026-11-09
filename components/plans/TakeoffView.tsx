'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Layers, FileSpreadsheet, Snowflake, Link2, Copy, Trash2, Sparkles, Check, Pencil, AlertTriangle, Calculator } from 'lucide-react'
import type { TakeoffSummary, TakeoffRow } from '@/lib/takeoff-summary'
import type { TakeoffSnapshot, BidMemo, TakeoffLink } from '@/lib/db/takeoff'
import { revLabel } from '@/lib/plans/room'
import { isNativeApp } from '@/lib/native'
import { publishExport } from '@/lib/export-upload'
import { revisionReport } from '@/lib/plans/measure'
import {
  freezeTakeoffAction, deleteSnapshotAction, createTakeoffLinkAction, revokeTakeoffLinkAction,
  draftBidMemoAction, saveBidMemoAction, approveBidMemoAction,
} from '@/lib/actions/takeoff'

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 }))
const money = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const fmtDay = (iso: string) => {
  const t = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const signed = (v: number) => `${v > 0 ? '+' : ''}${fmt(v)}`

/**
 * A site's takeoff (migration 146) — every current sheet's marks summed by
 * item: the bid's quantity page. Freeze it when the bid goes out; the
 * revision report then reads each later change against that snapshot. The
 * Excel download and the private spreadsheet links carry the same numbers
 * (quantities out only; prices only for a login that can see costs). The bid
 * memo is drafted from these facts and approved by a Manager.
 */
export function TakeoffView({ zone, summary, snapshots, memo, links, canEdit, canManage, canCosts, showMemo, demo }: {
  zone: { id: string; name: string }
  summary: TakeoffSummary | null
  snapshots: TakeoffSnapshot[]
  memo: BidMemo | null
  links: TakeoffLink[]
  canEdit: boolean
  canManage: boolean
  canCosts: boolean
  showMemo: boolean
  demo: boolean
}) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const rows = useMemo(() => summary?.rows ?? [], [summary])
  const sections = useMemo(() => {
    const g = new Map<string, TakeoffRow[]>()
    for (const r of rows) { const k = r.section ?? 'Other'; if (!g.has(k)) g.set(k, []); g.get(k)!.push(r) }
    return Array.from(g.entries())
  }, [rows])
  const total = canCosts ? rows.reduce((t, r) => t + (r.unitPrice !== null ? r.qtyWithWaste * r.unitPrice : 0), 0) : 0
  const priced = rows.filter((r) => r.unitPrice !== null).length

  // ── Freeze / snapshots ──
  const revWords = (summary?.sheets ?? []).map((s) => `${s.number} ${revLabel(s.rev)}`)
  const [freezeName, setFreezeName] = useState<string | null>(null)
  async function freeze() {
    if (!freezeName?.trim()) return
    setBusy('freeze'); setErr(null)
    const r = await freezeTakeoffAction(zone.id, freezeName).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t freeze — try again.'); return }
    setFreezeName(null); setSnapId(r.id); router.refresh()
  }
  async function dropSnapshot(id: string) {
    if (!window.confirm('Delete this snapshot? The revision report can no longer compare against it.')) return
    const r = await deleteSnapshotAction(id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    if (snapId === id) setSnapId('')
    router.refresh()
  }
  const [snapId, setSnapId] = useState<string>(snapshots[0]?.id ?? '')
  const snap = snapshots.find((s) => s.id === snapId) ?? null
  const report = useMemo(() => (snap ? revisionReport(snap.data.items, rows.map((r) => ({ code: r.code, name: r.name, unit: r.unit, qty: r.qty, unitPrice: r.unitPrice }))) : []), [snap, rows])
  const sheetMoves = useMemo(() => {
    if (!snap || !summary) return []
    const then = new Map((snap.data.sheets ?? []).map((s) => [s.number, s]))
    return summary.sheets.flatMap((s) => {
      const a = then.get(s.number)
      if (!a) return [`${s.number} added (${revLabel(s.rev)})`]
      return a.versionId !== s.versionId ? [`${s.number} ${revLabel(a.rev)} → ${revLabel(s.rev)}`] : []
    })
  }, [snap, summary])

  // ── Links ──
  const [withCosts, setWithCosts] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const linkUrl = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : 'https://hammertrack.ai'}/api/takeoff/link/${token}.csv`
  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1800) } catch { setErr('Couldn’t copy — select the text and copy it.') }
  }
  async function makeLink() {
    setBusy('link'); setErr(null)
    const r = await createTakeoffLinkAction(zone.id, withCosts).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t make the link — try again.'); return }
    router.refresh()
  }
  async function revoke(token: string) {
    if (!window.confirm('Turn this link off? Any spreadsheet reading it stops updating.')) return
    const r = await revokeTakeoffLinkAction(token).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t turn it off — try again.'); return }
    router.refresh()
  }

  // ── Memo ──
  const [m, setM] = useState<BidMemo | null>(memo)
  const [editing, setEditing] = useState<string | null>(null)
  async function draft() {
    if (m && !window.confirm('Write a new draft from the takeoff as it stands? The current memo stays in the history.')) return
    setBusy('memo'); setErr(null)
    const r = await draftBidMemoAction(zone.id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t draft the memo — try again.'); return }
    setM(r.memo); setEditing(null)
  }
  async function saveMemo() {
    if (!m || editing === null) return
    setBusy('memo'); setErr(null)
    const r = await saveBidMemoAction(m.id, editing).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setM(r.memo); setEditing(null)
  }
  async function approve() {
    if (!m) return
    setBusy('memo'); setErr(null)
    const r = await approveBidMemoAction(m.id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t approve — try again.'); return }
    setM(r.memo)
  }

  const xlsxHref = `/api/takeoff/${zone.id}/xlsx${snap ? `?snapshot=${snap.id}` : ''}`
  // Inside the Android app a link to an attachment does nothing (the WebView has no
  // download door — the Sep 12 lesson): the workbook goes up as a private export
  // link and the phone's browser downloads it (ship-check, Nov 8).
  async function downloadInApp(e: React.MouseEvent) {
    if (!isNativeApp()) return
    e.preventDefault()
    setBusy('xlsx'); setErr(null)
    try {
      const res = await fetch(xlsxHref)
      if (!res.ok) throw new Error('fetch')
      const blob = await res.blob()
      const name = `${zone.name} takeoff.xlsx`.replace(/[^A-Za-z0-9 ._-]+/g, '')
      const r = await publishExport(blob, name, 'xlsx', `${zone.name} — takeoff`)
      if (!r.ok) { setErr(r.error); return }
      window.location.href = r.link.fileUrl
    } catch {
      setErr('Couldn’t make the workbook — check your signal and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-5">
        <div>
          <Link href={`/plans/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2">
            <ArrowLeft className="h-4 w-4" /> Plan room
          </Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Layers className="h-5 w-5 text-amber" /> Takeoff · {zone.name}</h1>
          <p className="text-[12.5px] text-faint">
            {rows.length} item{rows.length === 1 ? '' : 's'} on {summary?.sheets.filter((s) => s.marks > 0).length ?? 0} sheet{(summary?.sheets.filter((s) => s.marks > 0).length ?? 0) === 1 ? '' : 's'}
            {revWords.length > 0 && <> · from {revWords.slice(0, 6).join(', ')}{revWords.length > 6 ? ` +${revWords.length - 6}` : ''}</>}
          </p>
          {(summary?.check || summary?.suggested) ? (
            <p className="mt-1 text-[12.5px] text-amber flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              {summary?.check ? `${summary.check} mark${summary.check === 1 ? '' : 's'} carried onto a revised drawing need a look` : ''}
              {summary?.check && summary?.suggested ? ' · ' : ''}
              {summary?.suggested ? `${summary.suggested} suggested by the first pass, not counted until accepted` : ''}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canCosts && (
            <Link href={`/plans/${zone.id}/estimate`} className="inline-flex items-center gap-1.5 rounded-xl border border-teal/50 text-teal px-3 py-2 text-[12.5px]">
              <Calculator className="h-4 w-4" /> Estimate
            </Link>
          )}
          <a href={demo ? undefined : xlsxHref} aria-disabled={demo} onClick={(e) => void downloadInApp(e)}
            className={'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink ' + (demo ? 'opacity-50 pointer-events-none' : '')}>
            <FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Making the workbook…' : `Download Excel${snap ? ' (with the revision report)' : ''}`}
          </a>
          {canEdit && freezeName === null && (
            <button type="button" disabled={!rows.length} onClick={() => setFreezeName(`Bid · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-3 py-2 text-[12.5px] disabled:opacity-40">
              <Snowflake className="h-4 w-4" /> Freeze for the bid
            </button>
          )}
          {freezeName !== null && (
            <span className="flex items-center gap-2 flex-wrap">
              <input value={freezeName} onChange={(e) => setFreezeName(e.target.value.slice(0, 120))} aria-label="Snapshot name"
                className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm text-ink w-56 max-w-full" />
              <button type="button" disabled={busy === 'freeze'} onClick={() => void freeze()} className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-2 disabled:opacity-50">Freeze</button>
              <button type="button" onClick={() => setFreezeName(null)} className="text-xs text-faint hover:text-ink">Cancel</button>
            </span>
          )}
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}

        {/* Quantities */}
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5">Quantities</h2>
          {!rows.length ? (
            <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
              Nothing measured yet. Open a sheet in the plan room and tap <b>Measure</b> — or run the first pass on a sheet to have its layers measured for you.
            </p>
          ) : (
            <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-x-auto">
              <table className="w-full text-[12.5px] min-w-[34rem]">
                <thead>
                  <tr className="text-faint text-[10.5px] uppercase tracking-wide text-left">
                    <th className="px-3 py-2">Item</th><th className="text-right">Qty</th><th className="pl-1">Unit</th><th className="text-right">With waste</th>
                    {canCosts && <><th className="text-right">Unit $</th><th className="text-right pr-3">Total</th></>}
                  </tr>
                </thead>
                {sections.map(([sec, rs]) => (
                  <tbody key={sec}>
                    <tr><td colSpan={canCosts ? 6 : 4} className="px-3 pt-2.5 pb-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">{sec}</td></tr>
                    {rs.map((r) => (
                      <tr key={r.itemId} className="border-t border-navy-800 align-top">
                        <td className="px-3 py-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5 align-middle" style={{ background: r.color }} />
                          <span className="font-mono font-bold text-ink">{r.code}</span> <span className="text-muted">{r.name}</span>
                          <span className="block text-[11px] text-faint">
                            {r.bySheet.map((b) => `${b.number}: ${fmt(b.qty)}`).join(' · ')}
                            {r.check > 0 && <span className="text-amber"> · {r.check} to check</span>}
                            {r.suggested > 0 && <span className="text-faint"> · {r.suggested} suggested</span>}
                          </span>
                          {(r.overlap ?? []).length > 0 && (
                            <span className="block text-[11px] text-teal">
                              Counted once where sheets overlap: {(r.overlap ?? []).map((o) => `${o.from} ∩ ${o.against} −${fmt(o.qty)}`).join(' · ')}
                            </span>
                          )}
                        </td>
                        <td className="text-right font-mono text-ink py-1.5">{fmt(r.qty)}</td>
                        <td className="pl-1 text-faint py-1.5">{r.unit}</td>
                        <td className="text-right font-mono text-muted py-1.5">{r.wastePct ? fmt(r.qtyWithWaste) : '—'}</td>
                        {canCosts && <>
                          <td className="text-right font-mono text-muted py-1.5">{r.unitPrice !== null ? money(r.unitPrice) : '—'}</td>
                          <td className="text-right font-mono text-ink py-1.5 pr-3">{r.unitPrice !== null ? money(r.qtyWithWaste * r.unitPrice) : '—'}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                ))}
                {canCosts && priced > 0 && (
                  <tfoot>
                    <tr className="border-t border-navy-700">
                      <td className="px-3 py-2 text-faint" colSpan={5}>Priced items ({priced} of {rows.length}) — markups are on the Estimate page</td>
                      <td className="text-right font-mono font-bold text-ink pr-3">{money(total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>

        {/* Revision report */}
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5">Snapshots and the revision report</h2>
          {snapshots.length === 0 ? (
            <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
              Freeze the takeoff when the bid goes out. Every revision after that is read against it here — item by item, Δ qty{canCosts ? ' and Δ $' : ''}: the change-order backup.
            </p>
          ) : (
            <div className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                <span className="text-faint">Against</span>
                <select value={snapId} onChange={(e) => setSnapId(e.target.value)} aria-label="Snapshot"
                  className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink max-w-full">
                  {snapshots.map((s) => <option key={s.id} value={s.id}>{s.name} · frozen {fmtDay(s.createdAt)}</option>)}
                </select>
                {snap && canManage && (
                  <button type="button" onClick={() => void dropSnapshot(snap.id)} aria-label="Delete snapshot" className="rounded-lg p-1.5 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
              {sheetMoves.length > 0 && <p className="text-[12px] text-amber">Since then: {sheetMoves.join(' · ')}</p>}
              {report.length === 0 ? <p className="text-[12.5px] text-faint">No quantities on either side.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px] min-w-[30rem]">
                    <thead><tr className="text-faint text-[10.5px] uppercase tracking-wide text-left"><th className="py-1">Item</th><th className="text-right">Then</th><th className="text-right">Now</th><th className="text-right">Δ qty</th>{canCosts && <th className="text-right">Δ $</th>}</tr></thead>
                    <tbody>
                      {report.map((r) => (
                        <tr key={r.code} className="border-t border-navy-800">
                          <td className="py-1.5 pr-2"><span className="font-mono font-bold text-ink">{r.code}</span> <span className="text-muted">{r.name}</span> <span className="text-faint">{r.unit}</span></td>
                          <td className="text-right font-mono text-muted">{fmt(r.then)}</td>
                          <td className="text-right font-mono text-ink">{fmt(r.now)}</td>
                          <td className={'text-right font-mono ' + (r.delta ? (r.delta > 0 ? 'text-amber' : 'text-teal') : 'text-faint')}>{r.delta ? signed(r.delta) : '0'}</td>
                          {canCosts && <td className={'text-right font-mono ' + (r.deltaUsd ? (r.deltaUsd > 0 ? 'text-amber' : 'text-teal') : 'text-faint')}>{r.deltaUsd === null ? '—' : r.deltaUsd ? `${r.deltaUsd > 0 ? '+' : '−'}${money(Math.abs(r.deltaUsd))}` : '$0'}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Spreadsheet links */}
        {canEdit && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5">Live link for Google Sheets or Excel</h2>
            <div className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2.5 text-[12.5px]">
              <p className="text-faint">
                A private link to this takeoff as a table, one row per item code. <b className="text-muted">Google Sheets:</b> put <span className="font-mono text-ink">=IMPORTDATA(&quot;link&quot;)</span> in a tab and look items up by code.
                {' '}<b className="text-muted">Excel:</b> Data → From Web → paste the link; <i>Refresh All</i> pulls the latest. Quantities only flow out — nothing in the sheet can change the takeoff. Anyone with the link can read it, so share it like a password; it stops working if you turn it off or leave the company.
              </p>
              {links.map((l) => (
                <div key={l.token} className="rounded-lg border border-navy-700 p-2 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-ink truncate flex-1 min-w-0">{linkUrl(l.token)}</span>
                    <button type="button" onClick={() => void copy(linkUrl(l.token), l.token)} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-muted hover:text-ink">
                      <Copy className="h-3.5 w-3.5" /> {copied === l.token ? 'Copied' : 'Link'}
                    </button>
                    <button type="button" onClick={() => void copy(`=IMPORTDATA("${linkUrl(l.token)}")`, `${l.token}:f`)} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-muted hover:text-ink">
                      <Copy className="h-3.5 w-3.5" /> {copied === `${l.token}:f` ? 'Copied' : 'Sheets formula'}
                    </button>
                    <button type="button" onClick={() => void revoke(l.token)} aria-label="Turn this link off" className="rounded-lg p-1.5 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  <p className="text-[11px] text-faint">{l.includeCosts ? 'Quantities and prices' : 'Quantities only'} · made {fmtDay(l.createdAt)}{l.lastUsedAt ? ` · last read ${fmtDay(l.lastUsedAt)}` : ' · not read yet'}</p>
                </div>
              ))}
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" disabled={busy === 'link'} onClick={() => void makeLink()} className="inline-flex items-center gap-1.5 rounded-lg border border-teal/50 text-teal px-3 py-1.5 disabled:opacity-50">
                  <Link2 className="h-4 w-4" /> Make a link
                </button>
                {canCosts && (
                  <label className="flex items-center gap-1.5 text-faint cursor-pointer">
                    <input type="checkbox" className="accent-amber h-4 w-4" checked={withCosts} onChange={(e) => setWithCosts(e.target.checked)} /> include unit prices
                  </label>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Bid memo */}
        {showMemo && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5">Bid memo</h2>
            <div className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2.5 text-[12.5px]">
              {!m ? (
                <p className="text-faint">
                  The memo the bid goes out with — scope and quantities, assumptions, risks, questions for the GC, exclusions — written from what this plan room and takeoff hold: the revisions used, every sheet&apos;s scale status, what&apos;s measured and what&apos;s still waiting for a look. No prices go in.
                </p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={'rounded px-1.5 py-px font-semibold ' + (m.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber/15 text-amber')}>
                    {m.status === 'approved' ? `Approved ${m.approvedAt ? fmtDay(m.approvedAt) : ''}` : 'Draft'}
                  </span>
                  <span className="text-faint">{m.model ? 'drafted by the AI' : 'drafted from the facts (no AI)'} · {fmtDay(m.createdAt)}{m.updatedAt !== m.createdAt ? ` · edited ${fmtDay(m.updatedAt)}` : ''}</span>
                </div>
              )}
              {m && editing === null && <pre className="whitespace-pre-wrap font-sans text-[12.5px] text-ink leading-relaxed">{m.body}</pre>}
              {m && editing !== null && (
                <textarea value={editing} onChange={(e) => setEditing(e.target.value.slice(0, 40000))} rows={18} aria-label="Bid memo"
                  className="w-full rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-[12.5px] text-ink font-mono leading-relaxed" />
              )}
              {canEdit && (
                <div className="flex items-center gap-2 flex-wrap">
                  {editing === null ? (
                    <>
                      <button type="button" disabled={busy === 'memo'} onClick={() => void draft()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5 disabled:opacity-50">
                        <Sparkles className="h-4 w-4" /> {busy === 'memo' ? 'Writing…' : m ? 'Write a new draft' : 'Draft the memo'}
                      </button>
                      {m && <button type="button" onClick={() => setEditing(m.body)} className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-muted hover:text-ink"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                      {m && m.status !== 'approved' && canManage && (
                        <button type="button" disabled={busy === 'memo'} onClick={() => void approve()} className="inline-flex items-center gap-1.5 rounded-lg border border-teal/50 text-teal px-3 py-1.5 disabled:opacity-50"><Check className="h-4 w-4" /> Approve</button>
                      )}
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={busy === 'memo'} onClick={() => void saveMemo()} className="rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5 disabled:opacity-50">Save</button>
                      <button type="button" onClick={() => setEditing(null)} className="text-faint hover:text-ink">Cancel</button>
                      {m?.status === 'approved' && <span className="text-[11px] text-amber">Saving an edit takes the approval off.</span>}
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Sheets */}
        {summary && summary.sheets.length > 0 && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-1.5">Sheets (current versions)</h2>
            <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
              {summary.sheets.map((s) => (
                <Link key={s.sheetId} href={`/plans/${zone.id}/${s.sheetId}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-navy-800/50 text-[12.5px]">
                  <span className="font-mono font-bold text-ink w-20 truncate">{s.number}</span>
                  <span className="text-muted flex-1 min-w-0 truncate">{s.title ?? ''}</span>
                  <span className="text-faint whitespace-nowrap">{revLabel(s.rev)} · {s.marks} mark{s.marks === 1 ? '' : 's'}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
