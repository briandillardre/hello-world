/**
 * The lien clock — pure. South Carolina's deadlines, counted from the days
 * HammerTrack already knows: the first and last day our machines or crew were
 * on the job site (zone sessions + time cards), unless the lien sheet types
 * them in.
 *
 *  Private job:
 *   - Notice of furnishing — 90 days from FIRST furnishing (S.C. Code
 *     § 29-5-23: it matters to a sub / supplier when the owner filed a Notice
 *     of Project Commencement; a prime contracts with the owner and needs none).
 *   - Mechanic's lien — served and filed within 90 days of LAST furnishing
 *     (§ 29-5-90).
 *   - Suit to enforce — within 6 months of filing the lien (§ 29-5-120).
 *  Public job (no lien on public land — the payment bond instead, § 11-35-3030
 *  / the Miller Act's shape):
 *   - Bond notice — a second-tier claimant (no contract with the prime)
 *     notifies the prime within 90 days of LAST furnishing.
 *   - Bond suit — within one year of last furnishing.
 *
 * Not legal advice, and the page says so: the clock is a reminder that reads
 * the statute's day counts, never a substitute for the company's attorney.
 * While work goes on, "last furnished" is today — the lien date moves with it.
 */
import { addDays, addMonths, daysUntil, isDay } from './registers'

export type LienRole = 'prime' | 'sub' | 'sub2' | 'supplier'
export interface LienSheet {
  role?: LienRole
  public?: boolean
  nocFiled?: boolean
  firstFurnished?: string
  lastFurnished?: string
  nofServed?: string
  lienFiled?: string
  released?: string
}
export interface SiteDays { first: string | null; last: string | null }

export type DeadlineState = 'done' | 'overdue' | 'urgent' | 'soon' | 'ok' | 'moving' | 'waiting'
export interface Deadline {
  key: 'nof' | 'lien' | 'suit' | 'bond_notice' | 'bond_suit'
  label: string
  /** The last day to act, or null when it can't be counted yet. */
  due: string | null
  state: DeadlineState
  words: string
  /** Where the day count comes from. */
  basis: string
}

/** The reminder ladder: days before the deadline when a reminder goes out. */
export const LADDER = [30, 14, 7, 3, 1]

export function lienClock(sheet: LienSheet, site: SiteDays, today: string, stillWorking: boolean): { first: string | null; last: string | null; lastMoving: boolean; deadlines: Deadline[]; stopped: boolean } {
  const first = isDay(sheet.firstFurnished) ? sheet.firstFurnished : site.first
  const typedLast = isDay(sheet.lastFurnished) ? sheet.lastFurnished : null
  // with no typed end, a job still being worked keeps moving the last day
  const lastMoving = !typedLast && stillWorking
  const last = typedLast ?? (stillWorking ? today : site.last)
  const role: LienRole = sheet.role ?? 'sub'
  const stopped = isDay(sheet.released)
  const out: Deadline[] = []

  const mk = (key: Deadline['key'], label: string, due: string | null, doneOn: string | undefined, basis: string, moving = false): Deadline => {
    if (isDay(doneOn)) return { key, label, due, state: 'done', words: `Done ${doneOn}`, basis }
    if (!due) return { key, label, due, state: 'waiting', words: 'Starts counting once there is a date to count from', basis }
    const d = daysUntil(today, due)
    const state: DeadlineState = d < 0 ? 'overdue' : moving ? 'moving' : d <= 7 ? 'urgent' : d <= 30 ? 'soon' : 'ok'
    const words = d < 0 ? `Passed ${-d} ${-d === 1 ? 'day' : 'days'} ago` : d === 0 ? 'Today is the last day'
      : moving ? `${d} days after work stops — moves while you are on site` : `${d} ${d === 1 ? 'day' : 'days'} left`
    return { key, label, due, state, words, basis }
  }

  if (sheet.public) {
    if (role === 'sub2' || role === 'supplier') {
      out.push(mk('bond_notice', 'Bond notice to the prime', last ? addDays(last, 90) : null, undefined, '90 days after last furnished', lastMoving))
    }
    if (role !== 'prime') out.push(mk('bond_suit', 'Suit on the payment bond', last ? addMonths(last, 12) : null, undefined, 'One year after last furnished', lastMoving))
  } else {
    if (role !== 'prime') {
      const nof = mk('nof', 'Notice of furnishing', first ? addDays(first, 90) : null, sheet.nofServed, `90 days after first furnished${sheet.nocFiled ? ' — the owner filed a Notice of Project Commencement' : ''}`)
      // without a Notice of Project Commencement the notice is a protection, not a deadline that kills the claim
      if (!sheet.nocFiled && nof.state !== 'done') nof.basis += ' (protective — no Notice of Project Commencement on file)'
      out.push(nof)
    }
    out.push(mk('lien', 'Serve and file the lien', last ? addDays(last, 90) : null, sheet.lienFiled, '90 days after last furnished', lastMoving))
    if (isDay(sheet.lienFiled)) out.push(mk('suit', 'Suit to enforce the lien', addMonths(sheet.lienFiled, 6), undefined, 'Six months after the lien was filed'))
  }
  if (stopped) for (const d of out) if (d.state !== 'done') { d.state = 'done'; d.words = `Paid / released ${sheet.released}` }
  return { first, last, lastMoving, deadlines: out, stopped }
}

/** The worst state among a job's deadlines (for the list and the hub). */
export function worstState(deadlines: Deadline[]): DeadlineState | null {
  const order: DeadlineState[] = ['overdue', 'urgent', 'soon', 'moving', 'ok', 'waiting', 'done']
  let best: DeadlineState | null = null
  for (const d of deadlines) if (best === null || order.indexOf(d.state) < order.indexOf(best)) best = d.state
  return best
}

/** Is today a reminder day for this deadline? (The ladder: 30, 14, 7, 3, 1 days out, and the day itself.) */
export function reminderToday(d: Deadline, today: string): boolean {
  if (!d.due || d.state === 'done' || d.state === 'moving' || d.state === 'waiting') return false
  const left = daysUntil(today, d.due)
  return left === 0 || LADDER.includes(left)
}
