'use client'

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import type { AssetWithLocation, Geofence } from '@/lib/types'
import type { AssetTrack } from '@/lib/trails'
import type { LocationHistoryRow } from '@/lib/db/assets'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { createGeofenceAction } from '@/lib/actions/geofences'
import { setWeatherDefaultAction } from '@/lib/actions/company'

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
  /** Raw location history (real mode). MapView builds per-range datasets from it. */
  historyRows?: LocationHistoryRow[] | null
  earliestMs?: number | null
  tz?: string
  toolGateways: Record<string, { name: string; lastSeen: string }>
  defaultWeatherPlace?: string | null
  canSetWeatherDefault?: boolean
}

export function MapPageClient({ assets, geofences: initialGeofences, tracks, historyRows = null, earliestMs = null, tz = 'America/New_York', toolGateways, defaultWeatherPlace = null, canSetWeatherDefault = false }: MapPageClientProps) {
  const [geofences, setGeofences] = useState<Geofence[]>(initialGeofences)

  // Show the new zone immediately (optimistic), and in real mode persist it to
  // the database so it survives a refresh and appears on every screen.
  const handleGeofenceSave = useCallback(async (name: string, geometry: GeoJSON.Polygon, color: string) => {
    const fence: Geofence = {
      id: `fence-${Date.now()}`,
      company_id: MOCK_COMPANY.id,
      name,
      geometry,
      color,
      created_at: new Date().toISOString(),
    }
    setGeofences((prev) => [...prev, fence])
    if (!isMock) {
      // Await + surface failure — this used to be fire-and-forget, so a failed
      // insert looked saved until the next page load quietly dropped it.
      try {
        const id = await createGeofenceAction(name, geometry, color)
        if (!id) throw new Error('no id returned')
      } catch (err) {
        console.error('Geofence save failed', err)
        setGeofences((prev) => prev.filter((g) => g.id !== fence.id))
        alert(`Zone "${name}" could not be saved to the database. Please try drawing it again.`)
      }
    }
  }, [])

  return (
    <>
      <MapView
        assets={assets}
        geofences={geofences}
        tracks={tracks}
        historyRows={historyRows}
        earliestMs={earliestMs}
        tz={tz}
        toolGateways={toolGateways}
        onGeofenceSave={handleGeofenceSave}
        defaultWeatherPlace={defaultWeatherPlace}
        onSaveWeatherDefault={canSetWeatherDefault ? setWeatherDefaultAction : undefined}
      />
      {!isMock && assets.length === 0 && <GetSetUp hasZones={geofences.length > 0} />}
    </>
  )
}

/** First-run onboarding: a brand-new company lands on an empty map — give them
 *  a path instead of a blank screen. */
function GetSetUp({ hasZones }: { hasZones: boolean }) {
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-16 md:top-20 z-30 w-[92%] max-w-sm rounded-2xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel p-5">
      <p className="font-display font-bold text-ink text-[16px]">Let&apos;s get your fleet on the map</p>
      <ol className="mt-3 space-y-2.5 text-[13.5px]">
        <li className="flex items-start gap-2.5">
          <span className="grid place-items-center w-5 h-5 rounded-full bg-amber/20 text-amber font-display font-bold text-[11px] flex-none mt-0.5">1</span>
          <span className="text-muted">
            <a href="/assets" className="text-amber font-semibold hover:underline">Add your first asset</a>
            {' '}— a truck, machine, or tool, with its tracker ID.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="grid place-items-center w-5 h-5 rounded-full bg-amber/20 text-amber font-display font-bold text-[11px] flex-none mt-0.5">2</span>
          <span className="text-muted">
            {hasZones ? 'Zones drawn ✓ — nice.' : 'Draw a zone around your yard or job site (hexagon button, bottom-left).'}
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="grid place-items-center w-5 h-5 rounded-full bg-amber/20 text-amber font-display font-bold text-[11px] flex-none mt-0.5">3</span>
          <span className="text-muted">
            Plug in your trackers — assets go live the moment they report.
          </span>
        </li>
      </ol>
    </div>
  )
}
