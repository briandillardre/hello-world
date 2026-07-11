import type { Metadata } from 'next'
import { LiveDemoClient } from '@/components/map/LiveDemoClient'

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
