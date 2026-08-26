import { FullPageLoading } from '@/components/ui/loading'

/** /track route skeleton — branded sweep + ghosts instead of a blank flash. */
export default function TrackLoading() {
  return (
    <div className="min-h-[100dvh] bg-navy-950">
      <FullPageLoading />
    </div>
  )
}
