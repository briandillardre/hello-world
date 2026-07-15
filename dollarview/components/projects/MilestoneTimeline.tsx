import { Check } from 'lucide-react'
import type { ProjectMilestone } from '@/lib/types'
import { dateShort } from '@/lib/format'

export function MilestoneTimeline({ milestones }: { milestones: ProjectMilestone[] }) {
  if (milestones.length === 0) return null
  return (
    <ol className="relative space-y-5 border-l-2 border-grid pl-5">
      {milestones.map((m) => (
        <li key={m.id} className="relative">
          <span
            className={`absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface ${
              m.done ? 'bg-good' : 'bg-baseline'
            }`}
            aria-hidden
          >
            {m.done && <Check className="h-2.5 w-2.5 text-white" />}
          </span>
          <p className={`text-sm ${m.done ? 'font-medium' : 'text-ink2'}`}>{m.label}</p>
          <p className="text-xs text-muted">
            {dateShort(m.date)}
            {!m.done && ' (planned)'}
          </p>
        </li>
      ))}
    </ol>
  )
}
