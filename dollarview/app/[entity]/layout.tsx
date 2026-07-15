import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { entitySlugs, getPack } from '@/data/registry'
import { SiteNav } from '@/components/SiteNav'
import { SiteFooter } from '@/components/SiteFooter'
import { DemoBanner } from '@/components/DemoBanner'
import { EntityTabs } from '@/components/EntityTabs'

export const dynamicParams = false

export function generateStaticParams() {
  return entitySlugs().map((entity) => ({ entity }))
}

export function generateMetadata({ params }: { params: { entity: string } }): Metadata {
  const pack = getPack(params.entity)
  if (!pack) return {}
  return {
    title: { default: pack.entity.name, template: `%s · ${pack.entity.shortName} · DollarView` },
    description: `Where does a ${pack.entity.shortName} tax dollar go? Budget, projects, and contracts — made legible.`,
  }
}

export default function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { entity: string }
}) {
  const pack = getPack(params.entity)
  if (!pack) notFound()

  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <DemoBanner entity={pack.entity} />
      <div className="border-b border-grid bg-surface">
        <div className="mx-auto max-w-page px-4 pt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {pack.entity.kind === 'city' ? 'City' : pack.entity.kind === 'county' ? 'County' : 'School district'} ·{' '}
            {pack.entity.state}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{pack.entity.name}</h1>
          <div className="mt-4">
            <EntityTabs slug={pack.entity.slug} />
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-8">{children}</main>
      <SiteFooter />
    </div>
  )
}
