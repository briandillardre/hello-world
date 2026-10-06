import { FullPageLoading, SkeletonBlock } from '@/components/ui/loading'

/** Instant skeleton for /reports/safety — the period pills, the fleet card,
 *  the vehicles table — while the scores are summed. */
export default function SafetyLoading() {
  return (
    <FullPageLoading>
      <div className="h-full overflow-hidden pb-[54px] md:pb-0">
        <div className="p-4 border-b border-navy-800 bg-navy-950/95 sticky top-0 flex items-center gap-3">
          <SkeletonBlock className="h-6 w-32 rounded-md" />
          <div className="flex gap-1 ml-2">
            {[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-6 w-16 rounded-full border border-navy-800" />)}
          </div>
        </div>
        <div className="p-4 space-y-4 max-w-2xl lg:max-w-6xl">
          <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
            <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            Adding up the driving…
          </div>
          <SkeletonBlock className="h-40 rounded-2xl" />
          {[0, 1].map((i) => <SkeletonBlock key={i} className="h-44 rounded-2xl" style={{ opacity: 1 - i * 0.25 }} />)}
        </div>
      </div>
    </FullPageLoading>
  )
}
