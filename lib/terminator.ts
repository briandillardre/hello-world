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
  for (let lng = -180; lng <= 180; lng += 1) {
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
 * Graduated dusk→night shading. Each band is "the sun sits below alt°";
 * drawn together in ONE translucent fill layer they accumulate, so the map
 * fades from daylight through a warm horizon glow (golden hour) and civil /
 * nautical / astronomical twilight into full night — a real gradient, not
 * four hard steps. Sep 5 (Brian: "show the Sun's light moving across
 * wherever we are viewing" on the timeline): at job-site zoom a step edge
 * marching across the site read as a glitch, so the ladder is ten rungs.
 * Full night lands around 0.55 navy — trails and dots stay readable.
 */
export const TWILIGHT_BANDS: { alt: number; op: number; color: string }[] = [
  { alt: 6, op: 0.05, color: '#ff9e16' },   // golden hour — sun within 6° of the horizon
  { alt: 2, op: 0.05, color: '#ff7a3d' },
  { alt: 0, op: 0.08, color: '#1a1030' },   // sunset
  { alt: -2, op: 0.08, color: '#0b1430' },
  { alt: -4, op: 0.08, color: '#06102a' },
  { alt: -6, op: 0.08, color: '#040d22' },  // civil dusk ends
  { alt: -9, op: 0.08, color: '#030a1c' },
  { alt: -12, op: 0.07, color: '#020817' }, // nautical dusk ends
  { alt: -15, op: 0.06, color: '#020817' },
  { alt: -18, op: 0.06, color: '#020817' }, // astronomical — full night
]

export function twilightBands(now = new Date()): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: TWILIGHT_BANDS.map((b) => {
      const f = nightRegion(b.alt, now)
      f.properties = { op: b.op, color: b.color }
      return f
    }),
  }
}

/** Sun elevation above the horizon and azimuth (deg clockwise from north)
 *  at a point — the timeline's ☀ readout ("Sun 41° SW", "Civil dusk"). */
export function sunAt(lat: number, lng: number, now = new Date()): { elevation: number; azimuth: number } {
  const rad = Math.PI / 180
  const { dec, subLng } = solarBasis(now)
  const H = (lng - subLng) * rad
  const phi = lat * rad
  const delta = dec * rad
  const sinAlt = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / rad
  // Clockwise from north: due south at solar noon for an observer north of
  // the sun, swinging west through the afternoon.
  const az = Math.atan2(-Math.sin(H), Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)) / rad
  return { elevation, azimuth: (az + 360) % 360 }
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
