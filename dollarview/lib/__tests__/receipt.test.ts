import { describe, expect, it } from 'vitest'
import { allocateRounded, assessedValue, computeReceipt } from '../receipt'
import type { EntityDataPack } from '../types'

// Minimal fixture: one general fund, two departments (75/25 split), 85 mills.
function fixture(overrides?: {
  localOptionCreditFactor?: number
  exemptSchoolOps?: boolean
}): EntityDataPack {
  return {
    entity: {
      slug: 'test-city',
      name: 'City of Test',
      shortName: 'Test',
      state: 'SC',
      kind: 'city',
      population: 10000,
      households: 4000,
      medianHomeValue: 300000,
      isDemo: true,
      currentFiscalYear: 2026,
      fiscalYearLabel: 'FY 2026',
      dataAsOf: '2026-07-01',
      sources: [{ label: 'test' }],
    },
    fiscalYears: [2026],
    funds: [{ id: 'general', name: 'General Fund', kind: 'general' }],
    departments: [
      { id: 'police', name: 'Police', fundId: 'general', icon: 'shield', colorSlot: 1, blurb: 'x' },
      { id: 'parks', name: 'Parks', fundId: 'general', icon: 'trees', colorSlot: 2, blurb: 'x' },
    ],
    budgetLines: [
      { id: 'l1', fiscalYear: 2026, fundId: 'general', departmentId: 'police', category: 'personnel', label: 'a', amount: 7_500_000 },
      { id: 'l2', fiscalYear: 2026, fundId: 'general', departmentId: 'parks', category: 'operations', label: 'b', amount: 2_500_000 },
    ],
    revenues: [
      { id: 'r1', fiscalYear: 2026, fundId: 'general', kind: 'property_tax', label: 'prop', amount: 10_000_000 },
    ],
    propertyTax: {
      assessmentRatioOwnerOccupied: 0.04,
      assessmentRatioOther: 0.06,
      localOptionCreditFactor: overrides?.localOptionCreditFactor,
      authorities: [
        { id: 'city', name: 'City of Test', millage: 85, isPrimary: true },
        { id: 'school-ops', name: 'Schools Ops', millage: 150, isPrimary: false, exemptOwnerOccupied: overrides?.exemptSchoolOps ?? true },
      ],
    },
    projects: [],
    vendors: [],
    contracts: [],
    payments: [],
  }
}

describe('assessedValue', () => {
  it('applies the 4% owner-occupied ratio and rounds to $10', () => {
    expect(assessedValue(300_000, true, fixture())).toBe(12_000)
    expect(assessedValue(287_512, true, fixture())).toBe(11_500) // 11500.48 → 11500
  })

  it('applies the 6% ratio for non-owner-occupied', () => {
    expect(assessedValue(300_000, false, fixture())).toBe(18_000)
  })

  it('clamps negative and zero home values to zero', () => {
    expect(assessedValue(0, true, fixture())).toBe(0)
    expect(assessedValue(-50_000, true, fixture())).toBe(0)
  })
})

describe('computeReceipt', () => {
  it('computes $300k owner-occupied at 85 mills → $12,000 assessed → $1,020 city tax', () => {
    const r = computeReceipt(fixture(), { homeValue: 300_000, ownerOccupied: true })
    expect(r.assessedValue).toBe(12_000)
    expect(r.primaryEntityTax).toBeCloseTo(1_020, 5)
  })

  it('drops Act 388-exempt school operating millage for owner-occupied only', () => {
    const owner = computeReceipt(fixture(), { homeValue: 300_000, ownerOccupied: true })
    const schoolOwner = owner.authorities.find((a) => a.id === 'school-ops')!
    expect(schoolOwner.exempted).toBe(true)
    expect(schoolOwner.tax).toBe(0)

    const rental = computeReceipt(fixture(), { homeValue: 300_000, ownerOccupied: false })
    const schoolRental = rental.authorities.find((a) => a.id === 'school-ops')!
    expect(schoolRental.exempted).toBe(false)
    expect(schoolRental.tax).toBeCloseTo(18_000 * 0.15, 5)
  })

  it('applies the local option credit and floors the primary tax at 0', () => {
    const some = computeReceipt(fixture({ localOptionCreditFactor: 0.001 }), { homeValue: 300_000, ownerOccupied: true })
    expect(some.localOptionCredit).toBeCloseTo(300, 5)
    expect(some.primaryEntityTax).toBeCloseTo(720, 5)

    // Credit larger than the bill → tax floors at 0, credit capped at the bill.
    const capped = computeReceipt(fixture({ localOptionCreditFactor: 0.05 }), { homeValue: 300_000, ownerOccupied: true })
    expect(capped.primaryEntityTax).toBe(0)
    expect(capped.localOptionCredit).toBeCloseTo(1_020, 5)
  })

  it('allocates items proportional to general-fund department spending', () => {
    const r = computeReceipt(fixture(), { homeValue: 300_000, ownerOccupied: true })
    expect(r.items).toHaveLength(2)
    expect(r.items[0].label).toBe('Police')
    expect(r.items[0].amount).toBe(765) // 75% of 1020
    expect(r.items[1].amount).toBe(255) // 25% of 1020
  })

  it('items always sum EXACTLY to the rounded primary tax (50 randomized home values)', () => {
    // Deterministic pseudo-random walk over awkward home values.
    let seed = 42
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const pack = fixture()
    // Awkward weights that don't divide evenly.
    pack.budgetLines[0].amount = 7_333_331
    pack.budgetLines[1].amount = 2_666_669
    for (let i = 0; i < 50; i++) {
      const homeValue = Math.round(50_000 + next() * 950_000)
      const r = computeReceipt(pack, { homeValue, ownerOccupied: next() > 0.5 })
      const sum = r.items.reduce((s, item) => s + item.amount, 0)
      expect(sum).toBe(Math.round(r.primaryEntityTax))
    }
  })

  it('handles zero home value without NaN', () => {
    const r = computeReceipt(fixture(), { homeValue: 0, ownerOccupied: true })
    expect(r.primaryEntityTax).toBe(0)
    expect(r.items.every((i) => i.amount === 0)).toBe(true)
    expect(Number.isNaN(r.perDayTotal)).toBe(false)
  })

  it('adds the sales tax estimate when requested', () => {
    const pack = fixture()
    pack.salesTax = { totalRate: 0.07, entityShareRate: 0.01, avgTaxableSpendPerHouseholdMonthly: 2000 }
    const r = computeReceipt(pack, { homeValue: 300_000, ownerOccupied: true, includeSalesTax: true })
    expect(r.salesTax?.annual).toBe(240)
  })
})

describe('allocateRounded', () => {
  it('sums exactly to the total', () => {
    expect(allocateRounded(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100)
    expect(allocateRounded(101, [3, 3, 3]).reduce((a, b) => a + b, 0)).toBe(101)
  })

  it('hands out remainders by largest fractional share', () => {
    expect(allocateRounded(10, [55, 45])).toEqual([6, 4]) // 5.5/4.5 → 6/4 (5.5 has the larger fraction)
  })

  it('returns zeros for degenerate inputs', () => {
    expect(allocateRounded(0, [1, 2])).toEqual([0, 0])
    expect(allocateRounded(100, [0, 0])).toEqual([0, 0])
    expect(allocateRounded(100, [])).toEqual([])
  })
})
