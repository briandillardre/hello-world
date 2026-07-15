import type { Metadata } from 'next'
import Link from 'next/link'
import { getPack } from '@/data/registry'
import { vendorTotals } from '@/lib/projects'
import { dateShort, money, moneyFull } from '@/lib/format'

export const metadata: Metadata = { title: 'Vendors & contracts' }

export default function VendorsPage({ params }: { params: { entity: string } }) {
  const pack = getPack(params.entity)!
  const totals = vendorTotals(pack)
  const vendorById = new Map(pack.vendors.map((v) => [v.id, v]))
  const projectById = new Map(pack.projects.map((p) => [p.id, p]))
  const contracts = [...pack.contracts].sort((a, b) => b.amount - a.amount)

  if (totals.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-bold tracking-tight">Vendors & contracts</h2>
        <p className="mt-3 max-w-2xl text-sm text-ink2">
          Contract and vendor records for {pack.entity.shortName} haven&apos;t been compiled yet — they&apos;re coming in the next
          data update, sourced from the {pack.entity.shortName === 'Greenville' ? 'city' : 'entity'}&apos;s published check
          registers. See <Link href="/methodology" className="text-brand hover:underline">Methodology</Link> for sources.
        </p>
      </div>
    )
  }

  const maxTotal = totals[0].total

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Who gets paid</h2>
      <p className="mt-1 text-sm text-ink2">
        Every contractor by total contract value, and every contract on the books.
      </p>

      <section className="mt-6">
        <h3 className="font-semibold">Vendors by total contract value</h3>
        <div className="mt-3 space-y-2.5">
          {totals.map((v) => {
            const vendor = vendorById.get(v.vendorId)
            return (
              <div key={v.vendorId} className="grid grid-cols-[minmax(10rem,1.4fr)_2fr_6rem] items-center gap-3 text-sm">
                <span className="truncate">
                  {v.name}
                  {vendor?.city && <span className="ml-1.5 text-xs text-muted">{vendor.city}, {vendor.state}</span>}
                </span>
                <span className="block h-3 rounded-sm bg-grid">
                  <span
                    className="block h-full rounded-sm bg-[#2a78d6]"
                    style={{ width: `${(v.total / maxTotal) * 100}%` }}
                    aria-hidden
                  />
                </span>
                <span className="tabular text-right font-medium">{money(v.total)}</span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-10">
        <h3 className="font-semibold">All contracts</h3>
        <div className="mt-3 overflow-x-auto rounded-xl border border-grid bg-surface">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-grid text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Contractor</th>
                <th className="px-4 py-2.5 font-medium">Work</th>
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Awarded</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grid">
              {contracts.map((c) => {
                const project = c.projectId ? projectById.get(c.projectId) : undefined
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-medium">{vendorById.get(c.vendorId)?.name}</td>
                    <td className="px-4 py-2.5 text-ink2">{c.description}</td>
                    <td className="px-4 py-2.5">
                      {project ? (
                        <Link href={`/${pack.entity.slug}/projects/${project.slug}`} className="text-brand hover:underline">
                          {project.name}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{dateShort(c.awardedDate)}</td>
                    <td className="tabular px-4 py-2.5 text-right font-medium">{moneyFull(c.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
