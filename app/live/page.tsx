import type { Metadata, Viewport } from 'next'
import { LiveDemoClient } from '@/components/map/LiveDemoClient'
import { MapSkeleton } from '@/components/ui/loading'

// Map surface: page zoom off so pinch gestures belong to the map engine
// (the root layout allows pinch-zoom everywhere else).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false }

export const metadata: Metadata = {
  title: 'HammerTrack — Live demo map',
  description:
    'Explore the real HammerTrack map with a simulated construction fleet — trucks, equipment, crews, and Bluetooth-tagged tools. No signup required.',
  robots: { index: true },
}

/** Public, no-login, fully explorable demo. The seeded fleet lives entirely
 *  in the browser — visitors can zoom, replay the day, follow a truck, and
 *  tap zones without creating an account. */
export default function LiveDemoPage() {
  return (
    <div className="relative h-[100dvh] bg-navy-950 overflow-hidden">
      {/* Server-rendered branded map skeleton — first paint shows the ghost
          sidebar pills + timeline bar instantly; the client shell (opaque
          navy) covers it the moment it renders on top. */}
      <div aria-hidden className="absolute inset-0">
        <MapSkeleton message="loading the live fleet…" />
      </div>
      <div className="relative h-full">
        <LiveDemoClient />
      </div>
    </div>
  )
}
