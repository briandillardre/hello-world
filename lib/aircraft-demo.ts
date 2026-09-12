import type { Fix, Flight } from './aircraft-log'
import { haversineNm } from './aircraft-log'
import { resolveEnd, findAirport } from './airports'
import { findPatternWork } from './pattern'
import { fieldAt } from './db/aircraft'

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

/**
 * A training flight: out to another field, a handful of touch-and-goes, home
 * again — the shape Brian described. Generated, like the rest of the demo,
 * but flown with a real pattern so the circuits card has something to draw.
 */
function patternLeg(startedAt: number): Fix[] {
  const gmu = findAirport('KGMU')
  const grd = findAirport('KGRD')
  if (!gmu || !grd) return []
  const out: Fix[] = []
  let t = startedAt
  const push = (lat: number, lon: number, altFt: number, gsKt: number) => {
    const prev = out[out.length - 1]
    const vs = prev && prev.altFt != null ? Math.round(((altFt - prev.altFt) / 12) * 60) : 0
    out.push({ t, lat, lon, altFt: Math.round(altFt), gsKt, trackDeg: null, vsFpm: vs })
    t += 12
  }
  // Climb out of the home field and run down to the training field.
  const legN = 90
  for (let i = 0; i < legN; i++) {
    const k = i / (legN - 1)
    push(gmu.lat + (grd.lat - gmu.lat) * k, gmu.lon + (grd.lon - gmu.lon) * k,
      Math.min(3400, gmu.elevationFt + 60 + k * 6000) - (k > 0.75 ? (k - 0.75) * 7000 : 0), 120)
  }
  // Four laps: a rectangle around the field, down to the numbers each time.
  const nmLat = 1 / 60
  const nmLon = nmLat / Math.cos((grd.lat * Math.PI) / 180)
  for (let lap = 0; lap < 4; lap++) {
    // Slight, believable variation lap to lap — nobody flies it identically.
    const wobble = [0, 0.06, -0.05, 0.03][lap]
    const pat = grd.elevationFt + 900 + [0, 25, -15, 10][lap]
    const box: [number, number, number][] = [
      [0.15, 0.0, grd.elevationFt + 380],                    // over the numbers
      [0.9, 0.0, pat - 200],                                  // upwind climb
      [1.3, 0.55 + wobble, pat],                              // crosswind
      [0.2, 1.0 + wobble, pat],                               // downwind
      [-0.9, 0.9 + wobble, pat],                              // base turn
      [-1.1, 0.25, pat - 350],                                // base
      [-0.4, 0.02, grd.elevationFt + 700],                    // final
    ]
    for (const [dLat, dLon, alt] of box) {
      // Ten fixes a side so the circuit reads as a curve, not a triangle.
      const prev = out[out.length - 1]
      const toLat = grd.lat + dLat * nmLat * 2
      const toLon = grd.lon + dLon * nmLon * 2
      // Four fixes a side: eight made an eleven-minute "circuit", which is
      // not a believable GA lap (the real trace flies 4:58).
      for (let i = 1; i <= 4; i++) {
        const k = i / 4
        push(prev.lat + (toLat - prev.lat) * k, prev.lon + (toLon - prev.lon) * k,
          (prev.altFt ?? alt) + (alt - (prev.altFt ?? alt)) * k, 95)
      }
    }
  }
  // Home — climbing away from the LAST lap, not teleporting back down to the
  // runway. Starting this leg at field elevation made the detector see a
  // fifth arrival, so the card claimed five touch-and-goes above a four-row
  // lap table and contradicted itself.
  const leaveAt = out[out.length - 1]?.altFt ?? grd.elevationFt + 700
  for (let i = 0; i < legN; i++) {
    const k = i / (legN - 1)
    push(grd.lat + (gmu.lat - grd.lat) * k, grd.lon + (gmu.lon - grd.lon) * k,
      Math.min(2900, leaveAt + k * 6000) - (k > 0.75 ? (k - 0.75) * 6500 : 0), 118)
  }
  return out
}

export function demoFlights(now = new Date()): (Flight & { fromLabel: string | null; toLabel: string | null })[] {
  // Anchored to UTC days, not local ones: ids built with setHours() shifted
  // under a page left open across local midnight (or a DST change), and the
  // detail fetch then missed its own flight (ship-check, Sep 12).
  const todayUtc = Math.floor(now.getTime() / 86_400_000) * 86_400_000

  // The training flight, built first so it sorts in with the rest.
  const trainStart = Math.round((todayUtc - 2 * 86_400_000) / 1000) + 14 * 3600
  const trainTrack = patternLeg(trainStart)
  const training: (Flight & { fromLabel: string | null; toLabel: string | null })[] = []
  if (trainTrack.length > 10) {
    const last = trainTrack[trainTrack.length - 1]
    const gmuLabel = resolveEnd(trainTrack[0].lat, trainTrack[0].lon, null, true).label
    let dist = 0
    for (let i = 1; i < trainTrack.length; i++) {
      dist += haversineNm(trainTrack[i - 1].lat, trainTrack[i - 1].lon, trainTrack[i].lat, trainTrack[i].lon)
    }
    training.push({
      id: `${DEMO_HEX}-${trainStart}`,
      hex: DEMO_HEX,
      callsign: 'DEMO04',
      startedAt: trainStart,
      endedAt: last.t,
      durationSec: last.t - trainStart,
      from: { lat: trainTrack[0].lat, lon: trainTrack[0].lon },
      to: { lat: last.lat, lon: last.lon },
      distanceNm: Math.round(dist * 10) / 10,
      maxAltFt: Math.max(...trainTrack.map((f) => f.altFt ?? 0)),
      maxGsKt: Math.max(...trainTrack.map((f) => f.gsKt ?? 0)),
      fixCount: trainTrack.length,
      openStart: false,
      openEnd: false,
      departed: true,
      arrived: true,
      pattern: findPatternWork(trainTrack, fieldAt),
      track: trainTrack,
      fromLabel: gmuLabel,
      toLabel: gmuLabel,
    })
  }

  return training.concat(LEGS.map((leg) => {
    const startedAt = Math.round((todayUtc - leg.daysAgo * 86_400_000) / 1000) + leg.hour * 3600
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
      pattern: [],
      track,
      fromLabel: resolveEnd(leg.fromLat, leg.fromLon, null, true).label,
      toLabel: resolveEnd(leg.toLat, leg.toLon, null, true).label,
    }
  })).sort((a, b) => b.startedAt - a.startedAt)
}


/**
 * A believable morning at Greenville Downtown, for demo mode. Generated, and
 * the page says so — the point is to show what a board looks like, not to
 * claim these aeroplanes flew.
 */
export function demoBoard(now = new Date()) {
  const base = Math.floor(now.getTime() / 1000 / 3600) * 3600
  const rows: { hex: string; reg: string; typeCode: string; kind: 'departure' | 'arrival'; otherEnd: string; at: number; durationSec: number; distanceNm: number; touchAndGoes: number }[] = [
    { hex: 'a11111', reg: 'N781PW', typeCode: 'SR22', kind: 'departure', otherEnd: 'Cape Girardeau Regional (CGI)', at: base - 3600, durationSec: 9300, distanceNm: 505, touchAndGoes: 0 },
    { hex: 'a22222', reg: 'N8511M', typeCode: 'BE55', kind: 'departure', otherEnd: 'Knoxville Downtown Island (KDKX)', at: base - 5400, durationSec: 2640, distanceNm: 118, touchAndGoes: 0 },
    { hex: 'a33333', reg: 'N432RJ', typeCode: 'C55B', kind: 'arrival', otherEnd: 'Birmingham-Shuttlesworth International (BHM)', at: base - 7200, durationSec: 3300, distanceNm: 214, touchAndGoes: 0 },
    { hex: 'a44444', reg: 'N575LD', typeCode: 'SR20', kind: 'arrival', otherEnd: 'Greenwood County (KGRD)', at: base - 10800, durationSec: 4700, distanceNm: 152, touchAndGoes: 4 },
    { hex: 'a55555', reg: 'N543KP', typeCode: 'C425', kind: 'departure', otherEnd: 'North Perry (HWO)', at: base - 14400, durationSec: 10800, distanceNm: 611, touchAndGoes: 0 },
  ]
  return rows.map((r) => ({
    id: `${r.hex}-${r.at}`,
    hex: r.hex,
    reg: r.reg,
    typeCode: r.typeCode,
    callsign: null,
    kind: r.kind,
    otherEnd: r.otherEnd,
    startedAt: r.at,
    endedAt: r.at + r.durationSec,
    durationSec: r.durationSec,
    distanceNm: r.distanceNm,
    touchAndGoes: r.touchAndGoes,
    hasTrack: false,
    banked: true,
  }))
}
