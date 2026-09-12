import type { SupabaseClient } from '@supabase/supabase-js'
import { flightsFromTraces, stitchFlights, type Flight } from '../aircraft-log'
import { ARCHIVE_DAYS, availableDays, fetchTraceDays, utcDay } from '../aircraft-source'

/**
 * Flight log storage (migration 108).
 *
 * Two sources answer one question, and the split matters:
 *  • BANKED  — rows in `aircraft_flights`, written nightly for saved planes.
 *              Permanent. The only thing that can answer past day 30.
 *  • ARCHIVE — adsb.lol's rolling ~30-day window, read live.
 * `getFlights` reads banked first and only reaches upstream for days it does
 * not already hold, so a saved plane's log gets cheaper the longer you keep
 * it and a plane nobody saved still answers instantly for the last month.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SavedAircraft {
  id: string
  hex: string
  reg: string | null
  typeCode: string | null
  descr: string | null
  owner: string | null
  label: string | null
  notes: string | null
  lastSyncedAt: string | null
  lastFlightAt: string | null
  createdAt: string
}

export const MOCK_SAVED: SavedAircraft[] = [
  { id: 'ac-1', hex: 'a835af', reg: 'N628TS', typeCode: 'GLF6', descr: 'Gulfstream G650', owner: null, label: 'Demo aircraft', notes: null, lastSyncedAt: null, lastFlightAt: null, createdAt: '2026-09-01T12:00:00Z' },
]

interface SavedRow {
  id: string; hex: string; reg: string | null; type_code: string | null
  descr: string | null; owner: string | null; label: string | null; notes: string | null
  last_synced_at: string | null; last_flight_at: string | null; created_at: string
}

const toSaved = (r: SavedRow): SavedAircraft => ({
  id: r.id, hex: r.hex, reg: r.reg, typeCode: r.type_code, descr: r.descr,
  owner: r.owner, label: r.label, notes: r.notes,
  lastSyncedAt: r.last_synced_at, lastFlightAt: r.last_flight_at, createdAt: r.created_at,
})

const SAVED_COLS = 'id, hex, reg, type_code, descr, owner, label, notes, last_synced_at, last_flight_at, created_at'

export async function getSavedAircraft(companyId: string): Promise<SavedAircraft[]> {
  if (isMock) return MOCK_SAVED
  try {
    const { createClient } = await import('../supabase-server')
    const { data, error } = await createClient()
      .from('aircraft_saved')
      .select(SAVED_COLS)
      .eq('company_id', companyId)
      .eq('active', true)
      .order('created_at', { ascending: false })
    if (error) return [] // 108 not applied yet — the page shows its empty state
    return ((data ?? []) as SavedRow[]).map(toSaved)
  } catch {
    return []
  }
}

/** Every airframe any company has saved — the cron's work list. */
export async function getAllSavedHexes(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from('aircraft_saved').select('hex').eq('active', true)
  if (error) return []
  return Array.from(new Set(((data ?? []) as { hex: string }[]).map((r) => r.hex)))
}

// ── Banked flights ────────────────────────────────────────────────────────

interface FlightRow {
  id: string; hex: string; callsign: string | null
  started_at: string; ended_at: string; duration_sec: number
  from_lat: number; from_lng: number; to_lat: number; to_lng: number
  from_label: string | null; to_label: string | null
  distance_nm: number; max_alt_ft: number; max_gs_kt: number
  fix_count: number; track: unknown; open_ended: boolean
  departed: boolean | null; arrived: boolean | null
}

/** A flight as the API hands it out: our Flight plus where it was banked. */
export interface LoggedFlight extends Flight {
  banked: boolean
  fromLabel: string | null
  toLabel: string | null
}

const rowToFlight = (r: FlightRow): LoggedFlight => ({
  id: r.id,
  hex: r.hex,
  callsign: r.callsign,
  startedAt: Math.round(new Date(r.started_at).getTime() / 1000),
  endedAt: Math.round(new Date(r.ended_at).getTime() / 1000),
  durationSec: r.duration_sec,
  from: { lat: r.from_lat, lon: r.from_lng },
  to: { lat: r.to_lat, lon: r.to_lng },
  distanceNm: r.distance_nm,
  maxAltFt: r.max_alt_ft,
  maxGsKt: r.max_gs_kt,
  fixCount: r.fix_count,
  openStart: false,
  openEnd: r.open_ended,
  // Rows banked before the flags existed are treated as complete flights,
  // which is what they were assumed to be when they were written.
  departed: r.departed ?? true,
  arrived: r.arrived ?? true,
  track: Array.isArray(r.track) ? (r.track as Flight['track']) : [],
  banked: true,
  fromLabel: r.from_label,
  toLabel: r.to_label,
})

const flightToRow = (f: Flight) => ({
  id: f.id,
  hex: f.hex,
  callsign: f.callsign,
  started_at: new Date(f.startedAt * 1000).toISOString(),
  ended_at: new Date(f.endedAt * 1000).toISOString(),
  duration_sec: f.durationSec,
  from_lat: f.from.lat, from_lng: f.from.lon,
  to_lat: f.to.lat, to_lng: f.to.lon,
  distance_nm: f.distanceNm,
  max_alt_ft: f.maxAltFt,
  max_gs_kt: f.maxGsKt,
  fix_count: f.fixCount,
  track: f.track,
  open_ended: f.openEnd,
  departed: f.departed,
  arrived: f.arrived,
  banked_at: new Date().toISOString(),
})

/**
 * Write flights we derived into the permanent log.
 *
 * Upsert on the id (hex + takeoff second), so re-running the cron over a day
 * it has already read changes nothing — except for a flight still flagged
 * open, which is allowed to grow a second half when tomorrow's file lands.
 */
export async function bankFlights(db: SupabaseClient, flights: Flight[]): Promise<number> {
  if (!flights.length) return 0
  let written = 0
  for (let i = 0; i < flights.length; i += 50) {
    const chunk = flights.slice(i, i + 50).map(flightToRow)
    const { error } = await db.from('aircraft_flights').upsert(chunk, { onConflict: 'id' })
    if (error) { console.error('bankFlights failed', error.message); continue }
    written += chunk.length
  }
  return written
}

/** Banked rows for one airframe, newest first. */
export async function getBankedFlights(
  db: SupabaseClient,
  hex: string,
  sinceIso: string,
  withTrack = false,
): Promise<LoggedFlight[]> {
  const base = 'id, hex, callsign, started_at, ended_at, duration_sec, from_lat, from_lng, to_lat, to_lng, from_label, to_label, distance_nm, max_alt_ft, max_gs_kt, fix_count, open_ended, departed, arrived'
  const cols = withTrack ? `${base}, track` : base
  const { data, error } = await db
    .from('aircraft_flights')
    .select(cols)
    .eq('hex', hex)
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(500)
  if (error) return []
  return ((data ?? []) as unknown as FlightRow[]).map(rowToFlight)
}

/** One banked flight with its track, for the charts. */
export async function getBankedFlight(db: SupabaseClient, id: string): Promise<LoggedFlight | null> {
  const { data, error } = await db
    .from('aircraft_flights')
    .select('id, hex, callsign, started_at, ended_at, duration_sec, from_lat, from_lng, to_lat, to_lng, from_label, to_label, distance_nm, max_alt_ft, max_gs_kt, fix_count, open_ended, departed, arrived, track')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return rowToFlight(data as unknown as FlightRow)
}

export interface FlightLogResult {
  flights: LoggedFlight[]
  /** Days we could not answer for because they aged out of the archive and
   *  nobody had saved the plane in time. The UI says this out loud. */
  beyondArchive: boolean
  /** The oldest day this answer actually covers. */
  oldestDay: string
}

/**
 * The flight log for one airframe over the last `days` days.
 *
 * Banked rows win: they are ours, permanent, and already stitched. Only the
 * days with nothing banked are read from upstream, so a saved plane costs
 * one archive fetch per day ever, and an unsaved one costs the window.
 */
export async function getFlights(
  db: SupabaseClient,
  hex: string,
  days: number,
  opts: { withTrack?: boolean; now?: Date } = {},
): Promise<FlightLogResult> {
  const now = opts.now ?? new Date()
  const span = Math.max(1, Math.min(days, 400))
  const sinceMs = now.getTime() - span * 86_400_000
  const banked = await getBankedFlights(db, hex, new Date(sinceMs).toISOString(), opts.withTrack)

  // Which UTC days already have something banked? A day with a banked flight
  // needs no upstream read — that is the whole saving.
  const haveDay = new Set(banked.map((f) => utcDay(new Date(f.startedAt * 1000))))
  const live = availableDays(now, Math.min(span, ARCHIVE_DAYS)).filter((d) => !haveDay.has(d))

  let fresh: Flight[] = []
  if (live.length) {
    const traces = await fetchTraceDays(hex, live, now)
    fresh = flightsFromTraces(traces).flights
  }

  // Same flight from both sides = the banked one, which the cron may have
  // already stitched across a midnight the live read cannot see.
  const byId = new Map<string, LoggedFlight>()
  for (const f of fresh) byId.set(f.id, { ...f, banked: false, fromLabel: null, toLabel: null })
  for (const f of banked) byId.set(f.id, f)

  const merged = stitchFlights(Array.from(byId.values())) as LoggedFlight[]
  const flights = merged
    .filter((f) => f.startedAt * 1000 >= sinceMs)
    .sort((a, b) => b.startedAt - a.startedAt)

  return {
    flights,
    beyondArchive: span > ARCHIVE_DAYS && !banked.length,
    oldestDay: utcDay(new Date(sinceMs)),
  }
}
