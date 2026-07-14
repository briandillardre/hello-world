/**
 * Free, keyless raster overlays for the map's layers panel. Two URL styles:
 * cached XYZ tiles ({z}/{y}/{x}) and ArcGIS dynamic export ({bbox-epsg-3857})
 * — MapLibre supports both as raster tile templates.
 *
 * All are public national services (Esri community basemaps / USGS / USFWS).
 * A dead service degrades to "no tiles drawn" — never a broken map.
 */

export interface OverlayDef {
  key: string
  label: string
  /** Short note shown under the toggle while it's on. */
  note: string
  tiles: string
  /** Layer minzoom — detail layers stay off at county-wide zooms. */
  minzoom: number
  /** Source maxzoom — MapLibre over-scales beyond instead of 404ing. */
  maxzoom: number
  opacity: number
}

const exportTemplate = (server: string, extra = '') =>
  `${server}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image${extra}`

// Live traffic flow (TomTom raster) rides on a free key — the overlay only
// exists when the key is configured, so no key = no broken tiles.
const TOMTOM_KEY = process.env.NEXT_PUBLIC_TOMTOM_KEY

export const MAP_OVERLAYS: OverlayDef[] = [
  ...(TOMTOM_KEY
    ? [{
        key: 'traffic',
        label: 'Traffic',
        note: 'live congestion — green flows, red crawls',
        tiles: `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${TOMTOM_KEY}`,
        minzoom: 6,
        maxzoom: 18,
        opacity: 0.8,
      } satisfies OverlayDef]
    : []),
  {
    key: 'topo',
    label: 'Topo lines',
    note: 'USGS contours · zoom in to see lines',
    tiles: exportTemplate('https://carto.nationalmap.gov/arcgis/rest/services/contours/MapServer'),
    minzoom: 12,
    maxzoom: 16,
    opacity: 0.8,
  },
  {
    key: 'wetlands',
    label: 'Wetlands',
    note: 'USFWS National Wetlands Inventory',
    tiles: exportTemplate('https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer'),
    minzoom: 11,
    maxzoom: 16,
    opacity: 0.6,
  },
  {
    key: 'flood',
    label: 'Flood zones',
    note: 'FEMA flood hazard (NFHL) · bid intel',
    // Layer 28 = flood hazard zone polygons (AE/A/X shading + floodway).
    tiles: exportTemplate('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer', '&layers=show:28'),
    minzoom: 10,
    maxzoom: 16,
    opacity: 0.5,
  },
  {
    key: 'soils',
    label: 'Soils',
    note: 'USDA SSURGO soil map units',
    // USDA's own Soil Data Access WMS (mapunitpoly). Dynamic render — heavier
    // than cached tiles, so gate it to street zoom where soil lines mean something.
    tiles: 'https://SDMDataAccess.nrcs.usda.gov/Spatial/SDM.wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=mapunitpoly&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    minzoom: 12,
    maxzoom: 16,
    opacity: 0.55,
  },
  {
    key: 'temp',
    label: 'Temperature',
    note: 'NOAA RTMA surface temp · hourly · CONUS',
    // nowCOAST GeoServer WMS — free/keyless government service, ~2.5 km grid.
    tiles: 'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=air_temperature&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    minzoom: 0,
    maxzoom: 10,
    opacity: 0.5,
  },
  {
    key: 'feels',
    label: 'Feels like',
    note: 'NOAA apparent temp — heat index / wind chill',
    tiles: 'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=apparent_air_temperature&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    minzoom: 0,
    maxzoom: 10,
    opacity: 0.5,
  },
  {
    key: 'wind',
    label: 'Wind speed',
    note: 'NOAA RTMA sustained wind · hourly',
    tiles: 'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=wind_speed&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    minzoom: 0,
    maxzoom: 10,
    opacity: 0.55,
  },
  {
    key: 'nightlights',
    label: 'City lights',
    note: 'NASA Black Marble · Earth at night · zoom out',
    // Static VIIRS composite via GIBS — no query params (strict server).
    tiles: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
    minzoom: 0,
    maxzoom: 8,
    opacity: 0.9,
  },
  {
    key: 'streams',
    label: 'Streams',
    note: 'USGS National Hydrography',
    tiles: exportTemplate('https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer'),
    minzoom: 10,
    maxzoom: 16,
    opacity: 0.7,
  },
]
