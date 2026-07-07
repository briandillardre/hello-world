/**
 * Tax-parcel overlay — free county/state GIS data, no API key.
 *
 * Nearly every US county (and several states) publishes tax parcels as a
 * public ArcGIS REST layer. Point NEXT_PUBLIC_PARCEL_SERVICE_URL at any such
 * layer (a URL ending in /MapServer/<n> or /FeatureServer/<n>) and the map
 * gains a "Parcel lines" toggle that draws boundaries + parcel numbers at
 * street zoom over Satellite/Hybrid.
 *
 * Finding the URL for your county: county GIS site → "ArcGIS REST Services
 * Directory" → the Parcels service → click the parcel layer → copy the page
 * URL. Greenville County SC: https://www.gcgis.org/arcgis/rest/services
 * (statewide alternatives: SC RIA parcel layer, TN's TNMap assessment layer).
 */

export const PARCEL_SERVICE_URL = process.env.NEXT_PUBLIC_PARCEL_SERVICE_URL ?? ''

/** Parcels only render at street zoom — county services choke on wide bboxes. */
export const PARCEL_MIN_ZOOM = 15
/** Show parcel-number labels a bit deeper than the lines. */
export const PARCEL_LABEL_MIN_ZOOM = 16.5

const MAX_FEATURES = 1500

// Common parcel-number field names across county schemas, tried in order.
const LABEL_FIELDS = ['PIN', 'TMS', 'APN', 'PARCELID', 'PARCEL_ID', 'PARCELNO', 'PARCEL_NO', 'TAXPIN', 'NAME', 'OBJECTID']

export function parcelLabel(props: Record<string, unknown> | null | undefined): string {
  if (!props) return ''
  for (const f of LABEL_FIELDS) {
    const v = props[f] ?? props[f.toLowerCase()]
    if (v != null && String(v).trim()) return String(v)
  }
  return ''
}

/**
 * Fetch parcels intersecting the bbox as GeoJSON via the standard ArcGIS
 * query endpoint. Injects a normalized `parcel_label` property for the map's
 * symbol layer. Returns an empty collection on any failure — the overlay
 * degrades to "no lines", never breaks the map.
 */
export async function fetchParcels(
  serviceUrl: string,
  bounds: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal
): Promise<GeoJSON.FeatureCollection> {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
  if (!serviceUrl) return empty

  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    outFields: '*',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    resultRecordCount: String(MAX_FEATURES),
  })

  try {
    const r = await fetch(`${serviceUrl.replace(/\/$/, '')}/query?${params}`, { signal })
    if (!r.ok) return empty
    const j = await r.json()
    if (!Array.isArray(j?.features)) return empty
    for (const f of j.features) {
      f.properties = { parcel_label: parcelLabel(f.properties) }
    }
    return j as GeoJSON.FeatureCollection
  } catch {
    return empty
  }
}
