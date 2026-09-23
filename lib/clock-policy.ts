/**
 * Clock policy — the two switches a company can turn on against buddy
 * punching and ghost shifts (Sep 22 2026; a landscaping prospect's office
 * found, on camera, one crew member clocking another in nineteen minutes
 * before he arrived, and whole shifts clocked on days the person was never
 * on the property):
 *
 *   photoIn / photoOut — the front camera at clock-in / clock-out. Nobody
 *     recognises faces here; a human looks at the picture on the time card.
 *   atSite / siteRadiusM — clocking in is refused unless the phone is at the
 *     chosen site (inside the zone or within the radius of it) or inside any
 *     yard the company has drawn — crews that meet at the yard and drive out
 *     still clock in at the yard.
 *
 * All off by default. Pure: no I/O, no imports — lib/actions/fieldops.ts
 * enforces it, the clock card explains it, scripts/timecards-test.mjs
 * asserts it.
 */
export interface ClockPolicy {
  photoIn: boolean
  photoOut: boolean
  atSite: boolean
  /** Metres from the site's edge that still counts as "at the site". */
  siteRadiusM: number
  /** When each photo switch was turned ON (ISO) — a shift clocked before
   *  that never "needed" a photo, so it is never flagged for one (a switch
   *  flipped on Wednesday used to accuse the whole crew for Monday). */
  photoInSince: string | null
  photoOutSince: string | null
}

export const CLOCK_POLICY_DEFAULTS: ClockPolicy = { photoIn: false, photoOut: false, atSite: false, siteRadiusM: 150, photoInSince: null, photoOutSince: null }
export const SITE_RADIUS_MIN_M = 50
export const SITE_RADIUS_MAX_M = 2000

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** The stored blob → a whole policy. Unknown keys dropped, bad values fall
 *  back to the default — a company that never opened the card gets all-off. */
export function resolveClockPolicy(raw: unknown): ClockPolicy {
  const out = { ...CLOCK_POLICY_DEFAULTS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const o = raw as Record<string, unknown>
  for (const k of ['photoIn', 'photoOut', 'atSite'] as const) {
    if (hasOwn(o, k) && typeof o[k] === 'boolean') out[k] = o[k] as boolean
  }
  if (hasOwn(o, 'siteRadiusM')) {
    const n = Number(o.siteRadiusM)
    if (Number.isFinite(n)) out.siteRadiusM = Math.round(Math.min(SITE_RADIUS_MAX_M, Math.max(SITE_RADIUS_MIN_M, n)))
  }
  for (const k of ['photoInSince', 'photoOutSince'] as const) {
    const v = hasOwn(o, k) ? o[k] : null
    out[k] = typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null
  }
  // A switch that is off carries no date; one that is on and undated is
  // treated as "on from now" by the writer, never as "always".
  if (!out.photoIn) out.photoInSince = null
  if (!out.photoOut) out.photoOutSince = null
  return out
}

/** The stored blob after a change from the Settings card: a photo switch
 *  turning ON is stamped with now (kept if it was already on), turning OFF
 *  drops its stamp. `nowIso` is injectable for the harness. */
export function nextClockPolicy(prev: ClockPolicy, next: ClockPolicy, nowIso = new Date().toISOString()): ClockPolicy {
  const out = { ...next }
  out.photoInSince = next.photoIn ? (prev.photoIn && prev.photoInSince ? prev.photoInSince : nowIso) : null
  out.photoOutSince = next.photoOut ? (prev.photoOut && prev.photoOutSince ? prev.photoOutSince : nowIso) : null
  return out
}

// ── Geometry (small, local, metres) ─────────────────────────────────────────

/** Ray cast, [lng, lat] against a ring of [lng, lat]. */
export function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Metres from a point to the nearest edge of a ring — 0 when inside.
 *  Local equirectangular projection: exact enough for a radius check on a
 *  job site, and never wrong by more than the phone's own fix is. */
export function distanceToRingM(p: [number, number], ring: [number, number][]): number {
  if (ring.length < 3) return Infinity
  if (pointInRing(p, ring)) return 0
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180), ky = 111_320
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - p[0]) * kx, ay = (ring[j][1] - p[1]) * ky
    const bx = (ring[i][0] - p[0]) * kx, by = (ring[i][1] - p[1]) * ky
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    const cx = ax + t * dx, cy = ay + t * dy
    best = Math.min(best, Math.hypot(cx, cy))
  }
  return best
}

/** "850 ft" under a quarter mile, else "2.3 mi". */
export function fmtDistanceM(m: number): string {
  const ft = m * 3.28084
  if (ft < 1000) return `${Math.round(ft / 10) * 10} ft`
  const mi = m / 1609.344
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

// ── The rule ────────────────────────────────────────────────────────────────

export type ClockInPlace =
  | { ok: true; where: 'site' | 'yard' | 'not_required'; distanceM: number | null }
  | { ok: false; distanceM: number; reason: string }

/**
 * May this fix clock in to this site under this policy? `site` is the chosen
 * zone's ring (null when the category has no site — the rule only guards a
 * project clock-in); `yards` are the company's yard rings.
 */
export function clockInPlaceCheck(
  policy: ClockPolicy,
  fix: { lat: number; lng: number },
  site: { name: string; ring: [number, number][] } | null,
  yards: [number, number][][] = [],
): ClockInPlace {
  if (!policy.atSite || !site) return { ok: true, where: 'not_required', distanceM: null }
  const p: [number, number] = [fix.lng, fix.lat]
  const d = distanceToRingM(p, site.ring)
  if (d <= policy.siteRadiusM) return { ok: true, where: 'site', distanceM: d }
  if (yards.some((y) => pointInRing(p, y))) return { ok: true, where: 'yard', distanceM: d }
  const reason = Number.isFinite(d)
    ? `You're ${fmtDistanceM(d)} from ${site.name} — clock in when you get there${yards.length ? ', or from the yard' : ''}.`
    : `Clock in at ${site.name}${yards.length ? ' or the yard' : ''} — this site has no outline to check against.`
  return { ok: false, distanceM: Number.isFinite(d) ? Math.round(d) : -1, reason }
}
