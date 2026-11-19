/**
 * Third-party rentals — pure. What a rental has cost so far, billed the way
 * rental houses bill (the cheapest mix of 4-week, week and day cycles), and
 * the two leaks it is for:
 *   - IDLE ON RENT: the rented machine wears a tracker (or rides with one)
 *     and hasn't worked in N days while the bill keeps running.
 *   - PAST DUE: the expected off-rent day went by and nobody called it off.
 */

export interface RentalData {
  what?: string; vendor?: string; onRent?: string; expectedOff?: string; offRentCalled?: string
  dayRate?: number; weekRate?: number; monthRate?: number; delivery?: number
}

const DAY = 86_400_000
export const daysOn = (onRent: string, until: string) => Math.max(1, Math.round((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${onRent}T12:00:00Z`)) / DAY) + 1)

/** The cheapest bill for n rental days: 4-week cycles, then weeks, then days, each capped by the next cycle up. */
export function rentalCharge(n: number, r: { dayRate?: number; weekRate?: number; monthRate?: number }): number | null {
  const d = r.dayRate ?? null, w = r.weekRate ?? null, m = r.monthRate ?? null
  if (d === null && w === null && m === null) return null
  const dayCost = (k: number) => (d !== null ? k * d : w !== null ? Math.ceil(k / 7) * w : m !== null ? Math.ceil(k / 28) * m : 0)
  const weekCost = (k: number) => {
    // k days inside a 4-week cycle: whole weeks + the leftover days, each capped
    if (w === null) return dayCost(k)
    const weeks = Math.floor(k / 7), rest = k % 7
    return weeks * w + Math.min(dayCost(rest), w)
  }
  const cycles = Math.floor(n / 28), rest = n % 28
  const restCost = Math.min(weekCost(rest), m ?? Infinity)
  return Math.round(((m ?? weekCost(28)) * cycles + restCost) * 100) / 100
}

export interface RentalView {
  days: number
  charged: number | null
  live: boolean
  idleDays: number | null
  idleCost: number | null
  flags: { kind: 'idle' | 'past_due' | 'no_rate'; words: string }[]
}

/**
 * `lastWorked` = the last day the rented machine ran (from its tracker / the
 * hours ledger), or null when it has no tracker. Idle ≥ `idleAfter` days on
 * rent raises the flag with what those days cost.
 */
export function rentalView(r: RentalData, today: string, lastWorked: string | null, idleAfter = 3): RentalView {
  const until = r.offRentCalled ?? today
  const live = !r.offRentCalled
  const days = r.onRent ? daysOn(r.onRent, until) : 0
  const charge = rentalCharge(days, r)
  const charged = charge === null ? null : Math.round((charge + (r.delivery ?? 0)) * 100) / 100
  const flags: RentalView['flags'] = []
  let idleDays: number | null = null
  let idleCost: number | null = null
  if (live && r.onRent) {
    const since = lastWorked && lastWorked >= r.onRent ? lastWorked : null
    if (lastWorked !== null || since) {
      idleDays = since ? Math.max(0, daysOn(since, today) - 1) : daysOn(r.onRent, today) - 1
      if (idleDays >= idleAfter) {
        const per = r.dayRate ?? (r.weekRate ? r.weekRate / 5 : r.monthRate ? r.monthRate / 20 : null)
        idleCost = per === null ? null : Math.round(per * idleDays * 100) / 100
        flags.push({ kind: 'idle', words: `Hasn't worked in ${idleDays} days and is still on rent${idleCost !== null ? ` — about $${Math.round(idleCost).toLocaleString('en-US')} for nothing` : ''}. Call it off?` })
      }
    }
    if (r.expectedOff && r.expectedOff < today) {
      const late = daysOn(r.expectedOff, today) - 1
      flags.push({ kind: 'past_due', words: `Was due back ${late} ${late === 1 ? 'day' : 'days'} ago and is still billing.` })
    }
  }
  if (charged === null) flags.push({ kind: 'no_rate', words: 'No rate typed — the bill can’t be counted.' })
  return { days, charged, live, idleDays, idleCost, flags }
}
