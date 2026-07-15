// DollarView data model. Static per-entity data packs conform to EntityDataPack;
// the shape is designed to map 1:1 onto database tables when live ingestion lands.

export type EntityKind = 'city' | 'county' | 'school_district'

export interface SourceRef {
  label: string
  url?: string
  note?: string
  retrieved?: string // ISO date
}

export interface Entity {
  slug: string
  name: string
  shortName: string
  state: string
  kind: EntityKind
  population: number
  households: number
  medianHomeValue: number // default input for the receipt
  website?: string
  isDemo: boolean // true → persistent "fictional demo data" banner
  disclaimer?: string // shown as a banner for real-but-partial data packs
  currentFiscalYear: number
  fiscalYearLabel: string
  dataAsOf: string // ISO date the pack was compiled
  sources: SourceRef[]
}

export type FundKind =
  | 'general'
  | 'enterprise'
  | 'special_revenue'
  | 'debt_service'
  | 'capital'
  | 'internal_service'

export interface Fund {
  id: string
  name: string
  kind: FundKind
  description?: string
}

export interface Department {
  id: string
  name: string
  fundId: string
  parentId?: string // divisions nest one level under departments
  icon: string // lucide icon name
  colorSlot: number // categorical palette slot, 1-8, fixed per entity
  blurb: string // plain language: what taxpayers get
}

export type SpendCategory =
  | 'personnel'
  | 'operations'
  | 'capital_outlay'
  | 'debt_service'
  | 'transfers'
  | 'other'

export interface BudgetLine {
  id: string
  fiscalYear: number
  fundId: string
  departmentId: string // deepest node it belongs to (division id if nested)
  category: SpendCategory
  label: string
  amount: number // adopted budget, whole dollars
  actual?: number // actual spend, when the FY is closed
}

export type RevenueKind =
  | 'property_tax'
  | 'sales_tax'
  | 'fees_permits'
  | 'intergovernmental'
  | 'utility'
  | 'hospitality_tax'
  | 'other'

export interface RevenueSource {
  id: string
  fiscalYear: number
  fundId: string
  kind: RevenueKind
  label: string
  amount: number
}

// ---- Property tax (drives the receipt) ----

export interface TaxAuthority {
  id: string
  name: string
  millage: number // mills, current FY
  isPrimary: boolean // the entity this site is about — its share gets itemized
  exemptOwnerOccupied?: boolean // SC Act 388: school operating millage exempt
}

export interface PropertyTaxConfig {
  assessmentRatioOwnerOccupied: number // SC: 0.04
  assessmentRatioOther: number // SC: 0.06
  authorities: TaxAuthority[] // the full overlapping bill, for context
  localOptionCreditFactor?: number // SC LOST credit per $ of appraised value
}

export interface SalesTaxConfig {
  totalRate: number
  entityShareRate: number
  avgTaxableSpendPerHouseholdMonthly: number
}

// ---- Capital projects / contracts ----

export type ProjectPhase = 'planned' | 'design' | 'construction' | 'complete'

// Health is DERIVED (lib/projects.ts), never stored.
export type ProjectHealth = 'on_track' | 'at_risk' | 'over_budget' | 'delayed' | 'complete'

export interface ProjectMilestone {
  id: string
  label: string
  date: string // ISO
  done: boolean
}

export interface CapitalProject {
  id: string
  slug: string
  name: string
  departmentId: string
  fundId: string
  description: string
  address?: string
  budget: number
  spentToDate: number
  fundingSources?: { label: string; amount: number }[]
  startDate: string
  expectedCompletion: string
  actualCompletion?: string
  percentComplete: number // physical completion, 0-100
  phase: ProjectPhase
  vendorIds: string[]
  milestones: ProjectMilestone[]
  updates?: { date: string; text: string }[]
}

export interface Vendor {
  id: string
  name: string
  city?: string
  state?: string
}

export type ContractMethod = 'competitive_bid' | 'rfp' | 'sole_source' | 'cooperative'

export interface Contract {
  id: string
  vendorId: string
  projectId?: string
  description: string
  amount: number
  awardedDate: string
  method?: ContractMethod
}

export interface Payment {
  id: string
  contractId: string
  date: string
  amount: number
  description?: string
}

// ---- The pack ----

export interface EntityDataPack {
  entity: Entity
  fiscalYears: number[]
  funds: Fund[]
  departments: Department[]
  budgetLines: BudgetLine[]
  revenues: RevenueSource[]
  propertyTax: PropertyTaxConfig
  salesTax?: SalesTaxConfig
  projects: CapitalProject[]
  vendors: Vendor[]
  contracts: Contract[]
  payments: Payment[]
}
