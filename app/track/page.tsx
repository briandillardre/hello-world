import type { Metadata } from 'next'
import { TrackerClient } from '@/components/track/TrackerClient'

export const metadata: Metadata = {
  title: 'HammerTrack — Field Tracker',
  description: 'Clock in and track your location on the jobsite.',
}

export default function TrackPage() {
  return <TrackerClient />
}
