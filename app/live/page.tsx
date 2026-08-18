import type { Metadata, Viewport } from 'next'
import { LiveDemoClient } from '@/components/map/LiveDemoClient'

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
  return <LiveDemoClient />
}
