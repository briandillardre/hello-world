import type { CapitalProject, EntityDataPack } from '@/lib/types'
import { costPerResident, scheduleElapsedPct, spentPct } from '@/lib/projects'
import { moneyCents } from '@/lib/format'
import { StatTile } from '@/components/StatTile'

/**
 * The honesty gauge: % physically built vs % of budget spent vs % of schedule
 * elapsed, side by side. When spending runs well ahead of construction, the
 * gap is the story.
 */
export function ProjectStats({ project, pack }: { project: CapitalProject; pack: EntityDataPack }) {
  const built = project.percentComplete
  const spent = spentPct(project)
  const elapsed = Math.min(150, scheduleElapsedPct(project))

  const rows = [
    { label: '% physically built', value: built },
    { label: '% of budget spent', value: spent },
    { label: '% of schedule elapsed', value: elapsed },
  ]
  const gap = spent - built

  return (
    <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
      <div className="rounded-xl border border-grid bg-surface p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Progress check</p>
        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="flex justify-between text-sm">
                <span className="text-ink2">{row.label}</span>
                <span className="tabular font-medium">{row.value.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-grid">
                <div
                  className="h-full rounded-r-full bg-[#2a78d6]"
                  style={{ width: `${Math.min(100, row.value)}%` }}
                  aria-hidden
                />
              </div>
            </div>
          ))}
        </div>
        {project.phase !== 'complete' && Math.abs(gap) > 10 && (
          <p className={`mt-3 text-xs font-medium ${gap > 0 ? 'text-critical' : 'text-gooddark'}`}>
            {gap > 0
              ? `Spending is running ${gap.toFixed(0)} points ahead of construction — worth watching.`
              : `Construction is running ${Math.abs(gap).toFixed(0)} points ahead of spending.`}
          </p>
        )}
      </div>
      <StatTile
        label="Cost per resident"
        value={moneyCents(costPerResident(project, pack))}
        detail={`Total budget ÷ ${pack.entity.population.toLocaleString()} residents`}
      />
    </div>
  )
}
