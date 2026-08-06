/**
 * Zones + zone-detail skeleton — the branded sweep bar the moment a zone is
 * tapped ("takes a while to load, needs a loading bar" — Aug 6), then layout
 * ghosts while the server assembles usage/weather/hub/imagery.
 */
export default function ZonesLoading() {
  return (
    <div className="h-full overflow-hidden">
      <div className="h-[3px] bg-navy-800 overflow-hidden">
        <div className="h-full w-1/3 rounded-full bg-teal/80 animate-tl-sweep" />
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl skeleton-shimmer" />
          <div className="h-7 w-52 rounded-lg skeleton-shimmer" />
          <div className="h-9 w-28 rounded-lg skeleton-shimmer ml-auto" />
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
    </div>
  )
}
