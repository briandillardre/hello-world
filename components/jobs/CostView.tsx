'use client'

/**
 * Job cost (migration 155): the budget against what has been spent, by cost
 * type — most of it feeding itself (time cards, machine hours, receipts) —
 * the costs entered or pasted from accounting, and WIP: earned against billed.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Wallet, Plus, Trash2, Pencil, AlertTriangle, ClipboardPaste } from 'lucide-react'
import { BUDGET_PCATS, PCATS, PCAT_WORDS, type CostRollup, type Pcat, type Wip } from '@/lib/jobs/cost'
import { money } from '@/lib/jobs/payapp'
import type { JobCostData } from '@/lib/db/jobcost'
import { budgetFromEstimateAction, deleteBudgetLineAction, deleteCostAction, importCostsAction, saveBudgetLineAction, saveCostAction, saveEacAction } from '@/lib/actions/jobcost'

const fmtDay = (d: string | null) => {
  if (!d) return ''
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const box = 'rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none text-[13px]'
const inp = 'w-full ' + box
const btn = 'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-50'

export function CostView({ zone, data, roll, wip, canEdit, canManage, demo }: {
  zone: { id: string; name: string }; data: JobCostData; roll: CostRollup; wip: Wip; canEdit: boolean; canManage: boolean; demo: boolean
}) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [share, setShare] = useState('50')
  const [line, setLine] = useState<{ id: string | null; costCode: string; description: string; pcat: Pcat; original: string } | null>(null)
  const [cost, setCost] = useState<{ id: string | null; spentOn: string; pcat: Pcat; amount: string; vendor: string; reference: string; description: string } | null>(null)
  const [paste, setPaste] = useState<string | null>(null)
  const [pasteResult, setPasteResult] = useState<string | null>(null)
  const [eac, setEac] = useState(data.eac !== null ? String(data.eac) : '')
  const s = data.sources

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>, fail: string, after?: () => void) {
    setBusy(key); setErr(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || fail); return false }
    after?.(); router.refresh(); return true
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4 text-[12.5px]">
        <div>
          <Link href={`/jobs/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> The job</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Wallet className="h-5 w-5 text-amber flex-none" /> <span className="truncate">Job cost · {zone.name}</span></h1>
          <p className="text-faint">The budget against what has been spent — labor from the time cards, machines from the trackers&apos; hours, fuel, repairs and material from receipts, the rest entered or pasted from accounting. {data.from ? `Counting from ${fmtDay(data.from)}.` : ''}</p>
        </div>
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-muted">Demo mode — sign in to cost a job.</p>}
        {!data.available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber">Job cost is being set up — try again in a minute.</p>}
        {data.partial && <p className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> Some of the costs couldn&apos;t be read just now, so these totals may be short — refresh to try again.</p>}
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Contract to date" value={money(wip.contract)} />
          <Stat label="Cost to date" value={money(wip.costToDate)} sub={`${wip.pctComplete}% of ${money(wip.estimatedCost)}`} />
          <Stat label="Forecast margin" value={money(wip.forecastMargin)} sub={wip.marginPct !== null ? `${wip.marginPct}%` : ''} tone={wip.forecastMargin < 0 ? 'bad' : undefined} />
          <Stat label={wip.overUnder > 0 ? 'Overbilled' : wip.overUnder < 0 ? 'Underbilled' : 'Over / under billed'} value={money(Math.abs(wip.overUnder))} sub={`billed ${money(wip.billed)} · earned ${money(wip.earned)}`} tone={wip.overUnder < 0 ? 'warn' : undefined} />
        </div>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <h2 className="text-ink font-semibold text-[14px]">Budget against actual</h2>
          {roll.overBudget.length > 0 && <p className="text-red-300 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Over budget: {roll.overBudget.map((p) => PCAT_WORDS[p].toLowerCase()).join(', ')}.</p>}
          <div className="overflow-x-auto -mx-3 px-3">
            <table className="min-w-[640px] w-full text-ink">
              <thead className="text-faint text-[10.5px] uppercase tracking-wider"><tr className="text-left">
                <th className="py-1 pr-2">Cost type</th><th className="py-1 pr-2 text-right">Original</th><th className="py-1 pr-2 text-right">Change orders</th><th className="py-1 pr-2 text-right">Current</th><th className="py-1 pr-2 text-right">Actual</th><th className="py-1 pr-2 text-right">Remaining</th><th className="py-1 text-right">Used</th>
              </tr></thead>
              <tbody>
                {roll.rows.map((r) => {
                  const over = BUDGET_PCATS.includes(r.pcat) && r.current > 0 && r.actual > r.current
                  return (
                    <tr key={r.pcat} className="border-t border-navy-800">
                      <td className="py-1 pr-2 text-ink">{r.pcat} · {PCAT_WORDS[r.pcat]}{!BUDGET_PCATS.includes(r.pcat) && <span className="text-faint"> (actual only)</span>}</td>
                      <td className="py-1 pr-2 text-right font-mono">{money(r.original)}</td>
                      <td className="py-1 pr-2 text-right font-mono text-muted">{money(r.changeOrders)}</td>
                      <td className="py-1 pr-2 text-right font-mono">{money(r.current)}</td>
                      <td className={'py-1 pr-2 text-right font-mono ' + (over ? 'text-red-300' : 'text-ink')}>{money(r.actual)}</td>
                      <td className="py-1 pr-2 text-right font-mono text-muted">{BUDGET_PCATS.includes(r.pcat) ? money(r.remaining) : '—'}</td>
                      <td className="py-1 text-right font-mono text-muted">{r.pctUsed !== null ? `${r.pctUsed}%` : '—'}</td>
                    </tr>
                  )
                })}
                <tr className="border-t border-navy-600 font-semibold">
                  <td className="py-1 pr-2 text-ink">Total</td>
                  <td className="py-1 pr-2 text-right font-mono">{money(roll.total.original)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{money(roll.total.changeOrders)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{money(roll.total.current)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{money(roll.total.actual)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{money(roll.total.remaining)}</td>
                  <td className="py-1 text-right font-mono">{roll.total.pctUsed !== null ? `${roll.total.pctUsed}%` : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="text-faint space-y-0.5">
            <li>Labor: {s.labor.hours.toLocaleString()} h on time cards = {money(s.labor.dollars)}{s.labor.unpricedPeople ? <span className="text-amber"> · {s.labor.unpricedHours.toLocaleString()} h from {s.labor.unpricedPeople} {s.labor.unpricedPeople === 1 ? 'person' : 'people'} with no loaded rate (set it on their phone in Assets)</span> : null}</li>
            <li>Equipment: {s.equipment.hours.toLocaleString()} machine-hours on site from {s.equipment.machines} tracked {s.equipment.machines === 1 ? 'machine' : 'machines'} = {money(s.equipment.dollars)} at each machine&apos;s own rates (leave fuel out of a machine&apos;s rate when its fuel comes in on receipts)</li>
            <li>Receipts coded to the job: {s.receipts.count} = {money(s.receipts.dollars)} (fuel, repairs, material and other by their category)</li>
            <li>Entered or pasted: {s.entered.count} = {money(s.entered.dollars)}</li>
          </ul>
        </section>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <h2 className="text-ink font-semibold text-[14px]">WIP</h2>
          <p className="text-muted">Cost to cost: {wip.pctComplete}% complete ({money(wip.costToDate)} of an estimated {money(wip.estimatedCost)}) → {money(wip.earned)} earned of {money(wip.contract)}; billed {money(wip.billed)} ({wip.overUnder >= 0 ? `${money(wip.overUnder)} overbilled` : `${money(-wip.overUnder)} earned, not billed`}); retainage held {money(wip.retainageHeld)}.</p>
          {canManage && (
            <div className="flex items-end gap-2 flex-wrap">
              <label className="block space-y-0.5"><span className="block text-[11.5px] text-faint">Your estimate at completion ($ — blank = the current budget)</span><input inputMode="decimal" className={box + ' w-48 max-w-full'} value={eac} onChange={(e) => setEac(e.target.value)} /></label>
              <button type="button" className={btn} disabled={!!busy} onClick={() => void run('eac', () => saveEacAction(zone.id, eac.trim() === '' ? null : Number(eac.replace(/[$,\s]/g, ''))), 'Couldn’t save — try again.')}>Save</button>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <h2 className="text-ink font-semibold text-[14px]">The budget</h2>
          <p className="text-faint">Direct cost from the awarded scope. The original stays as set; change orders with a cost impact move the current budget.</p>
          {canManage && !data.budget.length && (
            <div className="flex items-end gap-2 flex-wrap">
              <label className="block space-y-0.5"><span className="block text-[11.5px] text-faint">Crew cost that is labor (%) — the rest is equipment</span><input inputMode="numeric" className={box + ' w-24'} value={share} onChange={(e) => setShare(e.target.value)} /></label>
              <button type="button" disabled={!!busy} onClick={() => void run('fromEst', () => budgetFromEstimateAction(zone.id, Number(share)), 'Couldn’t build it — try again.')} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'fromEst' ? 'Building…' : 'Build it from the estimate'}</button>
            </div>
          )}
          <div className="divide-y divide-navy-800">
            {data.budget.map((b) => (
              <div key={b.id} className="flex items-center gap-2 py-1.5">
                <span className="w-6 text-faint">{b.pcat}</span>
                <span className="flex-1 min-w-0 truncate text-ink">{b.costCode ? <span className="text-faint">{b.costCode} · </span> : null}{b.description}</span>
                <span className="font-mono text-ink">{money(b.original)}</span>
                {canManage && <>
                  <button type="button" aria-label="Edit" onClick={() => setLine({ id: b.id, costCode: b.costCode ?? '', description: b.description, pcat: b.pcat, original: String(b.original) })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Remove" onClick={() => { if (window.confirm(`Remove ${b.description}?`)) void run('delB', () => deleteBudgetLineAction(zone.id, b.id), 'Couldn’t remove it — try again.') }} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </>}
              </div>
            ))}
          </div>
          {line && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-lg border border-navy-700 bg-navy-900 p-2">
              <input className={inp} placeholder="Cost code" value={line.costCode} onChange={(e) => setLine({ ...line, costCode: e.target.value })} maxLength={40} />
              <input className={inp + ' col-span-2'} placeholder="Description" value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} maxLength={200} />
              <select className={inp} value={line.pcat} onChange={(e) => setLine({ ...line, pcat: e.target.value as Pcat })}>{BUDGET_PCATS.map((p) => <option key={p} value={p}>{p} · {PCAT_WORDS[p]}</option>)}</select>
              <input className={inp} placeholder="Amount $" inputMode="decimal" value={line.original} onChange={(e) => setLine({ ...line, original: e.target.value })} />
              <div className="col-span-2 sm:col-span-5 flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => void run('line', () => saveBudgetLineAction(zone.id, line, line.id), 'Couldn’t save — try again.', () => setLine(null))} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">Save</button>
                <button type="button" onClick={() => setLine(null)} className={btn}>Cancel</button>
              </div>
            </div>
          )}
          {canManage && !line && <button type="button" onClick={() => setLine({ id: null, costCode: '', description: '', pcat: 'L', original: '' })} className="inline-flex items-center gap-1 text-teal"><Plus className="h-3.5 w-3.5" /> Add a budget line</button>}
        </section>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <h2 className="text-ink font-semibold text-[14px]">Costs entered or pasted</h2>
          <p className="text-faint">Sub and supplier invoices, payroll adjustments — anything the time cards, trackers and receipts don&apos;t already carry.</p>
          {canEdit && (
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => setCost({ id: null, spentOn: new Date().toISOString().slice(0, 10), pcat: 'S', amount: '', vendor: '', reference: '', description: '' })} className={btn}><Plus className="h-4 w-4" /> Add a cost</button>
              <button type="button" onClick={() => { setPaste(paste === null ? '' : null); setPasteResult(null) }} className={btn}><ClipboardPaste className="h-4 w-4" /> Paste from accounting</button>
            </div>
          )}
          {paste !== null && (
            <div className="space-y-2">
              <p className="text-faint">One per line, straight out of Excel or Sheets: date, type (L M S E F R O), amount, vendor, reference, description.</p>
              <textarea className={inp + ' font-mono'} rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'5/21/2026\tS\t12,500.00\tPaving sub\tINV-77\tCurb and gutter'} />
              <button type="button" disabled={!!busy || !paste.trim()} onClick={() => void run('paste', async () => {
                const r = await importCostsAction(zone.id, paste)
                if (r?.ok) setPasteResult(`${r.added} added${r.skipped.length ? ` · ${r.skipped.length} skipped: ${r.skipped.slice(0, 5).map((x) => `line ${x.line} — ${x.why}`).join(' · ')}` : ''}`)
                return r
              }, 'Couldn’t add them — try again.', () => setPaste(null))} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'paste' ? 'Adding…' : 'Add them'}</button>
            </div>
          )}
          {pasteResult && <p className="text-teal">{pasteResult}</p>}
          {cost && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 rounded-lg border border-navy-700 bg-navy-900 p-2">
              <input type="date" className={inp} value={cost.spentOn} onChange={(e) => setCost({ ...cost, spentOn: e.target.value })} />
              <select className={inp} value={cost.pcat} onChange={(e) => setCost({ ...cost, pcat: e.target.value as Pcat })}>{PCATS.map((p) => <option key={p} value={p}>{p} · {PCAT_WORDS[p]}</option>)}</select>
              <input className={inp} placeholder="Amount $" inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
              <input className={inp} placeholder="Vendor" value={cost.vendor} onChange={(e) => setCost({ ...cost, vendor: e.target.value })} maxLength={120} />
              <input className={inp} placeholder="Reference" value={cost.reference} onChange={(e) => setCost({ ...cost, reference: e.target.value })} maxLength={60} />
              <input className={inp} placeholder="Description" value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} maxLength={300} />
              <div className="col-span-2 sm:col-span-6 flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => void run('cost', () => saveCostAction(zone.id, cost, cost.id), 'Couldn’t save — try again.', () => setCost(null))} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">Save</button>
                <button type="button" onClick={() => setCost(null)} className={btn}>Cancel</button>
              </div>
            </div>
          )}
          <div className="divide-y divide-navy-800">
            {data.entered.slice(0, 200).map((x) => (
              <div key={x.id} className="flex items-center gap-2 py-1.5">
                <span className="w-24 text-faint">{fmtDay(x.spentOn)}</span>
                <span className="w-6 text-faint">{x.pcat}</span>
                <span className="flex-1 min-w-0 truncate text-ink">{[x.vendor, x.reference, x.description].filter(Boolean).join(' · ') || '—'}</span>
                <span className="font-mono text-ink">{money(x.amount)}</span>
                {canEdit && <>
                  <button type="button" aria-label="Edit" onClick={() => setCost({ id: x.id, spentOn: x.spentOn, pcat: x.pcat, amount: String(x.amount), vendor: x.vendor ?? '', reference: x.reference ?? '', description: x.description ?? '' })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Remove" onClick={() => { if (window.confirm('Remove this cost?')) void run('delC', () => deleteCostAction(zone.id, x.id), 'Couldn’t remove it — try again.') }} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </>}
              </div>
            ))}
            {!data.entered.length && <p className="py-1.5 text-faint">None yet.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wider text-faint">{label}</p>
      <p className={'font-mono text-[14px] ' + (tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber' : 'text-ink')}>{value}</p>
      {sub && <p className="text-[11px] text-faint">{sub}</p>}
    </div>
  )
}
