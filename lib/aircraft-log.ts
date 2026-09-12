/**
 * Flight log — the pure math (Brian, Sep 12: "plane flight log history …
 * search tail numbers, see all prior flights, save planes").
 *
 * Everything here is a pure function over an adsb.lol readsb trace file, so
 * the harness can drive it against real baked traces with no network and no
 * database: `./scripts/flightlog-test/run.sh` — run it after ANY change in
 * this file. A flight log that invents a takeoff, or silently merges two
 * trips into one, is worse than no log at all.
 *
 * WHAT THE UPSTREAM ACTUALLY GIVES US (verified by live probe, Sep 12 2026):
 *   • today            adsb.lol/data/traces/<xx>/trace_full_<hex>.json
 *   • archived days    adsb.lol/globe_history/YYYY/MM/DD/traces/<xx>/…
 *   • retention        a ROLLING ~30 DAYS (Aug 12 answered, Aug 5 was gone)
 * One file = one UTC day for one airframe. Past 30 days there is no free
 * source at any price, which is exactly why saving a plane banks its flights
 * into our own tables — see docs/FLIGHT-LOG.md.
 *
 * A trace fix is a positional array:
 *   [0] seconds after the file's `timestamp`
 *   [1] lat            [2] lon
 *   [3] barometric altitude in feet, or the STRING "ground"
 *   [4] ground speed kt                [5] track deg
 *   [6] flags          [7] baro rate fpm (vertical speed, ~87% populated)
 *   [8] details object (carries `flight`, the callsign)
 */

/** One position report, normalised. `altFt: null` means "on the ground". */
export interface Fix {
  /** Epoch SECONDS (not ms) — trace files are second-resolution. */
  t: number
  lat: number
  lon: number
  altFt: number | null
  gsKt: number | null
  trackDeg: number | null
  vsFpm: number | null
}

/** Who the airframe is, as the trace file itself reports it. */
export interface TraceIdent {
  hex: string
  reg: string | null
  typeCode: string | null
  desc: string | null
  owner: string | null
  year: string | null
}

export interface ParsedTrace {
  ident: TraceIdent
  fixes: Fix[]
}

export interface Flight {
  /** Stable across re-reads of the same day: hex + takeoff second. */
  id: string
  hex: string
  callsign: string | null
  /** Epoch seconds. */
  startedAt: number
  endedAt: number
  durationSec: number
  from: { lat: number; lon: number }
  to: { lat: number; lon: number }
  /** Along-track great-circle distance, nautical miles. */
  distanceNm: number
  maxAltFt: number
  maxGsKt: number
  fixCount: number
  /**
   * The segment touches the very start / end of its day file, so it may be
   * the tail or head of a flight that crosses UTC midnight. `stitchFlights`
   * uses these; the UI never shows a half flight as a whole one.
   */
  openStart: boolean
  openEnd: boolean
  /**
   * We actually SAW this aircraft on the ground either side of the segment,
   * so the takeoff / landing is real rather than the first and last thing a
   * receiver happened to hear.
   *
   * A segment with neither is a coverage fragment, not a trip — an airliner
   * with a hole in its track produced an "11 minute, 63 nm flight starting at
   * 25,000 ft", which is obviously nothing of the sort. Splitting there is
   * right (we will not draw a line through an hour we cannot see), but the
   * UI has to say what it is looking at. `isPartial()` is that question.
   */
  departed: boolean
  arrived: boolean
  track: Fix[]
}

/** Neither end of this flight was seen on the ground — a coverage fragment. */
export const isPartial = (f: Pick<Flight, 'departed' | 'arrived'>): boolean => !f.departed && !f.arrived

export interface SegmentOpts {
  /** A ground stop at least this long ends the flight. */
  groundBreakSec?: number
  /** A hole in the data at least this long ends the flight. */
  gapBreakSec?: number
  /** Airborne runs shorter than this are noise, not trips. */
  minFlightSec?: number
  /**
   * …and a self-contained trip climbs at least this far. Applied ONLY to
   * segments closed at both ends: a fragment that runs to the edge of its
   * day file is half of something bigger, and the far side of a red-eye is
   * pure cruise with no climb in it at all. Judging a fragment by its own
   * climb deleted every midnight crossing (caught by the harness).
   */
  minClimbFt?: number
}

const DEFAULTS: Required<SegmentOpts> = {
  groundBreakSec: 240,
  gapBreakSec: 900,
  minFlightSec: 180,
  minClimbFt: 500,
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Altitude, with the ground sentinel preserved as null.
 *
 * Deliberately NOT "altitude below N feet = on the ground": barometric
 * altitude is above sea level, so a jet parked at Denver reads ~5,300 ft and
 * every takeoff from a high-elevation field would go missing. The feed's own
 * "ground" flag is the only trustworthy answer, so it is the only one used.
 */
function altOf(v: unknown): number | null {
  if (v === 'ground') return null
  const n = num(v)
  return n == null ? null : Math.round(n)
}

/** Great-circle distance in nautical miles. */
export function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3440.065 // earth radius, nm
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Read one trace file into normalised fixes.
 *
 * Returns null for anything that is not a trace — a 404 HTML body, an empty
 * archive, a truncated gzip. Callers treat null as "no data for that day",
 * which is a real and common answer (the aircraft simply did not fly).
 */
export function parseTrace(raw: unknown): ParsedTrace | null {
  if (!raw || typeof raw !== 'object') return null
  const j = raw as Record<string, unknown>
  const base = num(j.timestamp)
  const hex = typeof j.icao === 'string' ? j.icao.toLowerCase().replace(/[^0-9a-f]/g, '') : ''
  // Exactly six: a longer string would build an id no route regex matches
  // and a row the CHECK constraint rejects.
  if (base == null || hex.length !== 6 || !Array.isArray(j.trace)) return null

  const str = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s ? s : null
  }
  const ident: TraceIdent = {
    hex,
    reg: str(j.r),
    typeCode: str(j.t),
    desc: str(j.desc),
    owner: str(j.ownOp),
    year: str(j.year),
  }

  const fixes: Fix[] = []
  for (const row of j.trace as unknown[]) {
    if (!Array.isArray(row)) continue
    const dt = num(row[0])
    const lat = num(row[1])
    const lon = num(row[2])
    if (dt == null || lat == null || lon == null) continue
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const gs = num(row[4])
    const trk = num(row[5])
    const vs = num(row[7])
    fixes.push({
      t: Math.round(base + dt),
      lat,
      lon,
      altFt: altOf(row[3]),
      gsKt: gs == null ? null : Math.round(gs),
      trackDeg: trk == null ? null : Math.round(trk),
      vsFpm: vs == null ? null : Math.round(vs),
    })
  }
  // readsb writes them in order, but a merged file must never be trusted to.
  fixes.sort((a, b) => a.t - b.t)
  return { ident, fixes }
}

/** The callsign the aircraft was squawking, from the details blob. */
function callsignOf(rows: unknown[], from: number, to: number): string | null {
  for (let i = from; i <= to && i < rows.length; i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const d = row[8]
    if (d && typeof d === 'object' && typeof (d as { flight?: unknown }).flight === 'string') {
      const cs = (d as { flight: string }).flight.trim()
      if (cs) return cs
    }
  }
  return null
}

/**
 * Fill in vertical speed wherever the feed did not report one.
 *
 * Derived from the altitude either side of the fix rather than the step
 * before it, so a single jittery altitude reading cannot spike the chart.
 * Mutates nothing — returns a new array.
 */
export function deriveVerticalSpeed(fixes: Fix[]): Fix[] {
  return fixes.map((f, i) => {
    if (f.vsFpm != null || f.altFt == null) return f
    let prev: Fix | null = null
    let next: Fix | null = null
    for (let j = i - 1; j >= 0 && i - j <= 4; j--) if (fixes[j].altFt != null) { prev = fixes[j]; break }
    for (let j = i + 1; j < fixes.length && j - i <= 4; j++) if (fixes[j].altFt != null) { next = fixes[j]; break }
    if (!prev || !next) return f
    const dt = next.t - prev.t
    if (dt <= 0 || dt > 300) return f
    const fpm = ((next.altFt! - prev.altFt!) / dt) * 60
    // Beyond this is a data artefact, not an aeroplane.
    if (!Number.isFinite(fpm) || Math.abs(fpm) > 12000) return f
    return { ...f, vsFpm: Math.round(fpm) }
  })
}

/**
 * Evenly thin a track to at most `max` points, always keeping the first and
 * last (the takeoff and landing positions are the two that must survive).
 */
export function downsampleTrack(fixes: Fix[], max = 400): Fix[] {
  if (fixes.length <= max || max < 2) return fixes.slice()
  const out: Fix[] = []
  const step = (fixes.length - 1) / (max - 1)
  for (let i = 0; i < max - 1; i++) out.push(fixes[Math.round(i * step)])
  out.push(fixes[fixes.length - 1])
  return out
}

/**
 * Cut one day of fixes into flights.
 *
 * A flight is a run of airborne fixes, ended by a ground stop of
 * `groundBreakSec` or a hole in the data of `gapBreakSec`. Short hops that
 * never climb are dropped: a taxiing aircraft whose ground flag flickers
 * must not turn into a two-minute "flight".
 *
 * `rawRows` is the original `trace` array, used only to read callsigns.
 */
export function segmentFlights(
  hex: string,
  fixes: Fix[],
  rawRows: unknown[] = [],
  opts: SegmentOpts = {},
): Flight[] {
  const o = { ...DEFAULTS, ...opts }
  const withVs = deriveVerticalSpeed(fixes)
  const flights: Flight[] = []

  let start = -1 // index of the first airborne fix of the run in progress
  let last = -1  // index of the most recent airborne fix
  let groundSince: number | null = null

  /** Was the aircraft seen on the ground just before / after this run? */
  const groundNear = (idx: number, dir: -1 | 1): boolean => {
    for (let i = idx + dir; i >= 0 && i < withVs.length; i += dir) {
      if (withVs[i].altFt == null) return true
      // Only look across the immediate boundary, not the whole day.
      if (Math.abs(withVs[i].t - withVs[idx].t) > o.groundBreakSec * 2) return false
    }
    return false
  }

  const close = (endIdx: number, openEndOfFile: boolean) => {
    if (start < 0 || endIdx <= start) { start = -1; last = -1; return }
    const seg = withVs.slice(start, endIdx + 1)
    const airborne = seg.filter((f) => f.altFt != null)
    if (airborne.length < 2) { start = -1; last = -1; return }
    const durationSec = airborne[airborne.length - 1].t - airborne[0].t
    const alts = airborne.map((f) => f.altFt as number)
    const maxAltFt = Math.max(...alts)
    const climb = maxAltFt - Math.min(...alts)
    const openStart = start === 0
    const openEnd = openEndOfFile && endIdx === withVs.length - 1
    // A fragment is only ever half a flight — the climb test would throw away
    // the cruising far side of every midnight crossing.
    const selfContained = !openStart && !openEnd
    if (durationSec < o.minFlightSec) { start = -1; last = -1; return }
    if (selfContained && climb < o.minClimbFt) { start = -1; last = -1; return }
    let distanceNm = 0
    for (let i = 1; i < airborne.length; i++) {
      distanceNm += haversineNm(airborne[i - 1].lat, airborne[i - 1].lon, airborne[i].lat, airborne[i].lon)
    }
    const gss = airborne.map((f) => f.gsKt ?? 0)
    const a0 = airborne[0]
    const aN = airborne[airborne.length - 1]
    flights.push({
      id: `${hex}-${a0.t}`,
      hex,
      callsign: callsignOf(rawRows, start, endIdx),
      startedAt: a0.t,
      endedAt: aN.t,
      durationSec,
      from: { lat: a0.lat, lon: a0.lon },
      to: { lat: aN.lat, lon: aN.lon },
      distanceNm: Math.round(distanceNm * 10) / 10,
      maxAltFt,
      maxGsKt: Math.round(Math.max(0, ...gss)),
      fixCount: airborne.length,
      openStart,
      openEnd,
      departed: groundNear(start, -1),
      arrived: groundNear(endIdx, 1),
      track: downsampleTrack(airborne),
    })
    start = -1
    last = -1
  }

  for (let i = 0; i < withVs.length; i++) {
    const f = withVs[i]
    const prev = i > 0 ? withVs[i - 1] : null
    // A hole in the data ends whatever was in progress — we do not know what
    // happened in the missing hour, so we refuse to draw a line through it.
    if (prev && f.t - prev.t >= o.gapBreakSec) {
      close(last, false)
      groundSince = null
    }
    if (f.altFt == null) {
      if (groundSince == null) groundSince = f.t
      if (start >= 0 && f.t - groundSince >= o.groundBreakSec) close(last, false)
      continue
    }
    groundSince = null
    if (start < 0) start = i
    last = i
  }
  close(last, true)
  return flights
}

/**
 * Join the two halves of a flight that crossed UTC midnight.
 *
 * Day files are cut at midnight, so a red-eye lands in two files as an
 * `openEnd` segment and an `openStart` segment. They are the same flight only
 * if they meet at the boundary in BOTH time and space — a coincidence of
 * timing is not enough, or two unrelated trips either side of midnight would
 * be welded into one impossible leg.
 *
 * Pass every day's flights in chronological order.
 */
export function stitchFlights(flights: Flight[], maxGapSec = 900, maxJumpNm = 40): Flight[] {
  const sorted = flights.slice().sort((a, b) => a.startedAt - b.startedAt)
  const out: Flight[] = []
  for (const f of sorted) {
    const prev = out[out.length - 1]
    const meets =
      prev &&
      prev.openEnd &&
      f.openStart &&
      f.startedAt - prev.endedAt >= 0 &&
      f.startedAt - prev.endedAt <= maxGapSec &&
      haversineNm(prev.to.lat, prev.to.lon, f.from.lat, f.from.lon) <= maxJumpNm
    if (!meets) { out.push({ ...f }); continue }
    const track = downsampleTrack(prev.track.concat(f.track))
    let distanceNm = prev.distanceNm + f.distanceNm
    distanceNm += haversineNm(prev.to.lat, prev.to.lon, f.from.lat, f.from.lon)
    out[out.length - 1] = {
      ...prev,
      callsign: prev.callsign ?? f.callsign,
      endedAt: f.endedAt,
      durationSec: f.endedAt - prev.startedAt,
      to: f.to,
      distanceNm: Math.round(distanceNm * 10) / 10,
      maxAltFt: Math.max(prev.maxAltFt, f.maxAltFt),
      maxGsKt: Math.max(prev.maxGsKt, f.maxGsKt),
      fixCount: prev.fixCount + f.fixCount,
      openEnd: f.openEnd,
      departed: prev.departed,
      arrived: f.arrived,
      track,
    }
  }
  return out
}

/** Every flight in a set of day files, midnight crossings already joined. */
export function flightsFromTraces(
  traces: { raw: unknown }[],
  opts: SegmentOpts = {},
): { ident: TraceIdent | null; flights: Flight[] } {
  let ident: TraceIdent | null = null
  let identAt = -Infinity
  const all: Flight[] = []
  for (const { raw } of traces) {
    const parsed = parseTrace(raw)
    if (!parsed) continue
    // The NEWEST file wins: an airframe can be re-registered, and the newest
    // file carries the name it wears now. Picking "the last one processed"
    // silently took the OLDEST, because the callers hand days back
    // newest-first (ship-check, Sep 12).
    const at = parsed.fixes[0]?.t ?? -Infinity
    if (at >= identAt) { ident = parsed.ident; identAt = at }
    const rows = (raw as { trace?: unknown[] }).trace ?? []
    all.push(...segmentFlights(parsed.ident.hex, parsed.fixes, rows, opts))
  }
  return { ident, flights: stitchFlights(all) }
}

// ── Formatting shared by the page, the map sheet and the CSV ──────────────

export const fmtDuration = (sec: number): string => {
  const m = Math.max(0, Math.round(sec / 60))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** A registration as people type it: N628ts / n-628ts → N628TS. */
export const normalizeReg = (s: string): string => s.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')

/** An icao24 hex, or null when the text is not one. */
export const asHex = (s: string): string | null => {
  const h = s.trim().toLowerCase().replace(/[^0-9a-f]/g, '')
  return /^[0-9a-f]{6}$/.test(h) && h === s.trim().toLowerCase() ? h : null
}
