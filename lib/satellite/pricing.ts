/**
 * Satellite site imagery — what it costs US, pure (harness: scripts/satellite-test.mjs).
 *
 * Every constant is a published list price read on Oct 6 2026; docs/SATELLITE.md
 * cites each one. These are OUR costs. No customer price lives here or anywhere
 * in the app until Brian sets one (pricing sync rule) — the zone page shows
 * this math to the platform owner only.
 *
 * The shape of the problem, in one line: Planet bills at least 1 km² per site
 * (our median site is 19 acres ≈ 0.08 km²), so a daily Planet site costs about
 * the same whatever its size, and Sentinel-2 costs us nothing but a few
 * seconds of function time.
 */

export type Provider = 'sentinel2' | 'planet'

export const KM2_PER_ACRE = 0.0040468564224

/** Planet Insights Flex, the self-serve plans (planet.com/pricing): price per month and monitoring credits (MC) per month. */
export const FLEX_PLANS = {
  starter: { usdMonth: 110, mcMonth: 7_000 },
  professional: { usdMonth: 550, mcMonth: 40_000 },
  scale: { usdMonth: 1_200, mcMonth: 100_000 },
} as const
export type FlexPlan = keyof typeof FLEX_PLANS

export const PLANET = {
  /** Smallest PlanetScope order Insights Flex bills, and the smallest area on every non-agriculture plan: 1 km². */
  minKm2: 1,
  /** Ordering a PlanetScope scene 30 days old or older on Insights Flex: 50 MC per km² (Flex never sells fresher data). */
  mcPerKm2Ordered: 50,
  /**
   * Planning price for NEXT-DAY imagery over a fixed area in the US, $/km²/yr.
   * Planet's only published US next-day area price is Planet Agriculture Tier
   * One (the US is Tier One): $1.80/ha = $180/km²/yr. The Area Under
   * Management list (May 2026) was $9,650 per 50 km² = $193/km²/yr. Non-farm
   * next-day area is "Committed Use", quoted by Planet sales.
   */
  areaUsdPerKm2Year: 190,
  /** Area is sold in 5 km² (500 ha) packages at the start of an annual contract. */
  areaPackageKm2: 5,
  /** The May-2026 Area Under Management block: $9,650 a year for 50 km². */
  aumBlockUsdYear: 9_650,
  aumBlockKm2: 50,
  /** A Starter Flex plan carried beside an area subscription for activation / egress / storage credits (our assumption). */
  platformUsdMonth: 110,
  /** SkySat (50 cm) through Planet Select (run by SkyFi): $/km², 25 km² minimum per order. */
  skysat: { archiveUsdKm2: 6, taskingUsdKm2: 12, assuredUsdKm2: 40, minKm2: 25 },
} as const

export const SENTINEL2 = {
  /** Our cost per scene looked at: ~5 s of a 1 GB function (≈ $0.00025) + a picture of a few KB stored. */
  usdPerScene: 0.0005,
  /** Sentinel-2 passes over a Greenville site: 81 from Oct 2025 to Sep 2026. */
  passesPerMonth: 81 / 12,
  /** …of which 30 had under 20 % cloud over the whole 110 km tile. */
  clearPerMonth: 30 / 12,
  gsdM: 10,
} as const

/** Clear PlanetScope days a month we plan on in the Southeast (near-daily revisit, about half of days clear). */
export const PLANET_CLEAR_DAYS_PER_MONTH = 15

const round2 = (v: number) => Math.round(v * 100) / 100

export function acresToKm2(acres: number): number {
  return acres * KM2_PER_ACRE
}

export function km2ToAcres(km2: number): number {
  return km2 / KM2_PER_ACRE
}

/** What Planet bills for one site's area: never below its 1 km² floor, rounded up to 0.01 km². */
export function planetBilledKm2(aoiKm2: number): number {
  const a = Number.isFinite(aoiKm2) && aoiKm2 > 0 ? aoiKm2 : 0
  return Math.max(PLANET.minKm2, Math.ceil(a * 100 - 1e-9) / 100)
}

/** Billable km² for one picture: Sentinel-2 is free and open, Planet bills its floor. */
export function billableKm2(provider: Provider, aoiKm2: number): number {
  return provider === 'planet' ? planetBilledKm2(aoiKm2) : 0
}

export function usdPerMc(plan: FlexPlan = 'starter'): number {
  return FLEX_PLANS[plan].usdMonth / FLEX_PLANS[plan].mcMonth
}

/** One ordered PlanetScope scene at Insights Flex list price (the scene is 30+ days old). */
export function planetSceneUsd(billedKm2: number, plan: FlexPlan = 'starter'): number {
  return billedKm2 * PLANET.mcPerKm2Ordered * usdPerMc(plan)
}

/** What one picture costs us, by provider — recorded on every `satellite_scenes` row. */
export function sceneCostUsd(provider: Provider, billedKm2: number): number {
  return provider === 'planet' ? Math.round(planetSceneUsd(billedKm2) * 10_000) / 10_000 : SENTINEL2.usdPerScene
}

/** The cheapest Flex plan whose monthly credits cover `mc`, as plan-units; past Scale, more Scale plans. */
export function flexPlanFor(mc: number): { plan: FlexPlan; units: number; usdMonth: number } {
  for (const plan of ['starter', 'professional', 'scale'] as const) {
    if (mc <= FLEX_PLANS[plan].mcMonth) return { plan, units: 1, usdMonth: FLEX_PLANS[plan].usdMonth }
  }
  const units = Math.ceil(mc / FLEX_PLANS.scale.mcMonth)
  return { plan: 'scale', units, usdMonth: units * FLEX_PLANS.scale.usdMonth }
}

/**
 * Next-day area subscription for a company's sites, $/yr: each site billed at
 * its 1 km² floor, the total bought in whole 5 km² packages, plus a Starter
 * plan for platform credits. Zero sites, zero dollars.
 */
export function planetAreaYearUsd(aoisKm2: number[], usdPerKm2Year: number = PLANET.areaUsdPerKm2Year): number {
  if (!aoisKm2.length) return 0
  const billed = aoisKm2.reduce((s, a) => s + planetBilledKm2(a), 0)
  const packaged = Math.ceil(billed / PLANET.areaPackageKm2 - 1e-9) * PLANET.areaPackageKm2
  return round2(packaged * usdPerKm2Year + PLANET.platformUsdMonth * 12)
}

/** The same sites under the May-2026 Area Under Management list: whole 50 km² blocks, plus platform credits. */
export function planetAumYearUsd(aoisKm2: number[]): number {
  if (!aoisKm2.length) return 0
  const billed = aoisKm2.reduce((s, a) => s + planetBilledKm2(a), 0)
  return round2(Math.ceil(billed / PLANET.aumBlockKm2 - 1e-9) * PLANET.aumBlockUsdYear + PLANET.platformUsdMonth * 12)
}

/** Insights Flex at a daily cadence, $/yr: one order per clear day per site, on the cheapest plan that covers it. Imagery is 30+ days old. */
export function planetFlexYearUsd(aoisKm2: number[], clearDaysPerMonth: number = PLANET_CLEAR_DAYS_PER_MONTH): number {
  if (!aoisKm2.length) return 0
  const mc = aoisKm2.reduce((s, a) => s + clearDaysPerMonth * PLANET.mcPerKm2Ordered * planetBilledKm2(a), 0)
  return round2(flexPlanFor(mc).usdMonth * 12)
}

/** Sentinel-2 for one site, $/month: every pass looked at, clear or not. */
export function sentinelSiteMonthlyUsd(passesPerMonth: number = SENTINEL2.passesPerMonth): number {
  return passesPerMonth * SENTINEL2.usdPerScene
}

export interface SiteEstimate {
  aoiKm2: number
  planetBilledKm2: number
  /** Sentinel-2, $/month. */
  sentinel2Usd: number
  /** Next-day Planet, marginal $/month for this site's area inside an existing package (no platform share). */
  planetAreaUsd: number
  /** Insights Flex list price for daily orders of 30-day-old scenes, $/month (Starter credit rate). */
  planetFlexUsd: number
}

/** One site's monthly cost to us — the founder-only line on the zone page. */
export function siteEstimate(aoiKm2: number): SiteEstimate {
  const billed = planetBilledKm2(aoiKm2)
  return {
    aoiKm2: Math.round(aoiKm2 * 1000) / 1000,
    planetBilledKm2: billed,
    sentinel2Usd: round2(sentinelSiteMonthlyUsd()),
    planetAreaUsd: round2((billed * PLANET.areaUsdPerKm2Year) / 12),
    planetFlexUsd: round2(PLANET_CLEAR_DAYS_PER_MONTH * planetSceneUsd(billed)),
  }
}

/** The smallest price ending in 9 (…$39, $49, $59…) that keeps `margin` of it after `costUsd`. */
export function priceForMargin(costUsd: number, margin: number): number {
  if (!(margin >= 0 && margin < 1) || !(costUsd >= 0)) return NaN
  const floor = costUsd / (1 - margin)
  return Math.max(9, Math.ceil((floor + 1 - 1e-9) / 10) * 10 - 1)
}

/**
 * Sites a company-wide plan needs before a per-site price pays for it, given
 * the yearly cost of n sites. Infinity when the price never catches up within
 * `maxSites`.
 */
export function breakEvenSites(priceUsdMonth: number, yearCostForSites: (n: number) => number, maxSites = 500): number {
  for (let n = 1; n <= maxSites; n++) {
    if (n * priceUsdMonth * 12 >= yearCostForSites(n) - 1e-9) return n
  }
  return Infinity
}

export interface ScenarioRow {
  sites: number
  /** $/yr and $/site/month under each model. */
  area: { yearUsd: number; siteMonthUsd: number }
  aum: { yearUsd: number; siteMonthUsd: number }
  flex: { yearUsd: number; siteMonthUsd: number }
  sentinel2: { yearUsd: number; siteMonthUsd: number }
}

/** The 1 / 10 / 50-site table (docs/SATELLITE.md): every site at `siteKm2` (with its picture margin). */
export function scenarioTable(siteKm2: number, counts: number[] = [1, 10, 50]): ScenarioRow[] {
  return counts.map((n) => {
    const sites = Array.from({ length: n }, () => siteKm2)
    const row = (yearUsd: number) => ({ yearUsd: round2(yearUsd), siteMonthUsd: round2(yearUsd / 12 / n) })
    return {
      sites: n,
      area: row(planetAreaYearUsd(sites)),
      aum: row(planetAumYearUsd(sites)),
      flex: row(planetFlexYearUsd(sites)),
      sentinel2: row(n * sentinelSiteMonthlyUsd() * 12),
    }
  })
}
