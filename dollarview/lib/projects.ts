import type { CapitalProject, EntityDataPack, ProjectHealth } from './types'

/**
 * Health is derived from the numbers, never stored — the same inputs always
 * produce the same badge, and the rules are published on /methodology.
 */
export function projectHealth(p: CapitalProject, today = new Date('2026-07-15')): ProjectHealth {
  if (p.phase === 'complete' || p.actualCompletion) return 'complete'
  const spentPct = p.budget > 0 ? (p.spentToDate / p.budget) * 100 : 0
  if (spentPct >= 100) return 'over_budget'
  if (new Date(`${p.expectedCompletion}T00:00:00`) < today) return 'delayed'
  if (spentPct - p.percentComplete > 15) return 'at_risk'
  return 'on_track'
}

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  over_budget: 'Over budget',
  delayed: 'Delayed',
  complete: 'Complete',
}

export function costPerResident(p: CapitalProject, pack: EntityDataPack): number {
  return pack.entity.population > 0 ? p.budget / pack.entity.population : 0
}

/** Percent of the planned schedule that has elapsed, 0-100+. */
export function scheduleElapsedPct(p: CapitalProject, today = new Date('2026-07-15')): number {
  const start = new Date(`${p.startDate}T00:00:00`).getTime()
  const end = new Date(`${(p.actualCompletion ?? p.expectedCompletion)}T00:00:00`).getTime()
  if (end <= start) return 100
  return Math.max(0, ((today.getTime() - start) / (end - start)) * 100)
}

export function spentPct(p: CapitalProject): number {
  return p.budget > 0 ? (p.spentToDate / p.budget) * 100 : 0
}

export function projectContracts(p: CapitalProject, pack: EntityDataPack) {
  return pack.contracts.filter((c) => c.projectId === p.id)
}

export function vendorTotals(pack: EntityDataPack): { vendorId: string; name: string; total: number; contracts: number }[] {
  const byVendor = new Map<string, { total: number; contracts: number }>()
  for (const c of pack.contracts) {
    const entry = byVendor.get(c.vendorId) ?? { total: 0, contracts: 0 }
    entry.total += c.amount
    entry.contracts += 1
    byVendor.set(c.vendorId, entry)
  }
  return pack.vendors
    .filter((v) => byVendor.has(v.id))
    .map((v) => ({ vendorId: v.id, name: v.name, ...byVendor.get(v.id)! }))
    .sort((a, b) => b.total - a.total)
}
