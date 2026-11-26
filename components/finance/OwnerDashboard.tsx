import Link from 'next/link'
import { CalendarCheck, Gauge } from 'lucide-react'
import type { OwnerDashboardData } from '@/lib/db/owner'
import { applyDiscounts, layoutSankey, valuationDiscounts, type BooksAnswers } from '@/lib/owner/dashboard'
import { AGE_BUCKETS, AGE_WORDS } from '@/lib/jobs/portfolio'
import { BooksQuestions } from './BooksQuestions'

const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const short = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : Math.abs(v) >= 10_000 ? `$${Math.round(v / 1000)}k` : money(v))
const asOf = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const card = 'rounded-xl border border-navy-800 bg-navy-900/60 p-3'

/** Cost-type colours: one fixed order, distinct for colour-blind readers too (labels carry identity). */
const CAT_COLOR: Record<string, string> = {
  cL: '#60a5fa', cM: '#f59e0b', cS: '#a78bfa', cE: '#f472b6', cF: '#fb923c', cR: '#94a3b8', cO: '#64748b', margin: '#2dd4bf',
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'good' | 'warn' }) {
  const c = tone === 'bad' ? 'text-red-300' : tone === 'good' ? 'text-teal' : tone === 'warn' ? 'text-amber' : 'text-ink'
  return (
    <div className={card + ' min-w-0'}>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{label}</p>
      <p className={`font-mono text-[18px] font-bold ${c}`}>{value}</p>
      {sub && <p className="text-[11.5px] text-muted">{sub}</p>}
    </div>
  )
}

/**
 * The owner dashboard (Nov 25): what's owed both ways, booked work, bids, who
 * we depend on, where the money goes and what a buyer would pay — from the
 * app's own records. Server-rendered; only the books questions are a client island.
 */
export function OwnerDashboard({ d, blended, books, canAnswer, demo }: {
  d: OwnerDashboardData
  blended: { lo: number; hi: number } | null
  books: BooksAnswers
  canAnswer: boolean
  demo: boolean
}) {
  const discounts = valuationDiscounts(d.concentration, books)
  const adjusted = applyDiscounts(blended, discounts)
  const over60Share = d.ar.total > 0 ? d.ar.over60 / d.ar.total : null
  const s = d.sankey ? layoutSankey(d.sankey, 640, 260, { nodeW: 10, gap: 6 }) : null
  return (
    <section className="space-y-3" aria-labelledby="owner-dash">
      <div>
        <h2 id="owner-dash" className="font-display font-bold text-ink flex items-center gap-2"><Gauge className="h-4 w-4 text-amber" /> Owner dashboard</h2>
        <p className="text-[12px] text-faint">From your pay apps, job cost, supplier invoices and bids — as of {new Date(`${d.today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.{demo ? ' Demo numbers.' : ''}{d.books ? (d.books.cash && d.books.asOf ? ` Cash in the bank from QuickBooks, as of ${asOf(d.books.asOf)}.` : d.books.connected ? ' Cash in the bank shows after the first nightly QuickBooks read.' : ' Cash in the bank comes once QuickBooks is connected.') : ''}</p>
        {d.partial && <p className="text-[12px] text-amber">Some job costs or bids didn’t load in full — these totals may be short.</p>}
      </div>

      {d.books && (
        <Link href="/finance/close" className={card + ' flex items-center justify-between gap-2 hover:border-navy-700'}>
          <span className="min-w-0 truncate text-[12.5px] text-ink"><CalendarCheck className="inline h-3.5 w-3.5 mr-1.5 text-amber" />{d.books.close.line}</span>
          <span className={'shrink-0 text-[12px] ' + (d.books.close.status === 'late' && !d.books.close.signed ? 'text-red-300' : 'text-teal')}>{d.books.close.status === 'late' && !d.books.close.signed ? 'Late →' : 'Close →'}</span>
        </Link>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {d.books && (
          d.books.cash
            ? <Tile label="Cash in the bank" value={short(d.books.cash.total)} sub={`${d.books.cash.accounts} account${d.books.cash.accounts === 1 ? '' : 's'} · as of ${d.books.asOf ? asOf(d.books.asOf) : '—'}`} tone={d.books.cash.total < 0 ? 'bad' : undefined} />
            : d.books.connected
              ? <Tile label="Cash in the bank" value="—" sub="after tonight’s QuickBooks read" />
              : <Link href="/accounting" className="min-w-0"><Tile label="Cash in the bank" value="—" sub="connect QuickBooks →" /></Link>
        )}
        <Tile label="Owed to you" value={short(d.ar.total)} sub={d.ar.pastDue > 0 ? `${short(d.ar.pastDue)} past due` : 'nothing past due'} tone={d.ar.pastDue > 0 ? 'warn' : undefined} />
        <Tile label="Over 60 days" value={pct(over60Share)} sub={`${short(d.ar.over60)} · aim under 10%`} tone={over60Share !== null && over60Share > 0.1 ? 'bad' : over60Share !== null ? 'good' : undefined} />
        <Tile label="You owe suppliers" value={d.ap.available ? short(d.ap.total) : '—'} sub={d.ap.available ? `${short(d.ap.pastDue)} past due · ${short(d.ap.dueThisWeek)} due this week` : 'supplier invoices not set up'} tone={d.ap.pastDue > 0 ? 'bad' : undefined} />
        <Tile label="Backlog" value={short(d.backlog.total)} sub={`${d.backlog.jobs.length} job${d.backlog.jobs.length === 1 ? '' : 's'} booked${d.backlog.unknown.length ? ` · ${d.backlog.unknown.length} with no contract $` : ''}`} />
        <Tile label="Bids won · 90 days" value={pct(d.bids90.winRate)} sub={d.bids90.sent ? `${d.bids90.won} of ${d.bids90.won + d.bids90.lost} decided · ${pct(d.bids90.dollarWinRate)} of the dollars` : 'no bids recorded'} />
        <Tile label="Retainage held" value={short(d.retainageHeld)} sub="on running jobs" />
      </div>

      {d.ar.total > 0 && (
        <div className={card}>
          <p className="text-[12px] text-muted mb-1.5">What customers owe, by how late</p>
          <div className="flex h-3 rounded-full overflow-hidden bg-navy-800" role="img" aria-label="Receivables by age">
            {AGE_BUCKETS.map((b, i) => {
              const v = d.ar.totals[b] ?? 0
              return v > 0 ? <div key={b} style={{ width: `${(v / d.ar.total) * 100}%`, background: ['#2dd4bf', '#a3e635', '#f59e0b', '#fb923c', '#f87171'][i] }} className="border-r-2 border-navy-900 last:border-r-0" title={`${AGE_WORDS[b]}: ${money(v)}`} /> : null
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
            {AGE_BUCKETS.map((b) => <span key={b}>{AGE_WORDS[b]} <span className="font-mono text-ink">{short(d.ar.totals[b] ?? 0)}</span></span>)}
          </div>
          <Link href="/jobs/portfolio" className="mt-1 inline-block text-[12px] text-teal">Money across jobs →</Link>
        </div>
      )}

      <div className={card + ' space-y-2'}>
        <p className="text-[13px] font-semibold text-ink">What the company is worth to a buyer</p>
        {!blended ? (
          <p className="text-[12px] text-faint">Fill in last year’s revenue and profit below — the range starts from those.</p>
        ) : (
          <>
            <p className="text-[12.5px] text-muted">Before discounts <span className="font-mono text-ink">{short(blended.lo)} – {short(blended.hi)}</span></p>
            {discounts.length ? (
              <ul className="space-y-0.5 text-[12px] text-muted">
                {discounts.map((x) => <li key={x.key}><span className="font-mono text-amber">−{x.pct}%</span> {x.why}</li>)}
              </ul>
            ) : <p className="text-[12px] text-teal">No discounts — books a buyer can rely on, no customer over 30%.</p>}
            {adjusted && <p className="text-[13px] text-ink">A buyer’s range <span className="font-mono font-bold text-teal">{short(adjusted.lo)} – {short(adjusted.hi)}</span></p>}
          </>
        )}
        <BooksQuestions books={books} canAnswer={canAnswer} />
        <p className="text-[11px] text-faint">A rule-of-thumb range, not an appraisal. Each fix above moves it — that’s the point of watching it weekly.</p>
      </div>

      <div className={card}>
        <p className="text-[13px] font-semibold text-ink">Who you depend on <span className="text-[11.5px] font-normal text-faint">· work awarded in the last 12 months</span></p>
        {!d.concentration.customers.length ? <p className="text-[12px] text-faint">No awarded jobs with a customer and a contract amount yet.</p> : (
          <div className="mt-1.5 space-y-1">
            {d.concentration.customers.slice(0, 6).map((c) => (
              <div key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center text-[12px]">
                <div className="min-w-0">
                  <div className="flex justify-between gap-2"><span className="truncate text-ink">{c.name}</span><span className="font-mono text-muted">{pct(c.share)}</span></div>
                  <div className="h-1.5 rounded-full bg-navy-800"><div className="h-1.5 rounded-full" style={{ width: `${c.share * 100}%`, background: c.share > 0.3 ? '#f59e0b' : '#60a5fa' }} /></div>
                </div>
                <span className="font-mono text-muted">{short(c.amount)}</span>
              </div>
            ))}
            {d.concentration.noCustomer > 0 && <p className="text-[11.5px] text-faint">{short(d.concentration.noCustomer)} of work has no customer on the job.</p>}
          </div>
        )}
      </div>

      <div className={card}>
        <p className="text-[13px] font-semibold text-ink">Where the money goes <span className="text-[11.5px] font-normal text-faint">· earned on running jobs, by cost type</span></p>
        {!s || !d.sankey ? <p className="text-[12px] text-faint">Shows once a running job has a budget and costs.</p> : (
          <>
            <div className="overflow-x-auto">
              <svg viewBox="-170 -6 1010 272" className="w-full min-w-[520px] h-auto" role="img" aria-label="Earned revenue by job flowing to cost types and margin">
                {s.bands.map((b, i) => <path key={i} d={b.d} fill={CAT_COLOR[b.to] ?? '#64748b'} opacity={0.28}><title>{`${money(b.value)}`}</title></path>)}
                {s.nodes.map((n) => (
                  <g key={n.id}>
                    <rect x={n.x} y={n.y} width={s.nodeW} height={n.h} rx={2} fill={n.id === 'loss' ? '#f87171' : n.col === 2 ? CAT_COLOR[n.id] ?? '#64748b' : n.col === 1 ? '#e2e8f0' : '#94a3b8'} />
                    <text x={n.col === 0 ? n.x - 6 : n.x + s.nodeW + 6} y={n.y + n.h / 2} dy="0.35em" textAnchor={n.col === 0 ? 'end' : 'start'} fontSize={12} fill="#cbd5e1">
                      {n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label} <tspan fill="#94a3b8" fontFamily="ui-monospace, monospace">{short(n.value)}</tspan>
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            <p className="text-[12px] text-muted">{d.sankey.margin >= 0 ? <>Gross margin so far <span className="font-mono text-teal">{short(d.sankey.margin)}</span></> : <>Costs run <span className="font-mono text-red-300">{short(-d.sankey.margin)}</span> over what’s earned</>} · <Link href="/jobs/portfolio" className="text-teal">WIP schedule →</Link></p>
          </>
        )}
      </div>

      {d.backlog.jobs.length > 0 && (
        <div className={card}>
          <p className="text-[13px] font-semibold text-ink">Booked work left</p>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {d.backlog.jobs.slice(0, 8).map((j) => <li key={j.jobId} className="flex justify-between gap-2"><span className="truncate text-muted">{j.name}</span><span className="font-mono text-ink">{short(j.left)}</span></li>)}
          </ul>
          {d.backlog.unknown.length > 0 && <p className="mt-1 text-[11.5px] text-amber">No contract amount on: {d.backlog.unknown.slice(0, 5).join(', ')}{d.backlog.unknown.length > 5 ? '…' : ''}</p>}
        </div>
      )}
    </section>
  )
}
