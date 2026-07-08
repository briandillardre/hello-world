/**
 * Branded skeleton for every dashboard route transition — a shimmering layout
 * ghost instead of a blank flash while server components fetch.
 */
export default function DashboardLoading() {
  return (
    <div className="h-full overflow-hidden p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-7 w-40 rounded-lg skeleton-shimmer" />
        <div className="h-5 w-20 rounded-full skeleton-shimmer ml-auto" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl skeleton-shimmer" />
        ))}
      </div>
      <div className="space-y-3 max-w-2xl">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl skeleton-shimmer" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    </div>
  )
}
