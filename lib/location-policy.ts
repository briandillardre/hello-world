/**
 * Location privacy by place and shift (migration 132) — the ONE rule for what
 * a worker's phone may leave behind, and where a tag heard by that phone is
 * put on the map. Pure: no I/O and no imports, so the ble-phone route, the
 * shift recorder's route, Go Live and the harness all read the same answer.
 * Harness: `node scripts/location-policy-test.mjs` — run it after ANY change.
 *
 * The principle (from the Motive brief Brian forwarded, Oct 2026): a place
 * and a shift decide what is COLLECTED, not just what alerts fire.
 *
 *   on the clock, outside privacy zones  → the phone's trail is kept; tags it
 *                                          hears ride WITH it (custody)
 *   off the clock                        → nothing of the person is kept; a
 *                                          tag it hears lands, anonymously,
 *                                          on a ~250 m grid cell — or at its
 *                                          exact spot if the tag's asset is
 *                                          in recovery
 *   inside a privacy zone (any time)     → nothing of the person is kept; a
 *                                          tag it hears lands at the zone's
 *                                          centre (recovery included)
 *   Go Live (they turned it on)          → kept, except inside a privacy zone
 *
 * Company trucks and machines are company property — their own trackers are
 * never run through this rule.
 */

export type PhoneFixSource = 'shift' | 'gateway' | 'live'
export type Withheld = 'off_shift' | 'privacy_zone'
/** Why an anonymous sighting sits where it does. */
export type AnonReason = 'off_shift' | 'privacy_zone' | 'recovery'

/** A zone an Admin marked private, as the server reads it. */
export interface PrivacyZoneShape {
  id: string
  name: string
  /** Outer ring, [lng, lat] pairs (GeoJSON order). */
  ring: [number, number][]
}

/** The privacy zone a fix fell in: where its tags are put and how rough that is. */
export interface PrivacyZoneHit {
  id: string
  name: string
  centre: { lat: number; lng: number }
  /** Farthest corner from the centre, metres — the honest "somewhere in here". */
  radiusM: number
}

/** Off the clock a tag's place is snapped to a grid this coarse (metres). */
export const OFF_SHIFT_GRID_M = 250
/** Zone kinds that may be private. Sites and yards are where crews work —
 *  time cards check phones against them — so a flag on one is inert. */
export const PRIVACY_ZONE_KINDS = ['boundary', 'vendor'] as const
/** A custody sighting (truck or on-the-clock phone, exact) this fresh beats a
 *  newer anonymous one near it — same window as TOOL_FRESH_MS. */
export const ANON_YIELD_MS = 25 * 60_000
/** Anonymous sightings of one tool at one place fold into one row while the
 *  gaps stay under this (the pairing log's episode gap). */
export const ANON_FOLD_GAP_MS = 6 * 3_600_000
/** How long an anonymous sighting is kept and shown. */
export const ANON_KEEP_MS = 30 * 86_400_000
/** How long a recovery runs before it ends on its own; an extension gives
 *  it this long again from that moment. */
export const RECOVERY_DAYS = 7

const M_PER_DEG_LAT = 111_320
const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** Metres between two points (haversine). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The centre of the ~cellM grid cell a point falls in. Deterministic (the
 * same spot always lands in the same cell, so repeat sightings fold into one
 * row) and idempotent; the true spot is within half the cell's diagonal
 * (~177 m at 250 m). Columns are sized at the cell row's own latitude, so a
 * cell is ~cellM wide anywhere but the poles.
 */
export function snapToGrid(lat: number, lng: number, cellM: number = OFF_SHIFT_GRID_M): { lat: number; lng: number } {
  const dLat = cellM / M_PER_DEG_LAT
  const row = Math.floor(lat / dLat)
  const cLat = Math.max(-89.9, Math.min(89.9, (row + 0.5) * dLat))
  const cos = Math.max(0.01, Math.cos((cLat * Math.PI) / 180))
  const dLng = cellM / (M_PER_DEG_LAT * cos)
  const col = Math.floor(lng / dLng)
  return { lat: round6(cLat), lng: round6((col + 0.5) * dLng) }
}

/** Ray-casting point-in-polygon on a [lng, lat] ring. */
export function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Area-weighted centre of a ring (planar, metres-true at the ring's own
 *  latitude), falling back to the corners' mean for a sliver. */
export function ringCentre(ring: [number, number][]): { lat: number; lng: number } | null {
  const pts = ring.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop()
  if (pts.length < 3) return null
  const [ox, oy] = pts[0]
  const k = Math.cos((oy * Math.PI) / 180) || 1e-9
  let a2 = 0, cx = 0, cy = 0
  for (let i = 0; i < pts.length; i++) {
    const x0 = (pts[i][0] - ox) * k, y0 = pts[i][1] - oy
    const n = pts[(i + 1) % pts.length]
    const x1 = (n[0] - ox) * k, y1 = n[1] - oy
    const cross = x0 * y1 - x1 * y0
    a2 += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(a2) < 1e-14) {
    return {
      lat: round6(pts.reduce((s, p) => s + p[1], 0) / pts.length),
      lng: round6(pts.reduce((s, p) => s + p[0], 0) / pts.length),
    }
  }
  return { lat: round6(oy + cy / (3 * a2)), lng: round6(ox + cx / (3 * a2) / k) }
}

/** The privacy zone a point is in — the smallest when zones overlap (the
 *  most specific place) — or null. */
export function privacyZoneAt(point: { lat: number; lng: number }, zones: readonly PrivacyZoneShape[]): PrivacyZoneHit | null {
  let best: PrivacyZoneHit | null = null
  for (const z of zones) {
    if (!z.ring || z.ring.length < 3 || !pointInRing(point.lng, point.lat, z.ring)) continue
    const centre = ringCentre(z.ring)
    if (!centre) continue
    const radiusM = Math.round(z.ring.reduce((m, [lng, lat]) => Math.max(m, metresBetween(centre, { lat, lng })), 0))
    if (!best || radiusM < best.radiusM) best = { id: z.id, name: z.name, centre, radiusM: Math.max(1, radiusM) }
  }
  return best
}

/** geofences_json rows → the zones that really are private: the flag is on
 *  AND the kind may be private (a flag left on a zone later turned into a
 *  site is inert — time cards need the crew's points there). */
export function privacyZonesFromRows(rows: readonly { id: string; name?: string | null; kind?: string | null; privacy_zone?: boolean | null; geometry?: unknown }[]): PrivacyZoneShape[] {
  const out: PrivacyZoneShape[] = []
  for (const r of rows) {
    if (r.privacy_zone !== true || !isPrivacyKind(r.kind)) continue
    const g = r.geometry as { type?: string; coordinates?: unknown } | null | undefined
    const ring = g && g.type === 'Polygon' && Array.isArray(g.coordinates) ? (g.coordinates[0] as unknown) : null
    if (!Array.isArray(ring)) continue
    const clean = ring.filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (clean.length >= 3) out.push({ id: r.id, name: r.name || 'Privacy zone', ring: clean.map(([x, y]) => [x, y]) })
  }
  return out
}

export function isPrivacyKind(kind: string | null | undefined): boolean {
  return (PRIVACY_ZONE_KINDS as readonly string[]).includes(kind ?? '')
}

export interface PhoneFixPolicy {
  /** Keep this fix on the person's own phone trail (asset_locations). */
  keepTrail: boolean
  /** Tags heard with this fix ride WITH this phone (tool_associations +
   *  pairing_log name the phone). Only when the trail is kept: a sighting
   *  filed under a person IS a record of where that person was. */
  custody: boolean
  /** Why the fix was not kept — null when it was. */
  withheld: Withheld | null
}

/** What may be kept of one phone fix. */
export function phoneFixPolicy(input: { source: PhoneFixSource; onShift: boolean; privacyZone: PrivacyZoneHit | null }): PhoneFixPolicy {
  if (input.privacyZone) return { keepTrail: false, custody: false, withheld: 'privacy_zone' }
  // Go Live is the person's own choice, on or off the clock.
  if (input.source === 'live') return { keepTrail: true, custody: false, withheld: null }
  if (!input.onShift) return { keepTrail: false, custody: false, withheld: 'off_shift' }
  return { keepTrail: true, custody: input.source === 'gateway', withheld: null }
}

export interface TagPlacement {
  lat: number
  lng: number
  /** How rough the place is on purpose, metres; null = the exact spot. */
  precisionM: number | null
  reason: AnonReason
}

/**
 * Where a tag heard by a phone whose fix is NOT kept goes. Never the person:
 * the row it lands in names no phone. A privacy zone wins over recovery —
 * the zone's centre is close enough to send someone to look, and the zone
 * is a promise made to people.
 */
export function placeTag(fix: { lat: number; lng: number }, ctx: { privacyZone: PrivacyZoneHit | null; inRecovery: boolean }): TagPlacement {
  if (ctx.privacyZone) {
    return { lat: ctx.privacyZone.centre.lat, lng: ctx.privacyZone.centre.lng, precisionM: Math.max(1, Math.round(ctx.privacyZone.radiusM)), reason: 'privacy_zone' }
  }
  if (ctx.inRecovery) return { lat: round6(fix.lat), lng: round6(fix.lng), precisionM: null, reason: 'recovery' }
  const cell = snapToGrid(fix.lat, fix.lng, OFF_SHIFT_GRID_M)
  return { lat: cell.lat, lng: cell.lng, precisionM: OFF_SHIFT_GRID_M, reason: 'off_shift' }
}

/**
 * Who may see an anonymous sighting: the reporting phone's own visibility
 * rank (111 — 0 everyone, 2 managers, 3 admins, 4 owner only). The row never
 * says WHOSE phone, but a tag the owner's hidden phone hears off the clock
 * is still a rough fix on the owner, so it stays at the owner's level — the
 * same rule that keeps a tag riding a hidden truck hidden. A phone not yet on
 * record gets the level it would be created with (the owner's 'master', an
 * Admin's 'admins', the crew's everyone — lib/actions/tracker.ts).
 */
export function reporterRank(phoneVisibilityRank: number | null, who: { isMaster: boolean; role: string | null }): number {
  if (phoneVisibilityRank != null && Number.isFinite(phoneVisibilityRank)) return Math.max(0, Math.min(4, Math.round(phoneVisibilityRank)))
  return who.isMaster ? 4 : who.role === 'admin' ? 3 : 0
}

/** A custody holder keeps a tag this long without hearing it — the matcher's
 *  arbitration window (lib/ble-sightings.ts). */
export const HOLDER_KEEPS_MS = 3 * 3_600_000

/**
 * The level an anonymous sighting is read at: the reporting phone's, raised
 * to the tag's custody holder's while that holder still keeps the tag (a
 * tag aboard a hidden truck is hidden with it — 111 — and a crew phone
 * hearing it beside that truck must not put it back on the crew's map).
 */
export function anonRank(reporter: number, holder: { rank: number; seenMs: number } | null, atMs: number): number {
  if (!holder || !Number.isFinite(holder.seenMs) || atMs - holder.seenMs >= HOLDER_KEEPS_MS) return reporter
  return Math.max(reporter, Math.max(0, Math.min(4, holder.rank)))
}

/** The newest stored anonymous sighting of a tool, as the fold reads it. */
export interface AnonRowLite { lat: number; lng: number; reason: string; lastSeenMs: number; rank: number }

/**
 * Fold one placement into a tool's anonymous history: extend the newest row
 * when it is the same place, for the same reason, seen at the same level and
 * the gap is short; start a new row otherwise; never walk time backwards (a
 * replayed or late report changes nothing).
 */
export function anonFold(last: AnonRowLite | null, next: TagPlacement & { atMs: number; rank: number }): 'extend' | 'insert' | 'skip' {
  if (!Number.isFinite(next.atMs)) return 'skip'
  if (!last || !Number.isFinite(last.lastSeenMs)) return 'insert'
  if (next.atMs <= last.lastSeenMs) return 'skip'
  // Snapped places are exact repeats; an exact (recovery) spot counts as the
  // same place within 30 m — a parked trailer's GPS wander is not a move.
  // A different level is a different row: an owner-only sighting must never
  // extend (or be extended by) one the crew can read.
  const samePlace = last.reason === next.reason && last.rank === next.rank
    && metresBetween(last, next) <= (next.precisionM == null ? 30 : 1)
  return samePlace && next.atMs - last.lastSeenMs <= ANON_FOLD_GAP_MS ? 'extend' : 'insert'
}

/**
 * Which place the map shows for a tool: its custody sighting (a truck or an
 * on-the-clock phone heard it — exact, and it says who) or its newest
 * anonymous one. The anonymous one wins when it is newer, unless a custody
 * sighting heard it near there within ANON_YIELD_MS before (a parked truck
 * re-hearing the tag every minute must not flicker to a rough cell).
 */
export function anonymousWins(
  custody: { seenMs: number; lat?: number | null; lng?: number | null } | null,
  anon: { seenMs: number; lat: number; lng: number; precisionM: number | null },
): boolean {
  if (!Number.isFinite(anon.seenMs)) return false
  if (!custody || !Number.isFinite(custody.seenMs)) return true
  if (anon.seenMs <= custody.seenMs) return false
  if (anon.seenMs - custody.seenMs > ANON_YIELD_MS) return true
  // Fresh custody, but the anonymous sighting is plainly somewhere else: the tag moved.
  if (typeof custody.lat === 'number' && typeof custody.lng === 'number') {
    return metresBetween({ lat: custody.lat, lng: custody.lng }, anon) > (anon.precisionM ?? 0) + 150
  }
  return false
}

/** Plain words for an anonymous sighting — the map sheet, the custody card and Ask AI. */
export function anonPlaceWords(reason: AnonReason | string, precisionM: number | null): { short: string; long: string } {
  if (reason === 'recovery') {
    return { short: 'Recovery · exact spot', long: 'In recovery — a crew phone reported exactly where it heard the tag (not whose phone).' }
  }
  if (reason === 'privacy_zone') {
    return { short: 'In a privacy zone', long: 'Heard inside a privacy zone — shown at the middle of the zone, not where in it.' }
  }
  const m = precisionM ?? OFF_SHIFT_GRID_M
  return { short: `Rough area · ~${m} m`, long: `Heard by a crew phone off the clock — shown to about ${m} m, and not whose phone.` }
}
