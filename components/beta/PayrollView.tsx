'use client'

/**
 * Certified payroll for a prevailing-wage job: pick the job and the week,
 * and the WH-347 is already filled from the time clock — each worker's
 * classification, hours by day (overtime past 40 across ALL their work that
 * week), rate and gross — with the wage check against the job's wage
 * decision on every line. Out as the WH-347 PDF (with the statement of
 * compliance to sign) and an LCPtracker-style spreadsheet.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, FileDown, FileSpreadsheet } from 'lucide-react'
import { addDays } from '@/lib/beta/registers'
import { lcpRows, payrollTotals, weekEnding, type PayrollLine } from '@/lib/beta/payroll'
import type { BetaRecord } from '@/lib/db/beta'
import { AddButton, BetaPage, Notice, RecordEditor, RowActions, StatePill, box, btn, card, deliverDoc, fileSlug, fmtDay, money, xlsxBlob } from './ui'

type Opt = { id: string; name: string }
type Tab = 'week' | 'decision' | 'crew'

export function PayrollView({ sites, siteId, weekStart, today, lines, wages, classes, people, payFor, payrollNo, job, companyName, demo, canWrite }: {
  sites: Opt[]; siteId: string | null; weekStart: string; today: string; lines: PayrollLine[]; wages: BetaRecord[]; classes: BetaRecord[]
  people: Opt[]; payFor: Opt[]; payrollNo: number; job: { number: string | null; contractNo: string | null }; companyName: string; demo: boolean; canWrite: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('week')
  const [editing, setEditing] = useState<BetaRecord | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [final, setFinal] = useState(false)
  const siteName = sites.find((s) => s.id === siteId)?.name ?? 'Job'
  const tot = payrollTotals(lines)
  const name = new Map(people.map((p) => [p.id, p.name]))
  const go = (p: Record<string, string>) => router.push(`/beta/payroll?${new URLSearchParams({ site: siteId ?? '', week: weekStart, ...p })}`)
  const decision = wages.map((w) => String(w.data.decision ?? '')).find(Boolean) ?? null

  async function exportPdf() {
    setBusy('pdf'); setErr(null)
    try {
      const { payrollPdf } = await import('@/lib/beta/payroll-pdf')
      const blob = await payrollPdf({ companyName, jobName: siteName, jobNumber: job.number, contractNo: job.contractNo, payrollNo, weekStart, final, decision }, lines)
      const e = await deliverDoc(blob, `certified-payroll-${fileSlug(siteName)}-${weekEnding(weekStart)}.pdf`, 'pdf', `Certified payroll ${payrollNo} · ${siteName}`)
      if (e) setErr(e)
    } catch { setErr('Couldn’t build the PDF — try again.') }
    setBusy(null)
  }
  async function exportXlsx() {
    setBusy('xlsx'); setErr(null)
    try {
      const blob = await xlsxBlob([{ name: 'Payroll', rows: lcpRows(lines, weekStart, { number: job.number, name: siteName }) }])
      const e = await deliverDoc(blob, `lcp-${fileSlug(siteName)}-${weekEnding(weekStart)}.xlsx`, 'xlsx', `LCP import ${siteName}`)
      if (e) setErr(e)
    } catch { setErr('Couldn’t build the spreadsheet — try again.') }
    setBusy(null)
  }

  return (
    <BetaPage title="Certified payroll" icon={<Banknote className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="The weekly WH-347 for Davis-Bacon jobs (federal and federal-aid work, including federally funded SCDOT, city and county jobs), filled from GPS-verified time cards — with the wage check on every line.">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0"><span className="text-faint text-[12px] block">Job</span>
          <select className={box} value={siteId ?? ''} onChange={(e) => go({ site: e.target.value })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label><span className="text-faint text-[12px] block">Week (Sun–Sat)</span><input type="date" className={box} value={weekStart} max={today} onChange={(e) => e.target.value && go({ week: e.target.value })} /></label>
        <button type="button" className={btn} onClick={() => go({ week: addDays(weekStart, -7) })}>← Week before</button>
        {addDays(weekStart, 7) <= today && <button type="button" className={btn} onClick={() => go({ week: addDays(weekStart, 7) })}>Next week →</button>}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-navy-800 bg-navy-900/60 p-1">
        {(['week', 'decision', 'crew'] as const).map((t) => (
          <button key={t} type="button" onClick={() => { setTab(t); setEditing(null) }} className={'rounded-lg py-2 font-semibold text-[12.5px] ' + (tab === t ? 'bg-amber text-navy-950' : 'text-muted')}>
            {t === 'week' ? `Payroll ${payrollNo}` : t === 'decision' ? `Wage decision (${wages.length})` : `Crew classes (${classes.length})`}
          </button>
        ))}
      </div>
      {err && <Notice tone="bad">{err}</Notice>}

      {tab === 'week' && (
        <>
          <p className="text-muted">Week ending <span className="text-ink font-semibold">{fmtDay(weekEnding(weekStart))}</span> · {lines.length} {lines.length === 1 ? 'worker' : 'workers'} · {tot.st} straight + {tot.ot} overtime hours · gross {money(tot.gross, true)}</p>
          {!wages.length && <Notice tone="warn">No wage decision on this job yet — add its classifications and rates under Wage decision so every line is checked.</Notice>}
          {tot.problems > 0 && <Notice tone="bad">{tot.problems} {tot.problems === 1 ? 'thing needs' : 'things need'} fixing before this is signed — see the lines below.</Notice>}
          {!lines.length && <Notice tone="info">Nobody clocked onto this job that week. A week with no work still gets a “no work performed” payroll — note it on the form for the owner.</Notice>}
          <div className="overflow-x-auto rounded-xl border border-navy-800">
            <table className="w-full text-[12px] min-w-[720px]">
              <thead className="bg-navy-900 text-faint">
                <tr>
                  <th className="text-left px-2 py-1.5">Worker · class</th>
                  {Array.from({ length: 7 }, (_, i) => <th key={i} className="px-1 py-1.5">{['S', 'M', 'T', 'W', 'T', 'F', 'S'][i]}<br /><span className="font-normal">{new Date(Date.parse(`${addDays(weekStart, i)}T12:00:00Z`)).getUTCDate()}</span></th>)}
                  <th className="px-1.5 py-1.5">ST</th><th className="px-1.5 py-1.5">OT</th><th className="px-1.5 py-1.5 text-right">Rate</th><th className="px-2 py-1.5 text-right">Gross</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.userId} className="border-t border-navy-800 align-top">
                    <td className="px-2 py-1.5">
                      <p className="text-ink">{l.name}{l.idLast4 ? <span className="text-faint"> · …{l.idLast4}</span> : null}</p>
                      <p className="text-faint">{l.classification ?? 'No class'}{l.required ? ` · needs $${(l.required.base + l.required.fringe).toFixed(2)}` : ''}</p>
                      {l.problems.map((p) => <p key={p} className="text-red-300">{p}</p>)}
                    </td>
                    {l.days.map(([s, o], i) => <td key={i} className="px-1 py-1.5 text-center text-ink">{s || ''}{o ? <span className="block text-amber">+{o}</span> : null}</td>)}
                    <td className="px-1.5 py-1.5 text-center text-ink">{l.st}</td>
                    <td className="px-1.5 py-1.5 text-center text-amber">{l.ot || ''}</td>
                    <td className="px-1.5 py-1.5 text-right text-ink">{l.rateSt !== null ? `$${l.rateSt.toFixed(2)}` : '—'}{l.fringeCash ? <span className="block text-faint">+${l.fringeCash.toFixed(2)} fr</span> : null}</td>
                    <td className="px-2 py-1.5 text-right text-ink">{money(l.grossProject, true)}{l.allHours > l.st + l.ot ? <span className="block text-faint">{l.allHours} h all jobs</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" className="h-4 w-4 accent-amber" checked={final} onChange={(e) => setFinal(e.target.checked)} /> Final payroll for this job</label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!!busy || !lines.length} onClick={exportPdf}><FileDown className="h-4 w-4" /> {busy === 'pdf' ? 'Building…' : 'WH-347 PDF'}</button>
            <button type="button" className={btn} disabled={!!busy || !lines.length} onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Building…' : 'LCPtracker-style spreadsheet'}</button>
          </div>
          <p className="text-faint text-[11.5px]">Overtime is hours past 40 in the week across all jobs, at 1.5 × the base rate (fringe isn’t multiplied). Deductions and net pay come from your payroll company; they fill those columns and sign the statement of compliance.</p>
        </>
      )}

      {tab === 'decision' && siteId && (
        <>
          <p className="text-faint">The classifications and rates on this job’s wage decision (from the bid documents or sam.gov). Each worker’s class is matched to a line here by its words.</p>
          {canWrite && editing === null && <AddButton onClick={() => setEditing('new')}>Add a classification</AddButton>}
          {editing !== null && <RecordEditor kind="wage_rate" record={editing === 'new' ? null : editing} fixed={{ siteId }} withMoney={false} onDone={() => setEditing(null)} defaults={decision ? { decision } : {}} />}
          <div className={`${card} space-y-1.5`}>
            {!wages.length && <p className="text-faint">None yet.</p>}
            {wages.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-800 pt-1.5 first:border-0 first:pt-0">
                <span className="text-ink min-w-0">{String(w.data.classification)} {w.data.decision ? <span className="text-faint text-[11.5px]">· {String(w.data.decision)}</span> : null}</span>
                <span className="flex items-center gap-2 text-ink">${Number(w.data.base).toFixed(2)} + ${Number(w.data.fringe ?? 0).toFixed(2)} fringe {canWrite && <RowActions id={w.id} onEdit={() => setEditing(w)} canRemove />}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'crew' && (
        <>
          <p className="text-faint">Each worker’s classification and what they’re paid. Set once; every job’s payroll reads it. ID: last four only.</p>
          {canWrite && editing === null && payFor.length > 0 && <AddButton onClick={() => setEditing('new')}>Set a worker’s class</AddButton>}
          {editing !== null && <RecordEditor kind="worker_class" record={editing === 'new' ? null : editing} people={payFor} withMoney onDone={() => setEditing(null)} />}
          <div className={`${card} space-y-1.5`}>
            {!classes.length && <p className="text-faint">None yet.</p>}
            {classes.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-800 pt-1.5 first:border-0 first:pt-0">
                <span className="text-ink min-w-0">{name.get(c.personId ?? '') ?? 'Crew'} <span className="text-muted">· {String(c.data.classification)}</span>{c.data.apprentice ? <StatePill state="none">apprentice</StatePill> : null}</span>
                <span className="flex items-center gap-2 text-ink">${Number(c.data.base).toFixed(2)}{c.data.fringeCash ? ` + $${Number(c.data.fringeCash).toFixed(2)} cash` : ''}{c.data.fringePlan ? ` + $${Number(c.data.fringePlan).toFixed(2)} plan` : ''}
                  {canWrite && payFor.some((p) => p.id === c.personId) && <RowActions id={c.id} onEdit={() => setEditing(c)} canRemove />}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </BetaPage>
  )
}
