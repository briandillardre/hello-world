import type { AssetWithLocation, AssetType } from './types'
import { DEMO_MAP_CENTER } from './mock-data'

/**
 * Equipment Trails + Timeline Playback data.
 *
 * Each asset gets a deterministic time-series "track" (a day of movement) so the
 * map can draw colored historical trails and replay them on a scrubber. In demo
 * mode these are synthesized with a seeded random walk anchored at the asset's
 * current position; with real data this module would read AssetLocation history.
 */

export interface TrackPoint {
  lng: number
  lat: number
  t: number // normalized 0..1 across the playback window
}

export interface AssetTrack {
  assetId: string
  name: string
  type: AssetType
  color: string
  points: TrackPoint[]
}

// Vivid, high-contrast colors that read well on a dark map
export const TRAIL_PALETTE = [
  '#ff9e16', '#2dd4bf', '#a78bfa', '#f87171', '#34d399',
  '#60a5fa', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c',
]

// Playback window spans a work day, 6:00 AM → 6:00 PM
export const PLAYBACK_START_HOUR = 6
export const PLAYBACK_END_HOUR = 18
export const PLAYBACK_WINDOW_SECONDS = (PLAYBACK_END_HOUR - PLAYBACK_START_HOUR) * 3600

export function clockLabel(t: number): string {
  const totalMin = PLAYBACK_START_HOUR * 60 + t * (PLAYBACK_END_HOUR - PLAYBACK_START_HOUR) * 60
  const h = Math.floor(totalMin / 60)
  const m = Math.floor(totalMin % 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  let hh = h % 12
  if (hh === 0) hh = 12
  return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// How far each asset class roams over the day (degrees per step)
const AMPLITUDE: Record<AssetType, number> = {
  vehicle: 0.010,
  equipment: 0.0035,
  personnel: 0.0016,
  tool: 0.0010,
}

const N_POINTS = 96

export function generateTracks(assets: AssetWithLocation[]): AssetTrack[] {
  return assets.map((a, idx) => {
    const rng = mulberry32(idx * 9277 + 12345)
    const amp = AMPLITUDE[a.type]
    const endLng = a.location?.lng ?? DEMO_MAP_CENTER[0]
    const endLat = a.location?.lat ?? DEMO_MAP_CENTER[1]

    // Random walk backward from the current ("now") position with momentum, so
    // the last point lands exactly on the live location.
    const pts: TrackPoint[] = new Array(N_POINTS)
    let lng = endLng
    let lat = endLat
    let hLng = rng() - 0.5
    let hLat = rng() - 0.5
    for (let i = N_POINTS - 1; i >= 0; i--) {
      pts[i] = { lng, lat, t: i / (N_POINTS - 1) }
      hLng = hLng * 0.8 + (rng() - 0.5) * 0.6
      hLat = hLat * 0.8 + (rng() - 0.5) * 0.6
      // tools/personnel sit parked for stretches
      const move = a.type === 'tool' || a.type === 'personnel' ? (rng() < 0.6 ? 0.2 : 1) : 1
      lng -= hLng * amp * move
      lat -= hLat * amp * move
    }

    return {
      assetId: a.id,
      name: a.name,
      type: a.type,
      color: TRAIL_PALETTE[idx % TRAIL_PALETTE.length],
      points: pts,
    }
  })
}

/** Interpolated [lng, lat] position at normalized time t. */
export function positionAt(track: AssetTrack, t: number): [number, number] {
  const pts = track.points
  if (pts.length === 0) return DEMO_MAP_CENTER
  if (t <= 0) return [pts[0].lng, pts[0].lat]
  if (t >= 1) return [pts[pts.length - 1].lng, pts[pts.length - 1].lat]
  const f = t * (pts.length - 1)
  const i = Math.floor(f)
  const frac = f - i
  const a = pts[i]
  const b = pts[Math.min(i + 1, pts.length - 1)]
  return [a.lng + (b.lng - a.lng) * frac, a.lat + (b.lat - a.lat) * frac]
}

/** Trail polyline coordinates from the start of the window up to time t. */
export function trailUpTo(track: AssetTrack, t: number): [number, number][] {
  const coords: [number, number][] = []
  for (const p of track.points) {
    if (p.t <= t) coords.push([p.lng, p.lat])
    else break
  }
  coords.push(positionAt(track, t))
  return coords
}
