/**
 * Company financial metrics + 3-method valuation — pure math, no I/O.
 *
 * The three methods mirror real-estate appraisal exactly as Brian framed it:
 *   income approach  = capitalization (SDE × trade multiple)
 *   market approach  = sales comps    (revenue × trade multiple)
 *   asset approach   = cost           (fleet + other assets − liabilities)
 *
 * Benchmarks are published small-business ranges for US construction trades
 * (CFMA/IBISWorld/BizBuySell-style figures, mid-2020s). They are RANGES with
 * honest labels, not precision — tighten per-trade as real customer data
 * accrues (Growth Platform layer 1 → docs/GROWTH-PLATFORM.md).
 */

export interface TradeBenchmark {
  key: string
  label: string
  /** Net profit margin, decimal. */
  marginLo: number
  marginHi: number
  /** Revenue per employee, $. */
  revPerEmpLo: number
  revPerEmpHi: number
  /** Income approach: multiple of SDE (seller's discretionary earnings). */
  sdeMultLo: number
  sdeMultHi: number
  /** Market approach: multiple of annual revenue. */
  revMultLo: number
  revMultHi: number
}

export const TRADES: TradeBenchmark[] = [
  { key: 'gc',        label: 'General contractor',        marginLo: .02, marginHi: .05, revPerEmpLo: 350_000, revPerEmpHi: 500_000, sdeMultLo: 2.0, sdeMultHi: 3.0, revMultLo: .30, revMultHi: .50 },
  { key: 'sitework',  label: 'Sitework / excavation',     marginLo: .05, marginHi: .09, revPerEmpLo: 250_000, revPerEmpHi: 350_000, sdeMultLo: 2.5, sdeMultHi: 3.5, revMultLo: .45, revMultHi: .75 },
  { key: 'paving',    label: 'Paving / asphalt',          marginLo: .05, marginHi: .08, revPerEmpLo: 250_000, revPerEmpHi: 400_000, sdeMultLo: 2.5, sdeMultHi: 3.5, revMultLo: .50, revMultHi: .80 },
  { key: 'concrete',  label: 'Concrete',                  marginLo: .04, marginHi: .08, revPerEmpLo: 220_000, revPerEmpHi: 320_000, sdeMultLo: 2.3, sdeMultHi: 3.3, revMultLo: .40, revMultHi: .65 },
  { key: 'electrical',label: 'Electrical',                marginLo: .05, marginHi: .08, revPerEmpLo: 200_000, revPerEmpHi: 280_000, sdeMultLo: 2.5, sdeMultHi: 3.5, revMultLo: .40, revMultHi: .60 },
  { key: 'mech',      label: 'Plumbing / HVAC',           marginLo: .06, marginHi: .10, revPerEmpLo: 180_000, revPerEmpHi: 260_000, sdeMultLo: 3.0, sdeMultHi: 4.0, revMultLo: .50, revMultHi: .90 },
  { key: 'landscape', label: 'Landscaping / site services', marginLo: .06, marginHi: .10, revPerEmpLo: 120_000, revPerEmpHi: 180_000, sdeMultLo: 2.5, sdeMultHi: 3.5, revMultLo: .45, revMultHi: .70 },
  { key: 'specialty', label: 'Other specialty trade',     marginLo: .05, marginHi: .08, revPerEmpLo: 200_000, revPerEmpHi: 300_000, sdeMultLo: 2.5, sdeMultHi: 3.5, revMultLo: .40, revMultHi: .70 },
]

export const tradeByKey = (k: string | undefined | null): TradeBenchmark =>
  TRADES.find((t) => t.key === k) ?? TRADES[0]

export interface FinanceProfile {
  industry?: string
  lastYearRevenue?: number
  ytdRevenue?: number
  lastYearProfit?: number
  /** Owner salary + perks run through the business — added back for SDE. */
  ownerComp?: number
  /** Headcount override; falls back to the team roster count. */
  employees?: number
  /** Override for the auto fleet value (sum of asset purchase prices). */
  fleetValueOverride?: number
  otherAssets?: number
  liabilities?: number
}

export interface Range { lo: number; hi: number }

export interface ValuationResult {
  /** Income approach — capitalization of earnings. null when profit unknown. */
  income: Range | null
  sde: number | null
  /** Market approach — revenue comps. null when revenue unknown. */
  market: Range | null
  /** Asset approach — cost. null when no asset data at all. */
  asset: Range | null
  /** Blend across available methods (income 50 / market 30 / asset 20). */
  blended: Range | null
}

export function computeValuation(p: FinanceProfile, autoFleetValue: number, bm: TradeBenchmark): ValuationResult {
  const revenue = p.lastYearRevenue ?? null
  const profit = p.lastYearProfit ?? null
  const sde = profit != null ? profit + (p.ownerComp ?? 0) : null

  const income: Range | null = sde != null && sde > 0
    ? { lo: sde * bm.sdeMultLo, hi: sde * bm.sdeMultHi }
    : null
  const market: Range | null = revenue != null && revenue > 0
    ? { lo: revenue * bm.revMultLo, hi: revenue * bm.revMultHi }
    : null
  const fleet = p.fleetValueOverride ?? autoFleetValue
  const assetBase = fleet + (p.otherAssets ?? 0) - (p.liabilities ?? 0)
  const asset: Range | null = fleet > 0 || p.otherAssets != null
    ? { lo: Math.max(0, assetBase * 0.9), hi: Math.max(0, assetBase * 1.1) }
    : null

  // Weighted blend over whichever methods have data; weights renormalized.
  const parts: { r: Range; w: number }[] = []
  if (income) parts.push({ r: income, w: 0.5 })
  if (market) parts.push({ r: market, w: 0.3 })
  if (asset) parts.push({ r: asset, w: 0.2 })
  let blended: Range | null = null
  if (parts.length) {
    const W = parts.reduce((s, x) => s + x.w, 0)
    blended = {
      lo: parts.reduce((s, x) => s + x.r.lo * x.w, 0) / W,
      hi: parts.reduce((s, x) => s + x.r.hi * x.w, 0) / W,
    }
    // A going concern is worth at least its net hard assets.
    if (asset) blended = { lo: Math.max(blended.lo, asset.lo * 0.9), hi: Math.max(blended.hi, blended.lo) }
  }
  return { income, sde, market, asset, blended }
}

export const fmtMoney = (n: number): string =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  : n >= 1_000 ? `$${Math.round(n / 1_000)}k`
  : `$${Math.round(n)}`
