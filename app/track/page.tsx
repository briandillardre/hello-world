import type { Metadata } from 'next'
import { TrackerClient } from '@/components/track/TrackerClient'

export const metadata: Metadata = {
  title: 'HammerTrack — Field Tracker',
  description: 'Share a live GPS trail from your phone on the jobsite.',
}

export default function TrackPage() {
  return <TrackerClient />
}
