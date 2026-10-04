import type { Asset, AssetLocation, AlertRule, Geofence, Company } from './types'

/** Routine zone enter/exit crossings are the ZONE LOG, not alerts — the nav
 *  bell, /alerts "Needs attention", every command-center readout, the AI
 *  assistant, and the owner digests must count the same number. This is the
 *  one shared definition ( /command's blinking dial said "26 ALERTS" while
 *  the bell said 9 — logged-in review, Aug 26). System alerts carry `kind`
 *  instead of a rule, so they're always actionable. Typed structurally so
 *  slim digest queries (kind + rule.trigger only) can use it too. */
export function isZoneLogEvent(e: { kind?: string | null; rule?: { trigger?: string | null } | null }): boolean {
  return !e.kind && (e.rule?.trigger === 'enter' || e.rule?.trigger === 'exit')
}

/** Unread actionable alerts — the ONE number every badge shows. */
export function unreadActionableCount(
  events: { kind?: string | null; rule?: { trigger?: string | null } | null; acknowledged_at?: string | null }[]
): number {
  return events.filter((e) => !e.acknowledged_at && !isZoneLogEvent(e)).length
}

export interface EvaluatedAlert {
  rule_id: string
  asset_id: string
  trigger: AlertRule['trigger']
  geofence_id: string
  reason: string
  severity: 'critical' | 'warning' | 'info'
}

/** Ray-casting point-in-polygon test (lng/lat). */
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false
  const [x, y] = point
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Company timezone for work-hour math. Vercel's runtime clock is UTC, so
 *  naive getHours() shifted "work ends at 17:00" to 1 PM Eastern — every
 *  afternoon drive fired a THEFT ALERT (Brian's phone, Aug 3). Until zones
 *  carry per-company timezones (reporting-profile design), all customers are
 *  Eastern. */
const COMPANY_TZ = 'America/New_York'

/** Weekday (0=Sun) + minutes-since-midnight of `date` IN the company tz. */
function localClock(date: Date, tz = COMPANY_TZ): { day: number; mins: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
    const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'))
    return { day: day < 0 ? date.getDay() : day, mins: Number.isFinite(mins) ? mins : 0 }
  } catch {
    return { day: date.getDay(), mins: date.getHours() * 60 + date.getMinutes() }
  }
}

/** True when `date` falls outside the company's configured working hours. */
export function isAfterHours(date: Date, company: Pick<Company, 'work_start' | 'work_end' | 'work_days'>): boolean {
  const { day, mins } = localClock(date)
  if (!company.work_days.includes(day)) return true
  const [sh, sm] = company.work_start.split(':').map(Number)
  const [eh, em] = company.work_end.split(':').map(Number)
  return mins < sh * 60 + sm || mins >= eh * 60 + em
}

/** True when `date` sits inside a custom watch window ("22:00"→"05:00" wraps
 *  midnight; `days` limits which days count — the day the window STARTS). */
export function inWatchWindow(date: Date, start: string, end: string, days?: number[]): boolean {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const s = (sh || 0) * 60 + (sm || 0)
  const e = (eh || 0) * 60 + (em || 0)
  const { day: today, mins } = localClock(date)
  const wraps = e <= s
  const inside = wraps ? mins >= s || mins < e : mins >= s && mins < e
  if (!inside) return false
  if (!days?.length) return true
  // For a wrapped window, minutes past midnight belong to the PREVIOUS day's
  // watch (Fri 22:00–Sat 05:00 is "Friday's" watch).
  const day = wraps && mins < e ? (today + 6) % 7 : today
  return days.includes(day)
}

const MOVING_SPEED_MPH = 3

/** Metres from a point to the nearest edge of a ring (flat-earth — fine at site scale). */
export function metresToEdge(point: [number, number], ring: [number, number][]): number {
  const [x0, y0] = point
  const kx = 111_320 * Math.cos((y0 * Math.PI) / 180), ky = 110_574
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - x0) * kx, ay = (ring[j][1] - y0) * ky
    const bx = (ring[i][0] - x0) * kx, by = (ring[i][1] - y0) * ky
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/** A speeding fix must sit this far inside the zone: a road along the fence, GPS wander at the edge… */
export const SPEED_EDGE_M = 25
/** …but never less than GPS wander. */
export const SPEED_EDGE_MIN_M = 5

/**
 * How far inside a zone a speeding fix must be: a quarter of the zone's mean
 * width (2 × area ÷ perimeter), between SPEED_EDGE_MIN_M and SPEED_EDGE_M. A
 * flat 25 m left no point at all in a yard under ~50 m across, so "5 mph in
 * the yard" — the commonest zone limit — could never fire (ship-check, Oct 4).
 */
export function speedEdgeMargin(ring: [number, number][]): number {
  if (ring.length < 3) return SPEED_EDGE_M
  const y0 = ring[0][1]
  const kx = 111_320 * Math.cos((y0 * Math.PI) / 180), ky = 110_574
  let twiceArea = 0, perimeter = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] * kx, ay = ring[j][1] * ky, bx = ring[i][0] * kx, by = ring[i][1] * ky
    twiceArea += ax * by - bx * ay
    perimeter += Math.hypot(bx - ax, by - ay)
  }
  if (!(perimeter > 0)) return SPEED_EDGE_M
  const meanWidth = Math.abs(twiceArea) / perimeter
  return Math.max(SPEED_EDGE_MIN_M, Math.min(SPEED_EDGE_M, meanWidth / 4))
}
/** …and the fix before it, this recent, must be inside and over the limit too. */
export const SPEED_PAIR_MS = 120_000

export interface PriorFix { lat: number; lng: number; speed: number | null; timestamp: string }

/**
 * Speeding in a zone, said only when it is plainly true (Tenna's reviews:
 * "65 in a 20 mph zone" — a highway picked up as the side road beside it).
 * The zone's own limit, never a guessed road limit; the fix well inside the
 * zone, not on its edge; and two fixes in a row over the limit inside it —
 * one fast fix is a glitch or a truck passing, not a habit.
 */
export function speedingHolds(ring: [number, number][], limit: number, cur: Pick<AssetLocation, 'lat' | 'lng' | 'speed' | 'timestamp'>, prev: PriorFix | null | undefined): boolean {
  if (!(limit > 0) || (cur.speed ?? 0) <= limit) return false
  if (!pointInPolygon([cur.lng, cur.lat], ring) || metresToEdge([cur.lng, cur.lat], ring) < speedEdgeMargin(ring)) return false
  if (!prev || prev.speed == null || prev.speed <= limit || !pointInPolygon([prev.lng, prev.lat], ring)) return false
  const dt = Date.parse(cur.timestamp) - Date.parse(prev.timestamp)
  return dt > 0 && dt <= SPEED_PAIR_MS
}

interface EvalInput {
  assets: Asset[]
  locations: Record<string, AssetLocation> // asset_id -> latest location
  /** asset_id -> the fix before the latest (speeding needs two in a row). */
  previous?: Record<string, PriorFix | undefined>
  rules: AlertRule[]
  geofences: Geofence[]
  company: Pick<Company, 'work_start' | 'work_end' | 'work_days'>
  now?: Date
}

/**
 * Pure evaluation of which alerts should fire given current state. Used both to
 * drive the live alerts list and (in production) a scheduled checker.
 */
export function evaluateAlerts(input: EvalInput): EvaluatedAlert[] {
  const { assets, locations, rules, geofences, company, now = new Date() } = input
  const out: EvaluatedAlert[] = []

  for (const rule of rules) {
    if (!rule.active) continue
    const fence = geofences.find(g => g.id === rule.geofence_id)
    if (!fence) continue
    const ring = fence.geometry.coordinates[0] as [number, number][]

    const targets = rule.asset_id
      ? assets.filter(a => a.id === rule.asset_id)
      : assets

    for (const asset of targets) {
      const loc = locations[asset.id]
      if (!loc) continue
      const inside = pointInPolygon([loc.lng, loc.lat], ring)
      const moving = (loc.speed ?? 0) > MOVING_SPEED_MPH

      // params.critical lifts an info/warning trigger onto the SMS path —
      // "text me when the low-boy reaches the site".
      const p = rule.params ?? {}
      const lift = (base: 'info' | 'warning'): 'critical' | 'warning' | 'info' => (p.critical ? 'critical' : base)

      switch (rule.trigger) {
        case 'after_hours_movement': {
          // Default: outside company work hours. With a custom window
          // ("22:00"→"05:00", optional days) the rule watches THAT instead.
          const hot = p.start && p.end
            ? inWatchWindow(now, p.start, p.end, p.days)
            : isAfterHours(now, company)
          if (moving && hot) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: 'critical',
              reason: p.start && p.end
                ? `${asset.name} is moving during watch hours (${p.start}–${p.end}) — possible theft`
                : `${asset.name} is moving outside work hours — possible theft`,
            })
          }
          break
        }
        case 'left_site':
          if (!inside && moving) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: 'critical',
              reason: `${asset.name} left ${fence.name}`,
            })
          }
          break
        case 'exit':
          if (!inside) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              // Routine crossings are ACTIVITY, not alarms — info events are
              // logged (pins, site history, Zone activity tab) but never page
              // anyone. The theft posture lives in left_site/after_hours.
              geofence_id: fence.id, severity: lift('info'),
              reason: `${asset.name} exited ${fence.name}`,
            })
          }
          break
        case 'enter':
          if (inside) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: lift('info'),
              reason: `${asset.name} entered ${fence.name}`,
            })
          }
          break
        case 'speeding': {
          // Zone-scoped speed watch: fires while the asset is INSIDE the zone
          // over the limit — well inside, two fixes running (speedingHolds).
          // "Anywhere" = put the rule on a big boundary.
          const limit = p.max_mph ?? 0
          if (speedingHolds(ring, limit, loc, input.previous?.[asset.id])) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: lift('warning'),
              reason: `${asset.name} doing ${Math.round(loc.speed ?? 0)} mph in ${fence.name} (limit ${limit})`,
            })
          }
          break
        }
        case 'idle': {
          const idleMins = (now.getTime() - new Date(loc.timestamp).getTime()) / 60000
          if (rule.idle_minutes && idleMins >= rule.idle_minutes) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: lift('warning'),
              reason: `${asset.name} idle for ${Math.round(idleMins)}m`,
            })
          }
          break
        }
      }
    }
  }

  return out
}
