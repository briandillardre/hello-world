/**
 * "Rode with" vs "seen by" — what a pairing episode actually was.
 *
 * A pairing episode (pairing_log, migration 021) opens the first time a
 * gateway — a truck's OBD box, a battery unit, a crew phone — hears a tool's
 * Bluetooth tag, and stays open while it keeps hearing it at least every 6 h.
 * That alone says only that the two were NEAR each other. Brian, Sep 24, of
 * the 85A roller's page where every row said "rode with": "Rode with should
 * require it to be moving like more than a half mile with a hub."
 *
 * The rule is WHERE the carrier was each time it heard the tag:
 *   • heard at places ≥ ½ mile apart → rode with (the tag travelled)
 *   • heard in one spot              → seen by  (it went nowhere)
 * — however far the carrier drove in between. That is the whole point: a
 * dump truck that hears a roller at a site, hauls six loads and comes back
 * each time drove 60 miles "with" a roller that never moved (F650 + HAMM
 * roller, Sep 22: 703 sightings, every one within 45 m of the first). The
 * first cut (#158) measured the truck's drive between the first and last
 * sighting and called exactly that a ride.
 *
 * The ingest folds each sighting into the episode as it happens
 * (`foldSighting`, lib/ble-sightings.ts; columns from migration 122):
 *   first      where the carrier first heard the tag
 *   anchor     the last PLACE it heard it — moves only past 250 m, so GPS
 *              wander, or the truck re-parking around a parked machine,
 *              never adds distance
 *   span_m     farthest any sighting has been from the first — the verdict
 *   moved_m    straight-line sum of the moves between places — the miles
 *              shown (a floor: sparse sightings see the ends of a drive,
 *              not its bends)
 *   heard_n    sightings folded; NULL = recorded before 122 and not yet
 *              summarized (the SQL `ht_pairing_summarize` mirrors this fold
 *              for those)
 * Moving sightings are NOT required: the trucks' scanners rarely report a
 * tag on the move (F750 1.6% of moving records, Truck 3 5%), while the real
 * haul in the data — the RAM 3500 with the TL8 and the roller, Jul 14 —
 * was heard at every stop along an 8–12 km route.
 *
 * Pure module. Harness: `node scripts/pairing-ride-test.mjs` — run it after
 * ANY change here (and mirror a change to the fold into 122's SQL).
 */

export type RideKind = 'rode' | 'seen'

const MILE_M = 1609.344
/** Brian's threshold: half a mile with the hub. */
export const RIDE_MIN_M = 0.5 * MILE_M
/** A sighting farther than this from the last place is a new place. The
 *  position is the CARRIER's, and a tag is heard up to ~100 m away on any
 *  side — a truck re-parking around a parked machine (the F750 at a site on
 *  Sep 23–24: spots 160–181 m apart) must never add distance. */
export const PLACE_M = 250
/** An episode shorter than this is one passing sighting: it shows one time,
 *  not "7:43 → 7:43". */
export const INSTANT_MS = 30_000

export interface SightingFix { lat: number; lng: number }

/** The place columns of a pairing_log row (122). */
export interface EpisodePlaces {
  first_lat: number | null
  first_lng: number | null
  anchor_lat: number | null
  anchor_lng: number | null
  span_m: number | null
  moved_m: number | null
  heard_n: number | null
}

export function metres(a: SightingFix, b: SightingFix): number {
  const R = 6_371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A position worth folding: finite, on the globe, and not the 0,0 a
 *  tracker sends while it has no GPS fix. */
export function validFix(f: { lat: unknown; lng: unknown } | null | undefined): f is SightingFix {
  if (!f) return false
  const { lat, lng } = f
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
}

/** The place columns for a brand-new episode opened by this sighting. A fix
 *  without a position still opens a SUMMARIZED episode (heard_n 0), so the
 *  first sighting with one starts the places. */
export function newEpisodePlaces(fix: { lat: unknown; lng: unknown } | null | undefined): EpisodePlaces {
  if (!validFix(fix)) {
    return { first_lat: null, first_lng: null, anchor_lat: null, anchor_lng: null, span_m: 0, moved_m: 0, heard_n: 0 }
  }
  return { first_lat: fix.lat, first_lng: fix.lng, anchor_lat: fix.lat, anchor_lng: fix.lng, span_m: 0, moved_m: 0, heard_n: 1 }
}

/**
 * Fold one more sighting into an open episode. Returns the columns to write,
 * or null when they must not change: a fix without a position, or an episode
 * recorded before 122 (heard_n NULL — its earlier sightings are only in the
 * raw history, so starting its places here would call its first sighting
 * the one heard just now).
 */
export function foldSighting(ep: EpisodePlaces | null | undefined, fix: { lat: unknown; lng: unknown } | null | undefined): EpisodePlaces | null {
  if (!ep || ep.heard_n == null || !validFix(fix)) return null
  const first = { lat: ep.first_lat, lng: ep.first_lng }
  const anchor = { lat: ep.anchor_lat, lng: ep.anchor_lng }
  if (!validFix(first) || !validFix(anchor)) return newEpisodePlaces(fix)
  let moved = Number(ep.moved_m) || 0
  let next: SightingFix = anchor
  const hop = metres(anchor, fix)
  if (hop > PLACE_M) { moved += hop; next = fix }
  const span = Math.max(Number(ep.span_m) || 0, metres(first, fix))
  return {
    first_lat: first.lat, first_lng: first.lng,
    anchor_lat: next.lat, anchor_lng: next.lng,
    span_m: span, moved_m: moved, heard_n: (ep.heard_n || 0) + 1,
  }
}

/** The verdict. Unmeasured (NULL) is a sighting — a ride needs evidence. */
export function rideKind(spanM: number | null | undefined): RideKind {
  return typeof spanM === 'number' && Number.isFinite(spanM) && spanM >= RIDE_MIN_M ? 'rode' : 'seen'
}

/** Metres to show for a ride: the moves between places, never less than
 *  how far the tag got from where it started. */
export function rideMetres(ep: Pick<EpisodePlaces, 'span_m' | 'moved_m'>): number {
  return Math.max(Number(ep.moved_m) || 0, Number(ep.span_m) || 0)
}

/** "0.6 mi", "8.8 mi", "22 mi". */
export function rideMiles(m: number): string {
  const mi = Math.max(0, m) / MILE_M
  return `${mi >= 10 ? String(Math.round(mi)) : (Math.round(mi * 10) / 10).toFixed(1)} mi`
}

/** A single passing sighting (first and last sighting within 30 s). */
export function isInstant(ep: { started_at: string; last_seen: string | null; ended_at: string | null }): boolean {
  const to = ep.last_seen ?? ep.ended_at ?? ep.started_at
  const span = Date.parse(to) - Date.parse(ep.started_at)
  return !(span >= INSTANT_MS)
}

/** The words for each side of an episode, from the page being read. */
export function rideVerb(kind: RideKind, side: 'tool' | 'carrier'): string {
  if (side === 'tool') return kind === 'rode' ? 'rode with' : 'seen by'
  return kind === 'rode' ? 'carried' : 'saw'
}

/**
 * Collapse back-to-back sightings by the same partner into one row — a truck
 * that parks beside a roller every night is one fact ("seen by F650 × 6"),
 * not six rows pushing the rides off the page. Rides always stand alone.
 * Input newest first (as listed); output keeps that order, each group
 * carrying its episodes newest first.
 */
export function groupSightings<T>(rows: T[], partnerOf: (r: T) => string, kindOf: (r: T) => RideKind): T[][] {
  const out: T[][] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && kindOf(r) === 'seen' && kindOf(last[0]) === 'seen' && partnerOf(last[0]) === partnerOf(r)) last.push(r)
    else out.push([r])
  }
  return out
}
