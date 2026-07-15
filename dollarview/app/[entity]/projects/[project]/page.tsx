import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { entitySlugs, getPack } from '@/data/registry'
import { projectContracts, projectHealth } from '@/lib/projects'
import { dateShort, money, moneyFull } from '@/lib/format'
import { BurnBar } from '@/components/charts/BurnBar'
import { StatusBadge } from '@/components/projects/StatusBadge'
import { MilestoneTimeline } from '@/components/projects/MilestoneTimeline'
import { ProjectStats } from '@/components/projects/ProjectStats'
import { ShareBar } from '@/components/ShareBar'

export const dynamicParams = false

export function generateStaticParams() {
  return entitySlugs().flatMap((entity) =>
    (getPack(entity)?.projects ?? []).map((p) => ({ entity, project: p.slug })),
  )
}

export function generateMetadata({ params }: { params: { entity: string; project: string } }): Metadata {
  const pack = getPack(params.entity)
  const project = pack?.projects.find((p) => p.slug === params.project)
  if (!pack || !project) return {}
  const og = `/api/og/${params.entity}/project/${params.project}`
  return {
    title: project.name,
    description: `${project.name}: ${money(project.budget)} budget, ${project.percentComplete}% built. See the spending, contractor, and timeline.`,
    openGraph: { images: [og] },
    twitter: { card: 'summary_large_image', images: [og] },
  }
}

export default function ProjectPage({ params }: { params: { entity: string; project: string } }) {
  const pack = getPack(params.entity)!
  const project = pack.projects.find((p) => p.slug === params.project)
  if (!project) notFound()

  const dept = pack.departments.find((d) => d.id === project.departmentId)
  const contracts = projectContracts(project, pack)
  const vendorById = new Map(pack.vendors.map((v) => [v.id, v]))

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge health={projectHealth(project)} />
        <span className="text-sm text-ink2">{dept?.name}</span>
        {project.address && (
          <span className="flex items-center gap-1 text-sm text-muted">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {project.address}
          </span>
        )}
      </div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">{project.name}</h2>
      <p className="mt-2 max-w-2xl text-ink2">{project.description}</p>

      <div className="mt-6 rounded-xl border border-grid bg-surface p-5">
        <BurnBar budget={project.budget} spent={project.spentToDate} />
        <p className="mt-3 text-xs text-muted">
          Started {dateShort(project.startDate)} ·{' '}
          {project.actualCompletion
            ? `completed ${dateShort(project.actualCompletion)}`
            : `expected completion ${dateShort(project.expectedCompletion)}`}
        </p>
      </div>

      <div className="mt-4">
        <ProjectStats project={project} pack={pack} />
      </div>

      {project.fundingSources && project.fundingSources.length > 0 && (
        <section className="mt-8">
          <h3 className="font-semibold">Who&apos;s paying for it</h3>
          <ul className="mt-2 divide-y divide-grid rounded-xl border border-grid bg-surface">
            {project.fundingSources.map((f) => (
              <li key={f.label} className="flex justify-between px-4 py-2.5 text-sm">
                <span>{f.label}</span>
                <span className="tabular font-medium">{moneyFull(f.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {contracts.length > 0 && (
        <section className="mt-8">
          <h3 className="font-semibold">Contracts</h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-grid bg-surface">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-grid text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">Contractor</th>
                  <th className="px-4 py-2.5 font-medium">Work</th>
                  <th className="px-4 py-2.5 font-medium">Awarded</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grid">
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-medium">{vendorById.get(c.vendorId)?.name}</td>
                    <td className="px-4 py-2.5 text-ink2">{c.description}</td>
                    <td className="px-4 py-2.5 text-muted">{dateShort(c.awardedDate)}</td>
                    <td className="tabular px-4 py-2.5 text-right font-medium">{moneyFull(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {project.milestones.length > 0 && (
          <section>
            <h3 className="font-semibold">Timeline</h3>
            <div className="mt-3">
              <MilestoneTimeline milestones={project.milestones} />
            </div>
          </section>
        )}
        {project.updates && project.updates.length > 0 && (
          <section>
            <h3 className="font-semibold">Latest updates</h3>
            <ul className="mt-3 space-y-3">
              {project.updates.map((u) => (
                <li key={u.date} className="rounded-xl border border-grid bg-surface p-4 text-sm">
                  <p className="text-xs font-medium text-muted">{dateShort(u.date)}</p>
                  <p className="mt-1 text-ink2">{u.text}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="mt-10">
        <ShareBar title={`${project.name} — ${pack.entity.name}`} />
      </div>
    </div>
  )
}
