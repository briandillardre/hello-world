/**
 * THE layer registry — single source of truth for the layers panel.
 * The panel renders from it; gating decisions all flow through rowState().
 * Layer ids are PERSISTED (saved views in localStorage + profiles.map_views)
 * — never rename one without a back-compat mapping.
 */

export type BasemapId = 'dark' | 'streets' | 'terrain' | 'satellite' | 'hybrid' | 'silver' | 'plain' | 'bw' | 'aubergine'
export type GroupId = 'site' | 'weather' | 'water' | 'basemap'

export interface LayerRowDef {
  /** Stable persisted key (overlays record / dedicated toggle). */
  id: string
  label: string
  group: GroupId
  status: 'live' | 'coming-soon'
  /** One-job hint shown under the row while it's on. Explains, doesn't sell. */
  hint?: string
  minZoom?: number
  maxZoom?: number
  /** Row text when outside the zoom range — visible, never a silent no-op. */
  zoomHint?: string
  /** Night effects only make sense on the dark basemap. */
  requiresBasemap?: BasemapId
  /** Row hides entirely until this parent layer id is on (e.g. the swarm
   *  only appears once Satellites is toggled on). */
  requiresLayer?: string
  /** Renders in the nested "Night effects" sub-group under Basemap. */
  nightFx?: boolean
  /** Raster overlays get an opacity slider while on. */
  hasOpacity?: boolean
  /** Feed-backed rows render an "updated h:mm" stamp (amber when stale). */
  isLive?: boolean
}

// Every group starts collapsed (owner ask, Jul 14) — the panel opens to the
// basics (find, show-on-map, weather summary) with the deep layers one tap in.
export const GROUPS: { id: GroupId; label: string; defaultCollapsed?: boolean }[] = [
  { id: 'site', label: 'Site', defaultCollapsed: true },
  { id: 'weather', label: 'Weather', defaultCollapsed: true },
  { id: 'water', label: 'Water & Terrain', defaultCollapsed: true },
  { id: 'basemap', label: 'Basemap', defaultCollapsed: true },
]

// Rendered as a thumbnail grid (FR24-style map-type picker, Brian's ask Jul 18).
// Thumb = a real tile of upstate SC from that source; cssFilter approximates
// the paint-property treatment for derived styles (B/W, Aubergine).
export const BASEMAPS: { id: BasemapId; label: string }[] = [
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'streets', label: 'Streets' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'dark', label: 'Dark' },
  { id: 'silver', label: 'Silver' },
  { id: 'plain', label: 'Plain' },
  { id: 'bw', label: 'B/W' },
  { id: 'aubergine', label: 'Aubergine' },
]

// One representative tile per source for the picker thumbnails (z8 tile over
// upstate SC — recognizable home turf, cached hard by the CDNs).
const THUMB = { z: 8, x: 69, y: 101 }
export const BASEMAP_TILE: Record<BasemapId, string> = {
  dark: `https://a.basemaps.cartocdn.com/rastertiles/dark_all/${THUMB.z}/${THUMB.x}/${THUMB.y}@2x.png`,
  streets: `https://a.basemaps.cartocdn.com/rastertiles/voyager/${THUMB.z}/${THUMB.x}/${THUMB.y}@2x.png`,
  terrain: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${THUMB.z}/${THUMB.y}/${THUMB.x}`,
  satellite: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${THUMB.z}/${THUMB.y}/${THUMB.x}`,
  hybrid: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${THUMB.z}/${THUMB.y}/${THUMB.x}`,
  silver: `https://a.basemaps.cartocdn.com/rastertiles/light_all/${THUMB.z}/${THUMB.x}/${THUMB.y}@2x.png`,
  plain: `https://a.basemaps.cartocdn.com/rastertiles/light_nolabels/${THUMB.z}/${THUMB.x}/${THUMB.y}@2x.png`,
  bw: `https://a.basemaps.cartocdn.com/rastertiles/light_all/${THUMB.z}/${THUMB.x}/${THUMB.y}@2x.png`,
  aubergine: `https://a.basemaps.cartocdn.com/rastertiles/voyager/${THUMB.z}/${THUMB.x}/${THUMB.y}@2x.png`,
}
/** CSS filter approximating the map paint treatment, for picker thumbs only. */
export const BASEMAP_THUMB_FILTER: Partial<Record<BasemapId, string>> = {
  bw: 'grayscale(1) contrast(1.25)',
  aubergine: 'hue-rotate(230deg) saturate(0.6) brightness(0.55)',
}

export const LAYER_ROWS: LayerRowDef[] = [
  // ── Site: context drawn around your assets ────────────────────────────────
  { id: 'zones', label: 'Zones', group: 'site', status: 'live', hint: 'job sites, yards & boundaries' },
  { id: 'alertpins', label: 'Alert pins', group: 'site', status: 'live', isLive: true, hint: 'where alerts fired · last 7 days · pinned to the zone involved' },
  { id: 'traffic', label: 'Traffic', group: 'site', status: process.env.NEXT_PUBLIC_TOMTOM_KEY ? 'live' : 'coming-soon', hasOpacity: true, hint: 'live congestion — green flows, red crawls' },
  { id: 'webcams', label: 'Webcams', group: 'site', status: 'live', isLive: true, minZoom: 8, zoomHint: 'Zoom in to see webcams', hint: 'public traffic & area cams · tap for the picture' },
  { id: 'parcels', label: 'Parcel lines', group: 'site', status: 'live', minZoom: 14, zoomHint: 'Zoom in to see parcel lines', hint: 'county tax parcels & numbers' },

  // ── Weather ───────────────────────────────────────────────────────────────
  { id: 'radar', label: 'Radar', group: 'weather', status: 'live', isLive: true, hasOpacity: true, hint: 'precipitation · loops on Live, scrubs with replays' },
  { id: 'clouds', label: 'Clouds', group: 'weather', status: 'live', hint: 'satellite cloud cover · ~10 min' },
  { id: 'stormtops', label: 'Storm tops (IR)', group: 'weather', status: 'live', hasOpacity: true, hint: 'rainbow cores = violent cells · gray = ordinary cloud · sharp box = satellite zoom sector' },
  { id: 'nwswarn', label: 'Storm warnings', group: 'weather', status: 'live', isLive: true, hint: 'warnings solid (tornado red · t-storm orange · flood green) · watch boxes dashed · tap a polygon' },
  { id: 'precip', label: 'Rain totals', group: 'weather', status: 'live', hint: 'accumulated rainfall — pick the period' },
  { id: 'temp', label: 'Temperature', group: 'weather', status: 'live', hasOpacity: true, hint: 'surface temp shading · hourly' },
  { id: 'feels', label: 'Feels like', group: 'weather', status: 'live', hasOpacity: true, hint: 'heat index / wind chill · hourly' },
  { id: 'wind', label: 'Wind speed', group: 'weather', status: 'live', hasOpacity: true, hint: 'sustained wind shading · hourly' },
  { id: 'windanim', label: 'Wind flow', group: 'weather', status: 'live', isLive: true, hint: 'animated wind — live view only' },
  { id: 'pwsnet', label: 'Weather stations', group: 'weather', status: 'live', isLive: true, minZoom: 8, zoomHint: 'Zoom in to see weather stations', hint: 'community stations · tap for readings' },
  // Layer name discovered live from NOAA's server (like temp/feels/wind) —
  // GOES lightning mapper strike density. Row reports if NOAA drops it.
  { id: 'lightning', label: 'Lightning', group: 'weather', status: 'live', hasOpacity: true, hint: 'GOES strike density · ~10 min' },

  // ── Water & Terrain ───────────────────────────────────────────────────────
  { id: 'streams', label: 'Streams', group: 'water', status: 'live', hasOpacity: true, hint: 'rivers & creeks (national hydrography)' },
  { id: 'gauges', label: 'Stream gauges', group: 'water', status: 'live', isLive: true, minZoom: 9, zoomHint: 'Zoom in to see stream gauges', hint: 'live gage height · tap a dot' },
  { id: 'flood', label: 'Flood zones', group: 'water', status: 'live', hasOpacity: true, minZoom: 10, zoomHint: 'Zoom in to see flood zones', hint: 'FEMA flood hazard areas' },
  { id: 'wetlands', label: 'Wetlands', group: 'water', status: 'live', hasOpacity: true, minZoom: 11, zoomHint: 'Zoom in to see wetlands', hint: 'national wetlands inventory' },
  { id: 'soils', label: 'Soils', group: 'water', status: 'live', hasOpacity: true, minZoom: 12, zoomHint: 'Zoom in to see soil units', hint: 'soil survey map units' },
  { id: 'topo', label: 'Topo lines', group: 'water', status: 'live', hasOpacity: true, minZoom: 12, zoomHint: 'Zoom in to see contours', hint: 'elevation contours' },

  // ── View extras (Basemap group, above Night effects) ──────────────────────
  { id: 'satellites', label: 'Satellites & sky (live)', group: 'basemap', status: 'live', isLive: true, hint: 'real orbits at TRUE altitude — plus the sun, moon (real phase), and stars in their actual positions · zoom way out' },
  { id: 'satswarm', label: '↳ 11k satellites', group: 'basemap', status: 'live', isLive: true, requiresLayer: 'satellites', hint: 'EVERY tracked satellite as an ambient field · heavier on older phones' },
  { id: 'planes', label: 'Aircraft (live)', group: 'basemap', status: 'live', isLive: true, hint: 'live air traffic near your view at true altitude · tilt the map to see them overhead · tap one for flight details' },

  // ── Night effects (nested under Basemap) ──────────────────────────────────
  { id: 'daynight', label: 'Day / night (real)', group: 'basemap', nightFx: true, status: 'live', hint: 'your basemap in daylight, dusk fading to dark, real cities glowing on the night side — the line creeps west live' },
  { id: 'nightlights', label: 'Night photo (NASA)', group: 'basemap', nightFx: true, status: 'live', hasOpacity: true, maxZoom: 8, zoomHint: 'Zoom out to see city lights', requiresBasemap: 'dark', hint: 'the whole planet as NASA photographs it at night — dark basemap only' },
]

export interface RowState {
  on: boolean
  disabled: boolean
  reason?: string
}

/** Every "is this row usable, and if not, why" decision lives HERE — the
 *  panel never computes it inline. A disabled row always says why. */
export function rowState(def: LayerRowDef, on: boolean, zoom: number, basemap: BasemapId): RowState {
  if (def.status === 'coming-soon') return { on: false, disabled: true, reason: 'Coming soon' }
  if (def.requiresBasemap && basemap !== def.requiresBasemap) {
    return { on, disabled: true, reason: `Requires the ${def.requiresBasemap === 'dark' ? 'Dark' : def.requiresBasemap} basemap` }
  }
  if (def.minZoom != null && zoom < def.minZoom) {
    return { on, disabled: false, reason: def.zoomHint ?? 'Zoom in to see this layer' }
  }
  if (def.maxZoom != null && zoom > def.maxZoom) {
    return { on, disabled: false, reason: def.zoomHint ?? 'Zoom out to see this layer' }
  }
  return { on, disabled: false }
}
