/**
 * Location privacy by place and shift (migrations 132 + 133) — the ONE rule
 * for what a worker's phone may leave behind, and where a tag heard by that
 * phone is put on the map. Pure: no I/O and no imports, so the ble-phone
 * route, the shift recorder's route, Go Live (lib/phone-location.ts) and the
 * harness all read the same answer.
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
 *                                          in recovery (read by Admins and
 *                                          the owner only)
 *   inside a privacy zone (any time)     → nothing of the person is kept; a
 *                                          tag it hears lands on the 250 m
 *                                          grid cell of the zone's centre,
 *                                          never finer (recovery included).
 *                                          "Inside" reaches 50–150 m past the
 *                                          edge (the fix's own accuracy), and
 *                                          a site or yard always wins: crews
 *                                          work there, time cards check it
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
  /** A personal ("only me") zone: its maker. Null/absent = company-wide. */
  ownerId?: string | null
  /** The maker's ladder rank (111: 4 owner … 0 crew); unknown = owner-only. */
  ownerRank?: number | null
}

/** A site or yard — where crews work. A fix inside one is never withheld by
 *  a privacy zone that overlaps it (or reaches it — its edge counts 150 m
 *  out): time cards check the phones there. */
export interface WorkZoneShape {
  id: string
  ring: [number, number][]
}

/** What the server reads to decide: the private zones, and the sites/yards
 *  near them (lib/location-privacy `loadPrivacyZones`). */
export interface PrivacyZoneSet {
  zones: readonly PrivacyZoneShape[]
  work: readonly WorkZoneShape[]
}

/** The privacy zone a fix fell in: where its tags are put and how rough that is. */
export interface PrivacyZoneHit {
  id: string
  name: string
  centre: { lat: number; lng: number }
  /** Farthest corner from the centre, metres — the honest "somewhere in here". */
  radiusM: number
  /** A personal ("only me") zone's maker; null = company-wide. */
  ownerId: string | null
  /** The maker's ladder rank; null = unknown (read as owner-only). */
  ownerRank: number | null
}

/** Off the clock a tag's place is snapped to a grid this coarse (metres). */
export const OFF_SHIFT_GRID_M = 250
/** Zone kinds that may be private. Sites and yards are where crews work —
 *  time cards check phones against them — so a flag on one is inert. */
export const PRIVACY_ZONE_KINDS = ['boundary', 'vendor'] as const
/** Where crews work: a fix inside one is kept even inside a privacy zone. */
export const WORK_ZONE_KINDS = ['site', 'yard'] as const
/** A fix this close to a privacy zone's edge counts as inside it: GPS
 *  scatter must not leak points around a small zone (a house lot). The fix's
 *  own accuracy decides, clamped to this range (metres). */
export const PRIVACY_EDGE_MIN_M = 50
export const PRIVACY_EDGE_MAX_M = 150
/** A custody sighting (truck or on-the-clock phone, exact) this fresh beats a
 *  newer anonymous one near it — same window as TOOL_FRESH_MS. */
export const ANON_YIELD_MS = 25 * 60_000
/** Anonymous sightings of one tool at one place fold into one row while the
 *  gaps stay under this (the pairing log's episode gap). */
export const ANON_FOLD_GAP_MS = 6 * 3_600_000
/** A tool heard at a new place within this of its last sighting, by a row
 *  that never settled where it was, is still on the move: the row follows
 *  it instead of a new row per grid cell. */
export const ANON_RUN_GAP_MS = 10 * 60_000
/** A row heard this long at one place has settled there: leaving starts a
 *  new row, so where it sat (overnight, say) stays in its history. */
export const ANON_SETTLE_MS = 10 * 60_000
/** At most about one NEW anonymous row per tool this often — whatever the
 *  phones (or a forged report) post. */
export const ANON_INSERT_GAP_MS = 2 * 60_000
/** How long an anonymous sighting is kept and shown. */
export const ANON_KEEP_MS = 30 * 86_400_000
/** How long a recovery runs before it ends on its own; an extension gives
 *  it this long again from that moment. */
export const RECOVERY_DAYS = 7
/** A recovery never runs longer than this from its start — past it, stop it
 *  and start a fresh one with a reason. Migration 133 enforces it too. */
export const RECOVERY_MAX_DAYS = 30
/** An exact (recovery) spot is read by Admins and the owner only (111's
 *  ladder: 3 = Admins). Crew phones report it; crew do not read it. */
export const RECOVERY_MIN_RANK = 3

const M_PER_DEG_LAT = 111_320
const round6 = (v: number) => Math.round(v * 1e6) / 1e6
/** A rank on 111's ladder: 0 everyone … 4 owner only. */
const clampRank = (r: number) => Math.max(0, Math.min(4, Math.round(r)))

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
export function pointInRing(lng: number, lat: number, ring: readonly (readonly [number, number])[]): boolean {
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

/**
 * Metres from a point to a ring's nearest edge — the same inside or out, 0 on
 * the edge. A flat projection at the point's own latitude: exact enough at
 * the ≤ 150 m this is asked about.
 */
export function metresToRing(point: { lat: number; lng: number }, ring: readonly [number, number][]): number {
  const kx = M_PER_DEG_LAT * Math.cos((point.lat * Math.PI) / 180)
  const ky = M_PER_DEG_LAT
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - point.lng) * kx, ay = (ring[j][1] - point.lat) * ky
    const bx = (ring[i][0] - point.lng) * kx, by = (ring[i][1] - point.lat) * ky
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/** How far past a privacy zone's edge a fix still counts as inside: its own
 *  accuracy, never under 50 m (no accuracy = 50) nor over 150 m. */
export function privacyEdgeM(accuracyM?: number | null): number {
  const a = typeof accuracyM === 'number' && Number.isFinite(accuracyM) ? accuracyM : 0
  return Math.max(PRIVACY_EDGE_MIN_M, Math.min(PRIVACY_EDGE_MAX_M, a))
}

function asZoneSet(z: readonly PrivacyZoneShape[] | PrivacyZoneSet): PrivacyZoneSet {
  return Array.isArray(z) ? { zones: z as readonly PrivacyZoneShape[], work: [] } : (z as PrivacyZoneSet)
}

/**
 * The privacy zone a fix is in — the smallest when zones overlap (the most
 * specific place) — or null. "In" = inside the ring, or within the fix's own
 * accuracy of its edge (50–150 m, `privacyEdgeM`): a phone in a small house
 * lot scatters 30–80 m and every stray point outside the lot would otherwise
 * be kept, tracing the house. A fix inside a site or yard (`zones.work`) is
 * never in a privacy zone: crews work there and their time cards check the
 * phones there (a private boundary drawn over a site used to drop on-site
 * shift points and read as "Never on site").
 */
export function privacyZoneAt(
  point: { lat: number; lng: number },
  zones: readonly PrivacyZoneShape[] | PrivacyZoneSet,
  opts: {
    accuracyM?: number | null
    /** Only the zones this person may know exist (`privacyZoneVisibleTo`):
     *  what a REPLY may say. Where the tag goes is decided by every zone. */
    onlyVisibleTo?: string | null
  } = {},
): PrivacyZoneHit | null {
  const set = asZoneSet(zones)
  if (!set.zones.length || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null
  const edge = privacyEdgeM(opts.accuracyM)
  let best: PrivacyZoneHit | null = null
  for (const z of set.zones) {
    if (!z.ring || z.ring.length < 3) continue
    if (opts.onlyVisibleTo !== undefined && !privacyZoneVisibleTo({ ownerId: z.ownerId || null }, opts.onlyVisibleTo)) continue
    if (!pointInRing(point.lng, point.lat, z.ring) && !(metresToRing(point, z.ring) <= edge)) continue
    const centre = ringCentre(z.ring)
    if (!centre) continue
    const radiusM = Math.round(z.ring.reduce((m, [lng, lat]) => Math.max(m, metresBetween(centre, { lat, lng })), 0))
    if (!best || radiusM < best.radiusM) {
      best = {
        id: z.id, name: z.name, centre, radiusM: Math.max(1, radiusM),
        ownerId: z.ownerId || null,
        ownerRank: z.ownerId ? (typeof z.ownerRank === 'number' && Number.isFinite(z.ownerRank) ? clampRank(z.ownerRank) : null) : null,
      }
    }
  }
  if (best && set.work.some((w) => w.ring.length >= 3 && pointInRing(point.lng, point.lat, w.ring))) return null
  return best
}

/** May this person know the zone exists? Company-wide zones, and their own
 *  personal ones — the same rule as the zone's RLS (027: owner_id IS NULL OR
 *  owner_id = auth.uid()). A reply must never classify a fix by a zone the
 *  caller cannot see: an off-the-clock phone posting made-up points would map
 *  an Admin's personal zone (their home) one reply at a time. */
export function privacyZoneVisibleTo(hit: Pick<PrivacyZoneHit, 'ownerId'> | null, userId: string | null | undefined): boolean {
  return !!hit && (!hit.ownerId || (!!userId && hit.ownerId === userId))
}

/** geofences_json rows → the zones that really are private: the flag is on
 *  AND the kind may be private (a flag left on a zone later turned into a
 *  site is inert — time cards need the crew's points there). */
export function privacyZonesFromRows(rows: readonly { id: string; name?: string | null; kind?: string | null; privacy_zone?: boolean | null; geometry?: unknown; owner_id?: string | null }[]): PrivacyZoneShape[] {
  const out: PrivacyZoneShape[] = []
  for (const r of rows) {
    if (r.privacy_zone !== true || !isPrivacyKind(r.kind)) continue
    const ring = outerRing(r.geometry)
    if (ring) out.push({ id: r.id, name: r.name || 'Privacy zone', ring, ownerId: typeof r.owner_id === 'string' && r.owner_id ? r.owner_id : null })
  }
  return out
}

/** geofences_json rows → the sites and yards (where crews work). */
export function workZonesFromRows(rows: readonly { id: string; kind?: string | null; geometry?: unknown }[]): WorkZoneShape[] {
  const out: WorkZoneShape[] = []
  for (const r of rows) {
    if (!isWorkKind(r.kind)) continue
    const ring = outerRing(r.geometry)
    if (ring) out.push({ id: r.id, ring })
  }
  return out
}

/** A GeoJSON Polygon's outer ring, finite corners only; null when unusable. */
export function outerRing(geometry: unknown): [number, number][] | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null | undefined
  const ring = g && g.type === 'Polygon' && Array.isArray(g.coordinates) ? (g.coordinates[0] as unknown) : null
  if (!Array.isArray(ring)) return null
  const clean = ring.filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  return clean.length >= 3 ? clean.map(([x, y]) => [x, y] as [number, number]) : null
}

export function isPrivacyKind(kind: string | null | undefined): boolean {
  return (PRIVACY_ZONE_KINDS as readonly string[]).includes(kind ?? '')
}

export function isWorkKind(kind: string | null | undefined): boolean {
  return (WORK_ZONE_KINDS as readonly string[]).includes(kind ?? '')
}

type Pt = readonly [number, number]
function orient(p: Pt, q: Pt, r: Pt): number {
  const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return v > 0 ? 1 : v < 0 ? -1 : 0
}
function onSegment(p: Pt, q: Pt, r: Pt): boolean {
  return Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1])
}
function segmentsCross(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2)
  if (o1 !== o2 && o3 !== o4) return true
  return (o1 === 0 && onSegment(p1, q1, p2)) || (o2 === 0 && onSegment(p1, q2, p2))
    || (o3 === 0 && onSegment(q1, p1, q2)) || (o4 === 0 && onSegment(q1, p2, q2))
}

/**
 * Are two outlines within `metres` of each other (or touching)? The closest
 * approach of two separate polygons is always from a corner of one to an
 * edge of the other. The server keeps the sites and yards near a privacy
 * zone — "inside" the zone reaches 150 m past its edge, and a fix inside a
 * site there must still be kept (lib/location-privacy `loadPrivacyZones`).
 */
export function ringsNear(a: readonly [number, number][], b: readonly [number, number][], metres: number): boolean {
  const ba = ringBox(a), bb = ringBox(b)
  if (!ba || !bb) return false
  // Far apart by the boxes alone (the common case): no corner-by-edge walk.
  const dLat = metres / M_PER_DEG_LAT
  const dLng = metres / (M_PER_DEG_LAT * Math.max(0.01, Math.cos((((ba[1] + ba[3]) / 2) * Math.PI) / 180)))
  if (ba[2] + dLng < bb[0] || bb[2] + dLng < ba[0] || ba[3] + dLat < bb[1] || bb[3] + dLat < ba[1]) return false
  if (ringsIntersect(a, b)) return true
  const near = (pts: readonly [number, number][], ring: readonly [number, number][]) =>
    ring.length >= 3 && pts.some(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && metresToRing({ lat, lng }, ring) <= metres)
  return near(a, b) || near(b, a)
}

/** [minLng, minLat, maxLng, maxLat] of a ring's finite corners; null under 3. */
function ringBox(r: readonly [number, number][]): [number, number, number, number] | null {
  let n = 0
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of r) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    n++
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y)
  }
  return n >= 3 ? box : null
}

/**
 * Do two zone outlines touch or overlap at all (ST_Intersects on a polygon's
 * outer ring)? An edge crossing an edge, a shared edge or corner, or one
 * outline wholly inside the other. Planar on lng/lat — the answer does not
 * depend on the projection at zone scale. A privacy zone may not be marked
 * over a site or yard (lib/actions/privacy-zones.ts).
 */
export function ringsIntersect(a: readonly [number, number][], b: readonly [number, number][]): boolean {
  const A = a.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  const B = b.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  const ba = ringBox(A), bb = ringBox(B)
  if (!ba || !bb) return false
  if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) return false
  for (let i = 0, j = A.length - 1; i < A.length; j = i++) {
    for (let k = 0, l = B.length - 1; k < B.length; l = k++) {
      if (segmentsCross(A[j], A[i], B[l], B[k])) return true
    }
  }
  return pointInRing(A[0][0], A[0][1], B) || pointInRing(B[0][0], B[0][1], A)
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

/** The largest roughness a sighting row may carry (132's CHECK). */
const MAX_PRECISION_M = 100_000

/**
 * Where a tag heard by a phone whose fix is NOT kept goes. Never the person:
 * the row it lands in names no phone. A privacy zone wins over recovery —
 * the zone's area is close enough to send someone to look, and the zone is a
 * promise made to people.
 *
 * Inside a privacy zone the tag goes on the 250 m grid cell of the zone's
 * centre, roughness at least 250 m (more for a bigger zone) — never the
 * zone's exact centre: a 30 × 40 m house lot's centre ±25 m would pin the
 * tag (and the house) far finer than the off-the-clock grid does.
 */
export function placeTag(fix: { lat: number; lng: number }, ctx: { privacyZone: PrivacyZoneHit | null; inRecovery: boolean }): TagPlacement {
  if (ctx.privacyZone) {
    const cell = snapToGrid(ctx.privacyZone.centre.lat, ctx.privacyZone.centre.lng, OFF_SHIFT_GRID_M)
    const precisionM = Math.min(MAX_PRECISION_M, Math.max(OFF_SHIFT_GRID_M, Math.round(ctx.privacyZone.radiusM)))
    return { lat: cell.lat, lng: cell.lng, precisionM, reason: 'privacy_zone' }
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
 * Admin's 'admins', the crew's everyone — lib/phone-location.ts).
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

/**
 * The level an anonymous sighting row is stored at — `anonRank`, then two
 * floors (133):
 *  - placed in a PERSONAL privacy zone ("only me" — its outline is hidden
 *    from everyone but its maker): no lower than the maker's own rank, or a
 *    crew-readable row at the zone's cell would point at, say, an Admin's
 *    home; an unknown maker reads as owner-only;
 *  - a recovery's EXACT spot: Admins and the owner only (RECOVERY_MIN_RANK).
 *    Crew phones still report it; crew do not read it.
 */
export function anonSightingRank(input: {
  reporter: number
  holder: { rank: number; seenMs: number } | null
  atMs: number
  placement: Pick<TagPlacement, 'reason'>
  zone: Pick<PrivacyZoneHit, 'ownerId' | 'ownerRank'> | null
}): number {
  let r = anonRank(clampRank(input.reporter), input.holder, input.atMs)
  if (input.placement.reason === 'privacy_zone' && input.zone?.ownerId) {
    r = Math.max(r, typeof input.zone.ownerRank === 'number' && Number.isFinite(input.zone.ownerRank) ? clampRank(input.zone.ownerRank) : 4)
  }
  if (input.placement.reason === 'recovery') r = Math.max(r, RECOVERY_MIN_RANK)
  return clampRank(r)
}

/** The newest stored anonymous sighting of a tool FOR ONE (rank, reason) —
 *  as the fold reads it. `placeSinceMs` = when it arrived at its current
 *  place (null: it never moved, so since `firstSeenMs`). */
export interface AnonRowLite {
  lat: number
  lng: number
  reason: string
  lastSeenMs: number
  rank: number
  firstSeenMs?: number | null
  placeSinceMs?: number | null
}

export type AnonFoldDecision = 'extend' | 'move' | 'insert' | 'skip'

/**
 * Fold one placement into a tool's anonymous history. `last` is the tool's
 * newest row at the SAME level and for the same reason (a different level is
 * a different row: an owner-only sighting must never extend — or be extended
 * by — one the crew can read; two phones of different levels each keep their
 * own row instead of alternating inserts). `lastInsertMs` = when the tool's
 * newest row of ANY kind was started.
 *
 *   extend  same place, gap ≤ 6 h          → last_seen + heard_n
 *   move    a new place while still on the move (heard ≤ 10 min ago, never
 *           settled ≥ 10 min where it was) → the row follows it: lat/lng,
 *           last_seen, place_since — not a row per 250 m cell
 *   insert  anything else (a new run, or leaving a place it settled at, so
 *           where it sat overnight stays in its history) — but no more than
 *           about one new row per tool per 2 min (ANON_INSERT_GAP_MS): any
 *           member can post coordinates, 60 tags a report
 *   skip    capped, or a report no newer than the row (a replayed or late
 *           report never walks time backwards)
 */
export function anonFold(
  last: AnonRowLite | null,
  next: TagPlacement & { atMs: number; rank: number },
  opts: { lastInsertMs?: number | null } = {},
): AnonFoldDecision {
  if (!Number.isFinite(next.atMs)) return 'skip'
  const lastIns = opts.lastInsertMs
  const capped = typeof lastIns === 'number' && Number.isFinite(lastIns) && next.atMs - lastIns < ANON_INSERT_GAP_MS
  const fresh: AnonFoldDecision = capped ? 'skip' : 'insert'
  if (!last || !Number.isFinite(last.lastSeenMs) || last.reason !== next.reason || last.rank !== next.rank) return fresh
  if (next.atMs <= last.lastSeenMs) return 'skip'
  const gap = next.atMs - last.lastSeenMs
  // Snapped places are exact repeats; an exact (recovery) spot counts as the
  // same place within 30 m — a parked trailer's GPS wander is not a move.
  const samePlace = metresBetween(last, next) <= (next.precisionM == null ? 30 : 1)
  if (samePlace) return gap <= ANON_FOLD_GAP_MS ? 'extend' : fresh
  const since = [last.placeSinceMs, last.firstSeenMs].find((v): v is number => typeof v === 'number' && Number.isFinite(v)) ?? last.lastSeenMs
  const settled = last.lastSeenMs - since >= ANON_SETTLE_MS
  if (gap <= ANON_RUN_GAP_MS && !settled) return 'move'
  return fresh
}

/**
 * Which place the map shows for a tool: its custody sighting (a truck or an
 * on-the-clock phone heard it — exact, and it says who) or its newest
 * anonymous one. The anonymous one wins when it is newer, unless a custody
 * sighting heard it near there within ANON_YIELD_MS before (a parked truck
 * re-hearing the tag every minute must not flicker to a rough cell).
 *
 * "Near there" = within the sighting's roughness + 150 m of where custody
 * last heard it (the snapshot) OR of the carrier's LIVE position, which a
 * fresh custody tool is drawn at: a phone riding in a truck that hauls the
 * tool hears it miles from the snapshot the truck took a minute ago, and the
 * dot used to flicker between the truck and a rough cell all the way (133).
 */
export function anonymousWins(
  custody: { seenMs: number; lat?: number | null; lng?: number | null; live?: { lat: number; lng: number } | null } | null,
  anon: { seenMs: number; lat: number; lng: number; precisionM: number | null },
): boolean {
  if (!Number.isFinite(anon.seenMs)) return false
  if (!custody || !Number.isFinite(custody.seenMs)) return true
  if (anon.seenMs <= custody.seenMs) return false
  if (anon.seenMs - custody.seenMs > ANON_YIELD_MS) return true
  // Fresh custody, but the anonymous sighting is plainly somewhere else: the tag moved.
  const spots: { lat: number; lng: number }[] = []
  if (typeof custody.lat === 'number' && typeof custody.lng === 'number') spots.push({ lat: custody.lat, lng: custody.lng })
  if (custody.live && Number.isFinite(custody.live.lat) && Number.isFinite(custody.live.lng)) spots.push(custody.live)
  if (!spots.length) return false
  const reach = (anon.precisionM ?? 0) + 150
  return spots.every((s) => metresBetween(s, anon) > reach)
}

/** Plain words for an anonymous sighting — the map sheet, the custody card and Ask AI. */
export function anonPlaceWords(reason: AnonReason | string, precisionM: number | null): { short: string; long: string } {
  if (reason === 'recovery') {
    return { short: 'Recovery · exact spot', long: 'In recovery — a crew phone reported exactly where it heard the tag (not whose phone).' }
  }
  if (reason === 'privacy_zone') {
    const m = Math.max(OFF_SHIFT_GRID_M, precisionM ?? OFF_SHIFT_GRID_M)
    return { short: 'In a privacy zone', long: `Heard inside a privacy zone — shown only to about ${m} m, never where in the zone, and not whose phone.` }
  }
  const m = precisionM ?? OFF_SHIFT_GRID_M
  return { short: `Rough area · ~${m} m`, long: `Heard by a crew phone off the clock — shown to about ${m} m, and not whose phone.` }
}
