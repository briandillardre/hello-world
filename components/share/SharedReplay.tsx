'use client'

import dynamic from 'next/dynamic'

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
  loading: () => (
    <div className="fixed inset-0 bg-navy-950 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})

export function SharedReplay(props: SharedReplayProps) {
  return <Inner {...props} />
}
