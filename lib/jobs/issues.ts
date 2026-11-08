/**
 * Issues & actions (migration 156) — pure. The PM Master's Issues & Actions
 * tab: what came up on the job, who owns it, who has to decide, by when, and
 * what it could cost in dollars and days. An issue that turns into extra work
 * becomes a change order (Pay apps). Shared by the issues page, the job page
 * and `scripts/closeout-test.mjs`.
 */

export const ISSUE_CATEGORIES = ['design', 'change', 'schedule', 'site', 'utility', 'permit', 'safety', 'quality', 'payment', 'other'] as const
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]
export const ISSUE_CATEGORY_WORDS: Record<IssueCategory, string> = {
  design: 'Design / RFI', change: 'Scope change', schedule: 'Schedule', site: 'Site condition', utility: 'Utilities',
  permit: 'Permit / inspection', safety: 'Safety', quality: 'Quality', payment: 'Payment', other: 'Other',
}

export const ISSUE_PRIORITIES = ['high', 'medium', 'low'] as const
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]
export const ISSUE_PRIORITY_WORDS: Record<IssuePriority, string> = { high: 'High', medium: 'Medium', low: 'Low' }

export const ISSUE_STATUSES = ['open', 'waiting', 'resolved'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]
export const ISSUE_STATUS_WORDS: Record<IssueStatus, string> = { open: 'Open', waiting: 'Waiting on a decision', resolved: 'Resolved' }

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
export const isIssueCategory = (v: unknown): v is IssueCategory => isIn(ISSUE_CATEGORIES, v)
export const isIssuePriority = (v: unknown): v is IssuePriority => isIn(ISSUE_PRIORITIES, v)
export const isIssueStatus = (v: unknown): v is IssueStatus => isIn(ISSUE_STATUSES, v)

export interface Issue {
  id: string
  number: number
  title: string
  category: IssueCategory
  priority: IssuePriority
  status: IssueStatus
  ownerId: string | null
  decisionFrom: string | null
  dueOn: string | null
  scheduleDays: number | null
  detail: string | null
  resolution: string | null
  openedOn: string
  resolvedOn: string | null
  changeOrderId: string | null
  /** Dollars this could cost (+) or save (−) — only for logins that see costs, else null. */
  costExposure: number | null
}

export interface IssueInput {
  title: string
  category: IssueCategory
  priority: IssuePriority
  status: IssueStatus
  ownerId: string | null
  decisionFrom: string | null
  dueOn: string | null
  scheduleDays: number | null
  detail: string | null
  resolution: string | null
  /** undefined = leave what is stored (the caller can't see costs or didn't send it). */
  costExposure?: number | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clip = (v: unknown, n: number): string | null => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) || null : null)
const clipText = (v: unknown, n: number): string | null => (typeof v === 'string' ? v.trim().slice(0, n) || null : null)

/** "2026-05-21" (a date box) → itself when it is a real day, else null. */
export function isoDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1990-01-01' && v <= '2100-12-31' ? v : null
}

/** "$1,250", "(400)", 1250 → dollars; '' / null → null; anything else → 'bad'. */
export function readExposure(v: unknown): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1e9 ? Math.round(v * 100) / 100 : 'bad'
  if (typeof v !== 'string') return 'bad'
  const t = v.trim()
  if (!t) return null
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-')
  const n = Number(t.replace(/[()$,\s-]/g, ''))
  if (!Number.isFinite(n) || Math.abs(n) > 1e9 || !/\d/.test(t)) return 'bad'
  return Math.round((neg ? -n : n) * 100) / 100
}

/** An issue from a form — what can't be read is refused with why. `money` = the caller may set dollars. */
export function cleanIssue(raw: unknown, opts: { money: boolean }): { issue: IssueInput | null; error?: string } {
  if (!raw || typeof raw !== 'object') return { issue: null, error: 'Nothing to save.' }
  const o = raw as Record<string, unknown>
  const title = clip(o.title, 200)
  if (!title) return { issue: null, error: 'Give it a title.' }
  if (!isIssueCategory(o.category)) return { issue: null, error: 'Pick what kind of issue it is.' }
  const days = o.scheduleDays === '' || o.scheduleDays === null || o.scheduleDays === undefined ? null : Number(o.scheduleDays)
  if (days !== null && !(Number.isInteger(days) && Math.abs(days) <= 3650)) return { issue: null, error: 'Schedule days must be a whole number.' }
  if (o.dueOn && !isoDay(o.dueOn)) return { issue: null, error: 'That due date can’t be read.' }
  const issue: IssueInput = {
    title,
    category: o.category,
    priority: isIssuePriority(o.priority) ? o.priority : 'medium',
    status: isIssueStatus(o.status) ? o.status : 'open',
    ownerId: typeof o.ownerId === 'string' && UUID.test(o.ownerId) ? o.ownerId : null,
    decisionFrom: clip(o.decisionFrom, 120),
    dueOn: isoDay(o.dueOn),
    scheduleDays: days,
    detail: clipText(o.detail, 2000),
    resolution: clipText(o.resolution, 2000),
  }
  if (opts.money && 'costExposure' in o) {
    const x = readExposure(o.costExposure)
    if (x === 'bad') return { issue: null, error: 'That dollar amount can’t be read.' }
    issue.costExposure = x
  }
  return { issue }
}

export const isOverdue = (i: Pick<Issue, 'status' | 'dueOn'>, today: string): boolean => i.status !== 'resolved' && !!i.dueOn && i.dueOn < today

const PRI: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 }

/** Open and waiting first — high, overdue, soonest due — then the resolved, newest first. */
export function sortIssues<T extends Pick<Issue, 'status' | 'priority' | 'dueOn' | 'number' | 'resolvedOn'>>(list: T[], today: string): T[] {
  return [...list].sort((a, b) => {
    const ra = a.status === 'resolved' ? 1 : 0, rb = b.status === 'resolved' ? 1 : 0
    if (ra !== rb) return ra - rb
    if (ra) return (b.resolvedOn ?? '').localeCompare(a.resolvedOn ?? '') || b.number - a.number
    return PRI[a.priority] - PRI[b.priority]
      || Number(isOverdue(b, today)) - Number(isOverdue(a, today))
      || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999')
      || a.number - b.number
  })
}

export interface IssueSummary { open: number; waiting: number; overdue: number; high: number; exposure: number | null }

/** The job page's line: how many are open, waiting, late, high — and their dollars when the caller sees costs. */
export function issueSummary(list: Pick<Issue, 'status' | 'priority' | 'dueOn' | 'costExposure'>[], today: string, money: boolean): IssueSummary {
  const live = list.filter((i) => i.status !== 'resolved')
  const cents = live.reduce((s, i) => s + Math.round((i.costExposure ?? 0) * 100), 0)
  return {
    open: live.filter((i) => i.status === 'open').length,
    waiting: live.filter((i) => i.status === 'waiting').length,
    overdue: live.filter((i) => isOverdue(i, today)).length,
    high: live.filter((i) => i.priority === 'high').length,
    exposure: money ? cents / 100 : null,
  }
}

/** What a change order made from an issue starts as (Pay apps → change orders): the issue's words, cost and days. */
export function changeOrderFromIssue(i: Pick<Issue, 'number' | 'title' | 'detail' | 'scheduleDays' | 'costExposure'>, today: string) {
  return {
    title: i.title.slice(0, 200),
    description: [`From issue I-${i.number}.`, i.detail ?? ''].join(' ').trim().slice(0, 2000),
    status: 'potential' as const,
    identifiedOn: today,
    costImpact: i.costExposure ?? null,
    scheduleDays: i.scheduleDays ?? null,
  }
}
