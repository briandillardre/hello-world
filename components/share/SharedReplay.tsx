'use client'

import dynamic from 'next/dynamic'
import { MapSkeleton } from '@/components/ui/loading'

export interface SharePoint { lat: number; lng: number; ms: number; mph?: number | null }

export interface SharedReplayProps {
  name: string
  points: SharePoint[]
  fromMs: number
  toMs: number
  startT: number
}

// MapLibre needs a window — same ssr:false dance as the dashboard map.
const Inner = dynamic(() => import('./SharedReplayInner').then((m) => ({ default: m.SharedReplayInner })), {
  ssr: false,
  // Kit ghost map — replay links open on the branded skeleton, not a spinner.
  loading: () => (
    <MapSkeleton className="fixed inset-0" message="loading the replay…" showPills={false} />
  ),
})

export function SharedReplay(props: SharedReplayProps) {
  return <Inner {...props} />
}
