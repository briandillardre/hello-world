/**
 * Live day/night terminator — the night half of Earth as a GeoJSON polygon.
 * Approximate solar position (±0.5°), which is plenty to shade a map: nobody
 * schedules a pour off the equation of time.
 */
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
