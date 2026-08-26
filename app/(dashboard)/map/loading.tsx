import { MapSkeleton } from '@/components/ui/loading'

/** /map route skeleton — the same ghost map the dynamic MapView fallback
 *  renders (components/map/MapPageClient.tsx), so the route-transition →
 *  chunk-download handoff is pixel-identical and invisible. */
export default function MapLoading() {
  return <MapSkeleton />
}
