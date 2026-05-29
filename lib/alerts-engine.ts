import type { Asset, AssetLocation, AlertRule, Geofence, Company } from './types'

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

/** True when `date` falls outside the company's configured working hours. */
export function isAfterHours(date: Date, company: Pick<Company, 'work_start' | 'work_end' | 'work_days'>): boolean {
  const day = date.getDay()
  if (!company.work_days.includes(day)) return true
  const [sh, sm] = company.work_start.split(':').map(Number)
  const [eh, em] = company.work_end.split(':').map(Number)
  const mins = date.getHours() * 60 + date.getMinutes()
  return mins < sh * 60 + sm || mins >= eh * 60 + em
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

      switch (rule.trigger) {
        case 'after_hours_movement':
          if (moving && isAfterHours(now, company)) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: 'critical',
              reason: `${asset.name} is moving outside work hours — possible theft`,
            })
          }
          break
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
              geofence_id: fence.id, severity: 'warning',
              reason: `${asset.name} exited ${fence.name}`,
            })
          }
          break
        case 'enter':
          if (inside) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: 'info',
              reason: `${asset.name} entered ${fence.name}`,
            })
          }
          break
        case 'idle': {
          const idleMins = (now.getTime() - new Date(loc.timestamp).getTime()) / 60000
          if (rule.idle_minutes && idleMins >= rule.idle_minutes) {
            out.push({
              rule_id: rule.id, asset_id: asset.id, trigger: rule.trigger,
              geofence_id: fence.id, severity: 'warning',
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
