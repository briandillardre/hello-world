/**
 * Money across jobs (board #233): what customers owe by how late it is, the
 * WIP schedule a bank or bonding agent asks for, and cash by month — the
 * Invoice Tracking workbook, from the jobs and their pay apps. A server
 * component: every number is computed before it leaves (lib/jobs/portfolio.ts).
 */
import Link from 'next/link'
import { ArrowLeft, Landmark, AlertTriangle } from 'lucide-react'
import { AGE_BUCKETS, AGE_WORDS, monthWords, TERMS, type AgeBucket, type ArRow, type CashMonth, type WipInput, type WipTotals } from '@/lib/jobs/portfolio'
import type { Wip } from '@/lib/jobs/cost'
import { money } from '@/lib/jobs/payapp'
import type { PortfolioJob } from '@/lib/db/portfolio'

const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}
const TONE: Record<AgeBucket, string> = { current: 'text-muted', d30: 'text-amber', d60: 'text-amber', d90: 'text-red-300', over90: 'text-red-300' }

export function PortfolioView({ jobs, ar, wip, cash, retHeld, terms, partial, available, demo }: {
  jobs: PortfolioJob[]
  ar: { rows: ArRow[]; totals: Record<AgeBucket, number>; total: number; pastDue: number }
  wip: { rows: (WipInput & { w: Wip })[]; totals: WipTotals }
  cash: CashMonth[]
  retHeld: number; terms: number; partial: boolean; available: boolean; demo: boolean
}) {
  const byId = new Map(jobs.map((j) => [j.jobId, j]))
  const label = (id: string) => {
    const j = byId.get(id)
    if (!j) return 'A job'
    return j.number && !j.name.startsWith(j.number) ? `${j.number} ${j.name}` : j.name
  }
  const zoneOf = (id: string) => byId.get(id)?.zoneId ?? null
  const td = 'py-1 pr-2.5 text-right font-mono whitespace-nowrap'

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4 text-[12.5px]">
        <div>
          <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Jobs</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Landmark className="h-5 w-5 text-amber flex-none" /> Money across jobs</h1>
          <p className="text-faint">What customers owe and how late it is, the WIP schedule, cash by month — from the pay apps and job cost, no second spreadsheet.</p>
        </div>
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-muted">Demo mode — sign in to see your jobs&apos; money.</p>}
        {!available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber">This is being set up — try again in a minute.</p>}
        {partial && <p className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> Some of it couldn&apos;t be read just now, so a total may be short — refresh to try again.</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Owed to us" value={money(ar.total)} sub={ar.pastDue ? `${money(ar.pastDue)} past due` : 'none past due'} tone={ar.pastDue ? 'warn' : undefined} />
          <Stat label="Retainage held" value={money(retHeld)} sub="released by each job’s final application" />
          <Stat label="Left to bill" value={money(wip.totals.leftToBill)} sub={`on ${wip.rows.length} running ${wip.rows.length === 1 ? 'job' : 'jobs'}`} />
          <Stat label="Underbilled" value={money(wip.totals.underbilled)} sub={`earned, not billed · overbilled ${money(wip.totals.overbilled)}`} tone={wip.totals.underbilled > 0 ? 'warn' : undefined} />
        </div>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1.5 sm:gap-2">
            <h2 className="text-ink font-semibold text-[14px] sm:flex-1">What customers owe</h2>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-faint">Due</span>
              {TERMS.map((t) => (
                <Link key={t} href={`/jobs/portfolio?terms=${t}`} className={'rounded-full px-2 py-0.5 ' + (t === terms ? 'bg-amber text-navy-950 font-semibold' : 'bg-navy-800 text-muted hover:text-ink')}>{t ? `net ${t}` : 'on receipt'}</Link>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1">
            {AGE_BUCKETS.map((b) => (
              <div key={b} className="rounded-lg bg-navy-950/60 px-2 py-1.5 min-w-0">
                <p className="text-[10.5px] uppercase tracking-wider text-faint truncate">{AGE_WORDS[b]}</p>
                <p className={'font-mono truncate ' + (ar.totals[b] ? TONE[b] : 'text-faint')}>{money(ar.totals[b])}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto -mx-3 px-3">
            <table className="min-w-[620px] w-full text-ink">
              <thead className="text-faint text-[10.5px] uppercase tracking-wider"><tr className="text-left">
                <th className="py-1 pr-3">Job</th><th className="py-1 pr-3">Application</th><th className="py-1 pr-3">Dated</th><th className="py-1 pr-3">Due</th><th className="py-1 pr-3 text-right">Late</th><th className="py-1 text-right">Owed</th>
              </tr></thead>
              <tbody>
                {ar.rows.map((r) => {
                  const z = zoneOf(r.jobId)
                  return (
                    <tr key={`${r.jobId}:${r.appNo}`} className="border-t border-navy-800">
                      <td className="py-1 pr-3 max-w-[260px] truncate">{z ? <Link href={`/jobs/${z}/billing`} className="hover:underline">{label(r.jobId)}</Link> : label(r.jobId)}</td>
                      <td className="py-1 pr-3 text-muted">#{r.appNo}</td>
                      <td className="py-1 pr-3 text-muted whitespace-nowrap">{fmtDay(r.appDate)}</td>
                      <td className="py-1 pr-3 text-muted whitespace-nowrap">{fmtDay(r.dueOn)}</td>
                      <td className={'py-1 pr-3 text-right whitespace-nowrap ' + TONE[r.bucket]}>{r.daysPastDue > 0 ? `${r.daysPastDue} d` : '—'}</td>
                      <td className="py-1 text-right font-mono">{money(r.owed)}</td>
                    </tr>
                  )
                })}
                {!ar.rows.length && <tr><td colSpan={6} className="py-2 text-faint">Nothing owed — every sent application is paid.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <h2 className="text-ink font-semibold text-[14px]">WIP schedule</h2>
          <p className="text-faint">Every job won and not closed, cost to cost: % complete = cost to date ÷ the estimated cost (the current budget, or the PM&apos;s estimate at completion); earned = that share of the contract to date; billed = the last sent application.</p>
          <div className="overflow-x-auto -mx-3 px-3">
            <table className="min-w-[900px] w-full text-ink">
              <thead className="text-faint text-[10.5px] uppercase tracking-wider"><tr className="text-left">
                <th className="py-1 pr-3">Job</th><th className="py-1 pr-3 text-right">Contract</th><th className="py-1 pr-3 text-right">Est. cost</th><th className="py-1 pr-3 text-right">Cost to date</th><th className="py-1 pr-3 text-right">Done</th>
                <th className="py-1 pr-3 text-right">Earned</th><th className="py-1 pr-3 text-right">Billed</th><th className="py-1 pr-3 text-right">Over / (under)</th><th className="py-1 pr-3 text-right">Retainage</th><th className="py-1 text-right">Margin</th>
              </tr></thead>
              <tbody>
                {wip.rows.map((r) => {
                  const z = zoneOf(r.jobId)
                  return (
                    <tr key={r.jobId} className="border-t border-navy-800">
                      <td className="py-1 pr-3 max-w-[220px] truncate">{z ? <Link href={`/jobs/${z}/cost`} className="hover:underline">{label(r.jobId)}</Link> : label(r.jobId)}</td>
                      <td className={td}>{money(r.w.contract)}</td>
                      <td className={td}>{money(r.w.estimatedCost)}</td>
                      <td className={td}>{money(r.w.costToDate)}</td>
                      <td className={td + ' text-muted'}>{r.w.pctComplete}%</td>
                      <td className={td}>{money(r.w.earned)}</td>
                      <td className={td}>{money(r.w.billed)}</td>
                      <td className={td + (r.w.overUnder < 0 ? ' text-amber' : '')}>{r.w.overUnder < 0 ? `(${money(-r.w.overUnder)})` : money(r.w.overUnder)}</td>
                      <td className={td + ' text-muted'}>{money(r.w.retainageHeld)}</td>
                      <td className={'py-1 text-right font-mono whitespace-nowrap ' + (r.w.forecastMargin < 0 ? 'text-red-300' : '')}>{money(r.w.forecastMargin)}{r.w.marginPct !== null ? <span className="text-faint"> {r.w.marginPct}%</span> : null}</td>
                    </tr>
                  )
                })}
                {wip.rows.length > 0 && (
                  <tr className="border-t border-navy-600 font-semibold">
                    <td className="py-1 pr-3">Total</td>
                    <td className={td}>{money(wip.totals.contract)}</td>
                    <td className={td}>{money(wip.totals.estimatedCost)}</td>
                    <td className={td}>{money(wip.totals.costToDate)}</td>
                    <td className={td} />
                    <td className={td}>{money(wip.totals.earned)}</td>
                    <td className={td}>{money(wip.totals.billed)}</td>
                    <td className={td}><span className="block">{money(wip.totals.overbilled)}</span><span className="block text-amber">({money(wip.totals.underbilled)})</span></td>
                    <td className={td}>{money(wip.totals.retainageHeld)}</td>
                    <td className="py-1 text-right font-mono whitespace-nowrap">{money(wip.totals.forecastMargin)}</td>
                  </tr>
                )}
                {!wip.rows.length && <tr><td colSpan={10} className="py-2 text-faint">No jobs running — won jobs show here until they close.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <h2 className="text-ink font-semibold text-[14px]">Cash by month</h2>
          <p className="text-faint">Billed = what the applications dated that month asked for; collected = what was paid that month.</p>
          <div className="overflow-x-auto -mx-3 px-3">
            <table className="min-w-[360px] w-full text-ink">
              <thead className="text-faint text-[10.5px] uppercase tracking-wider"><tr className="text-left">
                <th className="py-1 pr-3">Month</th><th className="py-1 pr-3 text-right">Billed</th><th className="py-1 pr-3 text-right">Collected</th><th className="py-1 text-right">Difference</th>
              </tr></thead>
              <tbody>
                {cash.map((m) => (
                  <tr key={m.month} className="border-t border-navy-800">
                    <td className="py-1 pr-3">{monthWords(m.month)}</td>
                    <td className={td}>{money(m.billed)}</td>
                    <td className={td}>{money(m.collected)}</td>
                    <td className={'py-1 text-right font-mono whitespace-nowrap ' + (m.collected - m.billed < 0 ? 'text-amber' : 'text-muted')}>{money(Math.round((m.collected - m.billed) * 100) / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2 min-w-0">
      <p className="text-[10.5px] uppercase tracking-wider text-faint">{label}</p>
      <p className={'font-mono text-[14px] truncate ' + (tone === 'warn' ? 'text-amber' : 'text-ink')}>{value}</p>
      {sub && <p className="text-[11px] text-faint">{sub}</p>}
    </div>
  )
}
