import type { AssetTrack } from './trails'
import type { AssetType } from './types'

/**
 * 3D activity terrain — bins the fleet's pings into a hexagonal grid and
 * extrudes each cell by TIME SPENT there. Height answers "how much", which a
 * flat heatmap can't: parked hours tower over drive-throughs, idle hotspots
 * at the gate stand up and point at themselves. Rendered with MapLibre's
 * native fill-extrusion (no extra deps), driven by the timeline scrubber.
 *
 * Dwell accrues at each segment's START point — a sleep gap means the asset
 * sat exactly there, so overnight parking builds honest towers.
 */

const M_PER_DEG = 111_320
const SQRT3 = Math.sqrt(3)
/** Max prism height (m) — the tallest cell in the window; rest scale to it. */
const H_MAX = 1400
const H_MIN = 25

export function hexHeatGeoJSON(
  tracks: AssetTrack[],
  filter: Set<AssetType>,
  t: number,
  windowSec: number,
  cellMeters = 110
): GeoJSON.FeatureCollection {
  const bins = new Map<string, { q: number; r: number; sec: number }>()
  let lat0: number | null = null
  let cosLat = 1

  for (const tr of tracks) {
    if (!filter.has(tr.type)) continue
    const pts = tr.points
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a.t > t) break
      const dt = (Math.min(b.t, t) - a.t) * windowSec
      if (dt <= 0) continue
      if (lat0 === null) { lat0 = a.lat; cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180)) }
      // meters-ish planar coords → pointy-top axial hex → cube-round
      const x = a.lng * cosLat * M_PER_DEG
      const y = a.lat * M_PER_DEG
      const qf = ((SQRT3 / 3) * x - y / 3) / cellMeters
      const rf = ((2 / 3) * y) / cellMeters
      // cube rounding
      let q = Math.round(qf)
      let r = Math.round(rf)
      const s = Math.round(-qf - rf)
      const dq = Math.abs(q - qf)
      const dr = Math.abs(r - rf)
      const ds = Math.abs(s - (-qf - rf))
      if (dq > dr && dq > ds) q = -r - s
      else if (dr > ds) r = -q - s
      const key = `${q},${r}`
      const bin = bins.get(key)
      if (bin) bin.sec += dt
      else bins.set(key, { q, r, sec: dt })
    }
  }

  if (bins.size === 0 || lat0 === null) return { type: 'FeatureCollection', features: [] }

  let maxSec = 0
  for (const b of Array.from(bins.values())) if (b.sec > maxSec) maxSec = b.sec

  const features: GeoJSON.Feature[] = []
  for (const b of Array.from(bins.values())) {
    // hex center back to planar meters, then to lng/lat
    const cx = cellMeters * SQRT3 * (b.q + b.r / 2)
    const cy = cellMeters * 1.5 * b.r
    const ring: [number, number][] = []
    for (let k = 0; k < 6; k++) {
      const ang = ((60 * k - 30) * Math.PI) / 180 // pointy-top vertices
      const vx = cx + cellMeters * Math.cos(ang)
      const vy = cy + cellMeters * Math.sin(ang)
      ring.push([vx / (cosLat * M_PER_DEG), vy / M_PER_DEG])
    }
    ring.push(ring[0])
    const ratio = b.sec / maxSec
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        ratio,
        h: H_MIN + ratio * (H_MAX - H_MIN),
        hours: Math.round((b.sec / 3600) * 10) / 10,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
