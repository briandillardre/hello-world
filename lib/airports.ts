import { haversineNm } from './aircraft-log'

/**
 * Naming the ends of a flight (Brian, Sep 12, sending FlightRadar24
 * screenshots — every row there reads "Cape Girardeau (CGI)", not a pair of
 * coordinates).
 *
 * Data is OurAirports (`lib/data/airports.json`), which is **public domain** —
 * the reason we can bundle it outright, unlike adsbdb's route database, which
 * stays query-and-display. Trimmed to real airfields (no heliports, closed
 * fields, seaplane bases or balloonports) and to the seven fields a label
 * needs: 48,009 rows, ~3 MB, loaded once per lambda and held in memory.
 *
 * Server-only. Nothing here should ever reach the browser bundle.
 */

type Row = [
  ident: string, iata: string, name: string, municipality: string,
  region: string, lat: number, lon: number, size: 1 | 2 | 3, elevationFt: number,
]

export interface Airport {
  /** ICAO-ish identifier: KGMU, and for small US fields sometimes just 5J9. */
  ident: string
  iata: string | null
  name: string
  municipality: string | null
  region: string | null
  lat: number
  lon: number
  /** 1 large · 2 medium · 3 small — the tie-break when two fields overlap. */
  size: 1 | 2 | 3
  /** Field elevation. The key to telling a takeoff from a coverage gap. */
  elevationFt: number
}

// Static import so the bundler ships the data with the lambda; server-only
// modules are the only ones that touch this file.
import AIRPORT_DATA from './data/airports.json'

let rows: Row[] | null = null
/** 1° lat/lon buckets — one flight endpoint touches at most nine of them. */
let grid: Map<string, number[]> | null = null

const cell = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`

function load(): { rows: Row[]; grid: Map<string, number[]> } {
  if (rows && grid) return { rows, grid }
  // The index is built lazily — a request that never names an airport pays
  // only for the (already-bundled) array, not the 48k-entry map.
  // Tolerate either shape: bundlers differ on whether a JSON import arrives
  // as the array or wrapped in `.default`, and a silent `undefined` here
  // would take down every flight row.
  const mod = AIRPORT_DATA as unknown
  const data = (Array.isArray(mod) ? mod : (mod as { default?: unknown })?.default) as Row[] | undefined
  if (!Array.isArray(data)) {
    console.error('airports.json did not load — flight ends will be unnamed')
    rows = []
    grid = new Map()
    return { rows, grid }
  }
  rows = data
  grid = new Map()
  data.forEach((r, i) => {
    const k = cell(r[5], r[6])
    const bucket = grid!.get(k)
    if (bucket) bucket.push(i)
    else grid!.set(k, [i])
  })
  return { rows, grid }
}

const toAirport = (r: Row): Airport => ({
  ident: r[0], iata: r[1] || null, name: r[2],
  municipality: r[3] || null, region: r[4] || null,
  lat: r[5], lon: r[6], size: r[7], elevationFt: r[8] ?? 0,
})

/**
 * The closest airfield to a point, or null when nothing is near enough.
 *
 * `withinNm` defaults to 4: a takeoff or landing fix is on or beside the
 * field, and being generous would confidently name the wrong airport in a
 * city with three of them. A tie inside 1 nm goes to the BIGGER field —
 * a regional jet at a shared site belongs to the airport, not the grass strip
 * across the fence.
 */
export function nearestAirport(lat: number, lon: number, withinNm = 4): Airport | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { rows: all, grid: g } = load()
  let best: Airport | null = null
  let bestNm = Infinity
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      for (const i of g.get(cell(lat + dLat, lon + dLon)) ?? []) {
        const r = all[i]
        const nm = haversineNm(lat, lon, r[5], r[6])
        if (nm > withinNm) continue
        if (nm < bestNm - 1 || (nm < bestNm + 1 && best && r[7] < best.size)) {
          best = toAirport(r)
          bestNm = Math.min(nm, bestNm)
        }
      }
    }
  }
  return best
}

/** Look one up by its identifier or IATA code — "KGMU", "GMU". */
export function findAirport(code: string): Airport | null {
  const q = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{3,4}$/.test(q)) return null
  const { rows: all } = load()
  let iataHit: Airport | null = null
  for (const r of all) {
    if (r[0].toUpperCase() === q) return toAirport(r)
    if (!iataHit && r[1] && r[1].toUpperCase() === q) iataHit = toAirport(r)
  }
  return iataHit
}

/**
 * How a field is written on a flight row: `Greenville Downtown (GMU)`, or the
 * town when the airport's own name says nothing useful.
 */
export function airportLabel(a: Airport | null): string | null {
  if (!a) return null
  const code = a.iata || a.ident
  const place = a.name || a.municipality || code
  return code && code !== place ? `${place} (${code})` : place
}

/**
 * The label for one end of a flight.
 *
 * `sawGround` is `departed` / `arrived`: when nobody saw the aircraft on the
 * ground at that end, the nearest field is a guess, so it is qualified rather
 * than stated. Being wrong about where a flight went is worse than saying
 * "near".
 */
export function endpointLabel(lat: number, lon: number, sawGround: boolean): string | null {
  const a = nearestAirport(lat, lon, sawGround ? 4 : 2)
  const label = airportLabel(a)
  if (!label) return null
  return sawGround ? label : `near ${label}`
}

/**
 * Did this flight really start (or end) at an airfield, or is it just where
 * the receiver network lost interest?
 *
 * The feed's "ground" flag is authoritative when it is there — but on light
 * aircraft at small fields it usually is NOT. N575LD, a Cirrus flying out of
 * Greenville Downtown, has ZERO ground rows in a whole day's trace; its
 * lowest fix is 925 ft against a field elevation of 1,048 ft. Judging that
 * flight by the ground flag alone labelled a perfectly ordinary training
 * flight "part of a flight", which is both wrong and exactly the aircraft the
 * owner cares about.
 *
 * So the second test is geography: an endpoint sitting on top of a known
 * airfield, at that field's own elevation, is a real departure or arrival.
 *
 * @param altFt barometric altitude at the endpoint (MSL, so it is comparable
 *              to field elevation directly)
 */
export function atField(lat: number, lon: number, altFt: number | null, withinNm = 3): Airport | null {
  const a = nearestAirport(lat, lon, withinNm)
  if (!a) return null
  if (altFt == null) return a // on the ground per the feed — believe it
  // Circuit height at a GA field is ~1,000 ft AGL; anything inside that band
  // over the field is taking off or landing, not passing overhead.
  return altFt - a.elevationFt <= 1500 ? a : null
}

export interface FlightEnd {
  /** True when we can honestly say the aircraft was at an airfield here. */
  confirmed: boolean
  label: string | null
  /**
   * The field's identifier, and ONLY when we are confident the aircraft was
   * actually there. Airport boards are built by querying this, so a guess
   * would put a flight on a board it never visited.
   */
  ident: string | null
}

/**
 * One end of a flight, resolved to something a person can read.
 *
 * `sawGround` is the pure core's answer from the feed's own flag; this
 * upgrades it with the field-elevation test above. Anything still
 * unconfirmed is qualified as "near", never stated.
 */
export function resolveEnd(lat: number, lon: number, altFt: number | null, sawGround: boolean): FlightEnd {
  const field = atField(lat, lon, sawGround ? null : altFt)
  if (field) return { confirmed: true, label: airportLabel(field), ident: field.ident }
  const near = nearestAirport(lat, lon, 12)
  const label = airportLabel(near)
  // No ident on an unconfirmed end: "near Hickory" must not put this flight
  // on Hickory's board.
  return { confirmed: false, label: label ? `near ${label}` : null, ident: null }
}
