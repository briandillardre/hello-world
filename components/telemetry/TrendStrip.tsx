import { resolveKey, formatReading, type Tone } from '@/lib/telemetry-catalog'
import type { TrendRow } from '@/lib/db/telemetry'
import { TONE_HEX } from './Gauge'

/**
 * Seven days of one reading, as a range per day: a bar from the day's low
 * to its high, a tick at the average, coloured by where the day's HIGH sat
 * on the gauge's bands (a coolant bar turns red on the day it overheated).
 * One hue per chart, text in the text tokens, a table under a disclosure
 * so the numbers are readable without the picture.
 */

const W = 300, H = 74, PAD_L = 34, PAD_R = 6, PAD_T = 6, PAD_B = 16

interface DayCell { day: string; min: number; max: number; avg: number; n: number; tone: Tone }

export function TrendStrip({ rows, tz }: { rows: TrendRow[]; tz: string }) {
  const byKey = new Map<string, TrendRow[]>()
  for (const r of rows) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key)!.push(r) }
  if (!byKey.size) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from(byKey.entries()).map(([key, list]) => <OneTrend key={key} readingKey={key} rows={list} tz={tz} />)}
    </div>
  )
}

function OneTrend({ readingKey, rows, tz }: { readingKey: string; rows: TrendRow[]; tz: string }) {
  const res = resolveKey(readingKey)
  const def = res?.def ?? null
  const conv = (v: number) => (def?.convert ? def.convert(v) : v)
  const unit = def?.unit ?? ''
  const decimals = def?.decimals ?? 0
  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const toneAt = (display: number): Tone => {
    const bands = def?.gauge?.bands
    if (!bands) return 'info'
    for (const b of bands) if (display <= b.to) return b.tone === 'off' ? 'info' : b.tone
    return bands[bands.length - 1].tone
  }
  const cells: DayCell[] = rows
    .map((r) => ({ day: r.day, min: conv(r.min), max: conv(r.max), avg: conv(r.avg), n: r.n, tone: toneAt(conv(r.max)) }))
    .sort((a, b) => a.day.localeCompare(b.day))
  if (!cells.length) return null

  const lo = Math.min(...cells.map((c) => c.min))
  const hi = Math.max(...cells.map((c) => c.max))
  const span = Math.max(hi - lo, Math.abs(hi) * 0.02, 1e-6)
  const yLo = lo - span * 0.08, yHi = hi + span * 0.08
  const plotH = H - PAD_T - PAD_B
  const y = (v: number) => PAD_T + ((yHi - v) / (yHi - yLo)) * plotH
  const colW = (W - PAD_L - PAD_R) / Math.max(cells.length, 1)
  const barW = Math.max(6, Math.min(18, colW * 0.5))
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
  const longFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`)).charAt(0)
  const dayLong = (d: string) => longFmt.format(new Date(`${d}T12:00:00Z`))
  const latest = cells[cells.length - 1]

  return (
    <figure className="m-0 rounded-lg border border-navy-800 bg-navy-950/60 p-2.5">
      <figcaption className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[12px] font-semibold text-ink">{res?.label ?? readingKey} <span className="text-faint font-normal">· 7 days</span></span>
        <span className="font-mono text-[10px] text-faint">{fmt(lo)}–{fmt(hi)}{unit ? ` ${unit}` : ''}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label={`${res?.label ?? readingKey}, daily low to high over ${cells.length} days`}>
        {/* y labels: the extremes only — recessive */}
        <text x={PAD_L - 5} y={y(hi) + 3} textAnchor="end" fontSize={8.5} fill="#6f88a0" fontFamily="ui-monospace,monospace">{fmt(hi)}</text>
        <text x={PAD_L - 5} y={y(lo) + 3} textAnchor="end" fontSize={8.5} fill="#6f88a0" fontFamily="ui-monospace,monospace">{fmt(lo)}</text>
        <line x1={PAD_L} x2={W - PAD_R} y1={y(lo)} y2={y(lo)} stroke="#1a3552" strokeWidth={1} />
        {cells.map((c, i) => {
          const cx = PAD_L + colW * i + colW / 2
          const top = y(c.max), bottom = y(c.min)
          const h = Math.max(3, bottom - top)
          const hex = TONE_HEX[c.tone]
          return (
            <g key={c.day}>
              <title>{`${dayLong(c.day)} · ${fmt(c.min)}–${fmt(c.max)}${unit ? ' ' + unit : ''} · avg ${fmt(c.avg)} · ${c.n.toLocaleString()} reports`}</title>
              <rect x={cx - barW / 2} y={top} width={barW} height={h} rx={2} fill={hex} fillOpacity={0.55} />
              <line x1={cx - barW / 2} x2={cx + barW / 2} y1={y(c.avg)} y2={y(c.avg)} stroke="#e8f0f7" strokeWidth={1.5} />
              <text x={cx} y={H - 4} textAnchor="middle" fontSize={8.5} fill="#6f88a0" fontFamily="ui-monospace,monospace">{dayLabel(c.day)}</text>
            </g>
          )
        })}
      </svg>
      <p className="mt-1 text-[10.5px] text-faint leading-snug">
        Bar = the day&apos;s low to high, tick = average. Latest day: {fmt(latest.min)}–{fmt(latest.max)}{unit ? ` ${unit}` : ''} over {latest.n.toLocaleString()} reports.
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-faint hover:text-muted">Table</summary>
        <table className="mt-1 w-full text-left text-[11px]">
          <thead><tr className="text-faint font-mono text-[9.5px] uppercase"><th className="py-0.5">Day</th><th>Low</th><th>High</th><th>Avg</th><th>Reports</th></tr></thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.day} className="border-t border-navy-800/60">
                <td className="py-0.5 text-muted">{dayLong(c.day)}</td>
                <td className="tabular-nums text-ink">{fmt(c.min)}</td>
                <td className="tabular-nums text-ink">{fmt(c.max)}</td>
                <td className="tabular-nums text-ink">{fmt(c.avg)}</td>
                <td className="tabular-nums text-faint">{c.n.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Kept for callers that only want the formatted latest value of a key. */
export function latestText(key: string, v: unknown): string {
  return formatReading(resolveKey(key)?.def ?? null, v).text
}
