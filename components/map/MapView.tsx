'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AssetWithLocation, AssetType, Geofence, AlertEvent } from '@/lib/types'
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
import { twilightBands } from '@/lib/terminator'
import { startWindParticles, type WindField } from '@/lib/wind-particles'
import { allViews, loadLocalViews, saveLocalViews, type MapViewsState, type SavedMapView } from '@/lib/map-views'
import { hexHeatGeoJSON } from '@/lib/heat3d'
import { createSat3DLayer, pickSat, SKY_LAYER_ID, type Sat3D, type Plane3D, type CelestialBody, type CelestialState, type SwarmState, type PlaneTrail } from '@/lib/sat-3d'
import { sunEquatorial, moonEquatorial, subPoint, moonIllumination, norm180, EARTH_RADIUS_M, SUN_RADIUS_KM, MOON_RADIUS_KM, AU_KM } from '@/lib/celestial'
import { typeInfo } from '@/lib/aircraft-shapes'
import { MOCK_SITE_DEVICES, DEVICE_META, type SiteDevice } from '@/lib/site-devices'
import { geofencePresence } from '@/lib/site-presence'
import { synthesizeToolRows } from '@/lib/tools-resolve'
import { AssetPanel, type PanelStop } from './AssetPanel'
import { MeasureTool } from './MeasureTool'
import { POI_KIND_COLOR, POI_KIND_META } from '@/lib/poi'
import { MapSearch, type SearchItem } from './MapSearch'
import { MapTour } from './MapTour'
import { formatRelativeTime } from '@/lib/utils'
import { DevicePanel } from './DevicePanel'
import { ZonePanel } from './ZonePanel'
import { GeofenceDrawer } from './GeofenceDrawer'
import { TimelinePlayback } from './TimelinePlayback'
import { WeatherControl, type BaseStyle } from './WeatherControl'

const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// GIBS GOES tiles: the literal "default" time resolves to the START of the
// current UTC day (00:00Z = evening in the US), so the clouds layer showed a
// frozen night frame all day. But you can't just stamp "now − 40 min" either —
// the archive is gappy (DescribeDomains probe Jul 14 showed 10–50 min holes
// and 30+ min ingest latency), and a missing frame 404s to a blank sky. So ask
// GIBS which frame actually exists last, and fall back to "default" if that
// lookup fails. CORS is open (access-control-allow-origin: *), 10-min cache.
const goesTileUrl = (layer: string, level: number, stamp: string) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${stamp}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.png`

const goesStampCache: Record<string, { stamp: string; at: number }> = {}
async function goesLatestStamp(layer: string, level: number): Promise<string> {
  const hit = goesStampCache[layer]
  if (hit && Date.now() - hit.at < 590_000) return hit.stamp
  try {
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const url = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi' +
      `?SERVICE=WMTS&REQUEST=DescribeDomains&VERSION=1.0.0&LAYER=${layer}` +
      `&TILEMATRIXSET=GoogleMapsCompatible_Level${level}&bbox=-180,-90,180,90` +
      `&time=${iso(Date.now() - 12 * 3_600_000)}/${iso(Date.now() + 3_600_000)}`
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(8_000) })).text()
    // <Domain>start/end/PT10M,start/end/PT10M,…</Domain> — newest range last.
    const domain = xml.match(/<Domain>([^<]*)<\/Domain>/)?.[1] ?? ''
    const last = domain.split(',').pop()?.split('/')[1]
    if (last?.includes('T')) {
      goesStampCache[layer] = { stamp: last, at: Date.now() }
      return last
    }
  } catch { /* offline / GIBS hiccup — stale sky beats no sky */ }
  return hit?.stamp ?? 'default'
}

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
const LIVE_LAYERS = ['clusters', 'cluster-count', 'asset-pulse', 'unclustered-circle', 'unclustered-label', 'unclustered-name', 'tool-count-badge']
const HEAD_LAYERS = ['trail-heads', 'trail-head-labels', 'trail-head-tools-badge']

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

function buildGeoJSON(assets: AssetWithLocation[], filter: Set<AssetType>, toolCounts?: Record<string, number>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    // Tools live in their own unclustered source (tools-live) so they stay
    // visible in EVERY trail mode — they have no GPS history, so they never
    // get a trail head, and hiding live dots in Trails mode made them vanish.
    features: assets
      .filter((a) => a.type !== 'tool' && filter.has(a.type) && a.location)
      .map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.location!.lng, a.location!.lat] },
        properties: {
          id: a.id, name: a.name, type: a.type,
          // Tools riding this gateway — drawn as a corner count badge.
          toolCount: toolCounts?.[a.id] ?? 0,
          // Sanitize: an invalid stored color must degrade to the type color,
          // never feed the circle layers an unparseable paint value.
          color: /^#[0-9a-fA-F]{3,8}$/.test(String(a.metadata?.color ?? '')) ? String(a.metadata!.color) : ASSET_COLORS[a.type],
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

/** Tools as standalone dots — no clustering, visible in every trail mode.
 *  `state` distinguishes a live ride (fresh sighting) from a dropped tag
 *  sitting at its last-seen spot. */
function toolsGeoJSON(assets: AssetWithLocation[], filter: Set<AssetType>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: assets
      .filter((a) => a.type === 'tool' && filter.has('tool') && a.location)
      .map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.location!.lng, a.location!.lat] },
        properties: {
          id: a.id, name: a.name, type: 'tool',
          color: /^#[0-9a-fA-F]{3,8}$/.test(String(a.metadata?.color ?? '')) ? String(a.metadata!.color) : ASSET_COLORS.tool,
          state: Date.now() - new Date(a.location!.timestamp).getTime() < 25 * 60_000 ? 'live' : 'dropped',
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

function headsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number, selId?: string | null, toolCounts?: Record<string, number>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      // Empty track = no position knowledge at all — never draw a head for it
      // (positionAt's fallback is the demo center: a phantom pin in Nashville).
      .filter((tr) => filter.has(tr.type) && tr.points.length > 0)
      .map((tr) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: positionAt(tr, t) },
        // toolCount is the CURRENT ride, drawn on replay heads too — the
        // badge answers "what's in the truck NOW", whatever moment the
        // scrubber is showing (Brian asked for it on all trail modes).
        properties: { id: tr.assetId, name: tr.name, color: tr.color, sel: selId === tr.assetId ? 1 : 0, toolCount: toolCounts?.[tr.assetId] ?? 0 },
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
  /** Gateway asset id → tools riding with it (count badge + on-board list). */
  aboard?: Record<string, import('@/lib/tools-resolve').AboardTool[]>
  /** Tool-pairing episodes over the history window — replay badges show what
   *  was aboard AT the scrubbed moment, never today's state on old data. */
  pairingEpisodes?: import('@/lib/db/tools').PairingEpisode[]
  /** Floating AskAI button, rendered beside the collapsed layers pill
   *  (only the real /map passes one — demo + kiosk have no assistant). */
  askSlot?: React.ReactNode
  onGeofenceSave?: (name: string, geometry: GeoJSON.Polygon, color: string, kind: 'site' | 'boundary' | 'yard', opts?: { personal?: boolean }) => void
  /** Rename/recolor a zone from its map sheet (optimistic + persisted). */
  onGeofenceEdit?: (id: string, name: string, color: string) => void
  /** Delete a zone from its map sheet. */
  onGeofenceDelete?: (id: string) => void
  /** Recent alert events — powers the "Alert pins" site layer. */
  alerts?: AlertEvent[]
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

export function MapView({ assets, geofences, tracks = [], historyRows = null, earliestMs = null, tz = 'America/New_York', toolGateways, aboard, pairingEpisodes, askSlot, onGeofenceSave, onGeofenceEdit, onGeofenceDelete, alerts = [], kiosk = false, tourOn = true, onTourInterrupt, defaultWeatherPlace = null, defaultWeatherCoords = null, onSaveWeatherDefault, canViewCosts = true, savedMapViews = null, onSaveMapViews }: MapViewProps) {
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
  // Stops of the selected asset (published by the panel's Stops card) —
  // rendered as numbered pins so "where did it stop today" reads off the map.
  const [panelStops, setPanelStops] = useState<PanelStop[]>([])
  const panelStopMarkers = useRef<maplibregl.Marker[]>([])
  useEffect(() => {
    panelStopMarkers.current.forEach((mk) => mk.remove())
    panelStopMarkers.current = []
    const m = map.current
    if (!m || !panelStops.length) return
    const n = panelStops.length // stops arrive newest-first; pin 1 = first stop of the day
    panelStops.forEach((st, i) => {
      const color = POI_KIND_COLOR[st.kind] ?? POI_KIND_COLOR.other
      const el = document.createElement('div')
      el.style.cssText = `width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #06101c;box-shadow:0 2px 8px rgba(0,0,0,.55);display:grid;place-items:center;cursor:pointer`
      const num = document.createElement('span')
      num.textContent = String(n - i)
      num.style.cssText = 'transform:rotate(45deg);font:700 11px/1 ui-monospace,SFMono-Regular,monospace;color:#06101c'
      el.appendChild(num)
      const dur = st.minutes >= 60 ? `${Math.floor(st.minutes / 60)}h ${String(st.minutes % 60).padStart(2, '0')}m` : `${st.minutes}m`
      const when = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(st.fromMs))
      const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '240px', offset: 20 }).setHTML(
        `<div style="padding:8px 12px"><div style="font-weight:700;font-size:12.5px">${st.name}</div>` +
        `<div style="font-size:11px;color:#9fb6cc">${when} · ${dur} · ${(POI_KIND_META[st.kind] ?? POI_KIND_META.other).label}</div></div>`
      )
      panelStopMarkers.current.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([st.lng, st.lat]).setPopup(popup).addTo(m)
      )
    })
  }, [panelStops, mapReady, tz])
  const [filter, setFilter] = useState<Set<AssetType>>(new Set<AssetType>(['vehicle', 'equipment', 'personnel', 'tool']))
  // Last-session snapshot (per surface: map vs command) — the screen comes
  // back exactly how you left it: basemap, layers, 3D, trail mode, camera.
  // Read once before the state initializers below; a starred saved view
  // still overrides after mount (an explicit choice beats a remembered one).
  const lastState = useRef<Partial<{
    base: BaseStyle; threeD: boolean; terrain: boolean; radar: boolean; clouds: boolean; stormtops: boolean
    precip: boolean; precipPeriod: string; parcels: boolean; zones: boolean
    overlays: Record<string, boolean>; trailMode: TrailMode
  }>>((() => {
    try {
      const raw = typeof window !== 'undefined'
        ? localStorage.getItem(kiosk ? 'ht_last_state_command' : 'ht_last_state_map')
        : null
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })()).current
  const [showZones, setShowZones] = useState(lastState.zones ?? true)
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
  const [trailMode, setTrailMode] = useState<TrailMode>(lastState.trailMode ?? (kiosk ? 'trails' : 'off'))
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
  // Set by the Flyover block below; declared early so Follow/spin can cancel it.
  const stopFlyoverRef = useRef<(() => void) | null>(null)
  // Set once handleFollow exists; Flyover (declared earlier) releases via this.
  const handleFollowRef = useRef<(id: string | null) => void>(() => {})
  // Follow HUD: replay telemetry projected while the camera rides the asset —
  // speed at the scrub position, time of day, miles covered so far.
  const [followHud, setFollowHud] = useState<{ name: string; mph: number | null; clock: string; milesIn: number } | null>(null)
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
  const [threeD, setThreeD] = useState(lastState.threeD ?? false)
  const threeDRef = useRef(threeD)
  threeDRef.current = threeD
  // 3D terrain (the "3D map") — split from buildings & tilt (Jul 21): the
  // DEM is the expensive half and gets its own opt-in toggle.
  const [terrain3d, setTerrain3d] = useState(lastState.terrain ?? false)
  const terrain3dRef = useRef(terrain3d)
  terrain3dRef.current = terrain3d
  // Measure + takeoff tool overlay (off by default). Ref so the map's
  // click-to-select handlers can bail while measuring (clicks add vertices).
  const [measureOn, setMeasureOn] = useState(false)
  const measureOnRef = useRef(false)
  measureOnRef.current = measureOn
  // The measure toggle lives INSIDE the MapLibre control cluster (same size,
  // same column as zoom/locate/fit — owner ask, Jul 21); this ref lets React
  // paint its active state onto the DOM button.
  const measureBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const btn = measureBtnRef.current
    if (!btn) return
    btn.classList.toggle('on', measureOn)
    btn.querySelector('svg')?.setAttribute('stroke', measureOn ? '#1a1100' : '#9fb6cc')
  }, [measureOn])

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
    // trail at first fetch, so live windows re-pull; windows entirely in the
    // past stay cached. Re-pull CADENCE scales with the window: a Today tab
    // refreshing every minute is cheap, but a YTD/All tab doing that made the
    // server re-scan the entire history every 60s and dragged the whole DB
    // down ("map loading extremely slowly", Jul 21). Only the newest sliver
    // changes on big windows \u2014 minutes-stale is invisible there.
    const windowIsLive = w.to > Date.now()
    const spanDays = (w.to - w.from) / 86_400_000
    const repullMs = spanDays <= 2 ? 60_000 : spanDays <= 31 ? 5 * 60_000 : 15 * 60_000
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
    const iv = windowIsLive ? setInterval(load, repullMs) : null
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
    // Tool replay paths: the carrier's rows during each pairing episode,
    // re-keyed to the tool — a tag replays wherever its truck went while it
    // was aboard. Kept OUT of `rows` so cost/zone curves never double-count
    // the same drive once per tag riding along.
    const toolIdSet = new Set(assets.filter((a) => a.type === 'tool').map((a) => a.id))
    const toolRows = toolIdSet.size && pairingEpisodes?.length
      ? synthesizeToolRows(toolIdSet, rows, pairingEpisodes)
      : []
    return {
      tracks: tracksFromHistory(assets, rows, w.from, w.to, toolRows),
      window: w,
      cost: buildCostCurve(assets, rows, w.from, w.to),
      zones: zoneCostsFromHistory(geofences.filter((g) => fenceKind(g) === 'site'), assets, rows, w.from, w.to),
    }
  }, [historyRows, range, customFrom, customTo, earliestMs, tz, assets, geofences, fetchedRows, pairingEpisodes])

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
  // gateway id → # tools riding (fed to buildGeoJSON for the corner badge)
  const toolCounts = useMemo(() => {
    // The "2 tools" badge counts only SETTLED tags — fresh Bluetooth sighting
    // AND riding this gateway ≥10 min. Stale tags (left elsewhere) and
    // drive-by pings don't tag the truck.
    const out: Record<string, number> = {}
    for (const [gw, list] of Object.entries(aboard ?? {})) {
      const live = list.filter((t) => t.settled).length
      if (live > 0) out[gw] = live
    }
    return out
  }, [aboard])
  const toolCountsRef = useRef(toolCounts)
  toolCountsRef.current = toolCounts
  const episodesRef = useRef(pairingEpisodes)
  episodesRef.current = pairingEpisodes
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

  // "Double-click the scroll wheel to zoom to everything" — a double-click of
  // the MIDDLE mouse button (the wheel is also a button) fits the whole fleet,
  // so you can never get lost. Uses mousedown/button===1 (dblclick doesn't fire
  // for the middle button) and blocks the default middle-click autoscroll.
  const midClick = useRef(0)
  useEffect(() => {
    const el = mapContainer.current
    if (!el || !mapReady) return
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return // middle button only
      e.preventDefault() // no autoscroll cursor
      const now = e.timeStamp
      if (now - midClick.current < 500) { midClick.current = 0; fitAll() }
      else midClick.current = now
    }
    // auxclick blocks the browser's middle-click-to-open-in-new-tab side effect.
    const onAux = (e: MouseEvent) => { if (e.button === 1) e.preventDefault() }
    el.addEventListener('mousedown', onDown)
    el.addEventListener('auxclick', onAux)
    return () => { el.removeEventListener('mousedown', onDown); el.removeEventListener('auxclick', onAux) }
  }, [mapReady, fitAll])

  // ── Basemap + weather layer state ─────────────────────────────────────────
  // Default to satellite — real aerial imagery reads as "the actual jobsite".
  // Kiosk wall opens on Dark with the radar sweep — the mission-control look.
  const [base, setBase] = useState<BaseStyle>(lastState.base ?? (kiosk ? 'dark' : 'satellite'))
  const baseRef = useRef(base)
  baseRef.current = base
  const [radarOn, setRadarOn] = useState(lastState.radar ?? kiosk)
  // Manual freeze for the live radar loop (map stays put, sky stops moving).
  const [radarPaused, setRadarPaused] = useState(false)
  // GOES-East GeoColor clouds (NASA GIBS WMTS, keyless, ~10-min cadence).
  const [cloudsOn, setCloudsOn] = useState(lastState.clouds ?? false)
  // Storm tops — GOES Band 13 clean IR (cold = high tops). The ForeFlight view.
  const [stormTopsOn, setStormTopsOn] = useState(lastState.stormtops ?? false)
  const cloudsAdded = useRef(false)
  const stormAdded = useRef(false)
  // Rain totals (MRMS accumulation) — separate from the radar loop.
  const [precipOn, setPrecipOn] = useState(lastState.precip ?? false)
  const [precipPeriod, setPrecipPeriod] = useState(lastState.precipPeriod ?? PRECIP_PERIODS[1].key)
  const precipAdded = useRef(false)
  // "Map opens to" is a preference, not a layer — its picker lives in
  // Settings now; the open-behavior effect below reads ht_map_open_view.
  const [parcelsOn, setParcelsOn] = useState(lastState.parcels ?? false)
  const [overlaysOn, setOverlaysOn] = useState<Record<string, boolean>>(lastState.overlays ?? {})
  const parcelAbort = useRef<AbortController | null>(null)
  // Current zoom feeds the layers panel's visible zoom-gating rows.
  const [mapZoom, setMapZoom] = useState(11)
  const alertsRef = useRef(alerts)
  alertsRef.current = alerts
  // Per-layer raster opacity from the panel sliders — device-local.
  const [overlayOpacity, setOverlayOpacity] = useState<Record<string, number>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('ht_layer_opacity_v1') : null
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })
  useEffect(() => {
    try { localStorage.setItem('ht_layer_opacity_v1', JSON.stringify(overlayOpacity)) } catch { /* private mode */ }
  }, [overlayOpacity])

  // Remember every panel setting as it changes — next open starts here
  // (per surface: map and command center keep separate snapshots).
  useEffect(() => {
    try {
      localStorage.setItem(kiosk ? 'ht_last_state_command' : 'ht_last_state_map', JSON.stringify({
        base, threeD, terrain: terrain3d, radar: radarOn, clouds: cloudsOn, stormtops: stormTopsOn,
        precip: precipOn, precipPeriod, parcels: parcelsOn, zones: showZones,
        overlays: overlaysOn, trailMode,
      }))
    } catch { /* private mode */ }
  }, [kiosk, base, threeD, terrain3d, radarOn, cloudsOn, stormTopsOn, precipOn, precipPeriod, parcelsOn, showZones, overlaysOn, trailMode])

  // Factory reset for the whole panel — spec rule 6.
  const resetLayers = useCallback(() => {
    setBase(kiosk ? 'dark' : 'satellite')
    setThreeD(false)
    setTerrain3d(false)
    setRadarOn(kiosk)
    setRadarPaused(false)
    setCloudsOn(false)
    setStormTopsOn(false)
    setPrecipOn(false)
    setParcelsOn(false)
    setShowZones(true)
    setOverlaysOn({})
    setOverlayOpacity({})
  }, [kiosk])

  // ── Named, saveable map views ─────────────────────────────────────────────
  // A view = every layer/style toggle in one snapshot. DB copy (profile) wins
  // over the device-local copy; the default view applies on open.
  const [mapViews, setMapViews] = useState<MapViewsState>(() => savedMapViews ?? loadLocalViews())
  const [activeViewId, setActiveViewId] = useState<string | null>(null)

  const applyView = useCallback((v: SavedMapView) => {
    const c = v.cfg
    setBase(c.base)
    setThreeD(c.threeD)
    setTerrain3d(c.terrain ?? false)
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
        base, threeD, terrain: terrain3d, radar: radarOn, clouds: cloudsOn, precip: precipOn, precipPeriod,
        overlays: { ...overlaysOn }, parcels: parcelsOn, trailMode, zones: showZones,
      },
    }
    persistViews({ views: [v, ...mapViews.views].slice(0, 20), defaultId: mapViews.defaultId })
    setActiveViewId(v.id)
  }, [base, threeD, terrain3d, radarOn, cloudsOn, precipOn, precipPeriod, overlaysOn, parcelsOn, trailMode, showZones, mapViews, persistViews])

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
  // Conditions display moved to the top bar (TopBarWeather fetches its own);
  // MapView still resolves the weather PLACE (wxPlace/wxCoordsRef drive the
  // radar/layers) and keeps the fetch warm for the same 10-min cache.
  const [, setConditions] = useState<Conditions | null>(null)
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
      // Let the camera pull well back from the globe — breathing room for
      // the satellites layer instead of a planet jammed to the screen edge.
      minZoom: -2, // MapLibre's floor — far enough to see the GPS shell + GEO ring
      // Let the camera lie almost flat — near-horizon views of aircraft in
      // the sky, terrain, and the 3D activity terrain. Default cap is 60°.
      maxPitch: 85,

      attributionControl: false,
      // Follow mode drags the camera across town — keep far more tiles in
      // memory than the default so revisited areas render instantly.
      maxTileCacheSize: 4096,
    })

    // Kiosk: zoom/locate/fit ride bottom-left — top-right belongs to the event
    // rail on the wall display, and the two were stacked on top of each other.
    const ctrlCorner = kiosk ? 'bottom-left' : 'top-right'
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), ctrlCorner)

    // Rotate 90° either way, right under the compass — the compass itself is
    // the Google-style "north up, no tilt" reset (owner ask, Jul 21).
    const rotateControl: maplibregl.IControl = {
      onAdd() {
        const div = document.createElement('div')
        div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const mk = (dir: 1 | -1, title: string, svg: string) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.title = title
          b.setAttribute('aria-label', title)
          b.innerHTML = svg
          b.onclick = () => { const m2 = map.current; if (m2) m2.easeTo({ bearing: m2.getBearing() + 90 * dir, duration: 450 }) }
          div.appendChild(b)
        }
        mk(-1, 'Rotate 90° left', '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>')
        mk(1, 'Rotate 90° right', '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>')
        return div
      },
      onRemove() {},
    }
    map.current.addControl(rotateControl, ctrlCorner)

    // "Show your location" follows the convention every Google Maps user
    // already knows: the moment you locate, the map goes north-up, no tilt.
    const geoCtrl = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true })
    geoCtrl.on('trackuserlocationstart', () => map.current?.easeTo({ bearing: 0, pitch: 0, duration: 600 }))
    map.current.addControl(geoCtrl, ctrlCorner)

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

    // Measure & takeoff toggle — same cluster as zoom/locate/fit so it gets
    // their exact size and sits directly below Zoom-to-all (owner ask, Jul 21).
    if (!kiosk) {
      const measureControl: maplibregl.IControl = {
        onAdd() {
          const div = document.createElement('div')
          div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.title = 'Measure & takeoff — distance, area, tonnage'
          btn.setAttribute('aria-label', 'Measure & takeoff')
          btn.className = 'ht-measure-btn'
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.3 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>'
          btn.onclick = () => setMeasureOn((v) => !v)
          measureBtnRef.current = btn
          div.appendChild(btn)
          return div
        },
        onRemove() { measureBtnRef.current = null },
      }
      map.current.addControl(measureControl, ctrlCorner)
    }

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

      // ── Extra basemap flavors (FR24-style picker, Jul 18) ──
      // Terrain — Esri World Topo (relief + contours, free, no key).
      m.addSource('terrain-base', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, maxzoom: 19, attribution: 'Esri',
      })
      m.addLayer({ id: 'terrain-base', type: 'raster', source: 'terrain-base', layout: { visibility: 'none' } })
      // Silver — CARTO Positron (light, labeled). Plain — Positron without
      // labels. B/W reuses the Positron source with a grayscale+contrast paint.
      m.addSource('silver-base', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png'],
        tileSize: 256, maxzoom: 20, attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'silver-base', type: 'raster', source: 'silver-base', layout: { visibility: 'none' } })
      m.addSource('plain-base', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png'],
        tileSize: 256, maxzoom: 20, attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'plain-base', type: 'raster', source: 'plain-base', layout: { visibility: 'none' } })
      m.addLayer({
        id: 'bw-base', type: 'raster', source: 'silver-base', layout: { visibility: 'none' },
        paint: { 'raster-saturation': -1, 'raster-contrast': 0.3 },
      })
      // Aubergine — Voyager hue-rotated into a deep purple night map (paint
      // transform, no extra tile source).
      m.addLayer({
        id: 'aubergine-base', type: 'raster', source: 'streets-base', layout: { visibility: 'none' },
        paint: { 'raster-hue-rotate': 230, 'raster-saturation': -0.4, 'raster-brightness-max': 0.55, 'raster-brightness-min': 0.06 },
      })

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

      // DEM terrain (free AWS "terrarium" tiles, no key). Added as a source now;
      // setTerrain is toggled with 3D so the flat map stays flat by default.
      // This also powers the measure tool's live elevation readout.
      if (!m.getSource('dem')) {
        m.addSource('dem', {
          type: 'raster-dem',
          tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          // z12 mesh over-scales beyond — 16× fewer DEM tiles at street zoom
          // than z14 and visually identical at site scale ("terrain not
          // usable, slows everything down", Jul 22).
          maxzoom: 12,
        })
      }

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
      // Boundary zones render OUTLINE-ONLY — and their fill is EXCLUDED from
      // this layer entirely, because even a fully transparent fill hit-tests:
      // a county-sized perimeter was swallowing every map tap inside it
      // ("it should not click on the map — only the border", Jul 12).
      m.addLayer({
        id: 'geofence-fill', type: 'fill', source: 'geofences',
        filter: ['!=', ['get', 'kind'], 'boundary'],
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['==', ['get', 'kind'], 'yard'], 0.06, 0.14],
        },
      })
      // Boundaries stay tappable on the BORDER only: a fat, near-invisible
      // hit line under the visible dashed outline.
      m.addLayer({
        id: 'geofence-hit-line', type: 'line', source: 'geofences',
        filter: ['==', ['get', 'kind'], 'boundary'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 18, 'line-opacity': 0.04 },
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

      // Violet disc for the tools-aboard badges (live dots + trail heads) —
      // drawn once on a canvas so the symbol layers can icon-text-fit it.
      if (!m.hasImage('tool-badge')) {
        const c = document.createElement('canvas')
        c.width = 48; c.height = 48
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#a78bfa'
          ctx.strokeStyle = '#04121d'
          ctx.lineWidth = 6
          ctx.beginPath(); ctx.arc(24, 24, 19, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
          m.addImage('tool-badge', ctx.getImageData(0, 0, 48, 48), { pixelRatio: 3 })
        }
      }
      m.addSource('trail-heads', { type: 'geojson', data: headsGeoJSON(tracksRef.current, filterRef.current, 0, null, toolCountsRef.current) })
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
        // Names off past regional zoom — at state/globe scale they're noise
        // pinned to dots (owner, Jul 14). Same threshold as live-dot names.
        minzoom: 9,
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
      // Tools-aboard badge on trail heads — same projection-safe symbol badge
      // as the live dots, so Trails / Heatmap / 3D keep the count attached.
      m.addLayer({
        id: 'trail-head-tools-badge', type: 'symbol', source: 'trail-heads',
        filter: ['>', ['get', 'toolCount'], 0],
        layout: {
          'icon-image': 'tool-badge',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [2.5, 4.5, 2.5, 4.5],
          'text-field': ['to-string', ['get', 'toolCount']],
          'text-size': 9.5,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-offset': [1.0, -1.0],
          'icon-allow-overlap': true, 'text-allow-overlap': true,
          'icon-ignore-placement': true, 'text-ignore-placement': true,
          visibility: 'none',
        },
        paint: { 'text-color': '#0b0618' },
      })

      // ── Live asset cluster source ──
      m.addSource('assets', { type: 'geojson', data: buildGeoJSON(assets, filterRef.current, toolCountsRef.current), cluster: true, clusterMaxZoom: 15, clusterRadius: 40 })
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
          'circle-opacity': ['match', ['get', 'state'], 'moving', 0.38, 'idle', 0.22, 0.14],
          'circle-radius': 24, 'circle-blur': 0.7,
        },
      })
      m.addLayer({
        id: 'unclustered-circle', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 14, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#04121d',
          // Parked is the NORMAL overnight state — read as calm, never absent.
          // (0.45 made trucks near-invisible on satellite at night.)
          'circle-opacity': ['match', ['get', 'state'], 'off', 0.85, 1],
        },
      })
      m.addLayer({
        id: 'unclustered-label', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        minzoom: 6, // plain dots past state scale — emoji become smudges
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
      // Tools — their OWN unclustered source so a Bluetooth tag is visible in
      // every trail mode (they have no GPS history → no trail head; the live
      // dots hide in Trails mode, which made tools vanish entirely, Jul 16).
      // A dropped tag sits dimmer at its true last-seen spot.
      m.addSource('tools-live', { type: 'geojson', data: toolsGeoJSON(assets, filterRef.current) })
      m.addLayer({
        id: 'tool-dots', type: 'circle', source: 'tools-live',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 9,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#04121d',
          'circle-opacity': ['match', ['get', 'state'], 'dropped', 0.75, 1],
        },
      })
      m.addLayer({
        id: 'tool-dots-emoji', type: 'symbol', source: 'tools-live',
        minzoom: 6,
        layout: { 'text-field': '🔧', 'text-size': 10, 'text-allow-overlap': true },
      })
      m.addLayer({
        id: 'tool-dots-name', type: 'symbol', source: 'tools-live',
        minzoom: 9,
        layout: {
          'text-field': ['case', ['==', ['get', 'state'], 'dropped'], ['concat', ['get', 'name'], ' · left here'], ['get', 'name']],
          'text-size': 10,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.3,
          'text-justify': 'auto',
          'text-optional': true,
        },
        paint: { 'text-color': '#c4b5fd', 'text-halo-color': '#001523', 'text-halo-width': 2 },
      })

      // Tools-aboard badge: a small violet counter pinned to the dot's top-right
      // corner on any truck/machine currently carrying Bluetooth-tagged tools.
      // ONE symbol layer with icon-text-fit — circle-translate offsets warp on
      // the globe projection (the "2" floated 60px off its dot at planet zoom,
      // Jul 14); symbol text-offset is placement-space and projection-safe.
      const hasTools: maplibregl.FilterSpecification =
        ['all', ['!', ['has', 'point_count']], ['>', ['get', 'toolCount'], 0]]
      const toolBadgeLayout: NonNullable<maplibregl.SymbolLayerSpecification['layout']> = {
        'icon-image': 'tool-badge',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [3, 5, 3, 5],
        'text-field': ['to-string', ['get', 'toolCount']],
        'text-size': 10.5,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-offset': [1.15, -1.15],
        'icon-allow-overlap': true, 'text-allow-overlap': true,
        'icon-ignore-placement': true, 'text-ignore-placement': true,
      }
      m.addLayer({
        id: 'tool-count-badge', type: 'symbol', source: 'assets', filter: hasTools,
        layout: toolBadgeLayout,
        paint: { 'text-color': '#0b0618' },
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
        if (measureOnRef.current) return // measuring — clicks add vertices, not select
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
      m.on('click', 'tool-count-badge', selectAsset)
      m.on('click', 'tool-dots', selectAsset)
      m.on('mouseenter', 'tool-dots', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'tool-dots', () => { m.getCanvas().style.cursor = '' })
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
        if (measureOnRef.current) return
        const id = e.features?.[0]?.properties?.id
        const device = SITE_DEVICES.find((d) => d.id === id)
        if (!device) return
        setSelectedAsset(null)
        setSelectedZone(null)
        setSelectedDevice(device)
      })

      // Geofence zone → zone sheet (presence + cost, live-synced to the
      // timeline). Site/yard zones open from their interior (geofence-fill);
      // boundary zones open ONLY from their border (geofence-hit-line).
      const selectZoneAt = (e: maplibregl.MapLayerMouseEvent) => {
        if (measureOnRef.current) return // measuring — clicks add vertices
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
      }
      m.on('click', 'geofence-fill', selectZoneAt)
      m.on('click', 'geofence-hit-line', selectZoneAt)

      for (const layer of ['unclustered-circle', 'clusters', 'trail-heads', 'device-bg', 'device-icon', 'geofence-fill', 'geofence-hit-line']) {
        m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = '' })
      }

      // Fat-finger fallback: layer click handlers need the tap to land ON the
      // feature — a thumb on a phone often misses by a few px and hit nothing.
      // This map-level handler runs AFTER the layer handlers (registration
      // order); if none of them consumed the tap, search a padded box around
      // the finger and select the nearest pin (live or replay head).
      m.on('click', (e) => {
        if (measureOnRef.current) return // measuring — clicks add vertices
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

      // Opening view — DEFAULT is "exactly where you left it" (camera, tilt,
      // zoom — per surface, so map and command remember separately).
      // "Whole fleet" stays an explicit choice in Settings → Map opens to.
      const camKey = kiosk ? 'ht_command_last_camera' : 'ht_map_last_camera'
      let openedFromSaved = false
      try {
        if (localStorage.getItem('ht_map_open_view') !== 'fit') {
          const saved = JSON.parse(localStorage.getItem(camKey) ?? 'null')
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

      // Remember the camera (throttled via moveend) — per surface.
      m.on('moveend', () => {
        try {
          const c = m.getCenter()
          localStorage.setItem(camKey, JSON.stringify({
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
    source?.setData(buildGeoJSON(visible, filter, toolCounts))
    const tools = map.current?.getSource('tools-live') as maplibregl.GeoJSONSource | undefined
    // Replaying with trails on: a tool that has a synthesized track gets a
    // moving trail head like any other asset — drop its static "now" dot so
    // the same tag isn't on the map twice. Tools with no episodes in the
    // window keep the dot (their only truthful position).
    const replayToolIds = range !== 'live' && trailMode !== 'off'
      ? new Set(tracksEff.filter((tr) => tr.type === 'tool' && tr.points.length > 0).map((tr) => tr.assetId))
      : null
    tools?.setData(toolsGeoJSON(replayToolIds ? visible.filter((a) => !replayToolIds.has(a.id)) : visible, filter))
  }, [mapReady, assets, filter, isolateId, toolCounts, range, trailMode, tracksEff])

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
    let trs = iso ? tracksRef.current.filter((tr) => tr.assetId === iso) : tracksRef.current
    // LIVE + trails: tools keep their single tools-live dot (current truth,
    // "left here" labels) — a trail head on top painted the same tag twice
    // (Tool A aboard the Ram AND left near Hawkins Rd, Jul 17). Replay ranges
    // are the opposite: the head IS the tool marker and the dot hides.
    if (rangeRef.current === 'live') trs = trs.filter((tr) => tr.type !== 'tool')
    // Replay heads show what was aboard AT the scrubbed moment (pairing_log
    // episodes) — never today's tools painted onto last week's map. Live (and
    // demo, which has no log) uses the current associations. No episodes for
    // that moment = no badge; honest blank beats a plausible wrong number.
    let counts = toolCountsRef.current
    if (rangeRef.current !== 'live' && !isMock) {
      counts = {}
      const win = realWindowRef.current
      if (win) {
        const ts = win.from + t * (win.to - win.from)
        for (const ep of episodesRef.current ?? []) {
          if (ep.startMs <= ts && (ep.endMs == null || ep.endMs >= ts)) {
            counts[ep.carrier] = (counts[ep.carrier] ?? 0) + 1
          }
        }
      }
    }
    ;(m.getSource('trail-heads') as maplibregl.GeoJSONSource | undefined)?.setData(headsGeoJSON(trs, filterRef.current, t, sel, counts))
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
        : base === 'streets' || base === 'aubergine' ? 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
        : base === 'terrain' ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
        : base === 'silver' || base === 'bw' ? 'https://a.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png'
        : base === 'plain' ? 'https://a.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png'
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
      // Every paint write forces a full repaint — free on the flat map, but
      // with 3D terrain each one re-renders the whole terrain pipeline, and
      // this 60fps heartbeat alone pinned a desktop GPU ("terrain not
      // usable", Jul 22). Steady dots while terrain is on.
      if (!terrain3dRef.current && m.getLayer('asset-pulse')) {
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
    if (!mapReady || !followId || pbPlaying || range === 'live') return
    focusFollow(displayT)
  }, [mapReady, followId, pbPlaying, displayT, focusFollow, range])

  // LIVE follow: same camera modes as replay follow, but the target is the
  // asset's LATEST fix (t=1 of the live track, which realtime keeps fresh).
  // Runs its own frame loop so Orbit keeps gliding while the truck sits still.
  useEffect(() => {
    if (!mapReady || !followId || range !== 'live') return
    let raf = 0
    const loop = () => {
      focusFollow(1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [mapReady, followId, range, focusFollow])

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

  // Switch basemap layers. 'dark' is the underlying style; every other flavor
  // is a raster layer toggled over it (B/W + Aubergine are paint-transformed
  // views of the Positron/Voyager sources).
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m?.getLayer('sat-base')) return
    const set = (id: string, on: boolean) => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    set('streets-base', base === 'streets')
    set('sat-base', base === 'satellite' || base === 'hybrid')
    set('terrain-base', base === 'terrain')
    set('silver-base', base === 'silver')
    set('plain-base', base === 'plain')
    set('bw-base', base === 'bw')
    set('aubergine-base', base === 'aubergine')
    set('labels-overlay', base === 'hybrid' || base === 'aubergine')
  }, [mapReady, base])

  // 3D buildings & tilt — buildings + camera tilt only, layerable on any
  // basemap. While following, the follow camera owns the pitch, so don't
  // fight it. TERRAIN is deliberately NOT here anymore: piggybacking the DEM
  // onto this toggle (Jul 17) is what made "3D buildings" suddenly heavy —
  // "it used to work fine" (owner, Jul 21). Terrain has its own toggle below.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m?.getLayer('buildings-3d')) return
    m.setLayoutProperty('buildings-3d', 'visibility', threeD ? 'visible' : 'none')
    if (!followIdRef.current) m.easeTo({ pitch: threeD || terrain3d ? 55 : 0, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, threeD])

  // 3D terrain (the "3D map") — real DEM elevation relief; mountains rise and
  // the measure tool gets its elevation readout. The expensive one, opt-in.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    // Wrapped defensively — a DEM tile hiccup must never blank the map.
    try {
      if (terrain3d && m.getSource('dem')) m.setTerrain({ source: 'dem', exaggeration: 1.3 })
      else m.setTerrain(null)
    } catch { /* terrain unsupported / source not ready — ignore */ }
    if (!followIdRef.current) m.easeTo({ pitch: terrain3d || threeD ? 55 : 0, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, terrain3d])

  // Toggle visibility of all geofence layers at once
  useEffect(() => {
    const m = map.current
    if (!mapReady) return
    for (const id of ['geofence-fill', 'geofence-hit-line', 'geofence-outline', 'geofence-labels', 'geofence-labels-full']) {
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

  // RTMA WMS layer names are discovered from the server's capabilities, not
  // trusted from our hardcoded guesses — a wrong/renamed LAYERS= draws
  // nothing, silently. null = not fetched yet; {} = discovery failed, use
  // the configured defaults.
  const RTMA_KEYS = useMemo(() => ['temp', 'feels', 'wind', 'lightning'] as const, [])
  type RtmaDiscovered = { temp?: string | null; feels?: string | null; wind?: string | null; lightning?: string | null }
  const [rtmaNames, setRtmaNames] = useState<RtmaDiscovered | null>(null)
  const rtmaWanted = RTMA_KEYS.some((k) => overlaysOn[k])
  useEffect(() => {
    if (!rtmaWanted || rtmaNames !== null) return
    let cancelled = false
    fetch('/api/rtma-layers')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: RtmaDiscovered | null) => {
        if (!cancelled) setRtmaNames(j ?? {})
      })
      .catch(() => { if (!cancelled) setRtmaNames({}) })
    return () => { cancelled = true }
  }, [rtmaWanted, rtmaNames])

  // ── Free national overlays (topo, hillshade, wetlands, streams) ───────────
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    for (const o of MAP_OVERLAYS) {
      const on = !!overlaysOn[o.key]
      const srcId = `ovl-${o.key}`
      const layerId = `ovl-${o.key}-layer`
      const isRtma = (RTMA_KEYS as readonly string[]).includes(o.key)
      // RTMA overlays wait for name discovery so the source is created with
      // the right LAYERS= the first time (effect re-runs when names arrive).
      if (on && isRtma && rtmaNames === null) continue
      if (on && !m.getSource(srcId)) {
        let tiles = o.tiles
        if (isRtma) {
          const real = rtmaNames?.[o.key as 'temp' | 'feels' | 'wind' | 'lightning']
          if (real) tiles = tiles.replace(/LAYERS=[^&]+/, `LAYERS=${encodeURIComponent(real)}`)
          else if (o.key === 'lightning' && rtmaNames) {
            // Discovery-only layer: without a real name the placeholder would
            // just draw nothing — say so on the row instead.
            window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'lightning', msg: 'NOAA is not publishing a lightning layer right now' } }))
            continue
          }
        }
        m.addSource(srcId, { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: o.maxzoom })
        const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
        m.addLayer(
          { id: layerId, type: 'raster', source: srcId, minzoom: o.minzoom, paint: { 'raster-opacity': overlayOpacity[o.key] ?? o.opacity } },
          beforeId
        )
      }
      if (m.getLayer(layerId)) m.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, overlaysOn, rtmaNames])

  // Raster tiles that fail to load (moved WMS layer, dead service, blocked
  // request) used to die in silence — the row looked on, the map drew
  // nothing. Surface each failing overlay ONCE per session on its panel row.
  const tileErrReported = useRef<Set<string>>(new Set())
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const onErr = (e: unknown) => {
      const sid = (e as { sourceId?: string }).sourceId
      if (!sid || !sid.startsWith('ovl-')) return
      const key = sid.slice(4)
      if (tileErrReported.current.has(key)) return
      tileErrReported.current.add(key)
      window.dispatchEvent(new CustomEvent('ht:layer-error', {
        detail: { key, msg: 'feed not returning imagery — check /diag' },
      }))
    }
    m.on('error', onErr)
    return () => { m.off('error', onErr) }
  }, [mapReady])

  // Panel opacity sliders → live raster opacity (overlays + special rasters).
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    for (const o of MAP_OVERLAYS) {
      const v = overlayOpacity[o.key]
      const layerId = `ovl-${o.key}-layer`
      if (v != null && m.getLayer(layerId)) m.setPaintProperty(layerId, 'raster-opacity', v)
    }
    // Radar lives outside MAP_OVERLAYS (its own frame loop) — same slider.
    const rv = overlayOpacity.radar
    if (rv != null && m.getLayer('wx-layer')) m.setPaintProperty('wx-layer', 'raster-opacity', rv)
  }, [mapReady, overlayOpacity, overlaysOn, radarOn])

  // Track zoom for the layers panel's "zoom in/out to see this" rows.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const upd = () => setMapZoom(m.getZoom())
    upd()
    m.on('zoomend', upd)
    return () => { m.off('zoomend', upd) }
  }, [mapReady])

  // ── Alert pins: where alerts fired (last 7 days), pinned to the zone the
  // rule watches — alert events don't store coordinates, so the zone IS the
  // honest location. Tap for the list of hits there.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.alertpins
    for (const lid of ['alert-pins', 'alert-pins-mark']) {
      if (m.getLayer(lid)) m.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none')
    }
    if (!on) return
    const cutoff = Date.now() - 7 * 86_400_000
    // Group by zone so five alerts at the yard become one pin with a count.
    const byZone = new Map<string, { cx: number; cy: number; lines: string[] }>()
    for (const a of alertsRef.current) {
      if (new Date(a.triggered_at).getTime() < cutoff) continue
      const g = a.rule?.geofence
      const ring = g?.geometry?.coordinates?.[0] as [number, number][] | undefined
      if (!g || !ring?.length) continue
      let e = byZone.get(g.id)
      if (!e) {
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
        const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
        byZone.set(g.id, (e = { cx, cy, lines: [] }))
      }
      e.lines.push(`${a.asset?.name ?? 'Asset'} · ${(a.rule?.trigger ?? 'alert').replace(/_/g, ' ')}`)
    }
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: Array.from(byZone.values()).map((e) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.cx, e.cy] },
        properties: { count: e.lines.length, list: e.lines.slice(0, 6).join('<br/>') },
      })),
    }
    const src = m.getSource('alertpins') as maplibregl.GeoJSONSource | undefined
    if (!src) {
      m.addSource('alertpins', { type: 'geojson', data })
      m.addLayer({
        id: 'alert-pins', type: 'circle', source: 'alertpins',
        paint: { 'circle-radius': 9, 'circle-color': '#ff5d5d', 'circle-opacity': 0.9, 'circle-stroke-color': '#001523', 'circle-stroke-width': 2 },
      })
      m.addLayer({
        id: 'alert-pins-mark', type: 'symbol', source: 'alertpins',
        layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 10, 'text-allow-overlap': true, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': '#001523' },
      })
      m.on('click', 'alert-pins', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        new maplibregl.Popup({ closeButton: false, maxWidth: '250px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 12px;font:11.5px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#ff5d5d">Alerts here · last 7 days</div><div style="margin-top:3px">${p.list}</div></div>`)
          .addTo(m)
      })
      m.on('mouseenter', 'alert-pins', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'alert-pins', () => { m.getCanvas().style.cursor = '' })
    } else {
      src.setData(data)
    }
    window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'alertpins', at: Date.now() } }))
  }, [mapReady, overlaysOn.alertpins])

  // ── Storm warning polygons — IEM storm-based warnings, colored by TYPE ────
  // (The old NWS feed filtered to Extreme/Severe severity and capped at 500
  //  national rows, so on most days it drew nothing — "not working", Jul 12.)
  // IEM serves just the ACTIVE warning polygons nationwide: small payload,
  // keyless, phenomena-coded. NWS-convention colors: tornado red, severe
  // t-storm orange, flood green, marine purple, snow squall blue. No zoom
  // gating — a tornado polygon should be visible from any altitude.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.nwswarn
    if (m.getLayer('nws-fill')) {
      m.setLayoutProperty('nws-fill', 'visibility', on ? 'visible' : 'none')
      m.setLayoutProperty('nws-line', 'visibility', on ? 'visible' : 'none')
      if (m.getLayer('spc-watch-line')) m.setLayoutProperty('spc-watch-line', 'visibility', on ? 'visible' : 'none')
    } else if (on) {
      m.addSource('nws-alerts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      // SPC watch boxes — the big multi-hour "conditions are ripe" outlines
      // (what weather apps draw as a huge pink/yellow perimeter). Dashed,
      // outline-only (no fill = no click-swallowing), drawn UNDER warnings.
      m.addSource('spc-watches', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'spc-watch-line', type: 'line', source: 'spc-watches',
        paint: {
          'line-color': ['match', ['get', 'wt'], 'TOR', '#f43f5e', '#eab308'] as unknown as string,
          'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [2.5, 1.8],
        },
      }, beforeId)
      const phenColor = ['match', ['get', 'ph'],
        'TO', '#ff2b2b', 'EW', '#ff2b2b',           // tornado / extreme wind
        'SV', '#ff9e16',                             // severe thunderstorm
        'FF', '#22c55e', 'FL', '#22c55e',            // flash flood / flood
        'MA', '#a78bfa',                             // marine
        'SQ', '#38bdf8',                             // snow squall
        'DS', '#d97706',                             // dust storm
        '#eab308'] as unknown as string              // anything else — yellow
      m.addLayer({ id: 'nws-fill', type: 'fill', source: 'nws-alerts', paint: { 'fill-color': phenColor, 'fill-opacity': 0.16 } }, beforeId)
      m.addLayer({ id: 'nws-line', type: 'line', source: 'nws-alerts', paint: { 'line-color': phenColor, 'line-width': 2, 'line-opacity': 0.9 } }, beforeId)
      m.on('click', 'nws-fill', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        new maplibregl.Popup({ closeButton: false, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#ff9e16">${p.label}</div><div style="color:#9fb6cc;font-size:10.5px;margin-top:2px">until ${p.until}</div></div>`)
          .addTo(m)
      })
    }
    if (!on) return
    let cancelled = false
    const PHEN_LABEL: Record<string, string> = {
      TO: 'Tornado Warning', SV: 'Severe Thunderstorm Warning', FF: 'Flash Flood Warning',
      FL: 'Flood Warning', MA: 'Marine Warning', SQ: 'Snow Squall Warning',
      DS: 'Dust Storm Warning', EW: 'Extreme Wind Warning',
    }
    const load = () =>
      fetch('https://mesonet.agron.iastate.edu/geojson/sbw.geojson')
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { features?: Array<GeoJSON.Feature & { properties?: { phenomena?: string; expire?: string } }> } | null) => {
          if (cancelled || !j?.features) return
          const features = j.features
            .filter((f) => f.geometry)
            .map((f) => ({
              type: 'Feature' as const,
              geometry: f.geometry as GeoJSON.Geometry,
              properties: {
                ph: f.properties?.phenomena ?? '??',
                label: PHEN_LABEL[f.properties?.phenomena ?? ''] ?? `${f.properties?.phenomena ?? ''} warning`,
                until: f.properties?.expire
                  ? new Date(f.properties.expire).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                  : '—',
              },
            }))
          ;(m.getSource('nws-alerts') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
          window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'nwswarn', at: Date.now() } }))
        })
        .catch(() => { /* IEM hiccup — keep the last polygons */ })
    // Active SPC watches — via OUR /api/watches proxy (SPC's KML has no
    // CORS, and two direct IEM guesses served HTML error pages in prod).
    const loadWatches = () =>
      fetch('/api/watches')
        .then((r) => (r.ok ? r.json() : null))
        .then((j: GeoJSON.FeatureCollection | null) => {
          if (cancelled || !j?.features) return
          ;(m.getSource('spc-watches') as maplibregl.GeoJSONSource | undefined)?.setData(j)
        })
        .catch(() => { /* no watch feed — warnings still draw */ })
    load()
    loadWatches()
    const id = setInterval(load, 2 * 60_000)
    const idW = setInterval(loadWatches, 5 * 60_000)
    return () => { cancelled = true; clearInterval(id); clearInterval(idW) }
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
          window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'gauges', at: Date.now() } }))
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

  // ── Community weather stations (Ambient public network via our proxy) ─────
  // Temp-colored dots at neighborhood zoom; tap one for the full reading.
  const pwsCacheRef = useRef(new Map<string, GeoJSON.Feature>())
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.pwsnet
    if (m.getLayer('pws-dots')) m.setLayoutProperty('pws-dots', 'visibility', on ? 'visible' : 'none')
    else if (on) {
      m.addSource('pwsnet', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('clusters') ? 'clusters' : undefined
      m.addLayer({
        id: 'pws-dots', type: 'circle', source: 'pwsnet', minzoom: 8,
        paint: {
          'circle-radius': 5.5,
          'circle-color': [
            'case', ['==', ['get', 'tempF'], -999], '#64748b',
            ['interpolate', ['linear'], ['get', 'tempF'], 20, '#60a5fa', 50, '#2dd4bf', 75, '#ff9e16', 95, '#ff5d5d'],
          ],
          'circle-stroke-color': '#001523', 'circle-stroke-width': 1.5, 'circle-opacity': 0.92,
        },
      }, beforeId)
      m.on('click', 'pws-dots', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        const t = p.tempF !== -999 ? `${Math.round(p.tempF)}°` : '—'
        const feels = p.feelsF !== -999 && Math.round(p.feelsF) !== Math.round(p.tempF) ? ` · feels ${Math.round(p.feelsF)}°` : ''
        const wind = p.windMph !== -999 ? `wind ${Math.round(p.windMph)}${p.gustMph !== -999 ? `–${Math.round(p.gustMph)}` : ''} mph` : ''
        const hum = p.humidity !== -999 ? ` · ${Math.round(p.humidity)}%` : ''
        const rain = p.rainInHr > 0 ? `<div style="color:#7dd3fc">rain ${p.rainInHr}"/hr</div>` : ''
        const age = p.ageMin !== -999 ? `updated ${p.ageMin}m ago` : ''
        // Dark popup theme has zero padding — HTML brings its own (gauge lesson).
        new maplibregl.Popup({ closeButton: false, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#7dd3fc;white-space:normal;overflow-wrap:break-word">${p.name}</div><div style="margin-top:3px;font-size:16px;font-weight:800;color:#ff9e16">${t}<span style="font-size:11px;font-weight:600;color:#e8f0f7">${feels}</span></div><div>${wind}${hum}</div>${rain}<div style="color:#9fb6cc;font-size:10.5px;margin-top:2px">${age}</div></div>`)
          .addTo(m)
      })
      m.on('mouseenter', 'pws-dots', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'pws-dots', () => { m.getCanvas().style.cursor = '' })
    }
    if (!on) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    // Station cache keyed by id: each fetch MERGES into it instead of
    // replacing the source outright — a mid-zoom refetch that returned a
    // different sample used to blank dots that were plainly still in view.
    // Prune only what's drifted far outside the current viewport.
    const cache = pwsCacheRef.current
    const load = () => {
      if (m.getZoom() < 8) return
      const b = m.getBounds()
      // Padded bbox: fetch one viewport-width beyond every edge so small
      // pans/zooms land on already-cached dots.
      const padW = (b.getEast() - b.getWest())
      const padH = (b.getNorth() - b.getSouth())
      const bbox = [b.getWest() - padW, b.getSouth() - padH, b.getEast() + padW, b.getNorth() + padH].map((v) => v.toFixed(3)).join(',')
      fetch(`/api/pws-stations?bbox=${bbox}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { stations?: { id: string; name: string; lat: number; lng: number; tempF: number | null; feelsF: number | null; windMph: number | null; gustMph: number | null; humidity: number | null; rainInHr: number | null; ageMin: number | null }[] } | null) => {
          if (cancelled || !j?.stations) return
          for (const s of j.stations) {
            cache.set(s.id ?? `${s.lat},${s.lng}`, {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
              // -999 sentinel: expressions and popup HTML can't branch on null.
              properties: {
                name: s.name,
                tempF: s.tempF ?? -999, feelsF: s.feelsF ?? -999,
                windMph: s.windMph ?? -999, gustMph: s.gustMph ?? -999,
                humidity: s.humidity ?? -999, rainInHr: s.rainInHr ?? 0,
                ageMin: s.ageMin ?? -999,
              },
            })
          }
          // Drop stations more than ~3 viewport-widths out (unbounded growth).
          const keepW = padW * 3, keepH = padH * 3
          for (const [k, f] of Array.from(cache.entries())) {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
            if (lng < b.getWest() - keepW || lng > b.getEast() + keepW || lat < b.getSouth() - keepH || lat > b.getNorth() + keepH) cache.delete(k)
          }
          ;(m.getSource('pwsnet') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: Array.from(cache.values()) })
          window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'pwsnet', at: Date.now() } }))
        })
        .catch(() => { /* feed down — keep last dots */ })
    }
    const onMove = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 900)
    }
    load()
    m.on('moveend', onMove)
    return () => { cancelled = true; if (timer) clearTimeout(timer); m.off('moveend', onMove) }
  }, [mapReady, overlaysOn.pwsnet])

  // ── The sky: satellites + sun/moon/stars + live aircraft ─────────────────
  // One custom WebGL layer (lib/sat-3d.ts) renders everything above the map
  // at TRUE position and scale. Satellites propagate in-browser from TLEs;
  // sun/moon come from live ephemeris; stars are the Yale catalog on a
  // sidereal shell; aircraft are live ADS-B. Far-side bodies hide behind
  // the planet geometrically.
  const satRecsRef = useRef<{ name: string; group: string; norad: string | null; rec: unknown }[] | null>(null)
  const satLibRef = useRef<typeof import('satellite.js') | null>(null)
  const satsRef = useRef<Sat3D[] | null>(null)
  const celestialRef = useRef<CelestialState | null>(null)
  const starCatRef = useRef<{ ra: number; dec: number; mag: number; bv: number }[] | null>(null)
  const planesRef = useRef<Plane3D[] | null>(null)
  const planePrevRef = useRef<Map<string, { track: number; at: number }>>(new Map())
  // Rolling flight-path history per aircraft (flat lon,lat,altM triplets),
  // accumulated each poll; a clicked plane's path renders as a 3D trail.
  const planeHistRef = useRef<Map<string, number[]>>(new Map())
  const selPlaneRef = useRef<string | null>(null)
  const planeTrailRef = useRef<PlaneTrail | null>(null)
  // Real recent track per hex, backfilled once from adsb.lol (flat triplets).
  const traceRef = useRef<Map<string, number[]>>(new Map())
  // Set by the sky-layer effect so the plane poll can refresh a live trail.
  const rebuildTrailRef = useRef<(() => void) | null>(null)
  const swarmRef = useRef<SwarmState | null>(null)
  const swarmWorkerRef = useRef<Worker | null>(null)

  // Sky playback: satellites/sun/moon/stars obey the timeline. Replaying a
  // range renders the sky AS IT WAS at the scrubbed moment (SGP4 + ephemeris
  // run at any time); paused means frozen — the scrubber rule applies to
  // orbits too. simTimeRef is null on Live.
  const simTimeRef = useRef<number | null>(null)
  simTimeRef.current = range !== 'live' && realWindowEff
    ? realWindowEff.from + displayT * (realWindowEff.to - realWindowEff.from)
    : null
  const skyKickRef = useRef<(() => void) | null>(null)
  const dayNightKickRef = useRef<(() => void) | null>(null)
  const skyKickWall = useRef(0)
  useEffect(() => {
    // Throttled: scrub drags fire at 60fps; the sky repaints ≤ ~3×/s and the
    // regular tick trues it up within 2s of the drag ending.
    const noww = Date.now()
    if (noww - skyKickWall.current < 300) return
    skyKickWall.current = noww
    skyKickRef.current?.()
    dayNightKickRef.current?.()
    swarmWorkerRef.current?.postMessage({ simOffset: simTimeRef.current != null ? simTimeRef.current - Date.now() : null })
  }, [displayT, range])

  // Sky-layer lifecycle + shared click/hover — lives while EITHER toggle is on.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.satellites || !!overlaysOn.planes
    if (!on) {
      if (m.getLayer(SKY_LAYER_ID)) m.removeLayer(SKY_LAYER_ID)
      return
    }
    if (!m.getLayer(SKY_LAYER_ID)) {
      try {
        m.addLayer(createSat3DLayer(() => satsRef.current, () => celestialRef.current, () => planesRef.current, () => swarmRef.current, () => planeTrailRef.current))
      } catch { /* WebGL edge case — layer stays off */ }
    }
    const kindLabel = (g: string) =>
      g === 'gps' ? 'GPS fleet' : g === 'weather' ? 'Weather satellite' : g === 'stations' ? 'Station' : 'Satellite'
    const popup = (lngLat: maplibregl.LngLatLike, html: string) => {
      new maplibregl.Popup({ closeButton: false, maxWidth: '250px' })
        .setLngLat(lngLat)
        .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7">${html}</div>`)
        .addTo(m)
    }
    const pickAll = (x: number, y: number) => {
      const cel = celestialRef.current
      const bodies = [cel?.sun, cel?.moon].filter(Boolean) as CelestialBody[]
      return (
        pickSat(satsRef.current, x, y) ??
        (pickSat(planesRef.current, x, y) as Sat3D | Plane3D | CelestialBody | null) ??
        pickSat(bodies, x, y, 20)
      )
    }
    // Selected aircraft's trail = its real recent track (backfilled once)
    // followed by everything we've watched live since, newest last.
    const rebuildPlaneTrail = () => {
      const hex = selPlaneRef.current
      if (!hex) { planeTrailRef.current = null; m.triggerRepaint(); return }
      const trace = traceRef.current.get(hex) ?? []
      const hist = planeHistRef.current.get(hex) ?? []
      const flat = trace.concat(hist)
      const n = Math.floor(flat.length / 3)
      if (n < 2) { planeTrailRef.current = null; m.triggerRepaint(); return }
      planeTrailRef.current = { pts: new Float32Array(flat), n }
      m.triggerRepaint()
    }
    rebuildTrailRef.current = rebuildPlaneTrail
    const backfillTrace = (hex: string) => {
      if (traceRef.current.has(hex)) return
      fetch(`/api/plane-track?hex=${hex}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { pts?: [number, number, number][] }) => {
          if (!j.pts?.length) { traceRef.current.set(hex, []); return }
          traceRef.current.set(hex, j.pts.flat())
          if (selPlaneRef.current === hex) rebuildPlaneTrail()
        })
        .catch(() => { traceRef.current.set(hex, []) })
    }
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const hit = pickAll(e.point.x, e.point.y)
      if (!hit) {
        // Tap on empty sky clears the trail.
        if (selPlaneRef.current) { selPlaneRef.current = null; planeTrailRef.current = null; m.triggerRepaint() }
        return
      }
      if ('kind' in hit) {
        if (hit.kind === 'sun') {
          popup(e.lngLat, `<div style="font-weight:700;color:#ffd479">Sun</div><div style="margin-top:3px">${hit.distLabel}</div>`)
        } else {
          popup(e.lngLat, `<div style="font-weight:700;color:#cdd5df">Moon</div><div style="margin-top:3px">${hit.distLabel}</div>${hit.illum != null ? `<div>${Math.round(hit.illum * 100)}% illuminated</div>` : ''}`)
        }
      } else if ('hex' in hit) {
        const title = hit.flight ?? hit.reg ?? hit.hex.toUpperCase()
        const kindLine = [hit.typeLabel ?? hit.typeCode, hit.reg && hit.reg !== title ? hit.reg : null].filter(Boolean).join(' · ') || 'aircraft'
        // Draw this aircraft's 3D flight trail: whatever we've watched so far,
        // backfilled with its real recent track from adsb.lol.
        selPlaneRef.current = hit.hex
        rebuildPlaneTrail()
        backfillTrace(hit.hex)
        popup(e.lngLat, `<div style="font-weight:700;color:#ffd94f">✈ ${title}</div><div style="color:#9fb6cc;font-size:10.5px">${kindLine}</div><div style="margin-top:3px">altitude <b style="color:#ff9e16">${hit.altFt.toLocaleString()} ft</b></div>${hit.mph ? `<div>speed ${hit.mph.toLocaleString()} mph</div>` : ''}<div style="color:#9fb6cc;margin-top:3px">flight trail on — tap empty sky to clear</div>`)
      } else {
        const facts: string[] = []
        if (hit.periodMin) facts.push(`orbits Earth every ${hit.periodMin >= 90 * 12 ? (hit.periodMin / 60).toFixed(1) + ' h' : Math.round(hit.periodMin) + ' min'}`)
        if (hit.inclDeg != null) facts.push(`${hit.inclDeg.toFixed(1)}° inclination`)
        const link = hit.norad
          ? `<a href="https://www.n2yo.com/satellite/?s=${hit.norad}" target="_blank" rel="noopener" style="display:inline-block;margin-top:5px;color:#2dd4bf;font-weight:600">full details & live track →</a>`
          : ''
        popup(e.lngLat, `<div style="font-weight:700;color:#7dd3fc">${hit.name}</div><div style="color:#9fb6cc;font-size:10.5px">${kindLabel(hit.group)}${hit.norad ? ` · NORAD ${hit.norad}` : ''}</div><div style="margin-top:3px">altitude <b style="color:#ff9e16">${Math.round(hit.altKm).toLocaleString()} km</b> (${Math.round(hit.altKm * 0.6214).toLocaleString()} mi)</div>${hit.mph ? `<div>speed ${hit.mph.toLocaleString()} mph</div>` : ''}${facts.length ? `<div style="color:#9fb6cc">${facts.join(' · ')}</div>` : ''}${link}`)
      }
    }
    let skyHover = false
    const onHover = (e: maplibregl.MapMouseEvent) => {
      const hit = !!pickAll(e.point.x, e.point.y)
      if (hit && !skyHover) { skyHover = true; m.getCanvas().style.cursor = 'pointer' }
      else if (!hit && skyHover) { skyHover = false; m.getCanvas().style.cursor = '' }
    }
    m.on('click', onClick)
    m.on('mousemove', onHover)
    return () => {
      m.off('click', onClick)
      m.off('mousemove', onHover)
      rebuildTrailRef.current = null
      if (skyHover) m.getCanvas().style.cursor = ''
    }
  }, [mapReady, overlaysOn.satellites, overlaysOn.planes])

  // Satellites + celestial data (the Satellites toggle owns the whole sky look).
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (!overlaysOn.satellites) {
      satsRef.current = null
      celestialRef.current = null
      m.triggerRepaint()
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        if (!satLibRef.current) satLibRef.current = await import('satellite.js')
        const sat = satLibRef.current
        if (!satRecsRef.current) {
          const r = await fetch('/api/satellites')
          if (!r.ok) throw new Error(`feed ${r.status}`)
          const j: { sats?: { name: string; l1: string; l2: string; group: string; norad?: string }[] } = await r.json()
          satRecsRef.current = (j.sats ?? []).map((s) => ({ name: s.name, group: s.group, norad: s.norad ?? null, rec: sat.twoline2satrec(s.l1, s.l2) }))
        }
        if (!starCatRef.current) {
          try {
            const r = await fetch('/api/stars')
            if (r.ok) {
              const j: { stars?: { ra: number; dec: number; mag: number; bv: number }[] } = await r.json()
              if (j.stars?.length) starCatRef.current = j.stars
            }
          } catch { /* stars are garnish — satellites still fly */ }
        }
        if (cancelled) return
        const now = simTimeRef.current != null ? new Date(simTimeRef.current) : new Date()
        const gmst = sat.gstime(now)
        const next: Sat3D[] = []
        for (const s of satRecsRef.current) {
          const pv = sat.propagate(s.rec as Parameters<typeof sat.propagate>[0], now)
          const pos = pv?.position
          if (!pos || typeof pos === 'boolean') continue
          const gd = sat.eciToGeodetic(pos, gmst)
          if (!Number.isFinite(gd.height) || gd.height <= 0) continue
          const vel = pv.velocity && typeof pv.velocity !== 'boolean'
            ? Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2)
            : null
          const rec = s.rec as { inclo?: number; no?: number; no_kozai?: number }
          const meanMotion = rec.no ?? rec.no_kozai
          next.push({
            name: s.name, group: s.group,
            lon: sat.degreesLong(gd.longitude), lat: sat.degreesLat(gd.latitude),
            altKm: gd.height,
            mph: vel ? Math.round(vel * 2236.94) : null,
            norad: s.norad,
            inclDeg: rec.inclo != null ? rec.inclo * (180 / Math.PI) : null,
            periodMin: meanMotion ? (2 * Math.PI) / meanMotion : null,
            sx: 0, sy: 0, visible: false,
          })
        }
        satsRef.current = next

        // ── Celestial: sun, moon, stars as raw sub-points — the sky layer
        // projects them per frame for whichever shader variant is active.
        const sunEq = sunEquatorial(now)
        const moonEq = moonEquatorial(now)
        const sunSub = subPoint(sunEq, gmst)
        const moonSub = subPoint(moonEq, gmst)
        const dir = (lon: number, lat: number): [number, number, number] => {
          const lo = lon * Math.PI / 180, la = lat * Math.PI / 180
          return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
        }
        const illum = moonIllumination(dir(sunSub.lon, sunSub.lat), dir(moonSub.lon, moonSub.lat))
        let stars: Float32Array | null = celestialRef.current?.stars ?? null
        let starCount = celestialRef.current?.starCount ?? 0
        if (starCatRef.current) {
          const cat = starCatRef.current
          const gmstDeg = gmst * (180 / Math.PI)
          const dpr = window.devicePixelRatio || 1
          if (!stars || starCount !== cat.length) stars = new Float32Array(cat.length * 5)
          for (let i = 0; i < cat.length; i++) {
            const st = cat[i]
            const o = i * 5
            stars[o] = norm180(st.ra - gmstDeg)
            stars[o + 1] = st.dec
            stars[o + 2] = Math.min(5, Math.max(1.3, 4.4 - 0.6 * st.mag)) * dpr
            stars[o + 3] = Math.min(1, Math.max(0.22, 1.05 - 0.15 * st.mag))
            stars[o + 4] = Math.min(1, Math.max(0, (st.bv + 0.1) / 1.6))
          }
          starCount = cat.length
        }
        // The sun's true distance (23,000 planet radii) is beyond float
        // comfort — render its DIRECTION at a far shell; the disc is sized
        // by true angular diameter either way.
        celestialRef.current = {
          sun: {
            kind: 'sun', lon: sunSub.lon, lat: sunSub.lat, altM: 179 * EARTH_RADIUS_M,
            angRad: Math.atan2(SUN_RADIUS_KM, sunEq.distAU * AU_KM),
            distLabel: `${(sunEq.distAU * 92.955807).toFixed(1)}M miles away`,
            sx: 0, sy: 0, visible: false,
          },
          moon: {
            kind: 'moon', lon: moonSub.lon, lat: moonSub.lat, altM: moonEq.distKm * 1000 - EARTH_RADIUS_M,
            angRad: Math.atan2(MOON_RADIUS_KM, moonEq.distKm),
            distLabel: `${Math.round(moonEq.distKm * 0.621371).toLocaleString()} miles away`,
            illum,
            sx: 0, sy: 0, visible: false,
          },
          stars, starCount,
          starsRev: (celestialRef.current?.starsRev ?? 0) + 1,
          starAltM: 149 * EARTH_RADIUS_M,
        }
        m.triggerRepaint()
        window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'satellites', at: Date.now() } }))
      } catch (err) {
        window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'satellites', msg: err instanceof Error ? err.message : 'orbit feed down' } }))
      }
    }
    tick()
    skyKickRef.current = () => { void tick() }
    const id = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(id); skyKickRef.current = null }
  }, [mapReady, overlaysOn.satellites])

  // Full swarm — every active satellite (~11,500), propagated in a Web
  // Worker so the map thread never feels it. Opt-in sub-toggle; needs the
  // Satellites layer on (it shares the sky renderer).
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.satellites && !!overlaysOn.satswarm
    if (!on) {
      swarmWorkerRef.current?.terminate()
      swarmWorkerRef.current = null
      if (swarmRef.current) { swarmRef.current = null; m.triggerRepaint() }
      return
    }
    let cancelled = false
    const w = new Worker(new URL('../../lib/swarm-worker.ts', import.meta.url))
    swarmWorkerRef.current = w
    w.onmessage = (e: MessageEvent<{ pos: Float32Array; n: number }>) => {
      if (cancelled) return
      swarmRef.current = { pos: e.data.pos, n: e.data.n, rev: (swarmRef.current?.rev ?? 0) + 1 }
      m.triggerRepaint()
      window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'satswarm', at: Date.now() } }))
    }
    fetch('/api/satellites?full=1')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalog ${r.status}`))))
      .then((j: { sats?: { l1: string; l2: string }[] }) => {
        if (cancelled || !j.sats?.length) return
        w.postMessage({ tles: j.sats, simOffset: simTimeRef.current != null ? simTimeRef.current - Date.now() : null })
      })
      .catch((err) => {
        window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'satswarm', msg: err instanceof Error ? err.message : 'catalog unreachable' } }))
      })
    return () => {
      cancelled = true
      w.terminate()
      if (swarmWorkerRef.current === w) swarmWorkerRef.current = null
    }
  }, [mapReady, overlaysOn.satellites, overlaysOn.satswarm])

  // Live aircraft data — ADS-B within 250 nm of the map center, ~6s cadence.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (!overlaysOn.planes) {
      planesRef.current = null
      m.triggerRepaint()
      return
    }
    let cancelled = false
    let inflight = false
    const load = async () => {
      if (inflight || cancelled) return
      // ADS-B is live-only — during replay, showing NOW's planes over LAST
      // WEEK's map would be a lie. Hide them until the timeline returns home.
      if (rangeRef.current !== 'live') {
        if (planesRef.current) { planesRef.current = null; m.triggerRepaint() }
        return
      }
      inflight = true
      try {
        const c = m.getCenter()
        const r = await fetch(`/api/planes?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&r=250`)
        if (!r.ok) throw new Error(`feed ${r.status}`)
        const j: { planes?: { hex: string; flight: string | null; reg: string | null; type: string | null; lat: number; lon: number; altFt: number; gsKt: number | null; track: number | null }[] } = await r.json()
        if (cancelled) return
        const nowMs = Date.now()
        planesRef.current = (j.planes ?? []).map((p) => {
          const info = typeInfo(p.type)
          // Bank angle from turn rate: ADS-B carries no roll, but successive
          // tracks give ω, and coordinated flight obeys tan(φ) = v·ω/g.
          let bankRad = 0
          const prev = planePrevRef.current.get(p.hex)
          if (prev && p.track != null && prev.track != null && p.gsKt) {
            const dt = (nowMs - prev.at) / 1000
            if (dt > 1 && dt < 60) {
              let dTrack = p.track - prev.track
              if (dTrack > 180) dTrack -= 360
              if (dTrack < -180) dTrack += 360
              const omega = (dTrack / dt) * Math.PI / 180
              if (Math.abs(dTrack / dt) > 0.3) {
                const vMs = p.gsKt * 0.514444
                bankRad = Math.max(-0.6, Math.min(0.6, Math.atan((vMs * omega) / 9.81)))
              }
            }
          }
          if (p.track != null) planePrevRef.current.set(p.hex, { track: p.track, at: nowMs })
          return {
            hex: p.hex, flight: p.flight, reg: p.reg, typeCode: p.type,
            typeLabel: info.label, shape: info.cls, spanM: info.spanM,
            lon: p.lon, lat: p.lat, altFt: p.altFt,
            mph: p.gsKt != null ? Math.round(p.gsKt * 1.15078) : null,
            track: p.track, bankRad,
            sx: 0, sy: 0, visible: false,
          }
        })
        if (planePrevRef.current.size > 2000) planePrevRef.current.clear()
        // Accumulate each aircraft's path (cap ~200 samples/plane) so a
        // clicked plane draws a live-growing 3D trail. Prune to what's in view.
        const seen = new Set<string>()
        for (const p of j.planes ?? []) {
          seen.add(p.hex)
          const buf = planeHistRef.current.get(p.hex) ?? []
          const L = buf.length
          if (L < 3 || buf[L - 3] !== p.lon || buf[L - 2] !== p.lat) {
            buf.push(p.lon, p.lat, p.altFt * 0.3048)
            if (buf.length > 600) buf.splice(0, buf.length - 600)
            planeHistRef.current.set(p.hex, buf)
          }
        }
        if (planeHistRef.current.size > 400) {
          for (const k of Array.from(planeHistRef.current.keys())) {
            if (!seen.has(k) && k !== selPlaneRef.current) planeHistRef.current.delete(k)
          }
        }
        if (selPlaneRef.current) rebuildTrailRef.current?.()
        m.triggerRepaint()
        window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'planes', at: Date.now() } }))
      } catch (err) {
        window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'planes', msg: err instanceof Error ? err.message : 'ADS-B feed down' } }))
      } finally {
        inflight = false
      }
    }
    let moveTimer: ReturnType<typeof setTimeout> | null = null
    const onMove = () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(load, 900)
    }
    load()
    const id = setInterval(load, 6000)
    m.on('moveend', onMove)
    return () => {
      cancelled = true
      clearInterval(id)
      if (moveTimer) clearTimeout(moveTimer)
      m.off('moveend', onMove)
    }
  }, [mapReady, overlaysOn.planes])

  // ── Public webcams (Windy network via our proxy — key stays server-side) ──
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.webcams
    if (m.getLayer('webcam-dots')) {
      m.setLayoutProperty('webcam-dots', 'visibility', on ? 'visible' : 'none')
      m.setLayoutProperty('webcam-mark', 'visibility', on ? 'visible' : 'none')
    } else if (on) {
      m.addSource('webcams', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('clusters') ? 'clusters' : undefined
      m.addLayer({
        id: 'webcam-dots', type: 'circle', source: 'webcams', minzoom: 8,
        paint: { 'circle-radius': 8, 'circle-color': '#0b1523', 'circle-stroke-color': '#a78bfa', 'circle-stroke-width': 2 },
      }, beforeId)
      m.addLayer({
        id: 'webcam-mark', type: 'symbol', source: 'webcams', minzoom: 8,
        layout: { 'text-field': '◉', 'text-size': 9, 'text-allow-overlap': true },
        paint: { 'text-color': '#a78bfa' },
      }, beforeId)
      m.on('click', 'webcam-dots', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        const img = p.thumb ? `<img src="${p.thumb}" alt="" style="width:100%;border-radius:8px;margin-top:6px" />` : ''
        const link = p.page ? `<a href="${p.page}" target="_blank" rel="noopener" style="color:#2dd4bf;font-size:11px">open live view →</a>` : ''
        new maplibregl.Popup({ closeButton: false, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#a78bfa;white-space:normal;overflow-wrap:break-word">${p.title}</div>${img}${link}</div>`)
          .addTo(m)
      })
      m.on('mouseenter', 'webcam-dots', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'webcam-dots', () => { m.getCanvas().style.cursor = '' })
    }
    if (!on) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      if (m.getZoom() < 8) return
      const b = m.getBounds()
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(3)).join(',')
      fetch(`/api/webcams?bbox=${bbox}`)
        .then((r) => {
          if (r.status === 501) {
            // No server key configured — say so on the row instead of
            // showing an on-toggle over an empty layer.
            window.dispatchEvent(new CustomEvent('ht:layer-error', {
              detail: { key: 'webcams', msg: 'needs a free key — add WINDY_WEBCAMS_KEY in Vercel (api.windy.com/webcams)' },
            }))
            return null
          }
          return r.ok ? r.json() : null
        })
        .then((j: { cams?: { id: string; title: string; lat: number; lng: number; thumb: string | null; page: string | null }[] } | null) => {
          if (cancelled || !j?.cams) return
          const features = j.cams.map((c) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
            properties: { title: c.title, thumb: c.thumb ?? '', page: c.page ?? '' },
          }))
          ;(m.getSource('webcams') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
          window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'webcams', at: Date.now() } }))
        })
        .catch(() => { /* no key or feed down — layer stays empty */ })
    }
    const onMove = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 900)
    }
    load()
    m.on('moveend', onMove)
    return () => { cancelled = true; if (timer) clearTimeout(timer); m.off('moveend', onMove) }
  }, [mapReady, overlaysOn.webcams])

  // ── Day/night, the realistic way: whatever basemap is up shows in daylight,
  // then the map fades through graduated twilight bands (sun 0/−6/−12/−18°
  // below the horizon) into night — and real cities glow on the dark side,
  // ramping up through dusk exactly where evening actually is. Pure solar
  // math + Natural Earth city points; re-derives every minute so the line
  // creeps west. The NASA "City lights" raster remains the separate
  // whole-planet nighttime look for the dark basemap.
  const cityCatRef = useRef<{ lat: number; lon: number; pop: number }[] | null>(null)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.daynight
    for (const lid of ['daynight-shade', 'citylight-glow', 'citylight-core']) {
      if (m.getLayer(lid)) m.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none')
    }
    if (!on) return
    let cancelled = false

    const cityFeatures = (): GeoJSON.Feature[] => {
      const cat = cityCatRef.current
      if (!cat) return []
      const now = simTimeRef.current != null ? new Date(simTimeRef.current) : new Date()
      const sun = sunEquatorial(now)
      // GMST ≈ ERA approximation is overkill here — the sub-solar point from
      // the ephemeris + UTC keeps city dusk within a minute of truth.
      const jd = now.getTime() / 86400000 + 2440587.5
      const gmstDeg = ((280.46061837 + 360.98564736629 * (jd - 2451545)) % 360 + 360) % 360
      const sub = subPoint(sun, gmstDeg * Math.PI / 180)
      const rad = Math.PI / 180
      const sinDec = Math.sin(sub.lat * rad)
      const cosDec = Math.cos(sub.lat * rad)
      const out: GeoJSON.Feature[] = []
      for (const c of cat) {
        const H = (c.lon - sub.lon) * rad
        const sinAlt = Math.sin(c.lat * rad) * sinDec + Math.cos(c.lat * rad) * cosDec * Math.cos(H)
        const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / rad
        // Lights fade in from +1° (sunset glow) to full at −8°.
        const glow = Math.max(0, Math.min(1, (1 - altDeg) / 9))
        if (glow < 0.03) continue
        out.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          properties: { g: glow, p: Math.sqrt(Math.max(c.pop, 20000)) / 1000 },
        })
      }
      return out
    }

    const refresh = () => {
      if (cancelled) return
      const at = simTimeRef.current != null ? new Date(simTimeRef.current) : new Date()
      ;(m.getSource('daynight') as maplibregl.GeoJSONSource | undefined)?.setData(twilightBands(at) as GeoJSON.GeoJSON)
      ;(m.getSource('citylights') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: cityFeatures() })
    }

    if (!m.getSource('daynight')) {
      m.addSource('daynight', { type: 'geojson', data: twilightBands() as GeoJSON.GeoJSON })
      m.addSource('citylights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('clusters') ? 'clusters' : undefined
      // Stacked translucent bands accumulate: day → dusk → deep night.
      m.addLayer({
        id: 'daynight-shade', type: 'fill', source: 'daynight',
        paint: { 'fill-color': '#020817', 'fill-opacity': ['get', 'op'], 'fill-antialias': false },
      }, beforeId)
      m.addLayer({
        id: 'citylight-glow', type: 'circle', source: 'citylights',
        paint: {
          'circle-color': '#ffc25e',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, ['*', ['get', 'p'], 1.1], 4, ['*', ['get', 'p'], 2.6], 8, ['*', ['get', 'p'], 5]],
          'circle-blur': 1.4,
          'circle-opacity': ['*', ['get', 'g'], 0.5],
        },
      }, beforeId)
      m.addLayer({
        id: 'citylight-core', type: 'circle', source: 'citylights',
        paint: {
          'circle-color': '#ffe9bd',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, ['max', ['*', ['get', 'p'], 0.34], 0.6], 8, ['*', ['get', 'p'], 1.6]],
          'circle-opacity': ['*', ['get', 'g'], 0.95],
        },
      }, beforeId)
    } else {
      refresh()
    }

    if (!cityCatRef.current) {
      fetch('/api/cities')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`cities ${r.status}`))))
        .then((j: { cities?: { lat: number; lon: number; pop: number }[] }) => {
          if (cancelled || !j.cities?.length) return
          cityCatRef.current = j.cities
          refresh()
        })
        .catch(() => { /* shading still works without the lights */ })
    }

    dayNightKickRef.current = refresh
    const id = setInterval(refresh, 60_000)
    return () => { cancelled = true; clearInterval(id); dayNightKickRef.current = null }
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
      .then((r) => {
        if (!r.ok) {
          window.dispatchEvent(new CustomEvent('ht:layer-error', {
            detail: { key: 'windanim', msg: 'wind model feed unavailable — check /diag' },
          }))
          return null
        }
        return r.json()
      })
      .then((f: WindField | null) => {
        if (cancelled || !f || !Array.isArray(f.u) || !f.u.length) return
        windStopRef.current?.()
        windStopRef.current = startWindParticles(m, f)
        window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'windanim', at: Date.now() } }))
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
      m.addLayer({ id: 'wx-layer', type: 'raster', source: 'wx', paint: { 'raster-opacity': overlayOpacity.radar ?? 0.72 } }, beforeId)
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
    // GOES publishes ~every 10 min; re-resolve the newest REAL frame on the
    // same cadence so the sky stays current — day where it's day, night where
    // it's night — instead of a frozen screenshot of the layer's first load.
    let gone = false
    const apply = async () => {
      const stamp = await goesLatestStamp('GOES-East_ABI_GeoColor', 7)
      if (gone || !map.current) return
      const url = goesTileUrl('GOES-East_ABI_GeoColor', 7, stamp)
      if (!cloudsAdded.current) {
        m.addSource('clouds', {
          type: 'raster',
          tiles: [url],
          tileSize: 256,
          maxzoom: 7,
          attribution: 'NASA GIBS · NOAA GOES-East',
        })
        const beforeId = m.getLayer('labels-overlay') ? 'labels-overlay'
          : m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
        m.addLayer({ id: 'clouds-layer', type: 'raster', source: 'clouds', paint: { 'raster-opacity': 0.6 } }, beforeId)
        cloudsAdded.current = true
      } else {
        ;(m.getSource('clouds') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
        m.setLayoutProperty('clouds-layer', 'visibility', 'visible')
      }
    }
    apply()
    const id = setInterval(apply, 600_000)
    return () => { gone = true; clearInterval(id) }
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
    let gone = false
    const apply = async () => {
      const stamp = await goesLatestStamp('GOES-East_ABI_Band13_Clean_Infrared', 6)
      if (gone || !map.current) return
      const tileUrl = goesTileUrl('GOES-East_ABI_Band13_Clean_Infrared', 6, stamp)
      if (!stormAdded.current) {
        m.addSource('stormtops', { type: 'raster', tiles: [tileUrl], tileSize: 256, maxzoom: 6, attribution: 'NASA GIBS · NOAA GOES-East' })
        const beforeId = m.getLayer('labels-overlay') ? 'labels-overlay'
          : m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
        // 0.45: the IR enhancement paints EVERY cold cloud top, and at 0.62 it
        // read as rainbow soup smeared over half the country (owner, Jul 14).
        m.addLayer({ id: 'stormtops-layer', type: 'raster', source: 'stormtops', paint: { 'raster-opacity': 0.45 } }, beforeId)
        stormAdded.current = true
      } else {
        ;(m.getSource('stormtops') as maplibregl.RasterTileSource | undefined)?.setTiles([tileUrl])
        m.setLayoutProperty('stormtops-layer', 'visibility', 'visible')
      }
    }
    apply()
    const id = setInterval(apply, 600_000)
    return () => { gone = true; clearInterval(id) }
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

  // "360" — a slow continuous rotation of whatever the screen is showing.
  // Loops until pressed again (or a drag takes over). Constant angular speed
  // driven by real frame time with a smoothstep ramp-in — the old version
  // eased in fixed per-frame steps, which snapped speed at the seams and
  // read as jerks ("a little jerky at a couple of points", Jul 12).
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
    stopFlyoverRef.current?.()
    setSpinning(true)
    const DEG_PER_SEC = 360 / 26 // one lap every ~26s
    const start = performance.now()
    let last = start
    const frame = (now: number) => {
      if (userGestureRef.current) { setSpinning(false); return }
      const dt = Math.min(0.1, (now - last) / 1000) // clamp: a hitched frame must not lurch
      last = now
      const t = Math.min(1, (now - start) / 2000)
      const ramp = t * t * (3 - 2 * t) // smoothstep — velocity stays continuous
      m.jumpTo({ bearing: (m.getBearing() + DEG_PER_SEC * ramp * dt) % 360 })
      spinRaf.current = requestAnimationFrame(frame)
    }
    spinRaf.current = requestAnimationFrame(frame)
  }, [stopSpin])
  useEffect(() => () => cancelAnimationFrame(spinRaf.current), [])

  // Earth rotation — automatic, no toggle (owner ask, Jul 21: "real rotation
  // should only really work when the timeline tells it to"). Whenever the
  // Satellites & sky layer is on and you're zoomed out far enough to see the
  // planet, the globe turns exactly as Earth does under the fixed star /
  // satellite field — 360° per sidereal day (23h56m04s ≈ 15°/hr). The
  // TIMELINE is the clock: replay follows the scrub (sweep a day, the planet
  // turns once; scrub back, it turns back; pause freezes it — manual pause
  // wins). Live runs at the true 1× rate. A hand on the wheel skips frames
  // instead of killing the loop — rotation resumes wherever you let go.
  const earthRaf = useRef(0)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m || !overlaysOn.satellites) return
    const SIDEREAL_DEG_PER_SEC = 360 / 86164.0905
    const GLOBE_ZOOM = 4 // above this you're looking at a job site, not a planet
    let last = performance.now()
    let lastScrubMs: number | null = null
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const win = realWindowRef.current
      let dDeg: number
      if (rangeRef.current !== 'live' && win) {
        const scrubMs = win.from + tRef.current * (win.to - win.from)
        dDeg = lastScrubMs == null ? 0 : SIDEREAL_DEG_PER_SEC * ((scrubMs - lastScrubMs) / 1000)
        lastScrubMs = scrubMs
      } else {
        lastScrubMs = null
        dDeg = SIDEREAL_DEG_PER_SEC * dt
      }
      if (dDeg !== 0 && !userGestureRef.current && m.getZoom() <= GLOBE_ZOOM) {
        const c = m.getCenter()
        let lng = c.lng - dDeg
        while (lng < -180) lng += 360
        while (lng > 180) lng -= 360
        m.jumpTo({ center: [lng, c.lat] })
      }
      earthRaf.current = requestAnimationFrame(frame)
    }
    earthRaf.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(earthRaf.current)
  }, [mapReady, overlaysOn.satellites])

  // Google-style progressive tilt lock (owner ask, Jul 21; retuned Jul 22 —
  // "needs to not really start to apply until near a globe view"): full 85°
  // tilt everywhere you'd actually work, only draining to flat across the
  // continent-to-globe transition. The sky layers (Satellites, Aircraft)
  // free the camera entirely — near-horizon views need pitch at any zoom.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (overlaysOn.satellites || overlaysOn.planes) {
      try { m.setMaxPitch(85) } catch { /* mid-gesture */ }
      return
    }
    const apply = () => {
      const z = m.getZoom()
      const max = z >= 5.5 ? 85 : z <= 3 ? 0 : Math.round(((z - 3) / 2.5) * 85)
      try { m.setMaxPitch(max) } catch { /* mid-gesture */ }
    }
    apply()
    m.on('zoom', apply)
    return () => {
      m.off('zoom', apply)
      try { m.setMaxPitch(85) } catch { /* teardown */ }
    }
  }, [mapReady, overlaysOn.satellites, overlaysOn.planes])

  // "Flyover" — the slow-plane pass: visit every located asset in
  // nearest-neighbor order at altitude, bank around each for a few seconds,
  // glide to the next, loop until stopped. Drag, Follow, or 360 cancels.
  // flySpeed: 0.5 = lazy Cub, 1 = cruise, 2 = quick pass.
  const [flying, setFlying] = useState(false)
  const flyingRef = useRef(false)
  flyingRef.current = flying
  const [flySpeed, setFlySpeed] = useState(1)
  const flySpeedRef = useRef(1)
  flySpeedRef.current = flySpeed
  const flyRaf = useRef(0)
  const stopFlyover = useCallback(() => {
    cancelAnimationFrame(flyRaf.current)
    flyingRef.current = false
    setFlying(false)
    map.current?.easeTo({ pitch: threeDRef.current || terrain3dRef.current ? 55 : 0, duration: 600 })
  }, [])
  stopFlyoverRef.current = stopFlyover
  const handleFlyover = useCallback(() => {
    const m = map.current
    if (!m) return
    if (flyingRef.current) { stopFlyover(); return }
    stopSpin()
    if (followIdRef.current) handleFollowRef.current(null)
    const pts = assetsRef.current
      .filter((a) => a.location)
      .map((a) => ({ lng: a.location!.lng, lat: a.location!.lat }))
    if (!pts.length) return
    // Nearest-neighbor route from where the camera is — a flight plan,
    // not a random zigzag across the county.
    const cosLat = Math.cos((m.getCenter().lat * Math.PI) / 180) ** 2
    const remaining = [...pts]
    const order: typeof pts = []
    let cur = { lng: m.getCenter().lng, lat: m.getCenter().lat }
    while (remaining.length) {
      let bi = 0
      let bd = Infinity
      remaining.forEach((p, idx) => {
        const d = (p.lng - cur.lng) ** 2 * cosLat + (p.lat - cur.lat) ** 2
        if (d < bd) { bd = d; bi = idx }
      })
      cur = remaining.splice(bi, 1)[0]
      order.push(cur)
    }
    flyingRef.current = true
    setFlying(true)
    let i = -1
    const nextLeg = () => {
      if (!flyingRef.current) return
      i = (i + 1) % order.length
      const p = order[i]
      m.flyTo({
        center: [p.lng, p.lat],
        zoom: 14.6,                          // "small plane" altitude — site-readable
        pitch: 55,
        bearing: m.getBearing() + 30,
        speed: 0.35 * flySpeedRef.current,   // glide pace; tiles stream in ahead
        curve: 1.3,
        essential: true,
      })
      m.once('moveend', () => {
        if (!flyingRef.current) return
        // Bank around the asset before flying on.
        const t0 = performance.now()
        let last = t0
        const dwellMs = 4500 / flySpeedRef.current
        const dwell = (now: number) => {
          if (!flyingRef.current) return
          if (userGestureRef.current) { stopFlyover(); return }
          const dt = Math.min(0.1, (now - last) / 1000)
          last = now
          m.jumpTo({ bearing: m.getBearing() + 9 * dt * flySpeedRef.current })
          if (now - t0 < dwellMs) flyRaf.current = requestAnimationFrame(dwell)
          else nextLeg()
        }
        flyRaf.current = requestAnimationFrame(dwell)
      })
    }
    nextLeg()
  }, [stopSpin, stopFlyover])
  // Drag hands the camera back mid-flight: MapLibre aborts the glide, and
  // this listener ends the tour instead of letting the next leg fire.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const cancel = () => { if (flyingRef.current) stopFlyover() }
    m.on('dragstart', cancel)
    return () => { m.off('dragstart', cancel) }
  }, [mapReady, stopFlyover])
  useEffect(() => () => cancelAnimationFrame(flyRaf.current), [])

  // Speed / time / miles readout — docked in the timeline bar (never floats
  // over the map). Shows for the followed asset OR, absent a follow, the
  // selected one; works live (current fix, miles so far today) and in replay
  // (values at the scrub position).
  useEffect(() => {
    const target = followId && !followId.startsWith('zone:')
      ? followId
      : selectedAsset?.id ?? null
    if (!target) { setFollowHud(null); return }
    const tr = tracksEff.find((t) => t.assetId === target)
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
    const live = range === 'live'
    const fmtClock = (ms: number) =>
      new Intl.DateTimeFormat('en-US', { timeZone: tzRef.current, hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
    const update = () => {
      if (live) {
        // Live: the current fix speaks — speed now, last-fix time, miles today.
        const loc = assets.find((a) => a.id === target)?.location
        setFollowHud({
          name: tr.name,
          mph: loc?.speed ?? tr.points[tr.points.length - 1].mph ?? null,
          clock: loc?.timestamp ? fmtClock(Date.parse(loc.timestamp)) : fmtClock(Date.now()),
          milesIn: cum[cum.length - 1],
        })
        return
      }
      if (!win) { setFollowHud(null); return }
      const t = tRef.current
      let lo = 0, hi = tr.points.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tr.points[mid].t <= t) lo = mid; else hi = mid - 1 }
      setFollowHud({
        name: tr.name,
        mph: tr.points[lo].mph ?? null,
        clock: fmtClock(win.from + t * (win.to - win.from)),
        milesIn: cum[lo],
      })
    }
    update()
    const id = setInterval(update, live ? 5000 : 500)
    return () => clearInterval(id)
  }, [followId, selectedAsset, range, realWindowEff, tracksEff, assets])

  const handleFollow = useCallback((id: string | null) => {
    setFollowId(id)
    const m = map.current
    if (!id) {
      // Release: glide back to the flat (or 3D-base) overview.
      m?.easeTo({ pitch: threeDRef.current || terrain3dRef.current ? 55 : 0, bearing: 0, duration: 800 })
      return
    }
    stopSpin() // follow owns the camera — a running 360 would fight it
    stopFlyoverRef.current?.() // ...and so would a flyover mid-glide
    // Zones have no direction of travel, so Chase silently becomes Orbit.
    if (id.startsWith('zone:') && followModeRef.current === 'chase') setFollowMode('orbit')
    setTrailMode((prev) => (prev === 'off' ? 'trails' : prev))
    if (m) { bearingRef.current = m.getBearing(); pitchRef.current = m.getPitch() }
    entranceRef.current = 0
    // LIVE follow: stay on Live — the camera rides each incoming fix (its
    // own RAF loop below drives it). No replay, no range switch.
    if (rangeRef.current === 'live') return
    // Replay follow: ride at 2x wall-clock — slow enough that tiles stream
    // in ahead of the camera instead of the chase outrunning the map.
    setPbSpeed(2)
    // Start the chase where the day's driving actually starts.
    tRef.current = firstMoveTRef.current
    setPbT(firstMoveTRef.current)
    setPbPlaying(true)
  }, [stopSpin])
  handleFollowRef.current = handleFollow

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

  // One list + one handler serve both search surfaces (map pill + layers hub).
  const searchItems: SearchItem[] = [
    ...assets.map((a): SearchItem => ({
      kind: 'asset', id: a.id, name: a.name, type: a.type,
      sub: a.location ? `last seen ${formatRelativeTime(a.location.timestamp)}` : 'no signal yet',
    })),
    ...geofences.map((g): SearchItem => ({ kind: 'zone', id: g.id, name: g.name, color: g.color })),
  ]
  const pickSearchItem = (it: SearchItem) => {
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
  }

  return (
    <div className={'relative w-full h-full bg-navy-950' + (kiosk ? ' kiosk-map' : ' map-live')}>
      <div ref={mapContainer} className="w-full h-full" />

      {/* AskAI floats top-right on its own; the layers pill + search button
          pair lives top-LEFT (owner layout, Jul 14 PM). */}
      {!kiosk && askSlot && <div data-tour="askai" className="absolute top-3 right-3 z-20">{askSlot}</div>}

      {/* Measure toggle lives in the MapLibre control cluster (added at map
          init) — same size + column as zoom/locate/fit, below Zoom-to-all. */}
      {!kiosk && (
        <MeasureTool
          map={mapReady ? map.current : null}
          active={measureOn}
          terrainOn={terrain3d}
          onClose={() => setMeasureOn(false)}
          onSaved={() => { /* saved measurements reload on next page visit */ }}
        />
      )}

      {/* First-run walkthrough of the controls (skippable, once per device;
          relaunch from Getting Started or /map?tour=1) */}
      {!kiosk && <MapTour />}

      {/* Numeric scales for shaded layers — a wash of color with no numbers
          is a vibe, not data (owner ask, Jul 14). Temp/feels/wind use the WMS
          server's own legend so colors match the tiles exactly. */}
      {!kiosk && (overlaysOn.temp || overlaysOn.feels || overlaysOn.wind || overlaysOn.lightning || precipOn || trailMode === 'heatmap' || trailMode === '3d') && (
        <div className="absolute left-3 top-[60px] z-10 flex flex-col gap-1.5 max-w-[190px] pointer-events-none">
          {(['temp', 'feels', 'wind', 'lightning'] as const).filter((k) => !!overlaysOn[k]).map((k) => {
            const name = rtmaNames?.[k] ?? (k === 'temp' ? 'air_temperature' : k === 'feels' ? 'apparent_air_temperature' : k === 'wind' ? 'wind_speed' : null)
            if (!name) return null
            return (
              <div key={k} className="rounded-lg bg-navy-950/85 backdrop-blur border border-navy-700 p-1.5">
                <p className="font-mono text-[9px] uppercase tracking-wide text-faint mb-1">
                  {k === 'temp' ? 'Temperature °F' : k === 'feels' ? 'Feels like °F' : k === 'wind' ? 'Wind mph' : 'Lightning · strikes'}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&FORMAT=image/png&LAYER=${encodeURIComponent(name)}`}
                  alt={`${k} scale`}
                  className="max-h-44 w-auto rounded bg-white/90 p-0.5 object-contain"
                  onError={(e) => { const p = e.currentTarget.parentElement; if (p) p.style.display = 'none' }}
                />
              </div>
            )
          })}
          {precipOn && (
            <div className="rounded-lg bg-navy-950/85 backdrop-blur border border-navy-700 p-1.5">
              <p className="font-mono text-[9px] uppercase tracking-wide text-faint mb-1">
                Rain · inches / {PRECIP_PERIODS.find((p) => p.key === precipPeriod)?.label ?? precipPeriod}
              </p>
              <div className="h-2.5 rounded-sm" style={{ background: 'linear-gradient(90deg,#78f573,#1eb51e,#fffa72,#ffa322,#ff1f1c,#bd0021,#f800fd,#9854c6)' }} />
              <div className="flex justify-between font-mono text-[8.5px] text-faint mt-0.5">
                {['.01', '.25', '.5', '1', '2', '3', '5', '10+'].map((v) => <span key={v}>{v}</span>)}
              </div>
            </div>
          )}
          {(trailMode === 'heatmap' || trailMode === '3d') && (
            <div className="rounded-lg bg-navy-950/85 backdrop-blur border border-navy-700 p-1.5">
              <p className="font-mono text-[9px] uppercase tracking-wide text-faint mb-1">Activity · assets moving</p>
              <div className="h-2.5 rounded-sm" style={{ background: 'linear-gradient(90deg,#14506f,#2dd4bf,#ff9e16,#ff5d5d)' }} />
              <div className="flex justify-between font-mono text-[8.5px] text-faint mt-0.5">
                <span>0</span>
                <span>{Math.max(1, Math.round(Math.max(0, ...activity) / 2))}</span>
                <span>{Math.max(1, ...activity)} at once</span>
              </div>
            </div>
          )}
        </div>
      )}

      <WeatherControl
        base={base}
        onBase={setBase}
        threeD={threeD}
        onThreeD={setThreeD}
        terrain3d={terrain3d}
        onTerrain3d={setTerrain3d}
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
        pws={pws}
        frameTime={radarLabel}
        place={wxPlace}
        onPlaceChange={handlePlaceChange}
        onSaveDefault={handleSaveWeatherDefault}
        parcelsOn={parcelsOn}
        onParcels={PARCEL_SERVICE_URL ? setParcelsOn : undefined}
        overlays={['nwswarn', 'gauges', 'pwsnet', 'daynight', 'windanim', 'alertpins', 'webcams', 'satellites', 'satswarm', 'planes', ...MAP_OVERLAYS.map((o) => o.key)]
          .map((key) => ({ key, on: !!overlaysOn[key] }))}
        onOverlay={(key, on) => setOverlaysOn((prev) => ({ ...prev, [key]: on }))}
        showZones={showZones}
        onShowZones={setShowZones}
        zoom={mapZoom}
        overlayOpacity={overlayOpacity}
        onOverlayOpacity={(key, v) => setOverlayOpacity((prev) => ({ ...prev, [key]: v }))}
        onResetLayers={resetLayers}
        views={allViews(mapViews)}
        activeViewId={activeViewId}
        defaultViewId={mapViews.defaultId}
        onApplyView={(id) => { const v = allViews(mapViews).find((x) => x.id === id); if (v) applyView(v) }}
        onSaveView={handleSaveView}
        onDeleteView={handleDeleteView}
        onSetDefaultView={handleDefaultView}
        side="left"
        top={kiosk ? 68 : 12}
        z={kiosk ? 45 : 15}
        filter={kiosk ? undefined : filter}
        onFilter={kiosk ? undefined : setFilter}
        // Always available (was hidden during replays — "where did add zones
        // go?", Jul 23). Drawing from a replay snaps the timeline back to
        // Live first so clicks mean corners, not scrubbing.
        onDrawZone={!kiosk && onGeofenceSave ? () => { if (rangeRef.current !== 'live') handleRange('live'); startDrawing() } : undefined}
        showDevices={showDevices}
        onToggleDevices={!kiosk && isMock ? () => setShowDevices((v) => !v) : undefined}
        searchSlot={kiosk ? undefined : <MapSearch inline items={searchItems} onPick={pickSearchItem} />}
      />


      {!kiosk && (
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
          hud={followHud}
          followId={followId}
          onFollow={handleFollow}
          followMode={followMode}
          onFollowMode={setFollowMode}
          followAssets={tracksEff
            .filter((tr) => filter.has(tr.type) && tr.points.length > 0)
            .map((tr) => ({ id: tr.assetId, name: tr.name, type: tr.type, color: tr.color }))}
          followZones={geofences.map((g) => ({ id: `zone:${g.id}`, name: g.name, color: g.color }))}
          alertMarks={(() => {
            const win = realWindowEff
            if (!win || range === 'live') return []
            return alerts.flatMap((a) => {
              const ms = new Date(a.triggered_at).getTime()
              if (ms < win.from || ms > win.to) return []
              return [{
                t: (ms - win.from) / (win.to - win.from),
                label: `${a.asset?.name ?? 'Asset'} · ${(a.rule?.trigger ?? 'alert').replace(/_/g, ' ')}`,
              }]
            }).slice(0, 40)
          })()}
          spinning={spinning}
          onSpin={handleSpin}
          flying={flying}
          onFlyover={handleFlyover}
          flySpeed={flySpeed}
          onFlySpeed={setFlySpeed}
        />
      )}

      {selectedAsset && (
        <AssetPanel
          asset={selectedAsset}
          gateway={toolGateways?.[selectedAsset.id]}
          aboard={aboard?.[selectedAsset.id]}
          onPick={(id) => {
            const next = assets.find((a) => a.id === id)
            if (next) { setSelectedZone(null); setSelectedDevice(null); setSelectedAsset(next) }
          }}
          isolated={isolateId === selectedAsset.id}
          onToggleIsolate={() => setIsolateId((cur) => (cur === selectedAsset.id ? null : selectedAsset.id))}
          onStops={setPanelStops}
          onFocusStop={(lat, lng) => map.current?.flyTo({ center: [lng, lat], zoom: Math.max(map.current.getZoom(), 15), duration: 1200 })}
          onClose={() => setSelectedAsset(null)}
        />
      )}

      {selectedZone && (() => {
        const pres = geofencePresence(selectedZone, assets)
        const insideAssets = pres.insideIds
          .map((id) => assets.find((a) => a.id === id))
          .filter((a): a is AssetWithLocation => !!a)
          .map((a) => ({ id: a.id, name: a.name, type: a.type }))
        return (
        <ZonePanel
          fence={selectedZone}
          presence={pres}
          insideAssets={insideAssets}
          onPickAsset={(id) => {
            const next = assets.find((a) => a.id === id)
            if (next) { setSelectedZone(null); setSelectedDevice(null); setSelectedAsset(next) }
          }}
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
        )
      })()}

      {selectedDevice && (
        <DevicePanel device={selectedDevice} onClose={() => setSelectedDevice(null)} />
      )}
    </div>
  )
}
