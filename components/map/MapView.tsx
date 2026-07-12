'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AssetWithLocation, AssetType, Geofence } from '@/lib/types'
import { DEMO_MAP_CENTER, DEMO_MAP_ZOOM } from '@/lib/mock-data'
import {
  type AssetTrack, type TimeRange, type TrailMode, positionAt, trailSegmentsUpTo,
  defaultSpeedForWindow, tracksFromHistory, rangeWindowSeconds,
} from '@/lib/trails'
import { rangeWindow } from '@/lib/dates'
import {
  type Conditions, type IemFrame,
  fetchConditions, buildRadarFrames, iemRadarUrl, iemTsForMs,
  PRECIP_PERIODS, iemPrecipUrl,
} from '@/lib/weather'
import { fetchPws, type PwsConditions } from '@/lib/pws'
import { buildActivityCurve, firstMovementT, deltas } from '@/lib/activity'
import { PROJECTS, periodCost, RANGE_COST_LABEL } from '@/lib/projects'
import { PARCEL_SERVICE_URL, PARCEL_MIN_ZOOM, PARCEL_LABEL_MIN_ZOOM, fetchParcels } from '@/lib/parcels'
import { zoneCostAt, buildCostCurve, zoneCostsFromHistory } from '@/lib/costs'
import { MAP_OVERLAYS } from '@/lib/overlays'
import { nightPolygon } from '@/lib/terminator'
import { startWindParticles, type WindField } from '@/lib/wind-particles'
import { allViews, loadLocalViews, saveLocalViews, type MapViewsState, type SavedMapView } from '@/lib/map-views'
import { hexHeatGeoJSON } from '@/lib/heat3d'
import { MOCK_SITE_DEVICES, DEVICE_META, type SiteDevice } from '@/lib/site-devices'
import { geofencePresence } from '@/lib/site-presence'
import { AssetPanel } from './AssetPanel'
import { MapSearch, type SearchItem } from './MapSearch'
import { formatRelativeTime } from '@/lib/utils'
import { DevicePanel } from './DevicePanel'
import { ZonePanel } from './ZonePanel'
import { FilterBar } from './FilterBar'
import { GeofenceDrawer } from './GeofenceDrawer'
import { TimelinePlayback } from './TimelinePlayback'
import { WeatherControl, type BaseStyle } from './WeatherControl'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Demo mode renders the mock Site-IoT devices (cameras, fuel, generators…).
// Real accounts must never see them: they're fake pins at the demo site, and
// including them in fit-to-content dragged the camera toward Tennessee.
// Zone kind with legacy fallback: pre-013 rows had no kind column, and the
// old convention was "near-black/gray = outline-only boundary".
const fenceKind = (g: { kind?: string | null; color: string }) =>
  g.kind ?? (g.color === '#0a0a0a' || g.color === '#9ca3af' ? 'boundary' : 'site')

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const SITE_DEVICES = isMock ? MOCK_SITE_DEVICES : []

const ASSET_COLORS: Record<AssetType, string> = {
  vehicle: '#ff9e16',
  equipment: '#60a5fa',
  personnel: '#34d399',
  tool: '#a78bfa',
}

// MapLibre layers that represent the live (non-playback) asset view
const LIVE_LAYERS = ['clusters', 'cluster-count', 'asset-pulse', 'unclustered-circle', 'unclustered-label', 'unclustered-name']
const HEAD_LAYERS = ['trail-heads', 'trail-head-labels']

// ── Cinematic camera-follow tuning ──────────────────────────────────────────
export type FollowMode = 'orbit' | 'overhead' | 'chase'
const FOLLOW_ZOOM = 16.2     // zoom the entrance reveal settles at
const ORBIT_STEP = 0.14      // deg/frame the camera revolves in Orbit mode
const HEADING_LERP = 0.06    // how fast bearing swings toward travel dir (Chase)
const MOVE_EPS = 2e-5        // deg of travel below which the asset counts as parked
const FOLLOW_PITCH: Record<FollowMode, number> = { orbit: 60, overhead: 8, chase: 58 }

// Compass bearing (deg) from point a to point b.
function bearingBetween(a: [number, number], b: [number, number]): number {
  const φ1 = (a[1] * Math.PI) / 180
  const φ2 = (b[1] * Math.PI) / 180
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

// Interpolate between two bearings along the SHORT arc (handles 359°→1° wrap).
function lerpAngle(from: number, to: number, f: number): number {
  const diff = (((to - from) % 360) + 540) % 360 - 180
  return (from + diff * f + 360) % 360
}

function buildGeoJSON(assets: AssetWithLocation[], filter: Set<AssetType>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: assets
      .filter((a) => filter.has(a.type) && a.location)
      .map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.location!.lng, a.location!.lat] },
        properties: {
          id: a.id, name: a.name, type: a.type, color: ASSET_COLORS[a.type],
          battery: a.location!.battery, speed: a.location!.speed, timestamp: a.location!.timestamp,
          // Three glance-states: moving (fresh fix + speed), idle (device awake
          // and reporting — trackers sleep minutes after ignition-off, so fresh
          // data ≈ powered up), off (stale — asleep/parked).
          state: (() => {
            const age = Date.now() - new Date(a.location!.timestamp).getTime()
            if (age < 15 * 60_000 && (a.location!.speed ?? 0) > 2) return 'moving'
            return age < 15 * 60_000 ? 'idle' : 'off'
          })(),
        },
      })),
  }
}

// selId marks the selected asset's features (sel) and everyone else's (dim)
// so the paint expressions can spotlight one track without touching layers.
function trailsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number, selId?: string | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((tr) => filter.has(tr.type))
      .map((tr) => ({
        type: 'Feature' as const,
        // MultiLineString: segments break at data gaps (device asleep) so the
        // trail never draws a straight chord across town.
        geometry: { type: 'MultiLineString' as const, coordinates: trailSegmentsUpTo(tr, t) },
        properties: { id: tr.assetId, color: tr.color, sel: selId === tr.assetId ? 1 : 0, dim: selId && selId !== tr.assetId ? 1 : 0 },
      })),
  }
}

function pointsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number, selId?: string | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const tr of tracks) {
    if (!filter.has(tr.type)) continue
    const sel = selId === tr.assetId ? 1 : 0
    for (const p of tr.points) {
      if (p.t > t) break
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { sel } })
    }
  }
  return { type: 'FeatureCollection', features }
}

function headsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number, selId?: string | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((tr) => filter.has(tr.type))
      .map((tr) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: positionAt(tr, t) },
        properties: { id: tr.assetId, name: tr.name, color: tr.color, sel: selId === tr.assetId ? 1 : 0 },
      })),
  }
}

// Build label anchor points at the TOP edge of each geofence so the zone name
// floats above the busy interior instead of being covered by clustered pins.
function geofenceLabelPoints(geofences: Geofence[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geofences.map((g) => {
      const ring = g.geometry.coordinates[0] as [number, number][]
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
      const area = (maxLng - minLng) * (maxLat - minLat)
      // Short display name: the part before the first "-"/","/"(" — "Shop -
      // Nate's House Easley, SC" labels as "Shop" until you zoom in close.
      const head = g.name.split(/[-–—,(]/)[0].trim() || g.name
      const short = head.length > 18 ? head.slice(0, 17).trimEnd() + '…' : head
      // smaller sort key = placed first = wins collisions, so bigger zones win
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [(minLng + maxLng) / 2, maxLat] }, properties: { name: g.name, short, color: g.color, pri: -area } }
    }),
  }
}

interface MapViewProps {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  /** Synthetic demo tracks (demo mode only). Real mode uses historyRows. */
  tracks?: AssetTrack[]
  /** Raw location history (real mode). Per-range tracks/cost/zones built here. */
  historyRows?: import('@/lib/db/assets').LocationHistoryRow[] | null
  /** First-ever fix (ms), for the "All time" window. */
  earliestMs?: number | null
  /** Viewer IANA timezone for local-calendar-day range windows. */
  tz?: string
  toolGateways?: Record<string, { name: string; lastSeen: string }>
  onGeofenceSave?: (name: string, geometry: GeoJSON.Polygon, color: string, kind: 'site' | 'boundary' | 'yard') => void
  /** Rename/recolor a zone from its map sheet (optimistic + persisted). */
  onGeofenceEdit?: (id: string, name: string, color: string) => void
  /** Delete a zone from its map sheet. */
  onGeofenceDelete?: (id: string) => void
  kiosk?: boolean
  /** Kiosk auto-tour (asset → asset camera glide). Off = the wall stays put. */
  tourOn?: boolean
  /** Fired when a manual drag interrupts the tour, so the owner of the toggle
   *  can flip it off visibly instead of the tour just silently dying. */
  onTourInterrupt?: () => void
  /** Company-wide default weather location (admin-set); null = follow the fleet. */
  defaultWeatherPlace?: string | null
  /** Exact coords for the company default — set by newer star-saves. When
   *  present they win everywhere (no re-geocode, no per-device drift). */
  defaultWeatherCoords?: { lat: number; lng: number } | null
  /** Show the admin-only "save as company default" control in the weather panel. */
  onSaveWeatherDefault?: (place: string, lat?: number, lng?: number) => Promise<boolean | void>
  /** False hides every dollar figure (timeline chip, $ chart mode, zone $). */
  canViewCosts?: boolean
  /** User's saved map views from their profile (DB copy wins over device). */
  savedMapViews?: MapViewsState | null
  /** Persist saved views to the user's profile (absent in demo mode). */
  onSaveMapViews?: (s: MapViewsState) => void
}

export function MapView({ assets, geofences, tracks = [], historyRows = null, earliestMs = null, tz = 'America/New_York', toolGateways, onGeofenceSave, onGeofenceEdit, onGeofenceDelete, kiosk = false, tourOn = true, onTourInterrupt, defaultWeatherPlace = null, defaultWeatherCoords = null, onSaveWeatherDefault, canViewCosts = true, savedMapViews = null, onSaveMapViews }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  // Flipped once the style + custom layers exist, so mutation effects that fired
  // too early re-apply instead of silently dropping the change.
  const [mapReady, setMapReady] = useState(false)
  // One selection at a time — asset, zone, or device — all shown in the shared
  // MapSheet (bottom sheet on mobile, right panel on desktop). Zone/device used
  // to be tiny anchored map popups; now every tap opens the same surface.
  const [selectedAsset, setSelectedAsset] = useState<AssetWithLocation | null>(null)
  // Isolate: show ONLY this asset's dot + trails (timeline still drives it).
  // Cleared when the panel closes or a different asset is selected.
  const [isolateId, setIsolateId] = useState<string | null>(null)
  const isolateIdRef = useRef<string | null>(null)
  isolateIdRef.current = isolateId
  // Selected asset's id, for spotlighting its trail/heat without isolating.
  const selectedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (isolateId && selectedAsset?.id !== isolateId) setIsolateId(null)
  }, [selectedAsset, isolateId])
  const [selectedZone, setSelectedZone] = useState<Geofence | null>(null)
  const [selectedDevice, setSelectedDevice] = useState<SiteDevice | null>(null)
  const [filter, setFilter] = useState<Set<AssetType>>(new Set<AssetType>(['vehicle', 'equipment', 'personnel', 'tool']))
  const [showZones, setShowZones] = useState(true)
  const [showDevices, setShowDevices] = useState(isMock)
  const realZoneCostsRef = useRef<Record<string, import('@/lib/costs').ZoneCostCurve> | null>(null)
  const realWindowRef = useRef<import('@/lib/trails').TrackWindow | null>(null)
  // tz via ref so the zoneRealAt callback (deliberately dep-free) stays fresh.
  const tzRef = useRef(tz)
  tzRef.current = tz

  // Zone popup cost AT the scrub position (mirrors the hard-hat chip) with an
  // "as of <time>" stamp so the number visibly follows the timeline.
  const zoneRealAt = useCallback((fenceId: string, t: number) => {
    const curves = realZoneCostsRef.current
    if (!curves) return undefined
    const curve = curves[fenceId]
    const zc = curve ? zoneCostAt(curve, t) : { total: 0, activeHours: 0 }
    const w = realWindowRef.current
    const asOf = w
      ? new Date(w.from + t * (w.to - w.from)).toLocaleTimeString([], { timeZone: tzRef.current, hour: 'numeric', minute: '2-digit' })
      : undefined
    // Per-interval series for the popup's mini charts (hours + $ over the
    // window, heat-colored, aligned with the timeline slider).
    const windowSec = w ? (w.to - w.from) / 1000 : undefined
    return {
      ...zc,
      asOf,
      hoursSeries: curve ? deltas(curve.hours) : undefined,
      costSeries: curve ? deltas(curve.cost) : undefined,
      windowSec,
    }
  }, [])
  const [isDrawing, setIsDrawing] = useState(false)
  const drawCoords = useRef<[number, number][]>([])
  const drawPreviewSource = useRef<string>('draw-preview')

  // ── Timeline playback state ───────────────────────────────────────────────
  const [range, setRange] = useState<TimeRange>('live')
  // Custom From/To window (defaults to the last 7 days). Epoch ms.
  const [customFrom, setCustomFrom] = useState(() => Date.now() - 7 * 86_400_000)
  const [customTo, setCustomTo] = useState(() => Date.now())
  const customDays = Math.max(1, Math.round((customTo - customFrom) / 86_400_000))
  const pbActive = range !== 'live'
  // Kiosk (Command Center) shows movement trails by default — the wall display
  // should look alive without anyone touching it.
  const [trailMode, setTrailMode] = useState<TrailMode>(kiosk ? 'trails' : 'off')
  const [pbPlaying, setPbPlaying] = useState(false)
  const [pbT, setPbT] = useState(0)
  const [pbSpeed, setPbSpeed] = useState(500)
  // How much of the window is revealed: full when live, scrubbed when replaying
  const displayT = pbActive ? pbT : 1

  // ── Cinematic camera-follow ───────────────────────────────────────────────
  // The camera locks onto one asset. Three styles: Orbit (slow revolve — the
  // default, buttery), Overhead (top-down chase), Chase (rides behind it).
  const [followId, setFollowId] = useState<string | null>(null)
  const [followMode, setFollowMode] = useState<FollowMode>('orbit')
  const followIdRef = useRef<string | null>(null)
  // Follow HUD: replay telemetry projected while the camera rides the asset —
  // speed at the scrub position, time of day, miles covered so far.
  const [followHud, setFollowHud] = useState<{ mph: number | null; clock: string; milesIn: number } | null>(null)
  const followModeRef = useRef<FollowMode>('orbit')
  const bearingRef = useRef(0)   // smoothed camera bearing
  const pitchRef = useRef(0)     // eased camera pitch (ramps up on entrance)
  const entranceRef = useRef(1)  // 0→1 "pan up + zoom in" reveal progress
  // True while the USER's fingers own the camera (pinch/scroll/drag) — the
  // follow loop yields instead of stomping the gesture every frame, so you
  // can zoom in/out mid-chase. Tracking resumes the moment fingers lift.
  const userGestureRef = useRef(false)
  followIdRef.current = followId
  followModeRef.current = followMode

  // 3D is now an independent toggle layered on ANY basemap (not its own base).
  const [threeD, setThreeD] = useState(false)
  const threeDRef = useRef(threeD)
  threeDRef.current = threeD

  // On-demand full-resolution history for the selected window. The shipped
  // snapshot is capped + newest-biased (older days were getting silently
  // truncated \u2014 "yesterday's track lost data"), so once a replay range is
  // picked we fetch EXACTLY that window from /api/history and swap it in.
  const [fetchedRows, setFetchedRows] = useState<Record<string, import('@/lib/db/assets').LocationHistoryRow[]>>({})
  useEffect(() => {
    if (!historyRows || range === 'live') return
    const w = rangeWindow(tz, range, { earliestMs, customFrom, customTo })
    const key = `${w.from}-${w.to}`
    // A window that includes NOW keeps growing \u2014 and trackers buffer offline
    // and backfill with original timestamps (start of a drive after days
    // parked shows up minutes late). Caching that window forever froze the
    // trail at first fetch, so live windows re-pull every minute; windows
    // entirely in the past stay cached.
    const windowIsLive = w.to > Date.now()
    if (fetchedRows[key] && !windowIsLive) return
    const ctrl = new AbortController()
    const load = () => {
      fetch(`/api/history?from=${new Date(w.from).toISOString()}&to=${new Date(w.to).toISOString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || !Array.isArray(j.rows)) return
          let rows = j.rows as typeof historyRows
          // Capped fetch is newest-biased \u2014 splice the older tail back in
          // from the evenly-strided shipped snapshot so early days still draw.
          if (j.truncated && rows && rows.length && historyRows) {
            const oldestMs = Date.parse(rows[0].timestamp)
            const older = historyRows.filter((r) => {
              const ms = Date.parse(r.timestamp)
              return ms >= w.from && ms < oldestMs
            })
            if (older.length) rows = [...older, ...rows]
          }
          setFetchedRows((prev) => ({ ...prev, [key]: rows as NonNullable<typeof historyRows> }))
        })
        .catch(() => { /* offline / aborted \u2014 the shipped snapshot still renders */ })
    }
    load()
    const iv = windowIsLive ? setInterval(load, 60_000) : null
    return () => { ctrl.abort(); if (iv) clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyRows, range, customFrom, customTo, earliestMs, tz])

  // Real mode: build the dataset for the SELECTED range from raw history \u2014
  // tracks, window, cost curve, and per-zone curves, all for the same window.
  // Every range (Today \u2026 All time \u2026 Custom) gets correct data + axis, and the
  // truck's trail appears in each because tracks span that range's window.
  const dayData = useMemo(() => {
    if (!historyRows) return null
    const w = rangeWindow(tz, range, { earliestMs, customFrom, customTo })
    const fetched = fetchedRows[`${w.from}-${w.to}`]
    const rows = fetched ?? historyRows.filter((r) => {
      const ms = Date.parse(r.timestamp)
      return ms >= w.from && ms < w.to
    })
    return {
      tracks: tracksFromHistory(assets, rows, w.from, w.to),
      window: w,
      cost: buildCostCurve(assets, rows, w.from, w.to),
      zones: zoneCostsFromHistory(geofences.filter((g) => fenceKind(g) === 'site'), assets, rows, w.from, w.to),
    }
  }, [historyRows, range, customFrom, customTo, earliestMs, tz, assets, geofences, fetchedRows])

  const tracksEff = dayData?.tracks ?? tracks
  const realWindowEff = dayData?.window ?? null
  const realCostEff = dayData?.cost ?? null
  const realZoneCostsEff = dayData?.zones ?? null
  realZoneCostsRef.current = realZoneCostsEff
  realWindowRef.current = realWindowEff
  // Cost shown inside the timeline. Real accounts: cumulative curve built from
  // per-asset rates x observed activity over the SELECTED range \u2014 the scrub
  // position reads the honest ledger, never demo PROJECT rates.
  const costTotal = realCostEff
    ? realCostEff.curve[Math.min(realCostEff.curve.length - 1, Math.max(0, Math.floor(displayT * (realCostEff.curve.length - 1))))] ?? 0
    : PROJECTS.reduce((s, p) => s + periodCost(p, range, pbT, customDays).total, 0)
  const costLabel = realCostEff
    ? (realCostEff.hasRates ? `${RANGE_COST_LABEL[range]} \u00b7 from asset rates` : 'set cost rates on assets')
    : range === 'custom' ? `${customDays}-day window` : RANGE_COST_LABEL[range]

  // Fleet activity across the window: heat-colored slider + pull-up chart +
  // "play starts at first movement, not midnight".
  const activity = useMemo(() => buildActivityCurve(tracksEff), [tracksEff])
  const firstMoveT = useMemo(() => firstMovementT(activity), [activity])
  const firstMoveTRef = useRef(0)
  firstMoveTRef.current = firstMoveT
  const windowSecondsEff = realWindowEff
    ? (realWindowEff.to - realWindowEff.from) / 1000
    : rangeWindowSeconds(range)
  const windowSecRef = useRef(windowSecondsEff)
  windowSecRef.current = windowSecondsEff
  // Whenever the replay window's real length changes (range pick, custom
  // From/To edit, all-time data growing) re-snap to the ~45 s-sweep speed.
  // Never while following — Follow pins 2x wall-clock so tiles keep up, and
  // this effect fires right after Follow flips Live -> Today.
  useEffect(() => {
    if (range === 'live' || followIdRef.current) return
    setPbSpeed(defaultSpeedForWindow(windowSecondsEff))
  }, [range, windowSecondsEff])
  // $ curve for the chart. Real accounts: the honest ledger. Demo: a blended
  // fleet rate applied to observed movement, so the toggle demos meaningfully.
  const chartCostCurve = useMemo(() => {
    if (realCostEff) return realCostEff.hasRates ? realCostEff.curve : null
    const perBucketHours = windowSecondsEff / activity.length / 3600
    const DEMO_BLENDED_RATE = 95 // $/hr per moving asset (demo only)
    let acc = 0
    return activity.map((n) => (acc += n * DEMO_BLENDED_RATE * perBucketHours))
  }, [realCostEff, activity, windowSecondsEff])
  const tracksRef = useRef(tracksEff)
  const filterRef = useRef(filter)
  const speedRef = useRef(pbSpeed)
  const tRef = useRef(pbT)
  const rangeRef = useRef(range)
  const windowRef = useRef(rangeWindowSeconds(range))
  // Click handlers are bound once in the init effect; read assets via ref so
  // they see live data instead of the first render's array.
  const assetsRef = useRef(assets)
  const geofencesRef = useRef(geofences)
  tracksRef.current = tracksEff
  filterRef.current = filter
  speedRef.current = pbSpeed
  tRef.current = pbT
  rangeRef.current = range
  // Playback duration = the real selected-range window (else demo fallback), so
  // a 30-day replay actually spans 30 days of wall-clock at the chosen speed.
  windowRef.current = realWindowEff ? (realWindowEff.to - realWindowEff.from) / 1000 : rangeWindowSeconds(range)
  assetsRef.current = assets
  geofencesRef.current = geofences

  // Fit the map to everything — assets, zones, and site devices.
  const fitAll = useCallback(() => {
    const m = map.current
    if (!m) return
    const pts: [number, number][] = []
    for (const a of assetsRef.current) if (a.location) pts.push([a.location.lng, a.location.lat])
    for (const d of SITE_DEVICES) pts.push([d.lng, d.lat])
    for (const g of geofencesRef.current) {
      const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
      if (ring) for (const c of ring) pts.push([c[0], c[1]])
    }
    if (!pts.length) return
    const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
    m.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 600 })
  }, [])

  // ── Basemap + weather layer state ─────────────────────────────────────────
  // Default to satellite — real aerial imagery reads as "the actual jobsite".
  // Kiosk wall opens on Dark with the radar sweep — the mission-control look.
  const [base, setBase] = useState<BaseStyle>(kiosk ? 'dark' : 'satellite')
  const baseRef = useRef(base)
  baseRef.current = base
  const [radarOn, setRadarOn] = useState(kiosk)
  // Manual freeze for the live radar loop (map stays put, sky stops moving).
  const [radarPaused, setRadarPaused] = useState(false)
  // GOES-East GeoColor clouds (NASA GIBS WMTS, keyless, ~10-min cadence).
  const [cloudsOn, setCloudsOn] = useState(false)
  // Storm tops — GOES Band 13 clean IR (cold = high tops). The ForeFlight view.
  const [stormTopsOn, setStormTopsOn] = useState(false)
  const cloudsAdded = useRef(false)
  const stormAdded = useRef(false)
  // Rain totals (MRMS accumulation) — separate from the radar loop.
  const [precipOn, setPrecipOn] = useState(false)
  const [precipPeriod, setPrecipPeriod] = useState(PRECIP_PERIODS[1].key) // 24 hr
  const precipAdded = useRef(false)
  // What the map opens showing: fit the whole fleet, or wherever you left it.
  const [openView, setOpenView] = useState<'fit' | 'last'>(() => {
    try {
      return (typeof window !== 'undefined' && localStorage.getItem('ht_map_open_view') === 'last') ? 'last' : 'fit'
    } catch { return 'fit' }
  })
  const handleOpenView = useCallback((v: 'fit' | 'last') => {
    setOpenView(v)
    try { localStorage.setItem('ht_map_open_view', v) } catch { /* private mode */ }
  }, [])
  const [parcelsOn, setParcelsOn] = useState(false)
  const [overlaysOn, setOverlaysOn] = useState<Record<string, boolean>>({})
  const parcelAbort = useRef<AbortController | null>(null)

  // ── Named, saveable map views ─────────────────────────────────────────────
  // A view = every layer/style toggle in one snapshot. DB copy (profile) wins
  // over the device-local copy; the default view applies on open.
  const [mapViews, setMapViews] = useState<MapViewsState>(() => savedMapViews ?? loadLocalViews())
  const [activeViewId, setActiveViewId] = useState<string | null>(null)

  const applyView = useCallback((v: SavedMapView) => {
    const c = v.cfg
    setBase(c.base)
    setThreeD(c.threeD)
    setRadarOn(c.radar)
    setCloudsOn(c.clouds ?? false)
    setPrecipOn(c.precip)
    if (c.precipPeriod) setPrecipPeriod(c.precipPeriod)
    setOverlaysOn({ ...c.overlays })
    setParcelsOn(PARCEL_SERVICE_URL ? c.parcels : false)
    setTrailMode(c.trailMode)
    setShowZones(c.zones)
    setActiveViewId(v.id)
  }, [])

  // Apply the default view once on open (not in kiosk — the wall display
  // configures itself).
  const defaultAppliedRef = useRef(false)
  useEffect(() => {
    if (kiosk || defaultAppliedRef.current) return
    defaultAppliedRef.current = true
    const def = mapViews.defaultId ? allViews(mapViews).find((v) => v.id === mapViews.defaultId) : null
    if (def) applyView(def)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistViews = useCallback((s: MapViewsState) => {
    setMapViews(s)
    saveLocalViews(s)
    onSaveMapViews?.(s)
  }, [onSaveMapViews])

  const handleSaveView = useCallback((name: string) => {
    const v: SavedMapView = {
      id: `v-${Date.now().toString(36)}`,
      name: name.trim().slice(0, 40) || 'My view',
      cfg: {
        base, threeD, radar: radarOn, clouds: cloudsOn, precip: precipOn, precipPeriod,
        overlays: { ...overlaysOn }, parcels: parcelsOn, trailMode, zones: showZones,
      },
    }
    persistViews({ views: [v, ...mapViews.views].slice(0, 20), defaultId: mapViews.defaultId })
    setActiveViewId(v.id)
  }, [base, threeD, radarOn, precipOn, precipPeriod, overlaysOn, parcelsOn, trailMode, showZones, mapViews, persistViews])

  const handleDeleteView = useCallback((id: string) => {
    persistViews({
      views: mapViews.views.filter((v) => v.id !== id),
      defaultId: mapViews.defaultId === id ? null : mapViews.defaultId,
    })
    setActiveViewId((cur) => (cur === id ? null : cur))
  }, [mapViews, persistViews])

  const handleDefaultView = useCallback((id: string) => {
    persistViews({ views: mapViews.views, defaultId: mapViews.defaultId === id ? null : id })
  }, [mapViews, persistViews])
  const [conditions, setConditions] = useState<Conditions | null>(null)
  // Home weather station (owner's PWS) — polled every 5 min; null when not set up.
  const [pws, setPws] = useState<PwsConditions | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = () => fetchPws().then((p) => { if (!cancelled) setPws(p) })
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  const [wxPlace, setWxPlace] = useState('Nashville, TN')
  // Current weather coords [lng, lat] — saved with the default so reopening
  // uses the exact point, not a name re-geocode (which picked the wrong
  // "Greenville" — NC outranks SC by population).
  const wxCoordsRef = useRef<[number, number] | null>(null)
  const wxAdded = useRef(false)

  // Animated radar (Iowa Environmental Mesonet). Frames rebuilt when radar turns
  // on; an interval steps through them so the loop plays and zooms deep.
  const [radarFrames, setRadarFrames] = useState<IemFrame[]>([])
  const [radarIdx, setRadarIdx] = useState(0)
  // radarIdx may run 2 past the end (loop pause) — clamp so the newest frame
  // holds instead of the layer blinking off.
  const currentFrame = radarFrames.length ? radarFrames[Math.min(radarIdx, radarFrames.length - 1)] : null

  // Free, no-key basemap: CARTO dark raster. (Satellite + 3D buildings are added
  // on load from free sources — no paid MapTiler key required.)
  const mapStyle = {
    version: 8 as const,
    sources: {
      'carto-dark': {
        type: 'raster' as const,
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
      },
    },
    layers: [{ id: 'carto-base', type: 'raster' as const, source: 'carto-dark' }],
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyle as maplibregl.StyleSpecification,
      center: DEMO_MAP_CENTER,
      zoom: DEMO_MAP_ZOOM,
      attributionControl: false,
      // Follow mode drags the camera across town — keep far more tiles in
      // memory than the default so revisited areas render instantly.
      maxTileCacheSize: 4096,
    })

    // Kiosk: zoom/locate/fit ride bottom-left — top-right belongs to the event
    // rail on the wall display, and the two were stacked on top of each other.
    const ctrlCorner = kiosk ? 'bottom-left' : 'top-right'
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), ctrlCorner)
    map.current.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), ctrlCorner)

    // Zoom-to-all control (sits below the geolocate button)
    const fitAllControl: maplibregl.IControl = {
      onAdd() {
        const div = document.createElement('div')
        div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.title = 'Zoom to all'
        btn.setAttribute('aria-label', 'Zoom to all')
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
        btn.onclick = () => fitAll()
        div.appendChild(btn)
        return div
      },
      onRemove() {},
    }
    map.current.addControl(fitAllControl, ctrlCorner)
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.current.on('load', () => {
      const m = map.current!

      // Zoomed way out, Earth is a globe — MapLibre v5 renders it as one and
      // seamlessly flattens back to the normal map by street zooms.
      m.setProjection({ type: 'globe' })

      // ── Free basemap layers stacked over the CARTO dark base ──
      // Streets (labeled, no imagery) — CARTO Voyager
      m.addSource('streets-base', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        maxzoom: 20,
        attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'streets-base', type: 'raster', source: 'streets-base', layout: { visibility: 'none' } })

      // Satellite (aerial) imagery — Esri World Imagery. maxzoom caps tile
      // requests at 19 (Esri's global max) and over-scales beyond, so deep zoom
      // no longer throws "zoom level not supported".
      m.addSource('sat-base', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar' })
      m.addLayer({ id: 'sat-base', type: 'raster', source: 'sat-base', layout: { visibility: 'none' } })

      // Hybrid labels — CARTO's retina label-only tiles (place + road names
      // with dark halos, crisp on hi-DPI). Replaced Esri's dated reference
      // rasters: non-retina text and salmon road lines read blurry over
      // imagery, and the photo already shows the roads themselves.
      m.addSource('labels-overlay', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        maxzoom: 20,
        attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'labels-overlay', type: 'raster', source: 'labels-overlay', layout: { visibility: 'none' } })

      // 3D building extrusions from OpenFreeMap (free vector tiles, no key).
      // OpenMapTiles schema: 'building' layer with render_height / render_min_height.
      m.addSource('ofm', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
      m.addLayer({
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'ofm',
        'source-layer': 'building',
        minzoom: 13,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#2a3f57',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      })

      // Geofences (drawn under everything)
      m.addSource('geofences', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: geofences.map((g) => ({
            type: 'Feature', geometry: g.geometry, properties: { id: g.id, name: g.name, color: g.color, kind: fenceKind(g) },
          })),
        },
      })
      // Boundary zones render OUTLINE-ONLY — no fill — so a large perimeter
      // around the whole yard doesn't black out the map underneath it.
      m.addLayer({
        id: 'geofence-fill', type: 'fill', source: 'geofences',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['==', ['get', 'kind'], 'boundary'], 0, ['==', ['get', 'kind'], 'yard'], 0.06, 0.14],
        },
      })
      m.addLayer({
        id: 'geofence-outline', type: 'line', source: 'geofences',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['==', ['get', 'kind'], 'boundary'], 3.5, 2.5],
          'line-dasharray': [3, 2],
        },
      })
      // Labels anchored to the top edge of each zone (added last so they sit above pins)
      m.addSource('geofence-label-pts', { type: 'geojson', data: geofenceLabelPoints(geofences) })

      // ── Trail / heatmap layers (hidden until a movement mode is on) ──
      m.addSource('trails', { type: 'geojson', data: trailsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-line', type: 'line', source: 'trails',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        // Kiosk shows every asset's full history at once — fade the lines so the
        // wall display reads as ambiance, not spaghetti. A selected asset's
        // track brightens + widens; everyone else dims out of the way.
        paint: kiosk
          ? {
              'line-color': ['get', 'color'],
              'line-width': ['case', ['==', ['get', 'sel'], 1], 3.5, 1.6],
              'line-opacity': ['case', ['==', ['get', 'sel'], 1], 0.9, ['==', ['get', 'dim'], 1], 0.15, 0.3],
              'line-blur': 0.4,
            }
          : {
              'line-color': ['get', 'color'],
              'line-width': ['case', ['==', ['get', 'sel'], 1], 5.5, ['==', ['get', 'dim'], 1], 2, 3],
              'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, ['==', ['get', 'dim'], 1], 0.3, 0.85],
              'line-blur': 0.3,
            },
      })
      // Heatmap of movement density (alternative to trails)
      m.addSource('trail-points', { type: 'geojson', data: pointsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-heat', type: 'heatmap', source: 'trail-points',
        layout: { visibility: 'none' },
        paint: {
          // Selected asset's pings run hotter so its footprint stands out.
          'heatmap-weight': ['case', ['==', ['get', 'sel'], 1], 1.6, 0.8],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 16, 34],
          'heatmap-opacity': 0.85,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(7,58,90,0.6)',
            0.4, '#2dd4bf',
            0.7, '#ff9e16',
            1, '#fb5d5d',
          ],
        },
      })
      // 3D activity terrain — hex prisms extruded by time-spent-per-cell.
      m.addSource('heat3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'heat3d-layer', type: 'fill-extrusion', source: 'heat3d',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'ratio'],
            0, '#14506f',
            0.25, '#2dd4bf',
            0.55, '#ff9e16',
            0.85, '#fb5d5d',
            1, '#ffe8e8',
          ],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.82,
        },
      })

      m.addSource('trail-heads', { type: 'geojson', data: headsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trail-heads', type: 'circle', source: 'trail-heads',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 10, 7],
          'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 3, 2],
          'circle-stroke-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', '#001523'],
        },
      })
      m.addLayer({
        id: 'trail-head-labels', type: 'symbol', source: 'trail-heads',
        layout: {
          'text-field': ['get', 'name'], 'text-size': 10.5,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-max-width': 30, // one line — names never wrap mid-word
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.15,
          'text-justify': 'auto',
          visibility: 'none',
        },
        paint: { 'text-color': '#e8f0f7', 'text-halo-color': '#001523', 'text-halo-width': 2, 'text-halo-blur': 0.5 },
      })

      // ── Live asset cluster source ──
      m.addSource('assets', { type: 'geojson', data: buildGeoJSON(assets, filterRef.current), cluster: true, clusterMaxZoom: 15, clusterRadius: 40 })
      m.addLayer({
        id: 'clusters', type: 'circle', source: 'assets', filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#001523',
          'circle-radius': ['step', ['get', 'point_count'], 20, 5, 26, 20, 32],
          'circle-stroke-width': 2, 'circle-stroke-color': '#ff9e16',
        },
      })
      m.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'assets', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 13, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': '#ff9e16' },
      })
      // Expanding pulse ring — MOVING assets only. The RAF effect below
      // animates radius/opacity so who's rolling is obvious from across a room.
      m.addLayer({
        id: 'asset-pulse', type: 'circle', source: 'assets',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'state'], 'moving']],
        paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.4, 'circle-radius': 16, 'circle-stroke-width': 0 },
      })
      // soft glow under each pin so assets pop off the satellite imagery —
      // brightness reads the state: moving bright, idle steady, off nearly out
      m.addLayer({
        id: 'asset-glow', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-opacity': ['match', ['get', 'state'], 'moving', 0.38, 'idle', 0.22, 0.06],
          'circle-radius': 24, 'circle-blur': 0.7,
        },
      })
      m.addLayer({
        id: 'unclustered-circle', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 14, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#04121d',
          'circle-opacity': ['match', ['get', 'state'], 'off', 0.45, 1],
        },
      })
      m.addLayer({
        id: 'unclustered-label', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['match', ['get', 'type'], 'vehicle', '🚛', 'equipment', '🏗️', 'personnel', '👷', 'tool', '🔧', '📍'],
          'text-size': 14, 'text-allow-overlap': true,
        },
      })
      // Name beside the dot (live mode) — same POI treatment as trail heads.
      m.addLayer({
        id: 'unclustered-name', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        minzoom: 9,
        layout: {
          'text-field': ['get', 'name'], 'text-size': 10.5,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-max-width': 30,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.5,
          'text-justify': 'auto',
          'text-optional': true,
        },
        paint: { 'text-color': '#e8f0f7', 'text-halo-color': '#001523', 'text-halo-width': 2, 'text-halo-blur': 0.5 },
      })

      // ── Site devices (cameras + sensors) ──
      m.addSource('devices', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: SITE_DEVICES.map((d) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
            properties: { id: d.id, color: DEVICE_META[d.type].color, emoji: DEVICE_META[d.type].emoji },
          })),
        },
      })
      m.addLayer({
        id: 'device-bg', type: 'circle', source: 'devices',
        paint: { 'circle-color': '#001523', 'circle-radius': 13, 'circle-stroke-width': 2, 'circle-stroke-color': ['get', 'color'] },
      })
      m.addLayer({
        id: 'device-icon', type: 'symbol', source: 'devices',
        layout: { 'text-field': ['get', 'emoji'], 'text-size': 14, 'text-allow-overlap': true },
      })

      // Zone labels — three zoom regimes so names never shout at state scale:
      // < z8 the colored shape IS the marker (no text); z8–11.5 a short
      // mixed-case tag ("Shop", "Matthews House"); ≥ z11.5 the full name.
      // Collision avoidance stays: the larger/billable zone wins placement.
      const zoneLabelLayout: NonNullable<maplibregl.SymbolLayerSpecification['layout']> = {
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-letter-spacing': 0.03,
        'text-max-width': 10,
        'text-anchor': 'bottom', 'text-offset': [0, -0.4],
        'text-allow-overlap': false, 'text-ignore-placement': false,
        'text-padding': 6, 'symbol-sort-key': ['get', 'pri'],
      }
      const zoneLabelPaint: NonNullable<maplibregl.SymbolLayerSpecification['paint']> = {
        'text-color': ['get', 'color'],
        'text-halo-color': '#001016', 'text-halo-width': 2, 'text-opacity': 0.88,
      }
      m.addLayer({
        id: 'geofence-labels', type: 'symbol', source: 'geofence-label-pts',
        minzoom: 8, maxzoom: 11.5,
        layout: { ...zoneLabelLayout, 'text-field': ['get', 'short'], 'text-size': 10 },
        paint: zoneLabelPaint,
      })
      m.addLayer({
        id: 'geofence-labels-full', type: 'symbol', source: 'geofence-label-pts',
        minzoom: 11.5,
        layout: { ...zoneLabelLayout, 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 11, 15, 13] },
        paint: zoneLabelPaint,
      })

      // Draw preview
      m.addSource(drawPreviewSource.current, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'draw-fill', type: 'fill', source: drawPreviewSource.current, paint: { 'fill-color': '#ff9e16', 'fill-opacity': 0.15 } })
      m.addLayer({ id: 'draw-line', type: 'line', source: drawPreviewSource.current, paint: { 'line-color': '#ff9e16', 'line-width': 2 } })

      // Click handlers — bind to both the pin and its glow so the whole dot is a
      // hit target (assets always win over the zone underneath).
      const selectAsset = (e: maplibregl.MapLayerMouseEvent) => {
        const props = e.features?.[0]?.properties
        if (!props) return
        const asset = assetsRef.current.find((a) => a.id === props.id)
        if (asset) {
          setSelectedZone(null)
          setSelectedDevice(null)
          setSelectedAsset(asset)
        }
      }
      m.on('click', 'unclustered-circle', selectAsset)
      m.on('click', 'asset-glow', selectAsset)
      m.on('click', 'clusters', (e) => {
        const features = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        const clusterId = features[0]?.properties?.cluster_id
        if (!clusterId) return
        const source = m.getSource('assets') as maplibregl.GeoJSONSource
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number]
          m.easeTo({ center: coords, zoom: zoom ?? m.getZoom() + 2 })
        })
      })
      // Device pin → device sheet
      m.on('click', 'device-bg', (e) => {
        const id = e.features?.[0]?.properties?.id
        const device = SITE_DEVICES.find((d) => d.id === id)
        if (!device) return
        setSelectedAsset(null)
        setSelectedZone(null)
        setSelectedDevice(device)
      })

      // Geofence zone → zone sheet (presence + cost, live-synced to the timeline)
      m.on('click', 'geofence-fill', (e) => {
        // Don't hijack clicks landing on/near any asset, cluster, or device — the
        // pin always wins. Query a small box so the whole dot (incl. its glow) is
        // protected, not just the exact pixel.
        const pad = 14
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ]
        if (m.queryRenderedFeatures(box, { layers: ['unclustered-circle', 'asset-glow', 'clusters', 'device-bg'] }).length) return
        const id = e.features?.[0]?.properties?.id
        const fence = geofencesRef.current.find((g) => g.id === id)
        if (!fence) return
        setSelectedAsset(null)
        setSelectedDevice(null)
        setSelectedZone(fence)
      })

      for (const layer of ['unclustered-circle', 'clusters', 'trail-heads', 'device-bg', 'device-icon', 'geofence-fill']) {
        m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = '' })
      }

      // Fat-finger fallback: layer click handlers need the tap to land ON the
      // feature — a thumb on a phone often misses by a few px and hit nothing.
      // This map-level handler runs AFTER the layer handlers (registration
      // order); if none of them consumed the tap, search a padded box around
      // the finger and select the nearest pin (live or replay head).
      m.on('click', (e) => {
        const pad = 24
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ]
        const layers = ['unclustered-circle', 'asset-glow', 'trail-heads'].filter((l) => m.getLayer(l))
        const hits = m.queryRenderedFeatures(box, { layers })
        // Direct hits already handled by the layer handlers — this only fires
        // usefully when the tap landed NEAR a pin but on none. A direct hit in
        // the box means selectAsset already ran with the same asset; setting
        // state again with the same object is a harmless no-op.
        const id = hits[0]?.properties?.id
        if (!id) return
        const asset = assetsRef.current.find((a) => a.id === id)
        if (asset) {
          setSelectedZone(null)
          setSelectedDevice(null)
          setSelectedAsset(asset)
        }
      })

      // Opening view — user-selectable in the map layers menu:
      //   fit  (default) — frame everything: assets, zones, devices
      //   last           — restore exactly where you left the camera
      let openedFromSaved = false
      try {
        if (localStorage.getItem('ht_map_open_view') === 'last') {
          const saved = JSON.parse(localStorage.getItem('ht_map_last_camera') ?? 'null')
          if (saved && Array.isArray(saved.center)) {
            m.jumpTo({ center: saved.center, zoom: saved.zoom ?? DEMO_MAP_ZOOM, bearing: saved.bearing ?? 0, pitch: saved.pitch ?? 0 })
            openedFromSaved = true
          }
        }
      } catch { /* corrupt value — fall through to fit */ }
      if (!openedFromSaved) {
        const pts: [number, number][] = [
          ...assets.filter((a) => a.location).map((a) => [a.location!.lng, a.location!.lat] as [number, number]),
          ...SITE_DEVICES.map((d) => [d.lng, d.lat] as [number, number]),
        ]
        for (const g of geofences) {
          const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
          if (ring) for (const c of ring) pts.push([c[0], c[1]])
        }
        if (pts.length > 0) {
          const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
          m.fitBounds(bounds, { padding: 70, maxZoom: 16, duration: 0 })
        }
      }

      // Gesture ownership for camera-follow: while fingers/wheel are active the
      // follow loop yields (see focusFollow), so pinch-zoom works mid-chase.
      let wheelTimer: ReturnType<typeof setTimeout> | null = null
      const canvas = m.getCanvas()
      const gestureOn = () => { userGestureRef.current = true }
      const gestureOff = () => { userGestureRef.current = false }
      canvas.addEventListener('touchstart', gestureOn, { passive: true })
      canvas.addEventListener('touchend', gestureOff, { passive: true })
      canvas.addEventListener('touchcancel', gestureOff, { passive: true })
      canvas.addEventListener('wheel', () => {
        userGestureRef.current = true
        if (wheelTimer) clearTimeout(wheelTimer)
        wheelTimer = setTimeout(gestureOff, 250)
      }, { passive: true })
      m.on('dragstart', gestureOn)
      m.on('dragend', gestureOff)

      // Remember the camera (throttled via moveend) for the "last view" option.
      m.on('moveend', () => {
        try {
          const c = m.getCenter()
          localStorage.setItem('ht_map_last_camera', JSON.stringify({
            center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(),
          }))
        } catch { /* private mode */ }
      })

      setMapReady(true)
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Update live asset source when assets, filter, or isolate change
  useEffect(() => {
    if (!mapReady) return
    const source = map.current?.getSource('assets') as maplibregl.GeoJSONSource | undefined
    const visible = isolateId ? assets.filter((a) => a.id === isolateId) : assets
    source?.setData(buildGeoJSON(visible, filter))
  }, [mapReady, assets, filter, isolateId])

  // Re-render geofences when the prop changes (e.g. a newly saved zone)
  useEffect(() => {
    if (!mapReady) return
    const source = map.current?.getSource('geofences') as maplibregl.GeoJSONSource | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: geofences.map((g) => ({
        type: 'Feature', geometry: g.geometry, properties: { id: g.id, name: g.name, color: g.color, kind: fenceKind(g) },
      })),
    })
    ;(map.current?.getSource('geofence-label-pts') as maplibregl.GeoJSONSource | undefined)?.setData(geofenceLabelPoints(geofences))
  }, [mapReady, geofences])

  // Show live pins vs trails vs heatmap based on the movement-display mode
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const set = (l: string, v: boolean) => m.getLayer(l) && m.setLayoutProperty(l, 'visibility', v ? 'visible' : 'none')
    LIVE_LAYERS.forEach((l) => set(l, trailMode === 'off'))
    set('trails-line', trailMode === 'trails')
    set('trails-heat', trailMode === 'heatmap')
    set('heat3d-layer', trailMode === '3d')
    HEAD_LAYERS.forEach((l) => set(l, trailMode !== 'off'))
    // The terrain reads flat from straight overhead — tilt in on entry.
    if (trailMode === '3d' && m.getPitch() < 25 && !followIdRef.current) {
      m.easeTo({ pitch: 55, duration: 800 })
    }
  }, [mapReady, trailMode])

  // Write movement geometry straight into the map sources. Called from the
  // RAF loop during playback (bypassing React) and from the effect below for
  // discrete changes (seek, filter, mode).
  const trailModeRef = useRef(trailMode)
  trailModeRef.current = trailMode
  const updateMovementSources = useCallback((t: number) => {
    const m = map.current
    const mode = trailModeRef.current
    if (mode === 'off' || !m) return
    const iso = isolateIdRef.current
    const sel = selectedIdRef.current
    const trs = iso ? tracksRef.current.filter((tr) => tr.assetId === iso) : tracksRef.current
    ;(m.getSource('trail-heads') as maplibregl.GeoJSONSource | undefined)?.setData(headsGeoJSON(trs, filterRef.current, t, sel))
    if (mode === 'trails') {
      ;(m.getSource('trails') as maplibregl.GeoJSONSource | undefined)?.setData(trailsGeoJSON(trs, filterRef.current, t, sel))
    } else if (mode === '3d') {
      ;(m.getSource('heat3d') as maplibregl.GeoJSONSource | undefined)?.setData(hexHeatGeoJSON(trs, filterRef.current, t, windowSecRef.current))
    } else {
      ;(m.getSource('trail-points') as maplibregl.GeoJSONSource | undefined)?.setData(pointsGeoJSON(trs, filterRef.current, t, sel))
    }
  }, [])

  // ── Route-ahead tile warming ──────────────────────────────────────────────
  // While the camera follows a moving asset, its future path is KNOWN (the
  // track). Fetch upcoming basemap tiles into the browser HTTP cache before
  // the camera gets there, so follow mode stops showing blank tiles mid-chase.
  const warmedTiles = useRef(new Set<string>())
  useEffect(() => {
    if (!mapReady || !pbPlaying || !followId) return
    const id = setInterval(() => {
      const m = map.current
      const tr = tracksRef.current.find((x) => x.assetId === followIdRef.current)
      if (!m || !tr || tr.points.length === 0) return
      const z = Math.min(18, Math.max(3, Math.floor(m.getZoom())))
      const base = baseRef.current
      const tpl = base === 'satellite' || base === 'hybrid' ? SAT_TILES
        : base === 'streets' ? 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
        : 'https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png'
      let n = 0
      // Sample the next few playhead positions and warm a 3×3 tile block
      // around each — bounded so a fast scrub doesn't stampede the CDN.
      for (let k = 1; k <= 10 && n < 24; k++) {
        const [lng, lat] = positionAt(tr, Math.min(1, tRef.current + k * 0.004))
        const tx = Math.floor(((lng + 180) / 360) * 2 ** z)
        const ty = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const url = tpl.replace('{z}', String(z)).replace('{x}', String(tx + dx)).replace('{y}', String(ty + dy))
            if (warmedTiles.current.has(url)) continue
            if (warmedTiles.current.size > 4000) warmedTiles.current.clear()
            warmedTiles.current.add(url)
            n++
            fetch(url, { mode: 'no-cors' }).catch(() => { /* warm-up only */ })
          }
        }
      }
    }, 900)
    return () => clearInterval(id)
  }, [mapReady, pbPlaying, followId])

  // Heartbeat for moving assets: the pulse ring breathes outward and fades on
  // a 1.5s cycle. Two paint-property writes per frame — GPU noise.
  useEffect(() => {
    if (!mapReady) return
    const m = map.current
    if (!m) return
    let raf = 0
    const tick = () => {
      if (m.getLayer('asset-pulse')) {
        const ph = (performance.now() % 1500) / 1500
        m.setPaintProperty('asset-pulse', 'circle-radius', 15 + ph * 20)
        m.setPaintProperty('asset-pulse', 'circle-opacity', 0.45 * (1 - ph))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mapReady])

  // Radar-dial blips (TacticalHud) tap through to the map: fly to the asset
  // and open its panel, same as tapping its marker.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      const a = assetsRef.current.find((x) => x.id === id)
      if (!a?.location) return
      setSelectedAsset(a)
      map.current?.flyTo({ center: [a.location.lng, a.location.lat], zoom: 16, duration: 1400 })
    }
    window.addEventListener('ht:focus-asset', onFocus)
    return () => window.removeEventListener('ht:focus-asset', onFocus)
  }, [])

  // Kiosk: broadcast the camera center so the TacticalHud radar re-aims to
  // wherever the wall display is looking (its center = the map's crosshair).
  useEffect(() => {
    if (!kiosk || !mapReady) return
    const m = map.current
    if (!m) return
    const emit = () => {
      const c = m.getCenter()
      window.dispatchEvent(new CustomEvent('ht:camera', { detail: { lng: c.lng, lat: c.lat } }))
    }
    emit()
    m.on('moveend', emit)
    return () => { m.off('moveend', emit) }
  }, [kiosk, mapReady])

  // Drive the follow camera to the asset at scrub position t. Called every frame
  // from the RAF loop and on discrete seeks. The bearing behaviour depends on
  // the mode — Orbit revolves at a constant rate (smooth, never jerks), Overhead
  // holds north-up top-down, Chase eases in behind the direction of travel.
  const focusFollow = useCallback((t: number) => {
    const m = map.current
    const id = followIdRef.current
    if (!m || !id) return
    // The user's fingers own the camera right now (pinch/scroll/drag) —
    // yield this frame instead of stomping the gesture. Resumes on release.
    if (userGestureRef.current) return

    // Zone follow: the camera circles the SITE, not a moving dot. Zones have
    // no heading, so Chase degrades to Orbit; zoom fits the ring once and the
    // user's pinch wins after the entrance (same contract as asset follow).
    if (id.startsWith('zone:')) {
      const g = geofencesRef.current.find((z) => `zone:${z.id}` === id)
      const ring = g?.geometry?.coordinates?.[0] as [number, number][] | undefined
      if (!ring || ring.length < 3) return
      let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const p of ring) {
        cx += p[0]; cy += p[1]
        if (p[0] < minX) minX = p[0]
        if (p[0] > maxX) maxX = p[0]
        if (p[1] < minY) minY = p[1]
        if (p[1] > maxY) maxY = p[1]
      }
      cx /= ring.length; cy /= ring.length
      const zmode = followModeRef.current === 'overhead' ? 'overhead' : 'orbit'
      if (zmode === 'orbit') bearingRef.current = (bearingRef.current + ORBIT_STEP * 0.7) % 360
      else bearingRef.current = lerpAngle(bearingRef.current, 0, 0.08)
      const targetPitch = zmode === 'overhead' ? 8 : 55
      pitchRef.current += (targetPitch - pitchRef.current) * 0.06
      const span = Math.max(maxY - minY, (maxX - minX) * Math.cos((cy * Math.PI) / 180), 0.0008)
      const fitZoom = Math.max(12.5, Math.min(17.2, Math.log2(360 / (span * 3.4))))
      if (entranceRef.current < 1) {
        entranceRef.current = Math.min(1, entranceRef.current + 0.02)
        const z = m.getZoom()
        m.jumpTo({ center: [cx, cy], bearing: bearingRef.current, pitch: pitchRef.current, zoom: z + (fitZoom - z) * 0.07 })
      } else {
        m.jumpTo({ center: [cx, cy], bearing: bearingRef.current, pitch: pitchRef.current })
      }
      return
    }

    const tr = tracksRef.current.find((x) => x.assetId === id)
    if (!tr || tr.points.length === 0) return
    const mode = followModeRef.current
    const here = positionAt(tr, t)

    if (mode === 'orbit') {
      // Pure constant revolution around the asset — independent of its motion,
      // so it glides smoothly whether the truck is parked or driving.
      bearingRef.current = (bearingRef.current + ORBIT_STEP) % 360
    } else if (mode === 'overhead') {
      // Top-down: settle bearing to north so the map reads like a paper map.
      bearingRef.current = lerpAngle(bearingRef.current, 0, 0.08)
    } else {
      // Chase: face the direction of travel, but hold heading when nearly still
      // (an undefined heading was the source of the old jerk).
      const prev = positionAt(tr, Math.max(0, t - 0.006))
      if (Math.hypot(here[0] - prev[0], here[1] - prev[1]) > MOVE_EPS) {
        bearingRef.current = lerpAngle(bearingRef.current, bearingBetween(prev, here), HEADING_LERP)
      }
    }

    const targetPitch = FOLLOW_PITCH[mode]
    pitchRef.current += (targetPitch - pitchRef.current) * 0.06
    if (entranceRef.current < 1) {
      entranceRef.current = Math.min(1, entranceRef.current + 0.02)
      const z = m.getZoom()
      const targetZoom = mode === 'overhead' ? 17 : FOLLOW_ZOOM
      m.jumpTo({ center: here, bearing: bearingRef.current, pitch: pitchRef.current, zoom: z + (targetZoom - z) * 0.07 })
    } else {
      // Entrance done — leave zoom alone so the user can pinch in/out mid-flight.
      m.jumpTo({ center: here, bearing: bearingRef.current, pitch: pitchRef.current })
    }
  }, [])

  // Re-arm the entrance ease whenever the camera mode changes mid-follow, so the
  // pitch/zoom glide to the new style instead of snapping.
  useEffect(() => {
    if (followIdRef.current) entranceRef.current = 0
  }, [followMode])

  // Push trail/heat/head geometry on discrete changes (seek, filter, mode,
  // isolate, selection spotlight)
  selectedIdRef.current = selectedAsset?.id ?? null
  useEffect(() => {
    if (!mapReady) return
    updateMovementSources(displayT)
  }, [mapReady, trailMode, displayT, filter, tracksEff, isolateId, selectedAsset, updateMovementSources])

  // When paused (scrubbing), keep the camera pinned to the followed asset. During
  // playback the RAF loop drives it every frame, so skip to avoid double work.
  useEffect(() => {
    if (!mapReady || !followId || pbPlaying) return
    focusFollow(displayT)
  }, [mapReady, followId, pbPlaying, displayT, focusFollow])

  // Fetch conditions once. Location priority: the company default WITH exact
  // coords (the last star pressed, on any device — wins everywhere), else a
  // device-saved default (older star on this device), else the company's
  // name-only place (legacy save — geocode, then pick the candidate nearest
  // the fleet so "Greenville" resolves to SC, not the bigger NC one), else
  // wherever the fleet last reported, else the demo center. Note: this sets
  // the weather panel only — it must NOT move the map camera, or it fights the
  // fit-to-all-assets on open.
  useEffect(() => {
    let cancelled = false

    let saved: { name: string; lat: number; lng: number } | null = null
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ht_weather_default') : null
      if (raw) saved = JSON.parse(raw)
    } catch { /* corrupt value — ignore */ }

    const newest = assets
      .filter((a) => a.location)
      .sort((a, b) => new Date(b.location!.timestamp).getTime() - new Date(a.location!.timestamp).getTime())[0]

    if (defaultWeatherCoords && defaultWeatherPlace) {
      // Company star with exact point — same weather on every device/domain.
      setWxPlace(defaultWeatherPlace)
      wxCoordsRef.current = [defaultWeatherCoords.lng, defaultWeatherCoords.lat]
      fetchConditions(defaultWeatherCoords.lat, defaultWeatherCoords.lng).then((c) => { if (!cancelled) setConditions(c) })
    } else if (saved && typeof saved.lat === 'number' && typeof saved.lng === 'number') {
      // Exact saved point — this is the fix for "Greenville keeps coming back NC".
      setWxPlace(saved.name)
      wxCoordsRef.current = [saved.lng, saved.lat]
      fetchConditions(saved.lat, saved.lng).then((c) => { if (!cancelled) setConditions(c) })
    } else if (defaultWeatherPlace) {
      fetch(`https://geocoding-api.open-meteo.com/v1/search?count=10&name=${encodeURIComponent(defaultWeatherPlace.split(',')[0].trim())}`)
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return
          const results: { name: string; admin1?: string; latitude: number; longitude: number }[] =
            Array.isArray(j?.results) ? j.results : []
          if (!results.length) return
          // Legacy name-only default is ambiguous — pick the match closest to
          // the fleet's last known position instead of the most-populous one.
          const anchor = newest?.location
          const hit = !anchor ? results[0] : results.reduce((best, r) => {
            const d = (r.latitude - anchor.lat) ** 2 + (r.longitude - anchor.lng) ** 2
            const bd = (best.latitude - anchor.lat) ** 2 + (best.longitude - anchor.lng) ** 2
            return d < bd ? r : best
          })
          setWxPlace([hit.name, hit.admin1].filter(Boolean).join(', '))
          wxCoordsRef.current = [hit.longitude, hit.latitude]
          fetchConditions(hit.latitude, hit.longitude).then((c) => { if (!cancelled) setConditions(c) })
        })
        .catch(() => {})
    } else if (newest?.location) {
      setWxPlace(`near ${newest.name}`)
      wxCoordsRef.current = [newest.location.lng, newest.location.lat]
      fetchConditions(newest.location.lat, newest.location.lng).then((c) => { if (!cancelled) setConditions(c) })
    } else {
      fetchConditions(DEMO_MAP_CENTER[1], DEMO_MAP_CENTER[0]).then((c) => { if (!cancelled) setConditions(c) })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultWeatherPlace, defaultWeatherCoords])

  // Save the current weather location as the default. Persists the exact coords
  // on THIS device (survives redeploys + avoids the wrong-Greenville re-geocode),
  // and — for admins — the name to the company row so the whole team inherits it.
  const handleSaveWeatherDefault = useCallback(async (place: string): Promise<boolean> => {
    const c = wxCoordsRef.current
    try {
      if (c) localStorage.setItem('ht_weather_default', JSON.stringify({ name: place, lng: c[0], lat: c[1] }))
    } catch { /* private mode */ }
    if (onSaveWeatherDefault) {
      // Ship the exact coords to the company row too, so every other device
      // (and every domain — localStorage is per-origin) lands on this point.
      try { await onSaveWeatherDefault(place, c?.[1], c?.[0]) } catch { /* device save already stuck */ }
    }
    return true
  }, [onSaveWeatherDefault])

  // Change the weather location: geocode the name (free Open-Meteo geocoder),
  // refetch conditions for it, and fly the map there.
  const handlePlaceChange = useCallback(async (name: string, lat?: number, lng?: number) => {
    try {
      // Autocomplete picks arrive with coordinates — no second geocode (which
      // used to fail on labels like "Greenville, South Carolina, US" and left
      // the weather silently unchanged).
      if (lat == null || lng == null) {
        // Free-typed text: geocode the first word-ish token ("Greenville sc"
        // as a whole matches nothing in Open-Meteo's index).
        const q = name.split(',')[0].trim()
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`)
        const json = await res.json()
        const hit = json?.results?.[0]
        if (!hit) return
        lat = hit.latitude
        lng = hit.longitude
        name = [hit.name, hit.admin1].filter(Boolean).join(', ')
      }
      if (lat == null || lng == null) return
      setWxPlace(name)
      wxCoordsRef.current = [lng, lat]
      fetchConditions(lat, lng).then((c) => setConditions(c))
      map.current?.flyTo({ center: [lng, lat], zoom: 12, duration: 1200 })
    } catch {
      /* ignore geocode failures */
    }
  }, [])

  // Switch basemap layers (dark / streets / satellite / hybrid)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m?.getLayer('sat-base')) return
    const set = (id: string, on: boolean) => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    set('streets-base', base === 'streets')
    set('sat-base', base === 'satellite' || base === 'hybrid')
    set('labels-overlay', base === 'hybrid')
  }, [mapReady, base])

  // 3D is an independent toggle now — buildings + camera tilt, layerable on any
  // basemap. While following, the follow camera owns the pitch, so don't fight it.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m?.getLayer('buildings-3d')) return
    m.setLayoutProperty('buildings-3d', 'visibility', threeD ? 'visible' : 'none')
    if (!followIdRef.current) m.easeTo({ pitch: threeD ? 55 : 0, duration: 600 })
  }, [mapReady, threeD])

  // Toggle visibility of all geofence layers at once
  useEffect(() => {
    const m = map.current
    if (!mapReady) return
    for (const id of ['geofence-fill', 'geofence-outline', 'geofence-labels', 'geofence-labels-full']) {
      if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', showZones ? 'visible' : 'none')
    }
  }, [mapReady, showZones])

  // Kiosk auto-tour: glide ASSET → asset (flyTo arcs out and back in — "zoom
  // out smoothly, then over"), with a pull-back to the whole fleet each lap.
  // Toggleable from the Screen menu; a manual drag flips the toggle OFF so the
  // wall stays exactly where someone put it instead of silently dying.
  const onTourInterruptRef = useRef(onTourInterrupt)
  onTourInterruptRef.current = onTourInterrupt
  useEffect(() => {
    if (!kiosk || !mapReady || !tourOn) return
    const m = map.current
    if (!m) return
    let stopped = false
    let i = -1
    const step = () => {
      if (stopped || userGestureRef.current) return
      // Someone is replaying or following on the wall — don't fight that camera.
      if (followIdRef.current || rangeRef.current !== 'live') return
      const stops = assetsRef.current.filter((a) => a.location)
      if (stops.length === 0) { fitAll(); return }
      i += 1
      const k = i % (stops.length + 1)
      if (k === stops.length) { fitAll(); return }
      const a = stops[k]
      m.flyTo({ center: [a.location!.lng, a.location!.lat], zoom: 15.6, duration: 6000 })
    }
    const first = setTimeout(step, 1500)
    const id = setInterval(step, 18000)
    const cancel = () => {
      if (stopped) return
      stopped = true
      onTourInterruptRef.current?.()
    }
    m.on('dragstart', cancel)
    return () => { stopped = true; clearTimeout(first); clearInterval(id); m.off('dragstart', cancel) }
  }, [kiosk, mapReady, tourOn, fitAll])

  // Toggle the site-device markers (cameras, fuel, generators, weather station…)
  useEffect(() => {
    const m = map.current
    if (!mapReady) return
    for (const id of ['device-bg', 'device-icon']) {
      if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', showDevices ? 'visible' : 'none')
    }
  }, [mapReady, showDevices])

  // ── Free national overlays (topo, hillshade, wetlands, streams) ───────────
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    for (const o of MAP_OVERLAYS) {
      const on = !!overlaysOn[o.key]
      const srcId = `ovl-${o.key}`
      const layerId = `ovl-${o.key}-layer`
      if (on && !m.getSource(srcId)) {
        m.addSource(srcId, { type: 'raster', tiles: [o.tiles], tileSize: 256, maxzoom: o.maxzoom })
        const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
        m.addLayer(
          { id: layerId, type: 'raster', source: srcId, minzoom: o.minzoom, paint: { 'raster-opacity': o.opacity } },
          beforeId
        )
      }
      if (m.getLayer(layerId)) m.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none')
    }
  }, [mapReady, overlaysOn])

  // ── NWS severe-weather warning polygons (api.weather.gov, free/keyless) ───
  // Extreme = red, Severe = orange. The stop-work signal: a Severe T-storm or
  // Tornado warning polygon crossing a job site is visible at a glance.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.nwswarn
    if (m.getLayer('nws-fill')) {
      m.setLayoutProperty('nws-fill', 'visibility', on ? 'visible' : 'none')
      m.setLayoutProperty('nws-line', 'visibility', on ? 'visible' : 'none')
    } else if (on) {
      m.addSource('nws-alerts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      const sevColor = ['match', ['get', 'severity'], 'Extreme', '#ff4d4d', '#ff9e16'] as unknown as string
      m.addLayer({ id: 'nws-fill', type: 'fill', source: 'nws-alerts', paint: { 'fill-color': sevColor, 'fill-opacity': 0.1 } }, beforeId)
      m.addLayer({ id: 'nws-line', type: 'line', source: 'nws-alerts', paint: { 'line-color': sevColor, 'line-width': 1.8, 'line-opacity': 0.85 } }, beforeId)
    }
    if (!on) return
    let cancelled = false
    const load = () =>
      // No severity query param — the API 400s on comma-joined lists (proved
      // via /diag). Pull active alerts and filter severity client-side.
      fetch('https://api.weather.gov/alerts/active?status=actual&limit=500')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled || !j?.features) return
          const features = j.features
            .filter((f: GeoJSON.Feature & { properties?: { severity?: string } }) =>
              f.geometry && (f.properties?.severity === 'Extreme' || f.properties?.severity === 'Severe'))
            .map((f: GeoJSON.Feature & { properties: { severity?: string; event?: string } }) => ({
              type: 'Feature', geometry: f.geometry,
              properties: { severity: f.properties?.severity ?? 'Severe', event: f.properties?.event ?? '' },
            }))
          ;(m.getSource('nws-alerts') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
        })
        .catch(() => { /* NWS hiccup — keep the last polygons */ })
    load()
    const id = setInterval(load, 3 * 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [mapReady, overlaysOn.nwswarn])

  // ── USGS stream gauges (waterservices.usgs.gov, free/keyless) ─────────────
  // Live gage height near the visible map — is the creek by the site up?
  // Fetched per-viewport at z ≥ 9; tap a dot for the reading.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.gauges
    if (m.getLayer('gauge-dots')) m.setLayoutProperty('gauge-dots', 'visibility', on ? 'visible' : 'none')
    else if (on) {
      m.addSource('gauges', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('clusters') ? 'clusters' : undefined
      m.addLayer({
        id: 'gauge-dots', type: 'circle', source: 'gauges', minzoom: 9,
        paint: {
          'circle-radius': 4.5, 'circle-color': '#38bdf8',
          'circle-stroke-color': '#001523', 'circle-stroke-width': 1.5, 'circle-opacity': 0.9,
        },
      }, beforeId)
      m.on('click', 'gauge-dots', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        // Global popup CSS is dark with zero padding — this HTML must bring its
        // own padding and LIGHT text or it renders black-on-black and clipped.
        new maplibregl.Popup({ closeButton: false, maxWidth: '250px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#7dd3fc;white-space:normal;overflow-wrap:break-word">${p.name}</div><div style="margin-top:3px">Gage height <b style="color:#ff9e16">${p.stage} ft</b></div><div style="color:#9fb6cc;font-size:10.5px;margin-top:2px">${p.at}</div></div>`)
          .addTo(m)
      })
      m.on('mouseenter', 'gauge-dots', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'gauge-dots', () => { m.getCanvas().style.cursor = '' })
    }
    if (!on) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      if (m.getZoom() < 9) return
      const b = m.getBounds()
      if (b.getEast() - b.getWest() > 5 || b.getNorth() - b.getSouth() > 5) return
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(4)).join(',')
      fetch(`https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00065&siteStatus=active`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled) return
          const series = j?.value?.timeSeries
          if (!Array.isArray(series)) return
          const features = series.flatMap((ts: {
            sourceInfo?: { siteName?: string; geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } } }
            values?: { value?: { value?: string; dateTime?: string }[] }[]
          }) => {
            const loc = ts.sourceInfo?.geoLocation?.geogLocation
            const vals = ts.values?.[0]?.value
            const last = Array.isArray(vals) && vals.length ? vals[vals.length - 1] : null
            if (loc?.latitude == null || loc?.longitude == null || !last?.value) return []
            return [{
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [loc.longitude, loc.latitude] },
              properties: {
                name: ts.sourceInfo?.siteName ?? 'Gauge',
                stage: last.value,
                at: last.dateTime ? new Date(last.dateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
              },
            }]
          })
          ;(m.getSource('gauges') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
        })
        .catch(() => { /* USGS hiccup — keep last dots */ })
    }
    const onMove = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 800)
    }
    load()
    m.on('moveend', onMove)
    return () => { cancelled = true; if (timer) clearTimeout(timer); m.off('moveend', onMove) }
  }, [mapReady, overlaysOn.gauges])

  // ── Day/night terminator: shade the half of Earth in darkness right now.
  // Pure solar math (lib/terminator) — no service, no key; re-derives every
  // minute so the line creeps west like it should. Pairs with "City lights".
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.daynight
    for (const lid of ['daynight-fill', 'daynight-line']) {
      if (m.getLayer(lid)) m.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none')
    }
    if (!on) return
    const src = m.getSource('daynight') as maplibregl.GeoJSONSource | undefined
    if (!src) {
      m.addSource('daynight', { type: 'geojson', data: nightPolygon() })
      const beforeId = m.getLayer('clusters') ? 'clusters' : undefined
      m.addLayer({
        id: 'daynight-fill', type: 'fill', source: 'daynight',
        paint: { 'fill-color': '#020b18', 'fill-opacity': 0.45 },
      }, beforeId)
      m.addLayer({
        id: 'daynight-line', type: 'line', source: 'daynight',
        paint: { 'line-color': '#7dd3fc', 'line-width': 1.2, 'line-opacity': 0.35, 'line-blur': 2 },
      }, beforeId)
    } else {
      src.setData(nightPolygon())
    }
    const id = setInterval(() => {
      ;(m.getSource('daynight') as maplibregl.GeoJSONSource | undefined)?.setData(nightPolygon())
    }, 60_000)
    return () => clearInterval(id)
  }, [mapReady, overlaysOn.daynight])

  // ── Wind flow: animated particles advected through model wind ─────────────
  // Live view only — the scrubber rule says nothing animates on its own while
  // the timeline is stopped, and yesterday's replay under today's wind would
  // lie anyway. Field arrives once from /api/wind (server caches the model).
  const windStopRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (!overlaysOn.windanim || range !== 'live') return
    let cancelled = false
    fetch('/api/wind')
      .then((r) => (r.ok ? r.json() : null))
      .then((f: WindField | null) => {
        if (cancelled || !f || !Array.isArray(f.u) || !f.u.length) return
        windStopRef.current?.()
        windStopRef.current = startWindParticles(m, f)
      })
      .catch(() => { /* model down — layer just stays empty */ })
    return () => {
      cancelled = true
      windStopRef.current?.()
      windStopRef.current = null
    }
  }, [mapReady, overlaysOn.windanim, range])

  // ── Tax parcel overlay: county GIS lines + parcel numbers at street zoom ──
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return

    const ensureLayers = () => {
      if (!m.getSource('parcels')) {
        m.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
        m.addLayer({
          id: 'parcels-line', type: 'line', source: 'parcels', minzoom: PARCEL_MIN_ZOOM,
          paint: { 'line-color': '#ffd166', 'line-width': 1, 'line-opacity': 0.85 },
        }, beforeId)
        m.addLayer({
          id: 'parcels-label', type: 'symbol', source: 'parcels', minzoom: PARCEL_LABEL_MIN_ZOOM,
          layout: { 'text-field': ['get', 'parcel_label'], 'text-size': 10, 'symbol-placement': 'point' },
          paint: { 'text-color': '#ffe9b3', 'text-halo-color': 'rgba(10,15,30,0.9)', 'text-halo-width': 1.2 },
        }, beforeId)
      }
    }

    const refresh = async () => {
      if (!parcelsOn || m.getZoom() < PARCEL_MIN_ZOOM) {
        ;(m.getSource('parcels') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] })
        return
      }
      parcelAbort.current?.abort()
      const ctrl = new AbortController()
      parcelAbort.current = ctrl
      const b = m.getBounds()
      const fc = await fetchParcels(PARCEL_SERVICE_URL, {
        west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(),
      }, ctrl.signal)
      if (ctrl.signal.aborted) return
      ;(m.getSource('parcels') as maplibregl.GeoJSONSource | undefined)?.setData(fc)
    }

    if (parcelsOn) {
      ensureLayers()
      for (const id of ['parcels-line', 'parcels-label']) m.setLayoutProperty(id, 'visibility', 'visible')
      refresh()
      m.on('moveend', refresh)
      return () => { m.off('moveend', refresh); parcelAbort.current?.abort() }
    }
    for (const id of ['parcels-line', 'parcels-label']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none')
    }
  }, [mapReady, parcelsOn])

  // Build fresh radar frames whenever radar is switched on (keeps the loop live).
  useEffect(() => {
    if (!radarOn) return
    setRadarFrames(buildRadarFrames(10, 5))
    setRadarIdx(0)
  }, [radarOn])

  // Animate the radar loop — advance the frame ~1.4/sec, holding the newest a
  // beat longer so the loop "lands" on now. The loop runs ONLY on the Live
  // range: any historical range means the radar obeys the scrubber (or holds
  // the newest frame while that range's history is still loading) — a sky
  // that animates under a stopped timeline reads as data. Manual pause wins
  // everywhere.
  useEffect(() => {
    if (!radarOn || radarFrames.length === 0 || pbActive || radarPaused) {
      // Freeze on the newest observation rather than mid-loop.
      if (radarFrames.length) setRadarIdx(radarFrames.length - 1)
      return
    }
    const id = setInterval(() => {
      setRadarIdx((i) => (i + 1) % (radarFrames.length + 2)) // +2 = pause on last
    }, 700)
    return () => clearInterval(id)
  }, [radarOn, radarFrames, pbActive, radarPaused])

  // Replay mode: the radar frame FOLLOWS THE SCRUBBER — IEM's archive serves
  // any past 5-min composite, so "it rained on the site at 2 PM Tuesday" is
  // visible in the same replay as the trucks. Floored to the 5-min cadence so
  // scrubbing doesn't spam tile requests.
  const scrubRadarTs = radarOn && pbActive && realWindowEff
    ? iemTsForMs(realWindowEff.from + displayT * (realWindowEff.to - realWindowEff.from))
    : null
  const radarLabel = scrubRadarTs && realWindowEff
    ? new Date(realWindowEff.from + displayT * (realWindowEff.to - realWindowEff.from))
        .toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : currentFrame?.label ?? null

  // Add / update / toggle the radar raster layer (IEM NEXRAD composite):
  // live loop frames normally, archive frame at the scrub position in replay.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return

    const ts = scrubRadarTs ?? currentFrame?.ts
    if (!radarOn || !ts) {
      if (wxAdded.current && m.getLayer('wx-layer')) m.setLayoutProperty('wx-layer', 'visibility', 'none')
      return
    }

    // maxzoom 10: NEXRAD composite is ~1km resolution, so let MapLibre over-scale
    // beyond z10 rather than request tiles that don't add detail. Zooms far past
    // the old RainViewer z8 cap without the "Zoom Level Not Supported" tiles.
    const url = iemRadarUrl(ts)
    if (!wxAdded.current) {
      m.addSource('wx', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 10 })
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      m.addLayer({ id: 'wx-layer', type: 'raster', source: 'wx', paint: { 'raster-opacity': 0.72 } }, beforeId)
      wxAdded.current = true
    } else {
      ;(m.getSource('wx') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
      m.setLayoutProperty('wx-layer', 'visibility', 'visible')
    }
  }, [mapReady, radarOn, currentFrame, scrubRadarTs])

  // Satellite clouds — coarse (max native zoom 7) but the real sky.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (!cloudsOn) {
      if (cloudsAdded.current && m.getLayer('clouds-layer')) m.setLayoutProperty('clouds-layer', 'visibility', 'none')
      return
    }
    if (!cloudsAdded.current) {
      m.addSource('clouds', {
        type: 'raster',
        tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png'],
        tileSize: 256,
        maxzoom: 7,
        attribution: 'NASA GIBS · NOAA GOES-East',
      })
      const beforeId = m.getLayer('labels-overlay') ? 'labels-overlay'
        : m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      m.addLayer({ id: 'clouds-layer', type: 'raster', source: 'clouds', paint: { 'raster-opacity': 0.6 } }, beforeId)
      cloudsAdded.current = true
    } else {
      m.setLayoutProperty('clouds-layer', 'visibility', 'visible')
    }
    // GOES publishes a new frame ~every 10 min, but a raster source caches by
    // URL — without this the "clouds" are a screenshot of whenever the layer
    // first loaded. Cache-bust on the same cadence so the sky stays real.
    const id = setInterval(() => {
      const src = m.getSource('clouds') as maplibregl.RasterTileSource | undefined
      src?.setTiles([
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
      ])
    }, 600_000)
    return () => clearInterval(id)
  }, [mapReady, cloudsOn])

  // Storm tops — GOES-East Band 13 clean-window IR from the same GIBS service.
  // Cold (bright) = high convective tops; the classic aviation read on which
  // cells punch. ~2 km pixels, refreshed on GOES's ~10-min cadence.
  // GIBS serves this layer on GoogleMapsCompatible_Level6 (verified via
  // /diag: Level7 returns 400 XML, Level6 returns tiles) — MapLibre
  // over-scales beyond z6, which is plenty for a 2 km product.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (!stormTopsOn) {
      if (stormAdded.current && m.getLayer('stormtops-layer')) m.setLayoutProperty('stormtops-layer', 'visibility', 'none')
      return
    }
    const tileUrl =
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'
    if (!stormAdded.current) {
      m.addSource('stormtops', { type: 'raster', tiles: [tileUrl], tileSize: 256, maxzoom: 6, attribution: 'NASA GIBS · NOAA GOES-East' })
      const beforeId = m.getLayer('labels-overlay') ? 'labels-overlay'
        : m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      m.addLayer({ id: 'stormtops-layer', type: 'raster', source: 'stormtops', paint: { 'raster-opacity': 0.62 } }, beforeId)
      stormAdded.current = true
    } else {
      ;(m.getSource('stormtops') as maplibregl.RasterTileSource | undefined)?.setTiles([tileUrl])
      m.setLayoutProperty('stormtops-layer', 'visibility', 'visible')
    }
    const id = setInterval(() => {
      ;(m.getSource('stormtops') as maplibregl.RasterTileSource | undefined)?.setTiles([tileUrl])
    }, 600_000)
    return () => clearInterval(id)
  }, [mapReady, stormTopsOn])

  // Rain totals — MRMS accumulated precipitation (1h/24h/48h/72h) from IEM.
  // Same free tile service as the radar loop; maxzoom 10 (~1 km data).
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (!precipOn) {
      if (precipAdded.current && m.getLayer('precip-layer')) m.setLayoutProperty('precip-layer', 'visibility', 'none')
      return
    }
    const period = PRECIP_PERIODS.find((p) => p.key === precipPeriod) ?? PRECIP_PERIODS[1]
    const url = iemPrecipUrl(period.layer)
    if (!precipAdded.current) {
      m.addSource('precip', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 10 })
      // Slide UNDER the road/label reference overlays — the MRMS wash is
      // near-solid where rain fell, and with nothing above it you can't tell
      // what you're looking at (roads + city names stay readable on top).
      const beforeId = m.getLayer('labels-overlay') ? 'labels-overlay'
        : m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      m.addLayer({ id: 'precip-layer', type: 'raster', source: 'precip', paint: { 'raster-opacity': 0.45 } }, beforeId)
      precipAdded.current = true
    } else {
      ;(m.getSource('precip') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
      m.setLayoutProperty('precip-layer', 'visibility', 'visible')
    }
  }, [mapReady, precipOn, precipPeriod])

  // Animation loop: map sources update every frame (smooth movement), but
  // React state — scrubber, labels, cost panel — only ~10Hz, so the whole
  // overlay tree isn't re-rendered 60 times a second.
  useEffect(() => {
    if (!pbPlaying) return
    let raf = 0
    let last = performance.now()
    let lastReact = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      let next = tRef.current + (dt * speedRef.current) / windowRef.current
      if (next >= 1) { next = 1; setPbPlaying(false) }
      tRef.current = next
      updateMovementSources(next)
      focusFollow(next)
      if (next >= 1 || now - lastReact > 100) {
        lastReact = now
        setPbT(next)
      }
      if (next < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pbPlaying, updateMovementSources, focusFollow])

  const handleRange = useCallback((r: TimeRange) => {
    setRange(r)
    if (r === 'live') {
      setPbPlaying(false)
    } else {
      // Show the FULL trail for the range immediately (t=1). Play replays from
      // the start. (Previously auto-played from t=0, so the trail looked empty
      // until the animation caught up — which read as "no truck".)
      tRef.current = 1
      setPbT(1)
      // speed snaps via the windowSecondsEff effect below
      setPbPlaying(false)
      // turn a movement layer on so the trail is actually visible
      setTrailMode((prev) => (prev === 'off' ? 'trails' : prev))
    }
  }, [])

  const handlePlayPause = useCallback(() => {
    setPbPlaying((p) => {
      // Replay-from-start begins at the first recorded movement, not midnight —
      // no more watching the playhead crawl through 6 empty hours of night.
      if (!p && tRef.current >= 1) { const s = firstMoveTRef.current; tRef.current = s; setPbT(s) }
      return !p
    })
  }, [])

  const handleSeek = useCallback((v: number) => {
    setPbPlaying(false)
    tRef.current = v
    setPbT(v)
  }, [])

  // "360" — one slow, smooth revolution of whatever the screen is showing.
  // Pure bearing spin: center/zoom/pitch untouched, lands exactly where it
  // started. A touch/drag mid-spin hands the camera back instantly.
  const [spinning, setSpinning] = useState(false)
  const spinningRef = useRef(false)
  spinningRef.current = spinning
  const spinRaf = useRef(0)
  const stopSpin = useCallback(() => {
    cancelAnimationFrame(spinRaf.current)
    setSpinning(false)
  }, [])
  const handleSpin = useCallback(() => {
    const m = map.current
    if (!m) return
    if (spinningRef.current) { stopSpin(); return }
    setSpinning(true)
    const SPIN_MS = 24_000
    const start = performance.now()
    const b0 = m.getBearing()
    const frame = (now: number) => {
      if (userGestureRef.current) { setSpinning(false); return }
      const f = (now - start) / SPIN_MS
      if (f >= 1) {
        m.rotateTo(b0, { duration: 0 })
        setSpinning(false)
        return
      }
      // ease in/out over the first & last 8% so it starts and lands gently
      const g = f < 0.08 ? f * f / 0.08 : f > 0.92 ? 1 - (1 - f) * (1 - f) / 0.08 : f
      m.rotateTo((b0 + g * 360) % 360, { duration: 0 })
      spinRaf.current = requestAnimationFrame(frame)
    }
    spinRaf.current = requestAnimationFrame(frame)
  }, [stopSpin])
  useEffect(() => () => cancelAnimationFrame(spinRaf.current), [])

  // Toggle cinematic follow. Picking an asset arms a 3D chase: switch to a replay
  // range if we're live, tilt/zoom the camera up, and play the route from the top.
  useEffect(() => {
    if (!followId || range === 'live' || !realWindowEff) { setFollowHud(null); return }
    const tr = tracksEff.find((t) => t.assetId === followId)
    if (!tr || tr.points.length < 2) { setFollowHud(null); return }
    // Cumulative miles along the track, once per track change.
    const R = 3958.8
    const cum: number[] = [0]
    for (let i = 1; i < tr.points.length; i++) {
      const a = tr.points[i - 1], b = tr.points[i]
      const dLat = ((b.lat - a.lat) * Math.PI) / 180
      const dLng = ((b.lng - a.lng) * Math.PI) / 180
      const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
      cum.push(cum[i - 1] + (b.gap ? 0 : 2 * R * Math.asin(Math.sqrt(h))))
    }
    const win = realWindowEff
    const id = setInterval(() => {
      const t = tRef.current
      let lo = 0, hi = tr.points.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tr.points[mid].t <= t) lo = mid; else hi = mid - 1 }
      const ms = win.from + t * (win.to - win.from)
      setFollowHud({
        mph: tr.points[lo].mph ?? null,
        clock: new Intl.DateTimeFormat('en-US', { timeZone: tzRef.current, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)),
        milesIn: cum[lo],
      })
    }, 500)
    return () => clearInterval(id)
  }, [followId, range, realWindowEff, tracksEff])

  const handleFollow = useCallback((id: string | null) => {
    setFollowId(id)
    const m = map.current
    if (!id) {
      // Release: glide back to the flat (or 3D-base) overview.
      m?.easeTo({ pitch: threeDRef.current ? 55 : 0, bearing: 0, duration: 800 })
      return
    }
    stopSpin() // follow owns the camera — a running 360 would fight it
    // Zones have no direction of travel, so Chase silently becomes Orbit.
    if (id.startsWith('zone:') && followModeRef.current === 'chase') setFollowMode('orbit')
    setTrailMode((prev) => (prev === 'off' ? 'trails' : prev))
    if (m) { bearingRef.current = m.getBearing(); pitchRef.current = m.getPitch() }
    entranceRef.current = 0
    // Live has no scrubber — drop into Today so the route can actually replay.
    const wasLive = rangeRef.current === 'live'
    if (wasLive) handleRange('today')
    // Follow rides at 2x wall-clock: slow enough that tiles stream in ahead
    // of the camera instead of the chase outrunning the map.
    setPbSpeed(2)
    // Start the chase where the day's driving actually starts.
    tRef.current = firstMoveTRef.current
    setPbT(firstMoveTRef.current)
    setPbPlaying(true)
  }, [handleRange, stopSpin])

  // If the followed asset is filtered out or vanishes, release the camera.
  // Zone targets only release if the zone itself was deleted.
  useEffect(() => {
    if (!followId) return
    if (followId.startsWith('zone:')) {
      if (!geofences.some((g) => `zone:${g.id}` === followId)) handleFollow(null)
      return
    }
    if (!tracksEff.some((tr) => tr.assetId === followId && filter.has(tr.type))) {
      handleFollow(null)
    }
  }, [followId, tracksEff, filter, geofences, handleFollow])

  // Restore a shared replay link (?range=yesterday&t=0.42&follow=<id>): apply
  // once when the map is ready, paused at the shared moment — the recipient
  // sees exactly what the sender saw, then presses play themselves.
  const shareAppliedRef = useRef(false)
  useEffect(() => {
    if (!mapReady || shareAppliedRef.current || typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const r = q.get('range') as TimeRange | null
    if (!r || r === 'live' || !['today', 'yesterday', '7d', '30d', 'ytd', 'all', 'custom'].includes(r)) return
    shareAppliedRef.current = true
    if (r === 'custom') {
      const from = Number(q.get('from'))
      const to = Number(q.get('to'))
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
        setCustomFrom(from)
        setCustomTo(to)
      }
    }
    handleRange(r)
    const t = Math.min(1, Math.max(0, Number(q.get('t'))))
    if (Number.isFinite(t)) {
      tRef.current = t
      setPbT(t)
    }
    const follow = q.get('follow')
    if (follow) {
      // Pin the camera without auto-playing (handleFollow would start playback).
      bearingRef.current = map.current?.getBearing() ?? 0
      pitchRef.current = map.current?.getPitch() ?? 0
      entranceRef.current = 0
      setFollowId(follow)
    }
  }, [mapReady, handleRange])

  // ── Geofence drawing ──
  const handleDrawClick = useCallback((e: maplibregl.MapMouseEvent) => {
    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    drawCoords.current.push(coords)
    const pts = drawCoords.current
    if (!map.current) return
    const preview: GeoJSON.FeatureCollection = pts.length >= 3
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: {} }] }
      : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }] }
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData(preview)
  }, [])

  const startDrawing = useCallback(() => {
    if (!map.current) return
    drawCoords.current = []
    setIsDrawing(true)
    map.current.getCanvas().style.cursor = 'crosshair'
    map.current.on('click', handleDrawClick)
  }, [handleDrawClick])

  const finishDrawing = useCallback((): GeoJSON.Polygon | null => {
    if (!map.current) return null
    map.current.off('click', handleDrawClick)
    map.current.getCanvas().style.cursor = ''
    setIsDrawing(false)
    const pts = drawCoords.current
    drawCoords.current = []
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
    if (pts.length < 3) return null
    return { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
  }, [handleDrawClick])

  const cancelDrawing = useCallback(() => {
    if (!map.current) return
    map.current.off('click', handleDrawClick)
    map.current.getCanvas().style.cursor = ''
    drawCoords.current = []
    setIsDrawing(false)
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
  }, [handleDrawClick])

  return (
    <div className={'relative w-full h-full bg-navy-950' + (kiosk ? ' kiosk-map' : '')}>
      <div ref={mapContainer} className="w-full h-full" />

      {!kiosk && <FilterBar filter={filter} onChange={setFilter} showZones={showZones} onToggleZones={() => setShowZones((v) => !v)} showDevices={showDevices} onToggleDevices={isMock ? () => setShowDevices((v) => !v) : undefined} onDrawZone={!pbActive && onGeofenceSave ? startDrawing : undefined} />}

      {/* find-anything: type or talk, jump to an asset or zone */}
      {!kiosk && (
        <MapSearch
          top={58}
          items={[
            ...assets.map((a): SearchItem => ({
              kind: 'asset', id: a.id, name: a.name, type: a.type,
              sub: a.location ? `last seen ${formatRelativeTime(a.location.timestamp)}` : 'no signal yet',
            })),
            ...geofences.map((g): SearchItem => ({ kind: 'zone', id: g.id, name: g.name, color: g.color })),
          ]}
          onPick={(it) => {
            if (it.kind === 'asset') {
              const a = assets.find((x) => x.id === it.id)
              if (!a) return
              setSelectedAsset(a)
              setSelectedZone(null)
              if (a.location) map.current?.flyTo({ center: [a.location.lng, a.location.lat], zoom: 15.5, duration: 1200 })
            } else {
              const g = geofences.find((x) => x.id === it.id)
              const ring = g?.geometry?.coordinates?.[0] as [number, number][] | undefined
              if (!g || !ring?.length) return
              setSelectedZone(g)
              setSelectedAsset(null)
              let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
              for (const [lng, lat] of ring) {
                if (lng < minLng) minLng = lng
                if (lng > maxLng) maxLng = lng
                if (lat < minLat) minLat = lat
                if (lat > maxLat) maxLat = lat
              }
              map.current?.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 90, duration: 1200 })
            }
          }}
        />
      )}

      {followHud && followId && (
        <div className="absolute top-[104px] left-1/2 -translate-x-1/2 z-20 pointer-events-none flex items-center gap-3 rounded-full bg-navy-950/85 backdrop-blur border border-navy-700 shadow-panel px-4 py-1.5 font-mono text-[12px] tabular-nums">
          <span className="text-amber font-bold">{followHud.mph != null ? `${Math.round(followHud.mph)} MPH` : '— MPH'}</span>
          <span className="text-teal">{followHud.clock}</span>
          <span className="text-muted">{followHud.milesIn.toFixed(1)} mi in</span>
        </div>
      )}
      <WeatherControl
        base={base}
        onBase={setBase}
        threeD={threeD}
        onThreeD={setThreeD}
        radarOn={radarOn}
        radarPaused={radarPaused}
        onRadarPause={setRadarPaused}
        stormTopsOn={stormTopsOn}
        onStormTops={setStormTopsOn}
        onRadar={setRadarOn}
        cloudsOn={cloudsOn}
        onClouds={setCloudsOn}
        precipOn={precipOn}
        onPrecip={setPrecipOn}
        precipPeriod={precipPeriod}
        onPrecipPeriod={setPrecipPeriod}
        openView={openView}
        onOpenView={handleOpenView}
        conditions={conditions}
        pws={pws}
        frameTime={radarLabel}
        place={wxPlace}
        onPlaceChange={handlePlaceChange}
        onSaveDefault={handleSaveWeatherDefault}
        parcelsOn={parcelsOn}
        onParcels={PARCEL_SERVICE_URL ? setParcelsOn : undefined}
        overlays={[
          ...MAP_OVERLAYS.map((o) => ({ key: o.key, label: o.label, note: o.note, on: !!overlaysOn[o.key] })),
          { key: 'nwswarn', label: 'Storm warnings', note: 'NWS severe/extreme polygons · 3-min refresh', on: !!overlaysOn.nwswarn },
          { key: 'gauges', label: 'Stream gauges', note: 'USGS live gage height · zoom in, tap a dot', on: !!overlaysOn.gauges },
          { key: 'daynight', label: 'Day / night', note: 'live terminator · night side shaded · pairs with City lights', on: !!overlaysOn.daynight },
          { key: 'windanim', label: 'Wind flow', note: 'animated model wind · live view only', on: !!overlaysOn.windanim },
        ]}
        onOverlay={(key, on) => setOverlaysOn((prev) => ({ ...prev, [key]: on }))}
        views={allViews(mapViews)}
        activeViewId={activeViewId}
        defaultViewId={mapViews.defaultId}
        onApplyView={(id) => { const v = allViews(mapViews).find((x) => x.id === id); if (v) applyView(v) }}
        onSaveView={handleSaveView}
        onDeleteView={handleDeleteView}
        onSetDefaultView={handleDefaultView}
        top={kiosk ? 68 : 102}
        z={kiosk ? 45 : 10}
      />


      {!kiosk && !pbActive && (
        <GeofenceDrawer
          isDrawing={isDrawing}
          onFinishDraw={finishDrawing}
          onCancelDraw={cancelDrawing}
          onSave={onGeofenceSave}
          onLocate={(lng, lat) => map.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 1100 })}
        />
      )}

      {tracksEff.length > 0 && (
        <TimelinePlayback
          range={range}
          onRange={handleRange}
          tz={tz}
          kiosk={kiosk}
          trailMode={trailMode}
          onTrailMode={setTrailMode}
          t={pbT}
          playing={pbPlaying}
          speed={pbSpeed}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onSpeed={setPbSpeed}
          customFrom={customFrom}
          customTo={customTo}
          onCustom={(from, to) => { setCustomFrom(from); setCustomTo(to) }}
          costTotal={costTotal}
          costLabel={costLabel}
          showCost={canViewCosts}
          realWindow={realWindowEff}
          activity={activity}
          costCurve={canViewCosts ? chartCostCurve : null}
          windowSeconds={windowSecondsEff}
          followId={followId}
          onFollow={handleFollow}
          followMode={followMode}
          onFollowMode={setFollowMode}
          followAssets={tracksEff
            .filter((tr) => filter.has(tr.type) && tr.points.length > 0)
            .map((tr) => ({ id: tr.assetId, name: tr.name, type: tr.type, color: tr.color }))}
          followZones={geofences.map((g) => ({ id: `zone:${g.id}`, name: g.name, color: g.color }))}
          spinning={spinning}
          onSpin={handleSpin}
        />
      )}

      {selectedAsset && (
        <AssetPanel
          asset={selectedAsset}
          gateway={toolGateways?.[selectedAsset.id]}
          isolated={isolateId === selectedAsset.id}
          onToggleIsolate={() => setIsolateId((cur) => (cur === selectedAsset.id ? null : selectedAsset.id))}
          onClose={() => setSelectedAsset(null)}
        />
      )}

      {selectedZone && (
        <ZonePanel
          fence={selectedZone}
          presence={geofencePresence(selectedZone, assets)}
          range={range}
          t={pbActive ? displayT : 1}
          real={zoneRealAt(selectedZone.id, pbActive ? displayT : 1)}
          showCosts={canViewCosts}
          onClose={() => setSelectedZone(null)}
          canEdit={!!onGeofenceEdit}
          onEdit={onGeofenceEdit ? (id, name, color) => {
            onGeofenceEdit(id, name, color)
            setSelectedZone((z) => (z && z.id === id ? { ...z, name, color } : z))
          } : undefined}
          onDelete={onGeofenceDelete ? (id) => { onGeofenceDelete(id); setSelectedZone(null) } : undefined}
        />
      )}

      {selectedDevice && (
        <DevicePanel device={selectedDevice} onClose={() => setSelectedDevice(null)} />
      )}
    </div>
  )
}
