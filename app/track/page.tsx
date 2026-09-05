import type { Metadata } from 'next'
import { requireFeature } from '@/lib/permissions-server'
import { TrackerClient } from '@/components/track/TrackerClient'

export const metadata: Metadata = {
  title: 'HammerTrack — Field Tracker',
  description: 'Share a live GPS trail from your phone on the jobsite.',
}

export default async function TrackPage() {
  await requireFeature('track')
  return <TrackerClient />
}
