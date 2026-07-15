import { AlertTriangle, CheckCircle2, CircleDot, Clock, TrendingUp } from 'lucide-react'
import type { ProjectHealth } from '@/lib/types'
import { HEALTH_LABEL } from '@/lib/projects'

// Status colors are reserved (never series colors) and always ship with an
// icon + label — color never carries the meaning alone.
const STYLE: Record<ProjectHealth, { cls: string; Icon: typeof CircleDot }> = {
  on_track: { cls: 'bg-good/15 text-gooddark', Icon: CircleDot },
  at_risk: { cls: 'bg-warning/20 text-[#8a5a00]', Icon: AlertTriangle },
  delayed: { cls: 'bg-serious/20 text-[#9a3d12]', Icon: Clock },
  over_budget: { cls: 'bg-critical/15 text-critical', Icon: TrendingUp },
  complete: { cls: 'bg-grid text-ink2', Icon: CheckCircle2 },
}

export function StatusBadge({ health }: { health: ProjectHealth }) {
  const { cls, Icon } = STYLE[health]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {HEALTH_LABEL[health]}
    </span>
  )
}
