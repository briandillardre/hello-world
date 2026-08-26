import { FullPageLoading, SkeletonBlock } from '@/components/ui/loading'

/**
 * Zones + zone-detail skeleton — the branded sweep bar the moment a zone is
 * tapped ("takes a while to load, needs a loading bar" — Aug 6), then layout
 * ghosts while the server assembles usage/weather/hub/imagery. Composed from
 * the shared loading kit.
 */
export default function ZonesLoading() {
  return (
    <FullPageLoading>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <SkeletonBlock className="w-12 h-12 rounded-xl" />
          <SkeletonBlock className="h-7 w-52 rounded-lg" />
          <SkeletonBlock className="h-9 w-28 rounded-lg ml-auto" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="space-y-3 max-w-2xl">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-16 rounded-xl" style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </div>
      </div>
    </FullPageLoading>
  )
}
