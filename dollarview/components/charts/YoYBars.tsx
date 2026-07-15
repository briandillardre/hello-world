import type { YoYDelta } from '@/lib/budget'
import { money, fyLabel } from '@/lib/format'
import { slotColor } from '@/lib/palette'

/**
 * Year-over-year change per department. Polarity uses the diverging pair
 * (blue = increase, red = decrease) around a neutral zero line, with the
 * signed value labeled on every row so color never carries meaning alone.
 */
export function YoYBars({ deltas, fy, priorFy }: { deltas: YoYDelta[]; fy: number; priorFy: number }) {
  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d.deltaPct ?? 0)), 0.01)

  return (
    <div>
      <p className="text-sm text-ink2">
        Change from {fyLabel(priorFy)} to {fyLabel(fy)}, by department
      </p>
      <div className="mt-3 space-y-2.5">
        {deltas.map((d) => {
          const pctVal = d.deltaPct ?? 0
          const widthPct = (Math.abs(pctVal) / maxAbs) * 50
          const up = pctVal >= 0
          return (
            <div key={d.departmentId} className="grid grid-cols-[minmax(7rem,1fr)_2fr_5rem] items-center gap-3 text-sm">
              <span className="flex items-center gap-2 truncate">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slotColor(d.colorSlot) }} aria-hidden />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="relative block h-3" role="img" aria-label={`${d.name}: ${up ? 'up' : 'down'} ${(Math.abs(pctVal) * 100).toFixed(1)} percent, ${money(d.delta)}`}>
                <span className="absolute inset-y-0 left-1/2 w-px bg-baseline" aria-hidden />
                <span
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    left: up ? '50%' : `${50 - widthPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: up ? '#2a78d6' : '#e34948',
                  }}
                  aria-hidden
                />
              </span>
              <span className={`tabular text-right font-medium ${up ? 'text-branddeep' : 'text-critical'}`}>
                {up ? '+' : '−'}
                {(Math.abs(pctVal) * 100).toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
