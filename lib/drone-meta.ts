'use client'

/**
 * Smart placement for top-down drone shots — Tier A: metadata auto-place.
 *
 * DJI JPEGs carry everything needed to compute the ground footprint in
 * EXIF/XMP: GPS center, RelativeAltitude (meters above takeoff), gimbal yaw
 * (compass heading of frame-up), and the 35mm-equivalent focal length.
 *   ground width  W = 2 · alt · tan(HFOV/2),  HFOV = 2·atan(18 / f35)
 *   ground height H = W · (imageH / imageW)
 * The result pre-fills the OverlayPlacer ~90% right; the user nudges + saves.
 * Returns null whenever the math would lie (no GPS, implausible altitude,
 * gimbal not pointing down) — caller falls back to manual placement.
 */

type Corner = [number, number]
export type Corners = [Corner, Corner, Corner, Corner]

const M_PER_DEG_LAT = 110_540
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

// Same math as OverlayPlacer's cornersFrom — duplicated here so importing
// this helper never drags maplibre-gl out of the placer's dynamic() chunk.
function cornersFrom(center: [number, number], widthM: number, aspect: number, rotDeg: number): Corners {
  const halfW = widthM / 2
  const halfH = (widthM * aspect) / 2
  const phi = (rotDeg * Math.PI) / 180
  const cos = Math.cos(phi), sin = Math.sin(phi)
  const local: Corner[] = [[-halfW, halfH], [halfW, halfH], [halfW, -halfH], [-halfW, -halfH]]
  const kLng = mPerDegLng(center[1]), kLat = M_PER_DEG_LAT
  return local.map(([x, y]) => {
    const rx = x * cos + y * sin
    const ry = -x * sin + y * cos
    return [center[0] + rx / kLng, center[1] + ry / kLat] as Corner
  }) as Corners
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace('+', ''))
  return Number.isFinite(n) ? n : null
}

/** Read a drone JPEG's EXIF/XMP and compute its ground-corner pre-placement. */
export async function droneShotCorners(file: File): Promise<Corners | null> {
  try {
    const exifr = (await import('exifr')).default
    const m = await exifr.parse(file, { xmp: true }) as Record<string, unknown> | null
    if (!m) return null
    const lat = num(m.latitude), lng = num(m.longitude)
    const alt = num(m.RelativeAltitude) ?? num(m.GPSAltitude)
    const yaw = num(m.GimbalYawDegree) ?? num(m.FlightYawDegree) ?? 0
    const pitch = num(m.GimbalPitchDegree)
    const f35 = num(m.FocalLengthIn35mmFormat) ?? 24
    const imgW = num(m.ExifImageWidth) ?? num(m.ImageWidth) ?? 4000
    const imgH = num(m.ExifImageHeight) ?? num(m.ImageHeight) ?? 3000
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
    if (alt == null || alt < 5 || alt > 500) return null
    // Footprint math assumes nadir — a tilted gimbal (oblique shot) would
    // place a wildly wrong quad. -90 = straight down; allow modest tilt.
    if (pitch != null && pitch > -60) return null
    const hfov = 2 * Math.atan(18 / Math.max(10, f35))
    const widthM = 2 * alt * Math.tan(hfov / 2)
    if (!Number.isFinite(widthM) || widthM < 10 || widthM > 2000) return null
    return cornersFrom([lng, lat], widthM, imgH / imgW, yaw)
  } catch {
    return null
  }
}
