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

interface EvalInput {
  assets: Asset[]
  locations: Record<string, AssetLocation> // asset_id -> latest location
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
          // over the limit. "Anywhere" = put the rule on a big boundary.
          const limit = p.max_mph ?? 0
          if (limit > 0 && inside && (loc.speed ?? 0) > limit) {
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
