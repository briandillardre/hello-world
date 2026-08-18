'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Interactive operating model — same formulas as docs/OPERATING-MODEL.md.
 * Revenue vs total cost with hire step-jumps marked, cumulative cash below,
 * three growth scenarios. Lives behind login: these are the company's books.
 *
 * The flywheel discipline, encoded: every customer is unit-profitable from
 * day one (ARPU $92 vs ~$2-4 COGS/asset); the P&L hovers near zero later
 * ON PURPOSE because surplus gets reinvested (hires, ads). Hires wait for
 * customer-count triggers so a jump never outruns the revenue that pays it.
 */

const ARPU = 92
const MACHINES = 8

function addsFor(y: number, m: number): number {
  if (y === 2026) return m >= 8 ? 1 : 0
  if (y === 2027) return m <= 6 ? 3 : 4
  return m <= 6 ? 6 : 8
}

interface Row { y: number; m: number; cust: number; mrr: number; cogs: number; payroll: number; total: number; net: number; cash: number }
interface Ev { i: number; label: string; teal?: boolean }

// Cash-injection lever (Brian, Aug 13: "an option to add cash to make this
// quicker"). Injected capital deploys as EXTRA ad spend, capped at $2k/mo
// (Upstate ad inventory + install capacity are real limits), buying
// customers at $250 CAC — deliberately worse than the model's own implied
// ~$215 (its ad budgets ÷ its adds). Hires still wait for their customer
// triggers, so they arrive EARLIER but never outrun revenue.
const CAC = 250
const MAX_EXTRA_ADS = 2000

// Pricing levers (Brian, Aug 13): price per machine, Operate platform-fee
// attach rate, one-time install fee. Pure arithmetic — NO invented demand
// elasticity. The judgment call ("does demand hold at $10?") stays human;
// the cushion is that $12/machine is still under half of Tenna's list.
// Founder-lock on the first 25 is ignored here (rounding-level effect).
interface Levers { priceM: number; attach: number; fee: number }
const BASE_LEVERS: Levers = { priceM: 8, attach: 0, fee: 0 }
// ARPU 92 = 8 machines × $8 + $28 of tags — keep the tag half constant.
const TAGS_ARPU = ARPU - MACHINES * 8

function run(k: number, inject = 0, lv: Levers = BASE_LEVERS): { rows: Row[]; events: Ev[] } {
  const rows: Row[] = []
  const events: Ev[] = []
  const arpu = MACHINES * lv.priceM + TAGS_ARPU + lv.attach * 49
  let cust = 0, cash = inject, carry = 0, pool = inject
  let h1 = false, h2 = false, h3 = false, be = false
  for (let i = 0; i < 30; i++) {
    const y = 2026 + Math.floor((6 + i) / 12)
    const m = ((6 + i) % 12) + 1
    const extraAds = Math.min(MAX_EXTRA_ADS, pool)
    pool -= extraAds
    carry += addsFor(y, m) * k + extraAds / CAC
    const add = Math.floor(carry)
    carry -= add
    cust += add
    const mrr = cust * arpu
    const sims = cust * MACHINES
    const cogs = sims * 1.75 + (sims > 10 ? 140 : 0) + 25 + (sims > 500 ? 60 : sims > 200 ? 25 : 10)
      + 20 + (sims > 500 ? 40 : sims > 200 ? 10 : 0) + (cust > 0 ? 25 + (sims > 800 ? 70 : 0) : 0) + 10 + sims * 0.02
    const software = 120 + cust * 1.5
    const insurance = cust > 0 ? 175 + Math.max(0, mrr - 2000) * 0.02 : 0
    const professional = 150 + (mrr > 5000 ? 250 : 100)
    const marketing = (y === 2026 ? (m >= 10 ? 300 : 0) : y === 2027 ? 750 : 1500) + extraAds
    let payroll = 0, wc = 0
    if (cust >= 30 && cust < 90) { payroll += 1800; wc += 150; if (!h1) { h1 = true; events.push({ i, label: 'H1 installer (PT)' }) } }
    if (cust >= 90) { payroll += 5200; wc += 200; if (!h2) { h2 = true; events.push({ i, label: 'H2 ops tech (FT)' }) } }
    if (cust >= 110) { payroll += 1200; if (!h3) { h3 = true; events.push({ i, label: 'H3 admin (PT)' }) } }
    const total = cogs + software + insurance + professional + marketing + payroll + wc
    // One-time install fee rides the month's NEW customers only.
    const net = mrr - total + add * lv.fee
    cash += net
    if (!be && net > 0 && cust > 5) { be = true; events.push({ i, label: 'breakeven', teal: true }) }
    rows.push({ y, m, cust, mrr, cogs, payroll: payroll + wc, total, net, cash })
  }
  return { rows, events }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const AMBER = '#ff9e16', TEAL = '#2dd4bf', RED = '#ff6b6b', FAINT = '#6f88a0', GRID = 'rgba(20,80,111,.45)'
const fmt = (n: number) => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US')

function setup(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth, h = cv.clientHeight
  cv.width = w * dpr
  cv.height = h * dpr
  const ctx = cv.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.font = '10.5px ui-monospace, Menlo, monospace'
  return { ctx, w, h }
}

function grid(ctx: CanvasRenderingContext2D, w: number, h: number, pad: { l: number; r: number; t: number; b: number }, maxV: number, minV: number, step: number) {
  ctx.clearRect(0, 0, w, h)
  const span = maxV - minV
  const yOf = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - (v - minV) / span)
  ctx.strokeStyle = GRID
  ctx.fillStyle = FAINT
  ctx.lineWidth = 1
  for (let v = Math.ceil(minV / step) * step; v <= maxV; v += step) {
    const y = yOf(v)
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke()
    ctx.textAlign = 'right'
    ctx.fillText('$' + (Math.abs(v) >= 1000 ? v / 1000 + 'k' : String(v)), pad.l - 6, y + 3.5)
  }
  return yOf
}

export function OperatingModel() {
  const [k, setK] = useState(1)
  const [inject, setInject] = useState(0)
  const [priceM, setPriceM] = useState(8)
  const [attach, setAttach] = useState(0)
  const [fee, setFee] = useState(0)
  const lv = { priceM, attach, fee }
  const mainRef = useRef<HTMLCanvasElement>(null)
  const cashRef = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const { rows, events } = run(k, inject, { priceM, attach, fee })
    const pad = { l: 46, r: 10, t: 14, b: 26 }

    const cvM = mainRef.current
    if (cvM) {
      const { ctx, w, h } = setup(cvM)
      const maxV = Math.max(...rows.map((r) => Math.max(r.mrr, r.total))) * 1.12 || 1000
      const step = maxV > 12000 ? 4000 : maxV > 6000 ? 2000 : 1000
      const yOf = grid(ctx, w, h, pad, maxV, 0, step)
      const xOf = (i: number) => pad.l + (w - pad.l - pad.r) * (i / (rows.length - 1))
      ctx.textAlign = 'center'
      rows.forEach((r, i) => { if (r.m === 1 || i === 0) ctx.fillText(MONTHS[r.m - 1] + ' ' + String(r.y).slice(2), xOf(i), h - 8) })
      // payroll area
      ctx.beginPath(); ctx.moveTo(xOf(0), yOf(0))
      rows.forEach((r, i) => ctx.lineTo(xOf(i), yOf(r.payroll)))
      ctx.lineTo(xOf(rows.length - 1), yOf(0)); ctx.closePath()
      ctx.fillStyle = 'rgba(159,182,204,.18)'; ctx.fill()
      // markers
      for (const e of events) {
        const x = xOf(e.i)
        ctx.strokeStyle = e.teal ? TEAL : 'rgba(45,212,191,.5)'
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.setLineDash([])
        ctx.save(); ctx.translate(Math.min(x + 4, w - 12), pad.t + 4); ctx.rotate(Math.PI / 2)
        ctx.fillStyle = e.teal ? TEAL : '#9fb6cc'; ctx.textAlign = 'left'
        ctx.fillText(e.label, 0, 0); ctx.restore()
      }
      const line = (key: 'mrr' | 'total', color: string) => {
        ctx.beginPath()
        rows.forEach((r, i) => { const x = xOf(i), y = yOf(r[key]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
        ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke()
      }
      line('total', RED)
      line('mrr', AMBER)
    }

    const cvC = cashRef.current
    if (cvC) {
      const { ctx, w, h } = setup(cvC)
      const vals = rows.map((r) => r.cash)
      const maxV = Math.max(0, ...vals) * 1.15 + 500
      const minV = Math.min(0, ...vals) * 1.15 - 500
      const yOf = grid(ctx, w, h, { ...pad, t: 10, b: 22 }, maxV, minV, Math.max(2000, Math.round((maxV - minV) / 5 / 1000) * 1000))
      const xOf = (i: number) => pad.l + (w - pad.l - pad.r) * (i / (rows.length - 1))
      ctx.strokeStyle = 'rgba(159,182,204,.5)'
      ctx.beginPath(); ctx.moveTo(pad.l, yOf(0)); ctx.lineTo(w - pad.r, yOf(0)); ctx.stroke()
      ctx.beginPath()
      rows.forEach((r, i) => { const x = xOf(i), y = yOf(r.cash); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      ctx.strokeStyle = TEAL; ctx.lineWidth = 2.2; ctx.stroke()
      ctx.textAlign = 'center'; ctx.fillStyle = FAINT
      rows.forEach((r, i) => { if (r.m === 1 || i === 0) ctx.fillText(MONTHS[r.m - 1] + ' ' + String(r.y).slice(2), xOf(i), h - 6) })
    }
  }, [k, inject, priceM, attach, fee])

  useEffect(() => {
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [draw])

  const { rows } = run(k, inject, lv)
  const last = rows[rows.length - 1]
  const be = rows.find((r) => r.net > 0 && r.cust > 5)
  const minCash = Math.min(...rows.map((r) => r.cash))
  const quarters = rows.filter((r) => r.m % 3 === 0)

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[[0.5, 'Conservative (½×)'], [1, 'Base case'], [1.75, 'Aggressive (1¾×)']].map(([v, label]) => (
          <button
            key={String(v)}
            onClick={() => setK(v as number)}
            className={
              'rounded-full border px-4 py-1.5 text-[12.5px] font-semibold transition ' +
              (k === v ? 'bg-amber/15 text-amber border-amber/40' : 'bg-navy-900 text-muted border-navy-700 hover:text-ink')
            }
          >
            {label as string}
          </button>
        ))}
      </div>

      {/* Cash injection — your money buying speed. Chips mirror the scenario
          row; teal = capital, amber = growth assumption. */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Add cash</span>
        {[[0, 'None'], [10_000, '$10k'], [25_000, '$25k'], [50_000, '$50k']].map(([v, label]) => (
          <button
            key={String(v)}
            onClick={() => setInject(v as number)}
            className={
              'rounded-full border px-4 py-1.5 text-[12.5px] font-semibold transition ' +
              (inject === v ? 'bg-teal/15 text-teal border-teal/40' : 'bg-navy-900 text-muted border-navy-700 hover:text-ink')
            }
          >
            {label as string}
          </button>
        ))}
      </div>
      {inject > 0 && (
        <p className="font-mono text-[10.5px] text-faint -mt-2">
          deploys as extra ads, ${MAX_EXTRA_ADS.toLocaleString()}/mo max · ~${CAC}/customer · hires still wait for their customer triggers, they just arrive sooner
        </p>
      )}

      {/* Pricing levers — pure math, no invented elasticity. The market
          check lives in the footnote, the judgment stays with the owner. */}
      <div className="rounded-xl border border-navy-700 bg-navy-950 p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Pricing levers</p>
          <p className="font-mono text-[11px] text-amber tabular-nums">ARPU ${Math.round(MACHINES * priceM + TAGS_ARPU + attach * 49)}/mo</p>
        </div>
        {[
          { label: `$${priceM}/machine`, min: 6, max: 12, step: 0.5, val: priceM, set: setPriceM, hint: 'list $8 · Tenna $15–25' },
          { label: `${Math.round(attach * 100)}% on Operate (+$49/mo)`, min: 0, max: 0.6, step: 0.05, val: attach, set: setAttach, hint: 'field ops tier attach' },
          { label: `$${fee} install fee`, min: 0, max: 200, step: 25, val: fee, set: setFee, hint: 'one-time, per new customer' },
        ].map((s) => (
          <div key={s.hint} className="flex items-center gap-3">
            <span className="w-[168px] flex-none text-[12px] font-semibold text-ink tabular-nums">{s.label}</span>
            <input
              type="range" min={s.min} max={s.max} step={s.step} value={s.val}
              onChange={(e) => s.set(Number(e.target.value))}
              className="flex-1 h-1 accent-amber cursor-pointer"
            />
            <span className="hidden sm:block w-[150px] flex-none font-mono text-[10px] text-faint text-right">{s.hint}</span>
          </div>
        ))}
        <p className="font-mono text-[10px] text-faint leading-relaxed">
          assumes demand holds — the cushion is that $12/machine is still under half of Tenna&apos;s list + their $500 setup.
          Founder-lock on the first 25 not modeled (rounding). Pricing-page changes still follow the sync rule.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          [`$${Math.round(last.mrr / 100) / 10}k`, 'MRR end 2028'],
          [String(last.cust), 'customers end 2028'],
          [be ? `${MONTHS[be.m - 1]} ${be.y}` : '—', 'first breakeven'],
          [fmt(minCash), inject > 0 ? 'lowest cash balance' : 'max drawdown'],
          [fmt(last.cash), inject > 0 ? `cash end 2028 · +$${inject / 1000}k in` : 'cum. cash end 2028'],
        ].map(([b, s]) => (
          <div key={s} className="rounded-xl border border-navy-700 bg-navy-950 px-3.5 py-2.5">
            <p className="font-display font-bold text-lg text-ink tabular-nums">{b}</p>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">{s}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-950 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint mb-2">Revenue vs total cost — hires are the jumps</p>
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <canvas ref={mainRef} className="w-full h-[320px]" />
          </div>
        </div>
        <div className="flex gap-4 flex-wrap text-[11.5px] text-muted pt-2">
          <span><i className="inline-block w-3.5 h-[3px] rounded align-middle mr-1.5" style={{ background: AMBER }} />MRR</span>
          <span><i className="inline-block w-3.5 h-[3px] rounded align-middle mr-1.5" style={{ background: RED }} />Total monthly cost</span>
          <span><i className="inline-block w-3.5 h-[3px] rounded align-middle mr-1.5" style={{ background: 'rgba(159,182,204,.55)' }} />Payroll portion</span>
        </div>
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-950 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint mb-2">Cumulative cash (founder pay $0 · hardware billed at cost up front)</p>
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <canvas ref={cashRef} className="w-full h-[200px]" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-950 p-4 overflow-x-auto">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint mb-2">
          Quarter by quarter <span className="sm:hidden normal-case tracking-normal">· swipe →</span>
        </p>
        <table className="w-full min-w-[640px] text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-faint font-mono text-[9.5px] uppercase tracking-[0.08em]">
              <th className="text-left py-1.5 pr-2">Quarter</th>
              <th className="text-right py-1.5 px-2">Cust</th>
              <th className="text-right py-1.5 px-2">MRR</th>
              <th className="text-right py-1.5 px-2">COGS</th>
              <th className="text-right py-1.5 px-2">Payroll</th>
              <th className="text-right py-1.5 px-2">Total cost</th>
              <th className="text-right py-1.5 px-2">Net/mo</th>
              <th className="text-right py-1.5 pl-2">Cum. cash</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((r) => (
              <tr key={`${r.y}-${r.m}`} className="border-t border-navy-800/60">
                <td className="py-1.5 pr-2 text-ink">{r.y} Q{r.m / 3}</td>
                <td className="text-right py-1.5 px-2 text-muted">{r.cust}</td>
                <td className="text-right py-1.5 px-2 text-ink">{fmt(r.mrr)}</td>
                <td className="text-right py-1.5 px-2 text-muted">{fmt(r.cogs)}</td>
                <td className="text-right py-1.5 px-2 text-muted">{fmt(r.payroll)}</td>
                <td className="text-right py-1.5 px-2 text-muted">{fmt(r.total)}</td>
                <td className={'text-right py-1.5 px-2 font-semibold ' + (r.net >= 0 ? 'text-teal' : 'text-alert')}>{fmt(r.net)}</td>
                <td className={'text-right py-1.5 pl-2 ' + (r.cash >= 0 ? 'text-teal' : 'text-alert')}>{fmt(r.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-amber/30 bg-amber/[0.06] p-4 text-[13px] text-muted space-y-2">
        <p className="font-display font-bold text-amber">You are never selling at a loss.</p>
        <p>
          Every customer is unit-profitable from day one: $92/mo revenue against roughly $16–35/mo of
          direct cost (SIMs + their share of the stack) — a 60–80% gross margin. The red months early are
          fixed overhead spread over a handful of customers; each new customer erases more of it.
        </p>
        <p>
          The flywheel is why the net line hugs zero later <em>by choice</em>: surplus goes back into ads and
          hires, and every hire waits for its customer-count trigger so the jump never outruns the revenue
          paying for it. Want monthly cash-positive instead? Try it with the pricing levers above: push
          price to $9/machine and the install fee to $150 and watch breakeven move left — the chart goes
          green earlier and grows slower. That trade is yours to pick, not the model&apos;s.
        </p>
      </div>
    </div>
  )
}
