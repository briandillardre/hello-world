/**
 * Live day/night terminator — the night half of Earth as a GeoJSON polygon.
 * Approximate solar position (±0.5°), which is plenty to shade a map: nobody
 * schedules a pour off the equation of time.
 */

/** Solar declination (deg) + subsolar longitude (deg) — NOAA approximation. */
function solarBasis(now: Date): { dec: number; subLng: number } {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  const doy = (now.getTime() - start) / 86_400_000
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (now.getUTCHours() - 12) / 24)
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10))
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  return { dec, subLng: -15 * (utcH - 12 + eot / 60) }
}

/**
 * Region where the sun sits below `altDeg` (0 = horizon, −6 civil, −12
 * nautical, −18 astronomical darkness) as a polygon closed over the dark
 * pole. Solve sinφ·sinδ + cosφ·cosδ·cosH = sin(a) per longitude:
 * φ = asin(sin a / R) − atan2(B, A) with A = sinδ, B = cosδ·cosH,
 * R = √(A²+B²) — reduces to the classic tanφ = −cosH/tanδ at a = 0.
 */
export function nightRegion(altDeg: number, now = new Date()): GeoJSON.Feature<GeoJSON.Polygon> {
  const rad = Math.PI / 180
  const { dec, subLng } = solarBasis(now)
  const darkPole = dec > 0 ? -90 : 90
  const dayPole = -darkPole
  const A = Math.sin(dec * rad)
  const sinA = Math.sin(altDeg * rad)
  const coords: [number, number][] = []
  for (let lng = -180; lng <= 180; lng += 2) {
    const B = Math.cos(dec * rad) * Math.cos((lng - subLng) * rad)
    const R = Math.hypot(A, B)
    let lat: number
    if (R < 1e-9 || sinA / R > 1) lat = dayPole // whole meridian below altDeg
    else if (sinA / R < -1) lat = darkPole // whole meridian above — no night here
    else {
      // Two crossings solve sin(φ+γ) = s; pick the one with night toward the
      // dark pole: the rising branch puts night to the SOUTH, the falling
      // branch to the NORTH.
      const x0 = Math.asin(sinA / R) / rad
      const gamma = Math.atan2(B, A) / rad
      lat = darkPole < 0 ? x0 - gamma : 180 - x0 - gamma
    }
    coords.push([lng, Math.max(-90, Math.min(90, lat))])
  }
  coords.push([180, darkPole], [-180, darkPole], coords[0])
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }
}

/**
 * Graduated dusk→night shading: stacked twilight bands (sun below 0/−6/−12/
 * −18°). Rendered together in one translucent fill layer they accumulate,
 * so the map fades smoothly from daylight through dusk into full night.
 */
export function twilightBands(now = new Date()): GeoJSON.FeatureCollection {
  const bands = [
    { alt: 0, op: 0.16 },
    { alt: -6, op: 0.2 },
    { alt: -12, op: 0.22 },
    { alt: -18, op: 0.24 },
  ]
  return {
    type: 'FeatureCollection',
    features: bands.map((b) => {
      const f = nightRegion(b.alt, now)
      f.properties = { op: b.op }
      return f
    }),
  }
}

export function nightPolygon(now = new Date()): GeoJSON.Feature<GeoJSON.Polygon> {
  const rad = Math.PI / 180
  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  const doy = (now.getTime() - start) / 86_400_000

  // Equation of time (minutes) + solar declination (degrees) — NOAA approx.
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (now.getUTCHours() - 12) / 24)
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10))

  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  const subLng = -15 * (utcH - 12 + eot / 60) // subsolar longitude

  // Terminator latitude per longitude: tan(lat) = -cos(H) / tan(dec)
  const coords: [number, number][] = []
  for (let lng = -180; lng <= 180; lng += 2) {
    const H = (lng - subLng) * rad
    let lat = Math.atan(-Math.cos(H) / Math.tan(dec * rad)) / rad
    if (!Number.isFinite(lat)) lat = 0 // equinox at the noon/midnight meridian
    coords.push([lng, lat])
  }
  // Close the ring over whichever pole is in darkness this season.
  const pole = dec > 0 ? -90 : 90
  coords.push([180, pole], [-180, pole], coords[0])

  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }
}
