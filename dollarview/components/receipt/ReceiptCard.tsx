import type { TaxReceipt } from '@/lib/receipt'
import type { Entity } from '@/lib/types'
import { moneyCents, moneyFull } from '@/lib/format'
import { slotColor } from '@/lib/palette'
import { DeptIcon } from '@/components/DeptIcon'

export function ReceiptCard({ receipt, entity }: { receipt: TaxReceipt; entity: Entity }) {
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-t-xl border border-b-0 border-grid bg-surface px-6 pb-6 pt-5 shadow-sm">
        <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-muted">Annual tax receipt</p>
        <h2 className="mt-1 text-center text-lg font-semibold">{entity.name}</h2>
        <p className="text-center text-xs text-muted">
          {entity.fiscalYearLabel} · {moneyFull(receipt.input.homeValue)} home
          {receipt.input.ownerOccupied ? ', owner-occupied' : ''}
        </p>

        <div className="my-4 border-t border-dashed border-baseline" />

        <ul className="space-y-2.5">
          {receipt.items.map((item) => (
            <li key={item.departmentId} className="flex items-center gap-2.5 text-sm">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: slotColor(item.colorSlot) }}
                aria-hidden
              >
                <DeptIcon name={item.icon} className="h-3.5 w-3.5 text-white" />
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-xs text-muted">{(item.percent * 100).toFixed(0)}%</span>
              <span className="tabular w-20 text-right font-medium">{moneyFull(item.amount)}</span>
            </li>
          ))}
        </ul>

        {receipt.localOptionCredit > 0 && (
          <p className="mt-3 flex justify-between text-xs text-gooddark">
            <span>Local option sales tax credit (already applied)</span>
            <span className="tabular">−{moneyFull(Math.round(receipt.localOptionCredit))}</span>
          </p>
        )}

        <div className="my-4 border-t border-dashed border-baseline" />

        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold uppercase tracking-wide">Your {entity.shortName} total</span>
          <span className="tabular text-2xl font-bold">{moneyFull(Math.round(receipt.primaryEntityTax))}</span>
        </div>
        <p className="mt-1 text-right text-xs text-muted">
          about <span className="tabular font-medium text-ink2">{moneyCents(receipt.primaryEntityTax / 365)}</span> a day
        </p>

        {receipt.salesTax && (
          <p className="mt-3 flex justify-between border-t border-dashed border-baseline pt-3 text-sm text-ink2">
            <span>
              + Est. local sales tax to {entity.shortName}
              <span className="mt-0.5 block max-w-[16rem] text-[11px] leading-snug text-muted">{receipt.salesTax.note}</span>
            </span>
            <span className="tabular font-medium text-ink">{moneyFull(receipt.salesTax.annual)}</span>
          </p>
        )}

        <div className="my-4 border-t border-dashed border-baseline" />

        <details className="text-xs text-ink2">
          <summary className="cursor-pointer font-medium text-ink hover:underline">
            Your full property tax bill ({moneyFull(Math.round(receipt.totalPropertyTax))}) — all taxing authorities
          </summary>
          <table className="mt-2 w-full">
            <tbody>
              {receipt.authorities.map((a) => (
                <tr key={a.id} className={a.isPrimary ? 'font-semibold text-ink' : ''}>
                  <td className="py-0.5">
                    {a.name}
                    {a.exempted && <span className="ml-1 text-gooddark">(exempt — owner-occupied)</span>}
                  </td>
                  <td className="tabular py-0.5 text-right text-muted">{a.millage.toFixed(1)} mills</td>
                  <td className="tabular w-20 py-0.5 text-right">{moneyFull(Math.round(a.tax))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 leading-snug text-muted">
            Only the {entity.shortName} share is itemized above — the county, schools, and other authorities set their own budgets.
            Assessed value: <span className="tabular">{moneyFull(receipt.assessedValue)}</span>.
          </p>
        </details>
      </div>
      <div className="receipt-tear rounded-b-sm border-x border-grid" aria-hidden />
    </div>
  )
}
