export default function MapLoading() {
  return (
    <div className="relative h-full w-full bg-navy-950 overflow-hidden">
      <div className="absolute inset-0 skeleton-shimmer opacity-60" />
      {/* ghost filter pills */}
      <div className="absolute top-3 left-3 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-navy-900/80 border border-navy-800" />
        ))}
      </div>
      {/* ghost timeline bar */}
      <div className="absolute bottom-[80px] md:bottom-4 left-3 right-3 md:left-4 md:right-4 h-16 rounded-2xl bg-navy-950/90 border border-navy-800" />
      <div className="absolute inset-0 grid place-items-center">
        <p className="font-mono text-xs text-faint animate-pulse">loading your fleet…</p>
      </div>
    </div>
  )
}
