'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ClipboardPaste, Search, TrendingUp } from 'lucide-react'
import type { BidRow, RateBand } from '@/lib/pricing/rates'
import { bandWords, parseBidPaste, rateBands, suggest, winChance } from '@/lib/pricing/rates'
import { importBidHistoryAction } from '@/lib/actions/bids'

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}
const pct = (v: number) => `${Math.round(v * 100)}%`
const input = 'rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink text-[12.5px]'
const MARGIN_KEY = 'ht_rate_margin'

type Filter = 'all' | 'won' | 'lost'

/**
 * Unit rates (migration 165, pricing engine v0 — "price through winning
 * bids"): every item the company has bid, where it won and where it lost,
 * today's cost behind it (Admins), and a suggested unit price at a target
 * margin with the win chance there — an honest band, never a promise.
 * /costbook renders it with `getRateLibrary(companyId, admin)`'s rows.
 */
export function UnitRatesView({ rows, canEdit, canManage, admin, demo, truncated = false }: {
  rows: BidRow[]
  canEdit: boolean
  canManage: boolean
  admin: boolean
  demo: boolean
  truncated?: boolean
}) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [margin, setMargin] = useState(15)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    try { const v = Number(window.localStorage.getItem(MARGIN_KEY)); if (Number.isFinite(v) && v >= 0 && v < 90 && window.localStorage.getItem(MARGIN_KEY) !== null) setMargin(v) } catch { /* private window */ }
  }, [])
  const setM = (v: number) => {
    setMargin(v)
    try { window.localStorage.setItem(MARGIN_KEY, String(v)) } catch { /* private window */ }
  }

  const bands = useMemo(() => rateBands(rows), [rows])
  const byKey = useMemo(() => {
    const g = new Map<string, BidRow[]>()
    for (const r of rows) { const a = g.get(r.itemKey); if (a) a.push(r); else g.set(r.itemKey, [r]) }
    return g
  }, [rows])
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return bands.filter((b) => {
      if (filter === 'won' && !b.won.n) return false
      if (filter === 'lost' && !b.lost.n) return false
      if (!words.length) return true
      const hay = `${b.itemName} ${b.unit} ${(byKey.get(b.itemKey) ?? []).map((r) => `${r.jobName} ${r.customer ?? ''}`).join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [bands, filter, q, byKey])
  const won = rows.filter((r) => r.result === 'won').length
  const lost = rows.filter((r) => r.result === 'lost').length

  return (
    <div className="space-y-3 text-[12.5px]">
      <div>
        <h2 className="font-display font-bold text-ink flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber" /> Unit rates from your bids</h2>
        <p className="text-faint">Every priced line of every bid: where you win, where you lose, and a price at your target margin checked against both. Sent, won and lost estimates record themselves; old bid sheets can be pasted in.</p>
        {demo && <p className="text-faint mt-1">Demo — a made-up sitework company&apos;s last two years of bids.</p>}
        {truncated && <p className="text-amber mt-1">Showing the first 20,000 bid lines.</p>}
        {!admin && !demo && <p className="text-faint mt-1">Bids recorded from your estimates are an Admin’s to see (their prices carry the margins) — this shows pasted bid history.</p>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[10rem]">
          <Search className="h-4 w-4 text-faint absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} placeholder="Item, job or customer" aria-label="Search items" className={input + ' w-full pl-8'} />
        </label>
        <div className="flex gap-1">
          {(['all', 'won', 'lost'] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (filter === f ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>
              {f === 'all' ? 'All' : f === 'won' ? 'Won' : 'Lost'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-faint">Target margin
          <input type="number" inputMode="decimal" min={0} max={80} step={1} value={margin} aria-label="Target margin percent"
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 80) setM(v) }} className={input + ' w-16'} />%
        </label>
      </div>
      <p className="text-faint">{bands.length} item{bands.length === 1 ? '' : 's'} · {rows.length.toLocaleString()} bid line{rows.length === 1 ? '' : 's'} · {won} won · {lost} lost</p>

      {canManage && canEdit && !demo && <ImportBox />}

      {!rows.length ? (
        <p className="text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">No bids on file yet. Mark an estimate Sent, Won or Lost and its line prices land here — or paste an old bid sheet.</p>
      ) : !shown.length ? (
        <p className="text-faint">Nothing matches.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((b) => (
            <ItemCard key={b.itemKey} band={b} rows={byKey.get(b.itemKey) ?? []} margin={margin} admin={admin} filter={filter}
              open={open === b.itemKey} onToggle={() => setOpen(open === b.itemKey ? null : b.itemKey)} />
          ))}
        </div>
      )}
      <p className="text-[11px] text-faint">Win chance = the share of your decided bids on that item at or under the price that you won, with its 95% range; it needs four decided bids. The low bidder&apos;s level is estimated from the low total spread evenly over your lines.</p>
    </div>
  )
}

function ItemCard({ band: b, rows, margin, admin, filter, open, onToggle }: {
  band: RateBand
  rows: BidRow[]
  margin: number
  admin: boolean
  filter: Filter
  open: boolean
  onToggle: () => void
}) {
  const s = useMemo(() => suggest({ cost: admin ? b.latestCost : null, targetMarginPct: margin, band: b }), [b, margin, admin])
  const wc = useMemo(() => (s.price !== null ? winChance(rows, s.price) : null), [rows, s.price])
  const list = useMemo(() => rows.filter((r) => filter === 'all' || r.result === filter).slice().sort((x, y) => y.bidOn.localeCompare(x.bidOn)), [rows, filter])
  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left px-3 py-2.5 flex items-start gap-2">
        <ChevronDown className={'h-4 w-4 mt-0.5 text-faint flex-none transition-transform ' + (open ? '' : '-rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-ink font-semibold truncate">{b.itemName}</span>
            <span className="font-mono text-[11px] text-faint flex-none">/{b.unit}</span>
          </span>
          <span className="block text-faint truncate">{bandWords(b)}</span>
        </span>
        <span className="text-right flex-none">
          <span className="block font-mono font-bold text-amber">{s.price !== null ? money(s.price) : '—'}</span>
          <span className="block text-[11px] text-faint">{wc ? `wins ~${pct(wc.p)}` : 'suggested'}</span>
        </span>
      </button>
      <div className="px-3 pb-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
          <Stat label={`Won (${b.won.n})`} v={b.won.median} sub={b.won.n > 1 ? `${money(b.won.min)}–${money(b.won.max)}` : null} tone="text-teal" />
          <Stat label={`Lost (${b.lost.n})`} v={b.lost.median} sub={b.lost.n ? 'median' : null} tone="text-red-400" />
          <Stat label="Low bidder" v={b.lost.lowMedian} sub={b.lost.lowN ? `est. · ${b.lost.lowN} bid${b.lost.lowN === 1 ? '' : 's'}` : null} />
          {admin ? <Stat label="Latest cost" v={b.latestCost} sub={b.latestCostOn ? fmtDay(b.latestCostOn) : null} /> : <Stat label="Bids" v={null} text={String(b.count)} sub={b.pending ? `${b.pending} out` : null} />}
        </div>
        <Strip rows={rows} price={s.price} unit={b.unit} />
        <div className="rounded-lg bg-navy-950 border border-navy-800 px-2.5 py-2 space-y-0.5">
          <p className="text-ink">
            Suggest <b className="font-mono text-amber">{s.price !== null ? money(s.price) : '—'}</b>/{b.unit}
            {s.marginPct !== null && <span className="text-faint"> · {s.marginPct}% margin</span>}
            {wc && <span className="text-muted"> · won {wc.won} of {wc.n} at or under — likely {pct(wc.lo)}–{pct(wc.hi)}</span>}
            {!wc && s.price !== null && <span className="text-faint"> · too few decided bids for a win chance</span>}
          </p>
          {s.why.map((w, i) => <p key={i} className={'text-[11.5px] ' + (s.underCost && /under cost/.test(w) ? 'text-amber' : 'text-faint')}>{w}</p>)}
          {!admin && <p className="text-[11px] text-faint">Costs behind the bids are an Admin&apos;s to see.</p>}
        </div>
        {open && (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-faint">
                  <th className="font-normal py-1 pr-2">Date</th>
                  <th className="font-normal py-1 pr-2">Job</th>
                  <th className="font-normal py-1 pr-2 hidden sm:table-cell">Customer</th>
                  <th className="font-normal py-1 pr-2 text-right hidden sm:table-cell">Qty</th>
                  <th className="font-normal py-1 pr-2 text-right">Ours</th>
                  <th className="font-normal py-1 pr-2">Result</th>
                  <th className="font-normal py-1 text-right">Low</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={r.id ?? i} className="border-t border-navy-800">
                    <td className="py-1 pr-2 text-faint whitespace-nowrap">{fmtDay(r.bidOn)}</td>
                    <td className="py-1 pr-2 text-ink max-w-[8rem] sm:max-w-none truncate">{r.jobName}{r.source === 'import' && <span className="text-faint"> · pasted</span>}</td>
                    <td className="py-1 pr-2 text-muted hidden sm:table-cell">{r.customer ?? '—'}</td>
                    <td className="py-1 pr-2 text-right font-mono text-muted hidden sm:table-cell">{r.qty === null ? '—' : r.qty.toLocaleString()}</td>
                    <td className="py-1 pr-2 text-right font-mono text-ink">{money(r.unitPrice)}</td>
                    <td className={'py-1 pr-2 ' + (r.result === 'won' ? 'text-teal' : r.result === 'lost' ? 'text-red-400' : 'text-faint')}>{r.result === 'won' ? '● won' : r.result === 'lost' ? '○ lost' : 'out'}</td>
                    <td className="py-1 text-right font-mono text-faint">{r.lowUnitPrice === null ? '—' : `~${money(r.lowUnitPrice)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function Stat({ label, v, sub, tone, text }: { label: string; v: number | null; sub?: string | null; tone?: string; text?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] uppercase tracking-wide text-faint">{label}</p>
      <p className={'font-mono ' + (tone ?? 'text-ink')}>{text ?? money(v)}</p>
      {sub && <p className="text-[10.5px] text-faint truncate">{sub}</p>}
    </div>
  )
}

/**
 * One dot per decided or open bid by its unit price: won = filled circle
 * (teal), lost = hollow circle (red), out = small grey square — shape AND
 * colour, so it reads without colour. The suggested price is the amber line.
 */
export function Strip({ rows, price, unit }: { rows: BidRow[]; price: number | null; unit: string }) {
  const vals = rows.map((r) => r.unitPrice).concat(price !== null ? [price] : [])
  if (!rows.length || !vals.length) return null
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi - lo < 1e-9) { lo = lo * 0.9; hi = hi * 1.1 + 0.01 }
  const pad = (hi - lo) * 0.06
  lo -= pad; hi += pad
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const top = (r: BidRow, i: number) => 6 + ((i * 7 + (r.result === 'won' ? 0 : r.result === 'lost' ? 3 : 5)) % 5) * 5
  const sorted = rows.slice().sort((a, b) => a.unitPrice - b.unitPrice)
  const all = rows.map((r) => r.unitPrice)
  return (
    <figure className="m-0">
      <div role="img" className="relative h-11 border-b border-navy-700 mx-1"
        aria-label={`${rows.length} bids from ${money(Math.min(...all))} to ${money(Math.max(...all))} per ${unit}${price !== null ? `; suggested ${money(price)}` : ''}`}>
        {price !== null && <span aria-hidden className="absolute top-0.5 bottom-0 border-l-2 border-dashed border-amber" style={{ left: x(price) }} />}
        {sorted.map((r, i) => (
          <span key={r.id ?? i} aria-hidden title={`${r.result === 'won' ? 'Won' : r.result === 'lost' ? 'Lost' : 'Out'} ${money(r.unitPrice)} · ${r.jobName}`}
            className={'absolute -translate-x-1/2 ' + (r.result === 'won' ? 'h-[7px] w-[7px] rounded-full bg-teal' : r.result === 'lost' ? 'h-[7px] w-[7px] rounded-full border-[1.5px] border-red-400' : 'h-[5px] w-[5px] bg-slate-500')}
            style={{ left: x(r.unitPrice), top: top(r, i) }} />
        ))}
      </div>
      <figcaption className="flex justify-between gap-2 text-[10.5px] text-faint font-mono mt-0.5">
        <span>{money(lo + pad)}</span>
        <span className="font-sans text-center">● won · ○ lost · ▪ out{price !== null ? ' · ┆ suggested' : ''}</span>
        <span>{money(hi - pad)}</span>
      </figcaption>
    </figure>
  )
}

function ImportBox() {
  const router = useRouter()
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const preview = useMemo(() => (text && text.trim() ? parseBidPaste(text) : null), [text])
  async function go() {
    if (!text?.trim()) return
    setBusy(true); setMsg(null)
    const r = await importBidHistoryAction(text).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setMsg({ ok: false, text: r && !r.ok ? r.error : 'Couldn’t import — check signal and try again.' }); return }
    setMsg({ ok: true, text: `${r.added.toLocaleString()} bid line${r.added === 1 ? '' : 's'} added${r.duplicates ? ` · ${r.duplicates} already on file` : ''}${r.problems.length ? ` · ${r.problems.length} row${r.problems.length === 1 ? '' : 's'} skipped` : ''}.` })
    setText(null)
    router.refresh()
  }
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setText(text === null ? '' : null)} className="inline-flex items-center gap-1.5 rounded-xl border border-teal/50 text-teal px-3 py-2"><ClipboardPaste className="h-4 w-4" /> Import bid history</button>
      {msg && <p className={msg.ok ? 'text-teal' : 'text-red-400'}>{msg.text}</p>}
      {text !== null && (
        <div className="rounded-xl border border-teal/40 bg-navy-900 p-3 space-y-2">
          <p className="text-faint">Copy an old bid sheet from Excel or Sheets, header row included. Columns it reads: <b className="text-muted">Date · Job · Customer · Code · Item · Unit · Qty · Unit price · Result (won / lost / W / L) · Low bid unit</b> — in any order. Item, unit, unit price and date are needed on every row.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 2_000_000))} rows={6} className={input + ' w-full font-mono'}
            placeholder={'Date\tJob\tItem\tUnit\tUnit price\tResult\n3/4/2025\tMaple St\tABC stone base\tSY\t12.40\tW'} />
          {preview && (
            <div className="space-y-1">
              <p className="text-muted">{preview.rows.length.toLocaleString()} row{preview.rows.length === 1 ? '' : 's'} read{preview.problems.length ? ` · ${preview.problems.length} can’t be read` : ''}</p>
              {preview.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11.5px]">
                    <thead><tr className="text-left text-faint"><th className="font-normal pr-2">Date</th><th className="font-normal pr-2">Item</th><th className="font-normal pr-2 text-right">Price</th><th className="font-normal">Result</th></tr></thead>
                    <tbody>
                      {preview.rows.slice(0, 8).map((r) => (
                        <tr key={r.row} className="border-t border-navy-800">
                          <td className="pr-2 text-faint whitespace-nowrap">{r.bidOn}</td>
                          <td className="pr-2 text-ink max-w-[10rem] truncate">{r.itemName} <span className="text-faint">/{r.unit}</span></td>
                          <td className="pr-2 text-right font-mono">{money(r.unitPrice)}</td>
                          <td className={r.result === 'won' ? 'text-teal' : r.result === 'lost' ? 'text-red-400' : 'text-faint'}>{r.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.rows.length > 8 && <p className="text-faint">…and {preview.rows.length - 8} more</p>}
                </div>
              )}
              {preview.problems.slice(0, 8).map((p, i) => <p key={i} className="text-amber text-[11.5px]">Row {p.row}: {p.why}</p>)}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !preview?.rows.length} onClick={() => void go()} className="rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5 disabled:opacity-50">{busy ? 'Importing…' : `Import ${preview?.rows.length ? preview.rows.length.toLocaleString() : ''}`}</button>
            <button type="button" onClick={() => setText(null)} className="text-faint hover:text-ink">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
