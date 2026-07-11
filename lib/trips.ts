import { pointInPolygon } from './alerts-engine'
import type { Geofence } from './types'

/**
 * Trip segmentation — turns a raw ping stream into discrete drives:
 * "7:12 AM · Home → Riverfront Tower · 23 min · 14.2 mi · max 61 mph".
 *
 * A trip starts at the first MOVING fix and ends when the asset goes quiet
 * (no pings — device asleep) or sits still past the dwell threshold. Same
 * jitter thresholds as the cost engine, so a trip is exactly the activity
 * that money accrues on. This is also the dataset an insurance/finance
 * partner would license — drives, not raw pings.
 */

export interface TripPoint {
  lat: number
  lng: number
  speed: number | null
  timestamp: string
}

export interface Trip {
  startMs: number
  endMs: number
  minutes: number
  miles: number
  maxMph: number
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  /** Zone names the trip started/ended inside (null = off-zone). */
  startZone: string | null
  endZone: string | null
}

const MIN_ACTIVE_SPEED = 1     // mph — below this it's GPS jitter
const MIN_MOVE_METERS = 25
const GAP_END_MS = 10 * 60_000   // silence longer than this ends the trip
const DWELL_END_MS = 6 * 60_000  // sitting still this long ends the trip
const MIN_TRIP_METERS = 400      // ignore parking-lot shuffles (< ~1/4 mile)
const MIN_TRIP_MS = 3 * 60_000

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function zoneAt(lng: number, lat: number, fences: Geofence[]): string | null {
  for (const g of fences) {
    const ring = (g.geometry?.coordinates?.[0] ?? []) as [number, number][]
    if (ring.length >= 3 && pointInPolygon([lng, lat], ring)) return g.name
  }
  return null
}

/** Segment ONE asset's chronological pings into trips (newest first). */
export function segmentTrips(rows: TripPoint[], fences: Geofence[] = []): Trip[] {
  const pts = rows
    .map((r) => ({ ...r, ms: new Date(r.timestamp).getTime() }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms)

  const trips: Trip[] = []
  let cur: { pts: typeof pts; meters: number; maxMph: number; lastMoveMs: number } | null = null

  const close = () => {
    if (!cur) return
    const first = cur.pts[0]
    // End the trip at the last MOVING fix, not the tail of idle pings.
    let lastIdx = cur.pts.length - 1
    while (lastIdx > 0 && cur.pts[lastIdx].ms > cur.lastMoveMs) lastIdx--
    const last = cur.pts[lastIdx]
    const ms = last.ms - first.ms
    if (cur.meters >= MIN_TRIP_METERS && ms >= MIN_TRIP_MS) {
      trips.push({
        startMs: first.ms,
        endMs: last.ms,
        minutes: Math.round(ms / 60_000),
        miles: Math.round((cur.meters / 1609.34) * 10) / 10,
        maxMph: Math.round(cur.maxMph),
        startLat: first.lat, startLng: first.lng,
        endLat: last.lat, endLng: last.lng,
        startZone: zoneAt(first.lng, first.lat, fences),
        endZone: zoneAt(last.lng, last.lat, fences),
      })
    }
    cur = null
  }

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const p = pts[i]
    const dt = p.ms - prev.ms
    const dist = dt > 0 && dt <= GAP_END_MS ? haversineMeters(prev.lat, prev.lng, p.lat, p.lng) : 0
    const moving = dt > 0 && dt <= GAP_END_MS && ((p.speed ?? 0) > MIN_ACTIVE_SPEED || dist > MIN_MOVE_METERS)

    if (cur) {
      if (dt > GAP_END_MS || p.ms - cur.lastMoveMs > DWELL_END_MS) close()
    }
    if (moving) {
      if (!cur) cur = { pts: [prev], meters: 0, maxMph: 0, lastMoveMs: prev.ms }
      cur.pts.push(p)
      cur.meters += dist
      cur.lastMoveMs = p.ms
      const mph = p.speed ?? (dt > 0 ? (dist / 1609.34) / (dt / 3_600_000) : 0)
      if (mph > cur.maxMph && mph < 120) cur.maxMph = mph
    } else if (cur) {
      cur.pts.push(p)
    }
  }
  close()

  return trips.reverse() // newest first for the UI
}
