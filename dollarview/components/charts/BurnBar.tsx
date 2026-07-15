import { STATUS } from '@/lib/palette'
import { money } from '@/lib/format'

/**
 * Budget vs spent, one thin bar. Overshoot past 100% renders in the critical
 * status color with a visible label — never color alone.
 */
export function BurnBar({ budget, spent }: { budget: number; spent: number }) {
  const pctSpent = budget > 0 ? (spent / budget) * 100 : 0
  const over = pctSpent > 100

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink2">
          Spent <strong className="tabular text-ink">{money(spent)}</strong> of {money(budget)}
        </span>
        <span className={`tabular font-medium ${over ? 'text-critical' : 'text-ink'}`}>{pctSpent.toFixed(0)}%</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-grid" role="img" aria-label={`${pctSpent.toFixed(0)} percent of budget spent`}>
        <div
          className="h-full rounded-r-full transition-[width] duration-500"
          style={{
            width: `${Math.min(100, pctSpent)}%`,
            backgroundColor: over ? STATUS.critical : '#2a78d6',
          }}
        />
      </div>
      {over && (
        <p className="mt-1 text-xs font-medium text-critical">
          {money(spent - budget)} over the original budget
        </p>
      )}
    </div>
  )
}
