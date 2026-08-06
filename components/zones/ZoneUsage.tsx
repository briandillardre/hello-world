import Link from 'next/link'
import { FileText } from 'lucide-react'
import type { ZoneAssetUsage } from '@/lib/costs'
import type { AssetType } from '@/lib/types'
import { ExportCsv } from '@/components/ui/ExportCsv'

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const h1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString()

/**
 * The job cockpit: what actually happened inside this zone over the window —
 * per-asset active hours, time on site, miles, and (permission-gated) cost.
 * Server-rendered from the same accrual engine that prices QBO invoices, so
 * this table IS the invoice preview.
 */
export function ZoneUsage({
  usage, days, showCosts, canInvoice,
}: {
  usage: ZoneAssetUsage[]
  days: number
  showCosts: boolean
  canInvoice: boolean
}) {
  const totals = usage.reduce(
    (t, u) => ({ active: t.active + u.activeHours, present: t.present + u.presentHours, miles: t.miles + u.miles, amount: t.amount + u.amount }),
    { active: 0, present: 0, miles: 0, amount: 0 }
  )

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
          Tracked usage · last {days} days
        </h2>
        <span className="flex items-center gap-2.5">
          <ExportCsv
            filename="zone-usage.csv"
            headers={showCosts ? ['Asset', 'Type', 'Active hrs', 'On-site hrs', 'Miles', 'Cost'] : ['Asset', 'Type', 'Active hrs', 'On-site hrs', 'Miles']}
            rows={usage.map((u) => showCosts
              ? [u.name, u.type, u.activeHours.toFixed(1), u.presentHours.toFixed(1), u.miles.toFixed(1), u.amount.toFixed(2)]
              : [u.name, u.type, u.activeHours.toFixed(1), u.presentHours.toFixed(1), u.miles.toFixed(1)])}
          />
          {canInvoice && usage.length > 0 && (
            <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-teal hover:underline">
              <FileText className="h-3.5 w-3.5" /> Invoice this zone →
            </Link>
          )}
        </span>
      </div>

      {usage.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No tracked activity inside this zone yet — usage appears as soon as a tracked asset works here.
        </p>
      ) : (
        <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint border-b border-navy-800">
                <th className="px-3 py-2.5 font-medium">Asset</th>
                <th className="px-3 py-2.5 font-medium text-right">Active</th>
                <th className="px-3 py-2.5 font-medium text-right">On site</th>
                <th className="px-3 py-2.5 font-medium text-right">Miles</th>
                {showCosts && <th className="px-3 py-2.5 font-medium text-right">Cost</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-800/70">
              {usage.map((u) => (
                <tr key={u.assetId}>
                  <td className="px-3 py-2.5">
                    <Link href={`/assets/${u.assetId}`} className="flex items-center gap-2 text-ink hover:text-amber transition-colors">
                      <span>{TYPE_EMOJI[u.type]}</span>
                      <span className="truncate max-w-[160px]">{u.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{h1(u.activeHours)}h</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{h1(u.presentHours)}h</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{u.miles >= 0.05 ? h1(u.miles) : '—'}</td>
                  {showCosts && (
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-ink">
                      {u.amount > 0 ? money(u.amount) : '—'}
                    </td>
                  )}
                </tr>
              ))}
              <tr className="bg-navy-950/60">
                <td className="px-3 py-2.5 font-semibold text-ink">Total</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-ink">{h1(totals.active)}h</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-ink">{h1(totals.present)}h</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-ink">{totals.miles >= 0.05 ? h1(totals.miles) : '—'}</td>
                {showCosts && (
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-amber">{money(totals.amount)}</td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {usage.length > 0 && !showCosts && (
        <p className="text-[11px] text-faint mt-1.5">Dollar figures hidden — ask an admin for the “See $ costs” permission.</p>
      )}
    </section>
  )
}
