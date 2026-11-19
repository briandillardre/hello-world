/**
 * What a machine really costs an hour — pure. The equipment-cost method the
 * dealers' handbooks use (owning + operating), on the HOURS THE MACHINE
 * ACTUALLY RAN from the hours ledger instead of a guessed 1,500 a year:
 *
 *  Owning, per hour
 *   - depreciation   (price − salvage) ÷ life hours
 *   - interest       average investment × rate ÷ hours a year, where the
 *                    average investment is P(n+1) + S(n−1) over 2n
 *   - insurance, tax, license, storage — a year ÷ hours a year
 *  Operating, per hour
 *   - fuel           gal / hr × $ / gal
 *   - repairs        lifetime repairs (% of price) ÷ life hours
 *   - wear           tires / tracks / cutting edges, $ / hr as typed
 *
 * Then the two decisions it is for:
 *   - rent vs own: the hours a year above which owning beats renting
 *     (fixed cost a year ÷ (rent $/hr − operating $/hr))
 *   - replace now: the last 12 months of repairs against what it would sell
 *     for — repairs past half its value in a year is the usual line.
 */

export interface OwningInputs {
  price: number
  salvage?: number
  lifeYears: number
  plannedHours?: number
  interestPct?: number
  insuranceYr?: number
  taxStorageYr?: number
  fuelGph?: number
  fuelPrice?: number
  repairPct?: number
  wearHr?: number
  rentRate?: number
  currentValue?: number
}

export interface OwningResult {
  hoursYear: number
  hoursSource: 'measured' | 'planned' | 'default'
  owning: { depreciation: number; interest: number; insuranceTax: number; total: number }
  operating: { fuel: number; repairs: number; wear: number; total: number }
  total: number
  /** Rent per hour (a 4-week rate ÷ 176 hours), when typed. */
  rentHr: number | null
  /** Hours a year above which owning is cheaper than renting; null = owning always wins / no rent rate. */
  breakEvenHours: number | null
  rentWords: string | null
  replaceWords: string | null
  /** The costbook / asset rate it would replace, compared. */
  rateWords: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
/** A 4-week rental is billed against 8 hours × 22 working days. */
export const MONTH_HOURS = 176
export const DEFAULT_HOURS = 1200

export function owningCost(i: OwningInputs, measuredHoursYear: number | null, opts: { repairsLast12?: number | null; currentRate?: number | null } = {}): OwningResult {
  const life = Math.max(1, i.lifeYears)
  const measured = measuredHoursYear && measuredHoursYear >= 50 ? measuredHoursYear : null
  const hoursYear = i.plannedHours && i.plannedHours > 0 ? i.plannedHours : measured ?? DEFAULT_HOURS
  const hoursSource: OwningResult['hoursSource'] = i.plannedHours && i.plannedHours > 0 ? 'planned' : measured ? 'measured' : 'default'
  const lifeHours = life * hoursYear
  const P = Math.max(0, i.price), S = Math.min(P, Math.max(0, i.salvage ?? 0))
  const depreciation = (P - S) / lifeHours
  const avgInvestment = (P * (life + 1) + S * (life - 1)) / (2 * life)
  const interest = (avgInvestment * ((i.interestPct ?? 0) / 100)) / hoursYear
  const insuranceTax = ((i.insuranceYr ?? 0) + (i.taxStorageYr ?? 0)) / hoursYear
  const fuel = (i.fuelGph ?? 0) * (i.fuelPrice ?? 0)
  const repairs = (P * ((i.repairPct ?? 0) / 100)) / lifeHours
  const wear = i.wearHr ?? 0
  const owning = { depreciation: r2(depreciation), interest: r2(interest), insuranceTax: r2(insuranceTax), total: r2(depreciation + interest + insuranceTax) }
  const operating = { fuel: r2(fuel), repairs: r2(repairs), wear: r2(wear), total: r2(fuel + repairs + wear) }
  const total = r2(owning.total + operating.total)

  // rent vs own: the fixed (owning) cost a year is paid whether it runs or not
  const rentHr = i.rentRate && i.rentRate > 0 ? r2(i.rentRate / MONTH_HOURS) : null
  let breakEvenHours: number | null = null
  let rentWords: string | null = null
  if (rentHr !== null) {
    const fixedYear = (depreciation + interest + insuranceTax) * hoursYear
    // renting still pays its own fuel and wear; the rental house carries repairs
    const rentAll = rentHr + fuel + wear
    const ownMarginal = fuel + repairs + wear
    const margin = rentAll - ownMarginal
    if (margin <= 0) rentWords = 'Renting is cheaper at any number of hours — the rental rate is below what it costs you to run your own.'
    else {
      breakEvenHours = Math.round(fixedYear / margin)
      rentWords = breakEvenHours <= hoursYear
        ? `Owning wins: it pays for itself past ${breakEvenHours.toLocaleString('en-US')} hours a year and it runs ${Math.round(hoursYear).toLocaleString('en-US')}.`
        : `Renting would be cheaper: owning pays only past ${breakEvenHours.toLocaleString('en-US')} hours a year and it runs ${Math.round(hoursYear).toLocaleString('en-US')}.`
    }
  }
  let replaceWords: string | null = null
  const rep = opts.repairsLast12
  if (rep !== null && rep !== undefined && i.currentValue && i.currentValue > 0) {
    const share = rep / i.currentValue
    replaceWords = share >= 0.5
      ? `Replace-now territory: $${Math.round(rep).toLocaleString('en-US')} of repairs in 12 months is ${Math.round(share * 100)}% of what it would sell for.`
      : `Keep running it: 12 months of repairs ($${Math.round(rep).toLocaleString('en-US')}) is ${Math.round(share * 100)}% of its value.`
  }
  let rateWords: string | null = null
  if (opts.currentRate && opts.currentRate > 0) {
    const diff = r2(opts.currentRate - total)
    rateWords = Math.abs(diff) < 1 ? `The rate on the machine ($${opts.currentRate.toFixed(2)}/hr) matches its real cost.`
      : diff < 0 ? `The rate on the machine ($${opts.currentRate.toFixed(2)}/hr) is $${(-diff).toFixed(2)} under its real cost — jobs are under-charged for it.`
      : `The rate on the machine ($${opts.currentRate.toFixed(2)}/hr) is $${diff.toFixed(2)} over its real cost.`
  }
  return { hoursYear: Math.round(hoursYear), hoursSource, owning, operating, total, rentHr, breakEvenHours, rentWords, replaceWords, rateWords }
}
