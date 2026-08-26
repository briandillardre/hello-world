import { FullPageLoading, SkeletonBlock } from '@/components/ui/loading'

/**
 * Instant skeleton for /reports — range clicks and cold opens paint this
 * immediately while the scorecard computes, so a heavy window never reads
 * as a frozen page (Aug 10). Mirrors the page's real layout: range pills,
 * stat band, vehicle cards — now built from the shared loading kit so the
 * shimmer + sweep match every other route.
 */
export default function ReportsLoading() {
  return (
    <FullPageLoading>
      <div className="h-full overflow-hidden pb-[54px] md:pb-0">
        <div className="p-4 border-b border-navy-800 bg-navy-950/95 sticky top-0 flex items-center gap-3">
          <SkeletonBlock className="h-6 w-28 rounded-md" />
          <div className="flex gap-1 ml-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonBlock key={i} className="h-6 w-16 rounded-full border border-navy-800" />
            ))}
          </div>
        </div>
        <div className="p-4 space-y-4 max-w-2xl lg:max-w-6xl">
          <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
            <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            Crunching the fleet&apos;s GPS stream…
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonBlock key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} className="h-44 rounded-2xl" style={{ opacity: 1 - i * 0.2 }} />
          ))}
        </div>
      </div>
    </FullPageLoading>
  )
}
