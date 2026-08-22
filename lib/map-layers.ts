/**
 * THE layer registry — single source of truth for the layers panel.
 * The panel renders from it; gating decisions all flow through rowState().
 * Layer ids are PERSISTED (saved views in localStorage + profiles.map_views)
 * — never rename one without a back-compat mapping.
 */

export type BasemapId = 'dark' | 'streets' | 'terrain' | 'satellite' | 'hybrid' | 'silver' | 'plain' | 'bw' | 'aubergine' | 'night' | 'vfr' | 'ifr'
export type GroupId = 'jobs' | 'weather' | 'roads' | 'land' | 'basemap' | 'sky'

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
  /** Some rows only make sense on one basemap (e.g. dark-only glow layers). */
  requiresBasemap?: BasemapId
  /** Row hides entirely until this parent layer id is on (e.g. the swarm
   *  only appears once Satellites is toggled on). */
  requiresLayer?: string
  /** Raster overlays get an opacity slider while on. */
  hasOpacity?: boolean
  /** Feed-backed rows render an "updated h:mm" stamp (amber when stale). */
  isLive?: boolean
  /** Specialist rows hide behind an inline "More …" expander inside their
   *  group (Aug 22 declutter) — everyday rows stay one tap away. An advanced
   *  row that's ON always renders, expander or not (never hide live state). */
  advanced?: boolean
}

// Every group starts collapsed (owner ask, Jul 14; re-confirmed in the Aug 16
// reorg spec) — the panel opens to the basics (search, active chips,
// show-on-map) with the deep layers one tap in.
// Order = how a contractor reaches for them (Aug 16 reorg): the map's look
// first, then job-site money/context layers, weather, roads, the
// walk-it-before-you-bid land stack — and the planetarium/eye-candy at the
// bottom. (Show on map renders between Map look and My jobsites; it's a
// dedicated section in the panel, not a registry group.)
export const GROUPS: { id: GroupId; label: string; defaultCollapsed?: boolean }[] = [
  // "Basemap", not "Map look" (Brian, Aug 22) — the industry word.
  { id: 'basemap', label: 'Basemap', defaultCollapsed: true },
  // 'My sites', not 'My jobsites' (Brian, Aug 22): landscapers, crews,
  // rental yards — not every customer calls them job sites.
  { id: 'jobs', label: 'My sites', defaultCollapsed: true },
  { id: 'weather', label: 'Weather', defaultCollapsed: true },
  { id: 'roads', label: 'Roads & travel', defaultCollapsed: true },
  { id: 'land', label: 'Land check', defaultCollapsed: true },
  { id: 'sky', label: 'Sky & extras', defaultCollapsed: true },
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
  // NASA Black Marble — Earth at night. Was the 'nightlights' overlay row
  // (dark-basemap-only, opacity slider); promoted to a basemap Aug 11.
  { id: 'night', label: 'Night (NASA)' },
  // Aviation charts (FAA public tiles) — experimental, may move to a
  // separate app later (Brian, Aug 10).
  { id: 'vfr', label: 'VFR Sectional' },
  { id: 'ifr', label: 'IFR Low' },
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
  night: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/default/GoogleMapsCompatible_Level8/${THUMB.z}/${THUMB.y}/${THUMB.x}.png`,
  vfr: `https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/${THUMB.z}/${THUMB.y}/${THUMB.x}`,
  ifr: `https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/${THUMB.z}/${THUMB.y}/${THUMB.x}`,
}
/** CSS filter approximating the map paint treatment, for picker thumbs only. */
export const BASEMAP_THUMB_FILTER: Partial<Record<BasemapId, string>> = {
  bw: 'grayscale(1) contrast(1.25)',
  aubergine: 'hue-rotate(230deg) saturate(0.6) brightness(0.55)',
}

export const LAYER_ROWS: LayerRowDef[] = [
  // ── My sites: the money/context layers drawn around your assets ──────────
  // ('zones' moved OUT of this registry Aug 10 — it renders as a dedicated
  // row in the Show-on-map group beside the asset types. Its state was never
  // in the overlays record (dedicated cfg.zones field), so saved views and
  // last-session snapshots are unaffected.)
  // ── The money layers (Aug 12 brainstorm — "where is my money and my day") ──
  { id: 'burnmap', label: 'Burn Map', group: 'jobs', status: 'live', isLive: true, hint: 'zones shade by today’s spend vs budget · live $ chips tick as machines run · needs cost rates on assets' },
  { id: 'idledollars', label: 'Idle $ rings', group: 'jobs', status: 'live', hint: 'parked machines grow a ring of accruing ownership cost · needs $/day on assets' },
  { id: 'alertpins', label: 'Alert pins', group: 'jobs', status: 'live', isLive: true, hint: 'where alerts fired · follows the timeline: Live shows today, replays reveal pins as the scrubber passes them' },
  { id: 'nightwatch', label: 'Night Watch', group: 'jobs', status: 'live', hint: 'where the fleet sleeps · teal = tucked in a yard/site · amber = out in the open' },
  { id: 'fieldops', label: 'Field activity', group: 'jobs', status: 'live', isLive: true, hint: 'crew clock-ins & daily logs, pinned where the phone was · last 7 days · tap a pin' },
  { id: 'siteimg', label: 'Site imagery', group: 'jobs', status: 'live', hasOpacity: true, hint: 'placed drone shots pinned to the ground · follows the timeline — scrub to see the site that day' },
  { id: 'siteplans', label: 'Scaled plans', group: 'jobs', status: 'live', hasOpacity: true, hint: 'the plan sheet marked “show on map” on each site page — siteplan, utilities, grading…' },
  { id: 'measures', label: 'Measurements', group: 'jobs', status: 'live', hint: 'saved points, lines & areas — tap one on the map to open, edit, or delete it' },

  // ── Weather ───────────────────────────────────────────────────────────────
  { id: 'radar', label: 'Radar', group: 'weather', status: 'live', isLive: true, hasOpacity: true, hint: 'precipitation · loops on Live, scrubs with replays · ⚡ real satellite-detected strikes ride on top (live only, ~8km precision)' },
  { id: 'nwswarn', label: 'Storm warnings', group: 'weather', status: 'live', isLive: true, hint: 'CURRENT warnings solid (tornado red · t-storm orange · flood green) · watch boxes dashed · ONLY LIVE — hides during replays' },
  { id: 'pourcast', label: 'Pour planner', group: 'weather', status: 'live', isLive: true, hint: 'each site flags its next bad concrete/crane day — rain ≥60%, gusts ≥25, or ≤35°F' },
  { id: 'temp', label: 'Temperature', group: 'weather', status: 'live', advanced: true, hasOpacity: true, hint: 'surface temp shading · hourly · replays show the scrubbed hour (~1 day back)' },
  { id: 'feels', label: 'Feels like', group: 'weather', status: 'live', advanced: true, hasOpacity: true, hint: 'heat index / wind chill · hourly · replays show the scrubbed hour (~1 day back)' },
  { id: 'wind', label: 'Wind speed', group: 'weather', status: 'live', advanced: true, hasOpacity: true, hint: 'sustained wind shading · hourly · replays show the scrubbed hour (~1 day back)' },
  // Nested display row directly under Wind speed (Aug 16 reorg) — same
  // persisted id as always, only the label carries the "↳" nesting mark.
  { id: 'windanim', label: '↳ Wind flow', group: 'weather', status: 'live', advanced: true, isLive: true, hint: 'animated wind — live view only' },
  { id: 'precip', label: 'Rain totals', group: 'weather', status: 'live', advanced: true, hint: 'rainfall accumulated up to RIGHT NOW — pick the period · ONLY LIVE, not historical' },
  // Layer name discovered live from NOAA's server (like temp/feels/wind) —
  // GOES lightning mapper strike density. Row reports if NOAA drops it.
  { id: 'lightning', label: 'Lightning', group: 'weather', status: 'live', advanced: true, hasOpacity: true, hint: 'GOES strike density · ~10 min · replays show the scrubbed hour (~1 day back)' },
  { id: 'stormtops', label: 'Storm tops (IR)', group: 'weather', status: 'live', advanced: true, hasOpacity: true, hint: 'rainbow cores = violent cells · gray = ordinary cloud · ONLY LIVE — hides during replays' },
  { id: 'clouds', label: 'Clouds', group: 'weather', status: 'live', advanced: true, hint: 'satellite cloud cover · ~10 min · ONLY LIVE — hides during replays' },
  { id: 'pwsnet', label: 'Weather stations', group: 'weather', status: 'live', isLive: true, minZoom: 8, hint: 'community stations · tap for readings' },

  // ── Roads & travel ────────────────────────────────────────────────────────
  { id: 'traffic', label: 'Traffic', group: 'roads', status: process.env.NEXT_PUBLIC_TOMTOM_KEY ? 'live' : 'coming-soon', hasOpacity: true, hint: 'live congestion — green flows, red crawls' },
  { id: 'closures', label: 'Road closures', group: 'roads', status: 'live', isLive: true, hint: 'DOT incidents, closures & work zones · tap a cone' },
  { id: 'webcams', label: 'Webcams', group: 'roads', status: 'live', isLive: true, minZoom: 8, hint: 'public traffic & area cams · tap for the picture' },

  // ── Land check: walk a lot before you bid ─────────────────────────────────
  // Honest gating: without the county service URL the toggle was a silent
  // no-op ("still not seeing a response" — Aug 6). Coming-soon until set.
  // Esri World Imagery Wayback — free public archive of the satellite
  // basemap, one snapshot per year back to 2014 (Brian, Aug 22: "historical
  // imagery with a year slider").
  { id: 'wayback', label: 'Historical imagery', group: 'land', status: 'live', isLive: true, hasOpacity: true, hint: 'satellite time machine — drag the year to see a site before you built it' },
  { id: 'parcels', label: 'Parcel lines', group: 'land', status: process.env.NEXT_PUBLIC_PARCEL_SERVICE_URL ? 'live' : 'coming-soon', isLive: true, minZoom: 14, hint: 'county tax parcels · tap one for owner, address & acreage' },
  { id: 'flood', label: 'Flood zones', group: 'land', status: 'live', hasOpacity: true, minZoom: 10, hint: 'FEMA flood hazard areas' },
  { id: 'wetlands', label: 'Wetlands', group: 'land', status: 'live', hasOpacity: true, minZoom: 11, hint: 'national wetlands inventory' },
  { id: 'soils', label: 'Soils', group: 'land', status: 'live', hasOpacity: true, minZoom: 12, hint: 'soil survey map units' },
  { id: 'topo', label: 'Topo lines', group: 'land', status: 'live', hasOpacity: true, minZoom: 12, hint: 'elevation contours' },
  { id: 'streams', label: 'Streams', group: 'land', status: 'live', hasOpacity: true, hint: 'rivers & creeks (national hydrography)' },
  { id: 'gauges', label: 'Stream gauges', group: 'land', status: 'live', isLive: true, minZoom: 9, hint: 'live gage height · tap a dot' },

  // ── Sky & extras: the planetarium & spectacle layers — fun on a TV wall,
  //    noise on a Tuesday. Lives at the bottom, collapsed. ──────────────────
  { id: 'planes', label: 'Aircraft (live)', group: 'sky', status: 'live', isLive: true, hint: 'live air traffic near your view at true altitude · tilt the map to see them overhead · tap one for flight details' },
  { id: 'airspace3d', label: 'Airspace 3D', group: 'sky', status: 'live', isLive: true, hasOpacity: true, minZoom: 6, hint: 'Class B/C/D shelves at their charted altitudes — the upside-down cake · TILT the map · tap a shelf for floor/ceiling · FAA data' },
  { id: 'satellites', label: 'Satellites & sky (live)', group: 'sky', status: 'live', isLive: true, hint: 'real orbits at TRUE altitude — plus the sun, moon (real phase), and stars in their actual positions · zoom way out' },
  { id: 'satswarm', label: '↳ 11k satellites', group: 'sky', status: 'live', isLive: true, requiresLayer: 'satellites', hint: 'EVERY tracked satellite as an ambient field · heavier on older phones' },
  // Ex-"Night effects" sub-group (killed Aug 16) — now an ordinary row; its
  // gating still flows through rowState like every other row.
  { id: 'daynight', label: 'Day / night (real)', group: 'sky', status: 'live', hint: 'your basemap in daylight, dusk fading to dark, real cities glowing on the night side — the line creeps west live' },
  // ('nightlights' promoted to the 'night' BASEMAP Aug 11 — saved views that
  // still carry the overlay key are silently ignored.)
]

export interface RowState {
  on: boolean
  disabled: boolean
  reason?: string
  /** Set when the only issue is zoom level — the panel renders it as a
   *  compact inline "(zoom in)"/"(zoom out)" chip instead of a full row. */
  zoomDir?: 'in' | 'out'
}

/** Every "is this row usable, and if not, why" decision lives HERE — the
 *  panel never computes it inline. A disabled row always says why. */
export function rowState(def: LayerRowDef, on: boolean, zoom: number, basemap: BasemapId): RowState {
  if (def.status === 'coming-soon') return { on: false, disabled: true, reason: 'Coming soon' }
  if (def.requiresBasemap && basemap !== def.requiresBasemap) {
    return { on, disabled: true, reason: `Requires the ${def.requiresBasemap === 'dark' ? 'Dark' : def.requiresBasemap} basemap` }
  }
  if (def.minZoom != null && zoom < def.minZoom) {
    return { on, disabled: false, zoomDir: 'in' }
  }
  if (def.maxZoom != null && zoom > def.maxZoom) {
    return { on, disabled: false, zoomDir: 'out' }
  }
  return { on, disabled: false }
}
