import { Info } from 'lucide-react'
import type { Entity } from '@/lib/types'

export function DemoBanner({ entity }: { entity: Entity }) {
  if (entity.isDemo) {
    return (
      <div className="border-b border-grid bg-brand/10 px-4 py-2 text-center text-sm text-branddeep">
        <Info className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden />
        {entity.shortName} is a <strong>fictional demo city</strong> — the numbers are invented, the mechanics are real.
      </div>
    )
  }
  if (entity.disclaimer) {
    return (
      <div className="border-b border-grid bg-warning/15 px-4 py-2 text-center text-sm text-ink2">
        <Info className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden />
        {entity.disclaimer}
      </div>
    )
  }
  return null
}
