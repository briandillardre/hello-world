/**
 * Closeout that checks itself (migration 156) — pure. A job is not called
 * Closed while its punch list, its closeout must-dos, a change order, an
 * issue, the final application, a payment or the final lien waiver is still
 * open; a Manager may close it anyway, with the reason written on the job.
 * Anything still charging the job (someone clocked in to the site, a machine
 * on it in the last few days) is a warning, never a block. Shared by the job
 * page, `setStageAction` and `scripts/closeout-test.mjs`.
 */
import { counts, type AppStatus } from './payapp'

export interface CloseoutFacts {
  /** Open punch-list items on the site (the project hub). */
  punchOpen: number
  /** Required closeout checklist items not checked off. */
  mustDos: string[]
  /** Change orders still potential, pricing or submitted. */
  cosPending: { number: number; title: string }[]
  /** Issues open or waiting on a decision. */
  issuesOpen: { number: number; title: string }[]
  /** Every application that was sent (void and drafts left out by the reader or here). */
  apps: { appNo: number; status: AppStatus; release: boolean; currentDue: number; paidAmount: number | null; waiver: 'none' | 'partial' | 'final' }[]
  /** People clocked in to the site right now. */
  clockedIn: number
  /** Trucks and machines with an hour or more on the site in the last few days. */
  machinesOnSite: number
}

export type CheckKey = 'punch' | 'mustdos' | 'cos' | 'issues' | 'final' | 'paid' | 'waiver' | 'charging'
export interface CloseCheck {
  key: CheckKey
  /** block = closing needs it (or a Manager's reason); warn = worth a look. */
  level: 'block' | 'warn'
  ok: boolean
  title: string
  detail: string | null
}

const list = (xs: string[], max = 3) => xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const usd = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** What an application still owes, in cents (0 when paid in full or marked Paid). */
export function owedCents(a: Pick<CloseoutFacts['apps'][number], 'status' | 'currentDue' | 'paidAmount'>): number {
  if (a.status === 'paid' && a.paidAmount === null) return 0
  const due = Math.round(a.currentDue * 100)
  const paid = Math.round((a.paidAmount ?? 0) * 100)
  return Math.max(0, due - paid)
}

/** Every check, in the order a PM works them. `money` = the caller may see dollars. */
export function closeoutChecks(f: CloseoutFacts, opts: { money: boolean }): { checks: CloseCheck[]; blocking: CloseCheck[]; ready: boolean } {
  const sent = f.apps.filter((a) => counts(a.status)).sort((a, b) => a.appNo - b.appNo)
  const final = [...sent].reverse().find((a) => a.release) ?? null
  const unpaid = sent.filter((a) => owedCents(a) > 0)
  const owed = unpaid.reduce((s, a) => s + owedCents(a), 0) / 100
  const checks: CloseCheck[] = [
    { key: 'punch', level: 'block', ok: f.punchOpen === 0, title: 'Punch list finished', detail: f.punchOpen ? `${plural(f.punchOpen, 'item', 'items')} still open` : null },
    { key: 'mustdos', level: 'block', ok: f.mustDos.length === 0, title: 'Closeout must-dos checked off', detail: f.mustDos.length ? `Still to do: ${list(f.mustDos)}` : null },
    { key: 'cos', level: 'block', ok: f.cosPending.length === 0, title: 'Change orders settled', detail: f.cosPending.length ? `${list(f.cosPending.map((c) => `CO ${c.number}`))} not approved, rejected or voided` : null },
    { key: 'issues', level: 'block', ok: f.issuesOpen.length === 0, title: 'Issues resolved', detail: f.issuesOpen.length ? `${list(f.issuesOpen.map((i) => `I-${i.number}`))} still open` : null },
    { key: 'final', level: 'block', ok: !!final, title: 'Final application sent — retainage released', detail: final ? null : sent.length ? 'No application marked final yet' : 'No application sent from Pay apps' },
    {
      key: 'paid', level: 'block', ok: unpaid.length === 0, title: 'Every application paid',
      detail: unpaid.length ? `${opts.money ? `${usd(owed)} still owed on ` : 'Not paid in full: '}${list(unpaid.map((a) => `#${a.appNo}`))}` : null,
    },
    { key: 'waiver', level: 'block', ok: final?.waiver === 'final', title: 'Final lien waiver in', detail: final ? (final.waiver === 'final' ? null : `Not marked on application #${final.appNo}`) : 'Comes with the final application' },
    {
      key: 'charging', level: 'warn', ok: f.clockedIn === 0 && f.machinesOnSite === 0, title: 'Nothing still charging the job',
      detail: [f.clockedIn ? `${plural(f.clockedIn, 'person', 'people')} clocked in to the site` : '', f.machinesOnSite ? `${plural(f.machinesOnSite, 'machine', 'machines')} on the site in the last 3 days` : ''].filter(Boolean).join(' · ') || null,
    },
  ]
  const blocking = checks.filter((c) => c.level === 'block' && !c.ok)
  return { checks, blocking, ready: blocking.length === 0 }
}

/** One line for a refused close: "Punch list: 3 items still open · Change orders: CO 4 …". */
export function blockWords(blocking: CloseCheck[]): string {
  return blocking.map((c) => (c.detail ? `${c.title} — ${c.detail}` : c.title)).join(' · ')
}

/** A Manager's reason for closing with something still open. */
export function cleanCloseNote(v: unknown): string | null {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 500) || null : null
}
