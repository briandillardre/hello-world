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

const exportTemplate = (server: string) =>
  `${server}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`

export const MAP_OVERLAYS: OverlayDef[] = [
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
    key: 'hillshade',
    label: 'Hillshade',
    note: 'terrain relief shading',
    tiles: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    minzoom: 0,
    maxzoom: 16,
    opacity: 0.35,
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
    key: 'streams',
    label: 'Streams',
    note: 'USGS National Hydrography',
    tiles: exportTemplate('https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer'),
    minzoom: 10,
    maxzoom: 16,
    opacity: 0.7,
  },
]
