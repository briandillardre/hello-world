'use client'

import { useMemo, useState, useTransition } from 'react'
import { Building2, Scale, TrendingUp, Landmark } from 'lucide-react'
import { TRADES, tradeByKey, computeValuation, fmtMoney, type FinanceProfile } from '@/lib/valuation'
import { saveFinanceProfileAction } from '@/lib/actions/finance'

/** Where a value sits inside a benchmark band, clamped for the bar UI. */
const pos = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)))

function Money({ v }: { v: number | null | undefined }) {
  return <>{v != null ? fmtMoney(v) : '—'}</>
}

/** One metric vs the industry band: value, band bar, verdict word. */
function BenchRow({ label, value, lo, hi, fmt, higherIsBetter = true }: {
  label: string; value: number | null; lo: number; hi: number
  fmt: (n: number) => string; higherIsBetter?: boolean
}) {
  const verdict = value == null ? null
    : value < lo ? (higherIsBetter ? 'below range' : 'better than range')
    : value > hi ? (higherIsBetter ? 'above range' : 'worse than range')
    : 'in range'
  const good = verdict === 'in range' || verdict === 'better than range' || verdict === 'above range'
  return (
    <div className="py-2.5 border-b border-navy-800 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-muted">{label}</span>
        <span className="text-sm font-bold text-ink">{value != null ? fmt(value) : '—'}</span>
      </div>
      <div className="mt-1.5 relative h-1.5 rounded-full bg-navy-950">
        <div className="absolute inset-y-0 left-[15%] right-[15%] rounded-full bg-navy-700" />
        {value != null && (
          <div
            className={`absolute -top-[3px] w-3 h-3 rounded-full border-2 border-navy-950 ${good ? 'bg-teal' : 'bg-amber'}`}
            style={{ left: `calc(${15 + pos(value, lo, hi) * 70}% - 6px)` }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-faint">
        <span>{fmt(lo)}</span>
        {verdict && <span className={good ? 'text-teal' : 'text-amber'}>{verdict}</span>}
        <span>{fmt(hi)}</span>
      </div>
    </div>
  )
}

export function FinancePanel({ initial, teamCount, autoFleetValue, canEdit, available }: {
  initial: FinanceProfile
  teamCount: number
  autoFleetValue: number
  canEdit: boolean
  available: boolean
}) {
  const [p, setP] = useState<FinanceProfile>(initial)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const bm = tradeByKey(p.industry)
  const employees = p.employees || teamCount || undefined
  const revPerEmp = p.lastYearRevenue && employees ? p.lastYearRevenue / employees : null
  const margin = p.lastYearRevenue && p.lastYearProfit != null ? p.lastYearProfit / p.lastYearRevenue : null
  const val = useMemo(() => computeValuation(p, autoFleetValue, bm), [p, autoFleetValue, bm])

  function save() {
    start(async () => {
      const r = await saveFinanceProfileAction(p)
      if (r.ok) { setSaved(true); setError(null); setTimeout(() => setSaved(false), 2000) }
      else setError(r.error ?? 'Save failed')
    })
  }

  const inp = 'w-full rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink disabled:opacity-50'
  const lbl = 'block text-[10.5px] font-mono uppercase tracking-[0.1em] text-faint mb-1'
  const num = (k: keyof FinanceProfile) => ({
    value: p[k] ?? '',
    disabled: !canEdit,
    inputMode: 'numeric' as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9.]/g, '')
      setP((x) => ({ ...x, [k]: raw === '' ? undefined : Number(raw) }))
    },
  })

  return (
    <div className="space-y-4">
      {!available && (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          One database update turns this page on — run migration{' '}
          <span className="font-mono text-teal">048_finance_profile.sql</span> in the Supabase SQL Editor.
        </p>
      )}

      {/* ── Inputs ── */}
      <section className="rounded-xl border border-navy-800 bg-navy-900 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-amber" />
          <h2 className="font-display font-bold text-sm text-ink flex-1">Your numbers</h2>
          {pending && <span className="text-[11px] text-faint">Saving…</span>}
          {saved && <span className="text-[11px] text-teal">Saved ✓</span>}
          {canEdit && <button type="button" onClick={save} className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5">Save</button>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="col-span-2 md:col-span-1"><span className={lbl}>Trade</span>
            <select className={inp} disabled={!canEdit} value={p.industry ?? 'gc'}
              onChange={(e) => setP((x) => ({ ...x, industry: e.target.value }))}>
              {TRADES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label><span className={lbl}>Last year revenue $</span><input className={inp} {...num('lastYearRevenue')} placeholder="2400000" /></label>
          <label><span className={lbl}>Revenue YTD $</span><input className={inp} {...num('ytdRevenue')} placeholder="1500000" /></label>
          <label><span className={lbl}>Last year net profit $</span><input className={inp} {...num('lastYearProfit')} placeholder="180000" /></label>
          <label><span className={lbl}>Owner pay + perks $</span><input className={inp} {...num('ownerComp')} placeholder="120000" /></label>
          <label><span className={lbl}>Employees ({teamCount} on roster)</span><input className={inp} {...num('employees')} placeholder={String(teamCount || 10)} /></label>
          <label><span className={lbl}>Fleet value $ (auto {fmtMoney(autoFleetValue)})</span><input className={inp} {...num('fleetValueOverride')} placeholder={String(autoFleetValue || '')} /></label>
          <label><span className={lbl}>Other assets $</span><input className={inp} {...num('otherAssets')} placeholder="0" /></label>
          <label><span className={lbl}>Debt / liabilities $</span><input className={inp} {...num('liabilities')} placeholder="0" /></label>
        </div>
        <p className="text-[10.5px] text-faint mt-2">Fleet value auto-sums the purchase prices on your assets — override it if the market&apos;s moved. QuickBooks auto-fill lands here once connected.</p>
      </section>

      {/* ── Headline tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: 'Last year revenue', v: p.lastYearRevenue },
          { l: 'Revenue YTD', v: p.ytdRevenue },
          { l: 'Revenue / employee', v: revPerEmp },
          { l: 'Net margin', v: margin, pct: true },
        ].map((t) => (
          <div key={t.l} className="rounded-xl border border-navy-800 bg-navy-900 p-3 text-center">
            <p className="text-lg font-display font-bold text-ink">
              {t.v == null ? '—' : t.pct ? `${(t.v * 100).toFixed(1)}%` : fmtMoney(t.v)}
            </p>
            <p className="text-[10px] uppercase tracking-[0.08em] text-faint">{t.l}</p>
          </div>
        ))}
      </div>

      {/* ── vs industry ── */}
      <section className="rounded-xl border border-navy-800 bg-navy-900 p-4">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="h-4 w-4 text-teal" />
          <h2 className="font-display font-bold text-sm text-ink">You vs {bm.label.toLowerCase()}s</h2>
        </div>
        <BenchRow label="Net profit margin" value={margin} lo={bm.marginLo} hi={bm.marginHi} fmt={(n) => `${(n * 100).toFixed(1)}%`} />
        <BenchRow label="Revenue per employee" value={revPerEmp} lo={bm.revPerEmpLo} hi={bm.revPerEmpHi} fmt={fmtMoney} />
        <p className="text-[10.5px] text-faint mt-2">Bands are published small-business ranges for your trade — directional, not gospel. They tighten as HammerTrack benchmarks real fleets.</p>
      </section>

      {/* ── Valuation ── */}
      <section className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-amber" />
          <h2 className="font-display font-bold text-sm text-ink">What the company is worth</h2>
        </div>

        {val.blended ? (
          <div className="rounded-xl border border-amber/40 bg-amber/5 p-4 text-center">
            <p className="text-[10px] uppercase tracking-[0.1em] text-faint mb-1">Blended estimate</p>
            <p className="text-2xl font-display font-bold text-amber">{fmtMoney(val.blended.lo)} – {fmtMoney(val.blended.hi)}</p>
            <p className="text-[10.5px] text-faint mt-1">weighted: income 50 · market 30 · asset 20 (of the methods with data)</p>
          </div>
        ) : (
          <p className="text-sm text-faint">Enter last year&apos;s revenue and profit above and the valuation builds itself.</p>
        )}

        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-navy-800 bg-navy-950 p-3">
            <p className="text-[11px] font-bold text-ink flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5 text-teal" /> Income (capitalization)</p>
            <p className="text-base font-display font-bold text-ink mt-1">{val.income ? <>{fmtMoney(val.income.lo)} – {fmtMoney(val.income.hi)}</> : '—'}</p>
            <p className="text-[10.5px] text-faint mt-1">
              SDE <Money v={val.sde} /> (profit + owner pay) × {bm.sdeMultLo.toFixed(1)}–{bm.sdeMultHi.toFixed(1)}× for {bm.label.toLowerCase()}s.
              {!val.income && ' Needs last-year profit.'}
            </p>
          </div>
          <div className="rounded-lg border border-navy-800 bg-navy-950 p-3">
            <p className="text-[11px] font-bold text-ink flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-blue-400" /> Market (sales comps)</p>
            <p className="text-base font-display font-bold text-ink mt-1">{val.market ? <>{fmtMoney(val.market.lo)} – {fmtMoney(val.market.hi)}</> : '—'}</p>
            <p className="text-[10.5px] text-faint mt-1">
              Revenue × {bm.revMultLo.toFixed(2)}–{bm.revMultHi.toFixed(2)}× — what similar shops actually sell for.
              {!val.market && ' Needs last-year revenue.'}
            </p>
          </div>
          <div className="rounded-lg border border-navy-800 bg-navy-950 p-3">
            <p className="text-[11px] font-bold text-ink flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-violet-400" /> Asset (cost)</p>
            <p className="text-base font-display font-bold text-ink mt-1">{val.asset ? <>{fmtMoney(val.asset.lo)} – {fmtMoney(val.asset.hi)}</> : '—'}</p>
            <p className="text-[10.5px] text-faint mt-1">
              Fleet {fmtMoney(p.fleetValueOverride ?? autoFleetValue)} + other assets − debt. The floor a buyer can&apos;t argue with.
            </p>
          </div>
        </div>

        <p className="text-[10.5px] text-faint">
          Same three lenses as a real-estate appraisal — capitalization, comps, cost. Estimates from
          entered figures and published trade multiples; not a formal appraisal. Raising margin,
          utilization, and clean books moves the number — the levers live in docs/GROWTH-PLATFORM.md.
        </p>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
