/**
 * Projects / Job-Cost layer.
 *
 * Each geofence is treated as a project. We surface the two numbers an owner
 * actually cares about — live labor cost (man-hours × rate) and equipment cost
 * (engine-hours × rate) — accruing through the workday, against budget. The
 * timeline slider drives `t` (0..1 across the workday) so cost builds as you
 * scrub. With real data these inputs come from clock-ins + telematics + QBO.
 */

export const WORKDAY_HOURS = 9
// Where "now" sits in the workday for the live (non-scrubbing) view (~2:00 PM)
export const LIVE_DAY_FRACTION = 0.78

export type ProjectStatus = 'on_track' | 'at_risk' | 'over_budget'

export interface Project {
  id: string
  geofenceId: string
  name: string
  client: string
  budget: number
  spentToDate: number // billed/spent before today
  crewSize: number
  laborRate: number // $/man-hour
  equipCostPerDay: number // equipment $ accrued over a full workday
  color: string
}

export const PROJECTS: Project[] = [
  {
    id: 'proj-1', geofenceId: 'fence-1', name: 'Riverfront Tower', client: 'Metro Dev Partners',
    budget: 260000, spentToDate: 181000, crewSize: 14, laborRate: 42, equipCostPerDay: 3850, color: '#ff9e16',
  },
  {
    id: 'proj-2', geofenceId: 'fence-2', name: 'Maple St Grading', client: 'City of Nashville',
    budget: 142000, spentToDate: 58000, crewSize: 9, laborRate: 38, equipCostPerDay: 2120, color: '#2dd4bf',
  },
]

export interface ProjectCost {
  laborToday: number
  equipToday: number
  todayTotal: number
  spentWithToday: number
  burnPct: number
  status: ProjectStatus
}

export function projectCost(p: Project, t: number): ProjectCost {
  const laborToday = p.crewSize * WORKDAY_HOURS * p.laborRate * t
  const equipToday = p.equipCostPerDay * t
  const todayTotal = laborToday + equipToday
  const spentWithToday = p.spentToDate + todayTotal
  const burnPct = (spentWithToday / p.budget) * 100
  const status: ProjectStatus = burnPct >= 100 ? 'over_budget' : burnPct >= 90 ? 'at_risk' : 'on_track'
  return { laborToday, equipToday, todayTotal, spentWithToday, burnPct, status }
}

export function money(n: number): string {
  if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k'
  return '$' + Math.round(n).toLocaleString()
}

export function moneyFull(n: number): string {
  return '$' + Math.round(n).toLocaleString()
}

export const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  on_track: { label: 'ON TRACK', cls: 'bg-[#34d399]/15 text-[#6ee7b7]' },
  at_risk: { label: 'AT RISK', cls: 'bg-amber/15 text-amber' },
  over_budget: { label: 'OVER BUDGET', cls: 'bg-alert/15 text-alert' },
}
