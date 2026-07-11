'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AssetWithLocation, AssetType, Geofence } from '@/lib/types'
import { DEMO_MAP_CENTER, DEMO_MAP_ZOOM } from '@/lib/mock-data'
import {
  type AssetTrack, type TimeRange, type TrailMode, positionAt, trailSegmentsUpTo,
  defaultSpeed, tracksFromHistory, rangeWindowSeconds,
} from '@/lib/trails'
import { rangeWindow } from '@/lib/dates'
import {
  type Conditions, type IemFrame,
  fetchConditions, buildRadarFrames, iemRadarUrl, iemTsForMs,
  PRECIP_PERIODS, iemPrecipUrl,
} from '@/lib/weather'
import { buildActivityCurve, firstMovementT, deltas } from '@/lib/activity'
import { PROJECTS, periodCost, RANGE_COST_LABEL } from '@/lib/projects'
import { PARCEL_SERVICE_URL, PARCEL_MIN_ZOOM, PARCEL_LABEL_MIN_ZOOM, fetchParcels } from '@/lib/parcels'
import { zoneCostAt, buildCostCurve, zoneCostsFromHistory } from '@/lib/costs'
import { MAP_OVERLAYS } from '@/lib/overlays'
import { MOCK_SITE_DEVICES, DEVICE_META, type SiteDevice } from '@/lib/site-devices'
import { geofencePresence } from '@/lib/site-presence'
import { AssetPanel } from './AssetPanel'
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
const LIVE_LAYERS = ['clusters', 'cluster-count', 'unclustered-circle', 'unclustered-label']
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
        },
      })),
  }
}

function trailsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((tr) => filter.has(tr.type))
      .map((tr) => ({
        type: 'Feature' as const,
        // MultiLineString: segments break at data gaps (device asleep) so the
        // trail never draws a straight chord across town.
        geometry: { type: 'MultiLineString' as const, coordinates: trailSegmentsUpTo(tr, t) },
        properties: { id: tr.assetId, color: tr.color },
      })),
  }
}

function pointsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const tr of tracks) {
    if (!filter.has(tr.type)) continue
    for (const p of tr.points) {
      if (p.t > t) break
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: {} })
    }
  }
  return { type: 'FeatureCollection', features }
}

function headsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((tr) => filter.has(tr.type))
      .map((tr) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: positionAt(tr, t) },
        properties: { id: tr.assetId, name: tr.name, color: tr.color },
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
      // smaller sort key = placed first = wins collisions, so bigger zones win
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [(minLng + maxLng) / 2, maxLat] }, properties: { name: g.name, color: g.color, pri: -area } }
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
  onGeofenceSave?: (name: string, geometry: GeoJSON.Polygon, color: string) => void
  /** Rename/recolor a zone from its map sheet (optimistic + persisted). */
  onGeofenceEdit?: (id: string, name: string, color: string) => void
  /** Delete a zone from its map sheet. */
  onGeofenceDelete?: (id: string) => void
  kiosk?: boolean
  /** Company-wide default weather location (admin-set); null = follow the fleet. */
  defaultWeatherPlace?: string | null
  /** Exact coords for the company default — set by newer star-saves. When
   *  present they win everywhere (no re-geocode, no per-device drift). */
  defaultWeatherCoords?: { lat: number; lng: number } | null
  /** Show the admin-only "save as company default" control in the weather panel. */
  onSaveWeatherDefault?: (place: string, lat?: number, lng?: number) => Promise<boolean | void>
  /** False hides every dollar figure (timeline chip, $ chart mode, zone $). */
  canViewCosts?: boolean
}

export function MapView({ assets, geofences, tracks = [], historyRows = null, earliestMs = null, tz = 'America/New_York', toolGateways, onGeofenceSave, onGeofenceEdit, onGeofenceDelete, kiosk = false, defaultWeatherPlace = null, defaultWeatherCoords = null, onSaveWeatherDefault, canViewCosts = true }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  // Flipped once the style + custom layers exist, so mutation effects that fired
  // too early re-apply instead of silently dropping the change.
  const [mapReady, setMapReady] = useState(false)
  // One selection at a time — asset, zone, or device — all shown in the shared
  // MapSheet (bottom sheet on mobile, right panel on desktop). Zone/device used
  // to be tiny anchored map popups; now every tap opens the same surface.
  const [selectedAsset, setSelectedAsset] = useState<AssetWithLocation | null>(null)
  const [selectedZone, setSelectedZone] = useState<Geofence | null>(null)
  const [selectedDevice, setSelectedDevice] = useState<SiteDevice | null>(null)
  const [filter, setFilter] = useState<Set<AssetType>>(new Set<AssetType>(['vehicle', 'equipment', 'personnel', 'tool']))
  const [showZones, setShowZones] = useState(true)
  const [showDevices, setShowDevices] = useState(isMock)
  const realZoneCostsRef = useRef<Record<string, import('@/lib/costs').ZoneCostCurve> | null>(null)
  const realWindowRef = useRef<import('@/lib/trails').TrackWindow | null>(null)

  // Zone popup cost AT the scrub position (mirrors the hard-hat chip) with an
  // "as of <time>" stamp so the number visibly follows the timeline.
  const zoneRealAt = useCallback((fenceId: string, t: number) => {
    const curves = realZoneCostsRef.current
    if (!curves) return undefined
    const curve = curves[fenceId]
    const zc = curve ? zoneCostAt(curve, t) : { total: 0, activeHours: 0 }
    const w = realWindowRef.current
    const asOf = w
      ? new Date(w.from + t * (w.to - w.from)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
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
          if (j && Array.isArray(j.rows)) setFetchedRows((prev) => ({ ...prev, [key]: j.rows }))
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
      zones: zoneCostsFromHistory(geofences, assets, rows, w.from, w.to),
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
  // Default to satellite — real aerial imagery reads as "the actual jobsite"
  const [base, setBase] = useState<BaseStyle>('satellite')
  const baseRef = useRef(base)
  baseRef.current = base
  const [radarOn, setRadarOn] = useState(false)
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
  const [conditions, setConditions] = useState<Conditions | null>(null)
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
    })

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')
    map.current.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')

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
    map.current.addControl(fitAllControl, 'top-right')
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.current.on('load', () => {
      const m = map.current!

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

      // Reference labels (roads / places) — transparent overlay for Hybrid
      m.addSource('labels-overlay', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
      })
      m.addLayer({ id: 'labels-overlay', type: 'raster', source: 'labels-overlay', layout: { visibility: 'none' } })

      // Road lines + road names for Hybrid (Boundaries_and_Places is cities
      // only). Esri's transportation reference layer completes the classic
      // imagery + roads + labels hybrid stack.
      m.addSource('roads-overlay', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
      })
      m.addLayer({ id: 'roads-overlay', type: 'raster', source: 'roads-overlay', layout: { visibility: 'none' } })

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
            type: 'Feature', geometry: g.geometry, properties: { id: g.id, name: g.name, color: g.color },
          })),
        },
      })
      // Boundary colors (near-black / gray) render OUTLINE-ONLY — no fill — so a
      // large perimeter around the whole yard doesn't tint the map.
      m.addLayer({
        id: 'geofence-fill', type: 'fill', source: 'geofences',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['match', ['get', 'color'], '#0a0a0a', 0, '#9ca3af', 0, 0.14] },
      })
      m.addLayer({ id: 'geofence-outline', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [3, 2] } })
      // Labels anchored to the top edge of each zone (added last so they sit above pins)
      m.addSource('geofence-label-pts', { type: 'geojson', data: geofenceLabelPoints(geofences) })

      // ── Trail / heatmap layers (hidden until a movement mode is on) ──
      m.addSource('trails', { type: 'geojson', data: trailsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-line', type: 'line', source: 'trails',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        // Kiosk shows every asset's full history at once — fade the lines so the
        // wall display reads as ambiance, not spaghetti.
        paint: kiosk
          ? { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.3, 'line-blur': 0.4 }
          : { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85, 'line-blur': 0.3 },
      })
      // Heatmap of movement density (alternative to trails)
      m.addSource('trail-points', { type: 'geojson', data: pointsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-heat', type: 'heatmap', source: 'trail-points',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': 1,
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
      m.addSource('trail-heads', { type: 'geojson', data: headsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trail-heads', type: 'circle', source: 'trail-heads',
        layout: { visibility: 'none' },
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#001523' },
      })
      m.addLayer({
        id: 'trail-head-labels', type: 'symbol', source: 'trail-heads',
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', visibility: 'none' },
        paint: { 'text-color': '#e8f0f7', 'text-halo-color': '#001523', 'text-halo-width': 1.5 },
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
      // soft glow under each pin so assets pop off the satellite imagery
      m.addLayer({
        id: 'asset-glow', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.22, 'circle-radius': 24, 'circle-blur': 0.7 },
      })
      m.addLayer({
        id: 'unclustered-circle', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 14, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#04121d' },
      })
      m.addLayer({
        id: 'unclustered-label', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['match', ['get', 'type'], 'vehicle', '🚛', 'equipment', '🏗️', 'personnel', '👷', 'tool', '🔧', '📍'],
          'text-size': 14, 'text-allow-overlap': true,
        },
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

      // Zone labels — anchored above each zone, with collision avoidance so
      // nearby labels don't overlap (the larger/billable zone wins).
      m.addLayer({
        id: 'geofence-labels', type: 'symbol', source: 'geofence-label-pts',
        layout: {
          'text-field': ['get', 'name'], 'text-size': 13,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'bottom', 'text-offset': [0, -0.5],
          'text-allow-overlap': false, 'text-ignore-placement': false,
          'text-padding': 6, 'symbol-sort-key': ['get', 'pri'],
        },
        paint: { 'text-color': '#e8f0f7', 'text-halo-color': '#001016', 'text-halo-width': 2.4 },
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

  // Update live asset source when assets or filter change
  useEffect(() => {
    if (!mapReady) return
    const source = map.current?.getSource('assets') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildGeoJSON(assets, filter))
  }, [mapReady, assets, filter])

  // Re-render geofences when the prop changes (e.g. a newly saved zone)
  useEffect(() => {
    if (!mapReady) return
    const source = map.current?.getSource('geofences') as maplibregl.GeoJSONSource | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: geofences.map((g) => ({
        type: 'Feature', geometry: g.geometry, properties: { id: g.id, name: g.name, color: g.color },
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
    HEAD_LAYERS.forEach((l) => set(l, trailMode !== 'off'))
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
    ;(m.getSource('trail-heads') as maplibregl.GeoJSONSource | undefined)?.setData(headsGeoJSON(tracksRef.current, filterRef.current, t))
    if (mode === 'trails') {
      ;(m.getSource('trails') as maplibregl.GeoJSONSource | undefined)?.setData(trailsGeoJSON(tracksRef.current, filterRef.current, t))
    } else {
      ;(m.getSource('trail-points') as maplibregl.GeoJSONSource | undefined)?.setData(pointsGeoJSON(tracksRef.current, filterRef.current, t))
    }
  }, [])

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

  // Push trail/heat/head geometry on discrete changes (seek, filter, mode)
  useEffect(() => {
    if (!mapReady) return
    updateMovementSources(displayT)
  }, [mapReady, trailMode, displayT, filter, tracksEff, updateMovementSources])

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
    set('roads-overlay', base === 'hybrid')
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
    for (const id of ['geofence-fill', 'geofence-outline', 'geofence-labels']) {
      if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', showZones ? 'visible' : 'none')
    }
  }, [mapReady, showZones])

  // Kiosk auto-tour: slow cinematic cycle overview → each zone → overview.
  // Any manual drag cancels it (someone walked up to the TV and took over).
  useEffect(() => {
    if (!kiosk || !mapReady) return
    const m = map.current
    if (!m) return
    let stopped = false
    let i = -1
    const step = () => {
      if (stopped) return
      const zones = geofencesRef.current
      i = (i + 1) % (zones.length + 1)
      if (i === zones.length || zones.length === 0) {
        fitAll()
      } else {
        const ring = zones[i].geometry?.coordinates?.[0] as [number, number][] | undefined
        if (!ring?.length) return
        const c: [number, number] = [
          ring.reduce((s, p) => s + p[0], 0) / ring.length,
          ring.reduce((s, p) => s + p[1], 0) / ring.length,
        ]
        m.easeTo({ center: c, zoom: 15.4, duration: 2600 })
      }
    }
    const id = setInterval(step, 18000)
    const cancel = () => { stopped = true; clearInterval(id) }
    m.on('dragstart', cancel)
    return () => { cancel(); m.off('dragstart', cancel) }
  }, [kiosk, mapReady, fitAll])

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
  // beat longer so the loop "lands" on now. Paused during replay: there the
  // radar time-travels with the scrubber instead (see below).
  useEffect(() => {
    if (!radarOn || radarFrames.length === 0 || (pbActive && realWindowEff)) return
    const id = setInterval(() => {
      setRadarIdx((i) => (i + 1) % (radarFrames.length + 2)) // +2 = pause on last
    }, 700)
    return () => clearInterval(id)
  }, [radarOn, radarFrames, pbActive, realWindowEff])

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
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      m.addLayer({ id: 'precip-layer', type: 'raster', source: 'precip', paint: { 'raster-opacity': 0.62 } }, beforeId)
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
      setPbSpeed(defaultSpeed(r)) // sensible multiplier for this range
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

  // Toggle cinematic follow. Picking an asset arms a 3D chase: switch to a replay
  // range if we're live, tilt/zoom the camera up, and play the route from the top.
  const handleFollow = useCallback((id: string | null) => {
    setFollowId(id)
    const m = map.current
    if (!id) {
      // Release: glide back to the flat (or 3D-base) overview.
      m?.easeTo({ pitch: threeDRef.current ? 55 : 0, bearing: 0, duration: 800 })
      return
    }
    setTrailMode((prev) => (prev === 'off' ? 'trails' : prev))
    if (m) { bearingRef.current = m.getBearing(); pitchRef.current = m.getPitch() }
    entranceRef.current = 0
    // Live has no scrubber — drop into Today so the route can actually replay.
    const wasLive = rangeRef.current === 'live'
    if (wasLive) handleRange('today')
    setPbSpeed(defaultSpeed(wasLive ? 'today' : rangeRef.current))
    // Start the chase where the day's driving actually starts.
    tRef.current = firstMoveTRef.current
    setPbT(firstMoveTRef.current)
    setPbPlaying(true)
  }, [handleRange])

  // If the followed asset is filtered out or vanishes, release the camera.
  useEffect(() => {
    if (followId && !tracksEff.some((tr) => tr.assetId === followId && filter.has(tr.type))) {
      handleFollow(null)
    }
  }, [followId, tracksEff, filter, handleFollow])

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

      {!kiosk && <FilterBar filter={filter} onChange={setFilter} showZones={showZones} onToggleZones={() => setShowZones((v) => !v)} showDevices={showDevices} onToggleDevices={isMock ? () => setShowDevices((v) => !v) : undefined} />}

      <WeatherControl
        base={base}
        onBase={setBase}
        threeD={threeD}
        onThreeD={setThreeD}
        radarOn={radarOn}
        onRadar={setRadarOn}
        precipOn={precipOn}
        onPrecip={setPrecipOn}
        precipPeriod={precipPeriod}
        onPrecipPeriod={setPrecipPeriod}
        openView={openView}
        onOpenView={handleOpenView}
        conditions={conditions}
        frameTime={radarLabel}
        place={wxPlace}
        onPlaceChange={handlePlaceChange}
        onSaveDefault={handleSaveWeatherDefault}
        parcelsOn={parcelsOn}
        onParcels={PARCEL_SERVICE_URL ? setParcelsOn : undefined}
        overlays={MAP_OVERLAYS.map((o) => ({ key: o.key, label: o.label, note: o.note, on: !!overlaysOn[o.key] }))}
        onOverlay={(key, on) => setOverlaysOn((prev) => ({ ...prev, [key]: on }))}
        top={kiosk ? 70 : 58}
      />


      {!kiosk && !pbActive && (
        <GeofenceDrawer
          isDrawing={isDrawing}
          onStartDraw={startDrawing}
          onFinishDraw={finishDrawing}
          onCancelDraw={cancelDrawing}
          onSave={onGeofenceSave}
        />
      )}

      {!kiosk && tracksEff.length > 0 && (
        <TimelinePlayback
          range={range}
          onRange={handleRange}
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
        />
      )}

      {selectedAsset && (
        <AssetPanel
          asset={selectedAsset}
          gateway={toolGateways?.[selectedAsset.id]}
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
