import { describe, expect, it } from 'vitest'
import { listEntities } from '@/data/registry'
import { validatePack } from '../schema'
import { computeReceipt } from '../receipt'
import { buildBudgetTree } from '../budget'

describe('entity data packs', () => {
  for (const pack of listEntities()) {
    describe(pack.entity.slug, () => {
      it('passes schema + referential integrity validation', () => {
        const result = validatePack(pack)
        if (!result.success) {
          throw new Error(result.error.issues.map((i) => i.message).join('\n'))
        }
      })

      it('produces a non-empty receipt at the median home value', () => {
        const r = computeReceipt(pack, { homeValue: pack.entity.medianHomeValue, ownerOccupied: true })
        expect(r.primaryEntityTax).toBeGreaterThan(0)
        expect(r.items.length).toBeGreaterThan(0)
        const sum = r.items.reduce((s, i) => s + i.amount, 0)
        expect(sum).toBe(Math.round(r.primaryEntityTax))
      })

      it('builds a budget tree for the current fiscal year', () => {
        const tree = buildBudgetTree(pack, pack.entity.currentFiscalYear)
        expect(tree.amount).toBeGreaterThan(0)
        expect(tree.children!.length).toBeGreaterThan(0)
      })

      it('has ≤ 8 top-level departments (categorical palette cap)', () => {
        expect(pack.departments.filter((d) => !d.parentId).length).toBeLessThanOrEqual(8)
      })

      it('assigns unique color slots to top-level departments', () => {
        const slots = pack.departments.filter((d) => !d.parentId).map((d) => d.colorSlot)
        expect(new Set(slots).size).toBe(slots.length)
      })
    })
  }
})
