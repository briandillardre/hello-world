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

// Demo movement is constrained to a street grid so trails run along roads
// (right-angle turns) instead of cutting diagonally across blocks. Block sizes
// in degrees at ~36°N; per-step distance and roam radius vary by asset class.
const BLOCK_LAT = 0.00090
const BLOCK_LNG = 0.00111
const STEP: Record<AssetType, number> = { vehicle: 0.0015, equipment: 0.0007, personnel: 0.00045, tool: 0.00030 }
const RADIUS: Record<AssetType, number> = { vehicle: 0.013, equipment: 0.0045, personnel: 0.0026, tool: 0.0018 }

function snapToGrid(v: number, origin: number, step: number): number {
  return origin + Math.round((v - origin) / step) * step
}

const N_POINTS = 96

// FNV-1a — tracks stay stable when the asset list reorders or grows
function hashId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function generateTracks(assets: AssetWithLocation[]): AssetTrack[] {
  return assets.map((a) => {
    const rng = mulberry32(hashId(a.id))
    const endLng = a.location?.lng ?? DEMO_MAP_CENTER[0]
    const endLat = a.location?.lat ?? DEMO_MAP_CENTER[1]
    const stepLat = STEP[a.type]
    const stepLng = STEP[a.type] * (BLOCK_LNG / BLOCK_LAT)
    const rLat = RADIUS[a.type]
    const rLng = RADIUS[a.type] * (BLOCK_LNG / BLOCK_LAT)

    // Grid-constrained walk backward from the live position: move along one axis
    // at a time (riding a "street"), turn 90° at the end of each leg. Reads as
    // driving the road grid instead of cutting diagonally across blocks.
    const pts: TrackPoint[] = new Array(N_POINTS)
    let lng = endLng
    let lat = endLat
    let horiz = rng() < 0.5
    let sign = rng() < 0.5 ? 1 : -1
    let legLeft = 3 + Math.floor(rng() * 6)
    for (let i = N_POINTS - 1; i >= 0; i--) {
      pts[i] = { lng, lat, t: i / (N_POINTS - 1) }
      if (legLeft <= 0) {
        horiz = !horiz // 90° turn at the intersection
        sign = rng() < 0.5 ? 1 : -1
        legLeft = 3 + Math.floor(rng() * 6)
        // snap the now-fixed axis to a street line so we ride the grid
        if (horiz) lat = snapToGrid(lat, endLat, BLOCK_LAT)
        else lng = snapToGrid(lng, endLng, BLOCK_LNG)
      }
      legLeft--
      // tools/personnel sit parked for stretches
      const moving = a.type === 'tool' || a.type === 'personnel' ? (rng() < 0.5 ? 0 : 1) : 1
      if (horiz) lng -= sign * stepLng * moving
      else lat -= sign * stepLat * moving
      // keep within the asset's roam radius (rides the perimeter street if clamped)
      if (lng > endLng + rLng) { lng = endLng + rLng; legLeft = 0 }
      else if (lng < endLng - rLng) { lng = endLng - rLng; legLeft = 0 }
      if (lat > endLat + rLat) { lat = endLat + rLat; legLeft = 0 }
      else if (lat < endLat - rLat) { lat = endLat - rLat; legLeft = 0 }
    }

    return {
      assetId: a.id,
      name: a.name,
      type: a.type,
      color: TRAIL_PALETTE[hashId(a.id) % TRAIL_PALETTE.length],
      points: pts,
    }
  })
}

// How movement over the window is drawn — user-selectable on any time range.
export type TrailMode = 'off' | 'trails' | 'heatmap'

// ── Timeline ranges ──────────────────────────────────────────────────────────
export type TimeRange = 'live' | 'today' | 'yesterday' | '7d' | '30d' | 'ytd' | 'all'

export const RANGES: { key: TimeRange; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All time' },
]

/** Number of days a replay range spans (used to map t → a date). */
export function rangeSpanDays(range: TimeRange): number {
  switch (range) {
    case 'today':
    case 'yesterday': return 1
    case '7d': return 7
    case '30d': return 30
    case 'ytd': {
      const now = new Date()
      const jan1 = new Date(now.getFullYear(), 0, 1)
      return Math.max(1, Math.round((now.getTime() - jan1.getTime()) / 86_400_000))
    }
    case 'all': return 365
    default: return 1
  }
}

/** Real-world seconds spanned by a range — used to make playback speed a true
 *  real-time multiplier (so a year can be replayed as fast as a day). */
export function rangeWindowSeconds(range: TimeRange): number {
  if (range === 'today' || range === 'yesterday') return PLAYBACK_WINDOW_SECONDS // 12h workday
  return rangeSpanDays(range) * 86_400
}

/** Speed options scale with the range — long windows need much bigger multipliers. */
export function speedsForRange(range: TimeRange): number[] {
  switch (range) {
    case 'today':
    case 'yesterday': return [60, 300, 1000, 5000]
    case '7d': return [500, 2000, 10_000, 50_000]
    case '30d': return [2000, 10_000, 50_000, 200_000]
    case 'ytd':
    case 'all': return [10_000, 100_000, 500_000, 1_000_000]
    default: return [60, 300, 1000]
  }
}

export function defaultSpeed(range: TimeRange): number {
  const s = speedsForRange(range)
  return s[Math.min(1, s.length - 1)]
}

export function formatSpeed(n: number): string {
  if (n >= 1_000_000) return n / 1_000_000 + 'M×'
  if (n >= 1_000) return n / 1_000 + 'k×'
  return n + '×'
}

/** Full, human-readable date/time for the current scrub position. */
export function scrubLabel(range: TimeRange, t: number): string {
  if (range === 'live') return 'Live'
  if (range === 'today') return 'Today · ' + clockLabel(t)
  if (range === 'yesterday') return 'Yesterday · ' + clockLabel(t)
  const ms = Date.now() - (1 - t) * rangeSpanDays(range) * 86_400_000
  return new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** Human label for the scrubber position within a range. */
export function rangeLabel(range: TimeRange, t: number): string {
  if (range === 'live') return 'LIVE'
  if (range === 'today') return clockLabel(t)
  if (range === 'yesterday') return 'Yest · ' + clockLabel(t)
  const ms = Date.now() - (1 - t) * rangeSpanDays(range) * 86_400_000
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
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
