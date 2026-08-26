import { cn } from '@/lib/utils'

/**
 * The ONE branded loading language (owner ask, Aug 25: "almost always snappy"
 * + a single consistent loading view). Every skeleton in the app composes
 * from these pieces — the thin teal `animate-tl-sweep` progress bar plus navy
 * `skeleton-shimmer` ghosts (keyframes live in app/globals.css). No bare
 * spinners, no off-brand animate-pulse grays anywhere else.
 *
 * Server-safe: no hooks, no state — import from server components, client
 * components, and route-level loading.tsx files alike.
 */

/** Thin indeterminate teal sweep — the timeline's "still downloading" bar.
 *  Default is the in-card h-1 pill; pass className to reshape (e.g. the
 *  route-level `h-[3px] rounded-none` page-top strip). */
export function SweepBar({ className }: { className?: string }) {
  return (
    <div className={cn('relative h-1 overflow-hidden rounded-full bg-navy-800', className)}>
      <div className="absolute inset-y-0 w-1/3 rounded-full bg-teal/70 animate-tl-sweep" />
    </div>
  )
}

/** Navy shimmer ghost block — size/shape entirely via className. */
export function SkeletonBlock({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton-shimmer rounded', className)} style={style} />
}

/** Generic section placeholder: label + thin indeterminate sweep, so it's
 *  always obvious something is still on its way (Brian, Aug 24: "always show
 *  progress bar or something for loading items"). Lifted verbatim from the
 *  asset detail page — same markup, now shared. */
export function SectionLoading({ label }: { label: string }) {
  return (
    <section aria-busy="true">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">{label}</h2>
      <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
        <SweepBar />
        <SkeletonBlock className="h-3.5 w-2/3" />
        <SkeletonBlock className="h-3.5 w-1/2" />
      </div>
    </section>
  )
}

/** Route-level composition: the page-top teal sweep + a shimmering layout
 *  ghost (header row, stat tiles, fading list). Pass children to swap the
 *  default body for a route-specific ghost layout under the same sweep. */
export function FullPageLoading({ children }: { children?: React.ReactNode }) {
  return (
    <div className="h-full overflow-hidden" aria-busy="true">
      {/* Same thin teal sweep as the map timeline + layers panel — one
          loading language everywhere (owner ask, Aug 5). */}
      <SweepBar className="h-[3px] rounded-none" />
      {children ?? (
        <div className="h-full overflow-hidden p-4 space-y-4">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-7 w-40 rounded-lg" />
            <SkeletonBlock className="h-5 w-20 rounded-full ml-auto" />
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
      )}
    </div>
  )
}

/** Ghost map — the map surface's skeleton: full-bleed shimmer, ghost filter
 *  pills, ghost timeline bar, centered status line. Used by /map's route
 *  loading AND every dynamic MapView fallback so the route-skeleton → chunk-
 *  loading handoff is invisible (same pixels, no double transition). */
export function MapSkeleton({
  message = 'loading your fleet…',
  showPills = true,
  showTimeline = true,
  className,
}: {
  message?: string
  showPills?: boolean
  showTimeline?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative h-full w-full bg-navy-950 overflow-hidden', className)} aria-busy="true">
      {/* Same thin teal sweep as the timeline + layers panel loading bars. */}
      <div className="absolute top-0 inset-x-0 z-10">
        <SweepBar className="h-[3px] rounded-none" />
      </div>
      <div className="absolute inset-0 skeleton-shimmer opacity-60" />
      {showPills && (
        <div className="absolute top-3 left-3 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-24 rounded-full bg-navy-900/80 border border-navy-800" />
          ))}
        </div>
      )}
      {showTimeline && (
        <div className="absolute bottom-[80px] md:bottom-4 left-3 right-3 md:left-4 md:right-4 h-16 rounded-2xl bg-navy-950/90 border border-navy-800" />
      )}
      <div className="absolute inset-0 grid place-items-center">
        <p className="font-mono text-xs text-faint animate-pulse">{message}</p>
      </div>
    </div>
  )
}
