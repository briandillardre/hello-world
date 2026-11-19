/**
 * Activation — pure. Did a new company get to the moment HammerTrack is worth
 * paying for? The milestones, in the order a company should hit them, each
 * with the day it happened (or not yet):
 *   signed up → tracker registered → first live fix on a machine → a site
 *   drawn → a second login → a clock-in → seen this week.
 * ACTIVATED = a machine reporting live within 7 days of signing up — the
 * Founding-25 question: "did company #2 get a tracker on a machine in a
 * week?". Founder-only page; nothing here names a person.
 */

export type MilestoneKey = 'signup' | 'tracker' | 'fix' | 'site' | 'team' | 'clock' | 'recent'
export const MILESTONES: { key: MilestoneKey; label: string }[] = [
  { key: 'signup', label: 'Signed up' },
  { key: 'tracker', label: 'Tracker registered' },
  { key: 'fix', label: 'First live fix' },
  { key: 'site', label: 'Site drawn' },
  { key: 'team', label: 'Second login' },
  { key: 'clock', label: 'First clock-in' },
  { key: 'recent', label: 'Data this week' },
]

export interface CompanyFacts {
  id: string
  name: string
  signup: string | null
  tracker: string | null
  fix: string | null
  site: string | null
  team: string | null
  clock: string | null
  lastFix: string | null
  assets: number
}

export interface CompanyActivation {
  id: string
  name: string
  signup: string | null
  steps: { key: MilestoneKey; at: string | null; dayN: number | null }[]
  activated: boolean
  /** "Day 3: first fix" — the furthest step reached. */
  reached: string
  /** What to nudge next, or null when the company is fully running. */
  next: string | null
  stalled: boolean
}

const DAY = 86_400_000
const dayN = (from: string | null, at: string | null) => (from && at ? Math.max(0, Math.floor((Date.parse(at) - Date.parse(from)) / DAY)) : null)

export function activation(f: CompanyFacts, nowMs: number): CompanyActivation {
  const recent = f.lastFix && nowMs - Date.parse(f.lastFix) < 7 * DAY ? f.lastFix : null
  const at: Record<MilestoneKey, string | null> = { signup: f.signup, tracker: f.tracker, fix: f.fix, site: f.site, team: f.team, clock: f.clock, recent }
  const steps = MILESTONES.map((m) => ({ key: m.key, at: at[m.key], dayN: m.key === 'recent' ? null : dayN(f.signup, at[m.key]) }))
  const fixDay = dayN(f.signup, f.fix)
  const activated = fixDay !== null && fixDay <= 7
  const last = [...steps].reverse().find((s) => s.at && s.key !== 'recent')
  const reached = last ? `${last.dayN !== null ? `Day ${last.dayN}: ` : ''}${MILESTONES.find((m) => m.key === last.key)!.label.toLowerCase()}` : 'Nothing yet'
  const missing = steps.find((s) => !s.at)
  const next = !missing ? null
    : missing.key === 'tracker' ? 'Help them register a tracker (Trackers → Add)'
    : missing.key === 'fix' ? 'Tracker registered but nothing reporting — check the SIM / install'
    : missing.key === 'site' ? 'Draw their first site with them'
    : missing.key === 'team' ? 'Get a foreman or office login invited'
    : missing.key === 'clock' ? 'Show the crew the time clock'
    : missing.key === 'recent' ? 'Gone quiet — no data this week'
    : null
  const ageDays = f.signup ? (nowMs - Date.parse(f.signup)) / DAY : 0
  const stalled = !activated && ageDays > 7
  return { id: f.id, name: f.name, signup: f.signup, steps, activated, reached, next, stalled }
}

export function funnel(list: CompanyActivation[]): { key: MilestoneKey; label: string; count: number }[] {
  return MILESTONES.map((m) => ({ key: m.key, label: m.label, count: list.filter((c) => c.steps.find((s) => s.key === m.key)?.at).length }))
}
