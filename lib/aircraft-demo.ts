import type { Fix, Flight } from './aircraft-log'
import { haversineNm } from './aircraft-log'

/**
 * A believable flight log for demo mode (no env vars, no signed-in company).
 *
 * Everything else in the app works with zero configuration, and a Flight log
 * page that answered "nothing here" would read as broken rather than as a
 * demo. These are GENERATED, not real: a climb / cruise / descent profile
 * flown between two real-enough points, so the charts show what the charts
 * show. Nothing here is ever written to a database or presented as history
 * of a real aircraft — the page says "demo data" out loud.
 */

const DEMO_HEX = 'a835af'

interface Leg { name: string; fromLat: number; fromLon: number; toLat: number; toLon: number; cruiseFt: number; cruiseKt: number; daysAgo: number; hour: number }

// Upstate SC out and back, the way Brian's fleet actually moves.
const LEGS: Leg[] = [
  { name: 'DEMO01', fromLat: 34.8957, fromLon: -82.2189, toLat: 32.8986, toLon: -80.0405, cruiseFt: 28000, cruiseKt: 440, daysAgo: 1, hour: 8 },
  { name: 'DEMO02', fromLat: 32.8986, fromLon: -80.0405, toLat: 34.8957, toLon: -82.2189, cruiseFt: 26000, cruiseKt: 425, daysAgo: 1, hour: 16 },
  { name: 'DEMO03', fromLat: 34.8957, fromLon: -82.2189, toLat: 35.2140, toLon: -80.9431, cruiseFt: 17000, cruiseKt: 380, daysAgo: 4, hour: 10 },
]

/** Climb at a steady rate, cruise, then descend — the shape of every flight. */
function buildTrack(leg: Leg, startSec: number, durationSec: number): Fix[] {
  const n = 140
  const out: Fix[] = []
  const climbFrac = 0.18
  const descentFrac = 0.24
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1)
    let altFt: number
    let vsFpm: number
    if (k < climbFrac) {
      const p = k / climbFrac
      altFt = Math.round(leg.cruiseFt * p)
      vsFpm = Math.round((leg.cruiseFt / (durationSec * climbFrac)) * 60)
    } else if (k > 1 - descentFrac) {
      const p = (k - (1 - descentFrac)) / descentFrac
      altFt = Math.round(leg.cruiseFt * (1 - p))
      vsFpm = -Math.round((leg.cruiseFt / (durationSec * descentFrac)) * 60)
    } else {
      // Cruise is not perfectly flat — a step climb and small corrections.
      const wob = Math.sin(k * 9) * 220
      altFt = Math.round(leg.cruiseFt + (k > 0.55 ? 2000 : 0) + wob)
      vsFpm = Math.round(Math.cos(k * 9) * 180)
    }
    const gsKt = Math.round(
      k < climbFrac ? 180 + (leg.cruiseKt - 180) * (k / climbFrac)
        : k > 1 - descentFrac ? leg.cruiseKt - (leg.cruiseKt - 170) * ((k - (1 - descentFrac)) / descentFrac)
        : leg.cruiseKt + Math.sin(k * 6) * 12,
    )
    out.push({
      t: Math.round(startSec + k * durationSec),
      lat: leg.fromLat + (leg.toLat - leg.fromLat) * k,
      lon: leg.fromLon + (leg.toLon - leg.fromLon) * k,
      altFt: Math.max(0, altFt),
      gsKt,
      trackDeg: 0,
      vsFpm,
    })
  }
  return out
}

export function demoFlights(now = new Date()): Flight[] {
  return LEGS.map((leg) => {
    const day = new Date(now.getTime() - leg.daysAgo * 86_400_000)
    day.setHours(leg.hour, 0, 0, 0)
    const startedAt = Math.round(day.getTime() / 1000)
    const nm = haversineNm(leg.fromLat, leg.fromLon, leg.toLat, leg.toLon)
    const durationSec = Math.round((nm / leg.cruiseKt) * 3600 + 900)
    const track = buildTrack(leg, startedAt, durationSec)
    return {
      id: `${DEMO_HEX}-${startedAt}`,
      hex: DEMO_HEX,
      callsign: leg.name,
      startedAt,
      endedAt: startedAt + durationSec,
      durationSec,
      from: { lat: leg.fromLat, lon: leg.fromLon },
      to: { lat: leg.toLat, lon: leg.toLon },
      distanceNm: Math.round(nm * 10) / 10,
      maxAltFt: Math.max(...track.map((f) => f.altFt ?? 0)),
      maxGsKt: Math.max(...track.map((f) => f.gsKt ?? 0)),
      fixCount: track.length,
      openStart: false,
      openEnd: false,
      departed: true,
      arrived: true,
      track,
    }
  }).sort((a, b) => b.startedAt - a.startedAt)
}
