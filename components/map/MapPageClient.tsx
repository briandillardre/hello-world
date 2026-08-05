'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'
import type { AssetWithLocation, Geofence } from '@/lib/types'
import type { AssetTrack } from '@/lib/trails'
import type { LocationHistoryRow } from '@/lib/db/assets'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { createGeofenceAction, saveGeofenceAction, deleteGeofenceAction } from '@/lib/actions/geofences'
import { setWeatherDefaultAction } from '@/lib/actions/company'
import { saveMapViewsAction } from '@/lib/actions/profile'

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
  /** Placed drone/site imagery (latest per zone) for the 'Site imagery' layer. */
  siteOverlays?: { id: string; url: string; coords: [[number, number], [number, number], [number, number], [number, number]]; zoneId: string; takenOn: string; kind?: 'photo' | 'plan' }[]
  earliestMs?: number | null
  tz?: string
  toolGateways: Record<string, { name: string; lastSeen: string }>
  /** Gateway asset id → tools riding with it (badge + on-board list). */
  aboard?: Record<string, import('@/lib/tools-resolve').AboardTool[]>
  /** Tool-pairing episodes over the history window (replay-accurate badges). */
  pairingEpisodes?: import('@/lib/db/tools').PairingEpisode[]
  defaultWeatherPlace?: string | null
  defaultWeatherCoords?: { lat: number; lng: number } | null
  canSetWeatherDefault?: boolean
  /** User's saved map views from their profile (null = none / demo). */
  savedMapViews?: { views: unknown[]; defaultId: string | null } | null
  /** Dollar figures (timeline cost chip, $ chart, zone $) are permission-gated. */
  canViewCosts?: boolean
  /** Recent alert events — powers the "Alert pins" layer. */
  alerts?: import('@/lib/types').AlertEvent[]
  /** Saved measurement to draw + fly to (deep link from /measurements). */
  focusMeasurement?: import('@/lib/db/measurements').Measurement | null
  /** Company branding for the Create-PDF button. */
  brand?: { companyName: string; logoUrl: string | null } | null
}

export function MapPageClient({ assets, geofences: initialGeofences, tracks, historyRows = null, siteOverlays = [], earliestMs = null, tz = 'America/New_York', toolGateways, aboard, pairingEpisodes, defaultWeatherPlace = null, defaultWeatherCoords = null, canSetWeatherDefault = false, canViewCosts = true, savedMapViews = null, alerts = [], focusMeasurement = null, brand = null }: MapPageClientProps) {
  const [geofences, setGeofences] = useState<Geofence[]>(initialGeofences)
  const router = useRouter()

  // Keep the fleet map live: re-pull server data on an interval so trackers (and
  // a teammate's shared phone) visibly move without a manual refresh. The map
  // page reads cookies → renders dynamically, so router.refresh() refetches
  // fresh positions; MapView stays mounted (zoom/follow/timeline preserved) and
  // just receives new asset props. Paused while the tab is hidden.
  useEffect(() => {
    if (isMock) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => router.refresh(), 20_000) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop())
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [router])

  // Show the new zone immediately (optimistic), and in real mode persist it to
  // the database so it survives a refresh and appears on every screen.
  const handleGeofenceSave = useCallback(async (name: string, geometry: GeoJSON.Polygon, color: string, kind: 'site' | 'boundary' | 'yard' | 'vendor' = 'site', opts?: import('@/lib/types').ZoneFormOpts) => {
    const fence: Geofence = {
      id: `fence-${Date.now()}`,
      company_id: MOCK_COMPANY.id,
      name,
      geometry,
      color,
      kind,
      owner_id: opts?.personal ? 'me' : null,
      parent_id: opts?.parentId ?? null,
      active_from: opts?.active_from ?? null,
      active_until: opts?.active_until ?? null,
      notes: opts?.notes ?? null,
      created_at: new Date().toISOString(),
    }
    setGeofences((prev) => [...prev, fence])
    if (!isMock) {
      // Await + surface failure — this used to be fire-and-forget, so a failed
      // insert looked saved until the next page load quietly dropped it.
      try {
        // Pass the whole opts bag straight through — the add dialog now
        // collects every field the zone-edit page does, and dropping any of
        // them here is exactly how the two forms drifted apart before.
        const id = await createGeofenceAction(name, geometry, color, kind, opts)
        if (!id) throw new Error('no id returned')
      } catch (err) {
        console.error('Geofence save failed', err)
        setGeofences((prev) => prev.filter((g) => g.id !== fence.id))
        alert(`Zone "${name}" could not be saved to the database. Please try drawing it again.`)
      }
    }
  }, [])

  // Rename / recolor a zone from its map sheet — optimistic, persisted in real
  // mode (demo just updates locally, which is enough to feel real).
  const handleGeofenceEdit = useCallback(async (id: string, name: string, color: string) => {
    const existing = geofences.find((g) => g.id === id)
    setGeofences((prev) => prev.map((g) => (g.id === id ? { ...g, name, color } : g)))
    if (!isMock) {
      try {
        await saveGeofenceAction(id, name, color, existing?.parent_id ?? null)
      } catch (err) {
        console.error('Zone edit failed', err)
        if (existing) setGeofences((prev) => prev.map((g) => (g.id === id ? existing : g)))
        alert('That zone change could not be saved. Please try again.')
      }
    }
  }, [geofences])

  const handleGeofenceDelete = useCallback(async (id: string) => {
    const snapshot = geofences
    setGeofences((prev) => prev.filter((g) => g.id !== id))
    if (!isMock) {
      try {
        await deleteGeofenceAction(id)
      } catch (err) {
        console.error('Zone delete failed', err)
        setGeofences(snapshot)
        alert('That zone could not be deleted. Please try again.')
      }
    }
  }, [geofences])

  return (
    <>
      <MapView
        brand={brand}
        assets={assets}
        geofences={geofences}
        tracks={tracks}
        historyRows={historyRows}
        siteOverlays={siteOverlays}
        earliestMs={earliestMs}
        tz={tz}
        toolGateways={toolGateways}
        aboard={aboard}
        pairingEpisodes={pairingEpisodes}
        askSlot={
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('ht:ask'))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber text-[#1a1100] font-display font-bold text-[13px] px-3 py-2 shadow-glow-amber hover:brightness-110 transition"
          >
            <Sparkles className="h-4 w-4" /> AskAI
          </button>
        }
        onGeofenceSave={handleGeofenceSave}
        onGeofenceEdit={handleGeofenceEdit}
        onGeofenceDelete={handleGeofenceDelete}
        defaultWeatherPlace={defaultWeatherPlace}
        defaultWeatherCoords={defaultWeatherCoords}
        onSaveWeatherDefault={canSetWeatherDefault ? setWeatherDefaultAction : undefined}
        savedMapViews={savedMapViews as import('@/lib/map-views').MapViewsState | null}
        onSaveMapViews={isMock ? undefined : saveMapViewsAction}
        canViewCosts={canViewCosts}
        alerts={alerts}
        focusMeasurement={focusMeasurement}
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
