import { Gauge } from './Gauge'
import type { GaugeReading } from '@/lib/telemetry-catalog'
import { shortDuration } from '@/lib/live-status'

/** "2h 1m ago" — and "just now", never "just now ago". */
export function agoWords(ms: number): string {
  const d = shortDuration(ms)
  return d === 'just now' ? d : `${d} ago`
}

/**
 * The cluster: every gauge-worthy reading this truck sends, in dashboard
 * order. A reading older than the newest fix by more than 15 minutes (the
 * coolant temp from the last time the engine ran, say) carries its age in
 * amber ("2h 1m ago"; "as of …" in the tooltip) so a parked truck's dial is
 * never read as live. When every dial is that old by the same amount, the
 * age is said once under the cluster instead of under each dial.
 */
export function TruckGauges({ gauges, newestMs, compact = false }: {
  gauges: GaugeReading[]
  /** Time of the newest fix, to judge staleness against. */
  newestMs: number | null
  compact?: boolean
}) {
  if (!gauges.length) return null
  const size = compact ? 82 : 116
  const now = Date.now()
  const stales = gauges.map((g) => {
    const tMs = Date.parse(g.t)
    return newestMs != null && Number.isFinite(tMs) && newestMs - tMs > 15 * 60_000 ? agoWords(now - tMs) : null
  })
  const shared = gauges.length > 1 && stales.every((s) => s != null && s === stales[0]) ? stales[0] : null
  return (
    <div>
      <div className={compact ? 'grid grid-cols-3 gap-x-1.5 gap-y-2 justify-items-center' : 'grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-2 gap-y-3 justify-items-center'}>
        {gauges.map((g, i) => {
          const value = g.value ?? g.gauge.min
          // Off engines read 0 rpm: show the dial parked, no false "0 rpm ok".
          const text = g.value == null ? '—' : formatBig(g)
          return (
            <Gauge
              key={g.key}
              value={value}
              min={g.gauge.min}
              max={g.gauge.max}
              bands={g.gauge.bands}
              tone={g.tone}
              text={text}
              unit={g.unit}
              label={g.short}
              words={compact ? (g.tone === 'bad' || g.tone === 'warn' ? g.words : null) : g.words}
              stale={shared ? null : stales[i]}
              size={size}
            />
          )
        })}
      </div>
      {shared && <p className="mt-1.5 text-center text-[10px] text-amber/80">Dials as of {shared}</p>}
    </div>
  )
}

function formatBig(g: GaugeReading): string {
  const v = g.value as number
  const decimals = g.def?.decimals ?? 0
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
