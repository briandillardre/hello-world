import { TagScanner } from '@/components/tools/TagScanner'

export const metadata = { title: 'HammerTrack — Tag scanner' }

/**
 * Commission BLE tool tags from the phone: scan, read the identity, paste it
 * onto a tool asset. Native-only by nature — the component explains that on
 * the web rather than offering a button that can't work.
 */
export default function TagsPage() {
  return (
    <div className="h-full overflow-auto pb-28 md:pb-10">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <h1 className="text-xl font-bold text-ink">Tag scanner</h1>
        <p className="text-xs text-faint mt-0.5">
          Find nearby BLE tool tags and copy their ID onto an asset.
        </p>
      </div>
      <div className="p-4 max-w-xl">
        <TagScanner />
      </div>
    </div>
  )
}
