'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'
import type { AssetWithLocation, Geofence } from '@/lib/types'
import type { AssetTrack } from '@/lib/trails'
import type { LocationHistoryRow } from '@/lib/db/assets'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { createGeofenceAction, saveGeofenceAction, deleteGeofenceAction } from '@/lib/actions/zones'
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
  /** Real mode: the page ships WITHOUT history so the map paints fast; this
   *  flag makes the client pull the recent baseline right after mount. */
  deferHistory?: boolean
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
  /** User's saved map views from their profile (null = none / demo). */
  savedMapViews?: { views: unknown[]; defaultId: string | null } | null
  /** Dollar figures (timeline cost chip, $ chart, zone $) are permission-gated. */
  canViewCosts?: boolean
  /** Recent alert events — powers the "Alert pins" layer. */
  alerts?: import('@/lib/types').AlertEvent[]
  /** Saved measurement to draw + fly to (deep link from /measurements). */
  focusMeasurement?: import('@/lib/db/measurements').Measurement | null
  /** Company branding for the Create-PDF button. */
  brand?: { companyName: string; logoUrl: string | null; logoBg?: string | null } | null
  /** Shell-first boot: the page shipped EMPTY and this component pulls the
   *  whole fleet payload from /api/map-data (and re-pulls it as the 20 s
   *  live tick, replacing router.refresh full-page re-renders). */
  bootstrap?: boolean
}

/** /api/map-data payload — the server-batch fields the page used to await. */
interface MapBootData {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  toolGateways: Record<string, { name: string; lastSeen: string }>
  aboard: Record<string, import('@/lib/tools-resolve').AboardTool[]>
  pairingEpisodes: import('@/lib/db/tools').PairingEpisode[]
  alerts: import('@/lib/types').AlertEvent[]
  siteOverlays: { id: string; url: string; coords: [[number, number], [number, number], [number, number], [number, number]]; zoneId: string; takenOn: string; kind?: 'photo' | 'plan' }[]
  earliestMs: number | null
  savedMapViews: { views: unknown[]; defaultId: string | null } | null
  canViewCosts: boolean
}

const BOOT_CACHE_KEY = 'ht_mapboot_v1'

export function MapPageClient({ assets, geofences: initialGeofences, tracks, historyRows = null, deferHistory = false, siteOverlays = [], earliestMs = null, tz = 'America/New_York', toolGateways, aboard, pairingEpisodes, defaultWeatherPlace = null, defaultWeatherCoords = null, canViewCosts = true, savedMapViews = null, alerts = [], focusMeasurement = null, brand = null, bootstrap = false }: MapPageClientProps) {
  const [geofences, setGeofences] = useState<Geofence[]>(initialGeofences)
  const router = useRouter()

  // ── Shell-first boot: last visit's pins from localStorage paint instantly,
  // the real payload replaces them the moment /api/map-data answers, and the
  // same fetch repeats every 20 s as the live tick (visible tab only).
  const [boot, setBoot] = useState<MapBootData | null>(null)
  useEffect(() => {
    if (!bootstrap) return
    try {
      const s = JSON.parse(localStorage.getItem(BOOT_CACHE_KEY) ?? 'null') as
        | { at: number; assets: AssetWithLocation[]; geofences: Geofence[] } | null
      if (s && Date.now() - s.at < 86_400_000 && Array.isArray(s.assets)) {
        setBoot((b) => b ?? {
          assets: s.assets, geofences: s.geofences ?? [],
          toolGateways: {}, aboard: {}, pairingEpisodes: [], alerts: [],
          siteOverlays: [], earliestMs: null, savedMapViews: null, canViewCosts: false,
        })
        setGeofences((prev) => (prev.length ? prev : s.geofences ?? []))
      }
    } catch { /* fresh device */ }
    let cancelled = false
    const load = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/map-data')
        .then((r) => (r.ok ? r.json() : null))
        .then((j: MapBootData | null) => {
          if (cancelled || !j || !Array.isArray(j.assets)) return
          setBoot(j)
          // Keep optimistic just-drawn zones (temp fence-* ids) on top.
          setGeofences((prev) => [...j.geofences, ...prev.filter((g) => g.id.startsWith('fence-'))])
          try {
            localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({
              at: Date.now(), assets: j.assets.slice(0, 400), geofences: j.geofences,
            }))
          } catch { /* storage full — reopen just won't pre-paint */ }
        })
        .catch(() => { /* offline — cached pins stay up */ })
    }
    load()
    const iv = setInterval(load, 20_000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [bootstrap])

  // Effective data: boot payload in shell-first mode, server props otherwise.
  const effAssets = bootstrap ? (boot?.assets ?? []) : assets
  const effToolGateways = bootstrap ? (boot?.toolGateways ?? {}) : toolGateways
  const effAboard = bootstrap ? (boot?.aboard ?? {}) : aboard
  const effPairing = bootstrap ? (boot?.pairingEpisodes ?? []) : pairingEpisodes
  const effAlerts = bootstrap ? (boot?.alerts ?? []) : alerts
  const effSiteOverlays = bootstrap ? (boot?.siteOverlays ?? []) : siteOverlays
  const effEarliestMs = bootstrap ? (boot?.earliestMs ?? null) : earliestMs
  const effSavedViews = bootstrap ? (boot?.savedMapViews ?? null) : savedMapViews
  const effCanViewCosts = bootstrap ? (boot?.canViewCosts ?? false) : canViewCosts

  // Deferred history baseline: the server no longer blocks first paint on the
  // GPS-history sweep. Pull the last 2 days here (feeds Live/Today trails);
  // every longer range fetches its exact window on demand already, behind the
  // timeline's loading bar. Refreshed every 3 min so live trails keep growing.
  const [baselineRows, setBaselineRows] = useState<LocationHistoryRow[] | null>(null)
  useEffect(() => {
    if (!deferHistory) return
    let cancelled = false
    const load = () => {
      if (document.visibilityState !== 'visible') return
      const from = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const to = new Date().toISOString()
      fetch(`/api/history?from=${from}&to=${to}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!cancelled && j && Array.isArray(j.rows)) setBaselineRows(j.rows)
        })
        .catch(() => { /* offline — dots still render, ranges self-fetch */ })
    }
    load()
    const iv = setInterval(load, 3 * 60_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [deferHistory])
  const effectiveHistory = deferHistory ? (baselineRows ?? historyRows) : historyRows

  // Keep the fleet map live: re-pull server data on an interval so trackers (and
  // a teammate's shared phone) visibly move without a manual refresh. The map
  // page reads cookies → renders dynamically, so router.refresh() refetches
  // fresh positions; MapView stays mounted (zoom/follow/timeline preserved) and
  // just receives new asset props. Paused while the tab is hidden.
  useEffect(() => {
    // Bootstrap mode ticks via /api/map-data above — a JSON hop instead of
    // re-rendering the whole server page every 20 s.
    if (isMock || bootstrap) return
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
        // Swap the optimistic temp id for the database's real one — until
        // this lands, "See full details" would 404 (the id only refreshed on
        // the next full page load before, Aug 6).
        setGeofences((prev) => prev.map((g) => (g.id === fence.id ? { ...g, id } : g)))
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
        assets={effAssets}
        geofences={geofences}
        tracks={tracks}
        historyRows={effectiveHistory}
        siteOverlays={effSiteOverlays}
        earliestMs={effEarliestMs}
        tz={tz}
        toolGateways={effToolGateways}
        aboard={effAboard}
        pairingEpisodes={effPairing}
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
        savedMapViews={effSavedViews as import('@/lib/map-views').MapViewsState | null}
        onSaveMapViews={isMock ? undefined : saveMapViewsAction}
        canViewCosts={effCanViewCosts}
        alerts={effAlerts}
        focusMeasurement={focusMeasurement}
      />
      {/* Boot pill: only on a true first visit (no cached snapshot yet). */}
      {bootstrap && !boot && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-navy-950/90 border border-navy-700 px-3.5 py-1.5">
          <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
          <span className="font-mono text-[11.5px] text-muted">Loading your fleet…</span>
        </div>
      )}
      {!isMock && effAssets.length === 0 && (!bootstrap || boot !== null) && <GetSetUp hasZones={geofences.length > 0} />}
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
