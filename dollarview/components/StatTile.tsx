import { cn } from '@/lib/utils'

export function StatTile({
  label,
  value,
  detail,
  className,
}: {
  label: string
  value: React.ReactNode
  detail?: string
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-grid bg-surface p-4', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink2">{detail}</p>}
    </div>
  )
}
