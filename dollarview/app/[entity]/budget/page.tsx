import type { Metadata } from 'next'
import { getPack } from '@/data/registry'
import { BudgetExplorer } from '@/components/budget/BudgetExplorer'

export const metadata: Metadata = { title: 'Budget explorer' }

export default function BudgetPage({ params }: { params: { entity: string } }) {
  const pack = getPack(params.entity)!
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">The whole budget, one map</h2>
      <p className="mt-1 text-sm text-ink2">
        Every dollar {pack.entity.shortName} plans to spend, sized by amount. Click to drill from funds into departments and line items.
      </p>
      <div className="mt-6">
        <BudgetExplorer pack={pack} />
      </div>
    </div>
  )
}
