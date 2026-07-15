import type { EntityDataPack } from './types'

export interface ReceiptInput {
  homeValue: number
  ownerOccupied: boolean // 4% vs 6% assessment ratio (SC)
  includeSalesTax?: boolean
  monthlyTaxableSpend?: number // overrides the pack's household average
}

export interface ReceiptLineItem {
  departmentId: string
  label: string
  icon: string
  colorSlot: number
  amount: number // whole dollars, largest-remainder rounded
  percent: number // of primary-entity tax, 0-1
  perDay: number
  perMonth: number
}

export interface AuthorityLine {
  id: string
  name: string
  millage: number
  tax: number
  isPrimary: boolean
  exempted: boolean // true when skipped for owner-occupied (Act 388)
}

export interface TaxReceipt {
  input: ReceiptInput
  assessedValue: number
  authorities: AuthorityLine[]
  totalPropertyTax: number
  primaryEntityTax: number // this entity's slice — the part that gets itemized
  localOptionCredit: number
  items: ReceiptLineItem[] // sums EXACTLY to round(primaryEntityTax)
  salesTax?: { annual: number; note: string }
  perDayTotal: number
}

/**
 * Split `total` whole dollars across `weights` so the parts sum EXACTLY to
 * `total` — floor each share, then hand out the remainder by largest
 * fractional remainder. Reused by the receipt UI, flow diagram, and OG image
 * so every surface shows identical numbers.
 */
export function allocateRounded(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weightSum <= 0 || total <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (total * w) / weightSum)
  const floored = exact.map(Math.floor)
  let remainder = Math.round(total) - floored.reduce((a, b) => a + b, 0)
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  const out = [...floored]
  for (const { i } of order) {
    if (remainder <= 0) break
    out[i] += 1
    remainder -= 1
  }
  return out
}

/** SC convention: assessed value rounds to the nearest $10. */
export function assessedValue(homeValue: number, ownerOccupied: boolean, pack: EntityDataPack): number {
  const ratio = ownerOccupied
    ? pack.propertyTax.assessmentRatioOwnerOccupied
    : pack.propertyTax.assessmentRatioOther
  const clamped = Math.max(0, homeValue)
  return Math.round((clamped * ratio) / 10) * 10
}

/**
 * General-fund spending per top-level department for the given fiscal year —
 * divisions roll up to their parent. These are the allocation weights for the
 * itemized receipt.
 */
export function generalFundWeights(
  pack: EntityDataPack,
  fiscalYear: number,
): { departmentId: string; amount: number }[] {
  const generalFundIds = new Set(pack.funds.filter((f) => f.kind === 'general').map((f) => f.id))
  const parentOf = new Map(pack.departments.map((d) => [d.id, d.parentId]))
  const topLevel = (id: string): string => {
    const parent = parentOf.get(id)
    return parent ? topLevel(parent) : id
  }
  const totals = new Map<string, number>()
  for (const line of pack.budgetLines) {
    if (line.fiscalYear !== fiscalYear || !generalFundIds.has(line.fundId)) continue
    const top = topLevel(line.departmentId)
    totals.set(top, (totals.get(top) ?? 0) + line.amount)
  }
  // Preserve pack department order (fixed categorical slot order).
  return pack.departments
    .filter((d) => !d.parentId && totals.has(d.id))
    .map((d) => ({ departmentId: d.id, amount: totals.get(d.id)! }))
}

export function computeReceipt(pack: EntityDataPack, input: ReceiptInput): TaxReceipt {
  const assessed = assessedValue(input.homeValue, input.ownerOccupied, pack)

  const authorities: AuthorityLine[] = pack.propertyTax.authorities.map((a) => {
    const exempted = Boolean(a.exemptOwnerOccupied && input.ownerOccupied)
    return {
      id: a.id,
      name: a.name,
      millage: a.millage,
      tax: exempted ? 0 : (assessed * a.millage) / 1000,
      isPrimary: a.isPrimary,
      exempted,
    }
  })

  // SC local option sales tax credit reduces the primary entity's bill, floored at 0.
  const creditFactor = pack.propertyTax.localOptionCreditFactor ?? 0
  const rawCredit = Math.max(0, input.homeValue) * creditFactor
  const primary = authorities.find((a) => a.isPrimary)
  let localOptionCredit = 0
  if (primary && rawCredit > 0) {
    localOptionCredit = Math.min(primary.tax, rawCredit)
    primary.tax -= localOptionCredit
  }

  const totalPropertyTax = authorities.reduce((sum, a) => sum + a.tax, 0)
  const primaryEntityTax = primary?.tax ?? 0

  const weights = generalFundWeights(pack, pack.entity.currentFiscalYear)
  const amounts = allocateRounded(Math.round(primaryEntityTax), weights.map((w) => w.amount))
  const deptById = new Map(pack.departments.map((d) => [d.id, d]))
  const items: ReceiptLineItem[] = weights.map((w, i) => {
    const dept = deptById.get(w.departmentId)!
    return {
      departmentId: dept.id,
      label: dept.name,
      icon: dept.icon,
      colorSlot: dept.colorSlot,
      amount: amounts[i],
      percent: primaryEntityTax > 0 ? amounts[i] / Math.round(primaryEntityTax) : 0,
      perDay: amounts[i] / 365,
      perMonth: amounts[i] / 12,
    }
  })

  let salesTax: TaxReceipt['salesTax']
  if (input.includeSalesTax && pack.salesTax) {
    const monthly = input.monthlyTaxableSpend ?? pack.salesTax.avgTaxableSpendPerHouseholdMonthly
    salesTax = {
      annual: Math.round(monthly * 12 * pack.salesTax.entityShareRate),
      note: `Estimated from ${monthly.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}/mo taxable spending × the ${(pack.salesTax.entityShareRate * 100).toFixed(1)}¢-per-dollar local share.`,
    }
  }

  const perDayTotal = (primaryEntityTax + (salesTax?.annual ?? 0)) / 365

  return {
    input,
    assessedValue: assessed,
    authorities,
    totalPropertyTax,
    primaryEntityTax,
    localOptionCredit,
    items,
    salesTax,
    perDayTotal,
  }
}
