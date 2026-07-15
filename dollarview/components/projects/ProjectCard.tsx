import Link from 'next/link'
import type { CapitalProject, EntityDataPack } from '@/lib/types'
import { projectHealth } from '@/lib/projects'
import { money } from '@/lib/format'
import { dateShort } from '@/lib/format'
import { BurnBar } from '@/components/charts/BurnBar'
import { StatusBadge } from './StatusBadge'
import { DeptIcon } from '@/components/DeptIcon'
import { slotColor } from '@/lib/palette'

export function ProjectCard({ project, pack }: { project: CapitalProject; pack: EntityDataPack }) {
  const dept = pack.departments.find((d) => d.id === project.departmentId)
  return (
    <Link
      href={`/${pack.entity.slug}/projects/${project.slug}`}
      className="block rounded-xl border border-grid bg-surface p-5 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink2">
          {dept && (
            <>
              <span
                className="flex h-5 w-5 items-center justify-center rounded"
                style={{ backgroundColor: slotColor(dept.colorSlot) }}
                aria-hidden
              >
                <DeptIcon name={dept.icon} className="h-3 w-3 text-white" />
              </span>
              {dept.name}
            </>
          )}
        </div>
        <StatusBadge health={projectHealth(project)} />
      </div>
      <h3 className="mt-2 font-semibold leading-snug">{project.name}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-ink2">{project.description}</p>
      <div className="mt-4">
        <BurnBar budget={project.budget} spent={project.spentToDate} />
      </div>
      <p className="mt-3 text-xs text-muted">
        {money(project.budget)} budget · {project.percentComplete}% built ·{' '}
        {project.actualCompletion ? `finished ${dateShort(project.actualCompletion)}` : `due ${dateShort(project.expectedCompletion)}`}
      </p>
    </Link>
  )
}
