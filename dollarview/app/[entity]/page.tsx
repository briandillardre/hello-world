import Link from 'next/link'
import { ArrowRight, ReceiptText } from 'lucide-react'
import { getPack } from '@/data/registry'
import { totalBudget } from '@/lib/budget'
import { computeReceipt } from '@/lib/receipt'
import { projectHealth, vendorTotals } from '@/lib/projects'
import { money, moneyFull, num } from '@/lib/format'
import { StatTile } from '@/components/StatTile'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { slotColor } from '@/lib/palette'
import { generalFundWeights } from '@/lib/receipt'

export default function EntityLanding({ params }: { params: { entity: string } }) {
  const pack = getPack(params.entity)!
  const fy = pack.entity.currentFiscalYear
  const total = totalBudget(pack, fy)
  const medianReceipt = computeReceipt(pack, { homeValue: pack.entity.medianHomeValue, ownerOccupied: true })
  const activeProjects = pack.projects.filter((p) => projectHealth(p) !== 'complete')
  const vendors = vendorTotals(pack).slice(0, 5)
  const weights = generalFundWeights(pack, fy)
  const weightTotal = weights.reduce((s, w) => s + w.amount, 0)
  const deptById = new Map(pack.departments.map((d) => [d.id, d]))

  return (
    <div>
      {/* Hero stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={`${pack.entity.fiscalYearLabel.split(' (')[0]} total budget`} value={money(total)} detail="All funds" />
        <StatTile label="Per resident" value={moneyFull(Math.round(total / pack.entity.population))} detail={`${num(pack.entity.population)} residents`} />
        <StatTile
          label="Median home pays"
          value={`${moneyFull(Math.round(medianReceipt.primaryEntityTax))}/yr`}
          detail={`${moneyFull(pack.entity.medianHomeValue)} home, owner-occupied`}
        />
        <StatTile label="Capital projects" value={String(pack.projects.length)} detail={`${activeProjects.length} active now`} />
      </div>

      {/* Receipt CTA */}
      <Link
        href={`/${pack.entity.slug}/receipt`}
        className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-brand/40 bg-brand/5 p-5 transition-colors hover:bg-brand/10"
      >
        <div className="flex items-center gap-4">
          <ReceiptText className="h-9 w-9 text-brand" aria-hidden />
          <div>
            <p className="font-semibold">Get your personal tax receipt</p>
            <p className="text-sm text-ink2">
              Enter your home value and see exactly what you pay for police, parks, streets — down to the dollar.
            </p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-brand" aria-hidden />
      </Link>

      {/* Budget teaser: one stacked bar of general-fund shares */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Where the general fund goes</h2>
          <Link href={`/${pack.entity.slug}/budget`} className="text-sm text-brand hover:underline">
            Explore the full budget →
          </Link>
        </div>
        <div className="mt-3 flex h-9 w-full gap-0.5 overflow-hidden rounded-lg" role="img" aria-label="General fund split by department">
          {weights.map((w) => {
            const dept = deptById.get(w.departmentId)!
            return (
              <div
                key={w.departmentId}
                style={{ width: `${(w.amount / weightTotal) * 100}%`, backgroundColor: slotColor(dept.colorSlot) }}
                title={`${dept.name}: ${money(w.amount)}`}
              />
            )
          })}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {weights.map((w) => {
            const dept = deptById.get(w.departmentId)!
            return (
              <li key={w.departmentId} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slotColor(dept.colorSlot) }} aria-hidden />
                <span className="text-ink2">{dept.name}</span>
                <span className="tabular font-medium">{money(w.amount)}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Active projects strip */}
      {activeProjects.length > 0 && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Projects being built right now</h2>
            <Link href={`/${pack.entity.slug}/projects`} className="text-sm text-brand hover:underline">
              All {pack.projects.length} projects →
            </Link>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeProjects.slice(0, 3).map((p) => (
              <ProjectCard key={p.id} project={p} pack={pack} />
            ))}
          </div>
        </section>
      )}

      {/* Top vendors */}
      {vendors.length > 0 && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Top contractors</h2>
            <Link href={`/${pack.entity.slug}/vendors`} className="text-sm text-brand hover:underline">
              All vendors →
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-grid rounded-xl border border-grid bg-surface">
            {vendors.map((v) => (
              <li key={v.vendorId} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{v.name}</span>
                <span className="tabular font-medium">
                  {money(v.total)} <span className="font-normal text-muted">· {v.contracts} contract{v.contracts > 1 ? 's' : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
