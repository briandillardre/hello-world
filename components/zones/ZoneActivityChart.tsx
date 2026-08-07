'use client'

import { useMemo, useState } from 'react'
import { trailColor } from '@/lib/trails'

/**
 * Zone activity chart (owner ask, Aug 6): ONE interactive vertical bar chart
 * — hours or cost, stacked per asset, over a switchable timeframe. Reads the
 * exact-hours ledger rows the page already fetched; colors are each asset's
 * trail color so the chart, the map, and the radar all agree on identity.
 *
 * Form notes (dataviz): stacked bars for composition-over-time; 2px surface
 * gaps between segments; identity never rides color alone — a legend is
 * always present and tapping a bar opens a named per-asset breakdown (which
 * doubles as the table view). One axis, no dual scales.
 */
export interface ChartRow {
  day: string // yyyy-mm-dd
  assetId: string
  name: string
  type: string
  hours: number // on-site
  active: number
  cost: number
}

type Range = '7d' | '30d' | 'ytd' | 'all'
type Metric = 'hours' | 'cost'

const RANGES: { key: Range; label: string }[] = [
  { key: '7d', label: '7d' }, { key: '30d', label: '30d' },
  { key: 'ytd', label: 'YTD' }, { key: 'all', label: 'All' },
]

const SURFACE = '#0f2233' // card bg (navy-900) — segment gap color

function monthKey(day: string) { return day.slice(0, 7) }
function fmtBucket(key: string, monthly: boolean) {
  if (monthly) return new Date(key + '-15T12:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  return new Date(key + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const h1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString()
const money = (n: number) => `$${Math.round(n).toLocaleString()}`

export function ZoneActivityChart({ rows, showCosts }: { rows: ChartRow[]; showCosts: boolean }) {
  const [range, setRange] = useState<Range>('30d')
  const [metric, setMetric] = useState<Metric>('hours')
  const [sel, setSel] = useState<string | null>(null)

  const today = new Date()
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)

  const { buckets, monthly, assetOrder } = useMemo(() => {
    const monthly = range === 'ytd' || range === 'all'
    let from = ''
    if (range === '7d') from = dayKey(new Date(today.getTime() - 6 * 86_400_000))
    else if (range === '30d') from = dayKey(new Date(today.getTime() - 29 * 86_400_000))
    else if (range === 'ytd') from = `${today.getFullYear()}-01-01`
    const inRange = rows.filter((r) => !from || r.day >= from)

    // Bucket keys are CONTINUOUS (empty days render as gaps, not skipped).
    const keys: string[] = []
    if (monthly) {
      const seen = new Set(inRange.map((r) => monthKey(r.day)))
      const start = range === 'ytd' ? `${today.getFullYear()}-01`
        : (Array.from(seen).sort()[0] ?? monthKey(dayKey(today)))
      const cur = new Date(start + '-01T12:00:00')
      while (monthKey(dayKey(cur)) <= monthKey(dayKey(today))) {
        keys.push(monthKey(dayKey(cur)))
        cur.setMonth(cur.getMonth() + 1)
      }
    } else {
      const n = range === '7d' ? 7 : 30
      for (let i = n - 1; i >= 0; i--) keys.push(dayKey(new Date(today.getTime() - i * 86_400_000)))
    }

    const buckets = keys.map((key) => {
      const bucketRows = inRange.filter((r) => (monthly ? monthKey(r.day) : r.day) === key)
      const byAsset = new Map<string, { name: string; hours: number; active: number; cost: number }>()
      for (const r of bucketRows) {
        let b = byAsset.get(r.assetId)
        if (!b) byAsset.set(r.assetId, (b = { name: r.name, hours: 0, active: 0, cost: 0 }))
        b.hours += r.hours; b.active += r.active; b.cost += r.cost
      }
      return { key, byAsset }
    })

    // Stable stack order: biggest total over the range at the bottom.
    const totals = new Map<string, number>()
    for (const b of buckets) for (const [id, v] of Array.from(b.byAsset)) totals.set(id, (totals.get(id) ?? 0) + v.hours)
    const assetOrder = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    return { buckets, monthly, assetOrder }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range])

  const nameOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) m.set(r.assetId, r.name)
    return m
  }, [rows])

  const val = (v: { hours: number; cost: number }) => metric === 'cost' ? v.cost : v.hours
  const totalsPerBucket = buckets.map((b) => Array.from(b.byAsset.values()).reduce((s, v) => s + val(v), 0))
  const maxV = Math.max(1e-6, ...totalsPerBucket)
  const hasData = totalsPerBucket.some((t) => t > 0)

  // SVG geometry (viewBox units).
  const W = 720, H = 200, PAD_L = 34, PAD_B = 18, PAD_T = 8
  const plotW = W - PAD_L - 6, plotH = H - PAD_T - PAD_B
  const n = buckets.length
  const slot = plotW / Math.max(1, n)
  const bw = Math.max(3, Math.min(34, slot * 0.68))
  const yOf = (v: number) => PAD_T + plotH * (1 - v / maxV)
  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => maxV * f)
  const labelEvery = n > 14 ? Math.ceil(n / 7) : 1

  const selBucket = sel !== null ? buckets.find((b) => b.key === sel) : null
  const fmtVal = (v: number) => metric === 'cost' ? money(v) : `${h1(v)} h`

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Activity</h2>
        {showCosts && (
          <span className="flex rounded-lg border border-navy-700 p-0.5">
            {(['hours', 'cost'] as Metric[]).map((m) => (
              <button key={m} type="button" onClick={() => setMetric(m)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize ${metric === m ? 'bg-amber text-[#1a1100]' : 'text-muted hover:text-ink'}`}>
                {m}
              </button>
            ))}
          </span>
        )}
        <span className="flex rounded-lg border border-navy-700 p-0.5">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => { setRange(r.key); setSel(null) }}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${range === r.key ? 'bg-navy-700 text-ink' : 'text-muted hover:text-ink'}`}>
              {r.label}
            </button>
          ))}
        </span>
      </div>

      <div className="rounded-xl border border-navy-800 bg-navy-900 p-3">
        {!hasData ? (
          <p className="py-6 text-center text-sm text-faint">No tracked activity in this window.</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Zone ${metric} by ${monthly ? 'month' : 'day'}`}>
              {gridVals.map((g) => (
                <g key={g}>
                  <line x1={PAD_L} x2={W - 6} y1={yOf(g)} y2={yOf(g)} stroke="#1d3448" strokeWidth={1} />
                  <text x={PAD_L - 4} y={yOf(g) + 3} textAnchor="end" fontSize={8.5} fill="#7d93a8">
                    {metric === 'cost' ? `$${Math.round(g).toLocaleString()}` : h1(g)}
                  </text>
                </g>
              ))}
              {buckets.map((b, i) => {
                const x = PAD_L + i * slot + (slot - bw) / 2
                let y = yOf(0)
                const segs = assetOrder
                  .map((id) => ({ id, v: b.byAsset.get(id) ? val(b.byAsset.get(id)!) : 0 }))
                  .filter((s) => s.v > 0)
                return (
                  <g key={b.key}>
                    {segs.map((s, si) => {
                      const hPx = (s.v / maxV) * plotH
                      y -= hPx
                      const isTop = si === segs.length - 1
                      return (
                        <rect key={s.id} x={x} y={y} width={bw} height={Math.max(0.75, hPx)}
                          rx={isTop ? 2 : 0}
                          fill={trailColor(s.id)}
                          stroke={SURFACE} strokeWidth={1}
                          opacity={sel === null || sel === b.key ? 1 : 0.35}
                        />
                      )
                    })}
                    {/* full-column hit target — bigger than the mark */}
                    <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH + PAD_B}
                      fill="transparent" style={{ cursor: 'pointer' }}
                      onClick={() => setSel(sel === b.key ? null : b.key)}
                      onMouseEnter={() => setSel(b.key)}
                    />
                    {i % labelEvery === 0 && (
                      <text x={PAD_L + i * slot + slot / 2} y={H - 5} textAnchor="middle" fontSize={8.5} fill="#7d93a8">
                        {fmtBucket(b.key, monthly)}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>

            {/* Legend — identity chips in stack order; text wears text tokens */}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {assetOrder.slice(0, 8).map((id) => (
                <span key={id} className="flex items-center gap-1.5 text-[10.5px] text-muted">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: trailColor(id) }} />
                  {nameOf.get(id) ?? 'Asset'}
                </span>
              ))}
              {assetOrder.length > 8 && <span className="text-[10.5px] text-faint">+{assetOrder.length - 8} more</span>}
            </div>

            {/* Tapped-bar breakdown — the named table view for that bucket */}
            {selBucket && (
              <div className="mt-2 rounded-lg border border-navy-800 bg-navy-950 px-3 py-2">
                <p className="mb-1 text-[11px] font-semibold text-ink">
                  {fmtBucket(selBucket.key, monthly)}
                  <span className="text-faint"> · total {fmtVal(Array.from(selBucket.byAsset.values()).reduce((s, v) => s + val(v), 0))}</span>
                </p>
                <div className="space-y-0.5">
                  {Array.from(selBucket.byAsset.entries())
                    .sort((a, b) => val(b[1]) - val(a[1]))
                    .map(([id, v]) => (
                      <p key={id} className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="h-2 w-2 flex-none rounded-sm" style={{ background: trailColor(id) }} />
                        <span className="min-w-0 flex-1 truncate">{v.name}</span>
                        <span className="tabular-nums text-ink">{fmtVal(val(v))}</span>
                        {metric === 'hours' && v.active > 0 && <span className="tabular-nums text-faint">({h1(v.active)} h active)</span>}
                      </p>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
