import { Gauge } from './Gauge'
import type { GaugeReading } from '@/lib/telemetry-catalog'
import { shortDuration } from '@/lib/live-status'

/**
 * The cluster: every gauge-worthy reading this truck sends, in dashboard
 * order. A reading older than the newest fix by more than 15 minutes (the
 * coolant temp from the last time the engine ran, say) carries an "as of"
 * so a parked truck's dial is never read as live.
 */
export function TruckGauges({ gauges, newestMs, compact = false }: {
  gauges: GaugeReading[]
  /** Time of the newest fix, to judge staleness against. */
  newestMs: number | null
  compact?: boolean
}) {
  if (!gauges.length) return null
  const size = compact ? 82 : 116
  return (
    <div className={compact ? 'grid grid-cols-3 gap-x-1 gap-y-2 justify-items-center' : 'grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-2 gap-y-3 justify-items-center'}>
      {gauges.map((g) => {
        const tMs = Date.parse(g.t)
        const stale = newestMs != null && Number.isFinite(tMs) && newestMs - tMs > 15 * 60_000 ? `${shortDuration(Date.now() - tMs)} ago` : null
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
            stale={stale}
            size={size}
          />
        )
      })}
    </div>
  )
}

function formatBig(g: GaugeReading): string {
  const v = g.value as number
  const decimals = g.def?.decimals ?? 0
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
