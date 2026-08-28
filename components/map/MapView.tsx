'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AssetWithLocation, AssetType, Geofence, AlertEvent } from '@/lib/types'
import { ASSET_ICONS, resolveAssetIcon, TYPE_DEFAULT_ICON } from '@/lib/asset-icons'
import { DEMO_MAP_CENTER, DEMO_MAP_ZOOM } from '@/lib/mock-data'
import {
  type AssetTrack, type TimeRange, type TrailMode, positionAt, trailSegmentsBanded,
  trailSegmentsSpeed, SPEED_CLASS_COLORS,
  defaultSpeedForWindow, tracksFromHistory, mergeHistoryRows, rangeWindowSeconds, RANGES,
} from '@/lib/trails'
import { rangeWindow } from '@/lib/dates'
import {
  type Conditions, type IemFrame,
  fetchConditions, buildRadarFrames, iemRadarUrl, iemTsForMs,
  PRECIP_PERIODS, iemPrecipUrl,
} from '@/lib/weather'
import { measureSummary } from '@/lib/measure'
import { updateMeasurementAction, deleteMeasurementAction } from '@/lib/actions/measurements'
import { toast, confirmSheet } from '@/components/ui/feedback'
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
import { synthesizeToolRows, TOOL_FRESH_MS } from '@/lib/tools-resolve'
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

// Silent past this long = the DEVICE is dark, not the machine parked —
// trackers check in hourly even asleep, so 48h of nothing is a dead/unplugged
// unit. Those dots go gray (color is for living hardware) — Brian, Aug 28.
const DEAD_MS = 48 * 3_600_000
const DEAD_GRAY = '#46586a'

// MapLibre layers that represent the live (non-playback) asset view
const LIVE_LAYERS = ['clusters', 'cluster-count', 'asset-pulse', 'state-ring', 'unclustered-circle', 'unclustered-label', 'unclustered-name', 'tool-count-badge', 'wrench-badge']
const HEAD_LAYERS = ['trail-heads', 'trail-head-glyphs', 'trail-head-labels', 'trail-head-tools-badge']

// ── Cinematic camera-follow tuning ──────────────────────────────────────────
export type FollowMode = 'orbit' | 'overhead' | 'chase'
const FOLLOW_ZOOM = 14.8     // entrance zoom — wide enough for context (Brian,
                             // Aug 22: "too zoomed in"); pinch owns it after
const OVERHEAD_ZOOM = 15.5   // top-down entrance — was 17, same complaint
const CAM_SMOOTH = 0.16      // low-pass factor: camera CHASES the target each
                             // frame instead of pinning to every GPS vertex
const CAM_SNAP_DEG = 0.05    // ~5 km — beyond this the target teleported (a
                             // scrub drag), so snap instead of a slow pan
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

/** Escape untrusted text before it enters popup setHTML — module-wide so
 *  every popup shares one rule (sec-check, Aug 12). */
const escHtml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function buildGeoJSON(assets: AssetWithLocation[], filter: Set<AssetType>, toolCounts?: Record<string, number>, alertIds?: Set<string>, selId?: string | null): GeoJSON.FeatureCollection {
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
          // Selected = white ring + size-up, same as replay heads/tool dots.
          sel: selId === a.id ? 1 : 0,
          // Tools riding this gateway — drawn as a corner count badge.
          toolCount: toolCounts?.[a.id] ?? 0,
          // Sanitize: an invalid stored color must degrade to the type color,
          // never feed the circle layers an unparseable paint value.
          color: /^#[0-9a-fA-F]{3,8}$/.test(String(a.metadata?.color ?? '')) ? String(a.metadata!.color) : ASSET_COLORS[a.type],
          // Silhouette inside the dot — per-asset choice (metadata.icon,
          // validated against the registry) or the type default.
          icon: resolveAssetIcon(a.type, a.metadata),
          battery: a.location!.battery, speed: a.location!.speed, timestamp: a.location!.timestamp,
          // Travel direction for the arrow marker style (null → arrow points N).
          heading: a.location!.heading ?? 0,
          // Wow-pack marker data: wrench badges + idle-dollar rings.
          maint: (a.maintOverdue ?? 0) + (a.openWorkOrders ?? 0),
          // Live unacknowledged alert → red ring + ⚠ in the attention slot
          // (marker grammar, Brian-approved sketch, Aug 22).
          alert: alertIds?.has(a.id) ? 1 : 0,
          idleDays: a.idleDays ?? -1,
          dailyCost: a.daily_cost ?? 0,
          // Four glance-states: moving (fresh fix + speed), idle (device awake
          // and reporting — trackers sleep minutes after ignition-off, so fresh
          // data ≈ powered up), off (stale — asleep/parked), dead (silent past
          // DEAD_MS — the hardware itself is dark, drawn gray).
          state: (() => {
            const age = Date.now() - new Date(a.location!.timestamp).getTime()
            if (age > DEAD_MS) return 'dead'
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
function toolsGeoJSON(assets: AssetWithLocation[], filter: Set<AssetType>, selId?: string | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: assets
      .filter((a) => a.type === 'tool' && filter.has('tool') && a.location)
      .map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.location!.lng, a.location!.lat] },
        properties: {
          id: a.id, name: a.name, type: 'tool',
          sel: selId === a.id ? 1 : 0,
          color: /^#[0-9a-fA-F]{3,8}$/.test(String(a.metadata?.color ?? '')) ? String(a.metadata!.color) : ASSET_COLORS.tool,
          icon: resolveAssetIcon('tool', a.metadata),
          state: Date.now() - new Date(a.location!.timestamp).getTime() < 25 * 60_000 ? 'live' : 'dropped',
        },
      })),
  }
}

// selId marks the selected asset's features (sel) and everyone else's (dim)
// so the paint expressions can spotlight one track without touching layers.
function trailsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number, selId?: string | null, speedWindowSec?: number | null): GeoJSON.FeatureCollection {
  // Speed mode (Brian, Aug 23): color = how fast, not who — teal crawl,
  // amber streets, orange highway, red 70+. Age fading is off here; the
  // color IS the information.
  if (speedWindowSec) {
    return {
      type: 'FeatureCollection',
      features: tracks
        .filter((tr) => filter.has(tr.type))
        .flatMap((tr) =>
          trailSegmentsSpeed(tr, t, speedWindowSec)
            .filter((b) => b.segments.length)
            .map((b) => ({
              type: 'Feature' as const,
              geometry: { type: 'MultiLineString' as const, coordinates: b.segments },
              properties: { id: tr.assetId, color: SPEED_CLASS_COLORS[b.cls], fade: 1, sel: selId === tr.assetId ? 1 : 0, dim: selId && selId !== tr.assetId ? 1 : 0 },
            }))
        ),
    }
  }
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((tr) => filter.has(tr.type))
      .flatMap((tr) =>
        // Age bands: the older stretch of each trail dims, the newest runs
        // full-strength (Brian, Aug 22 — the command-wall look on /map too).
        // MultiLineString per band: segments still break at data gaps so the
        // trail never draws a straight chord across town.
        trailSegmentsBanded(tr, t)
          .filter((b) => b.segments.length)
          .map((b) => ({
            type: 'Feature' as const,
            geometry: { type: 'MultiLineString' as const, coordinates: b.segments },
            properties: { id: tr.assetId, color: tr.color, fade: b.fade, sel: selId === tr.assetId ? 1 : 0, dim: selId && selId !== tr.assetId ? 1 : 0 },
          }))
      ),
  }
}

/** Heat points weighted by TIME REPRESENTED, not existence. Trackers emit
 *  every few seconds while DRIVING and every few minutes while working —
 *  raw point density painted highways red and job sites cold, exactly
 *  backwards ("should not show red for just someone driving down a road",
 *  Aug 10). Weight is LINEAR time (capped 30 min): the old log scale gave a
 *  60-second drive-by ping HALF the weight of a 30-minute dwell, so a whole
 *  trip rendered as one fat red sausage (Brian, Aug 24, the RAM's day). Now
 *  a minute is worth a minute: routes read as thin cool traces, real dwell
 *  stacks to red — and the kernel RADIUS also grows with weight, so stops
 *  bloom while the road stays a narrow line. */
const HEAT_DT_CAP = 1800
function pointsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number, selId?: string | null, windowSec = 86_400): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const tr of tracks) {
    if (!filter.has(tr.type)) continue
    const sel = selId === tr.assetId ? 1 : 0
    const dim = selId && selId !== tr.assetId ? 1 : 0
    const pts = tr.points
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (p.t > t) break
      const nextT = i + 1 < pts.length ? Math.min(pts[i + 1].t, t) : t
      // A fresh fix with no successor yet still counts a little (45 s floor)
      // so Live view isn't blank where an asset just reported.
      const dtSec = Math.max(45, (nextT - p.t) * windowSec)
      // Motion damper: a MOVING fix's time was spread along the road, not
      // spent on this spot — without it, sparse-cadence pings while driving
      // still capped out and the whole trip glowed (Brian, Aug 24). Reported
      // speed when the fix has one, else implied from the hop to the next.
      let mph = p.mph ?? null
      if (mph == null && i + 1 < pts.length) {
        const n = pts[i + 1]
        const dx = (n.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180) * 111_320
        const dy = (n.lat - p.lat) * 111_320
        mph = (Math.hypot(dx, dy) / Math.max(1, dtSec)) * 2.23694
      }
      // Stationary/working time counts FULL — parked and working ARE time on
      // the spot (the legend's story). Only ROAD SPEED is damped, and gently:
      // routes must stay a visible ribbon while dwell areas run red and
      // large (Brian, Aug 25 — the first cut over-damped everything).
      const motion = mph == null || mph <= 3 ? 1
        : mph >= 10 ? 0.18
        : 1 - ((mph - 3) / 7) * 0.82
      const w = (Math.min(dtSec, HEAT_DT_CAP) / HEAT_DT_CAP) * motion
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { sel, dim, w } })
    }
  }
  return { type: 'FeatureCollection', features }
}

function headsGeoJSON(tracks: AssetTrack[], filter: Set<AssetType>, t: number, selId?: string | null, toolCounts?: Record<string, number>, iconOf?: Map<string, string>): GeoJSON.FeatureCollection {
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
        properties: { id: tr.assetId, name: tr.name, color: tr.color, type: tr.type, sel: selId === tr.assetId ? 1 : 0, toolCount: toolCounts?.[tr.assetId] ?? 0, icon: iconOf?.get(tr.assetId) ?? TYPE_DEFAULT_ICON[tr.type] },
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
  /** Placed drone/site imagery (052/053/055): every placed photo (the map
   *  timeline picks the frame) + each zone's active plan sheet. Photos ride
   *  the 'siteimg' toggle, plans ride 'siteplans'. */
  siteOverlays?: { id: string; url: string; coords: [[number, number], [number, number], [number, number], [number, number]]; zoneId: string; takenOn: string; kind?: 'photo' | 'plan' }[]
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
  onGeofenceSave?: (name: string, geometry: GeoJSON.Polygon, color: string, kind: 'site' | 'boundary' | 'yard' | 'vendor', opts?: import('@/lib/types').ZoneFormOpts) => void
  /** Rename/recolor a zone from its map sheet (optimistic + persisted). */
  onGeofenceEdit?: (id: string, name: string, color: string) => void
  /** Delete a zone from its map sheet. */
  onGeofenceDelete?: (id: string) => void
  /** Recent alert events — powers the "Alert pins" site layer. */
  alerts?: AlertEvent[]
  /** Saved measurement to draw + fly to (deep link from /measurements). */
  focusMeasurement?: import('@/lib/db/measurements').Measurement | null
  /** All saved measurements — the 'Measurements' overlay layer. */
  measurements?: import('@/lib/db/measurements').Measurement[]
  /** Company branding for the Create-PDF button (logo + name on the header). */
  brand?: { companyName: string; logoUrl: string | null; logoBg?: string | null } | null
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
  /** False hides every dollar figure (timeline chip, $ chart mode, zone $). */
  canViewCosts?: boolean
  /** User's saved map views from their profile (DB copy wins over device). */
  savedMapViews?: MapViewsState | null
  /** Persist saved views to the user's profile (absent in demo mode). */
  onSaveMapViews?: (s: MapViewsState) => void
}

export function MapView({ assets, geofences, tracks = [], historyRows = null, siteOverlays = [], earliestMs = null, tz = 'America/New_York', toolGateways, aboard, pairingEpisodes, onGeofenceSave, onGeofenceEdit, onGeofenceDelete, alerts = [], focusMeasurement = null, measurements = [], kiosk = false, tourOn = true, onTourInterrupt, defaultWeatherPlace = null, defaultWeatherCoords = null, canViewCosts = true, savedMapViews = null, onSaveMapViews, brand = null }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  // Sunlight mode (Brian, Aug 22, decision 8c-f): a high-contrast boost for
  // reading the map at noon in the truck — pure CSS filter on the canvas
  // (globals.css .ht-sun). The class is applied via classList, NEVER through
  // React's className: MapLibre owns runtime classes on this node, and a
  // React class write wiped maplibregl-map's overflow clip (ship-check P1) —
  // and the lazy-init read never survived hydration anyway.
  const [sunMode, setSunMode] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem('ht_sun') === '1') setSunMode(true) } catch { /* private mode */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('ht_sun', sunMode ? '1' : '0') } catch { /* private mode */ }
    mapContainer.current?.classList.toggle('ht-sun', sunMode)
  }, [sunMode])
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
    base: BaseStyle; threeD: boolean; terrain: boolean; terrainExag: number; radar: boolean; clouds: boolean; stormtops: boolean
    precip: boolean; precipPeriod: string; parcels: boolean; zones: boolean; labels: boolean
    overlays: Record<string, boolean>; trailMode: TrailMode; markers: 'dot' | 'arrow'
  }>>((() => {
    try {
      const raw = typeof window !== 'undefined'
        ? localStorage.getItem(kiosk ? 'ht_last_state_command' : 'ht_last_state_map')
        : null
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })()).current
  const [showZones, setShowZones] = useState(lastState.zones ?? true)
  // Name labels (assets, tools, zones) — one kill switch for all of them at
  // every zoom (Brian, Aug 11). ON keeps the existing zoom-ladder convention.
  const [showLabels, setShowLabels] = useState(lastState.labels ?? true)
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
  const isDrawingRef = useRef(false)
  isDrawingRef.current = isDrawing
  const drawCoords = useRef<[number, number][]>([])
  const drawPreviewSource = useRef<string>('draw-preview')

  // ── Timeline playback state ───────────────────────────────────────────────
  const [range, setRange] = useState<TimeRange>('live')
  // Custom From/To window (defaults to the last 7 days). Epoch ms.
  const [customFrom, setCustomFrom] = useState(() => Date.now() - 7 * 86_400_000)
  const [customTo, setCustomTo] = useState(() => Date.now())
  const customDays = Math.max(1, Math.round((customTo - customFrom) / 86_400_000))
  const pbActive = range !== 'live'
  // Ref mirror for ASYNC effect bodies (clouds/storm tops): an in-flight
  // fetch that resolves after the user enters a replay must not re-show a
  // live-only layer under a historical scrubber (task #13 follow-on).
  const pbActiveRef = useRef(pbActive)
  pbActiveRef.current = pbActive
  // Kiosk (Command Center) shows movement trails by default — the wall display
  // should look alive without anyone touching it.
  // Trails ON is the default everywhere (Brian, Aug 12: "default live view
  // should have trails on") — a remembered choice still wins.
  const [trailMode, setTrailMode] = useState<TrailMode>(lastState.trailMode ?? 'trails')
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
  const camRef = useRef<[number, number] | null>(null) // smoothed follow-camera center
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
  // Marker style on the live view: plain colored dots (match the replay
  // trail-head look — owner ask, Jul 31) or direction arrows: ground-aligned
  // pucks in the asset's color, rotated to the travel heading, with the type
  // emoji riding upright on top.
  const [markerStyle, setMarkerStyle] = useState<'dot' | 'arrow'>(lastState.markers ?? 'dot')
  // Speed-colored trails (Brian, Aug 23): trail ink shows HOW FAST instead of
  // per-asset color + age fade. Persisted per device.
  const [speedTrails, setSpeedTrails] = useState(false)
  useEffect(() => {
    try { setSpeedTrails(localStorage.getItem('ht_trail_speed') === '1') } catch { /* private mode */ }
  }, [])
  const speedTrailsRef = useRef(speedTrails)
  speedTrailsRef.current = speedTrails
  const toggleSpeedTrails = useCallback(() => {
    setSpeedTrails((v) => {
      try { localStorage.setItem('ht_trail_speed', v ? '0' : '1') } catch { /* private mode */ }
      return !v
    })
  }, [])
  // 3D terrain units (Brian, Aug 24): extrude hours worked or dollars
  // accumulated. Persisted per device; $ needs the cost permission upstream.
  const [heat3dUnits, setHeat3dUnits] = useState<'hours' | 'dollars'>('hours')
  useEffect(() => {
    // $ terrain is cost-gated — a persisted 'dollars' never survives into a
    // role that can't see dollars.
    try { if (canViewCosts && localStorage.getItem('ht_heat3d_units') === 'dollars') setHeat3dUnits('dollars') } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const heat3dUnitsRef = useRef(heat3dUnits)
  heat3dUnitsRef.current = heat3dUnits
  const pickHeat3dUnits = useCallback((u: 'hours' | 'dollars') => {
    setHeat3dUnits(u)
    try { localStorage.setItem('ht_heat3d_units', u) } catch { /* private mode */ }
  }, [])
  // $/hr per asset for the $ terrain — hourly rate, else daily cost spread
  // over an 8-hour day. Assets with neither contribute $0 in dollars mode.
  const heat3dRates = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assets) {
      const r = a.hourly_rate ?? (a.daily_cost != null ? a.daily_cost / 8 : 0)
      if (r > 0) m.set(a.id, r)
    }
    return m
  }, [assets])
  const heat3dRatesRef = useRef(heat3dRates)
  heat3dRatesRef.current = heat3dRates
  const [terrain3d, setTerrain3d] = useState(lastState.terrain ?? false)
  const terrain3dRef = useRef(terrain3d)
  terrain3dRef.current = terrain3d
  // Vertical exaggeration for the DEM — 1.3 reads natural in the mountains;
  // cranking it makes creek beds and ditches pop on flat lowcountry ground.
  const [terrainExag, setTerrainExag] = useState(lastState.terrainExag ?? 1.3)
  const terrainExagRef = useRef(terrainExag)
  terrainExagRef.current = terrainExag
  // Create PDF — branded snapshot of the current view. Lives in a ref so the
  // imperative MapLibre control (created once at init) always calls the
  // freshest closure (assets/brand/range change between renders).
  const makePdfRef = useRef<(() => Promise<void>) | null>(null)
  // Control-rail "New zone" handler — assigned after handleRange/startDrawing
  // exist (they're declared much later in this file).
  const drawZoneRef = useRef<(() => void) | null>(null)
  makePdfRef.current = async () => {
    const m = map.current
    if (!m) return
    try {
      const { createBrandedPdf, captureMapCanvas, coverCrop, MARGIN } = await import('@/lib/pdf-brand')
      const raw = await captureMapCanvas(m)
      const rangeLabelTxt = RANGES.find((r) => r.key === range)?.label ?? 'Live'
      // 8.5x11 PORTRAIT by default (owner ask, Aug 6) — the standard sheet in
      // a job binder. The capture center-crops to FILL the content box, so
      // phone (tall) and PC (wide) exports both come out full-page.
      const pdf = await createBrandedPdf({
        companyName: brand?.companyName ?? 'HammerTrack',
        logoUrl: brand?.logoUrl ?? null,
        logoBg: brand?.logoBg ?? null,
        title: kiosk ? 'Command Center' : 'Fleet map',
        subtitle: `${rangeLabelTxt} view`,
      }, 'portrait')
      const { doc, pw, ph, contentTop } = pdf
      const legendH = 16
      const availW = pw - MARGIN * 2
      const availH = ph - contentTop - legendH - 12
      const img = await coverCrop(raw, availW / availH)
      const w = availW
      const h = availH
      doc.addImage(img, 'JPEG', MARGIN, contentTop, w, h)
      // Asset legend — the same identity colors the map uses.
      const legendY = contentTop + h + 6
      doc.setFontSize(8)
      let lx = MARGIN
      for (const a of assets.filter((x) => x.location && x.type !== 'tool')) {
        const hex = /^#[0-9a-fA-F]{6}$/.test(String(a.metadata?.color ?? '')) ? String(a.metadata!.color) : ASSET_COLORS[a.type]
        const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
        const label = a.name.length > 22 ? `${a.name.slice(0, 21)}…` : a.name
        const wTxt = doc.getTextWidth(label) + 7
        if (lx + wTxt > pw - MARGIN) break // one clean row — never spill the page
        doc.setFillColor(...rgb)
        doc.circle(lx + 1.6, legendY, 1.6, 'F')
        doc.setTextColor(70, 85, 100)
        doc.text(label, lx + 4.5, legendY + 1.1)
        lx += wTxt + 4
      }
      pdf.finish(`hammertrack-${kiosk ? 'command' : 'map'}-${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (e) {
      console.error('PDF export failed', e)
    }
  }

  // Measure + takeoff tool overlay (off by default). Ref so the map's
  // click-to-select handlers can bail while measuring (clicks add vertices).
  const [measureOn, setMeasureOn] = useState(false)
  const measureOnRef = useRef(false)
  measureOnRef.current = measureOn
  // Saved measurements — the client copy (upserted on save/edit/delete so the
  // layer reflects changes without a reload), the tapped one, and the one
  // loaded into the measure tool for editing.
  type SavedMeasure = import('@/lib/db/measurements').Measurement
  const [measures, setMeasures] = useState<SavedMeasure[]>(measurements)
  useEffect(() => { if (measurements.length) setMeasures(measurements) }, [measurements])
  const measuresRef = useRef(measures)
  measuresRef.current = measures
  const [selectedMeasure, setSelectedMeasure] = useState<SavedMeasure | null>(null)
  // Tell the timeline a selection sheet opened/closed so it can step down to
  // its bar stage on phones (Aug 22: peek sheet + full timeline + bottom nav
  // left ≈ zero visible map). TimelinePlayback listens for 'ht:sheet-open'.
  const sheetOpen = !!(selectedAsset || selectedZone || selectedMeasure)
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('ht:sheet-open', { detail: { open: sheetOpen } })) } catch { /* SSR */ }
  }, [sheetOpen])
  const [editingMeasure, setEditingMeasure] = useState<SavedMeasure | null>(null)
  // Two-finger HOLD anywhere on the map = quick measure (Brian, Aug 23):
  // both fingers still for ~½ s drops a measuring line BETWEEN the two
  // touch points and opens the tool with it loaded. Any movement (a pinch,
  // a pan) cancels the hold.
  const [measureSeed, setMeasureSeed] = useState<{ id: string; name: string; kind: 'point' | 'line' | 'area'; personal: boolean; coords: [number, number][] } | null>(null)
  // Stable identity — an inline object literal re-triggered MeasureTool's
  // load effect on EVERY MapView render, stomping in-progress edits the
  // moment the user pinch-zoomed (ship-check P0, Aug 18).
  const measureInitial = useMemo(() => editingMeasure ? {
    id: editingMeasure.id,
    name: editingMeasure.name,
    kind: editingMeasure.kind,
    personal: editingMeasure.personal,
    coords: editingMeasure.geometry.type === 'Point'
      ? [editingMeasure.geometry.coordinates as [number, number]]
      : editingMeasure.geometry.type === 'LineString'
        ? (editingMeasure.geometry.coordinates as [number, number][])
        : (editingMeasure.geometry.coordinates[0] as [number, number][]).slice(0, -1),
  } : null, [editingMeasure])
  const [measureRename, setMeasureRename] = useState<string | null>(null)
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

  // Saved measurement deep link (/map?m=<id> from the Measurements page):
  // draw the saved geometry in the measure tool's amber and fly to it.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m || !focusMeasurement) return
    const g = focusMeasurement.geometry
    const coords: [number, number][] =
      g.type === 'Point' ? [g.coordinates as [number, number]]
      : g.type === 'LineString' ? (g.coordinates as [number, number][])
      : (g.coordinates[0] as [number, number][])
    if (!coords.length) return
    const label = `${focusMeasurement.name} — ${measureSummary(focusMeasurement.kind, focusMeasurement.props)}`
    const mid = coords[Math.floor(coords.length / 2)]
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: g },
        { type: 'Feature', properties: { lbl: label }, geometry: { type: 'Point', coordinates: g.type === 'Point' ? coords[0] : mid } },
        ...coords.map((c) => ({ type: 'Feature' as const, properties: { vertex: 1 }, geometry: { type: 'Point' as const, coordinates: c } })),
      ],
    }
    const SRC = 'measure-focus'
    const add = () => {
      if (!m.getSource(SRC)) m.addSource(SRC, { type: 'geojson', data: fc })
      if (!m.getLayer('mfocus-fill')) m.addLayer({ id: 'mfocus-fill', type: 'fill', source: SRC, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.18 } })
      if (!m.getLayer('mfocus-line')) m.addLayer({ id: 'mfocus-line', type: 'line', source: SRC, filter: ['!=', '$type', 'Point'], paint: { 'line-color': '#ffb648', 'line-width': 2.5, 'line-dasharray': [2, 1] } })
      if (!m.getLayer('mfocus-verts')) m.addLayer({ id: 'mfocus-verts', type: 'circle', source: SRC, filter: ['==', 'vertex', 1], paint: { 'circle-radius': 5.5, 'circle-color': '#fff', 'circle-stroke-color': '#f5a623', 'circle-stroke-width': 2 } })
      if (!m.getLayer('mfocus-label')) m.addLayer({
        id: 'mfocus-label', type: 'symbol', source: SRC, filter: ['has', 'lbl'],
        layout: { 'text-field': ['get', 'lbl'], 'text-size': 12, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-offset': [0, -1.4], 'text-allow-overlap': true },
        paint: { 'text-color': '#ffe0b0', 'text-halo-color': '#04121d', 'text-halo-width': 1.8 },
      })
    }
    let disposed = false
    const ensure = () => {
      if (disposed) return
      try { add() } catch { m.once('idle', ensure) }
    }
    ensure()
    const fit = () => {
      if (g.type === 'Point') { m.flyTo({ center: coords[0], zoom: 17, duration: 1100 }); return }
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
      m.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 90, maxZoom: 18, duration: 1100 })
    }
    fit()
    // Drop ?m= from the URL once focused — otherwise every refresh re-flies
    // to this measurement ("page refresh is zooming to the measurement",
    // Brian, Aug 17). Back/refresh then behave like a normal map open.
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.has('m')) { u.searchParams.delete('m'); const qs = u.searchParams.toString(); window.history.replaceState(null, '', u.pathname + (qs ? '?' + qs : '')) }
    } catch { /* URL API unavailable — harmless */ }
    // Re-assert once — the first-open zoom-to-fleet can land later and steal
    // the camera from the deep link.
    const t = setTimeout(fit, 1600)
    return () => {
      disposed = true
      clearTimeout(t)
      for (const l of ['mfocus-fill', 'mfocus-line', 'mfocus-verts', 'mfocus-label']) if (m.getLayer(l)) m.removeLayer(l)
      if (m.getSource(SRC)) m.removeSource(SRC)
    }
  }, [mapReady, focusMeasurement])


  // On-demand full-resolution history for the selected window. The shipped
  // snapshot is capped + newest-biased (older days were getting silently
  // truncated \u2014 "yesterday's track lost data"), so once a replay range is
  // picked we fetch EXACTLY that window from /api/history and swap it in.
  const [fetchedRows, setFetchedRows] = useState<Record<string, import('@/lib/db/assets').LocationHistoryRow[]>>({})
  // Window key currently downloading its FIRST full-resolution fetch — drives
  // the thin sweep bar above the scrubber (background re-pulls stay silent).
  const [historyLoadingKey, setHistoryLoadingKey] = useState<string | null>(null)
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
    if (!fetchedRows[key]) setHistoryLoadingKey(key)
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
        .finally(() => setHistoryLoadingKey((k) => (k === key ? null : k)))
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
    // Snapshot slice + the window's own fetch, UNIONED (never replaced). The
    // shipped snapshot is capped newest-first, so on its own it starves long
    // ranges; the fetch is evenly sampled, so on its own it can be thinner
    // than the snapshot in the recent days. Together they're monotonic — a
    // wider range can never render less than a narrower one (Jul 30).
    const snapshot = historyRows.filter((r) => {
      const ms = Date.parse(r.timestamp)
      return ms >= w.from && ms < w.to
    })
    const fetched = fetchedRows[`${w.from}-${w.to}`]
    const rows = fetched ? mergeHistoryRows(snapshot, fetched) : snapshot
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
  // Assets wearing a LIVE unacknowledged alert — feeds the red ring + the
  // ⚠ attention slot (marker grammar). Routine enter/exit crossings are
  // activity, not alerts (same rule as the bell badge).
  const alertAssetIds = useMemo(() => {
    const s = new Set<string>()
    for (const a of alerts) {
      if (a.acknowledged_at) continue
      if (!a.kind && (a.rule?.trigger === 'enter' || a.rule?.trigger === 'exit')) continue
      s.add(a.asset_id)
    }
    return s
  }, [alerts])
  const alertIdsRef = useRef(alertAssetIds)
  alertIdsRef.current = alertAssetIds
  // Per-asset silhouette lookup for the replay heads (tracks don't carry
  // metadata, so heads resolve their icon from the live asset list).
  const iconById = useMemo(() => new Map(assets.map((a) => [a.id, resolveAssetIcon(a.type, a.metadata)])), [assets])
  const iconByIdRef = useRef(iconById)
  iconByIdRef.current = iconById
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

  // Fit the map to the ASSETS on screen — not zones or boundaries (Brian,
  // Aug 10: a county-sized boundary ring made "zoom to all" useless).
  // Respects the type filter so hidden asset types don't drag the frame.
  // Zones are only the fallback when there are no positioned assets at all
  // (a brand-new company that's drawn a site but plugged nothing in yet).
  const fitAll = useCallback(() => {
    const m = map.current
    if (!m) return
    const pts: [number, number][] = []
    for (const a of assetsRef.current) {
      if (a.location && filterRef.current.has(a.type)) pts.push([a.location.lng, a.location.lat])
    }
    if (!pts.length) {
      for (const g of geofencesRef.current) {
        const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
        if (ring) for (const c of ring) pts.push([c[0], c[1]])
      }
    }
    if (!pts.length) return
    const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
    m.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 600 })
  }, [])

  // Shell-first boot: the page can mount with ZERO assets/zones while
  // /api/map-data is in flight. When the fleet lands moments later, frame it
  // once — but ONLY if the camera didn't restore to the user's last view
  // (fitting over the restored view yanked the map on every open, Aug 10).
  // Never fires on ordinary live updates (only if we genuinely booted empty).
  const bootedEmpty = useRef(assets.length === 0 && geofences.length === 0)
  const camRestoredRef = useRef(false)
  useEffect(() => {
    if (!mapReady) return
    if (camRestoredRef.current) { bootedEmpty.current = false; return }
    if (bootedEmpty.current && (assets.length > 0 || geofences.length > 0)) {
      bootedEmpty.current = false
      fitAll()
    }
  }, [mapReady, assets.length, geofences.length, fitAll])

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
  // Hybrid by default (owner ask, Jul 23) — imagery WITH road/label overlay,
  // the view contractors actually navigate by. A user's choice still wins:
  // last-state restore and saved default views override this.
  const [base, setBase] = useState<BaseStyle>(lastState.base ?? (kiosk ? 'dark' : 'hybrid'))
  const baseRef = useRef(base)
  baseRef.current = base
  const [radarOn, setRadarOn] = useState(lastState.radar ?? kiosk)
  // Manual freeze for the live radar loop (map stays put, sky stops moving).
  const [radarPaused, setRadarPaused] = useState(false)
  // The right-rail radar button (native map control) — appearance synced to
  // radarOn by an effect, since IControls are built once outside React.
  const radarBtnEl = useRef<HTMLButtonElement | null>(null)
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

  // ── Saved measurements — the 'Measurements' overlay: every saved point/
  // line/area drawn in measure-amber with a name+summary label; tap to open
  // the sheet (rename / edit shape / delete). The one being edited hides so
  // the measure tool's draft isn't drawn twice.
  const measClickBoundRef = useRef(false)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const SRC = 'msaved'
    const on = !!overlaysOn.measures
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: measures.filter((mm) => mm.id !== editingMeasure?.id).flatMap((mm) => {
        const g = mm.geometry
        const coords: [number, number][] =
          g.type === 'Point' ? [g.coordinates as [number, number]]
          : g.type === 'LineString' ? (g.coordinates as [number, number][])
          : (g.coordinates[0] as [number, number][])
        if (!coords.length) return []
        const mid = coords[Math.floor(coords.length / 2)]
        return [
          { type: 'Feature' as const, properties: { id: mm.id, pt: g.type === 'Point' ? 1 : 0 }, geometry: g },
          { type: 'Feature' as const, properties: { id: mm.id, lbl: `${mm.name} — ${measureSummary(mm.kind, mm.props)}` }, geometry: { type: 'Point' as const, coordinates: g.type === 'Point' ? coords[0] : mid } },
        ]
      }),
    }
    const ensure = () => {
      if (!m.getSource(SRC)) m.addSource(SRC, { type: 'geojson', data: fc })
      else (m.getSource(SRC) as maplibregl.GeoJSONSource).setData(fc)
      if (!m.getLayer('msaved-fill')) m.addLayer({ id: 'msaved-fill', type: 'fill', source: SRC, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.13 } })
      if (!m.getLayer('msaved-line')) m.addLayer({ id: 'msaved-line', type: 'line', source: SRC, filter: ['!=', '$type', 'Point'], paint: { 'line-color': '#ffb648', 'line-width': 2, 'line-dasharray': [2, 1.2] } })
      // Invisible fat line — a 2px dash is untappable with a thumb.
      if (!m.getLayer('msaved-hit')) m.addLayer({ id: 'msaved-hit', type: 'line', source: SRC, filter: ['!=', '$type', 'Point'], paint: { 'line-color': '#000', 'line-width': 22, 'line-opacity': 0.001 } })
      if (!m.getLayer('msaved-pts')) m.addLayer({ id: 'msaved-pts', type: 'circle', source: SRC, filter: ['==', 'pt', 1], paint: { 'circle-radius': 6.5, 'circle-color': '#f5a623', 'circle-stroke-color': '#04121d', 'circle-stroke-width': 2 } })
      if (!m.getLayer('msaved-pts-hit')) m.addLayer({ id: 'msaved-pts-hit', type: 'circle', source: SRC, filter: ['==', 'pt', 1], paint: { 'circle-radius': 18, 'circle-color': '#000', 'circle-opacity': 0.001 } })
      if (!m.getLayer('msaved-label')) m.addLayer({
        id: 'msaved-label', type: 'symbol', source: SRC, filter: ['has', 'lbl'], minzoom: 12,
        layout: { 'text-field': ['get', 'lbl'], 'text-size': 11, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-offset': [0, -1.2], 'text-max-width': 16 },
        paint: { 'text-color': '#ffe0b0', 'text-halo-color': '#04121d', 'text-halo-width': 1.6 },
      })
      const vis = on ? 'visible' : 'none'
      for (const l of ['msaved-fill', 'msaved-line', 'msaved-hit', 'msaved-pts', 'msaved-pts-hit', 'msaved-label']) m.setLayoutProperty(l, 'visibility', vis)
      if (!measClickBoundRef.current) {
        measClickBoundRef.current = true
        const pick = (e: maplibregl.MapLayerMouseEvent) => {
          if (measureOnRef.current) return // measuring — taps place vertices
          if (isDrawingRef.current) return // drawing a zone — taps are corners
          // Asset pins win over the (22px-fat) measurement hit line — same
          // protection the zone handler has (ship-check P2, Aug 18).
          const pad = 14
          const abox: [maplibregl.PointLike, maplibregl.PointLike] = [
            [e.point.x - pad, e.point.y - pad],
            [e.point.x + pad, e.point.y + pad],
          ]
          const aLayers = ['unclustered-circle', 'asset-arrows', 'asset-glow', 'clusters', 'device-bg'].filter((l) => m.getLayer(l))
          if (aLayers.length && m.queryRenderedFeatures(abox, { layers: aLayers }).length) return
          const id = e.features?.[0]?.properties?.id
          const hit = measuresRef.current.find((x) => x.id === id)
          if (!hit) return
          setSelectedAsset(null)
          setSelectedDevice(null)
          setSelectedZone(null)
          setSelectedMeasure(hit)
          setMeasureRename(null)
        }
        for (const l of ['msaved-fill', 'msaved-hit', 'msaved-pts-hit']) {
          m.on('click', l, pick)
          m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer' })
          m.on('mouseleave', l, () => { m.getCanvas().style.cursor = '' })
        }
      }
    }
    let disposed = false
    const tryEnsure = () => { if (disposed) return; try { ensure() } catch { m.once('idle', tryEnsure) } }
    tryEnsure()
    return () => { disposed = true }
  }, [mapReady, overlaysOn.measures, measures, editingMeasure])
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
        base, threeD, terrain: terrain3d, terrainExag, radar: radarOn, clouds: cloudsOn, stormtops: stormTopsOn,
        precip: precipOn, precipPeriod, parcels: parcelsOn, zones: showZones, labels: showLabels,
        overlays: overlaysOn, trailMode, markers: markerStyle,
      }))
    } catch { /* private mode */ }
  }, [kiosk, base, threeD, terrain3d, terrainExag, radarOn, cloudsOn, stormTopsOn, precipOn, precipPeriod, parcelsOn, showZones, showLabels, overlaysOn, trailMode, markerStyle])

  // Factory reset for the whole panel — spec rule 6.
  const resetLayers = useCallback(() => {
    setBase(kiosk ? 'dark' : 'satellite')
    setThreeD(false)
    setTerrain3d(false)
    setTerrainExag(1.3)
    setMarkerStyle('dot')
    setRadarOn(kiosk)
    setRadarPaused(false)
    setCloudsOn(false)
    setStormTopsOn(false)
    setPrecipOn(false)
    setParcelsOn(false)
    setShowZones(true)
    setShowLabels(true)
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
    setTerrainExag(c.terrainExag ?? 1.3)
    // Views configure the MAP, not the asset grammar: only a view that
    // explicitly saved a marker style changes it (user-saved views always
    // do). Presets used to force everyone back to dots — the "assets look
    // different after I tap a view" complaint (Brian, Aug 24).
    if (c.markers) setMarkerStyle(c.markers)
    setRadarOn(c.radar)
    setCloudsOn(c.clouds ?? false)
    // Storm tops isn't part of any view cfg — clear it so a precip-on view
    // can't stack two surface weather layers while the highlight claims an
    // exact match (ship-check).
    setStormTopsOn(false)
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
  const defaultViewUsed = useRef(false)
  useEffect(() => {
    if (kiosk || defaultAppliedRef.current) return
    defaultAppliedRef.current = true
    const def = mapViews.defaultId ? allViews(mapViews).find((v) => v.id === mapViews.defaultId) : null
    if (def) { defaultViewUsed.current = true; applyView(def) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shell-first boot delivers the PROFILE copy of saved views after mount.
  // Adopt the LIST only (so the picker shows cross-device views) — never
  // apply a default view late. Doing so re-tilted/re-styled the map seconds
  // after open ("tilting automatically", Aug 10); the open must be the
  // user's last view, with defaults applied only at mount (an explicit
  // choice made in the views panel / Settings).
  const profileViewsAdopted = useRef(savedMapViews != null)
  useEffect(() => {
    if (kiosk || profileViewsAdopted.current || !savedMapViews) return
    profileViewsAdopted.current = true
    setMapViews(savedMapViews)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMapViews])

  const persistViews = useCallback((s: MapViewsState) => {
    setMapViews(s)
    saveLocalViews(s)
    onSaveMapViews?.(s)
  }, [onSaveMapViews])

  // One cfg builder for BOTH save-as-new and overwrite — the snapshot of
  // every toggle that makes up "how the map looks right now".
  const currentViewCfg = useCallback(() => ({
    base, threeD, terrain: terrain3d, terrainExag, radar: radarOn, clouds: cloudsOn, precip: precipOn, precipPeriod,
    overlays: { ...overlaysOn }, parcels: parcelsOn, trailMode, zones: showZones, markers: markerStyle,
  }), [base, threeD, terrain3d, terrainExag, radarOn, cloudsOn, precipOn, precipPeriod, overlaysOn, parcelsOn, trailMode, showZones, markerStyle])

  const handleSaveView = useCallback((name: string) => {
    const v: SavedMapView = {
      id: `v-${Date.now().toString(36)}`,
      name: name.trim().slice(0, 40) || 'My view',
      cfg: currentViewCfg(),
    }
    persistViews({ views: [v, ...mapViews.views].slice(0, 20), defaultId: mapViews.defaultId })
    setActiveViewId(v.id)
  }, [currentViewCfg, mapViews, persistViews])

  // Overwrite a PERSONAL view with the current look (Brian, Aug 22) — presets
  // ship with the app and are never touched (they live outside mapViews.views
  // anyway, but the guard keeps a spoofed id honest).
  const handleUpdateView = useCallback((id: string) => {
    const target = mapViews.views.find((v) => v.id === id)
    if (!target || target.preset) return
    persistViews({
      views: mapViews.views.map((v) => (v.id === id ? { ...v, cfg: currentViewCfg() } : v)),
      defaultId: mapViews.defaultId,
    })
    setActiveViewId(id)
    toast(`"${target.name}" now opens with this exact look.`, { variant: 'success' })
  }, [mapViews, persistViews, currentViewCfg])

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

  // A view is a STARTING POINT (Brian, Aug 24): the highlight means "the map
  // looks exactly like this view right now". The moment any layer or style
  // toggle diverges from the applied view's snapshot, the highlight clears —
  // and "Save current" is how the tweaked look becomes their own view.
  useEffect(() => {
    if (!activeViewId) return
    const v = allViews(mapViews).find((x) => x.id === activeViewId)
    if (!v) { setActiveViewId(null); return }
    const c = v.cfg
    const onKeys = (o: Record<string, boolean> | undefined) =>
      Object.keys(o ?? {}).filter((k) => o?.[k]).sort().join(',')
    const matches =
      c.base === base &&
      c.threeD === threeD &&
      (c.terrain ?? false) === terrain3d &&
      (c.terrainExag ?? 1.3) === terrainExag &&
      // Views without a saved marker style don't constrain it (see applyView).
      (c.markers == null || c.markers === markerStyle) &&
      c.radar === radarOn &&
      (c.clouds ?? false) === cloudsOn &&
      c.precip === precipOn &&
      (!c.precip || c.precipPeriod === precipPeriod) &&
      onKeys(c.overlays) === onKeys(overlaysOn) &&
      // Compare against what applyView could actually turn on — a view that
      // wants parcels isn't "diverged from" on a device with no parcel URL.
      (PARCEL_SERVICE_URL ? c.parcels : false) === parcelsOn &&
      c.trailMode === trailMode &&
      c.zones === showZones
    if (!matches) setActiveViewId(null)
  }, [activeViewId, mapViews, base, threeD, terrain3d, terrainExag, markerStyle, radarOn, cloudsOn, precipOn, precipPeriod, overlaysOn, parcelsOn, trailMode, showZones])
  // Conditions display moved to the top bar (TopBarWeather fetches its own);
  // MapView still resolves the weather PLACE (wxPlace/wxCoordsRef drive the
  // radar/layers) and keeps the fetch warm for the same 10-min cache.
  const [, setConditions] = useState<Conditions | null>(null)
  const [, setWxPlace] = useState('Nashville, TN')
  // Current weather coords [lng, lat] — saved with the default so reopening
  // uses the exact point, not a name re-geocode (which picked the wrong
  // "Greenville" — NC outranks SC by population).
  const wxCoordsRef = useRef<[number, number] | null>(null)
  const wxAdded = useRef(false)
  // Radar tiles that failed to load since the last frame swap. setTiles()
  // runs SourceCache.reload(true), which force-marks even ERRORED (texture-
  // less) tiles as "expired" — a state hasData() calls renderable — so the
  // raster draw derefs tile.texture on undefined ("reading 'bind'" storm,
  // 26 uncaught errors in 6s with the feed down). When any wx tile has
  // errored we swap the source wholesale instead: fresh tiles start in
  // "loading" (not renderable) and failed tiles simply stay invisible.
  const wxTileErr = useRef(false)

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
    // Debug/support handle — lets us inspect camera + style state on a live
    // device ("map is blank" reports) without shipping a special build.
    ;(window as unknown as { __htmap?: unknown }).__htmap = map.current

    // Both surfaces stack controls top-right like the main map (owner ask,
    // Aug 6 — bottom-left collided with the kiosk's left rail); the kiosk's
    // event rail shifts left to leave this column clear.
    const ctrlCorner = 'top-right' as const
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), ctrlCorner)

    // Weather radar toggle, right under the compass — replaced the two 90°
    // rotate buttons (owner ask, Aug 1; drag-to-rotate still works). Same
    // switch as the Layers panel row; the effect below paints its on-state.
    // Search moved from the rail into the TOP BAR as a real field (Brian,
    // Aug 22, decision 8c-a) — MapTopBar's TopBarSearch dispatches
    // ht:open-search; the box still opens as the top-center overlay.
    const radarControl: maplibregl.IControl = {
      onAdd() {
        const div = document.createElement('div')
        div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const b = document.createElement('button')
        b.type = 'button'
        b.title = 'Weather radar'
        b.setAttribute('aria-label', 'Toggle weather radar')
        b.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62a10 10 0 1 0 19.02-1.27"/><path d="M16.24 7.76a6 6 0 1 0-8.01 8.91"/><path d="M12 18h.01"/><path d="M17.99 11.66a6 6 0 0 1-2.22 4.58"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/></svg>'
        b.onclick = () => {
          // A horizontal swipe on this button drives the frame-time chip —
          // don't let the tail-end click also flip the radar layer.
          if (radarSwipedRef.current) { radarSwipedRef.current = false; return }
          setRadarOn((v) => !v)
        }
        radarBtnEl.current = b
        div.appendChild(b)
        return div
      },
      onRemove() { radarBtnEl.current = null },
    }
    map.current.addControl(radarControl, ctrlCorner)

    // Scale bar (Google Maps staple) — feet/miles, bottom-left, out of the
    // way of the timeline. Doubles as a sanity check on drone-overlay sizing.
    map.current.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'imperial' }), 'bottom-left')

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
        btn.classList.add('ht-fitall')
        btn.onclick = () => fitAll()
        div.appendChild(btn)
        return div
      },
      onRemove() {},
    }
    map.current.addControl(fitAllControl, ctrlCorner)

    // Locate + Zoom-to-all fold INTO the +/−/compass tray (Brian, Aug 10) —
    // one column box instead of three stacked singles. Pure DOM surgery
    // after the controls mount: move the buttons, drop the emptied shells.
    setTimeout(() => {
      const tr = mapContainer.current?.querySelector('.maplibregl-ctrl-top-right')
      if (!tr) return
      const groups = Array.from(tr.querySelectorAll('.maplibregl-ctrl-group'))
      const navGroup = groups.find((g) => g.querySelector('.maplibregl-ctrl-zoom-in'))
      if (!navGroup) return
      for (const sel of ['.maplibregl-ctrl-geolocate', '.ht-fitall']) {
        const btn = tr.querySelector(sel)
        const owner = btn?.closest('.maplibregl-ctrl-group')
        if (btn && owner && owner !== navGroup) {
          navGroup.appendChild(btn)
          if (!owner.querySelector('button')) owner.remove()
        }
      }
    }, 0)

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

    // New zone — drawing is a MAP ACTION, so it lives with measure/PDF in
    // the control rail, not in the Layers panel (owner ask, Aug 6). Handler
    // rides a ref because range/drawing callbacks are defined later.
    if (!kiosk && onGeofenceSave) {
      const drawControl: maplibregl.IControl = {
        onAdd() {
          const div = document.createElement('div')
          div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.title = 'New zone — draw a job site, yard or boundary'
          btn.setAttribute('aria-label', 'New zone')
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><path d="M21 16.05V7.95a2 2 0 0 0-1-1.73l-7-4.05a2 2 0 0 0-2 0l-7 4.05a2 2 0 0 0-1 1.73v8.1a2 2 0 0 0 1 1.73l7 4.05a2 2 0 0 0 2 0l7-4.05a2 2 0 0 0 1-1.73z"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>'
          btn.onclick = () => { drawZoneRef.current?.() }
          div.appendChild(btn)
          return div
        },
        onRemove() {},
      }
      map.current.addControl(drawControl, ctrlCorner)
    }

    // Create PDF — a branded snapshot of exactly what's on screen (logo +
    // company header, the map image, an asset legend). Same cluster.
    const pdfControl: maplibregl.IControl = {
      onAdd() {
        const div = document.createElement('div')
        div.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.title = 'Create PDF — branded snapshot of this view'
        btn.setAttribute('aria-label', 'Create PDF')
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#9fb6cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:auto"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>'
        btn.onclick = () => { makePdfRef.current?.() }
        div.appendChild(btn)
        return div
      },
      onRemove() {},
    }
    map.current.addControl(pdfControl, ctrlCorner)

    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    // The compact attribution is a <details> that AUTO-OPENS on load and
    // whenever attributions change — billboarding "Esri, Maxar…" across the
    // map (Brian, twice tonight; the CSS-only fix lost to MapLibre's own
    // stylesheet order). Fold it unless the USER opened it — their tap holds
    // it 8s, then it tucks back to the (i). Credits stay one tap away, which
    // is what the tile licenses require.
    const attribEl = map.current.getContainer().querySelector('details.maplibregl-ctrl-attrib') as HTMLDetailsElement | null
    let attribUserTap = 0
    attribEl?.addEventListener('pointerdown', () => { attribUserTap = Date.now() })
    const attribTimer = window.setInterval(() => {
      if (attribEl?.open && Date.now() - attribUserTap > 8_000) attribEl.open = false
    }, 1_000)

    // ALL app layers/handlers below used to hang off map 'load' — which waits
    // for the FIRST TILES to settle. One hung tile request (weak job-site
    // signal) and the map sat permanently blank: no zones, no markers, no
    // opening fit — the recurring "map is broken until refresh" reports
    // (reproduced ~50% of headless opens, Jul 23). The style itself is inline
    // and ready almost immediately, so a watchdog runs the same setup as soon
    // as the style is ready if 'load' is late. Guarded to run exactly once.
    let setupRan = false
    const initialSetup = () => {
      if (setupRan || !map.current) return
      setupRan = true
      const m = map.current!

      // Zoomed way out, Earth is a globe — MapLibre v5 renders it as one and
      // seamlessly flattens back to the normal map by street zooms.
      m.setProjection({ type: 'globe' })

      // ── Free basemap layers stacked over the CARTO dark base ──
      // All base rasters run raster-fade-duration 0 (task #13): the default
      // 300ms cross-fade reads parent-tile textures that may not exist on a
      // layer's very first frame and crashes with "reading 'bind'".
      // Streets (labeled, no imagery) — CARTO Voyager
      m.addSource('streets-base', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        maxzoom: 20,
        attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'streets-base', type: 'raster', source: 'streets-base', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } })

      // Satellite (aerial) imagery — Esri World Imagery. maxzoom caps tile
      // requests at 19 (Esri's global max) and over-scales beyond, so deep zoom
      // no longer throws "zoom level not supported".
      m.addSource('sat-base', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar' })
      m.addLayer({ id: 'sat-base', type: 'raster', source: 'sat-base', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } })

      // ── Extra basemap flavors (FR24-style picker, Jul 18) ──
      // Terrain — Esri World Topo (relief + contours, free, no key).
      m.addSource('terrain-base', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, maxzoom: 19, attribution: 'Esri',
      })
      m.addLayer({ id: 'terrain-base', type: 'raster', source: 'terrain-base', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } })
      // Silver — CARTO Positron (light, labeled). Plain — Positron without
      // labels. B/W reuses the Positron source with a grayscale+contrast paint.
      m.addSource('silver-base', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png'],
        tileSize: 256, maxzoom: 20, attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'silver-base', type: 'raster', source: 'silver-base', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } })
      m.addSource('plain-base', {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png'],
        tileSize: 256, maxzoom: 20, attribution: '© OpenStreetMap contributors © CARTO',
      })
      m.addLayer({ id: 'plain-base', type: 'raster', source: 'plain-base', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } })
      m.addLayer({
        id: 'bw-base', type: 'raster', source: 'silver-base', layout: { visibility: 'none' },
        paint: { 'raster-saturation': -1, 'raster-contrast': 0.3, 'raster-fade-duration': 0 },
      })
      // Aubergine — Voyager hue-rotated into a deep purple night map (paint
      // transform, no extra tile source).
      m.addLayer({
        id: 'aubergine-base', type: 'raster', source: 'streets-base', layout: { visibility: 'none' },
        paint: { 'raster-hue-rotate': 230, 'raster-saturation': -0.4, 'raster-brightness-max': 0.55, 'raster-brightness-min': 0.06, 'raster-fade-duration': 0 },
      })
      // Night — NASA Black Marble (VIIRS composite via GIBS, keyless).
      // Promoted from the old 'nightlights' overlay (Brian, Aug 11). Tiles
      // top out at z8; MapLibre over-scales beyond (soft glow, still reads).
      m.addSource('night-base', {
        type: 'raster',
        tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'],
        tileSize: 256, maxzoom: 8, attribution: 'NASA Earth Observatory',
      })
      // brightness-min lift: a night photo of Earth is BLACK land on BLACK
      // ocean — at globe zoom that's an invisible planet against space, only
      // city-light patches floating ("not showing the globe", Aug 12). The
      // floor keeps the sphere reading as a dim disc everywhere.
      m.addLayer({ id: 'night-base', type: 'raster', source: 'night-base', layout: { visibility: 'none' }, paint: { 'raster-brightness-min': 0.09, 'raster-fade-duration': 0 } })

      // ── Aviation charts (FAA's own public tile services — public-domain
      // data, no key). EXPERIMENTAL (Brian, Aug 10): likely ports to a
      // separate app later. Charts top out around z11 (sectional scale);
      // MapLibre over-scales beyond instead of 404ing.
      m.addSource('vfr-base', {
        type: 'raster',
        tiles: ['https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, maxzoom: 11, attribution: 'FAA',
      })
      m.addLayer({ id: 'vfr-base', type: 'raster', source: 'vfr-base', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } })
      m.addSource('ifr-base', {
        type: 'raster',
        tiles: ['https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, maxzoom: 11, attribution: 'FAA',
      })
      m.addLayer({ id: 'ifr-base', type: 'raster', source: 'ifr-base', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 } })

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
        // z12: as far out as the toggle can help — the OpenMapTiles schema
        // only carries buildings from ~z13, so this is a free win where the
        // tiles have data and a harmless no-op where they don't (owner ask,
        // Aug 21: "leave 3d buildings on a little further zoomed out").
        minzoom: 12,
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
          // z8 mesh, over-scaled beyond — 16× fewer terrain tiles/meshes
          // than z10, 256× fewer than z12. Hills become smooth rolling
          // shapes but the FRAME RATE is the feature ("detail needs to be
          // cut 10x or more" — owner, Aug 21; z10 was still unusably slow
          // on phones). Trade-off: the measure tool's elevation readout
          // coarsens to ridge-level accuracy while terrain is on.
          maxzoom: 8,
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
          'fill-opacity': ['case', ['==', ['get', 'kind'], 'yard'], 0.06, ['==', ['get', 'kind'], 'vendor'], 0.05, 0.14],
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
      m.addSource('trails', { type: 'geojson', data: trailsGeoJSON(tracksRef.current, filterRef.current, 0, null, speedTrailsRef.current ? windowSecRef.current : null) })
      m.addLayer({
        id: 'trails-line', type: 'line', source: 'trails',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        // Kiosk shows every asset's full history at once — fade the lines so the
        // wall display reads as ambiance, not spaghetti. A selected asset's
        // track brightens + widens; everyone else dims out of the way.
        // Every trail also fades by AGE (× the feature's band fade): older
        // stretches dim toward the tail, the newest runs full-strength.
        paint: kiosk
          ? {
              'line-color': ['get', 'color'],
              'line-width': ['case', ['==', ['get', 'sel'], 1], 3.5, 1.6],
              'line-opacity': ['*', ['case', ['==', ['get', 'sel'], 1], 0.9, ['==', ['get', 'dim'], 1], 0.15, 0.3], ['coalesce', ['get', 'fade'], 1]],
              'line-blur': 0.4,
            }
          : {
              'line-color': ['get', 'color'],
              'line-width': ['case', ['==', ['get', 'sel'], 1], 5.5, ['==', ['get', 'dim'], 1], 2, 3],
              'line-opacity': ['*', ['case', ['==', ['get', 'sel'], 1], 1, ['==', ['get', 'dim'], 1], 0.3, 0.85], ['coalesce', ['get', 'fade'], 1]],
              'line-blur': 0.3,
            },
      })
      // Heatmap of movement density (alternative to trails)
      m.addSource('trail-points', { type: 'geojson', data: pointsGeoJSON(tracksRef.current, filterRef.current, 0) })
      m.addLayer({
        id: 'trails-heat', type: 'heatmap', source: 'trail-points',
        layout: { visibility: 'none' },
        paint: {
          // Weight = time-on-the-spot (see pointsGeoJSON); the selected
          // asset's footprint runs 1.5× hotter while everyone ELSE fades to
          // a ghost (same selection language as the trails' dim).
          'heatmap-weight': ['case',
            ['==', ['get', 'sel'], 1], ['*', 1.5, ['get', 'w']],
            ['==', ['get', 'dim'], 1], ['*', 0.08, ['get', 'w']],
            ['get', 'w']],
          // Zoom-adaptive: gentle at county zooms (aggregation does the
          // talking), sharper as you close in on a site.
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 1.4, 16, 3],
          // Radius grows with the point's dwell weight (Brian, Aug 24):
          // drive-by pings get a small kernel — a thin, barely-there trace
          // along the road — while long stops bloom into wide hot blobs.
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'],
            8, ['+', 5, ['*', 8, ['get', 'w']]],
            11, ['+', 8, ['*', 14, ['get', 'w']]],
            16, ['+', 14, ['*', 30, ['get', 'w']]],
          ],
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
      // ONE source: selection tags each stack dim 0/1 inside hexHeatGeoJSON
      // (one lattice, one height reference — a two-source split rescaled
      // whichever half held the tallest cell) and these two layers divide
      // on it, ghost pass under the full-strength pass (same selection
      // language as trails/heatmap).
      m.addSource('heat3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'heat3d-dim-layer', type: 'fill-extrusion', source: 'heat3d',
        filter: ['==', ['get', 'dim'], 1],
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
          'fill-extrusion-opacity': 0.16,
        },
      })
      m.addLayer({
        id: 'heat3d-layer', type: 'fill-extrusion', source: 'heat3d',
        filter: ['!=', ['get', 'dim'], 1],
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
      m.addSource('trail-heads', { type: 'geojson', data: headsGeoJSON(tracksRef.current, filterRef.current, 0, null, toolCountsRef.current, iconByIdRef.current) })
      m.addLayer({
        id: 'trail-heads', type: 'circle', source: 'trail-heads',
        layout: { visibility: 'none' },
        // Same puck as the LIVE dots (Brian, Aug 24: "why do we have
        // different conventions on the assets in views vs the regular map
        // screen?") — replay heads used to be smaller plain circles, so any
        // view/mode with trails on silently switched the asset language.
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 12, 10],
          'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 3, 2.5],
          'circle-stroke-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', '#04121d'],
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
      m.addSource('assets', {
        type: 'geojson', data: buildGeoJSON(assets, filterRef.current, toolCountsRef.current, alertIdsRef.current, selectedIdRef.current),
        cluster: true, clusterMaxZoom: 15, clusterRadius: 40,
        // Roll the alert flag up into clusters so a theft alert can't hide
        // inside an amber blob at low zoom (ship-check, Aug 22).
        clusterProperties: { alerts: ['+', ['get', 'alert']] },
      })
      m.addLayer({
        id: 'clusters', type: 'circle', source: 'assets', filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#001523',
          'circle-radius': ['step', ['get', 'point_count'], 20, 5, 26, 20, 32],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['>', ['coalesce', ['get', 'alerts'], 0], 0], '#fb5d5d', '#ff9e16'],
        },
      })
      m.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'assets', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 13, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': ['case', ['>', ['coalesce', ['get', 'alerts'], 0], 0], '#fb5d5d', '#ff9e16'] },
      })
      // Expanding pulse ring — MOVING assets, plus a RED pulse on anything
      // wearing a live alert (marker grammar: alert outranks everything).
      m.addLayer({
        id: 'asset-pulse', type: 'circle', source: 'assets',
        filter: ['all', ['!', ['has', 'point_count']], ['any', ['==', ['get', 'state'], 'moving'], ['==', ['get', 'alert'], 1]]],
        paint: { 'circle-color': ['case', ['==', ['get', 'alert'], 1], '#fb5d5d', ['get', 'color']], 'circle-opacity': 0.4, 'circle-radius': 16, 'circle-stroke-width': 0 },
      })
      // soft glow under each pin so assets pop off the satellite imagery —
      // brightness reads the state: moving bright, idle steady, off nearly out
      m.addLayer({
        id: 'asset-glow', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-opacity': ['match', ['get', 'state'], 'moving', 0.38, 'idle', 0.22, 'dead', 0.04, 0.14],
          // Scale with zoom — a fixed 24px halo turned into a county-sized
          // blob at state zoom, which is what it looked like in the Jul 30
          // screenshots. Small marker glow far out, full halo up close.
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 9, 10, 14, 14, 24],
          'circle-blur': 0.7,
        },
      })
      // ── THE STATE RING (marker grammar, Brian-approved sketch, Aug 22) ──
      // Exactly one ring, always the same radius; its style is the ONLY
      // place run-state lives: amber = moving · teal = awake/working ·
      // quiet grey = asleep · red thickening with idle days = parked and
      // burning money (absorbs the old idle-$ ring) · bright red = live
      // alert. Dark puck border stays for contrast; this ring sits outside.
      m.addLayer({
        id: 'state-ring', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 14,
          'circle-color': 'rgba(0,0,0,0)',
          // Precedence: live ALERT first (a ripped-out tracker is exactly
          // alert + dead — the red must survive), then 'dead' gray (which
          // outranks the idle-$ red: a dark device's idleDays are stale
          // math, and a loud ring on gray hardware reads as a live signal
          // that isn't there), then the normal state grammar.
          'circle-stroke-color': ['case',
            ['==', ['get', 'alert'], 1], '#fb5d5d',
            ['==', ['get', 'state'], 'dead'], DEAD_GRAY,
            ['all', ['>=', ['get', 'idleDays'], 2], ['>', ['get', 'dailyCost'], 0], ['!=', ['get', 'state'], 'moving']], '#ef4444',
            ['match', ['get', 'state'], 'moving', '#ff9e16', 'idle', '#2dd4bf', '#6f88a0']],
          'circle-stroke-width': ['case',
            ['==', ['get', 'alert'], 1], 3.5,
            ['==', ['get', 'state'], 'dead'], 1.5,
            ['all', ['>=', ['get', 'idleDays'], 2], ['>', ['get', 'dailyCost'], 0], ['!=', ['get', 'state'], 'moving']],
              ['interpolate', ['linear'], ['get', 'idleDays'], 2, 3, 14, 6.5],
            ['match', ['get', 'state'], 'off', 1.5, 2.5]],
          'circle-stroke-opacity': ['case',
            ['==', ['get', 'alert'], 1], 0.95,
            ['==', ['get', 'state'], 'dead'], 0.35,
            ['all', ['>=', ['get', 'idleDays'], 2], ['>', ['get', 'dailyCost'], 0], ['!=', ['get', 'state'], 'moving']], 0.85,
            ['match', ['get', 'state'], 'off', 0.5, 0.85]],
        },
      })
      m.addLayer({
        id: 'unclustered-circle', type: 'circle', source: 'assets', filter: ['!', ['has', 'point_count']],
        paint: {
          // Dead hardware loses its color — gray puck says "this DEVICE is
          // dark", which color would otherwise hide.
          'circle-color': ['case', ['==', ['get', 'state'], 'dead'], DEAD_GRAY, ['get', 'color']],
          // Slimmed to read like the replay trail-head dots — the emoji badge
          // is gone from the default look ("drop the icon on the live map in
          // favor of the colored dot", owner, Jul 31). Selected = same white
          // ring + size-up as the replay heads (one selection language).
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 12, 10],
          'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 3, 2.5],
          'circle-stroke-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', '#04121d'],
          // Parked is the NORMAL overnight state — read as calm, never absent.
          // (0.45 made trucks near-invisible on satellite at night.)
          'circle-opacity': ['match', ['get', 'state'], 'off', 0.85, 'dead', 0.55, 1],
        },
      })
      // ── Type silhouettes INSIDE the dots (Brian, Aug 22: "change these dots
      // into things that actually represent what they are — easy to see but
      // small"). The dot's whole language survives — color = machine,
      // brightness = state, pulse = moving — and a small dark glyph (truck /
      // excavator / person / wrench) sits in it, dark-on-color like every
      // amber button in the app. SDF masks so one image serves any dot color.
      const addGlyph = (name: string, draw: (ctx: CanvasRenderingContext2D) => void) => {
        if (m.hasImage(name)) return
        const c = document.createElement('canvas')
        c.width = 64; c.height = 64
        const ctx = c.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = '#fff'
        draw(ctx)
        m.addImage(name, ctx.getImageData(0, 0, 64, 64), { sdf: true })
      }
      // The whole silhouette library registers up front (lib/asset-icons.ts
      // — the four originals plus the trade set: dump truck, day cab, dozer,
      // mower…). ~28 tiny canvases, drawn once per map load; per-asset
      // choice arrives on the feature as `icon` (metadata.icon, validated).
      for (const [key, def] of Object.entries(ASSET_ICONS)) addGlyph('glyph-' + key, def.draw)
      m.addLayer({
        id: 'asset-type-glyph', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['concat', 'glyph-', ['get', 'icon']],
          // Images register at 64px base (same as nav-arrow) — 0.19 ≈ 12px,
          // inside the 20px dot: identity without growing the marker.
          'icon-size': 0.19,
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': '#04121d',
          'icon-opacity': ['match', ['get', 'state'], 'off', 0.85, 'dead', 0.45, 1],
        },
      })
      // Same silhouettes on the REPLAY heads — one asset language everywhere
      // (registered here, after the SDF images exist; slotted into z-order
      // right above the head puck).
      m.addLayer({
        id: 'trail-head-glyphs', type: 'symbol', source: 'trail-heads',
        layout: {
          'icon-image': ['concat', 'glyph-', ['get', 'icon']],
          'icon-size': 0.19,
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
          visibility: 'none',
        },
        paint: { 'icon-color': '#04121d' },
      }, 'trail-head-labels')
      // Direction arrows — the alternate marker style: a ground-aligned puck
      // in the asset's color, nose pointing the travel heading. Drawn as an
      // SDF alpha mask so ONE image tints per-feature via icon-color.
      if (!m.hasImage('nav-arrow')) {
        const c = document.createElement('canvas')
        c.width = 64; c.height = 64
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.beginPath()
          ctx.moveTo(32, 4)
          ctx.lineTo(56, 54)
          ctx.quadraticCurveTo(32, 40, 8, 54)
          ctx.closePath()
          ctx.fillStyle = '#fff'
          ctx.fill()
          m.addImage('nav-arrow', ctx.getImageData(0, 0, 64, 64), { sdf: true })
        }
      }
      m.addLayer({
        id: 'asset-arrows', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': 'nav-arrow',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.32, 12, 0.46, 16, 0.6],
          'icon-rotate': ['coalesce', ['get', 'heading'], 0],
          // Map-aligned: the arrow lies ON the ground and foreshortens with
          // tilt — the "3D directional" read — while the emoji stays upright.
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
          visibility: 'none',
        },
        paint: {
          'icon-color': ['case', ['==', ['get', 'state'], 'dead'], DEAD_GRAY, ['get', 'color']],
          'icon-halo-color': '#04121d', 'icon-halo-width': 1.2,
          'icon-opacity': ['match', ['get', 'state'], 'off', 0.85, 'dead', 0.55, 1],
        },
      })
      m.addLayer({
        id: 'unclustered-label', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        minzoom: 6, // plain dots past state scale — emoji become smudges
        layout: {
          'text-field': ['match', ['get', 'type'], 'vehicle', '🚛', 'equipment', '🏗️', 'personnel', '👷', 'tool', '🔧', '📍'],
          'text-size': 14, 'text-allow-overlap': true,
          // Emoji rides only the ARROW style (type identity on the puck); the
          // default dot stays clean.
          visibility: 'none',
        },
      })
      // Name beside the dot (live mode) — same POI treatment as trail heads.
      m.addLayer({
        // Same ladder as the zone labels — asset names appear at metro zoom,
        // not while you're looking at half the state.
        id: 'unclustered-name', type: 'symbol', source: 'assets', filter: ['!', ['has', 'point_count']],
        minzoom: 10.5,
        layout: {
          'text-field': ['get', 'name'], 'text-size': 10.5,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-max-width': 30,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.5,
          'text-justify': 'auto',
          'text-optional': true,
        },
        paint: {
          'text-color': ['case', ['==', ['get', 'state'], 'dead'], '#8fa2b3', '#e8f0f7'],
          'text-opacity': ['match', ['get', 'state'], 'dead', 0.7, 1],
          'text-halo-color': '#001523', 'text-halo-width': 2, 'text-halo-blur': 0.5,
        },
      })
      // Tools — their OWN unclustered source so a Bluetooth tag is visible in
      // every trail mode (they have no GPS history → no trail head; the live
      // dots hide in Trails mode, which made tools vanish entirely, Jul 16).
      // A dropped tag sits dimmer at its true last-seen spot.
      m.addSource('tools-live', { type: 'geojson', data: toolsGeoJSON(assets, filterRef.current) })
      // Tools wear the SAME ring grammar as every other asset (Brian, Aug 28:
      // "carry the same look throughout") — teal = tag sighted recently,
      // quiet gray = left somewhere. Scaled to the smaller tool dot.
      m.addLayer({
        id: 'tool-state-ring', type: 'circle', source: 'tools-live',
        paint: {
          'circle-radius': 11.5,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ['match', ['get', 'state'], 'live', '#2dd4bf', '#6f88a0'],
          'circle-stroke-width': ['match', ['get', 'state'], 'live', 2.5, 1.5],
          'circle-stroke-opacity': ['match', ['get', 'state'], 'live', 0.85, 0.5],
        },
      })
      m.addLayer({
        id: 'tool-dots', type: 'circle', source: 'tools-live',
        paint: {
          'circle-color': ['get', 'color'],
          // One step SMALLER than asset dots (Brian, Aug 22): the floating 🔧
          // emoji made tools read bigger than the trucks carrying them.
          // Selected = the same white ring + size-up as every other marker.
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 10, 8],
          'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 2.5, 2],
          'circle-stroke-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', '#04121d'],
          'circle-opacity': ['match', ['get', 'state'], 'dropped', 0.75, 1],
        },
      })
      // Wrench silhouette INSIDE the dot — same glyph system as the asset
      // dots, replacing the oversized emoji layer.
      m.addLayer({
        id: 'tool-dots-glyph', type: 'symbol', source: 'tools-live',
        minzoom: 6,
        layout: {
          'icon-image': ['concat', 'glyph-', ['get', 'icon']],
          // 64px base image → ~9.5px wrench inside the 16px tool dot.
          'icon-size': 0.15,
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': '#04121d',
          'icon-opacity': ['match', ['get', 'state'], 'dropped', 0.75, 1],
        },
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
        // Zoom-scaled (Aug 22 badge pass): legible up close, quiet far out.
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 11, 16, 13.5],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        // PAYLOAD SLOT — bottom-right (marker grammar): what's riding along.
        // Today that's Bluetooth tool count; people-in-truck joins this same
        // count when personnel pairing lands (Brian, Aug 22 — never lose
        // this functionality).
        'text-offset': [1.15, 1.15],
        'icon-allow-overlap': true, 'text-allow-overlap': true,
        'icon-ignore-placement': true, 'text-ignore-placement': true,
      }
      m.addLayer({
        id: 'tool-count-badge', type: 'symbol', source: 'assets', filter: hasTools,
        // Zoom ladder (marker grammar): badges wait for town zoom — far out
        // it's clean pucks + rings only.
        minzoom: 10,
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
      // Label ladder (owner ask, Jul 30 — "names should drop off while zooming
      // out"): nothing at region/state scale, the short job code once you're
      // metro-level, the full job name once you're actually looking at sites.
      // A bare "25" floating over three counties is noise, not information.
      m.addLayer({
        id: 'geofence-labels', type: 'symbol', source: 'geofence-label-pts',
        minzoom: 10.5, maxzoom: 12.5,
        layout: { ...zoneLabelLayout, 'text-field': ['get', 'short'], 'text-size': 10 },
        paint: zoneLabelPaint,
      })
      m.addLayer({
        id: 'geofence-labels-full', type: 'symbol', source: 'geofence-label-pts',
        minzoom: 12.5,
        layout: { ...zoneLabelLayout, 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 11, 15, 13] },
        paint: zoneLabelPaint,
      })

      // Draw preview
      m.addSource(drawPreviewSource.current, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'draw-fill', type: 'fill', source: drawPreviewSource.current, paint: { 'fill-color': '#ff9e16', 'fill-opacity': 0.15 } })
      m.addLayer({ id: 'draw-line', type: 'line', source: drawPreviewSource.current, paint: { 'line-color': '#ff9e16', 'line-width': 2 } })

      // Address-search marker while drawing a zone (owner ask, Jul 30). Jumping
      // to an address used to move the camera and leave nothing behind, so you
      // lost the spot the moment you panned. Brand amber, teal ring — the same
      // language as the measure vertices and the zone draw preview.
      m.addSource('draw-search-pin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'draw-search-halo', type: 'circle', source: 'draw-search-pin',
        paint: { 'circle-color': '#ff9e16', 'circle-opacity': 0.22, 'circle-radius': 26, 'circle-blur': 0.65 },
      })
      m.addLayer({
        id: 'draw-search-dot', type: 'circle', source: 'draw-search-pin',
        paint: {
          'circle-color': '#ff9e16', 'circle-radius': 7,
          'circle-stroke-width': 2.5, 'circle-stroke-color': '#04121d',
        },
      })
      m.addLayer({
        id: 'draw-search-label', type: 'symbol', source: 'draw-search-pin',
        layout: {
          'text-field': ['get', 'label'], 'text-size': 11.5,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'bottom', 'text-offset': [0, -1.1],
          'text-max-width': 22, 'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffe0b0', 'text-halo-color': '#04121d', 'text-halo-width': 2 },
      })

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
      m.on('click', 'asset-arrows', selectAsset)
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
        // tool-dots + trail-heads INCLUDED: tools "left here" inside a zone
        // were unreachable — the zone sheet stole every tap (Brian, Aug 23).
        const pinLayers = ['unclustered-circle', 'asset-arrows', 'asset-glow', 'clusters', 'device-bg', 'tool-dots', 'trail-heads'].filter((l) => m.getLayer(l))
        if (m.queryRenderedFeatures(box, { layers: pinLayers }).length) return
        // Saved measurements sit ON TOP of zones — a tap on one opens the
        // measurement sheet, never the zone underneath (Brian, Aug 17: could
        // only ever reach the zone). Hidden layers don't hit-test, so this
        // costs nothing while the Measurements toggle is off.
        const mLayers = ['msaved-fill', 'msaved-hit', 'msaved-pts-hit'].filter((l) => m.getLayer(l))
        if (mLayers.length && m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: mLayers }).length) return
        const id = e.features?.[0]?.properties?.id
        const fence = geofencesRef.current.find((g) => g.id === id)
        if (!fence) return
        setSelectedAsset(null)
        setSelectedDevice(null)
        setSelectedZone(fence)
      }
      m.on('click', 'geofence-fill', selectZoneAt)
      m.on('click', 'geofence-hit-line', selectZoneAt)

      for (const layer of ['unclustered-circle', 'asset-arrows', 'clusters', 'trail-heads', 'device-bg', 'device-icon', 'geofence-fill', 'geofence-hit-line']) {
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
        const layers = ['unclustered-circle', 'asset-arrows', 'asset-glow', 'trail-heads', 'tool-dots'].filter((l) => m.getLayer(l))
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

      // Opening view — DEFAULT is the WHOLE FLEET: fit to the assets'
      // extents (Brian, Aug 24: "it should open to extents of assets" —
      // the old where-you-left-it default reopened on whatever corner of
      // the county you last looked at, and the Settings UI already claimed
      // Whole fleet was the default). "Last view" stays an explicit choice
      // in Settings → Map opens to.
      const camKey = kiosk ? 'ht_command_last_camera' : 'ht_map_last_camera'
      let openedFromSaved = false
      try {
        if (localStorage.getItem('ht_map_open_view') === 'last') {
          const saved = JSON.parse(localStorage.getItem(camKey) ?? 'null')
          if (saved && Array.isArray(saved.center)) {
            // Pitch restores as-left, unconditionally — tilt belongs to the
            // camera, not to the 3D toggles (Brian, Aug 10 revision).
            m.jumpTo({ center: saved.center, zoom: saved.zoom ?? DEMO_MAP_ZOOM, bearing: saved.bearing ?? 0, pitch: saved.pitch ?? 0 })
            openedFromSaved = true
            camRestoredRef.current = true // boot fit must not override this
          }
        }
      } catch { /* corrupt value — fall through to fit */ }
      if (!openedFromSaved) {
        // ASSETS define the opening frame. Zones and site devices only fill
        // in when no asset has a fix yet (fresh company) — one county-wide
        // boundary zone must never zoom the whole fleet out to a speck
        // (that's what made the open view read as "wrong location").
        let pts: [number, number][] = assets
          .filter((a) => a.location)
          .map((a) => [a.location!.lng, a.location!.lat] as [number, number])
        if (pts.length === 0) {
          pts = SITE_DEVICES.map((d) => [d.lng, d.lat] as [number, number])
          for (const g of geofences) {
            const ring = g.geometry?.coordinates?.[0] as [number, number][] | undefined
            if (ring) for (const c of ring) pts.push([c[0], c[1]])
          }
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
    }
    map.current.on('load', initialSetup)
    const loadWatchdog = window.setInterval(() => {
      if (setupRan) { window.clearInterval(loadWatchdog); return }
      if (map.current?.isStyleLoaded()) initialSetup()
    }, 1500)

    return () => {
      window.clearInterval(loadWatchdog)
      window.clearInterval(attribTimer)
      map.current?.remove()
      map.current = null
      // The map died but the component may live on (dev StrictMode remount):
      // every "layer already added" ref must reset with it, or the first
      // toggle after remount takes the else-branch against a map that has no
      // such layer (task #13 secondary finding).
      wxAdded.current = false
      wxTileErr.current = false
      cloudsAdded.current = false
      stormAdded.current = false
      precipAdded.current = false
      waybackAdded.current = false
    }
  }, [])

  // Update live asset source when assets, filter, or isolate change
  useEffect(() => {
    if (!mapReady) return
    const source = map.current?.getSource('assets') as maplibregl.GeoJSONSource | undefined
    const visible = isolateId ? assets.filter((a) => a.id === isolateId) : assets
    source?.setData(buildGeoJSON(visible, filter, toolCounts, alertAssetIds, selectedAsset?.id ?? null))
    const tools = map.current?.getSource('tools-live') as maplibregl.GeoJSONSource | undefined
    // Replaying with trails on: a tool that has a synthesized track gets a
    // moving trail head like any other asset — drop its static "now" dot so
    // the same tag isn't on the map twice. Tools with no episodes in the
    // window keep the dot (their only truthful position).
    const replayToolIds = range !== 'live' && trailMode !== 'off'
      ? new Set(tracksEff.filter((tr) => tr.type === 'tool' && tr.points.length > 0).map((tr) => tr.assetId))
      : null
    tools?.setData(toolsGeoJSON(replayToolIds ? visible.filter((a) => !replayToolIds.has(a.id)) : visible, filter, selectedAsset?.id ?? null))
  }, [mapReady, assets, filter, isolateId, toolCounts, alertAssetIds, range, trailMode, tracksEff, selectedAsset])

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
    const live = trailMode === 'off'
    LIVE_LAYERS.forEach((l) => set(l, live))
    // Marker style splits the live view: dots (clean, matches replay heads)
    // or direction arrows with the type emoji riding on top.
    set('unclustered-circle', live && markerStyle === 'dot')
    set('asset-type-glyph', live && markerStyle === 'dot') // silhouettes ride the dots only
    set('state-ring', live && markerStyle === 'dot') // ring is sized to the dot — clips ugly behind arrows
    set('asset-arrows', live && markerStyle === 'arrow')
    set('unclustered-label', live && markerStyle === 'arrow')
    set('trails-line', trailMode === 'trails')
    set('trails-heat', trailMode === 'heatmap')
    set('heat3d-layer', trailMode === '3d')
    set('heat3d-dim-layer', trailMode === '3d')
    HEAD_LAYERS.forEach((l) => set(l, trailMode !== 'off'))
    // Labels master switch (Brian, Aug 11) overrides the per-mode defaults
    // set above — OFF hides every name at every zoom, ON keeps the ladder.
    set('unclustered-name', live && showLabels)
    set('trail-head-labels', trailMode !== 'off' && showLabels)
    set('tool-dots-name', showLabels)
    // The terrain reads flat from straight overhead — tilt in on entry.
    if (trailMode === '3d' && m.getPitch() < 25 && !followIdRef.current) {
      m.easeTo({ pitch: 55, duration: 800 })
    }
  }, [mapReady, trailMode, markerStyle, showLabels])

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
    let trs = iso ? tracksRef.current.filter((tr) => tr.assetId === iso) : tracksRef.current
    // LIVE + trails: tools keep their single tools-live dot (current truth,
    // "left here" labels) — a trail head on top painted the same tag twice
    // (Tool A aboard the Ram AND left near Hawkins Rd, Jul 17). Replay ranges
    // are the opposite: the head IS the tool marker and the dot hides.
    if (rangeRef.current === 'live') trs = trs.filter((tr) => tr.type !== 'tool')
    // Spotlight only when the selection has a footprint HERE: a tool in live
    // mode (stripped above) or a dark tracker with no fixes in the window
    // would otherwise ghost 100% of the data with nothing lit — at heat's
    // ×0.08 weight that reads as "the map broke" (ship-check). 3D needs a
    // segment (two fixes) to raise a cell; trails/heat light from one.
    const sel0 = selectedIdRef.current
    const minPts = mode === '3d' ? 2 : 1
    const sel = sel0 && trs.some((tr) => tr.assetId === sel0 && filterRef.current.has(tr.type) && tr.points.length >= minPts) ? sel0 : null
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
          // Open episodes end at the last SIGHTING, not a drop-off — BLE
          // reports sparsely, so grant the same freshness grace as live
          // resolution or badges vanish at the window's right edge (review).
          const end = ep.endMs == null ? null : ep.open ? ep.endMs + TOOL_FRESH_MS : ep.endMs
          if (ep.startMs <= ts && (end == null || end >= ts)) {
            counts[ep.carrier] = (counts[ep.carrier] ?? 0) + 1
          }
        }
      }
    }
    ;(m.getSource('trail-heads') as maplibregl.GeoJSONSource | undefined)?.setData(headsGeoJSON(trs, filterRef.current, t, sel, counts, iconByIdRef.current))
    if (mode === 'trails') {
      ;(m.getSource('trails') as maplibregl.GeoJSONSource | undefined)?.setData(trailsGeoJSON(trs, filterRef.current, t, sel, speedTrailsRef.current ? windowSecRef.current : null))
    } else if (mode === '3d') {
      // ONE build for both halves of the terrain — the selected asset's
      // share of each cell tagged dim:0, everyone else's dim:1 — so bright
      // and ghost share one hex lattice and one height reference. (Two
      // subset calls let whichever half held the tallest cell rescale
      // itself once past the absolute reference — ship-check.)
      ;(m.getSource('heat3d') as maplibregl.GeoJSONSource | undefined)?.setData(hexHeatGeoJSON(trs, filterRef.current, t, windowSecRef.current, 110, heat3dUnitsRef.current, heat3dRatesRef.current, sel))
    } else {
      ;(m.getSource('trail-points') as maplibregl.GeoJSONSource | undefined)?.setData(pointsGeoJSON(trs, filterRef.current, t, sel, windowSecRef.current))
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
  const focusFollow = useCallback((t: number, immediate = false) => {
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

    // Low-pass the camera center (Brian, Aug 22: "very jerky — it follows
    // exactly the points"): the camera chases the target a fraction per
    // frame, which rounds every GPS corner and absorbs fix noise. Paused
    // seeks pass immediate=true (a single scrub step must land, not lag);
    // a teleporting target (scrub drag) snaps instead of slow-panning.
    const cam = camRef.current
    if (immediate || !cam || Math.hypot(here[0] - cam[0], here[1] - cam[1]) > CAM_SNAP_DEG) {
      camRef.current = here
    } else {
      camRef.current = [cam[0] + (here[0] - cam[0]) * CAM_SMOOTH, cam[1] + (here[1] - cam[1]) * CAM_SMOOTH]
    }
    const center = camRef.current

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
      const targetZoom = mode === 'overhead' ? OVERHEAD_ZOOM : FOLLOW_ZOOM
      m.jumpTo({ center, bearing: bearingRef.current, pitch: pitchRef.current, zoom: z + (targetZoom - z) * 0.07 })
    } else {
      // Entrance done — leave zoom alone so the user can pinch in/out mid-flight.
      m.jumpTo({ center, bearing: bearingRef.current, pitch: pitchRef.current })
    }
  }, [])

  // Switching camera mode mid-follow does NOT re-run the entrance: pitch and
  // bearing already glide via their per-frame eases, and re-arming would
  // stomp the zoom the user pinched to (Brian, Aug 22: after the wider
  // defaults, zoom belongs to the user — set once at follow start, then
  // hands off).

  // Push trail/heat/head geometry on discrete changes (seek, filter, mode,
  // isolate, selection spotlight)
  selectedIdRef.current = selectedAsset?.id ?? null
  useEffect(() => {
    if (!mapReady) return
    updateMovementSources(displayT)
  }, [mapReady, trailMode, displayT, filter, tracksEff, isolateId, selectedAsset, speedTrails, heat3dUnits, updateMovementSources])

  // When paused (scrubbing), keep the camera pinned to the followed asset. During
  // playback the RAF loop drives it every frame, so skip to avoid double work.
  useEffect(() => {
    if (!mapReady || !followId || pbPlaying || range === 'live') return
    // immediate: a single paused seek must LAND on the asset, not ease 16%
    // toward it and stop.
    focusFollow(displayT, true)
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

  // Default-location SAVING moved to the top bar's weather dropdown (Aug 5) —
  // TopBarWeather persists device localStorage + the company row itself.

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

  // The weather location editor lives in the TOP BAR now (tap the temp —
  // owner ask, Aug 5). Picks arrive as a window event; the map follows.
  useEffect(() => {
    const onPlace = (e: Event) => {
      const d = (e as CustomEvent<{ name: string; lat: number; lng: number }>).detail
      if (d?.name && Number.isFinite(d.lat) && Number.isFinite(d.lng)) handlePlaceChange(d.name, d.lat, d.lng)
    }
    window.addEventListener('ht:weather-place', onPlace)
    return () => window.removeEventListener('ht:weather-place', onPlace)
  }, [handlePlaceChange])

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
    set('bw-base', base === 'bw')
    set('aubergine-base', base === 'aubergine')
    set('night-base', base === 'night')
    // Charts ride over a light base: the FAA cache only has tiles at
    // chart-scale zooms, so wide views went void outside the visited area
    // ("only loads the area I am zoomed to", Aug 10). The underlay keeps the
    // whole world a map; the chart paints wherever FAA publishes tiles.
    set('plain-base', base === 'plain' || base === 'vfr' || base === 'ifr')
    set('vfr-base', base === 'vfr')
    set('ifr-base', base === 'ifr')
    // Night photo gets the dark-halo label tiles too — city names over glow.
    set('labels-overlay', base === 'hybrid' || base === 'aubergine' || base === 'night')
  }, [mapReady, base])

  // 3D buildings & tilt — buildings + camera tilt only, layerable on any
  // basemap. While following, the follow camera owns the pitch, so don't
  // fight it. TERRAIN is deliberately NOT here anymore: piggybacking the DEM
  // onto this toggle (Jul 17) is what made "3D buildings" suddenly heavy —
  // "it used to work fine" (owner, Jul 21). Terrain has its own toggle below.
  // The courtesy tilt (55°) fires ONLY when the user presses the toggle —
  // never on load from remembered state. Pitch itself is free-floating and
  // comes back exactly as it was left ("bring back the tilt if it was left
  // that way… not tied to 3D except when that button is first pressed",
  // Aug 10). The first effect run after map load just records the baseline.
  const prevThreeD = useRef<boolean | null>(null)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m?.getLayer('buildings-3d')) return
    m.setLayoutProperty('buildings-3d', 'visibility', threeD ? 'visible' : 'none')
    const changed = prevThreeD.current !== null && prevThreeD.current !== threeD
    prevThreeD.current = threeD
    if (changed && !followIdRef.current) m.easeTo({ pitch: threeD || terrain3d ? 55 : 0, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, threeD])

  // 3D terrain (the "3D map") — real DEM elevation relief; mountains rise and
  // the measure tool gets its elevation readout. The expensive one, opt-in.
  // Two levers make it survivable on big screens ("will not even load on PC,
  // makes everything shut down" — owner, Jul 31):
  //  1. Render at 1× while the DEM is up. A 4K monitor at DPR 1.5–2 was
  //     pushing a 4–8× larger framebuffer through the terrain pass; dropping
  //     to CSS pixels is the difference between loads and dies.
  //  2. Cap pitch at 60° while terrain is on. The map normally allows 85° for
  //     the sky/satellite layers, but a near-horizon frustum over a DEM pulls
  //     a monster tile pyramid along the horizon.
  const prevTerrain3d = useRef<boolean | null>(null)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    // Wrapped defensively — a DEM tile hiccup must never blank the map.
    try {
      if (terrain3d && m.getSource('dem')) {
        m.setTerrain({ source: 'dem', exaggeration: terrainExagRef.current })
        m.setPixelRatio(1)
        m.setMaxPitch(60)
        if (m.getPitch() > 60) m.setPitch(60)
      } else {
        m.setTerrain(null)
        m.setMaxPitch(85)
        m.setPixelRatio(window.devicePixelRatio || 1)
      }
    } catch { /* terrain unsupported / source not ready — ignore */ }
    // Same press-only rule as 3D buildings: no pitch snap on load.
    const changed = prevTerrain3d.current !== null && prevTerrain3d.current !== terrain3d
    prevTerrain3d.current = terrain3d
    if (changed && !followIdRef.current) m.easeTo({ pitch: terrain3d || threeD ? 55 : 0, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, terrain3d])

  // Exaggeration slider (in the terrain legend) — live update, no re-toggle.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m || !terrain3d) return
    try {
      if (m.getSource('dem')) m.setTerrain({ source: 'dem', exaggeration: terrainExag })
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainExag])

  // Toggle visibility of all geofence layers at once — the name layers also
  // answer to the Labels master switch.
  useEffect(() => {
    const m = map.current
    if (!mapReady) return
    for (const id of ['geofence-fill', 'geofence-hit-line', 'geofence-outline']) {
      if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', showZones ? 'visible' : 'none')
    }
    for (const id of ['geofence-labels', 'geofence-labels-full']) {
      if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', showZones && showLabels ? 'visible' : 'none')
    }
  }, [mapReady, showZones, showLabels])

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
        // Born hidden + fade 0 (task #13): a layer added already-visible joins
        // the very next render pass before any tile has a GPU texture, and the
        // default cross-fade walks parent textures that aren't there yet. The
        // line below is the single place that turns it on.
        m.addLayer(
          { id: layerId, type: 'raster', source: srcId, minzoom: o.minzoom, layout: { visibility: 'none' }, paint: { 'raster-opacity': overlayOpacity[o.key] ?? o.opacity, 'raster-fade-duration': 0 } },
          beforeId
        )
      }
      if (m.getLayer(layerId)) m.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, overlaysOn, rtmaNames])

  // ── Placed site imagery (052/053/055): drone shots + plan sheets pinned to
  // ground corners. Photos follow the TIMELINE: at any scrub position each
  // zone shows its newest shot taken on/before that day (Live = newest,
  // period) — a daily flier gets site playback for free. Plans are timeless
  // and ride their own 'siteplans' toggle. The active-frame set is a memoed
  // string key so the layer effect only fires when the scrubber actually
  // crosses a capture date, not on every playback tick.
  const siteImgActiveKey = useMemo(() => {
    const photos = (siteOverlays ?? []).filter((o) => o.kind !== 'plan')
    if (!photos.length) return ''
    const cutoff = range !== 'live' && realWindowEff
      ? realWindowEff.from + pbT * (realWindowEff.to - realWindowEff.from)
      : Infinity
    const byZone = new Map<string, { id: string; takenOn: string }>()
    for (const o of photos) {
      // A shot represents the site from the start of its capture day onward.
      const shotMs = new Date(o.takenOn + 'T00:00:00').getTime()
      if (!Number.isFinite(shotMs) || shotMs > cutoff) continue
      const cur = byZone.get(o.zoneId)
      if (!cur || o.takenOn >= cur.takenOn) byZone.set(o.zoneId, { id: o.id, takenOn: o.takenOn })
    }
    return Array.from(byZone.values()).map((v) => v.id).sort().join(',')
  }, [siteOverlays, range, realWindowEff, pbT])

  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const photoOn = !!overlaysOn.siteimg
    const planOn = !!overlaysOn.siteplans
    const active = new Set(siteImgActiveKey ? siteImgActiveKey.split(',') : [])
    const known = new Set<string>()
    for (const ov of siteOverlays ?? []) {
      const isPlan = ov.kind === 'plan'
      const show = isPlan ? planOn : photoOn && active.has(ov.id)
      const srcId = `simg-${ov.id}`
      const lid = `${srcId}-layer`
      known.add(lid)
      if (show && !m.getSource(srcId)) {
        try {
          m.addSource(srcId, { type: 'image', url: ov.url, coordinates: ov.coords })
          const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
          m.addLayer(
            {
              id: lid, type: 'raster', source: srcId,
              paint: {
                'raster-opacity': (isPlan ? overlayOpacity.siteplans ?? 0.85 : overlayOpacity.siteimg ?? 0.92),
                'raster-fade-duration': 0,
              },
            },
            beforeId
          )
        } catch { /* bad corners or unreachable image — skip this one */ }
      } else if (m.getSource(srcId)) {
        // Same shot re-placed: nudge the corners in place.
        const src = m.getSource(srcId) as maplibregl.ImageSource
        try { src.setCoordinates(ov.coords) } catch { /* ignore */ }
      }
      // Inactive frames stay mounted but hidden — scrubbing swaps instantly.
      if (m.getLayer(lid)) m.setLayoutProperty(lid, 'visibility', show ? 'visible' : 'none')
    }
    // A re-place (new corners / newer photo) or delete changes the row set —
    // drop layers for rows the server no longer returns.
    for (const lyr of m.getStyle()?.layers ?? []) {
      if (lyr.id.startsWith('simg-') && lyr.id.endsWith('-layer') && !known.has(lyr.id)) {
        m.removeLayer(lyr.id)
        const sid = lyr.id.slice(0, -6)
        if (m.getSource(sid)) m.removeSource(sid)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, overlaysOn, siteOverlays, siteImgActiveKey])

  // Raster tiles that fail to load (moved WMS layer, dead service, blocked
  // request) used to die in silence — the row looked on, the map drew
  // nothing. Surface each failing overlay ONCE per session on its panel row.
  const tileErrReported = useRef<Set<string>>(new Set())
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const onErr = (e: unknown) => {
      const sid = (e as { sourceId?: string }).sourceId
      // Radar tile failures: flag the source so the next frame swap rebuilds
      // it instead of setTiles-ing errored tiles into a crash (wxTileErr).
      // This listener existing at all is also what keeps maplibre from
      // console.error-ing every failed tile — keep it registered.
      if (sid === 'wx') { wxTileErr.current = true; return }
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
    // Site imagery / Scaled plans: one slider per kind drives its images.
    const sv = overlayOpacity.siteimg
    const pv = overlayOpacity.siteplans
    for (const ov of siteOverlays ?? []) {
      const v = ov.kind === 'plan' ? pv : sv
      if (v == null) continue
      const lid = `simg-${ov.id}-layer`
      if (m.getLayer(lid)) m.setPaintProperty(lid, 'raster-opacity', v)
    }
    // Radar lives outside MAP_OVERLAYS (its own frame loop) — same slider.
    const rv = overlayOpacity.radar
    if (rv != null && m.getLayer('wx-layer')) m.setPaintProperty('wx-layer', 'raster-opacity', rv)
    // Rain totals — its own add-once raster, same slider treatment (Brian,
    // Aug 24: "rain totals needs opacity slider").
    const pcv = overlayOpacity.precip
    if (pcv != null && m.getLayer('precip-layer')) m.setPaintProperty('precip-layer', 'raster-opacity', pcv)
    // Airspace shelves — fill-extrusion, its own opacity property.
    const av = overlayOpacity.airspace3d
    if (av != null && m.getLayer('airspace3d-layer')) m.setPaintProperty('airspace3d-layer', 'fill-extrusion-opacity', av)
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

  // ── Alert pins: where alerts fired, pinned to the zone the rule watches —
  // alert events don't store coordinates, so the zone IS the honest location.
  // Pins follow the TIMELINE (Brian, Aug 10): only alerts inside the selected
  // window show (Live = today), and in a replay each pin appears the moment
  // the scrubber passes it — the map catches up with history as you sweep.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.alertpins
    for (const lid of ['alert-pins', 'alert-pins-mark']) {
      if (m.getLayer(lid)) m.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none')
    }
    if (!on) return
    // Window: replay = selected range up to the scrub position; Live = today.
    let fromMs: number, toMs: number
    if (pbActive && realWindowEff) {
      fromMs = realWindowEff.from
      toMs = realWindowEff.from + displayT * (realWindowEff.to - realWindowEff.from)
    } else {
      const d = new Date(); d.setHours(0, 0, 0, 0)
      fromMs = d.getTime()
      toMs = Date.now()
    }
    // Group by zone so five alerts at the yard become one pin with a count.
    // Company-wide rules (after-hours theft — THE headline alert) have no
    // zone, so those pin to the asset's current position instead of being
    // silently dropped ("I don't think I am seeing anything", Aug 5).
    const byZone = new Map<string, { cx: number; cy: number; lines: string[] }>()
    for (const a of alertsRef.current) {
      const at = new Date(a.triggered_at).getTime()
      if (at < fromMs || at > toMs) continue
      const g = a.rule?.geofence
      const ring = g?.geometry?.coordinates?.[0] as [number, number][] | undefined
      let key: string, cx: number, cy: number
      if (g && ring?.length) {
        key = g.id
        cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
        cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
      } else {
        const asset = assetsRef.current.find((x) => x.id === a.asset?.id)
        if (!asset?.location) continue
        key = `asset-${asset.id}`
        cx = asset.location.lng
        cy = asset.location.lat
      }
      let e = byZone.get(key)
      if (!e) byZone.set(key, (e = { cx, cy, lines: [] }))
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
          .setHTML(`<div style="padding:10px 12px;font:11.5px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#ff5d5d">Alerts here · in this window</div><div style="margin-top:3px">${p.list}</div></div>`)
          .addTo(m)
      })
      m.on('mouseenter', 'alert-pins', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'alert-pins', () => { m.getCanvas().style.cursor = '' })
    } else {
      src.setData(data)
    }
    window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'alertpins', at: Date.now() } }))
  }, [mapReady, overlaysOn.alertpins, pbActive, realWindowEff, displayT])

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
    // The info box FOLLOWS its object (Brian, Aug 22: "as I pan around a
    // plane the info box does not stay centered on the plane"). The sky
    // layer caches every object's on-screen position (sx/sy) each frame, so
    // the popup re-anchors from that on map moves AND on a timer (the plane
    // flies even while the map sits still). locate() returning null means
    // the object left the feed — the popup goes with it.
    let skyPopup: maplibregl.Popup | null = null
    let locateSky: (() => { sx: number; sy: number } | null) | null = null
    const popup = (lngLat: maplibregl.LngLatLike, html: string, locate?: () => { sx: number; sy: number } | null) => {
      skyPopup?.remove()
      locateSky = locate ?? null
      const sp = new maplibregl.Popup({ closeButton: false, maxWidth: '250px' })
        .setLngLat(lngLat)
        .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7">${html}</div>`)
        .addTo(m)
      sp.on('close', () => { if (skyPopup === sp) { skyPopup = null; locateSky = null } })
      skyPopup = sp
    }
    const followSky = () => {
      if (!skyPopup || !locateSky) return
      const p = locateSky()
      if (!p) { skyPopup.remove(); return }
      skyPopup.setLngLat(m.unproject([p.sx, p.sy]))
    }
    m.on('move', followSky)
    const followTimer = setInterval(followSky, 800)
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
        const body = hit.kind
        const locateBody = () => {
          const c = celestialRef.current
          const b = body === 'sun' ? c?.sun : c?.moon
          return b ? { sx: b.sx, sy: b.sy } : null
        }
        if (hit.kind === 'sun') {
          popup(e.lngLat, `<div style="font-weight:700;color:#ffd479">Sun</div><div style="margin-top:3px">${hit.distLabel}</div>`, locateBody)
        } else {
          popup(e.lngLat, `<div style="font-weight:700;color:#cdd5df">Moon</div><div style="margin-top:3px">${hit.distLabel}</div>${hit.illum != null ? `<div>${Math.round(hit.illum * 100)}% illuminated</div>` : ''}`, locateBody)
        }
      } else if ('hex' in hit) {
        const title = hit.flight ?? hit.reg ?? hit.hex.toUpperCase()
        const kindLine = [hit.typeLabel ?? hit.typeCode, hit.reg && hit.reg !== title ? hit.reg : null].filter(Boolean).join(' · ') || 'aircraft'
        // Draw this aircraft's 3D flight trail: whatever we've watched so far,
        // backfilled with its real recent track from adsb.lol.
        selPlaneRef.current = hit.hex
        rebuildPlaneTrail()
        backfillTrace(hit.hex)
        const hex = hit.hex
        const locatePlane = () => {
          const pl = planesRef.current?.find((x) => x.hex === hex)
          return pl ? { sx: pl.sx, sy: pl.sy } : null
        }
        popup(e.lngLat, `<div style="font-weight:700;color:#ffd94f">✈ ${title}</div><div style="color:#9fb6cc;font-size:10.5px">${kindLine}</div><div style="margin-top:3px">altitude <b style="color:#ff9e16">${hit.altFt.toLocaleString()} ft</b></div>${hit.mph ? `<div>speed ${hit.mph.toLocaleString()} mph <span style="color:#9fb6cc">· ${Math.round(hit.mph / 1.15078).toLocaleString()} kt</span></div>` : ''}<div style="color:#9fb6cc;margin-top:3px">flight trail on — tap empty sky to clear</div>`, locatePlane)
      } else {
        const facts: string[] = []
        if (hit.periodMin) facts.push(`orbits Earth every ${hit.periodMin >= 90 * 12 ? (hit.periodMin / 60).toFixed(1) + ' h' : Math.round(hit.periodMin) + ' min'}`)
        if (hit.inclDeg != null) facts.push(`${hit.inclDeg.toFixed(1)}° inclination`)
        const link = hit.norad
          ? `<a href="https://www.n2yo.com/satellite/?s=${hit.norad}" target="_blank" rel="noopener" style="display:inline-block;margin-top:5px;color:#2dd4bf;font-weight:600">full details & live track →</a>`
          : ''
        const satKey = hit.norad ?? hit.name
        const locateSat = () => {
          const sv = satsRef.current?.find((x) => (x.norad ?? x.name) === satKey)
          return sv ? { sx: sv.sx, sy: sv.sy } : null
        }
        popup(e.lngLat, `<div style="font-weight:700;color:#7dd3fc">${hit.name}</div><div style="color:#9fb6cc;font-size:10.5px">${kindLabel(hit.group)}${hit.norad ? ` · NORAD ${hit.norad}` : ''}</div><div style="margin-top:3px">altitude <b style="color:#ff9e16">${Math.round(hit.altKm).toLocaleString()} km</b> (${Math.round(hit.altKm * 0.6214).toLocaleString()} mi)</div>${hit.mph ? `<div>speed ${hit.mph.toLocaleString()} mph</div>` : ''}${facts.length ? `<div style="color:#9fb6cc">${facts.join(' · ')}</div>` : ''}${link}`, locateSat)
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
      m.off('move', followSky)
      clearInterval(followTimer)
      skyPopup?.remove()
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

  // ── Field activity (crew clock-ins + daily logs, GPS-stamped — mig 059) ──
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.fieldops
    if (m.getLayer('fieldops-dots')) {
      m.setLayoutProperty('fieldops-dots', 'visibility', on ? 'visible' : 'none')
      m.setLayoutProperty('fieldops-mark', 'visibility', on ? 'visible' : 'none')
    } else if (on) {
      m.addSource('fieldops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('clusters') ? 'clusters' : undefined
      m.addLayer({
        id: 'fieldops-dots', type: 'circle', source: 'fieldops',
        paint: {
          'circle-radius': 9,
          'circle-color': ['match', ['get', 'kind'], 'clockin', '#2dd4bf', '#ff9e16'],
          'circle-stroke-color': '#0b1523', 'circle-stroke-width': 2,
        },
      }, beforeId)
      m.addLayer({
        id: 'fieldops-mark', type: 'symbol', source: 'fieldops',
        layout: { 'text-field': ['get', 'tag'], 'text-size': 7.5, 'text-allow-overlap': true },
        paint: { 'text-color': '#001523' },
      }, beforeId)
      m.on('click', 'fieldops-dots', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        const title = p.kind === 'clockin' ? 'Clocked in' : 'Daily log'
        const color = p.kind === 'clockin' ? '#2dd4bf' : '#ff9e16'
        new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7">` +
            `<div style="font-weight:700;color:${color}">${title} · ${escHtml(p.person)}</div>` +
            `<div style="color:#9fb6cc">${escHtml(p.at)}${p.zone ? ` · ${escHtml(p.zone)}` : ''}</div>` +
            (p.text ? `<div style="margin-top:4px;color:#e8f0f7;white-space:normal;overflow-wrap:break-word">${escHtml(p.text)}</div>` : '') +
            `<a href="/logs" style="color:#2dd4bf;font-size:11px">open daily logs →</a></div>`
          )
          .addTo(m)
      })
      m.on('mouseenter', 'fieldops-dots', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'fieldops-dots', () => { m.getCanvas().style.cursor = '' })
    }
    if (!on) return
    let cancelled = false
    fetch('/api/field-activity')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { events?: { kind: string; lat: number; lng: number; person: string; at: string; zone: string | null; text: string }[] } | null) => {
        if (cancelled || !j?.events) return
        const features = j.events.map((ev) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [ev.lng, ev.lat] },
          properties: { kind: ev.kind, tag: ev.kind === 'clockin' ? 'IN' : 'LOG', person: ev.person, at: ev.at, zone: ev.zone ?? '', text: ev.text },
        }))
        ;(m.getSource('fieldops') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
        window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'fieldops', at: Date.now() } }))
      })
      .catch(() => { /* pre-059 database or offline — layer stays empty */ })
    return () => { cancelled = true }
  }, [mapReady, overlaysOn.fieldops])

  // ══ Aug 12 wow-pack: "where is my money and my day" ══════════════════════

  // ATTENTION SLOT — top-right, one badge, priority-picked (marker grammar):
  // live alert ⚠ beats service-due 🛠. Everything else waits in the asset
  // sheet; a marker never wears a third bauble.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m || m.getLayer('wrench-badge') || !m.getSource('assets')) return
    m.addLayer({
      id: 'wrench-badge', type: 'symbol', source: 'assets',
      filter: ['all', ['!', ['has', 'point_count']], ['any', ['>', ['get', 'maint'], 0], ['==', ['get', 'alert'], 1]]],
      // It rides LIVE positions, so it lives in LIVE_LAYERS and hides with
      // the other live pins in trail/replay modes (ship-check P1: a ghost
      // wrench floated at the machine's CURRENT spot during yesterday's
      // replay). Initial visibility honors a restored trail mode.
      // Zoom ladder: badges wait for town zoom (10) — same tier as the
      // payload count.
      minzoom: 10,
      layout: { 'text-field': ['case', ['==', ['get', 'alert'], 1], '⚠️', '🛠'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 11.5, 16, 14], 'text-offset': [1.15, -1.15], 'text-allow-overlap': true, 'text-ignore-placement': true, visibility: trailModeRef.current === 'off' ? 'visible' : 'none' },
    })
  }, [mapReady])

  // Shared caches for the Flyover briefing card — filled by the burn and
  // pourcast effects below, topped up on demand at flyover takeoff.
  const burnDataRef = useRef<Map<string, { spentToday: number; hoursToday: number; rateCoverage: string }>>(new Map())
  const pourDataRef = useRef<Map<string, { date: string; reason: string } | null>>(new Map())

  // Burn Map — zones shade by today's spend vs budget, with live $ chips.
  // LIVE-ONLY by the timeline-truth rule: these numbers are "right now".
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.burnmap && !pbActive
    if (!m.getSource('burn')) {
      m.addSource('burn', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const beforeId = m.getLayer('clusters') ? 'clusters' : undefined
      m.addLayer({
        id: 'burn-fill', type: 'fill', source: 'burn',
        paint: {
          'fill-color': ['case', ['<', ['get', 'pct'], 0], '#3b82f6',
            ['interpolate', ['linear'], ['get', 'pct'], 0.5, '#22c55e', 0.85, '#ff9e16', 1.0, '#ef4444']],
          'fill-opacity': 0.22,
        },
      }, beforeId)
      m.addLayer({
        id: 'burn-chip', type: 'symbol', source: 'burn', minzoom: 8,
        layout: {
          'text-field': ['get', 'chip'], 'text-size': 11.5,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'top', 'text-offset': [0, 0.6], 'text-allow-overlap': true,
        },
        paint: { 'text-color': ['case', ['<', ['get', 'pct'], 0], '#7dd3fc', ['<', ['get', 'pct'], 0.85], '#4ade80', '#fca5a5'], 'text-halo-color': '#001016', 'text-halo-width': 2 },
      }, beforeId)
    }
    const setVis = (v: boolean) => ['burn-fill', 'burn-chip'].forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'))
    setVis(on)
    if (!on) return
    let alive = true
    const paint = (zones: { id: string; spentToday: number; hoursToday: number; budget: number | null; spentTotal: number; rateCoverage: string }[]) => {
      const byId = new Map(zones.map((z) => [z.id, z]))
      burnDataRef.current = new Map(zones.map((z) => [z.id, z]))
      const feats: GeoJSON.Feature[] = []
      // geofences via REF — with the array in the deps, the bootstrap 20s
      // tick's new identity re-ran this effect and reset the 60s poll every
      // 20s (ship-check P1: 3x the advertised load, interval never fired).
      for (const g of geofencesRef.current) {
        if (fenceKind(g) !== 'site') continue
        const z = byId.get(g.id)
        if (!z) continue
        const pct = z.budget && z.budget > 0 ? z.spentTotal / z.budget : -1
        const chip = z.rateCoverage === 'none'
          ? `${g.name} · set rates →`
          : `${g.name} · $${Math.round(z.spentToday).toLocaleString()} today${pct >= 0 ? ` · ${Math.round(pct * 100)}%` : ''}`
        feats.push({ type: 'Feature', geometry: g.geometry, properties: { pct, chip } })
      }
      ;(m.getSource('burn') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
    }
    const poll = () => fetch('/api/zone-burn')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`burn ${r.status}`))))
      .then((j: { zones?: Parameters<typeof paint>[0] }) => {
        if (!alive || !j.zones) return
        paint(j.zones)
        window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'burnmap', at: Date.now() } }))
      })
      .catch((e) => window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'burnmap', msg: e instanceof Error ? e.message : 'burn feed down' } })))
    poll()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') poll() }, 60_000)
    return () => { alive = false; clearInterval(iv) }
  }, [mapReady, overlaysOn.burnmap, pbActive])

  // Idle-dollar rings — parked machines grow a red ring with the ownership
  // cost they've accrued sitting still. Data rides the assets source.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m || !m.getSource('assets')) return
    // Rings ride LIVE positions — hide in trail/heat replay modes too, not
    // just during playback (ship-check: rings floated with no pin under
    // them once the live dots hid).
    const on = !!overlaysOn.idledollars && !pbActive && trailMode === 'off'
    if (!m.getLayer('idle-label')) {
      // 'dead' excluded: idleDays counts since the last MOVING fix, so a
      // tracker silent 48h+ always passes ≥2 — but its idle math is stale
      // guesswork, and a red $ chip contradicted the gray ring (ship-check).
      const idleFilter: maplibregl.FilterSpecification = ['all', ['!', ['has', 'point_count']], ['>=', ['get', 'idleDays'], 2], ['>', ['get', 'dailyCost'], 0], ['!=', ['get', 'state'], 'moving'], ['!=', ['get', 'state'], 'dead']]
      // The RING moved into the always-on state ring (marker grammar — red
      // thickness = days idle); this opt-in overlay keeps only the $ chip.
      m.addLayer({
        id: 'idle-label', type: 'symbol', source: 'assets', filter: idleFilter, minzoom: 10,
        layout: {
          'text-field': ['concat', '$', ['to-string', ['round', ['*', ['get', 'idleDays'], ['get', 'dailyCost']]]], ' · ', ['to-string', ['get', 'idleDays']], 'd idle'],
          'text-size': 10, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'top', 'text-offset': [0, 2.0], 'text-optional': true,
        },
        paint: { 'text-color': '#fca5a5', 'text-halo-color': '#001016', 'text-halo-width': 2 },
      })
    }
    ;['idle-label'].forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'))
  }, [mapReady, overlaysOn.idledollars, pbActive, trailMode])

  // Night Watch — where the fleet sleeps: teal halo + 🔒 tucked inside a
  // yard/site/boundary zone, amber halo + ⚠ out in the open. Current truth
  // only (hidden during replays).
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.nightwatch && !pbActive
    if (!m.getSource('nightwatch')) {
      m.addSource('nightwatch', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'nightwatch-halo', type: 'circle', source: 'nightwatch',
        paint: {
          'circle-radius': 17, 'circle-blur': 0.5,
          'circle-color': ['case', ['get', 'ok'], '#2dd4bf', '#ff9e16'],
          'circle-opacity': 0.4,
        },
      })
      m.addLayer({
        id: 'nightwatch-mark', type: 'symbol', source: 'nightwatch', minzoom: 9,
        // Top-LEFT shoulder (marker grammar, Aug 22): top-right is the
        // attention slot, bottom-right the payload count — the night-watch
        // mark takes the free corner so nothing ever prints on top of it.
        layout: { 'text-field': ['case', ['get', 'ok'], '🔒', '⚠️'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 11.5, 16, 14], 'text-offset': [-1.3, -1.1], 'text-allow-overlap': true },
      })
    }
    const setVis = (v: boolean) => ['nightwatch-halo', 'nightwatch-mark'].forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'))
    setVis(on)
    if (!on) return
    // Point-in-polygon (ray cast) against sleep-worthy zones.
    const inside = (lng: number, lat: number, ring: number[][]) => {
      let ok = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j]
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ok = !ok
      }
      return ok
    }
    const beds = geofences.filter((g) => ['yard', 'site', 'boundary'].includes(fenceKind(g)))
    const feats: GeoJSON.Feature[] = []
    for (const a of assets) {
      if (a.type === 'tool' || a.type === 'personnel' || !a.location) continue
      const age = Date.now() - new Date(a.location.timestamp).getTime()
      const moving = age < 15 * 60_000 && (a.location.speed ?? 0) > 2
      if (moving) continue
      const tucked = beds.some((g) => inside(a.location!.lng, a.location!.lat, g.geometry.coordinates[0] as number[][]))
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.location.lng, a.location.lat] }, properties: { ok: tucked } })
    }
    ;(m.getSource('nightwatch') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
  }, [mapReady, overlaysOn.nightwatch, pbActive, assets, geofences])

  // Road closures — SCDOT cones, tap for the story.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.closures
    if (!m.getSource('closures')) {
      m.addSource('closures', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'closures-icon', type: 'symbol', source: 'closures',
        layout: { 'text-field': '🚧', 'text-size': 15, 'text-allow-overlap': true },
      })
      m.on('click', 'closures-icon', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#ff9e16">🚧 ${escHtml(p.road || p.kind || 'Closure')}</div><div style="color:#9fb6cc;white-space:normal">${escHtml(p.desc ?? '')}</div></div>`)
          .addTo(m)
      })
    }
    if (m.getLayer('closures-icon')) m.setLayoutProperty('closures-icon', 'visibility', on ? 'visible' : 'none')
    if (!on) return
    let alive = true
    const poll = () => {
      const b = m.getBounds()
      fetch(`/api/road-closures?w=${b.getWest().toFixed(2)}&s=${b.getSouth().toFixed(2)}&e=${b.getEast().toFixed(2)}&n=${b.getNorth().toFixed(2)}`)
        .then((r) => (r.ok
          ? r.json()
          : Promise.reject(new Error(r.status === 503
            ? 'DOT feeds unreachable right now — retries every few minutes'
            : `feed error (${r.status})`))))
        .then((j: { closures?: { lat: number; lng: number; kind?: string; road?: string; desc?: string }[] }) => {
          if (!alive) return
          ;(m.getSource('closures') as maplibregl.GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: (j.closures ?? []).map((c) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] }, properties: { kind: c.kind ?? '', road: c.road ?? '', desc: c.desc ?? '' } })),
          })
          window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'closures', at: Date.now() } }))
        })
        .catch((e) => window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'closures', msg: e instanceof Error ? e.message : 'feed down' } })))
    }
    poll()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') poll() }, 5 * 60_000)
    // Refetch on pan (debounced) — the server holds the statewide set; this
    // is purely the client catching up to a new viewport (ship-check P2).
    let mt: ReturnType<typeof setTimeout> | undefined
    const onMove = () => { clearTimeout(mt); mt = setTimeout(poll, 800) }
    m.on('moveend', onMove)
    return () => { alive = false; clearInterval(iv); clearTimeout(mt); m.off('moveend', onMove) }
  }, [mapReady, overlaysOn.closures])

  // Pour planner — each active site flags its next bad concrete/crane day.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.pourcast
    if (!m.getSource('pourcast')) {
      m.addSource('pourcast', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'pourcast-chip', type: 'symbol', source: 'pourcast', minzoom: 8,
        layout: {
          'text-field': ['get', 'chip'], 'text-size': 11,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-anchor': 'bottom', 'text-offset': [0, -1.6], 'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ff9e16', 'text-halo-color': '#001016', 'text-halo-width': 2 },
      })
    }
    if (m.getLayer('pourcast-chip')) m.setLayoutProperty('pourcast-chip', 'visibility', on ? 'visible' : 'none')
    if (!on) return
    let alive = true
    fetch('/api/zone-pourcast')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`pourcast ${r.status}`))))
      .then((j: { zones?: { id: string; days?: unknown[]; nextBad: { date: string; reason: string } | null }[] }) => {
        if (!alive || !j.zones) return
        const byId = new Map(j.zones.map((z) => [z.id, z]))
        // Only zones whose forecast actually LOADED enter the card cache —
        // a failed fetch must never render as "clear" (ship-check P1).
        for (const z of j.zones) { if (z.days?.length) pourDataRef.current.set(z.id, z.nextBad) }
        const feats: GeoJSON.Feature[] = []
        for (const g of geofencesRef.current) {
          if (fenceKind(g) !== 'site') continue
          const z = byId.get(g.id)
          if (!z || !z.days?.length) continue // no data → no chip, never a false "clear"
          const ring = g.geometry.coordinates[0] as number[][]
          const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
          const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
          const chip = z.nextBad
            ? `⛈ ${new Date(z.nextBad.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })} — ${z.nextBad.reason}`
            : '☀ 5 days clear'
          feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [cx, cy] }, properties: { chip } })
        }
        ;(m.getSource('pourcast') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
        window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'pourcast', at: Date.now() } }))
      })
      .catch((e) => window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'pourcast', msg: e instanceof Error ? e.message : 'forecast down' } })))
    return () => { alive = false }
  }, [mapReady, overlaysOn.pourcast])

  // ── Airspace 3D — the sectional's upside-down cake, extruded for real
  // (Brian, Aug 10). FAA AIS publishes every Class B/C/D polygon WITH its
  // charted floor/ceiling; each shelf becomes a translucent fill-extrusion
  // slab from LOWER_VAL to UPPER_VAL (feet MSL → meters, 1:1 scale — tilt
  // the map to see the tiers). Aviation colors: B blue, C magenta, D light
  // blue. Note: rendered above the map's flat ground plane, so shelves sit
  // at MSL altitude over sea-level terrain — chart-accurate geometry.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = !!overlaysOn.airspace3d
    if (m.getLayer('airspace3d-layer')) {
      m.setLayoutProperty('airspace3d-layer', 'visibility', on ? 'visible' : 'none')
    } else if (on) {
      m.addSource('airspace3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'airspace3d-layer', type: 'fill-extrusion', source: 'airspace3d',
        paint: {
          'fill-extrusion-color': ['match', ['get', 'cls'], 'B', '#3b82f6', 'C', '#c026d3', '#38bdf8'],
          'fill-extrusion-opacity': 0.22,
          'fill-extrusion-base': ['get', 'base_m'],
          'fill-extrusion-height': ['get', 'top_m'],
        },
      })
      m.on('click', 'airspace3d-layer', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        new maplibregl.Popup({ closeButton: false, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="padding:10px 12px;font:12px/1.5 system-ui,sans-serif;color:#e8f0f7"><div style="font-weight:700;color:#60a5fa">${String(p.name || 'Airspace')} · Class ${p.cls}</div><div style="color:#9fb6cc">${p.band}</div></div>`)
          .addTo(m)
      })
      m.on('mouseenter', 'airspace3d-layer', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'airspace3d-layer', () => { m.getCanvas().style.cursor = '' })
    }
    if (!on) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    // Padded-envelope cache: fetch a 2.5×-viewport area once and skip
    // refetches while panning inside it — the old version re-downloaded and
    // re-triangulated the world on every moveend ("very heavy", Aug 10).
    let cachedEnv: { w: number; s: number; e: number; n: number } | null = null
    const load = () => {
      if (m.getZoom() < 6) return
      const b = m.getBounds()
      if (cachedEnv && b.getWest() > cachedEnv.w && b.getSouth() > cachedEnv.s && b.getEast() < cachedEnv.e && b.getNorth() < cachedEnv.n) return
      const padX = (b.getEast() - b.getWest()) * 0.75
      const padY = (b.getNorth() - b.getSouth()) * 0.75
      const env = { w: b.getWest() - padX, s: b.getSouth() - padY, e: b.getEast() + padX, n: b.getNorth() + padY }
      cachedEnv = env
      // Diet query: B/C/D only (Class E blankets were most of the payload),
      // four fields instead of *, and maxAllowableOffset decimates the FAA's
      // thousand-vertex arc tessellation to ~90 m tolerance — the cylinders
      // stay visually round at a fraction of the triangulation cost.
      const urlFor = (where: string) =>
        'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Class_Airspace/FeatureServer/0/query' +
        `?where=${encodeURIComponent(where)}` +
        `&geometry=${encodeURIComponent(`${env.w},${env.s},${env.e},${env.n}`)}` +
        '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects' +
        '&outFields=NAME,CLASS,LOWER_VAL,UPPER_VAL&returnGeometry=true' +
        '&maxAllowableOffset=0.0008&geometryPrecision=5&resultRecordCount=250&f=geojson'
      // If the CLASS filter trips a field-name error, retry once unfiltered —
      // the client-side B/C/D filter below still applies.
      fetch(urlFor("CLASS IN ('B','C','D')"))
        .then((r) => (r.ok ? r.json() : null))
        .then((j: GeoJSON.FeatureCollection | null) =>
          j && Array.isArray(j.features) ? j : fetch(urlFor('1=1')).then((r) => (r.ok ? r.json() : null)))
        .then((j: GeoJSON.FeatureCollection | null) => {
          if (cancelled || !j?.features) return
          const FT = 0.3048
          const toNum = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : null }
          const raw = j.features.flatMap((f) => {
            const p = (f.properties ?? {}) as Record<string, unknown>
            const cls = String(p.CLASS ?? p.class ?? '').toUpperCase()
            if (cls !== 'B' && cls !== 'C' && cls !== 'D') return []
            let lo = toNum(p.LOWER_VAL)
            let hi = toNum(p.UPPER_VAL)
            if (lo == null || lo < 0) lo = 0 // -9998 sentinel = surface
            if (hi == null) hi = 0
            return [{ geometry: f.geometry, cls, name: String(p.NAME ?? p.name ?? ''), lo, hi }]
          })
          // Unit sniff: NASR ships these values in HUNDREDS of feet in some
          // vintages — a 5,300 ft shelf arrived as 53 and extruded to a
          // 16 m pancake ("airspace not 3d at all", Aug 10). If nothing in
          // the payload exceeds 200, the numbers are hundreds of feet.
          const maxVal = raw.reduce((mx, r) => Math.max(mx, r.hi, r.lo), 0)
          const unit = maxVal > 0 && maxVal <= 200 ? 100 : 1
          const features = raw.map((r) => {
            const lo = r.lo * unit
            let hi = r.hi * unit
            if (hi <= lo) hi = lo + 1000 // defensive: give the shelf a body
            if (hi > 60_000) hi = 60_000
            const band = `${lo === 0 ? 'SFC' : `${lo.toLocaleString()} ft`} – ${hi.toLocaleString()} ft MSL`
            return {
              type: 'Feature' as const,
              geometry: r.geometry,
              // Bases sink ~50 ft (clamped at ground — the renderer doesn't
              // do negative) so shelf bottoms tuck under the surface instead
              // of hovering over dips (Brian, Aug 10). Tops stay charted.
              properties: { cls: r.cls, name: r.name, base_m: Math.max(0, lo * FT - 15), top_m: hi * FT, band },
            }
          })
          ;(m.getSource('airspace3d') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
          window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'airspace3d', at: Date.now() } }))
        })
        .catch(() => {
          window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'airspace3d', msg: 'FAA airspace service unreachable right now' } }))
        })
    }
    const onMove = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 900) }
    load()
    m.on('moveend', onMove)
    return () => { cancelled = true; if (timer) clearTimeout(timer); m.off('moveend', onMove) }
  }, [mapReady, overlaysOn.airspace3d])

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
        // Near-invisible fill makes every parcel TAPPABLE (LandGlide-style
        // identify) — a bare line layer has no hit area.
        m.addLayer({
          id: 'parcels-fill', type: 'fill', source: 'parcels', minzoom: PARCEL_MIN_ZOOM,
          paint: { 'fill-color': '#ffd166', 'fill-opacity': 0.03 },
        }, beforeId)
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

    // Tap a parcel → who owns it, where it is, how big (free county data).
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const onParcelClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const p = e.features?.[0]?.properties as { parcel_label?: string; owner?: string; situs?: string; acres?: number } | undefined
      if (!p) return
      const rows = [
        p.parcel_label ? `<div style="font-weight:700;font-size:12.5px">Parcel ${esc(String(p.parcel_label))}</div>` : '<div style="font-weight:700;font-size:12.5px">Parcel</div>',
        p.owner ? `<div style="font-size:11.5px;color:#e8f1f8">${esc(String(p.owner))}</div>` : '',
        p.situs ? `<div style="font-size:11px;color:#9fb6cc">${esc(String(p.situs))}</div>` : '',
        p.acres ? `<div style="font-size:11px;color:#9fb6cc">${p.acres} ac</div>` : '',
        (!p.owner && !p.situs) ? '<div style="font-size:10.5px;color:#6c8299">This county layer doesn’t publish owner details.</div>' : '',
      ].join('')
      new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="padding:8px 12px">${rows}</div>`)
        .addTo(m)
    }
    const parcelCursor = () => { m.getCanvas().style.cursor = 'pointer' }
    const parcelCursorOff = () => { m.getCanvas().style.cursor = '' }

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
      for (const id of ['parcels-fill', 'parcels-line', 'parcels-label']) m.setLayoutProperty(id, 'visibility', 'visible')
      refresh()
      m.on('moveend', refresh)
      m.on('click', 'parcels-fill', onParcelClick)
      m.on('mouseenter', 'parcels-fill', parcelCursor)
      m.on('mouseleave', 'parcels-fill', parcelCursorOff)
      return () => {
        m.off('moveend', refresh)
        m.off('click', 'parcels-fill', onParcelClick)
        m.off('mouseenter', 'parcels-fill', parcelCursor)
        m.off('mouseleave', 'parcels-fill', parcelCursorOff)
        parcelAbort.current?.abort()
      }
    }
    for (const id of ['parcels-fill', 'parcels-line', 'parcels-label']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none')
    }
  }, [mapReady, parcelsOn])

  // Build fresh radar frames whenever radar is switched on (keeps the loop live).
  useEffect(() => {
    if (!radarOn) return
    setRadarFrames(buildRadarFrames(10, 5))
    setRadarIdx(0)
  }, [radarOn])

  // Paint the right-rail radar button's on-state (the IControl lives outside
  // React, so state → DOM by hand: amber icon + tinted background when live).
  useEffect(() => {
    const b = radarBtnEl.current
    if (!b) return
    b.style.backgroundColor = radarOn ? 'rgba(255,158,22,0.22)' : ''
    const svg = b.querySelector('svg')
    if (svg) svg.setAttribute('stroke', radarOn ? '#ff9e16' : '#9fb6cc')
  }, [radarOn, mapReady])

  // Radar frame-time chip — an OPT-IN slide-out beside the radar button
  // (Brian, Aug 10: "swiped on or off. mostly off for most people").
  // Swipe LEFT on the radar button to pull it out, swipe RIGHT (button or
  // chip) to tuck it away; the choice persists per device. Default: off.
  const [radarChipOpen, setRadarChipOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('ht_radar_chip') === '1' } catch { return false }
  })
  const setChipOpen = useCallback((open: boolean) => {
    setRadarChipOpen(open)
    try { localStorage.setItem('ht_radar_chip', open ? '1' : '0') } catch { /* private mode */ }
  }, [])
  const radarSwipeRef = useRef<{ x: number; y: number } | null>(null)
  const radarSwipedRef = useRef(false)
  useEffect(() => {
    const b = radarBtnEl.current
    if (!mapReady || !b) return
    // Without touch-action:none the browser claims horizontal drags as a
    // scroll gesture and fires pointercancel before the swipe registers
    // ("swipe left on radar button is not working", Aug 10).
    b.style.touchAction = 'none'
    const down = (e: PointerEvent) => { radarSwipeRef.current = { x: e.clientX, y: e.clientY }; radarSwipedRef.current = false }
    const move = (e: PointerEvent) => {
      const s = radarSwipeRef.current
      if (!s || radarSwipedRef.current) return
      const dx = e.clientX - s.x, dy = e.clientY - s.y
      if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        radarSwipedRef.current = true // eat the click that follows
        setChipOpen(dx < 0)
      }
    }
    const up = () => { radarSwipeRef.current = null }
    b.addEventListener('pointerdown', down)
    b.addEventListener('pointermove', move)
    b.addEventListener('pointerup', up)
    b.addEventListener('pointercancel', up)
    return () => {
      b.removeEventListener('pointerdown', down)
      b.removeEventListener('pointermove', move)
      b.removeEventListener('pointerup', up)
      b.removeEventListener('pointercancel', up)
    }
  }, [mapReady, setChipOpen])

  // Slide the whole right-rail control column off-screen on demand — a
  // clean-screen mode for phones ("need a way to minimize or slide these
  // buttons off", Aug 10). The little edge tab stays put to bring it back.
  // Tray-handle swipe tracking (Brian, Aug 22: "I still can't swipe to open
  // the right and the left tray") — a horizontal drag on a handle acts like
  // the tap, and the tail-end click is swallowed (same trick as the radar
  // button's swipe).
  const leftTraySwipe = useRef<{ x: number } | null>(null)
  const leftTraySwiped = useRef(false)
  const railTraySwipe = useRef<{ x: number } | null>(null)
  const railTraySwiped = useRef(false)
  // Tucked-rail preference survives visits (Aug 22): the owner who tucks the
  // buttons once wants a map, not a control panel, every open.
  const [railHidden, setRailHidden] = useState(() => {
    try { return localStorage.getItem('ht_rail_hidden') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('ht_rail_hidden', railHidden ? '1' : '0') } catch { /* private mode */ }
  }, [railHidden])
  // The tour must point at REAL chrome: pull the tucked rail back before
  // it measures, or step 1's ring draws at x ≈ -250 around nothing
  // (ship-check P2). Covers the ht:tour relaunch AND the ?tour=1 deep link.
  useEffect(() => {
    const untuck = () => { setRailHidden(false) }
    window.addEventListener('ht:tour', untuck)
    try {
      if (new URLSearchParams(window.location.search).get('tour') === '1') untuck()
    } catch { /* SSR-safe */ }
    return () => window.removeEventListener('ht:tour', untuck)
  }, [])
  useEffect(() => {
    const el = mapContainer.current?.querySelector('.maplibregl-ctrl-top-right') as HTMLElement | null
    if (!el) return
    el.style.transition = 'transform .25s ease, opacity .25s ease'
    el.style.transform = railHidden ? 'translateX(90px)' : ''
    el.style.opacity = railHidden ? '0' : ''
    el.style.pointerEvents = railHidden ? 'none' : ''
  }, [railHidden, mapReady])
  // The MAP TOOLS handle sits straight across from LAYERS (Brian, Aug 24) —
  // same 44% height, a matched pair of tray tabs. When the button column is
  // out, the tab slides LEFT with it and rides the column's edge (the name
  // moves with the pullout); the old below-the-column parking spot is gone.
  // offsetWidth is layout-based, so the hide transform can't skew the
  // measurement.
  const [railTabOffset, setRailTabOffset] = useState<number | null>(null)
  useEffect(() => {
    if (!mapReady) return
    const el = mapContainer.current?.querySelector('.maplibregl-ctrl-top-right') as HTMLElement | null
    if (!el) return
    const measure = () => {
      const mr = parseFloat(getComputedStyle(el).marginRight) || 10
      if (el.offsetWidth > 0) setRailTabOffset(el.offsetWidth + mr)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [mapReady])
  // Swipe RIGHT anywhere on the button column to tuck it (Brian, Aug 23) —
  // the same gesture the edge handle speaks, now the whole rail hears it.
  // Move/up ride on document so the gesture survives the finger leaving the
  // slim column; the tail-end click is swallowed so a button under the
  // finger doesn't also fire.
  useEffect(() => {
    if (!mapReady) return
    const el = mapContainer.current?.querySelector('.maplibregl-ctrl-top-right') as HTMLElement | null
    if (!el) return
    let st: { x: number; y: number } | null = null
    let swiped = false
    const move = (e: PointerEvent) => {
      if (!st || swiped) return
      const dx = e.clientX - st.x
      const dy = e.clientY - st.y
      if (dx > 40 && dx > Math.abs(dy) * 1.5) { swiped = true; setRailHidden(true) }
    }
    const up = () => {
      st = null
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      window.setTimeout(() => { swiped = false }, 80)
    }
    const down = (e: PointerEvent) => {
      st = { x: e.clientX, y: e.clientY }
      swiped = false
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      // pointercancel too (rotation, notification shade — which starts
      // exactly at this corner): without it the document listener leaked a
      // stale origin and a later map pan could self-tuck the rail
      // (ship-check P2, Aug 23).
      document.addEventListener('pointercancel', up)
    }
    const click = (e: MouseEvent) => { if (swiped) { e.preventDefault(); e.stopPropagation() } }
    el.addEventListener('pointerdown', down)
    el.addEventListener('click', click, true)
    // Without this the browser claims the horizontal drag (pointercancel
    // fires before dx reaches the threshold) and the swipe-to-tuck only
    // worked with a mouse — the edge tab always worked because it carries
    // touch-none (Brian, Aug 24). The column doesn't scroll, so none is safe.
    const prevTouchAction = el.style.touchAction
    el.style.touchAction = 'none'
    return () => {
      el.style.touchAction = prevTouchAction
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('click', click, true)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
    }
  }, [mapReady])
  // Two-finger HOLD = quick measure (see measureSeed above). Detached while
  // the tool is already open so a slow pinch mid-measure can't reset it.
  useEffect(() => {
    if (!mapReady || kiosk || measureOn) return
    const el = mapContainer.current
    if (!el) return
    let timer: number | null = null
    let start: { x0: number; y0: number; x1: number; y1: number } | null = null
    const cancel = () => {
      if (timer != null) { window.clearTimeout(timer); timer = null }
      start = null
    }
    const onTouches = (e: TouchEvent) => {
      if (e.touches.length !== 2) { cancel(); return }
      cancel()
      const [a, b] = [e.touches[0], e.touches[1]]
      start = { x0: a.clientX, y0: a.clientY, x1: b.clientX, y1: b.clientY }
      timer = window.setTimeout(() => {
        const m = map.current
        const s = start
        cancel()
        if (!m || !s) return
        const r = el.getBoundingClientRect()
        const p0 = m.unproject([s.x0 - r.left, s.y0 - r.top])
        const p1 = m.unproject([s.x1 - r.left, s.y1 - r.top])
        setEditingMeasure(null)
        setMeasureSeed({ id: '', name: '', kind: 'line', personal: true, coords: [[p0.lng, p0.lat], [p1.lng, p1.lat]] })
        setMeasureOn(true)
      }, 550)
    }
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length < 2) return
      const [a, b] = [e.touches[0], e.touches[1]]
      // Any real movement = a pinch/rotate, not a hold.
      if (Math.hypot(a.clientX - start.x0, a.clientY - start.y0) > 14 ||
          Math.hypot(b.clientX - start.x1, b.clientY - start.y1) > 14) cancel()
    }
    el.addEventListener('touchstart', onTouches, { passive: true })
    el.addEventListener('touchend', onTouches, { passive: true })
    el.addEventListener('touchcancel', onTouches, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      cancel()
      el.removeEventListener('touchstart', onTouches)
      el.removeEventListener('touchend', onTouches)
      el.removeEventListener('touchcancel', onTouches)
      el.removeEventListener('touchmove', onMove)
    }
  }, [mapReady, kiosk, measureOn])

  // Chip position: measured off the radar button so it hugs the rail.
  const [radarChipPos, setRadarChipPos] = useState<{ top: number; right: number } | null>(null)
  useEffect(() => {
    // Measured whenever radar is ON (not just while the chip is open): the
    // pull-handle chevron needs the anchor even when the chip is tucked
    // (Brian, Aug 22: the slide-out has to be OBVIOUS).
    if (!radarOn || !mapReady) { setRadarChipPos(null); return }
    const measure = () => {
      const wrap = mapContainer.current, b = radarBtnEl.current
      if (!wrap || !b) return
      const wr = wrap.getBoundingClientRect(), br = b.getBoundingClientRect()
      setRadarChipPos({ top: br.top - wr.top, right: wr.right - br.left + 8 })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [radarOn, mapReady])
  // Hand-scrub of the radar loop (Brian, Aug 22): dragging the chip's bar
  // moves the frame directly; a manual scrub pauses the loop (manual wins).
  const radarScrubbing = useRef(false)
  const scrubRadarTo = useCallback((clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setRadarIdx(Math.round(frac * Math.max(0, radarFrames.length - 1)))
    setRadarPaused(true)
  }, [radarFrames.length])


  // Animate the radar loop — advance the frame ~1.4/sec, holding the newest a
  // beat longer so the loop "lands" on now. The loop runs ONLY on the Live
  // range: any historical range means the radar obeys the scrubber (or holds
  // the newest frame while that range's history is still loading) — a sky
  // that animates under a stopped timeline reads as data. Manual pause wins
  // everywhere.
  useEffect(() => {
    if (!radarOn || radarFrames.length === 0 || pbActive || radarPaused) {
      // Replays hold the newest frame (the MAIN scrubber drives radar there).
      // A manual pause now HOLDS its frame instead of snapping to newest —
      // the chip's scrubber knob shows exactly which frame is on screen, and
      // snapping would erase a hand-scrubbed position (Aug 22).
      if (radarFrames.length && pbActive) setRadarIdx(radarFrames.length - 1)
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
    if (wxAdded.current && wxTileErr.current) {
      // A tile errored since the last swap: setTiles would force the errored
      // (texture-less) tiles into a renderable "expired" state and crash the
      // raster draw (see wxTileErr above). Tear the source down instead —
      // the re-add below rebuilds it clean.
      wxTileErr.current = false
      if (m.getLayer('wx-layer')) m.removeLayer('wx-layer')
      if (m.getSource('wx')) m.removeSource('wx')
      wxAdded.current = false
    }
    if (!wxAdded.current) {
      m.addSource('wx', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 10 })
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      // fade-duration 0 (task #13): with the default 300ms cross-fade,
      // MapLibre's drawRaster touches parent-tile textures that don't exist
      // yet on the FIRST re-tile and throws "reading 'bind'" — the /command
      // first-timeline-switch crash. Site imagery already runs fade 0.
      m.addLayer({ id: 'wx-layer', type: 'raster', source: 'wx', paint: { 'raster-opacity': overlayOpacity.radar ?? 0.72, 'raster-fade-duration': 0 } }, beforeId)
      wxAdded.current = true
    } else {
      // Visibility first, THEN the re-tile — setTiles marks every in-view
      // tile expired, and forcing visibility in the same tick as the reload
      // rendered tiles whose textures were mid-swap (task #13).
      if (m.getLayer('wx-layer')) m.setLayoutProperty('wx-layer', 'visibility', 'visible')
      ;(m.getSource('wx') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
    }
  }, [mapReady, radarOn, currentFrame, scrubRadarTs])

  // ── Actual lightning strikes riding the radar (Brian, Aug 11) ────────────
  // GOES-East GLM flash detections (real bolts, not the density raster) from
  // /api/lightning-strikes, drawn whenever radar is on in LIVE view. Each
  // strike fades over ~10 minutes of age. Live-only by the timeline-truth
  // rule — GLM here is a now-feed, so replays never show today's bolts.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const on = radarOn && !pbActive
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    if (!m.getSource('glm-strikes')) {
      m.addSource('glm-strikes', { type: 'geojson', data: empty })
      m.addLayer({
        id: 'glm-strike-glow', type: 'circle', source: 'glm-strikes',
        paint: {
          'circle-color': '#ffd24d', 'circle-blur': 0.9,
          'circle-radius': ['interpolate', ['linear'], ['get', 'age'], 0, 13, 600, 5],
          'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.5, 600, 0.05],
        },
      })
      m.addLayer({
        id: 'glm-strike-bolt', type: 'symbol', source: 'glm-strikes',
        layout: {
          'text-field': '⚡',
          'text-size': ['interpolate', ['linear'], ['get', 'age'], 0, 16, 600, 10],
          'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: { 'text-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 1, 600, 0.15] },
      })
    }
    const src = () => m.getSource('glm-strikes') as maplibregl.GeoJSONSource | undefined
    if (!on) { src()?.setData(empty); return }
    let alive = true
    let errNoted = false
    const poll = async () => {
      try {
        const b = m.getBounds()
        // Pad the viewport so nearby cells are already painted after a pan.
        const px = (b.getEast() - b.getWest()) * 0.5, py = (b.getNorth() - b.getSouth()) * 0.5
        const qs = `w=${(b.getWest() - px).toFixed(2)}&s=${(b.getSouth() - py).toFixed(2)}&e=${(b.getEast() + px).toFixed(2)}&n=${(b.getNorth() + py).toFixed(2)}`
        const r = await fetch(`/api/lightning-strikes?${qs}`)
        if (!r.ok) throw new Error(`strike feed ${r.status}`)
        const j: { strikes?: { lat: number; lon: number; ageSec: number }[] } = await r.json()
        if (!alive) return
        src()?.setData({
          type: 'FeatureCollection',
          features: (j.strikes ?? []).map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            properties: { age: Math.min(600, p.ageSec) },
          })),
        })
      } catch (e) {
        // Say so ON the radar row — a silent miss during a storm reads as
        // "feature doesn't work" ("not seeing the lightning strikes", Aug 11).
        if (!errNoted) {
          errNoted = true
          window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'radar', msg: `⚡ strikes: ${e instanceof Error ? e.message : 'feed down'}` } }))
        }
      }
    }
    poll()
    const id = setInterval(() => { if (document.visibilityState === 'visible') poll() }, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [mapReady, radarOn, pbActive])

  // Temperature / feels-like / wind / lightning FOLLOW THE SCRUBBER too
  // (Brian, Aug 10): RTMA publishes hourly analyses and nowcoast retains
  // roughly the last day, so within that window a replay shows the ACTUAL
  // hour's shading via WMS TIME= — floored to the hour, so sweeping a day is
  // at most 24 cheap tile swaps (same pattern as radar, $0 NOAA service).
  // Older scrub positions fall back to the latest frame with a one-time note
  // on the layer row — honest, never silently wrong.
  const RTMA_ARCHIVE_MS = 24 * 3_600_000
  const scrubWxMs = pbActive && realWindowEff
    ? realWindowEff.from + displayT * (realWindowEff.to - realWindowEff.from)
    : null
  // Clamp to now — the scrubber opens at the window END (a future midnight),
  // and an unclamped TIME= asked nowcoast for tomorrow's analysis (same
  // future-frame class the radar clamp fixed, ship-check Aug 26).
  const scrubWxTs = scrubWxMs !== null && Date.now() - scrubWxMs <= RTMA_ARCHIVE_MS
    ? new Date(Math.floor(Math.min(scrubWxMs, Date.now()) / 3_600_000) * 3_600_000).toISOString()
    : null
  const wxOutOfRange = scrubWxMs !== null && scrubWxTs === null
  const rtmaHistoryNoted = useRef(false)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    for (const key of RTMA_KEYS) {
      if (!overlaysOn[key]) continue
      const src = m.getSource(`ovl-${key}`) as maplibregl.RasterTileSource | undefined
      if (!src || typeof src.setTiles !== 'function') continue
      const def = MAP_OVERLAYS.find((o) => o.key === key)
      if (!def) continue
      let tiles = def.tiles
      const real = rtmaNames?.[key as 'temp' | 'feels' | 'wind' | 'lightning']
      if (real) tiles = tiles.replace(/LAYERS=[^&]+/, `LAYERS=${encodeURIComponent(real)}`)
      src.setTiles([scrubWxTs ? `${tiles}&TIME=${encodeURIComponent(scrubWxTs)}` : tiles])
    }
    if (wxOutOfRange && !rtmaHistoryNoted.current && RTMA_KEYS.some((k) => overlaysOn[k])) {
      rtmaHistoryNoted.current = true
      for (const k of RTMA_KEYS) {
        if (overlaysOn[k]) {
          window.dispatchEvent(new CustomEvent('ht:layer-error', {
            detail: { key: k, msg: 'NOAA keeps ~1 day of history — older replays show the latest analysis' },
          }))
        }
      }
    }
  }, [mapReady, scrubWxTs, wxOutOfRange, overlaysOn, rtmaNames])

  // ── One SURFACE weather layer at a time (Brian, Aug 10): temp, feels-like,
  // wind speed, rain totals, lightning, clouds, and storm tops all paint the
  // whole ground/sky — stacked they're mud. Turning one on switches the rest
  // of the set off. Radar, the wind-flow particles, and storm-warning
  // polygons stay stackable on top.
  type SoloWeatherKey = 'clouds' | 'stormtops' | 'precip' | 'temp' | 'feels' | 'wind' | 'lightning'
  const soloWeather = useCallback((key: SoloWeatherKey) => {
    setCloudsOn(key === 'clouds')
    setStormTopsOn(key === 'stormtops')
    setPrecipOn(key === 'precip')
    setOverlaysOn((prev) => ({
      ...prev,
      temp: key === 'temp', feels: key === 'feels', wind: key === 'wind', lightning: key === 'lightning',
    }))
  }, [])

  // Satellite clouds — coarse (max native zoom 7) but the real sky.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    if (!cloudsOn) {
      if (cloudsAdded.current && m.getLayer('clouds-layer')) m.setLayoutProperty('clouds-layer', 'visibility', 'none')
      return
    }
    // Live-only layer: during a replay don't fetch/add at all — and because
    // pbActive is a dep, LEAVING the replay re-runs this effect so a toggle
    // flipped mid-replay finally appears (ship-check P2: it used to stay
    // invisible until the 10-min interval fired).
    if (pbActive) return
    // GOES publishes ~every 10 min; re-resolve the newest REAL frame on the
    // same cadence so the sky stays current — day where it's day, night where
    // it's night — instead of a frozen screenshot of the layer's first load.
    let gone = false
    const apply = async () => {
      const stamp = await goesLatestStamp('GOES-East_ABI_GeoColor', 7)
      // pbActiveRef: never re-show live imagery under a historical scrubber —
      // the hide in the live-only effect below ran while this fetch was out.
      if (gone || !map.current || pbActiveRef.current) return
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
        // fade 0: first-show raster with the default cross-fade hits tiles
        // whose textures aren't attached yet → "reading 'bind'" (task #13).
        m.addLayer({ id: 'clouds-layer', type: 'raster', source: 'clouds', paint: { 'raster-opacity': 0.6, 'raster-fade-duration': 0 } }, beforeId)
        cloudsAdded.current = true
      } else if (m.getLayer('clouds-layer')) {
        m.setLayoutProperty('clouds-layer', 'visibility', 'visible')
        ;(m.getSource('clouds') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
      }
    }
    apply()
    const id = setInterval(apply, 600_000)
    return () => { gone = true; clearInterval(id) }
  }, [mapReady, cloudsOn, pbActive])

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
    // Same replay guard + re-run-on-Live as clouds (ship-check P2).
    if (pbActive) return
    let gone = false
    const apply = async () => {
      const stamp = await goesLatestStamp('GOES-East_ABI_Band13_Clean_Infrared', 6)
      // pbActiveRef: same replay guard as clouds — the fetch may outlive Live.
      if (gone || !map.current || pbActiveRef.current) return
      const tileUrl = goesTileUrl('GOES-East_ABI_Band13_Clean_Infrared', 6, stamp)
      if (!stormAdded.current) {
        m.addSource('stormtops', { type: 'raster', tiles: [tileUrl], tileSize: 256, maxzoom: 6, attribution: 'NASA GIBS · NOAA GOES-East' })
        const beforeId = m.getLayer('labels-overlay') ? 'labels-overlay'
          : m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
        // 0.45: the IR enhancement paints EVERY cold cloud top, and at 0.62 it
        // read as rainbow soup smeared over half the country (owner, Jul 14).
        // fade 0 per task #13 (first-show raster texture race).
        m.addLayer({ id: 'stormtops-layer', type: 'raster', source: 'stormtops', paint: { 'raster-opacity': 0.45, 'raster-fade-duration': 0 } }, beforeId)
        stormAdded.current = true
      } else if (m.getLayer('stormtops-layer')) {
        m.setLayoutProperty('stormtops-layer', 'visibility', 'visible')
        ;(m.getSource('stormtops') as maplibregl.RasterTileSource | undefined)?.setTiles([tileUrl])
      }
    }
    apply()
    const id = setInterval(apply, 600_000)
    return () => { gone = true; clearInterval(id) }
  }, [mapReady, stormTopsOn, pbActive])

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
      // fade 0 per task #13 (first-show raster texture race).
      m.addLayer({ id: 'precip-layer', type: 'raster', source: 'precip', paint: { 'raster-opacity': overlayOpacity.precip ?? 0.45, 'raster-fade-duration': 0 } }, beforeId)
      precipAdded.current = true
    } else if (m.getLayer('precip-layer')) {
      m.setLayoutProperty('precip-layer', 'visibility', 'visible')
      ;(m.getSource('precip') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
    }
  }, [mapReady, precipOn, precipPeriod])

  // ── Historical imagery — Esri World Imagery Wayback (Brian, Aug 22:
  // "open-source historical imagery with a year slider"). Free public WMTS
  // archive of the satellite basemap back to 2014; we surface the newest
  // release of each YEAR and a slider picks the year. Static imagery — it
  // never animates on its own, so the timeline-truth rule is satisfied.
  const waybackOn = !!overlaysOn.wayback
  const [waybackReleases, setWaybackReleases] = useState<{ num: number; year: number; label: string; tileUrl?: string }[]>([])
  const [waybackIdx, setWaybackIdx] = useState(0)
  useEffect(() => {
    if (!waybackOn || waybackReleases.length) return
    let gone = false
    ;(async () => {
      try {
        // The same public config the official Wayback app reads (CORS-open).
        const r = await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json')
        const cfg = await r.json() as Record<string, { itemTitle?: string }>
        const byYear = new Map<number, { num: number; year: number; label: string }>()
        for (const [k, v] of Object.entries(cfg)) {
          const dm = /(\d{4})-(\d{2})-(\d{2})/.exec(v?.itemTitle ?? '')
          if (!dm) continue
          const year = Number(dm[1])
          const itemUrl = (v as { itemURL?: string })?.itemURL
          const cand = {
            num: Number(k), year, label: dm[0],
            tileUrl: typeof itemUrl === 'string' && itemUrl.includes('{level}/{row}/{col}')
              ? itemUrl.replace('{level}/{row}/{col}', '{z}/{y}/{x}')
              : undefined,
          }
          const cur = byYear.get(year)
          if (!cur || cand.label > cur.label) byYear.set(year, cand) // newest snapshot of each year
        }
        const list = Array.from(byYear.values()).sort((a, b) => a.year - b.year)
        if (!list.length) throw new Error('empty wayback config')
        if (!gone) { setWaybackReleases(list); setWaybackIdx(list.length - 1) }
      } catch {
        if (!gone) window.dispatchEvent(new CustomEvent('ht:layer-error', { detail: { key: 'wayback', msg: 'couldn’t load the year list — toggle again to retry' } }))
      }
    })()
    return () => { gone = true }
  }, [waybackOn, waybackReleases.length])
  const waybackAdded = useRef(false)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const rel = waybackReleases.length ? waybackReleases[Math.min(waybackIdx, waybackReleases.length - 1)] : null
    if (!waybackOn || !rel) {
      if (waybackAdded.current && m.getLayer('wayback-layer')) m.setLayoutProperty('wayback-layer', 'visibility', 'none')
      return
    }
    // Prefer the config's own tile template (each release ships one) — the
    // hand-built lowercase path worked but rode on CDN case-insensitivity.
    const url = rel.tileUrl
      ?? `https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/${rel.num}/{z}/{y}/{x}`
    if (!waybackAdded.current) {
      m.addSource('wayback', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 19, attribution: 'Esri Wayback' })
      const beforeId = m.getLayer('geofence-fill') ? 'geofence-fill' : undefined
      // fade 0 + visibility-before-setTiles, per the task #13 raster rules.
      // 0.6 default matches the slider's display default — they disagreed.
      m.addLayer({ id: 'wayback-layer', type: 'raster', source: 'wayback', paint: { 'raster-opacity': overlayOpacity.wayback ?? 0.6, 'raster-fade-duration': 0 } }, beforeId)
      waybackAdded.current = true
      lastWaybackRel.current = rel.num
    } else if (m.getLayer('wayback-layer')) {
      m.setLayoutProperty('wayback-layer', 'visibility', 'visible')
      // Only re-tile when the YEAR actually changed — the opacity slider
      // shares state with this effect and a full source reload per input
      // tick flickered the whole layer (ship-check P2).
      if (lastWaybackRel.current !== rel.num) {
        lastWaybackRel.current = rel.num
        ;(m.getSource('wayback') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
      }
    }
    window.dispatchEvent(new CustomEvent('ht:layer-updated', { detail: { key: 'wayback', at: Date.now() } }))
  }, [mapReady, waybackOn, waybackReleases, waybackIdx])
  const lastWaybackRel = useRef<number | null>(null)
  // Opacity rides its own cheap paint-only effect.
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m || !m.getLayer('wayback-layer')) return
    m.setPaintProperty('wayback-layer', 'raster-opacity', overlayOpacity.wayback ?? 0.6)
  }, [mapReady, overlayOpacity.wayback])

  // ── Live-only weather never paints under a historical scrubber (Brian,
  // Aug 10): current warnings / clouds / storm tops / rain-totals over
  // yesterday's trucks read as data from that day. Declared AFTER every
  // weather effect so it wins within the same render — toggling one of
  // these mid-replay re-hides it immediately; leaving replay restores each
  // per its own switch. (Radar + temp/feels/wind/lightning follow the
  // scrubber and stay; the wind-flow particles already self-gate to Live.)
  useEffect(() => {
    const m = map.current
    if (!mapReady || !m) return
    const show = (id: string, on: boolean) => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on && !pbActive ? 'visible' : 'none')
    }
    show('clouds-layer', cloudsOn)
    show('stormtops-layer', stormTopsOn)
    show('precip-layer', precipOn)
    show('nws-fill', !!overlaysOn.nwswarn)
    show('nws-line', !!overlaysOn.nwswarn)
    show('spc-watch-line', !!overlaysOn.nwswarn)
  }, [mapReady, pbActive, cloudsOn, stormTopsOn, precipOn, overlaysOn])

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

  // Picking a range parks the playhead at the END (t=1): the finished
  // picture — full trails painted, every asset at its last position in the
  // window ("show the last point in that time spread", Brian, Aug 11,
  // reversing the day-old snap-to-first-movement default). The skip-the-
  // empty-night trick lives on the PLAY button instead: pressing play from
  // the end starts at the day's first movement, not midnight.
  const handleRange = useCallback((r: TimeRange) => {
    setRange(r)
    if (r === 'live') {
      setPbPlaying(false)
    } else {
      // Show the FULL trail for the range immediately (t=1) while history
      // loads. (Auto-playing from t=0 made the trail look empty — "no truck".)
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
      if (!p && tRef.current >= 1) { const s = Math.max(0, firstMoveTRef.current - 0.01); tRef.current = s; setPbT(s) }
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
  // Briefing card shown while the flyover dwells at a site zone (Aug 12):
  // name + today's burn + the next bad pour day. (Data refs live up by the
  // burn/pourcast effects, which keep them fresh whenever those layers run.)
  const [flyCard, setFlyCard] = useState<{ name: string; burn?: string; pour?: string } | null>(null)
  const [flySpeed, setFlySpeed] = useState(1)
  const flySpeedRef = useRef(1)
  flySpeedRef.current = flySpeed
  const flyRaf = useRef(0)
  const stopFlyover = useCallback(() => {
    cancelAnimationFrame(flyRaf.current)
    flyingRef.current = false
    setFlying(false)
    setFlyCard(null)
    map.current?.easeTo({ pitch: threeDRef.current || terrain3dRef.current ? 55 : 0, duration: 600 })
  }, [])
  stopFlyoverRef.current = stopFlyover
  const handleFlyover = useCallback(() => {
    const m = map.current
    if (!m) return
    if (flyingRef.current) { stopFlyover(); return }
    stopSpin()
    if (followIdRef.current) handleFollowRef.current(null)
    const pts: { lng: number; lat: number; zone?: { id: string; name: string } }[] = assetsRef.current
      .filter((a) => a.location)
      .map((a) => ({ lng: a.location!.lng, lat: a.location!.lat }))
    // Site zones join the flight plan — the dwell there shows a briefing card.
    for (const g of geofencesRef.current ?? []) {
      if (fenceKind(g) !== 'site') continue
      const ring = g.geometry.coordinates[0] as number[][]
      if (!ring?.length) continue
      pts.push({
        lng: ring.reduce((s, p) => s + p[0], 0) / ring.length,
        lat: ring.reduce((s, p) => s + p[1], 0) / ring.length,
        zone: { id: g.id, name: g.name },
      })
    }
    if (!pts.length) return
    // Top up the card data at takeoff (cheap, cached server-side) — the
    // flyover shouldn't depend on the burn/pourcast layers being toggled on.
    if (!isMock) {
      if (burnDataRef.current.size === 0) {
        fetch('/api/zone-burn').then((r) => (r.ok ? r.json() : null)).then((j: { zones?: { id: string; spentToday: number; hoursToday: number; rateCoverage: string }[] } | null) => {
          for (const z of j?.zones ?? []) burnDataRef.current.set(z.id, z)
        }).catch(() => { /* card just shows less */ })
      }
      if (pourDataRef.current.size === 0) {
        fetch('/api/zone-pourcast').then((r) => (r.ok ? r.json() : null)).then((j: { zones?: { id: string; days?: unknown[]; nextBad: { date: string; reason: string } | null }[] } | null) => {
          for (const z of j?.zones ?? []) { if (z.days?.length) pourDataRef.current.set(z.id, z.nextBad) }
        }).catch(() => { /* card just shows less */ })
      }
    }
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
      // Zone stop → briefing card; asset stop → clear it.
      if (p.zone) {
        const b = burnDataRef.current.get(p.zone.id)
        const nb = pourDataRef.current.get(p.zone.id)
        setFlyCard({
          name: p.zone.name,
          burn: b ? (b.rateCoverage === 'none' ? undefined : `$${Math.round(b.spentToday).toLocaleString()} today · ${b.hoursToday.toFixed(1)} h`) : undefined,
          pour: nb ? `next bad day: ${new Date(nb.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })} (${nb.reason})` : nb === null ? '5 days clear' : undefined,
        })
      } else setFlyCard(null)
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
    camRef.current = null // fresh target — never glide in from the LAST followed asset
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
      camRef.current = null
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
  // Rail button → same behavior the Layers-panel button had: drawing from a
  // replay snaps back to Live first so clicks mean corners, not scrubbing.
  drawZoneRef.current = () => {
    if (rangeRef.current !== 'live') handleRange('live')
    startDrawing()
  }

  // ── Live deep links (UX sweep, Aug 17) ──────────────────────────────────
  // /map?follow=<assetId> and /map?follow=zone:<id> now work on LIVE view —
  // asset pages, maintenance rows, and zone pages can land users focused on
  // the thing they tapped (the old handler only honored `follow` inside a
  // shared-replay restore). /map?draw=1 opens with the zone-draw tool armed
  // (the "Draw Zone" buttons used to dump users on a bare map).
  const liveDeepLinkRef = useRef(false)
  useEffect(() => {
    if (!mapReady || kiosk || liveDeepLinkRef.current || typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const r = q.get('range')
    if (r && r !== 'live') return // replay restore path owns these params
    const follow = q.get('follow')
    const draw = q.get('draw')
    if (!follow && !draw) return
    liveDeepLinkRef.current = true
    const strip = () => {
      try {
        const u = new URL(window.location.href)
        u.searchParams.delete('follow'); u.searchParams.delete('draw')
        const qs = u.searchParams.toString()
        window.history.replaceState(null, '', u.pathname + (qs ? '?' + qs : ''))
      } catch { /* harmless */ }
    }
    if (draw === '1') { strip(); startDrawing(); return }
    if (!follow) return
    // Shell-first boot: assets/zones stream in after mount — poll briefly.
    // The chain cancels on unmount (ship-check: it outlived the map).
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    let gone = false
    const attempt = () => {
      if (gone) return
      if (follow.startsWith('zone:')) {
        const fence = geofencesRef.current.find((g) => g.id === follow.slice(5))
        if (fence) {
          const ring = fence.geometry?.coordinates?.[0] as [number, number][] | undefined
          if (ring?.length) {
            let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
            for (const [lng, lat] of ring) { a = Math.min(a, lng); b = Math.min(b, lat); c = Math.max(c, lng); d = Math.max(d, lat) }
            map.current?.fitBounds([[a, b], [c, d]], { padding: 90, maxZoom: 17.5, duration: 1200 })
          }
          setSelectedZone(fence)
          strip()
          return
        }
      } else {
        const a = assetsRef.current.find((x) => x.id === follow)
        if (a?.location) {
          setSelectedAsset(a)
          map.current?.flyTo({ center: [a.location.lng, a.location.lat], zoom: 16, duration: 1400 })
          strip()
          return
        }
      }
      if (Date.now() - started < 15_000) timer = setTimeout(attempt, 500)
      else strip() // never arrived — stop trying, leave the map usable
    }
    attempt()
    return () => { gone = true; if (timer) clearTimeout(timer) }
  }, [mapReady, kiosk, startDrawing])

  /** Drop (or clear) the amber marker on an address searched while drawing.
   *  Declared BEFORE the draw callbacks that list it as a dependency — a
   *  dependency array is evaluated during render, so a `const` defined further
   *  down is still in its temporal dead zone and throws. */
  const setSearchPin = useCallback((lng: number, lat: number, label: string) => {
    const src = map.current?.getSource('draw-search-pin') as maplibregl.GeoJSONSource | undefined
    src?.setData(lng === 0 && lat === 0 && !label
      ? { type: 'FeatureCollection', features: [] }
      : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { label }, geometry: { type: 'Point', coordinates: [lng, lat] } }] })
  }, [])
  const clearSearchPin = useCallback(() => setSearchPin(0, 0, ''), [setSearchPin])

  const finishDrawing = useCallback((): GeoJSON.Polygon | null => {
    if (!map.current) return null
    map.current.off('click', handleDrawClick)
    map.current.getCanvas().style.cursor = ''
    setIsDrawing(false)
    const pts = drawCoords.current
    drawCoords.current = []
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
    clearSearchPin()
    if (pts.length < 3) return null
    return { type: 'Polygon', coordinates: [[...pts, pts[0]]] }
  }, [handleDrawClick, clearSearchPin])

  const cancelDrawing = useCallback(() => {
    if (!map.current) return
    map.current.off('click', handleDrawClick)
    map.current.getCanvas().style.cursor = ''
    drawCoords.current = []
    setIsDrawing(false)
    const src = map.current.getSource(drawPreviewSource.current) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
    clearSearchPin()
  }, [handleDrawClick, clearSearchPin])

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

      {/* Radar frame-time chip — opt-in slide-out beside the radar button
          (swipe the button left to open, right to tuck away; tap chip =
          pause/resume, swipe chip right = tuck). LIVE loop only: in replay
          the radar follows the scrubber and the timeline is the clock. */}
      {/* Flyover briefing card — shows while the tour dwells at a site zone:
          the morning-briefing numbers, delivered from the cockpit (Aug 12). */}
      {flying && flyCard && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 ht-toast-in rounded-xl bg-navy-950/90 backdrop-blur border border-navy-700 shadow-panel px-4 py-2.5 text-center pointer-events-none max-w-[86vw]">
          <p className="font-display font-bold text-[14px] text-ink truncate">{flyCard.name}</p>
          {flyCard.burn && <p className="font-mono text-[11.5px] text-amber tabular-nums">{flyCard.burn}</p>}
          {flyCard.pour && <p className="font-mono text-[10.5px] text-faint">{flyCard.pour}</p>}
        </div>
      )}
      {/* Radar slide-out (Brian, Aug 22): the pull-handle chevron makes the
          drawer OBVIOUS (it only exists while radar is on), the chip slides
          smoothly both ways (max-width transition — stays mounted), and the
          frame bar is a real scrubber you drag by hand (dragging pauses the
          loop; manual pause wins, per the timeline rule). Hidden in replays —
          there the radar follows the main timeline scrubber. */}
      {radarOn && !pbActive && radarChipPos && (
        // z-[12]: above the map, BELOW the layers drawer (30) and sheets (20) —
        // at z-20 the chip printed straight across the open Views tab
        // (Brian's 2:07 AM screenshot, "Site planning has some issues").
        <div className="absolute z-[12] flex items-center" style={{ top: radarChipPos.top, right: radarChipPos.right }}>
          <div
            className={'overflow-hidden transition-[max-width,opacity] duration-300 ease-out ' +
              (radarChipOpen ? 'max-w-[320px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none')}
          >
            <div
              onPointerDown={(e) => { radarSwipeRef.current = { x: e.clientX, y: e.clientY }; radarSwipedRef.current = false }}
              onPointerMove={(e) => {
                const s = radarSwipeRef.current
                if (!s || radarSwipedRef.current) return
                const dx = e.clientX - s.x
                if (dx > 24) { radarSwipedRef.current = true; setChipOpen(false) }
              }}
              onPointerUp={() => { radarSwipeRef.current = null }}
              className="flex items-center gap-2 rounded-lg border border-amber/40 bg-navy-950/90 backdrop-blur px-2.5 h-[29px] shadow-panel touch-none mr-1 whitespace-nowrap"
            >
              <button
                type="button"
                onClick={() => { if (radarSwipedRef.current) { radarSwipedRef.current = false; return } setRadarPaused((p) => !p) }}
                aria-label={radarPaused ? 'Resume radar loop' : 'Pause radar loop'}
                className="flex items-center gap-2"
              >
                <span className="font-mono text-[10px] font-bold text-amber tracking-wide">RADAR</span>
                <span className="font-mono text-[11px] text-ink tabular-nums whitespace-nowrap">{radarLabel ?? 'loading…'}</span>
                <span className="text-[10px] text-muted leading-none">{radarPaused ? '▶' : '❚❚'}</span>
              </button>
              {radarFrames.length > 1 && (
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    radarScrubbing.current = true
                    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* older webviews */ }
                    scrubRadarTo(e.clientX, e.currentTarget)
                  }}
                  onPointerMove={(e) => { if (radarScrubbing.current) scrubRadarTo(e.clientX, e.currentTarget) }}
                  onPointerUp={() => { radarScrubbing.current = false }}
                  onPointerCancel={() => { radarScrubbing.current = false }}
                  role="slider"
                  aria-label="Radar frame"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0, radarFrames.length - 1)}
                  aria-valuenow={Math.min(radarIdx, radarFrames.length - 1)}
                  className="relative flex items-center h-6 w-16 cursor-ew-resize touch-none flex-none"
                >
                  <span className="relative h-[4px] w-full rounded-full bg-navy-700 overflow-hidden pointer-events-none">
                    <span
                      className="absolute left-0 top-0 h-full bg-amber"
                      style={{ width: `${(Math.min(radarIdx, radarFrames.length - 1) / (radarFrames.length - 1)) * 100}%` }}
                    />
                  </span>
                  <span
                    className="absolute w-2.5 h-2.5 rounded-full bg-amber border border-[#1a1100]/40 pointer-events-none -translate-x-1/2"
                    style={{ left: `${(Math.min(radarIdx, radarFrames.length - 1) / (radarFrames.length - 1)) * 100}%` }}
                  />
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setChipOpen(!radarChipOpen)}
            aria-label={radarChipOpen ? 'Tuck the radar timeline away' : 'Pull out the radar timeline'}
            aria-expanded={radarChipOpen}
            className="grid place-items-center w-5 h-[29px] rounded-md border border-amber/40 bg-navy-950/90 backdrop-blur text-amber shadow-panel flex-none"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={'transition-transform duration-300 ' + (radarChipOpen ? 'rotate-180' : '')}>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        </div>
      )}

      {/* Right-rail tuck handle — slides the button column off for a clean
          screen; the tab stays on the edge to bring it back. */}
      <button
        type="button"
        onPointerDown={(e) => {
          railTraySwipe.current = { x: e.clientX }
          railTraySwiped.current = false
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* older webviews */ }
        }}
        onPointerMove={(e) => {
          const st = railTraySwipe.current
          if (!st || railTraySwiped.current) return
          const dx = e.clientX - st.x
          if (dx < -24) { railTraySwiped.current = true; setRailHidden(false) }
          else if (dx > 24) { railTraySwiped.current = true; setRailHidden(true) }
        }}
        onPointerUp={() => { railTraySwipe.current = null }}
        onClick={() => {
          if (railTraySwiped.current) { railTraySwiped.current = false; return }
          setRailHidden((h) => !h)
        }}
        aria-label={railHidden ? 'Show map tools' : 'Hide map tools'}
        // Straight across from the LAYERS tab; slides with the pullout so
        // the name travels with the tools it opens (Brian, Aug 24). Hidden
        // until the column is measured — at right:0 pre-measure it would sit
        // ON the live buttons for the slow-tile seconds before map load and
        // eat a geolocate/measure tap (ship-check).
        style={{
          top: '44%',
          right: railHidden ? 0 : (railTabOffset ?? 0),
          visibility: railTabOffset == null && !railHidden ? 'hidden' : undefined,
          transition: 'right .25s ease, color .15s ease',
        }}
        className="absolute z-20 flex flex-col items-center gap-1.5 rounded-l-lg bg-navy-950/80 backdrop-blur border border-navy-700 py-2.5 px-1 text-faint hover:text-ink touch-none"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {railHidden ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
        </svg>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-teal" style={{ writingMode: 'vertical-rl' }}>Map tools</span>
      </button>

      {/* LEFT tray handle — the layers entry on /map AND /command (Brian,
          Aug 22: "update command center to match"): tap or swipe-right opens
          the same half-width drawer everywhere. */}
      <button
        type="button"
        data-tour="layers"
        onPointerDown={(e) => {
          leftTraySwipe.current = { x: e.clientX }
          leftTraySwiped.current = false
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* older webviews */ }
        }}
        onPointerMove={(e) => {
          const st = leftTraySwipe.current
          if (!st || leftTraySwiped.current) return
          const dx = e.clientX - st.x
          if (dx > 24) {
            leftTraySwiped.current = true
            try { window.dispatchEvent(new CustomEvent('ht:open-layers')) } catch { /* SSR */ }
          }
        }}
        onPointerUp={() => { leftTraySwipe.current = null }}
        onClick={() => {
          if (leftTraySwiped.current) { leftTraySwiped.current = false; return }
          try { window.dispatchEvent(new CustomEvent('ht:open-layers')) } catch { /* SSR */ }
        }}
        aria-label="Open map layers"
        // Kiosk: the desktop CommandRail (z-40) spans past 44% — the handle
        // must ride above it or only a sliver stays clickable (ship-check).
        className={`absolute left-0 top-[44%] ${kiosk ? 'z-[41]' : 'z-20'} flex flex-col items-center gap-1.5 rounded-r-lg bg-navy-950/80 backdrop-blur border border-navy-700 border-l-0 py-2.5 px-1 text-faint hover:text-ink transition-colors touch-none`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
        {/* Same tray-tab language as TIMELINE at the bottom (Brian, Aug 22:
            "left, right and timeline… feel similar"): teal mono label. */}
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-teal" style={{ writingMode: 'vertical-rl' }}>Layers</span>
      </button>

      {/* Search box: top-center overlay, opened from the rail's search
          button (AskAI lives in the bottom nav / the widget's desktop
          floater; Layers opens from the left tray handle). */}
      {!kiosk && (
        <MapSearch
          overlay
          items={searchItems}
          onPick={pickSearchItem}
          bias={assets.find((a) => a.location)?.location ?? null}
          onPickPlace={(p) => map.current?.flyTo({ center: [p.lng, p.lat], zoom: 16, duration: 1400 })}
        />
      )}

      {/* Measure toggle lives in the MapLibre control cluster (added at map
          init) — same size + column as zoom/locate/fit, below Zoom-to-all. */}
      {!kiosk && (
        <MeasureTool
          map={mapReady ? map.current : null}
          active={measureOn}
          terrainOn={terrain3d}
          initial={measureInitial ?? measureSeed}
          onClose={() => { setMeasureOn(false); setEditingMeasure(null); setMeasureSeed(null) }}
          onSaved={(saved) => {
            if (!saved) return
            setMeasures((prev) => {
              const i = prev.findIndex((x) => x.id === saved.id)
              const row = { ...saved, created_at: i >= 0 ? prev[i].created_at : new Date().toISOString() }
              return i >= 0 ? prev.map((x, ix) => (ix === i ? row : x)) : [row, ...prev]
            })
            setSelectedMeasure(null)
            setEditingMeasure(null)
            // Saving flips the layer ON — the shape stays visible instead of
            // vanishing until the next /measurements visit (Brian, Aug 17).
            setOverlaysOn((prev) => (prev.measures ? prev : { ...prev, measures: true }))
          }}
        />
      )}

      {/* First-run walkthrough of the controls (skippable, once per device;
          relaunch from Getting Started or /map?tour=1) */}
      {/* canDrawZones: the public /live demo mounts MapView without
          onGeofenceSave — the tour must not point at a button that isn't
          there (truth-check, Aug 22). */}
      {!kiosk && <MapTour canDrawZones={!!onGeofenceSave} />}

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
              {/* Both heat modes are dwell-weighted: color = time spent on
                  the spot, so a drive-by can't outrank a workday. */}
              <p className="font-mono text-[9px] uppercase tracking-wide text-faint mb-1">Activity · time on the spot</p>
              <div className="h-2.5 rounded-sm" style={{ background: 'linear-gradient(90deg,#14506f,#2dd4bf,#ff9e16,#ff5d5d)' }} />
              <div className="flex justify-between font-mono text-[8.5px] text-faint mt-0.5">
                <span>drove by</span>
                <span>worked</span>
                <span>all day</span>
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
        terrainExag={terrainExag}
        onTerrainExag={setTerrainExag}
        radarOn={radarOn}
        radarPaused={radarPaused}
        onRadarPause={setRadarPaused}
        stormTopsOn={stormTopsOn}
        onStormTops={(v) => (v ? soloWeather('stormtops') : setStormTopsOn(false))}
        onRadar={setRadarOn}
        cloudsOn={cloudsOn}
        onClouds={(v) => (v ? soloWeather('clouds') : setCloudsOn(false))}
        precipOn={precipOn}
        onPrecip={(v) => (v ? soloWeather('precip') : setPrecipOn(false))}
        precipPeriod={precipPeriod}
        onPrecipPeriod={setPrecipPeriod}
        frameTime={radarLabel}
        parcelsOn={parcelsOn}
        onParcels={PARCEL_SERVICE_URL ? setParcelsOn : undefined}
        overlays={['nwswarn', 'gauges', 'pwsnet', 'daynight', 'windanim', 'alertpins', 'fieldops', 'webcams', 'satellites', 'satswarm', 'planes', 'airspace3d', 'siteimg', 'siteplans', 'burnmap', 'idledollars', 'nightwatch', 'closures', 'pourcast', 'measures', 'wayback', ...MAP_OVERLAYS.map((o) => o.key)]
          .map((key) => ({ key, on: !!overlaysOn[key] }))}
        onOverlay={(key, on) => {
          // Surface shadings are one-at-a-time; everything else stacks.
          if (on && (key === 'temp' || key === 'feels' || key === 'wind' || key === 'lightning')) soloWeather(key)
          else setOverlaysOn((prev) => ({ ...prev, [key]: on }))
        }}
        showLabels={showLabels}
        onShowLabels={setShowLabels}
        zoom={mapZoom}
        overlayOpacity={overlayOpacity}
        onOverlayOpacity={(key, v) => setOverlayOpacity((prev) => ({ ...prev, [key]: v }))}
        onResetLayers={resetLayers}
        views={allViews(mapViews)}
        activeViewId={activeViewId}
        defaultViewId={mapViews.defaultId}
        onApplyView={(id) => { const v = allViews(mapViews).find((x) => x.id === id); if (v) applyView(v) }}
        onSaveView={handleSaveView}
        onUpdateView={handleUpdateView}
        onDeleteView={handleDeleteView}
        onSetDefaultView={handleDefaultView}
        side="left"
        top={kiosk ? 68 : 12}
        z={kiosk ? 45 : 30}
        sunMode={sunMode}
        onSunMode={setSunMode}
        hidden={false}
        hidePill
        // Fleet on/off is BACK inside Layers, first section (Brian, Aug 22
        // 2:38 AM — the chips-on-map experiment lost; the panel opens as a
        // Google-style left drawer now, so the toggles are one tap away).
        filter={filter}
        onFilter={setFilter}
        showZones={showZones}
        onShowZones={setShowZones}
        showDevices={showDevices}
        onToggleDevices={isMock ? () => setShowDevices((v) => !v) : undefined}
        waybackYears={waybackReleases.map((r) => String(r.year))}
        waybackIdx={waybackIdx}
        onWaybackIdx={setWaybackIdx}
      />


      {!kiosk && (
        <GeofenceDrawer
          isDrawing={isDrawing}
          onFinishDraw={finishDrawing}
          onCancelDraw={cancelDrawing}
          onSave={onGeofenceSave}
          zones={geofences.map((g) => ({ id: g.id, name: g.name }))}
          onLocate={(lng, lat, label) => {
            setSearchPin(lng, lat, label)
            map.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 1100 })
          }}
        />
      )}

      {tracksEff.length > 0 && (
        <TimelinePlayback
          range={range}
          onRange={handleRange}
          loading={historyLoadingKey !== null}
          tz={tz}
          kiosk={kiosk}
          trailMode={trailMode}
          onTrailMode={setTrailMode}
          markerStyle={markerStyle}
          onMarkerStyle={setMarkerStyle}
          speedTrails={speedTrails}
          onSpeedTrails={toggleSpeedTrails}
          heat3dUnits={heat3dUnits}
          onHeat3dUnits={pickHeat3dUnits}
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

      {/* Saved-measurement sheet — tap a shape on the Measurements layer */}
      {selectedMeasure && !measureOn && (
        <div className="absolute left-2 right-2 bottom-24 md:left-3 md:right-auto md:bottom-28 md:w-[300px] z-30 rounded-xl bg-navy-950/97 backdrop-blur border border-navy-700 shadow-panel p-3 space-y-2">
          <div className="flex items-start gap-2">
            {measureRename != null ? (
              <input
                value={measureRename}
                onChange={(e) => setMeasureRename(e.target.value)}
                autoFocus
                className="flex-1 min-w-0 bg-navy-900 border border-navy-700 rounded-md text-[12.5px] text-ink px-2 py-1 outline-none focus:border-amber/50"
              />
            ) : (
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold text-[13.5px] text-ink truncate">{selectedMeasure.name}</p>
                <p className="font-mono text-[11px] text-amber tabular-nums">{measureSummary(selectedMeasure.kind, selectedMeasure.props)}</p>
              </div>
            )}
            <button onClick={() => { setSelectedMeasure(null); setMeasureRename(null) }} className="text-faint hover:text-ink text-[16px] leading-none px-1 flex-none" aria-label="Close">✕</button>
          </div>
          {selectedMeasure.props.takeoff && measureRename == null && (
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md bg-amber/10 text-amber font-display font-bold text-[12.5px] px-2 py-0.5 tabular-nums">{Math.round(selectedMeasure.props.takeoff.tons)} tons</span>
              <span className="rounded-md bg-teal/10 text-teal font-display font-bold text-[12.5px] px-2 py-0.5 tabular-nums">{Math.round(selectedMeasure.props.takeoff.cubicYd)} CY</span>
              <span className="rounded-md bg-navy-900 text-faint text-[11px] px-2 py-1">{selectedMeasure.props.takeoff.material}</span>
            </div>
          )}
          {measureRename != null ? (
            <div className="flex gap-1.5">
              <button
                onClick={async () => {
                  const nm = (measureRename ?? '').trim() || 'Measurement'
                  const r = await updateMeasurementAction(selectedMeasure.id, { name: nm })
                  if (!r.ok) { toast(r.error ?? 'Rename failed.', { variant: 'error' }); return }
                  setMeasures((prev) => prev.map((x) => (x.id === selectedMeasure.id ? { ...x, name: nm } : x)))
                  setSelectedMeasure((cur) => (cur ? { ...cur, name: nm } : cur))
                  setMeasureRename(null)
                }}
                className="flex-1 rounded-md bg-amber text-[#1a1100] font-display font-bold text-[11.5px] py-1.5"
              >Save name</button>
              <button onClick={() => setMeasureRename(null)} className="flex-1 rounded-md border border-navy-700 text-faint hover:text-ink text-[11.5px] py-1.5">Cancel</button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => {
                  const m2 = map.current
                  if (!m2) return
                  const g = selectedMeasure.geometry
                  const cs: [number, number][] = g.type === 'Point' ? [g.coordinates as [number, number]] : g.type === 'LineString' ? (g.coordinates as [number, number][]) : (g.coordinates[0] as [number, number][])
                  if (g.type === 'Point') { m2.flyTo({ center: cs[0], zoom: 17, duration: 900 }); return }
                  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
                  for (const [lng, lat] of cs) { a = Math.min(a, lng); b = Math.min(b, lat); c = Math.max(c, lng); d = Math.max(d, lat) }
                  m2.fitBounds([[a, b], [c, d]], { padding: 90, maxZoom: 18, duration: 900 })
                }}
                className="rounded-md border border-navy-700 text-ink text-[11px] font-semibold py-1.5 hover:bg-navy-900"
              >Zoom</button>
              <button
                onClick={() => { setEditingMeasure(selectedMeasure); setSelectedMeasure(null); setMeasureOn(true) }}
                className="rounded-md bg-amber/15 border border-amber/40 text-amber text-[11px] font-semibold py-1.5"
              >Edit</button>
              <button onClick={() => setMeasureRename(selectedMeasure.name)} className="rounded-md border border-navy-700 text-ink text-[11px] font-semibold py-1.5 hover:bg-navy-900">Rename</button>
              <button
                onClick={async () => {
                  const okGo = await confirmSheet({ title: 'Delete this measurement?', message: `“${selectedMeasure.name}” comes off the map for everyone it's shared with.`, confirmLabel: 'Delete', destructive: true })
                  if (!okGo) return
                  const r = await deleteMeasurementAction(selectedMeasure.id)
                  if (!r.ok) { toast(r.error ?? 'Delete failed.', { variant: 'error' }); return }
                  setMeasures((prev) => prev.filter((x) => x.id !== selectedMeasure.id))
                  setSelectedMeasure(null)
                }}
                className="rounded-md border border-alert/40 text-alert text-[11px] font-semibold py-1.5 hover:bg-alert/10"
              >Delete</button>
            </div>
          )}
        </div>
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
