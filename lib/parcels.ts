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
  return pickField(props, LABEL_FIELDS)
}

// Owner / situs-address / acreage field names across county schemas. County
// GIS layers are wildly inconsistent; these cover the common US patterns.
const OWNER_FIELDS = ['OWNER', 'OWNER_NAME', 'OWNERNME1', 'OWNERNAME', 'OWN_NAME', 'OWNAM', 'OWNER1', 'OWN1', 'DEEDED_OWNER', 'PARCEL_OWN']
const ADDR_FIELDS = ['SITEADDR', 'SITE_ADDR', 'SITUS', 'SITUS_ADDR', 'SITUSADDR', 'PROP_ADDR', 'PROPADDR', 'LOCATION', 'FULL_ADDR', 'FULLADDR', 'ADDRESS', 'STREET_ADD']
const ACRE_FIELDS = ['ACRES', 'ACREAGE', 'GIS_ACRES', 'GISACRES', 'CALCACRES', 'CALC_ACRE', 'TOTAL_ACRE', 'DEED_ACRES', 'LAND_ACRES']

function pickField(props: Record<string, unknown> | null | undefined, fields: string[]): string {
  if (!props) return ''
  for (const f of fields) {
    const v = props[f] ?? props[f.toLowerCase()]
    if (v != null && String(v).trim()) return String(v).trim()
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
  // (reporting helper defined below the guard — demo/no-URL calls stay silent)
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

  // Failures used to collapse silently into "no parcels here" — a wrong URL,
  // a CORS block, and a real empty viewport all looked identical ("still not
  // seeing a response", Aug 6). Report through the layer-row event channel.
  const report = (msg: string | null) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(msg
      ? new CustomEvent('ht:layer-error', { detail: { key: 'parcels', msg } })
      : new CustomEvent('ht:layer-updated', { detail: { key: 'parcels', at: Date.now() } }))
  }

  try {
    const r = await fetch(`${serviceUrl.replace(/\/$/, '')}/query?${params}`, { signal })
    if (!r.ok) { report(`county service returned HTTP ${r.status} — check the layer URL`); return empty }
    const j = await r.json()
    // ArcGIS answers 200 with {error:{...}} for a wrong layer path.
    if (j?.error) { report(`county service error: ${j.error.message ?? j.error.code ?? 'bad request'}`); return empty }
    if (!Array.isArray(j?.features)) { report('county service sent no features — is the URL a parcel LAYER (…/MapServer/0)?'); return empty }
    report(null)
    for (const f of j.features) {
      // Keep the LandGlide-style tap payload (owner, address, acreage) —
      // outFields=* already downloaded it; dropping it wasted the best part
      // of free county data.
      const p = f.properties as Record<string, unknown>
      const acresRaw = pickField(p, ACRE_FIELDS)
      const acresNum = Number(acresRaw)
      f.properties = {
        parcel_label: parcelLabel(p),
        owner: pickField(p, OWNER_FIELDS),
        situs: pickField(p, ADDR_FIELDS),
        acres: Number.isFinite(acresNum) && acresNum > 0 ? Math.round(acresNum * 100) / 100 : null,
      }
    }
    return j as GeoJSON.FeatureCollection
  } catch (err) {
    // Aborted pans are routine; anything else is network/CORS worth showing.
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      report('can’t reach the county service (network or CORS) — check the URL in /diag')
    }
    return empty
  }
}
