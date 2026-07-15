import { z } from 'zod'
import type { EntityDataPack } from './types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const sourceRef = z.object({
  label: z.string().min(1),
  url: z.string().url().optional(),
  note: z.string().optional(),
  retrieved: isoDate.optional(),
})

const entity = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  shortName: z.string().min(1),
  state: z.string().length(2),
  kind: z.enum(['city', 'county', 'school_district']),
  population: z.number().int().positive(),
  households: z.number().int().positive(),
  medianHomeValue: z.number().positive(),
  website: z.string().url().optional(),
  isDemo: z.boolean(),
  disclaimer: z.string().optional(),
  currentFiscalYear: z.number().int(),
  fiscalYearLabel: z.string().min(1),
  dataAsOf: isoDate,
  sources: z.array(sourceRef).min(1),
})

const fund = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['general', 'enterprise', 'special_revenue', 'debt_service', 'capital', 'internal_service']),
  description: z.string().optional(),
})

const department = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fundId: z.string(),
  parentId: z.string().optional(),
  icon: z.string().min(1),
  colorSlot: z.number().int().min(1).max(8),
  blurb: z.string().min(1),
})

const budgetLine = z.object({
  id: z.string().min(1),
  fiscalYear: z.number().int(),
  fundId: z.string(),
  departmentId: z.string(),
  category: z.enum(['personnel', 'operations', 'capital_outlay', 'debt_service', 'transfers', 'other']),
  label: z.string().min(1),
  amount: z.number().nonnegative(),
  actual: z.number().nonnegative().optional(),
})

const revenueSource = z.object({
  id: z.string().min(1),
  fiscalYear: z.number().int(),
  fundId: z.string(),
  kind: z.enum(['property_tax', 'sales_tax', 'fees_permits', 'intergovernmental', 'utility', 'hospitality_tax', 'other']),
  label: z.string().min(1),
  amount: z.number().nonnegative(),
})

const taxAuthority = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  millage: z.number().positive(),
  isPrimary: z.boolean(),
  exemptOwnerOccupied: z.boolean().optional(),
})

const propertyTax = z.object({
  assessmentRatioOwnerOccupied: z.number().positive().max(1),
  assessmentRatioOther: z.number().positive().max(1),
  authorities: z.array(taxAuthority).min(1),
  localOptionCreditFactor: z.number().nonnegative().optional(),
})

const salesTax = z.object({
  totalRate: z.number().positive().max(0.2),
  entityShareRate: z.number().nonnegative().max(0.2),
  avgTaxableSpendPerHouseholdMonthly: z.number().positive(),
})

const milestone = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  date: isoDate,
  done: z.boolean(),
})

const capitalProject = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  departmentId: z.string(),
  fundId: z.string(),
  description: z.string().min(1),
  address: z.string().optional(),
  budget: z.number().positive(),
  spentToDate: z.number().nonnegative(),
  fundingSources: z.array(z.object({ label: z.string().min(1), amount: z.number().positive() })).optional(),
  startDate: isoDate,
  expectedCompletion: isoDate,
  actualCompletion: isoDate.optional(),
  percentComplete: z.number().min(0).max(100),
  phase: z.enum(['planned', 'design', 'construction', 'complete']),
  vendorIds: z.array(z.string()),
  milestones: z.array(milestone),
  updates: z.array(z.object({ date: isoDate, text: z.string().min(1) })).optional(),
})

const vendor = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
})

const contract = z.object({
  id: z.string().min(1),
  vendorId: z.string(),
  projectId: z.string().optional(),
  description: z.string().min(1),
  amount: z.number().positive(),
  awardedDate: isoDate,
  method: z.enum(['competitive_bid', 'rfp', 'sole_source', 'cooperative']).optional(),
})

const payment = z.object({
  id: z.string().min(1),
  contractId: z.string(),
  date: isoDate,
  amount: z.number().positive(),
  description: z.string().optional(),
})

export const entityDataPackSchema = z
  .object({
    entity,
    fiscalYears: z.array(z.number().int()).min(1),
    funds: z.array(fund).min(1),
    departments: z.array(department).min(1),
    budgetLines: z.array(budgetLine).min(1),
    revenues: z.array(revenueSource).min(1),
    propertyTax,
    salesTax: salesTax.optional(),
    projects: z.array(capitalProject),
    vendors: z.array(vendor),
    contracts: z.array(contract),
    payments: z.array(payment),
  })
  .superRefine((pack, ctx) => {
    const fundIds = new Set(pack.funds.map((f) => f.id))
    const deptIds = new Set(pack.departments.map((d) => d.id))
    const vendorIds = new Set(pack.vendors.map((v) => v.id))
    const projectIds = new Set(pack.projects.map((p) => p.id))
    const contractIds = new Set(pack.contracts.map((c) => c.id))

    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })

    if (!pack.propertyTax.authorities.some((a) => a.isPrimary)) fail('propertyTax needs a primary authority')
    if (pack.propertyTax.authorities.filter((a) => a.isPrimary).length > 1) fail('only one primary authority allowed')
    if (!pack.fiscalYears.includes(pack.entity.currentFiscalYear)) fail('currentFiscalYear missing from fiscalYears')

    for (const d of pack.departments) {
      if (!fundIds.has(d.fundId)) fail(`department ${d.id}: unknown fund ${d.fundId}`)
      if (d.parentId && !deptIds.has(d.parentId)) fail(`department ${d.id}: unknown parent ${d.parentId}`)
    }
    for (const l of pack.budgetLines) {
      if (!fundIds.has(l.fundId)) fail(`budget line ${l.id}: unknown fund ${l.fundId}`)
      if (!deptIds.has(l.departmentId)) fail(`budget line ${l.id}: unknown department ${l.departmentId}`)
      if (!pack.fiscalYears.includes(l.fiscalYear)) fail(`budget line ${l.id}: FY ${l.fiscalYear} not in fiscalYears`)
    }
    for (const r of pack.revenues) {
      if (!fundIds.has(r.fundId)) fail(`revenue ${r.id}: unknown fund ${r.fundId}`)
    }
    for (const p of pack.projects) {
      if (!deptIds.has(p.departmentId)) fail(`project ${p.id}: unknown department ${p.departmentId}`)
      if (!fundIds.has(p.fundId)) fail(`project ${p.id}: unknown fund ${p.fundId}`)
      for (const v of p.vendorIds) if (!vendorIds.has(v)) fail(`project ${p.id}: unknown vendor ${v}`)
    }
    for (const c of pack.contracts) {
      if (!vendorIds.has(c.vendorId)) fail(`contract ${c.id}: unknown vendor ${c.vendorId}`)
      if (c.projectId && !projectIds.has(c.projectId)) fail(`contract ${c.id}: unknown project ${c.projectId}`)
    }
    for (const p of pack.payments) {
      if (!contractIds.has(p.contractId)) fail(`payment ${p.id}: unknown contract ${p.contractId}`)
    }

    // Slugs and ids must be unique where they key routes.
    if (new Set(pack.projects.map((p) => p.slug)).size !== pack.projects.length) fail('duplicate project slugs')
  })

export function validatePack(pack: EntityDataPack) {
  return entityDataPackSchema.safeParse(pack)
}
