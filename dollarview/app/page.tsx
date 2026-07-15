import Link from 'next/link'
import { ArrowRight, Eye, ReceiptText, HardHat } from 'lucide-react'
import { listEntities } from '@/data/registry'
import { totalBudget } from '@/lib/budget'
import { money, num } from '@/lib/format'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooter } from '@/components/SiteFooter'

export default function HomePage() {
  const entities = listEntities()

  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-grid bg-surface">
          <div className="mx-auto max-w-page px-4 py-16 text-center sm:py-24">
            <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
              Where does <span className="text-brand">your dollar</span> go?
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-ink2">
              Your tax bill, itemized like a receipt. Your government&apos;s budget, drawn to scale. Every project with its
              real cost and an honest status. Public money should be legible to the public.
            </p>
            <div className="mx-auto mt-8 grid max-w-3xl gap-4 text-left sm:grid-cols-3">
              {[
                { Icon: ReceiptText, title: 'Your receipt', text: 'What YOUR home pays for police, parks, and streets — to the dollar.' },
                { Icon: Eye, title: 'The whole budget', text: 'Every fund and line item, sized by amount. Click to drill in.' },
                { Icon: HardHat, title: 'Every project', text: 'Cost, contractor, timeline — and a status derived from the numbers.' },
              ].map(({ Icon, title, text }) => (
                <div key={title} className="rounded-xl border border-grid bg-plane p-4">
                  <Icon className="h-6 w-6 text-brand" aria-hidden />
                  <p className="mt-2 font-semibold">{title}</p>
                  <p className="mt-1 text-sm text-ink2">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Entity picker */}
        <section className="mx-auto max-w-page px-4 py-12">
          <h2 className="text-center text-lg font-semibold">Pick your government</h2>
          <div className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
            {entities.map((pack) => (
              <Link
                key={pack.entity.slug}
                href={`/${pack.entity.slug}`}
                className="group rounded-xl border border-grid bg-surface p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{pack.entity.name}</p>
                  {pack.entity.isDemo ? (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-branddeep">Demo</span>
                  ) : (
                    <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold text-[#8a5a00]">Preview</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink2">
                  {num(pack.entity.population)} residents · {money(totalBudget(pack, pack.entity.currentFiscalYear))} budget
                </p>
                <p className="mt-3 flex items-center gap-1 text-sm font-medium text-brand">
                  See where the money goes
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </p>
              </Link>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-muted">
            Want your city, county, or school district here?{' '}
            <Link href="/methodology" className="underline hover:text-ink">
              Here&apos;s how the data works
            </Link>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
