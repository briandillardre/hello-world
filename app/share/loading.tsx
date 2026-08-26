import { MapSkeleton } from '@/components/ui/loading'

/** Public replay-link skeleton — same ghost map the replay's dynamic MapLibre
 *  fallback renders, so shared links never open on a blank page. */
export default function ShareLoading() {
  return <MapSkeleton className="fixed inset-0" message="loading the replay…" showPills={false} />
}
