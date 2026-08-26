import { MapSkeleton } from '@/components/ui/loading'

/** /command route skeleton — same ghost map the CommandCenter's dynamic
 *  MapView fallback renders, so the wall display never flashes blank. */
export default function CommandLoading() {
  return <MapSkeleton className="h-[100dvh]" message="loading the command wall…" showPills={false} showTimeline={false} />
}
