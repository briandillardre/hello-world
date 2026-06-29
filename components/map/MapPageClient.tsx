'use client'

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import type { AssetWithLocation, Geofence } from '@/lib/types'
import type { AssetTrack } from '@/lib/trails'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { createGeofenceAction } from '@/lib/actions/geofences'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const MapView = dynamic(
  () => import('@/components/map/MapView').then((m) => ({ default: m.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 h-full bg-navy-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-teal border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-faint font-mono">Loading map…</p>
        </div>
      </div>
    ),
  }
)

interface MapPageClientProps {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  tracks: AssetTrack[]
  toolGateways: Record<string, { name: string; lastSeen: string }>
}

export function MapPageClient({ assets, geofences: initialGeofences, tracks, toolGateways }: MapPageClientProps) {
  const [geofences, setGeofences] = useState<Geofence[]>(initialGeofences)

  // Show the new zone immediately (optimistic), and in real mode persist it to
  // the database so it survives a refresh and appears on every screen.
  const handleGeofenceSave = useCallback((name: string, geometry: GeoJSON.Polygon, color: string) => {
    const fence: Geofence = {
      id: `fence-${Date.now()}`,
      company_id: MOCK_COMPANY.id,
      name,
      geometry,
      color,
      created_at: new Date().toISOString(),
    }
    setGeofences((prev) => [...prev, fence])
    if (!isMock) createGeofenceAction(name, geometry, color)
  }, [])

  return (
    <MapView
      assets={assets}
      geofences={geofences}
      tracks={tracks}
      toolGateways={toolGateways}
      onGeofenceSave={handleGeofenceSave}
    />
  )
}
