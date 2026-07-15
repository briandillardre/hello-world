import type { Metadata } from 'next'
import Link from 'next/link'
import { listEntities } from '@/data/registry'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooter } from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Methodology',
  description: 'Where every number comes from and how every figure is computed.',
}

export default function MethodologyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Methodology</h1>
        <p className="mt-2 text-ink2">
          Trust is the product. Every number on this site traces to a public document, every formula is published here, and
          the data itself lives in version control — every change to every figure is auditable.
        </p>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">The tax receipt math</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink2">
            <li>
              <strong className="text-ink">Assessed value</strong> = your home&apos;s market value × the assessment ratio (in South
              Carolina: 4% for an owner-occupied legal residence, 6% otherwise), rounded to the nearest $10.
            </li>
            <li>
              <strong className="text-ink">Tax per authority</strong> = assessed value × that authority&apos;s millage ÷ 1,000. Under SC
              Act 388, school <em>operating</em> millage does not apply to owner-occupied homes.
            </li>
            <li>
              <strong className="text-ink">Local option credit</strong>: where a county has a local option sales tax, the credit
              (a published factor × your appraised value) is subtracted from the bill, never below zero.
            </li>
            <li>
              <strong className="text-ink">The itemized split</strong>: your city&apos;s share is divided across departments in
              proportion to each department&apos;s share of the adopted general-fund budget. Rounded amounts are distributed so the
              line items always sum exactly to your total.
            </li>
          </ol>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Project status rules</h2>
          <p className="mt-2 text-sm text-ink2">
            Status badges are computed, never hand-picked: <strong className="text-ink">Over budget</strong> = spending has
            reached or passed 100% of budget before completion. <strong className="text-ink">Delayed</strong> = past the expected
            completion date and not finished. <strong className="text-ink">At risk</strong> = the share of budget spent is running
            more than 15 points ahead of physical completion. Otherwise <strong className="text-ink">On track</strong>.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Data sources, by entity</h2>
          <div className="mt-3 space-y-6">
            {listEntities().map((pack) => (
              <div key={pack.entity.slug} className="rounded-xl border border-grid bg-surface p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold">
                    <Link href={`/${pack.entity.slug}`} className="hover:underline">
                      {pack.entity.name}
                    </Link>
                  </h3>
                  <span className="text-xs text-muted">data as of {pack.entity.dataAsOf}</span>
                </div>
                {pack.entity.isDemo && (
                  <p className="mt-2 text-sm text-ink2">
                    Fictional demonstration data. The figures are invented; the property-tax mechanics (assessment ratios,
                    millage, Act 388, the local option credit) are real South Carolina rules, so this demo runs the exact
                    engine a real entity would.
                  </p>
                )}
                {pack.entity.disclaimer && <p className="mt-2 text-sm text-ink2">{pack.entity.disclaimer}</p>}
                <ul className="mt-3 space-y-1.5 text-sm">
                  {pack.entity.sources.map((s) => (
                    <li key={s.label} className="text-ink2">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                          {s.label}
                        </a>
                      ) : (
                        s.label
                      )}
                      {s.note && <span className="block text-xs text-muted">{s.note}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Update cadence</h2>
          <p className="mt-2 text-sm text-ink2">
            Budgets update when an entity adopts them (typically each June in South Carolina); project and contract figures
            update as entities publish check registers and CIP reports — monthly for most. When a government connects its
            finance system directly, figures update continuously.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
