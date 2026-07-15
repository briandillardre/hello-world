import type { Metadata } from 'next'
import { getPack } from '@/data/registry'
import { projectHealth } from '@/lib/projects'
import { money } from '@/lib/format'
import { ProjectCard } from '@/components/projects/ProjectCard'

export const metadata: Metadata = { title: 'Capital projects' }

const HEALTH_ORDER = { over_budget: 0, delayed: 1, at_risk: 2, on_track: 3, complete: 4 } as const

export default function ProjectsPage({ params }: { params: { entity: string } }) {
  const pack = getPack(params.entity)!
  const projects = [...pack.projects].sort(
    (a, b) => HEALTH_ORDER[projectHealth(a)] - HEALTH_ORDER[projectHealth(b)] || b.budget - a.budget,
  )
  const totalBudgeted = pack.projects.reduce((s, p) => s + p.budget, 0)

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Capital projects</h2>
      <p className="mt-1 text-sm text-ink2">
        {pack.projects.length} projects worth {money(totalBudgeted)} — each with its budget, spending, contractor, and an
        honest status derived from the numbers (projects needing attention sort first).
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} pack={pack} />
        ))}
      </div>
    </div>
  )
}
