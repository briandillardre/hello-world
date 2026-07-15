import type { EntityDataPack } from '@/lib/types'

// City of Greenville, SC — REAL entity, PARTIAL data pack (Phase 1).
//
// What is sourced: the headline FY2026 budget total (~$291M) and FY2026 CIP
// total ($25.9M) are from public reporting on the adopted budget (see
// entity.sources). Everything marked UNVERIFIED below is a placeholder
// approximation pending Phase 2 verification against the city's published
// budget document and CIP — the site surfaces this via entity.disclaimer and
// the /methodology page. No vendor, contract, or payment records are included
// until they can be compiled from the city's posted registers.

export const greenvilleSc: EntityDataPack = {
  entity: {
    slug: 'greenville-sc',
    name: 'City of Greenville',
    shortName: 'Greenville',
    state: 'SC',
    kind: 'city',
    population: 72095, // US Census 2023 estimate — UNVERIFIED (Phase 2)
    households: 31000, // approximation — UNVERIFIED (Phase 2)
    medianHomeValue: 425000, // approximation — UNVERIFIED (Phase 2)
    website: 'https://www.greenvillesc.gov',
    isDemo: false,
    disclaimer:
      'Early preview. Headline budget totals come from the adopted FY2026 budget as publicly reported; department breakdowns, millage rates, and project details are approximations pending verification against city documents. See Methodology.',
    currentFiscalYear: 2026,
    fiscalYearLabel: 'FY 2026 (Jul 2025 – Jun 2026)',
    dataAsOf: '2026-07-15',
    sources: [
      {
        label: 'City of Greenville — Annual Operating Budget',
        url: 'https://www.greenvillesc.gov/2463/Annual-Operating-Budget',
        retrieved: '2026-07-15',
      },
      {
        label: 'City of Greenville — Capital Improvement Program',
        url: 'https://www.greenvillesc.gov/2464/Capital-Improvement-Program',
        retrieved: '2026-07-15',
      },
      {
        label: 'City of Greenville — Transparency in Government (monthly check registers)',
        url: 'https://www.greenvillesc.gov/2466/Transparency-in-Government',
        retrieved: '2026-07-15',
      },
      {
        label: "Greenville Journal — “Greenville's $291M budget receives initial approval”",
        url: 'https://greenvillejournal.com/community/greenvilles-291m-budget-receives-initial-approval-city-council-notes/',
        note: 'Source for the ~$291M FY2026 total budget and $25.9M FY2026 CIP figures.',
        retrieved: '2026-07-15',
      },
    ],
  },

  fiscalYears: [2025, 2026],

  funds: [
    { id: 'general', name: 'General Fund', kind: 'general', description: 'Core city services. Department totals below are approximations pending Phase 2 verification.' },
    { id: 'other-funds', name: 'Other Funds (combined)', kind: 'special_revenue', description: 'Enterprise, special revenue, and debt funds combined — itemization pending Phase 2.' },
    { id: 'capital', name: 'Capital Projects', kind: 'capital', description: 'FY2026 CIP totals $25.9M as publicly reported.' },
  ],

  departments: [
    // UNVERIFIED: department totals are placeholder approximations of the
    // adopted FY2026 general-fund budget, pending Phase 2 verification.
    { id: 'police', name: 'Police', fundId: 'general', icon: 'shield', colorSlot: 1, blurb: 'Patrol, investigations, and communications.' },
    { id: 'fire', name: 'Fire', fundId: 'general', icon: 'flame', colorSlot: 2, blurb: 'Fire suppression, rescue, and prevention.' },
    { id: 'public-works', name: 'Public Works', fundId: 'general', icon: 'truck', colorSlot: 3, blurb: 'Streets, solid waste, stormwater, and fleet.' },
    { id: 'parks', name: 'Parks, Recreation & Tourism', fundId: 'general', icon: 'trees', colorSlot: 4, blurb: 'Parks, trails, recreation, and special events.' },
    { id: 'gen-gov', name: 'General Government', fundId: 'general', icon: 'landmark', colorSlot: 5, blurb: 'Council, administration, finance, HR, IT, and legal.' },
    { id: 'comm-dev', name: 'Planning & Development', fundId: 'general', icon: 'building-2', colorSlot: 6, blurb: 'Planning, zoning, building permits, and code compliance.' },
    { id: 'debt', name: 'Debt Service', fundId: 'general', icon: 'banknote', colorSlot: 7, blurb: 'Principal and interest on city bonds.' },
    { id: 'other', name: 'Other Funds (combined)', fundId: 'other-funds', icon: 'layers', colorSlot: 8, blurb: 'Enterprise and special-revenue funds, combined until Phase 2 itemization.' },
  ],

  budgetLines: [
    // UNVERIFIED — placeholder approximations. The FY2026 all-funds total of
    // ~$291M is sourced; its split across departments/funds is not yet.
    { id: 'b26-police', fiscalYear: 2026, fundId: 'general', departmentId: 'police', category: 'other', label: 'Adopted budget (approximate)', amount: 35_000_000 },
    { id: 'b26-fire', fiscalYear: 2026, fundId: 'general', departmentId: 'fire', category: 'other', label: 'Adopted budget (approximate)', amount: 25_500_000 },
    { id: 'b26-pw', fiscalYear: 2026, fundId: 'general', departmentId: 'public-works', category: 'other', label: 'Adopted budget (approximate)', amount: 20_000_000 },
    { id: 'b26-parks', fiscalYear: 2026, fundId: 'general', departmentId: 'parks', category: 'other', label: 'Adopted budget (approximate)', amount: 18_500_000 },
    { id: 'b26-gg', fiscalYear: 2026, fundId: 'general', departmentId: 'gen-gov', category: 'other', label: 'Adopted budget (approximate)', amount: 15_000_000 },
    { id: 'b26-cd', fiscalYear: 2026, fundId: 'general', departmentId: 'comm-dev', category: 'other', label: 'Adopted budget (approximate)', amount: 8_000_000 },
    { id: 'b26-debt', fiscalYear: 2026, fundId: 'general', departmentId: 'debt', category: 'debt_service', label: 'Adopted budget (approximate)', amount: 8_500_000 },
    { id: 'b26-other', fiscalYear: 2026, fundId: 'other-funds', departmentId: 'other', category: 'other', label: 'All other funds combined (balance of ~$291M total)', amount: 160_500_000 },

    { id: 'b25-police', fiscalYear: 2025, fundId: 'general', departmentId: 'police', category: 'other', label: 'Adopted budget (approximate)', amount: 33_200_000 },
    { id: 'b25-fire', fiscalYear: 2025, fundId: 'general', departmentId: 'fire', category: 'other', label: 'Adopted budget (approximate)', amount: 24_100_000 },
    { id: 'b25-pw', fiscalYear: 2025, fundId: 'general', departmentId: 'public-works', category: 'other', label: 'Adopted budget (approximate)', amount: 19_200_000 },
    { id: 'b25-parks', fiscalYear: 2025, fundId: 'general', departmentId: 'parks', category: 'other', label: 'Adopted budget (approximate)', amount: 17_400_000 },
    { id: 'b25-gg', fiscalYear: 2025, fundId: 'general', departmentId: 'gen-gov', category: 'other', label: 'Adopted budget (approximate)', amount: 14_300_000 },
    { id: 'b25-cd', fiscalYear: 2025, fundId: 'general', departmentId: 'comm-dev', category: 'other', label: 'Adopted budget (approximate)', amount: 7_700_000 },
    { id: 'b25-debt', fiscalYear: 2025, fundId: 'general', departmentId: 'debt', category: 'debt_service', label: 'Adopted budget (approximate)', amount: 8_700_000 },
    { id: 'b25-other', fiscalYear: 2025, fundId: 'other-funds', departmentId: 'other', category: 'other', label: 'All other funds combined (approximate)', amount: 152_000_000 },
  ],

  revenues: [
    // UNVERIFIED — placeholder approximations pending Phase 2.
    { id: 'r26-prop', fiscalYear: 2026, fundId: 'general', kind: 'property_tax', label: 'Property taxes (approximate)', amount: 48_000_000 },
    { id: 'r26-lic', fiscalYear: 2026, fundId: 'general', kind: 'other', label: 'Business licenses & franchise fees (approximate)', amount: 42_000_000 },
    { id: 'r26-hosp', fiscalYear: 2026, fundId: 'general', kind: 'hospitality_tax', label: 'Hospitality & accommodations taxes (approximate)', amount: 15_000_000 },
    { id: 'r26-fees', fiscalYear: 2026, fundId: 'general', kind: 'fees_permits', label: 'Permits, fines & fees (approximate)', amount: 12_500_000 },
    { id: 'r26-ig', fiscalYear: 2026, fundId: 'general', kind: 'intergovernmental', label: 'Intergovernmental (approximate)', amount: 13_000_000 },
  ],

  propertyTax: {
    assessmentRatioOwnerOccupied: 0.04, // SC law
    assessmentRatioOther: 0.06, // SC law
    // Greenville County does not levy a local option sales tax, so there is no
    // LOST property-tax credit here.
    authorities: [
      // UNVERIFIED millage rates — placeholder approximations pending Phase 2
      // verification against the Greenville County Auditor's levy sheet.
      { id: 'city', name: 'City of Greenville (approximate)', millage: 85.9, isPrimary: true },
      { id: 'county', name: 'Greenville County (approximate)', millage: 66.4, isPrimary: false },
      { id: 'school-ops', name: 'Greenville County Schools — Operations (approximate)', millage: 163.2, isPrimary: false, exemptOwnerOccupied: true },
      { id: 'school-debt', name: 'Greenville County Schools — Debt (approximate)', millage: 39.0, isPrimary: false },
    ],
  },

  projects: [
    // Real, publicly known CIP efforts; budget/schedule figures are UNVERIFIED
    // placeholders pending Phase 2 compilation from the city's CIP documents.
    {
      id: 'prj-unity-2',
      slug: 'unity-park-phase-2',
      name: 'Unity Park — Phase II',
      departmentId: 'parks',
      fundId: 'capital',
      description: 'Continued build-out of Unity Park west of downtown. Scope and figures shown are placeholders pending verification against the adopted CIP.',
      budget: 12_000_000,
      spentToDate: 6_500_000,
      startDate: '2024-01-01',
      expectedCompletion: '2027-06-30',
      percentComplete: 50,
      phase: 'construction',
      vendorIds: [],
      milestones: [],
    },
    {
      id: 'prj-srt-ext',
      slug: 'swamp-rabbit-trail-extension',
      name: 'Swamp Rabbit Trail Extensions (city segments)',
      departmentId: 'parks',
      fundId: 'capital',
      description: 'Extending the Prisma Health Swamp Rabbit Trail network within city limits. Figures are placeholders pending verification.',
      budget: 8_000_000,
      spentToDate: 3_200_000,
      startDate: '2023-07-01',
      expectedCompletion: '2027-12-31',
      percentComplete: 40,
      phase: 'construction',
      vendorIds: [],
      milestones: [],
    },
    {
      id: 'prj-streets-fy26',
      slug: 'street-resurfacing-fy26',
      name: 'FY2026 Street Resurfacing Program',
      departmentId: 'public-works',
      fundId: 'capital',
      description: 'Annual citywide resurfacing program within the $25.9M FY2026 CIP. Allocation shown is a placeholder pending verification.',
      budget: 5_000_000,
      spentToDate: 400_000,
      startDate: '2025-07-01',
      expectedCompletion: '2026-06-30',
      percentComplete: 10,
      phase: 'construction',
      vendorIds: [],
      milestones: [],
    },
    {
      id: 'prj-stormwater-fy26',
      slug: 'stormwater-improvements-fy26',
      name: 'Stormwater System Improvements',
      departmentId: 'public-works',
      fundId: 'capital',
      description: 'Drainage and flood-mitigation projects in the FY2026 CIP. Allocation shown is a placeholder pending verification.',
      budget: 4_000_000,
      spentToDate: 300_000,
      startDate: '2025-07-01',
      expectedCompletion: '2027-06-30',
      percentComplete: 8,
      phase: 'design',
      vendorIds: [],
      milestones: [],
    },
  ],

  vendors: [],
  contracts: [],
  payments: [],
}
