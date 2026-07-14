import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Layer health probe — hits one sample request per external map layer FROM
 * THE SERVER (Vercel has open egress; the dev sandbox does not). The /diag
 * page pairs this with in-browser probes so a failure can be blamed on the
 * endpoint, the URL shape, or the browser — no more guessing which.
 * Sample tiles centered on Greenville, SC.
 */

const CHECKS: { key: string; label: string; url: string; kind: 'image' | 'json' | 'text'; expect?: string }[] = [
  {
    key: 'stormtops6',
    label: 'Storm tops IR',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/5/12/8.png',
    kind: 'image',
  },
  {
    key: 'clouds',
    label: 'Clouds GeoColor (working control)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/5/12/8.png',
    kind: 'image',
  },
  {
    key: 'pwsnet',
    label: 'Weather stations (Ambient public map feed)',
    url: 'https://lightning.ambientweather.net/devices?$publicBox[0][0]=-87.1&$publicBox[0][1]=35.9&$publicBox[1][0]=-86.4&$publicBox[1][1]=36.4&$limit=5',
    kind: 'json',
  },
  {
    key: 'rtma-temp',
    label: 'Temperature (NOAA RTMA WMS)',
    url: 'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=air_temperature&STYLES=&SRS=EPSG:3857&BBOX=-9200000,4100000,-9100000,4200000&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    kind: 'image',
  },
  {
    key: 'rtma-feels',
    label: 'Feels like (NOAA RTMA apparent temp)',
    url: 'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=apparent_air_temperature&STYLES=&SRS=EPSG:3857&BBOX=-9200000,4100000,-9100000,4200000&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    kind: 'image',
  },
  {
    key: 'rtma-wind',
    label: 'Wind speed (NOAA RTMA WMS)',
    url: 'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=wind_speed&STYLES=&SRS=EPSG:3857&BBOX=-9200000,4100000,-9100000,4200000&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    kind: 'image',
  },
  {
    key: 'nightlights',
    label: 'City lights (VIIRS Black Marble)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/default/GoogleMapsCompatible_Level8/5/12/8.png',
    kind: 'image',
  },
  {
    key: 'radar',
    label: 'Radar (IEM NEXRAD)',
    url: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/5/8/12.png',
    kind: 'image',
  },
  {
    key: 'flood',
    label: 'FEMA flood zones (NFHL export)',
    url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?bbox=-9173000,4138000,-9172000,4139000&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:28',
    kind: 'image',
  },
  {
    key: 'soils',
    label: 'USDA soils (SDM WMS)',
    url: 'https://SDMDataAccess.nrcs.usda.gov/Spatial/SDM.wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=mapunitpoly&STYLES=&SRS=EPSG:3857&BBOX=-9173000,4138000,-9172000,4139000&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    kind: 'image',
  },
  {
    key: 'nwswarn',
    label: 'Storm warnings (IEM storm-based warnings)',
    url: 'https://mesonet.agron.iastate.edu/geojson/sbw.geojson',
    kind: 'json',
  },
  {
    key: 'rtma-caps',
    label: 'RTMA layer names (nowCOAST GetCapabilities)',
    url: 'https://nowcoast.noaa.gov/geoserver/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities',
    kind: 'text',
    expect: '<Name>',
  },
  {
    key: 'usgs',
    label: 'USGS stream gauges (API)',
    url: 'https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=-82.5000,34.7000,-82.2000,35.0000&parameterCd=00065&siteStatus=active',
    kind: 'json',
  },
]

export async function GET(req: NextRequest) {
  // Our own wind route — tests the REAL path the map uses (with its run
  // fallbacks + cache), not just one raw NOMADS URL that may redirect.
  const selfWind = {
    key: 'api-wind',
    label: 'Wind flow (our /api/wind route)',
    url: `${req.nextUrl.origin}/api/wind`,
    kind: 'json' as const,
    // First hit may fetch the model upstream — allow the route's full budget.
    timeout: 25_000,
  }
  const selfWatches = {
    key: 'api-watches',
    label: 'SPC watch boxes (our /api/watches route)',
    url: `${req.nextUrl.origin}/api/watches`,
    kind: 'json' as const,
    timeout: 25_000,
  }
  // The RTMA rows test the names the MAP actually uses: ask our discovery
  // route first, fall back to the hardcoded guesses if it has nothing.
  let checks = [...CHECKS]
  try {
    const r = await fetch(`${req.nextUrl.origin}/api/rtma-layers`, { signal: AbortSignal.timeout(25_000), cache: 'no-store' })
    if (r.ok) {
      const names = await r.json() as { temp?: string | null; feels?: string | null; wind?: string | null }
      const sub = (key: string, name: string | null | undefined) => {
        if (!name) return
        checks = checks.map((c) => c.key === key
          ? { ...c, label: `${c.label} → ${name}`, url: c.url.replace(/LAYERS=[^&]+/, `LAYERS=${encodeURIComponent(name)}`) }
          : c)
      }
      sub('rtma-temp', names.temp)
      sub('rtma-feels', names.feels)
      sub('rtma-wind', names.wind)
    }
  } catch { /* discovery down — rows test the defaults */ }
  const results = await Promise.all(
    [...checks, selfWind, selfWatches].map(async (c) => {
      try {
        const res = await fetch(c.url, {
          signal: AbortSignal.timeout((c as { timeout?: number }).timeout ?? 8000),
          headers: { 'user-agent': 'HammerTrack layer diagnostics (briandillardre@gmail.com)' },
          cache: 'no-store',
        })
        const buf = await res.arrayBuffer()
        const contentType = res.headers.get('content-type') ?? ''
        // ArcGIS servers love returning a 200 with a JSON error body where an
        // image should be — that counts as a failure, not a pass.
        const ok = res.ok && (
          c.kind === 'image' ? contentType.startsWith('image/') && buf.byteLength > 200
          : c.kind === 'json' ? contentType.includes('json')
          : new TextDecoder().decode(buf).includes(c.expect ?? '')
        )
        return { key: c.key, label: c.label, url: c.url, status: res.status, contentType, bytes: buf.byteLength, ok }
      } catch (err) {
        return { key: c.key, label: c.label, url: c.url, status: 0, contentType: '', bytes: 0, ok: false, error: err instanceof Error ? err.message : 'fetch failed' }
      }
    })
  )
  // Key-presence rows: no fetch, just "is this configured in Vercel" — the
  // two layers that need a free key look broken when the key is absent.
  results.push(
    { key: 'windy-key', label: 'Webcams key (WINDY_WEBCAMS_KEY set?)', url: 'https://api.windy.com/webcams', status: 0, contentType: '', bytes: 0, ok: !!process.env.WINDY_WEBCAMS_KEY },
    { key: 'tomtom-key', label: 'Traffic key (NEXT_PUBLIC_TOMTOM_KEY set?)', url: 'https://developer.tomtom.com', status: 0, contentType: '', bytes: 0, ok: !!process.env.NEXT_PUBLIC_TOMTOM_KEY },
  )
  return NextResponse.json({ at: new Date().toISOString(), checks: results })
}
