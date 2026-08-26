import { FullPageLoading } from '@/components/ui/loading'

/** /join (team invite) route skeleton — branded sweep + ghosts, no blank flash. */
export default function JoinLoading() {
  return (
    <div className="min-h-[100dvh] bg-navy-950">
      <FullPageLoading />
    </div>
  )
}
