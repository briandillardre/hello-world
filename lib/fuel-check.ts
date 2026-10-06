/**
 * Fuel check — the pure half of the fuel reconciliation pilot
 * (/receipts/fuel, migration 130, docs/FUEL-RECONCILIATION.md).
 *
 * The market brief Brian forwarded (Oct 2026): Geotab and Samsara now DECLINE
 * fuel-card purchases at the pump off their telematics. HammerTrack issues no
 * card and declines nothing — it RECONCILES, vendor-neutral, for a contractor
 * whose fuel is bought on a mix of bank cards and fleet cards for a mix of
 * trucks and machines. Every purchase is read against the truck's own
 * evidence and only four things are ever raised:
 *
 *   asset_absent           the assigned vehicle was not at the pump
 *   gallons_exceed_tank    more gallons than the tank had room for
 *   no_runtime_after       no fill on the gauge and no running afterwards
 *   outside_shift_or_area  outside the cardholder's shift, the company's
 *                          hours, or anywhere the company works
 *
 * Each check answers pass / exception / can't check (or "pending" while the
 * evidence window is still open), with a plain-words sentence, the numbers
 * behind it, the dollars at risk, and `missing` — the telemetry whose absence
 * limited it. The pilot's deliverable is built from those: recoverable
 * dollars (valid verdicts), the false-positive rate, and the ranked list of
 * what dependable detection still needs.
 *
 * Pure: no database, no network. Safe in the browser (the import preview runs
 * here) and in `node scripts/fuel-check-test.mjs` — run it after ANY change.
 */
import { fuelFromLevels, haversineMi, MOVE_MPH, type FuelRefuel, type FuelSample } from './asset-stats'
import { addDaysKey, dayKey, fmtTime, tzOffsetMs, zonedMidnightMs } from './dates'
import { parseDelimited } from './bulk-import'

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type FuelSource = 'csv' | 'expense' | 'manual'
export type FuelProduct = 'diesel' | 'gas' | 'def' | 'other'
/** How well the merchant is placed: a single station (`exact`), the brand's
 *  stations around the city (`brand`), or only the city (`city`). */
export type GeoPrecision = 'exact' | 'brand' | 'city'
export type CheckKind = 'asset_absent' | 'gallons_exceed_tank' | 'no_runtime_after' | 'outside_shift_or_area'
export const CHECK_KINDS: CheckKind[] = ['asset_absent', 'gallons_exceed_tank', 'no_runtime_after', 'outside_shift_or_area']
export type CheckOutcome = 'pass' | 'exception' | 'unknown' | 'pending'
export type Severity = 'high' | 'medium' | 'low'
export type Verdict = 'valid' | 'false' | 'unsure'

export const KIND_LABEL: Record<CheckKind, string> = {
  asset_absent: 'Vehicle not at the pump',
  gallons_exceed_tank: 'More gallons than the tank holds',
  no_runtime_after: 'No running after the purchase',
  outside_shift_or_area: 'Outside the shift, hours or area',
}
export const KIND_SHORT: Record<CheckKind, string> = {
  asset_absent: 'At the pump',
  gallons_exceed_tank: 'Tank room',
  no_runtime_after: 'Ran after',
  outside_shift_or_area: 'Shift & area',
}
export const VERDICT_LABEL: Record<Verdict, string> = { valid: 'Valid', false: 'False alarm', unsure: 'Unsure' }

/** What limited a check. Stable codes — stored in fuel_exceptions.missing. */
export type MissingCode =
  | 'no_vehicle' | 'no_tracker' | 'tracker_silent' | 'no_time' | 'merchant_unplaced' | 'merchant_city_only'
  | 'no_tank_size' | 'no_fuel_level' | 'gauge_silent' | 'gallons_estimated' | 'no_runtime_signal'
  | 'no_clock' | 'no_cardholder' | 'no_zones' | 'stops_unchecked' | 'def_product'

export const MISSING_LABEL: Record<MissingCode, string> = {
  no_vehicle: 'No vehicle tied to the card',
  no_tracker: 'Vehicle has no tracker',
  tracker_silent: 'Tracker silent at the time',
  no_time: 'No time of day on the purchase',
  merchant_unplaced: 'Station not placed on the map',
  merchant_city_only: 'Station placed to the city only',
  no_tank_size: 'Tank size not set',
  no_fuel_level: 'Vehicle sends no fuel level',
  gauge_silent: 'Fuel gauge silent at the time',
  gallons_estimated: 'Gallons estimated from dollars',
  no_runtime_signal: 'Tracker sends no ignition',
  no_clock: 'Cardholder does not use the time clock',
  no_cardholder: 'Card not tied to a person',
  no_zones: 'No sites or yards drawn',
  stops_unchecked: 'Not every stop could be looked up',
  def_product: 'DEF — its own tank',
}

// Tunables. Each one is named in the docs; the harness pins them.
export const PILOT_DAYS = 90
export const CLASSIFY_DAYS = 30
/** A bank-export row this small at a convenience-store brand is the store, not the pump. */
export const MIN_FUEL_AMOUNT = 15
/** At the pump: this close to the station, this close in time. */
export const PRESENCE_RADIUS_TIME_M = 250
export const PRESENCE_RADIUS_DAY_M = 300
export const PRESENCE_WINDOW_MS = 30 * 60_000
/** Moving past the pump this close counts — a quick top-off with the engine
 *  running may record no stationary fix at all. */
export const DRIVE_BY_M = 100
/** The card's clock and the pump's disagree by minutes; a fill's measured
 *  window is matched to the purchase with this much slack. */
export const FILL_SLACK_MS = 45 * 60_000
/** Purchases near the edges of the work day are normal (fuel up on the way in or home). */
export const HOURS_GRACE_MIN = 60
export const SHIFT_GRACE_MIN = 30
/** "Uses the time clock" = clocked in at least once this close to the purchase. */
export const CLOCK_USE_DAYS = 14
/** Room-in-the-tank tolerance: the filler neck, the sender's dead band, a gauge reading taken before the last miles. */
export const TANK_TOL_MIN_GAL = 2
export const TANK_TOL_PCT = 0.1
/** Extra tolerance when the gallons are estimated from dollars at a default price. */
export const EST_TOL_PCT = 0.15

export interface PilotSettings {
  /** Default $/gal — used ONLY to estimate gallons on a row that has none. */
  gasPrice: number
  dieselPrice: number
  /** Approved area: within this many miles of a site, yard, place, or anywhere the vehicle went that day. */
  areaMiles: number
  /** How long after a purchase a fill or engine running must show up. */
  runtimeHours: number
}
export const DEFAULT_SETTINGS: PilotSettings = { gasPrice: 3.1, dieselPrice: 3.6, areaMiles: 5, runtimeHours: 24 }

/** Clamp a stored or typed settings blob to sane values. */
export function cleanSettings(raw: Partial<Record<keyof PilotSettings, unknown>> | null | undefined): PilotSettings {
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
  }
  return {
    gasPrice: Math.round(num(raw?.gasPrice, 0.5, 15, DEFAULT_SETTINGS.gasPrice) * 1000) / 1000,
    dieselPrice: Math.round(num(raw?.dieselPrice, 0.5, 15, DEFAULT_SETTINGS.dieselPrice) * 1000) / 1000,
    areaMiles: Math.round(num(raw?.areaMiles, 0.5, 100, DEFAULT_SETTINGS.areaMiles) * 10) / 10,
    runtimeHours: Math.round(num(raw?.runtimeHours, 4, 96, DEFAULT_SETTINGS.runtimeHours)),
  }
}

// ── Small parsers ───────────────────────────────────────────────────────────

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR',
])

/** Dollars from "$1,234.56", "(45.12)", "-45.12", "45.12-", "45.12 CR". Negative = money back. */
export function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^\$/, '')) || /-$/.test(s) || /\bcr\b/i.test(s)
  const digits = s.replace(/\b(cr|dr|usd)\b/gi, '').replace(/[^0-9.]/g, '')
  if (!digits || !/\d/.test(digits) || (digits.match(/\./g) ?? []).length > 1) return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  return Math.round((neg ? -n : n) * 100) / 100
}

/** A plain positive number ("18.432 gal", "3.299", "123,456"), or null. */
export function parseNum(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).replace(/,/g, '').trim()
  const m = s.match(/-?\d+(?:\.\d+)?|-?\.\d+/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** The card's last four digits from "4821", "XXXX-XXXX-XXXX-4821", "-41007", "Card ending in 4821". */
export function last4Of(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length >= 4 ? d.slice(-4) : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function dayOk(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return t.toISOString().slice(0, 10)
}

/** Minutes after local midnight from "08:42", "8:42 AM", "8:42:31 pm", "0842", "8:42p". */
export function parseTimeCell(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  let h: number, mi: number, ap: string | undefined
  const colon = s.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([ap])?\.?\s*m?\.?$/)
  const bare = colon ? null : s.match(/^(\d{3,4})\s*([ap])?\.?\s*m?\.?$/)
  if (colon) { h = Number(colon[1]); mi = Number(colon[2]); ap = colon[3] }
  else if (bare) {
    const v = bare[1].padStart(4, '0')
    h = Number(v.slice(0, 2)); mi = Number(v.slice(2)); ap = bare[2]
  } else return null
  if (mi > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'p' && h !== 12) h += 12
    if (ap === 'a' && h === 12) h = 0
  } else if (h > 23) return null
  return h * 60 + mi
}

export interface ParsedWhen {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  /** Minutes after local midnight, when the cell carried a time. */
  minutes: number | null
  /** An absolute instant, when the cell carried a UTC offset (ISO with Z / ±hh:mm). */
  absMs?: number
}

/** A date (and maybe a time) as exports write them: ISO, M/D/YYYY, M/D/YY,
 *  01-OCT-2026, "Oct 1, 2026", 20261001, Excel serials; time after a space or a T. */
export function parseDateCell(raw: string | null | undefined): ParsedWhen | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let m: RegExpMatchArray | null
  // ISO with an offset is an instant.
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i))) {
    const ms = Date.parse(s.replace(' ', 'T'))
    const day = dayOk(+m[1], +m[2], +m[3])
    return day && Number.isFinite(ms) ? { day, minutes: Number(m[4]) * 60 + Number(m[5]), absMs: ms } : null
  }
  let day: string | null = null
  let rest = ''
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/))) { day = dayOk(+m[1], +m[2], +m[3]); rest = m[4] ?? '' }
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+(.*))?$/))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    day = dayOk(y, +m[1], +m[2]); rest = m[4] ?? ''
  } else if ((m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2}|\d{4})(?:\s+(.*))?$/))) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    day = mon < 0 ? null : dayOk(y, mon + 1, +m[1]); rest = m[4] ?? ''
  } else if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(.*))?$/))) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    day = mon < 0 ? null : dayOk(+m[3], mon + 1, +m[2]); rest = m[4] ?? ''
  } else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    day = dayOk(+m[1], +m[2], +m[3])
  } else if ((m = s.match(/^(\d{5})(?:\.(\d+))?$/))) {
    // An Excel date cell pasted as its serial (days since 1899-12-30); the
    // fraction is the time of day.
    const n = Number(m[1])
    if (n < 36526 || n > 73050) return null
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10)
    const frac = m[2] ? Number('0.' + m[2]) : null
    return { day: d, minutes: frac == null ? null : Math.round(frac * 1440) % 1440 }
  }
  if (!day) return null
  const minutes = rest.trim() ? parseTimeCell(rest.trim()) : null
  if (rest.trim() && minutes == null) return null
  return { day, minutes }
}

/** A local wall-clock moment in `tz` → epoch ms (DST-safe: one refinement). */
export function localToUtcMs(day: string, minutes: number, tz: string): number {
  const [y, mo, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, d, 0, minutes)
  return guess - tzOffsetMs(tz, guess - tzOffsetMs(tz, guess))
}

// ── Merchants ───────────────────────────────────────────────────────────────

/** Brands that sell fuel in the Carolinas (and the national ones). The
 *  canonical name is what OpenStreetMap calls the station — the geocoder
 *  searches for it. `needsFuelWord`: a grocery or warehouse store that also
 *  sells fuel only counts when the line says so ("COSTCO GAS #1234"). */
const BRANDS: { brand: string; re: RegExp; needsFuelWord?: true }[] = [
  { brand: 'Spinx', re: /\bspinx\b/ },
  { brand: 'QuikTrip', re: /\bquik ?trip\b|\bqt\b/ },
  { brand: 'RaceTrac', re: /\brace ?trac\b/ },
  { brand: 'RaceWay', re: /\braceway\b/ },
  { brand: 'Circle K', re: /\bcircle ?k\b/ },
  { brand: 'Speedway', re: /\bspeedway\b/ },
  { brand: 'Murphy USA', re: /\bmurphy(?![a-z])|\bmurphy ?(usa|express)\b/ },
  { brand: 'Shell', re: /\bshell\b/ },
  { brand: 'Exxon', re: /\bexxon/ },
  { brand: 'Mobil', re: /\bmobil\b/ },
  { brand: 'BP', re: /\bbp(?![a-z])/ },
  { brand: 'Marathon', re: /\bmarathon\b/ },
  { brand: 'Sunoco', re: /\bsunoco\b/ },
  { brand: 'Flying J', re: /\bflying ?j\b/ },
  { brand: 'Pilot', re: /\bpilot(?![a-z])/ },
  { brand: "Love's", re: /\blove'?s(?![a-z])/ },
  { brand: 'Kangaroo Express', re: /\bkangaroo\b/ },
  { brand: 'Citgo', re: /\bcitgo\b/ },
  { brand: 'Valero', re: /\bvalero\b/ },
  { brand: 'Chevron', re: /\bchevron\b/ },
  { brand: 'Texaco', re: /\btexaco\b/ },
  { brand: 'Sheetz', re: /\bsheetz\b/ },
  { brand: 'Wawa', re: /\bwawa\b/ },
  { brand: 'Phillips 66', re: /\bphillips ?66\b/ },
  { brand: 'Sinclair', re: /\bsinclair\b/ },
  { brand: 'Enmarket', re: /\benmarket\b/ },
  { brand: 'Refuel', re: /\brefuel\b/ },
  { brand: 'Corner Pantry', re: /\bcorner pantry\b/ },
  { brand: 'TravelCenters of America', re: /\btravel ?centers?\b|\bpetro stopping\b|\bta (travel|truck)\b/ },
  { brand: "Sam's Club", re: /\bsam'?s ?club\b|\bsamsclub\b/, needsFuelWord: true },
  { brand: 'Costco', re: /\bcostco\b/, needsFuelWord: true },
  { brand: 'Ingles', re: /\bingles\b/, needsFuelWord: true },
  { brand: 'Kroger', re: /\bkroger\b/, needsFuelWord: true },
  { brand: 'Walmart', re: /\bwal-?mart\b|\bwalmart\b/, needsFuelWord: true },
]

const FUEL_WORD = /\b(fuel|fuels|gas|gasoline|petro|petroleum|diesel|oil co|oil company|travel (center|centers|plaza|stop)|truck ?stop|truckstop|service station|filling station|gas ?n ?go)\b/i
/** Gas the utility bills for, not gas that goes in a truck. */
const NOT_ENGINE_FUEL = /\b(natural gas|gas south|piedmont natural|dominion energy|scana|spire|propane|amerigas|ferrellgas|blue rhino|gas bill|gas utility)\b/i
const FUEL_CATEGORY = /\b(gas|gasoline|fuel|fuels|service stations?|petroleum|automotive fuel)\b|\b(5541|5542|5983|5172)\b/i

/** The canonical brand named in a merchant line, or null. */
export function fuelBrand(desc: string | null | undefined): string | null {
  const s = String(desc ?? '').toLowerCase().replace(/\*/g, ' ')
  if (!s.trim()) return null
  for (const b of BRANDS) {
    if (b.re.test(s) && (!b.needsFuelWord || FUEL_WORD.test(s))) return b.brand
  }
  return null
}

/** Does a card line look like a fuel purchase? Brand, fuel word, or the
 *  issuer's own category ("Gas", "Gas/Automotive", "Transportation-Fuel", MCC 5541/5542). */
export function isFuelMerchant(desc: string | null | undefined, category?: string | null): boolean {
  const s = String(desc ?? '')
  if (NOT_ENGINE_FUEL.test(s) || NOT_ENGINE_FUEL.test(String(category ?? ''))) return false
  if (fuelBrand(s)) return true
  if (FUEL_WORD.test(s)) return true
  return !!category && FUEL_CATEGORY.test(category)
}

/** diesel / gas / def / other from a product cell or a merchant line. */
export function productOf(raw: string | null | undefined): FuelProduct | null {
  const s = ` ${String(raw ?? '').toLowerCase()} `
  if (!s.trim()) return null
  if (/\b(def|diesel exhaust fluid|adblue|urea)\b/.test(s)) return 'def'
  if (/\b(diesel|dsl|ulsd|lsd|d2|bio ?diesel|off ?road|dyed|clear diesel|reefer)\b|#\s?2\b|\bno\.? ?2\b|\bb(5|10|11|20)\b/.test(s)) return 'diesel'
  if (/\b(unleaded|unl|unld|regular|reg|plus|premium|prem|super|mid ?grade|midgrade|gasoline|gas|e10|e15|e85|87|88|89|91|93|ethanol)\b/.test(s)) return 'gas'
  if (/\b(oil|wash|merch|merchandise|food|snack|parts|service|repair|tire|labor|misc|store|tax|fee|grocery|beverage|tobacco)\b/.test(s)) return 'other'
  return null
}

export interface MerchantParts {
  brand: string | null
  storeNo: string | null
  /** The name to search for when there is no brand ("Mays Food Mart"). */
  name: string
  /** City words read off the end of a bank line, longest first — the
   *  geocoder keeps the first one that is a real place in that state. */
  cityCandidates: string[]
  state: string | null
  zip: string | null
  fuelWord: boolean
}

const GENERIC = new Set(['FUEL', 'FUELS', 'GAS', 'OIL', 'CO', 'INC', 'LLC', 'STORE', 'STATION', 'MART', 'FOOD', 'EXPRESS', 'USA',
  'TRAVEL', 'CENTER', 'PLAZA', 'STOP', 'SHOP', 'THE', 'AND', 'OF', 'PURCHASE', 'POS', 'DEBIT', 'CARD', 'PAYMENT', 'SQ', 'TST'])
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())

/** Brand, store number, city words and state off a card line like
 *  "SPINX #0156 NORTH CHARLESTON SC" or "CIRCLE K 02725 SPARTANBURG SC". */
export function parseMerchant(desc: string | null | undefined): MerchantParts {
  // Bank lines glue a store number to the city ("#0156GREENVILLE") — split them.
  const clean = String(desc ?? '').replace(/[*]/g, ' ').replace(/(\d)([A-Za-z]{3,})/g, '$1 $2').replace(/\s+/g, ' ').trim()
  const brand = fuelBrand(clean)
  const body = clean.split(/[\s,]+/).filter(Boolean)
  let zip: string | null = null
  let state: string | null = null
  if (body.length && /^\d{5}(-\d{4})?$/.test(body[body.length - 1])) zip = body.pop()!.slice(0, 5)
  if (body.length > 1 && US_STATE_CODES.has(body[body.length - 1].toUpperCase())) state = body.pop()!.toUpperCase()
  while (body.length && /^\(?\d{3}\)?-?\d{3}-?\d{4}$/.test(body[body.length - 1])) body.pop()
  const brandRe = brand ? BRANDS.find((b) => b.brand === brand)?.re ?? null : null
  // City words: the alphabetic run that closes the line, when a state closes
  // it — up to three words, longest first ("North Charleston", "Charleston").
  const words: string[] = []
  if (state) {
    for (let i = body.length - 1; i >= 0 && words.length < 3; i--) {
      const t = body[i].toUpperCase()
      if (!/^[A-Z][A-Z'.-]*$/.test(t) || t.length < 2 || GENERIC.has(t) || (brandRe && brandRe.test(t.toLowerCase()))) break
      words.unshift(t)
    }
  }
  const cityCandidates: string[] = []
  for (let k = words.length; k >= 1; k--) cityCandidates.push(titleCase(words.slice(words.length - k).join(' ')))
  // The store number sits between the name and the city.
  const head = body.slice(0, body.length - words.length)
  let storeNo: string | null = null
  let nameEnd = head.length
  for (let i = 0; i < head.length; i++) {
    const t = head[i]
    const m = t.match(/^#\s?(\d{1,6})$/) ?? (t === '#' && /^\d{1,6}$/.test(head[i + 1] ?? '') ? [t, head[i + 1]] : null) ?? t.match(/^(\d{2,6})$/)
    if (m) { storeNo = m[1]; nameEnd = i; break }
    if (/^#?\d/.test(t)) { nameEnd = i; break }
  }
  const name = brand ?? titleCase(head.slice(0, nameEnd).join(' ').replace(/[^A-Za-z0-9&' -]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 60)
  return { brand, storeNo, name, cityCandidates, state, zip, fuelWord: FUEL_WORD.test(clean) }
}

/** diesel / gas from what the owner wrote about a vehicle (the VIN decode's
 *  `fuel`, the name), or null. Machines and heavy trucks burn diesel. */
export function fuelTypeOf(meta: unknown, name: string, type: string): 'diesel' | 'gas' | null {
  const md = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  const specs = (md.specs && typeof md.specs === 'object' ? md.specs : {}) as Record<string, unknown>
  const f = String(md.fuel ?? specs.fuel ?? md.fuel_type ?? '').toLowerCase()
  if (/diesel/.test(f)) return 'diesel'
  if (/gas|petrol|flex/.test(f)) return 'gas'
  const n = ` ${name.toLowerCase()} `
  if (/diesel|duramax|cummins|power ?stroke|\bdsl\b|\bf-?[4-7]50\b|peterbilt|kenworth|freightliner|mack\b|international|tri-?axle|dump|excavator|dozer|loader|roller|skid|backhoe/.test(n)) return 'diesel'
  if (type === 'equipment') return 'diesel'
  return null
}

/** The geocode cache key for a merchant: the brand (or its name), where, and the street when known. */
export function merchantKey(p: { brand: string | null; name: string; city: string | null; cityCandidates: string[]; state: string | null; address: string | null }): string {
  const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const city = p.city ? norm(p.city) : p.cityCandidates.map(norm).join('/')
  return [norm(p.brand ?? p.name), city, norm(p.state), norm(p.address)].join('|').slice(0, 200)
}

// ── CSV import ──────────────────────────────────────────────────────────────

export type FuelField =
  | 'date' | 'postDate' | 'datetime' | 'time' | 'merchant' | 'address' | 'city' | 'state' | 'cityState' | 'zip'
  | 'lat' | 'lng' | 'gallons' | 'unitPrice' | 'product' | 'amount' | 'debit' | 'credit' | 'odometer'
  | 'card' | 'driver' | 'vehicle' | 'category' | 'txnId' | 'job'

export const FUEL_FIELDS: { key: FuelField; label: string; aliases: string[]; contains?: string[] }[] = [
  { key: 'date', label: 'Date', aliases: ['date', 'transactiondate', 'transdate', 'txndate', 'purchasedate', 'saledate', 'trandate', 'dateoftransaction', 'transactiondt', 'fueldate'] },
  { key: 'postDate', label: 'Posted date', aliases: ['postdate', 'posteddate', 'postingdate', 'settlementdate', 'postedon', 'processdate'] },
  { key: 'datetime', label: 'Date & time', aliases: ['datetime', 'transactiondatetime', 'timestamp', 'dateandtime', 'transdatetime', 'purchasedatetime', 'transactiondatetimelocal', 'localdatetime'] },
  { key: 'time', label: 'Time', aliases: ['time', 'transactiontime', 'transtime', 'txntime', 'purchasetime', 'saletime', 'trantime', 'localtime', 'timeoftransaction'] },
  { key: 'merchant', label: 'Station', aliases: ['merchant', 'merchantname', 'sitename', 'site', 'station', 'stationname', 'locationname', 'description', 'name', 'payee', 'vendor', 'vendorname', 'merchantdescription', 'appearsonyourstatementas', 'transactiondescription', 'truckstopname', 'details', 'merchantinfo'], contains: ['merchant', 'vendor', 'station'] },
  { key: 'address', label: 'Address', aliases: ['address', 'siteaddress', 'merchantaddress', 'street', 'streetaddress', 'locationaddress', 'merchantstreet', 'address1', 'truckstopaddress', 'stationaddress'], contains: ['address'] },
  { key: 'city', label: 'City', aliases: ['city', 'sitecity', 'merchantcity', 'truckstopcity', 'stationcity', 'locationcity'] },
  { key: 'state', label: 'State', aliases: ['state', 'sitestate', 'merchantstate', 'truckstopstate', 'stationstate', 'st', 'locationstate', 'province', 'stateprovince'] },
  { key: 'cityState', label: 'City & state', aliases: ['citystate', 'citystatezip', 'merchantcitystate', 'location', 'merchantlocation', 'sitelocation'] },
  { key: 'zip', label: 'ZIP', aliases: ['zip', 'zipcode', 'postalcode', 'sitezip', 'merchantzip', 'postcode'], contains: ['zip'] },
  { key: 'lat', label: 'Latitude', aliases: ['latitude', 'lat', 'sitelatitude', 'merchantlatitude'] },
  { key: 'lng', label: 'Longitude', aliases: ['longitude', 'lng', 'lon', 'long', 'sitelongitude', 'merchantlongitude'] },
  { key: 'gallons', label: 'Gallons', aliases: ['gallons', 'units', 'quantity', 'qty', 'volume', 'fuelquantity', 'gal', 'unitspurchased', 'fuelgallons', 'gallonspurchased', 'totalgallons', 'numberofunits', 'fuelqty', 'quantitygallons', 'fuelunits'], contains: ['gallon'] },
  { key: 'unitPrice', label: 'Price / gal', aliases: ['priceperunit', 'pricepergallon', 'unitprice', 'ppg', 'pricegal', 'costperunit', 'unitcost', 'price', 'pumpprice', 'retailprice', 'ppu', 'perunit', 'costpergallon'], contains: ['price'] },
  { key: 'product', label: 'Product', aliases: ['product', 'productdescription', 'fueltype', 'producttype', 'productname', 'item', 'itemdescription', 'fuelgrade', 'grade', 'productcode', 'productclass', 'fuelproduct'], contains: ['product'] },
  { key: 'amount', label: 'Amount', aliases: ['amount', 'total', 'totalamount', 'netamount', 'grossamount', 'transactionamount', 'fuelamount', 'charge', 'chargeamount', 'totalcost', 'cost', 'totalfuelcost', 'amountusd', 'billedamount', 'netcost', 'totalsale', 'saleamount'], contains: ['amount', 'total'] },
  { key: 'debit', label: 'Debit', aliases: ['debit', 'withdrawal', 'debitamount', 'withdrawals', 'charges'] },
  { key: 'credit', label: 'Credit', aliases: ['credit', 'deposit', 'creditamount', 'payment', 'credits', 'payments'] },
  { key: 'odometer', label: 'Odometer', aliases: ['odometer', 'odo', 'odometerreading', 'currentodometer', 'mileage', 'miles', 'hubometer', 'hubodometer'], contains: ['odom'] },
  { key: 'card', label: 'Card', aliases: ['card', 'cardnumber', 'cardno', 'cardlast4', 'last4', 'cardending', 'accountnumber', 'account', 'cardnum', 'cardid', 'fleetcard', 'cardlastfour', 'lastfour', 'cardlast4digits'], contains: ['card'] },
  { key: 'driver', label: 'Driver', aliases: ['driver', 'drivername', 'driverid', 'employee', 'employeename', 'cardholder', 'cardholdername', 'cardmember', 'cardmembername', 'emp', 'empname', 'user', 'username', 'purchaser', 'holder', 'drivernumber'], contains: ['driver'] },
  { key: 'vehicle', label: 'Vehicle', aliases: ['vehicle', 'vehiclenumber', 'vehicleno', 'vehicleid', 'unit', 'unitnumber', 'unitno', 'unitid', 'asset', 'assetnumber', 'assetid', 'vehicledescription', 'truck', 'trucknumber', 'equipment', 'equipmentnumber', 'vehiclename', 'customvehicleid', 'vehicleunit'], contains: ['vehicle'] },
  { key: 'category', label: 'Category', aliases: ['category', 'type', 'transactiontype', 'mcc', 'merchantcategory', 'merchantcategorycode', 'mcccode', 'expensecategory', 'spendcategory', 'class'], contains: ['category'] },
  { key: 'txnId', label: 'Reference #', aliases: ['transactionid', 'transid', 'txnid', 'reference', 'referencenumber', 'refnumber', 'ref', 'authcode', 'authorizationcode', 'authorization', 'transactionnumber', 'invoice', 'invoicenumber', 'receiptnumber', 'confirmation', 'sequencenumber', 'trxid', 'transactionreference'] },
  { key: 'job', label: 'Job / site', aliases: ['job', 'jobnumber', 'jobno', 'jobname', 'project', 'projectname', 'projectnumber', 'jobcode', 'department', 'dept', 'costcenter', 'customerjob', 'sitejob'] },
]
const FIELD_KEYS = new Set<FuelField>(FUEL_FIELDS.map((f) => f.key))
export const FIELD_LABEL: Record<FuelField, string> = Object.fromEntries(FUEL_FIELDS.map((f) => [f.key, f.label])) as Record<FuelField, string>

export const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Column → field for a header row. Exact aliases first, then a few "contains"
 *  rules for headings nobody planned for; a field is never claimed twice. */
export function guessFuelMapping(header: string[]): (FuelField | null)[] {
  const alias = new Map<string, FuelField>()
  for (const f of FUEL_FIELDS) for (const a of f.aliases) if (!alias.has(a)) alias.set(a, f.key)
  const taken = new Set<FuelField>()
  const out: (FuelField | null)[] = header.map(() => null)
  header.forEach((h, i) => {
    const k = alias.get(normHeader(h))
    if (k && !taken.has(k)) { out[i] = k; taken.add(k) }
  })
  header.forEach((h, i) => {
    if (out[i]) return
    const n = normHeader(h)
    if (!n) return
    let k: FuelField | null = null
    if (/date/.test(n) && /time/.test(n)) k = 'datetime'
    else if (/post|settle/.test(n) && /date/.test(n)) k = 'postDate'
    else if (/date/.test(n) && !/update/.test(n)) k = 'date'
    else if (/time/.test(n) && !/times/.test(n)) k = 'time'
    else for (const f of FUEL_FIELDS) if (f.contains?.some((c) => n.includes(c))) { k = f.key; break }
    if (k && !taken.has(k)) { out[i] = k; taken.add(k) }
  })
  return out
}

/** The header row: the first of the opening lines that names at least two
 *  fields (exports often lead with a title and an account line). -1 = none. */
export function findHeaderRow(grid: string[][]): number {
  const alias = new Set<string>()
  for (const f of FUEL_FIELDS) for (const a of f.aliases) alias.add(a)
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const hits = grid[i].filter((c) => alias.has(normHeader(c))).length
    if (hits >= 2) return i
  }
  return -1
}

export interface FuelDraft {
  line: number
  dedupeKey: string
  txnDate: string
  txnAtMs: number | null
  hasTime: boolean
  merchant: string
  brand: string | null
  storeNo: string | null
  name: string
  address: string | null
  city: string | null
  cityCandidates: string[]
  state: string | null
  zip: string | null
  lat: number | null
  lng: number | null
  gallons: number | null
  unitPrice: number | null
  amount: number
  product: FuelProduct | null
  cardLast4: string | null
  driver: string | null
  vehicle: string | null
  odometer: number | null
  job: string | null
  txnId: string | null
  category: string | null
  /** The row as exported (header → cell), bounded. */
  raw: Record<string, string>
}

export interface FuelCsvPreview {
  header: string[]
  headerRow: number
  mapping: (FuelField | null)[]
  /** The first line under the header, as cells — the preview's hint per column. */
  sampleRow: string[]
  rows: FuelDraft[]
  skipped: { line: number; reason: string; text: string }[]
  /** 'fleet' = a fuel-card export (gallons or products); 'bank' = a card/bank statement. */
  shape: 'fleet' | 'bank'
  /** The amount column carried charges as negatives (bank convention) and was flipped. */
  signFlipped: boolean
  warnings: string[]
}

export const MAX_IMPORT_ROWS = 3000

/**
 * Parse a fuel-card or bank/card export. Fleet exports (WEX, Fuelman,
 * Comdata…) keep their fuel lines (diesel, gas, DEF — not the car wash);
 * bank exports keep the lines that read as fuel (brand, fuel word, or the
 * issuer's category) and drop the rest with the reason. Times are read in the
 * company's zone. The same function runs in the browser preview and in the
 * import action, so the server never writes a row the preview didn't show.
 */
export function parseFuelCsv(text: string, opts: { tz: string; mapping?: (FuelField | null)[] | null }): FuelCsvPreview {
  const grid = parseDelimited(text.slice(0, 2_000_000))
  const empty: FuelCsvPreview = { header: [], headerRow: -1, mapping: [], sampleRow: [], rows: [], skipped: [], shape: 'bank', signFlipped: false, warnings: [] }
  if (!grid.length) return { ...empty, warnings: ['Nothing to read — paste the export or pick the CSV file.'] }
  const headerRow = findHeaderRow(grid)
  if (headerRow < 0) return { ...empty, warnings: ['No header row found — the first lines should name the columns (Date, Description, Amount…).'] }
  const header = grid[headerRow]
  const mapping = (opts.mapping && opts.mapping.length === header.length
    ? opts.mapping.map((k) => (k && FIELD_KEYS.has(k) ? k : null))
    : guessFuelMapping(header))
  const col = (f: FuelField) => mapping.indexOf(f)
  const has = (f: FuelField) => col(f) >= 0
  const warnings: string[] = []
  if (!has('date') && !has('datetime') && !has('postDate')) warnings.push('No date column — pick which column is the date.')
  if (!has('amount') && !has('debit')) warnings.push('No amount column — pick which column is the amount.')
  if (!has('merchant')) warnings.push('No merchant column — pick which column names the station.')
  const shape: 'fleet' | 'bank' = has('gallons') || has('product') ? 'fleet' : 'bank'

  const body = grid.slice(headerRow + 1, headerRow + 1 + MAX_IMPORT_ROWS)
  if (grid.length - headerRow - 1 > MAX_IMPORT_ROWS) warnings.push(`Only the first ${MAX_IMPORT_ROWS.toLocaleString('en-US')} lines are read — split the export.`)
  const cell = (r: string[], f: FuelField) => (has(f) ? (r[col(f)] ?? '').trim() : '')

  // Bank exports disagree on the sign of a charge. Decide once per file from
  // the lines that read as fuel: mostly negative → charges are negative.
  let signFlipped = false
  if (!has('debit') && has('amount')) {
    let neg = 0, pos = 0
    for (const r of body) {
      const a = parseMoney(cell(r, 'amount'))
      if (a == null || a === 0) continue
      if (shape === 'bank' && !isFuelMerchant(cell(r, 'merchant'), cell(r, 'category'))) continue
      if (a < 0) neg++; else pos++
    }
    signFlipped = shape === 'bank' && neg > pos
  }

  const rows: FuelDraft[] = []
  const skipped: FuelCsvPreview['skipped'] = []
  const seen = new Map<string, number>()
  body.forEach((r, i) => {
    const line = headerRow + 2 + i
    if (r.every((c) => !c.trim())) return
    const text = r.join(' · ').slice(0, 160)
    const skip = (reason: string) => { skipped.push({ line, reason, text }) }
    // When
    let when: ParsedWhen | null = null
    if (has('datetime')) when = parseDateCell(cell(r, 'datetime'))
    if (!when && has('date')) when = parseDateCell(cell(r, 'date'))
    if (!when && has('postDate')) when = parseDateCell(cell(r, 'postDate'))
    if (!when) return skip('No readable date')
    if (when.minutes == null && has('time')) {
      const t = parseTimeCell(cell(r, 'time'))
      if (t != null) when = { ...when, minutes: t }
    }
    // How much
    let amount: number | null = null
    if (has('debit') && cell(r, 'debit')) amount = parseMoney(cell(r, 'debit'))
    else if (has('amount')) {
      const a = parseMoney(cell(r, 'amount'))
      amount = a == null ? null : signFlipped ? -a : a
    }
    if (amount == null) return skip(has('credit') && cell(r, 'credit') ? 'A credit or payment' : 'No readable amount')
    if (amount <= 0) return skip('A credit, refund or payment')
    if (amount > 20_000) return skip('Over $20,000 — not one fuel purchase')
    const merchant = cell(r, 'merchant').replace(/\s+/g, ' ').slice(0, 160)
    if (!merchant) return skip('No merchant')
    const category = cell(r, 'category') || null
    let gallons = has('gallons') ? parseNum(cell(r, 'gallons')) : null
    if (gallons != null && !(gallons > 0 && gallons < 2000)) gallons = null
    // Pump prices carry three decimals ($3.459) — not money-rounded.
    let unitPrice = has('unitPrice') ? parseNum(cell(r, 'unitPrice')) : null
    if (unitPrice != null) unitPrice = unitPrice >= 0.5 && unitPrice <= 15 ? Math.round(unitPrice * 1000) / 1000 : null
    const productCell = cell(r, 'product')
    let product = productOf(productCell)
    if (shape === 'fleet') {
      if (product === 'other') return skip(`Not fuel (${productCell.slice(0, 30)})`)
      if (!product && gallons == null && !isFuelMerchant(merchant, category)) return skip('Not fuel — no gallons, no fuel product')
    } else {
      if (!isFuelMerchant(merchant, category)) return skip('Not a fuel merchant')
      if (gallons == null && amount < MIN_FUEL_AMOUNT) return skip(`Under $${MIN_FUEL_AMOUNT} — likely the store, not the pump`)
    }
    if (!product) product = productOf(merchant) === 'diesel' ? 'diesel' : null

    const parts = parseMerchant(merchant)
    let city = cell(r, 'city') || null
    let state = (cell(r, 'state') || '').toUpperCase() || null
    let zip = cell(r, 'zip') || parts.zip
    if (has('cityState')) {
      const cs = parseMerchant(`X ${cell(r, 'cityState')}`)
      if (!state && cs.state) state = cs.state
      if (!city && cs.cityCandidates.length) city = cs.cityCandidates[0]
      zip = zip || cs.zip
    }
    if (state && !US_STATE_CODES.has(state)) state = null
    if (!state) state = parts.state
    const lat = has('lat') ? parseNum(cell(r, 'lat')) : null
    const lng = has('lng') ? parseNum(cell(r, 'lng')) : null
    const okLL = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

    let txnAtMs: number | null = null
    if (when.absMs != null) txnAtMs = when.absMs
    else if (when.minutes != null) txnAtMs = localToUtcMs(when.day, when.minutes, opts.tz)
    const txnDate = when.absMs != null ? dayKey(when.absMs, opts.tz) : when.day
    const cardLast4 = last4Of(cell(r, 'card'))
    const txnId = cell(r, 'txnId').slice(0, 80) || null
    const cents = Math.round(amount * 100)
    const base = txnId
      ? `csv:id:${normHeader(txnId)}`
      : `csv:${txnDate}|${when.minutes ?? ''}|${cents}|${cardLast4 ?? ''}|${normHeader(merchant).slice(0, 24)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const raw: Record<string, string> = {}
    header.forEach((h, j) => { if (h && r[j] && Object.keys(raw).length < 40) raw[h.slice(0, 60)] = r[j].slice(0, 200) })
    rows.push({
      line,
      dedupeKey: (n > 1 ? `${base}|${n}` : base).slice(0, 200),
      txnDate,
      txnAtMs,
      hasTime: txnAtMs != null,
      merchant,
      brand: parts.brand,
      storeNo: parts.storeNo,
      name: parts.name,
      address: cell(r, 'address').slice(0, 160) || null,
      city: city ? titleCase(city).slice(0, 80) : null,
      cityCandidates: city ? [] : parts.cityCandidates,
      state,
      zip: zip ? zip.slice(0, 10) : null,
      lat: okLL ? lat : null,
      lng: okLL ? lng : null,
      gallons: gallons != null ? Math.round(gallons * 1000) / 1000 : null,
      unitPrice,
      amount,
      product,
      cardLast4,
      driver: cell(r, 'driver').slice(0, 80) || null,
      vehicle: cell(r, 'vehicle').slice(0, 80) || null,
      odometer: has('odometer') ? parseNum(cell(r, 'odometer')) : null,
      job: cell(r, 'job').slice(0, 80) || null,
      txnId,
      category,
      raw,
    })
  })
  if (!rows.length && !warnings.length) warnings.push(skipped.length ? 'No fuel purchases found in this export.' : 'No rows under the header.')
  return { header, headerRow, mapping, sampleRow: (grid[headerRow + 1] ?? []).map((c) => c.slice(0, 40)), rows, skipped, shape, signFlipped, warnings }
}

/** Two records of ONE purchase arriving by different doors (a card alert and
 *  the month's statement): same day (±1 for a midnight swipe), same cents,
 *  compatible card and time and brand. */
export function samePurchase(
  a: { txnDate: string; amount: number; cardLast4: string | null; txnAtMs: number | null; brand: string | null },
  b: { txnDate: string; amount: number; cardLast4: string | null; txnAtMs: number | null; brand: string | null },
): boolean {
  if (Math.round(a.amount * 100) !== Math.round(b.amount * 100)) return false
  const days = Math.abs(Date.parse(a.txnDate + 'T12:00:00Z') - Date.parse(b.txnDate + 'T12:00:00Z')) / 86_400_000
  if (!(days <= 1)) return false
  if (a.cardLast4 && b.cardLast4 && a.cardLast4 !== b.cardLast4) return false
  if (a.txnAtMs != null && b.txnAtMs != null && Math.abs(a.txnAtMs - b.txnAtMs) > 20 * 60_000) return false
  if (a.brand && b.brand && a.brand !== b.brand) return false
  return days === 0 || (a.txnAtMs != null && b.txnAtMs != null)
}

// ── Geometry ────────────────────────────────────────────────────────────────

export interface LatLng { lat: number; lng: number }
export const M_PER_MI = 1609.344
export const metresBetween = (a: LatLng, b: LatLng) => haversineMi(a.lat, a.lng, b.lat, b.lng) * M_PER_MI

function inRing(pt: LatLng, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Metres from a point to a zone ([lng, lat] ring): 0 inside, else to the nearest edge. */
export function metresToRing(pt: LatLng, ring: [number, number][]): number {
  if (ring.length < 3) return Infinity
  if (inRing(pt, ring)) return 0
  const kx = 111_320 * Math.cos((pt.lat * Math.PI) / 180)
  const ky = 110_540
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - pt.lng) * kx, ay = (ring[j][1] - pt.lat) * ky
    const bx = (ring[i][0] - pt.lng) * kx, by = (ring[i][1] - pt.lat) * ky
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/** "140 ft" under a tenth of a mile, "0.4 mi", "14 mi". */
export function fmtDist(m: number): string {
  const mi = m / M_PER_MI
  if (mi < 0.1) return `${Math.max(10, Math.round((m * 3.28084) / 10) * 10)} ft`
  if (mi < 10) return `${(Math.round(mi * 10) / 10).toFixed(1)} mi`
  return `${Math.round(mi)} mi`
}
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const gal = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} gal`
const dayWords = (key: string) => new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

// ── The checks ──────────────────────────────────────────────────────────────

export interface CheckTxn {
  id: string
  /** Local calendar day of the purchase. */
  txnDate: string
  /** The purchase moment, when the export carried a time. */
  txnAtMs: number | null
  amount: number
  gallons: number | null
  unitPrice: number | null
  product: FuelProduct | null
  merchant: string
  brand: string | null
  /** Where the station is: one point (`exact`), the brand's stations around
   *  the city (`brand`), or the city's middle (`city`). Empty = not placed. */
  points: LatLng[]
  precision: GeoPrecision | null
  /** "Spinx · Goose Creek" — how the evidence names the station. */
  placeLabel: string | null
  /** Rough radius of the city when only the city is known, metres. */
  cityRadiusM?: number | null
  cardLast4: string | null
  cardholderUserId: string | null
}

export interface CheckAsset {
  id: string
  name: string
  type: string
  /** Has a tracker that has ever reported. */
  hasTracker: boolean
  tankGal: number | null
  fuelType: 'diesel' | 'gas' | null
  reportsFuelLevel: boolean
  /** The tracker sends an ignition / engine state (OBD, wired). Battery GPS units do not. */
  reportsIgnition: boolean
}

/** A place the asset sat still: from the stop-cluster read, merged. */
export interface StopRec {
  lat: number
  lng: number
  fromMs: number
  toMs: number
  n: number
  engineOff: boolean
  /** A fuel station within reach of this stop (reverse lookup): its name, ''
   *  when looked up and none, undefined when not looked up. */
  fuelStation?: string
}
export interface FixRec { lat: number; lng: number; ms: number; speed: number | null }

export interface PresenceEvidence {
  fromMs: number
  toMs: number
  /** The assigned asset's fixes near any of the station's points in the window. */
  near: { firstMs: number; lastMs: number; n: number; stillN: number; minM: number } | null
  /** The asset's stops in the window (unplaced station: the fuel-stop search). */
  stops: StopRec[] | null
  /** Fixes just before / after the purchase moment. */
  before: FixRec | null
  after: FixRec | null
  /** How many fixes the tracker sent in the window, widened by an hour each side. */
  fixesInWindow: number
  /** Other company assets at the station in the window. */
  others: { assetId: string; name: string; firstMs: number; minM: number }[] | null
  /** The cardholder's own phone at the station, when there is one. */
  cardholderPhone?: { firstMs: number; minM: number } | null
}
export interface RuntimeEvidence {
  fromMs: number
  toMs: number
  /** First fix with the engine on or moving, inside the window. */
  firstRunMs: number | null
  /** Newest fix the tracker sent inside the window or up to 6 h after it. */
  lastFixMs: number | null
}
export interface AreaEvidence {
  zones: { id: string; name: string; kind: string; ring: [number, number][] }[]
  places: { name: string; lat: number; lng: number }[]
  /** The assigned vehicle's path that day (the daily trail). */
  dayPath: LatLng[]
}
export interface ShiftEvidence { usesClock: boolean; entries: { inMs: number; outMs: number | null }[] }
export interface CompanyHours { tz: string; workStart: string; workEnd: string; workDays: number[] }

export interface CheckInput {
  txn: CheckTxn
  asset: CheckAsset | null
  /** Where the vehicle came from: the row itself, or the card's assignment. */
  assetVia: 'row' | 'card' | null
  presence: PresenceEvidence | null
  /** Fuel-gauge readings around the purchase (the windows from checkWindows). */
  gauge: FuelSample[] | null
  runtime: RuntimeEvidence | null
  area: AreaEvidence
  shift: ShiftEvidence | null
  hours: CompanyHours
  settings: PilotSettings
  nowMs: number
}

export type Facts = Record<string, number | string | boolean | null>
export interface CheckResult {
  kind: CheckKind
  outcome: CheckOutcome
  severity: Severity | null
  /** One or two plain sentences. */
  evidence: string
  facts: Facts
  dollarsAtRisk: number
  missing: MissingCode[]
}

export interface CheckWindows {
  dayFromMs: number
  dayToMs: number
  /** Where the asset must have been. */
  presenceFromMs: number
  presenceToMs: number
  /** Gauge readings: before the purchase through the runtime window. */
  gaugeFromMs: number
  gaugeToMs: number
  /** A fill or running must show up in here. */
  runtimeFromMs: number
  runtimeToMs: number
}

/** The evidence windows for one purchase — the loader reads exactly these. */
export function checkWindows(txn: Pick<CheckTxn, 'txnDate' | 'txnAtMs'>, settings: PilotSettings, tz: string): CheckWindows {
  const dayFromMs = zonedMidnightMs(txn.txnDate, tz)
  const dayToMs = zonedMidnightMs(addDaysKey(txn.txnDate, 1), tz)
  const rt = settings.runtimeHours * 3_600_000
  if (txn.txnAtMs != null) {
    const t = txn.txnAtMs
    return {
      dayFromMs, dayToMs,
      presenceFromMs: t - PRESENCE_WINDOW_MS, presenceToMs: t + PRESENCE_WINDOW_MS,
      gaugeFromMs: t - 6 * 3_600_000, gaugeToMs: t + rt,
      runtimeFromMs: t, runtimeToMs: t + rt,
    }
  }
  return {
    dayFromMs, dayToMs,
    presenceFromMs: dayFromMs, presenceToMs: dayToMs,
    gaugeFromMs: dayFromMs - 6 * 3_600_000, gaugeToMs: dayToMs + rt,
    runtimeFromMs: dayFromMs, runtimeToMs: dayToMs + rt,
  }
}

/** Gallons for the tank check: as exported, from the pump price, or estimated
 *  from dollars at the default price for the product (the vehicle's fuel type
 *  when the line doesn't say). */
export function resolveGallons(txn: Pick<CheckTxn, 'gallons' | 'unitPrice' | 'amount' | 'product'>, asset: Pick<CheckAsset, 'fuelType'> | null, settings: PilotSettings):
  { gallons: number; estimated: boolean; price: number; how: string } {
  if (txn.gallons != null && txn.gallons > 0) {
    const price = txn.unitPrice ?? txn.amount / txn.gallons
    return { gallons: txn.gallons, estimated: false, price, how: 'from the export' }
  }
  if (txn.unitPrice != null && txn.unitPrice > 0) {
    return { gallons: txn.amount / txn.unitPrice, estimated: false, price: txn.unitPrice, how: `${money(txn.amount)} at ${money(txn.unitPrice)}/gal` }
  }
  const kind = txn.product === 'diesel' || txn.product === 'gas' ? txn.product : asset?.fuelType ?? 'gas'
  const price = kind === 'diesel' ? settings.dieselPrice : settings.gasPrice
  return { gallons: txn.amount / price, estimated: true, price, how: `estimated from ${money(txn.amount)} at ${money(price)}/gal ${kind}` }
}

/** Merge stop clusters that are one stop (cell boundaries, a short shuffle):
 *  within 150 m and 5 minutes of each other. Input oldest first. */
export function mergeStops(stops: StopRec[]): StopRec[] {
  const out: StopRec[] = []
  for (const s of stops.slice().sort((a, b) => a.fromMs - b.fromMs)) {
    const last = out[out.length - 1]
    if (last && s.fromMs - last.toMs <= 5 * 60_000 && metresBetween(last, s) <= 150) {
      const n = last.n + s.n
      last.lat = (last.lat * last.n + s.lat * s.n) / n
      last.lng = (last.lng * last.n + s.lng * s.n) / n
      last.n = n
      last.toMs = Math.max(last.toMs, s.toMs)
      last.engineOff = last.engineOff || s.engineOff
      if (s.fuelStation !== undefined && !last.fuelStation) last.fuelStation = s.fuelStation
    } else out.push({ ...s })
  }
  return out
}

/** A real stop, not a red light: two minutes still, or the engine switched off. */
export const isRealStop = (s: StopRec) => s.toMs - s.fromMs >= 2 * 60_000 || s.engineOff

function zoneAt(pt: LatLng, zones: AreaEvidence['zones']): string | null {
  const z = zones.filter((zz) => zz.kind !== 'boundary').find((zz) => metresToRing(pt, zz.ring) === 0)
    ?? zones.find((zz) => metresToRing(pt, zz.ring) === 0)
  return z?.name ?? null
}

function nearestPoint(from: LatLng, pts: LatLng[]): { m: number; pt: LatLng } | null {
  let best: { m: number; pt: LatLng } | null = null
  for (const p of pts) {
    const m = metresBetween(from, p)
    if (!best || m < best.m) best = { m, pt: p }
  }
  return best
}

/** How a sentence names the station. A brand-level placement is a set of
 *  candidates: "a Spinx in Goose Creek" when it was at one, "the nearest
 *  Spinx in Goose Creek" when measuring, "any Spinx in Goose Creek" when it
 *  never came close. */
function stationRef(txn: CheckTxn, mode: 'at' | 'from' | 'of'): string {
  const label = txn.placeLabel ?? txn.brand ?? txn.merchant.slice(0, 40)
  if (txn.precision !== 'brand') return label
  return mode === 'at' ? `a ${label}` : mode === 'from' ? `the nearest ${label}` : `any ${label}`
}

function presenceCheck(inp: CheckInput): CheckResult {
  const { txn, asset, presence, hours } = inp
  const tz = hours.tz
  const r = (outcome: CheckOutcome, evidence: string, facts: Facts, missing: MissingCode[], severity: Severity | null = null): CheckResult =>
    ({ kind: 'asset_absent', outcome, severity, evidence, facts, dollarsAtRisk: outcome === 'exception' ? txn.amount : 0, missing })
  const hasTime = txn.txnAtMs != null
  const missing: MissingCode[] = []
  if (!hasTime) missing.push('no_time')
  const othersLine = (): { text: string; n: number } => {
    const o = presence?.others ?? null
    if (!o) return { text: '', n: 0 }
    if (!o.length) return { text: ' No other company vehicle was there either.', n: 0 }
    const first = o.slice().sort((a, b) => a.firstMs - b.firstMs)
    const names = first.slice(0, 2).map((x) => `${x.name} (${fmtTime(x.firstMs, tz)})`)
    return { text: ` ${names.join(' and ')} ${first.length === 1 ? 'was' : 'were'} there${first.length > 2 ? `, and ${first.length - 2} more` : ''}.`, n: first.length }
  }
  const phoneLine = presence?.cardholderPhone ? ` The cardholder's phone was there at ${fmtTime(presence.cardholderPhone.firstMs, tz)}.` : ''

  if (!asset) {
    const o = othersLine()
    return r('unknown', `No vehicle is tied to ${txn.cardLast4 ? `card …${txn.cardLast4}` : 'this purchase'}, so there is nothing to place at the pump.${o.n ? o.text : ''}`,
      { others: o.n }, [...missing, 'no_vehicle'])
  }
  if (!asset.hasTracker || !presence) {
    return r('unknown', `${asset.name} has no tracker reporting, so where it was can't be checked.`, {}, [...missing, 'no_tracker'])
  }
  if (presence.fixesInWindow === 0) {
    return r('unknown', `${asset.name}'s tracker sent nothing ${hasTime ? `between ${fmtTime(presence.fromMs - 3_600_000, tz)} and ${fmtTime(presence.toMs + 3_600_000, tz)}` : `on ${dayWords(txn.txnDate)}`}.`,
      {}, [...missing, 'tracker_silent'])
  }

  // Station not placed (or only to the city): did it stop at ANY fuel station?
  if (!txn.points.length || txn.precision === 'city') {
    missing.push(txn.precision === 'city' ? 'merchant_city_only' : 'merchant_unplaced')
    const stops = mergeStops(presence.stops ?? []).filter(isRealStop)
    const fuel = stops.filter((s) => s.fuelStation)
    if (fuel.length) {
      const f = fuel[0]
      return r('pass', `${asset.name} stopped at a fuel station (${f.fuelStation}, ${fmtTime(f.fromMs, tz)}) ${hasTime ? 'then' : 'that day'} — the card's station couldn't be placed exactly, so which one can't be checked.`,
        { fuelStops: fuel.length, stops: stops.length }, missing)
    }
    const offZone = stops.filter((s) => !zoneAt(s, inp.area.zones))
    const unchecked = offZone.filter((s) => s.fuelStation === undefined)
    if (!stops.length) {
      return r('exception', `${asset.name} made no stop ${hasTime ? `within half an hour of ${fmtTime(txn.txnAtMs!, tz)}` : `on ${dayWords(txn.txnDate)}`} — it never sat at a pump.`,
        { stops: 0 }, missing, 'medium')
    }
    if (unchecked.length) {
      return r('unknown', `${asset.name} made ${stops.length} stop${stops.length === 1 ? '' : 's'}; ${unchecked.length} couldn't be looked up to see whether ${unchecked.length === 1 ? 'it was' : 'they were'} a fuel station.`,
        { stops: stops.length, unchecked: unchecked.length }, [...missing, 'stops_unchecked'])
    }
    return r('exception', `None of ${asset.name}'s ${stops.length} stop${stops.length === 1 ? '' : 's'} ${hasTime ? 'around then' : `on ${dayWords(txn.txnDate)}`} was at a fuel station.`,
      { stops: stops.length, fuelStops: 0 }, missing, 'medium')
  }

  const radius = hasTime ? PRESENCE_RADIUS_TIME_M : PRESENCE_RADIUS_DAY_M
  const near = presence.near
  if (near && ((near.stillN > 0 && near.minM <= radius) || near.minM <= DRIVE_BY_M)) {
    const span = near.lastMs - near.firstMs >= 60_000 ? `${fmtTime(near.firstMs, tz)}–${fmtTime(near.lastMs, tz)}` : fmtTime(near.firstMs, tz)
    return r('pass', `${asset.name} was at ${stationRef(txn, 'at')}: within ${fmtDist(near.minM)}, ${hasTime ? span : `${dayWords(txn.txnDate)} ${span}`}.`,
      { minM: Math.round(near.minM), firstMs: near.firstMs }, missing)
  }

  // Absent. Say where it was instead.
  const o = othersLine()
  let where = ''
  let weak = false
  const facts: Facts = { others: o.n, radiusM: radius }
  if (hasTime) {
    const t = txn.txnAtMs!
    const cands = [presence.before, presence.after].filter((f): f is FixRec => !!f && Math.abs(f.ms - t) <= 2 * 3_600_000)
    cands.sort((a, b) => Math.abs(a.ms - t) - Math.abs(b.ms - t))
    const fix = cands[0]
    if (!fix) {
      return r('unknown', `${asset.name}'s tracker sent nothing within two hours of ${fmtTime(t, tz)}.`, {}, [...missing, 'tracker_silent'])
    }
    const d = nearestPoint(fix, txn.points)!
    const zone = zoneAt(fix, inp.area.zones)
    const doing = (fix.speed ?? 0) >= MOVE_MPH ? `driving at ${Math.round(fix.speed ?? 0)} mph` : zone ? `at ${zone}` : 'parked'
    // A report long before or after the purchase says less about where it
    // was at the pump (a battery unit asleep at a stop sends nothing).
    weak = Math.abs(fix.ms - t) > 45 * 60_000
    where = weak
      ? `${asset.name}'s nearest report, at ${fmtTime(fix.ms, tz)}, put it ${fmtDist(d.m)} from ${stationRef(txn, 'from')}, ${doing}; it never came within ${fmtDist(radius)} of it around ${fmtTime(t, tz)}.`
      : `${asset.name} was ${fmtDist(d.m)} from ${stationRef(txn, 'from')} at ${fmtTime(fix.ms, tz)}, ${doing}.`
    facts.distanceM = Math.round(d.m)
    facts.atMs = fix.ms
    if (zone) facts.zone = zone
  } else {
    const stops = mergeStops(presence.stops ?? []).filter(isRealStop)
    let best: { m: number; s: StopRec } | null = null
    for (const s of stops) {
      const d = nearestPoint(s, txn.points)!
      if (!best || d.m < best.m) best = { m: d.m, s }
    }
    where = `${asset.name} never stopped within ${fmtDist(radius)} of ${stationRef(txn, 'of')} on ${dayWords(txn.txnDate)}`
    if (best) {
      const zone = zoneAt(best.s, inp.area.zones)
      where += ` — its closest stop was ${fmtDist(best.m)} away (${zone ? `${zone}, ` : ''}${fmtTime(best.s.fromMs, tz)}).`
      facts.distanceM = Math.round(best.m)
    } else where += '.'
  }
  if (near && near.minM <= 3 * radius) facts.nearestPassM = Math.round(near.minM)
  // How sure: a timed purchase at a pinned station is the strong case; a
  // station read from the brand, or a whole day, less so; a near miss may be
  // the geocode, and a report far from the purchase time may be a sleeping tracker.
  const dist = typeof facts.distanceM === 'number' ? facts.distanceM : null
  const severity: Severity = weak || (dist != null && dist < 800) ? 'low'
    : hasTime && txn.precision === 'exact' ? 'high' : 'medium'
  return r('exception', where + o.text + phoneLine, facts, missing, severity)
}

/** Median of the readings in the last `spanMs` before `t` (vehicles: moving readings only). */
function levelBefore(samples: FuelSample[], t: number, movingOnly: boolean, spanMs = 5 * 60_000, reachMs = 2 * 3_600_000): { pct: number; ms: number } | null {
  const use = samples.filter((s) => s.ms <= t && s.ms >= t - reachMs && s.pct > 0 && s.pct <= 100 && (!movingOnly || (s.mph ?? 0) >= MOVE_MPH))
  if (!use.length) return null
  const lastMs = use[use.length - 1].ms
  const pick = use.filter((s) => s.ms >= lastMs - spanMs).map((s) => s.pct).sort((a, b) => a - b)
  const m = pick.length >> 1
  return { pct: pick.length % 2 ? pick[m] : (pick[m - 1] + pick[m]) / 2, ms: lastMs }
}

/** The lowest five-minute median of the day — the most room the tank can have had. */
function lowestLevel(samples: FuelSample[], fromMs: number, toMs: number, movingOnly: boolean): { pct: number; ms: number } | null {
  const use = samples.filter((s) => s.ms >= fromMs && s.ms < toMs && s.pct > 0 && s.pct <= 100 && (!movingOnly || (s.mph ?? 0) >= MOVE_MPH))
  if (!use.length) return null
  const buckets = new Map<number, number[]>()
  for (const s of use) {
    const k = Math.floor(s.ms / (5 * 60_000))
    const b = buckets.get(k) ?? []
    b.push(s.pct)
    buckets.set(k, b)
  }
  let best: { pct: number; ms: number } | null = null
  buckets.forEach((v, k) => {
    v.sort((a, b) => a - b)
    const m = v.length >> 1
    const med = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
    if (!best || med < best.pct) best = { pct: med, ms: k * 5 * 60_000 }
  })
  return best
}

/** The fill on the gauge that matches the purchase, if one does. */
export function matchFill(refuels: FuelRefuel[], txn: Pick<CheckTxn, 'txnAtMs'>, win: Pick<CheckWindows, 'dayFromMs' | 'dayToMs'>, wantGal: number | null, tankGal: number | null): FuelRefuel | null {
  const cands = refuels.filter((f) => txn.txnAtMs != null
    ? txn.txnAtMs >= f.beforeMs - FILL_SLACK_MS && txn.txnAtMs <= f.atMs + FILL_SLACK_MS
    : f.beforeMs < win.dayToMs && f.atMs > win.dayFromMs)
  if (!cands.length) return null
  if (wantGal != null && tankGal) {
    return cands.slice().sort((a, b) => Math.abs((a.addedPct / 100) * tankGal - wantGal) - Math.abs((b.addedPct / 100) * tankGal - wantGal))[0]
  }
  return cands.slice().sort((a, b) => b.addedPct - a.addedPct)[0]
}

function tankCheck(inp: CheckInput, win: CheckWindows): CheckResult {
  const { txn, asset, settings } = inp
  const tz = inp.hours.tz
  const r = (outcome: CheckOutcome, evidence: string, facts: Facts, missing: MissingCode[], severity: Severity | null = null, dollars = 0): CheckResult =>
    ({ kind: 'gallons_exceed_tank', outcome, severity, evidence, facts, dollarsAtRisk: Math.round(dollars * 100) / 100, missing })
  if (txn.product === 'def') return r('unknown', 'DEF goes in its own tank — it is not compared to the fuel tank.', {}, ['def_product'])
  if (!asset) return r('unknown', `No vehicle is tied to ${txn.cardLast4 ? `card …${txn.cardLast4}` : 'this purchase'}, so there is no tank to compare.`, {}, ['no_vehicle'])
  const g = resolveGallons(txn, asset, settings)
  const missing: MissingCode[] = []
  if (g.estimated) missing.push('gallons_estimated')
  if (!asset.tankGal) {
    return r('unknown', `${asset.name}'s tank size isn't set — ${g.estimated ? 'about ' : ''}${gal(g.gallons)} can't be compared to anything.`, { gallons: round1(g.gallons) }, [...missing, 'no_tank_size'])
  }
  const tank = asset.tankGal
  const movingOnly = asset.type === 'vehicle'
  let before: { pct: number; ms: number; how: string } | null = null
  let fill: FuelRefuel | null = null
  if (!asset.reportsFuelLevel) missing.push('no_fuel_level')
  else if (!inp.gauge || !inp.gauge.length) missing.push('gauge_silent')
  else {
    const gauge = fuelFromLevels(inp.gauge, { movingOnly })
    fill = gauge ? matchFill(gauge.refuels, txn, win, g.gallons, tank) : null
    if (fill) before = { pct: fill.fromPct, ms: fill.beforeMs, how: 'just before the fill' }
    else if (txn.txnAtMs != null) {
      const b = levelBefore(inp.gauge, txn.txnAtMs, movingOnly)
      if (b) before = { ...b, how: `at ${fmtTime(b.ms, tz)}` }
    } else {
      const lo = lowestLevel(inp.gauge, win.dayFromMs, win.dayToMs, movingOnly)
      if (lo) before = { ...lo, how: `at its lowest that day` }
    }
    if (!before) missing.push('gauge_silent')
  }
  const room = before ? tank * (1 - before.pct / 100) : tank
  const tol = Math.max(TANK_TOL_MIN_GAL, TANK_TOL_PCT * tank) + (g.estimated ? EST_TOL_PCT * g.gallons : 0)
  const facts: Facts = {
    gallons: round1(g.gallons), estimated: g.estimated, tankGal: tank, roomGal: round1(room),
    levelBeforePct: before ? Math.round(before.pct) : null, toleranceGal: round1(tol),
  }
  const about = g.estimated ? 'about ' : ''
  const fillLine = fill ? ` The gauge rose ${Math.round(fill.fromPct)}% → ${Math.round(fill.toPct)}% (about ${gal((fill.addedPct / 100) * tank)}).` : ''
  if (fill) facts.gaugeAddedGal = round1((fill.addedPct / 100) * tank)
  const roomWords = before
    ? `the tank read ${Math.round(before.pct)}% ${before.how} — room for about ${gal(room)} of ${gal(tank)}`
    : `the whole ${gal(tank)} tank`
  if (g.gallons > room + tol) {
    const excess = g.gallons - room
    facts.excessGal = round1(excess)
    const severity: Severity = g.estimated && excess < 5 ? 'low' : !g.estimated && excess >= Math.max(5, 0.25 * tank) ? 'high' : 'medium'
    const lead = before
      ? `${about}${gal(g.gallons)} bought, but ${roomWords}: ${gal(excess)} more than fit.`
      : `${about}${gal(g.gallons)} bought on a ${gal(tank)} tank — ${gal(excess)} more than it holds, even empty.`
    return r('exception', lead + fillLine + (g.estimated ? ` (Gallons ${g.how}.)` : ''), facts, missing, severity, excess * g.price)
  }
  return r('pass', `${about}${gal(g.gallons)} fits: ${roomWords}.${fillLine}`, facts, missing)
}

const round1 = (n: number) => Math.round(n * 10) / 10

function runtimeCheck(inp: CheckInput, win: CheckWindows): CheckResult {
  const { txn, asset, runtime, settings } = inp
  const tz = inp.hours.tz
  const r = (outcome: CheckOutcome, evidence: string, facts: Facts, missing: MissingCode[], severity: Severity | null = null): CheckResult =>
    ({ kind: 'no_runtime_after', outcome, severity, evidence, facts, dollarsAtRisk: outcome === 'exception' ? txn.amount : 0, missing })
  const hours = settings.runtimeHours
  if (!asset) return r('unknown', `No vehicle is tied to ${txn.cardLast4 ? `card …${txn.cardLast4}` : 'this purchase'}, so nothing can show it was used.`, {}, ['no_vehicle'])
  if (!asset.hasTracker || !runtime) {
    return r('unknown', `${asset.name} has no tracker reporting — a can or bulk-tank purchase for it can't be checked.`, {}, ['no_tracker'])
  }
  const missing: MissingCode[] = []
  if (!asset.reportsIgnition) missing.push('no_runtime_signal')
  if (!asset.reportsFuelLevel) missing.push('no_fuel_level')
  // A fill on the gauge inside the window is proof enough.
  if (asset.reportsFuelLevel && inp.gauge?.length) {
    const gauge = fuelFromLevels(inp.gauge, { movingOnly: asset.type === 'vehicle' })
    const fill = gauge?.refuels.find((f) => f.atMs >= win.runtimeFromMs - FILL_SLACK_MS && f.beforeMs <= win.runtimeToMs)
    if (fill) {
      return r('pass', `The gauge shows a fill: ${Math.round(fill.fromPct)}% → ${Math.round(fill.toPct)}% by ${fmtTime(fill.atMs, tz)}.`, { fillAtMs: fill.atMs }, missing)
    }
  }
  if (runtime.firstRunMs != null) {
    const sameDay = dayKey(runtime.firstRunMs, tz) === txn.txnDate
    return r('pass', `${asset.name} ran ${txn.txnAtMs != null ? 'again' : ''} at ${fmtTime(runtime.firstRunMs, tz)}${sameDay ? '' : ` on ${dayWords(dayKey(runtime.firstRunMs, tz))}`}${txn.txnAtMs == null ? ' (the purchase time isn\'t known)' : ''}.`.replace('  ', ' '),
      { firstRunMs: runtime.firstRunMs }, txn.txnAtMs == null ? [...missing, 'no_time'] : missing)
  }
  if (inp.nowMs < runtime.toMs) {
    return r('pending', `Waiting: the ${hours}-hour window after the purchase is still open.`, { untilMs: runtime.toMs }, missing)
  }
  const alive = runtime.lastFixMs != null && runtime.lastFixMs >= runtime.fromMs + (runtime.toMs - runtime.fromMs) / 2
  if (!alive) {
    return r('unknown', `${asset.name}'s tracker went quiet after the purchase, so whether it ran can't be told.`, { lastFixMs: runtime.lastFixMs }, [...missing, 'tracker_silent'])
  }
  const sawGauge = asset.reportsFuelLevel && !!inp.gauge?.length
  const what = asset.reportsIgnition ? 'no engine running' : 'no movement'
  const span = txn.txnAtMs != null ? `in the ${hours} hours after the purchase` : `on ${dayWords(txn.txnDate)} or in the ${hours} hours after`
  const severity: Severity = sawGauge && asset.reportsIgnition ? 'high' : 'medium'
  return r('exception', `${sawGauge ? 'No fill on the gauge and ' : ''}${what} ${span} — ${asset.name} sat still while its tracker kept checking in.`,
    { checkedToMs: runtime.toMs, gaugeRead: sawGauge }, txn.txnAtMs == null ? [...missing, 'no_time'] : missing, severity)
}

function hhmm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function localWeekdayMin(ms: number, tz: string): { day: number; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value])) as Record<string, string>
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: (Number(p.hour) % 24) * 60 + Number(p.minute) }
}

function areaCheck(inp: CheckInput, approvedMi: number): { outcome: 'pass' | 'exception' | 'unknown'; text: string; facts: Facts; missing: MissingCode[]; far: boolean } {
  const { txn, area, asset } = inp
  if (!txn.points.length) return { outcome: 'unknown', text: '', facts: {}, missing: ['merchant_unplaced'], far: false }
  // Where the company works: its sites, yards and vendor zones. A property
  // BOUNDARY is a perimeter for theft alerts — drawn round a county it would
  // approve every pump inside it — so it doesn't count.
  const zones = area.zones.filter((z) => z.kind !== 'boundary')
  const anchors = zones.length + area.places.length + area.dayPath.length
  if (!anchors) return { outcome: 'unknown', text: '', facts: {}, missing: ['no_zones'], far: false }
  const slack = txn.precision === 'city' ? (txn.cityRadiusM ?? 8000) : 0
  // The candidate station closest to anything the company does is the generous read.
  let best = { m: Infinity, to: '' }
  for (const p of txn.points) {
    for (const z of zones) {
      const m = metresToRing(p, z.ring)
      if (m < best.m) best = { m, to: z.name }
    }
    for (const pl of area.places) {
      const m = metresBetween(p, pl)
      if (m < best.m) best = { m, to: pl.name }
    }
    for (const q of area.dayPath) {
      const m = metresBetween(p, q)
      if (m < best.m) best = { m, to: asset ? `${asset.name}'s route that day` : 'the route' }
    }
  }
  const dist = Math.max(0, best.m - slack)
  const facts: Facts = { awayM: Math.round(dist), nearest: best.to }
  const missing: MissingCode[] = []
  if (!zones.length) missing.push('no_zones')
  if (txn.precision === 'city') missing.push('merchant_city_only')
  if (dist > approvedMi * M_PER_MI) {
    return {
      outcome: 'exception',
      text: `${cap(stationRef(txn, 'from'))} is ${fmtDist(dist)} from the nearest site, yard, saved place${area.dayPath.length ? ' or anywhere the vehicle went that day' : ''} (closest: ${best.to}).`,
      facts, missing, far: dist > 3 * approvedMi * M_PER_MI,
    }
  }
  return { outcome: 'pass', text: dist === 0 ? `at ${best.to}` : `${fmtDist(dist)} from ${best.to}`, facts, missing, far: false }
}

function shiftHoursCheck(inp: CheckInput): CheckResult {
  const { txn, hours, shift, settings } = inp
  const tz = hours.tz
  const reasons: string[] = []
  const passes: string[] = []
  const missing: MissingCode[] = []
  const facts: Facts = {}
  let severity: Severity = 'medium'
  let anyKnown = false
  const workDays = hours.workDays.length ? hours.workDays : [1, 2, 3, 4, 5]
  const daysWords = (() => {
    const s = workDays.slice().sort((a, b) => a - b)
    const contiguous = s.every((d, i) => i === 0 || d === s[i - 1] + 1)
    return contiguous && s.length > 1 ? `${WEEKDAY[s[0]].slice(0, 3)}–${WEEKDAY[s[s.length - 1]].slice(0, 3)}` : s.map((d) => WEEKDAY[d].slice(0, 3)).join(', ')
  })()
  const clock = (min: number) => fmtTime(localToUtcMs('2026-01-05', min, 'UTC'), 'UTC')

  // 1. The company's work days and hours.
  if (txn.txnAtMs != null) {
    anyKnown = true
    const { day, min } = localWeekdayMin(txn.txnAtMs, tz)
    const start = hhmm(hours.workStart), end = hhmm(hours.workEnd)
    facts.weekday = WEEKDAY[day]
    if (!workDays.includes(day)) {
      reasons.push(`${WEEKDAY[day]} ${fmtTime(txn.txnAtMs, tz)} — not a work day (${daysWords})`)
      severity = 'high'
    } else if (min < start - HOURS_GRACE_MIN || min > end + HOURS_GRACE_MIN) {
      const off = min < start ? start - min : min - end
      reasons.push(`${fmtTime(txn.txnAtMs, tz)} — outside work hours (${clock(start)}–${clock(end)})`)
      if (min >= 22 * 60 || min < 5 * 60) severity = 'high'
      else if (off <= 120) severity = 'low'
      facts.minutesOutside = off
    } else passes.push('in work hours')
  } else {
    missing.push('no_time')
    const day = new Date(txn.txnDate + 'T12:00:00Z').getUTCDay()
    anyKnown = true
    facts.weekday = WEEKDAY[day]
    if (!workDays.includes(day)) { reasons.push(`${WEEKDAY[day]} — not a work day (${daysWords})`); severity = 'high' }
    else passes.push('on a work day')
  }

  // 2. The cardholder's shift — only a timed purchase can be read against
  // one, so a line without a time says "no time" once, not three ways.
  if (txn.txnAtMs == null) { /* no_time already said */ }
  else if (!txn.cardholderUserId || !shift) missing.push('no_cardholder')
  else if (!shift.usesClock) missing.push('no_clock')
  else {
    anyKnown = true
    const t = txn.txnAtMs
    const g = SHIFT_GRACE_MIN * 60_000
    const on = shift.entries.some((e) => t >= e.inMs - g && t <= (e.outMs ?? Math.max(inp.nowMs, t)) + g)
    if (on) passes.push('on the clock')
    else {
      const prior = shift.entries.filter((e) => e.outMs != null && e.outMs <= t).sort((a, b) => (b.outMs ?? 0) - (a.outMs ?? 0))[0]
      reasons.push(`the cardholder wasn't clocked in${prior && t - (prior.outMs ?? 0) < 16 * 3_600_000 ? ` (clocked out at ${fmtTime(prior.outMs!, tz)})` : ''}`)
      facts.offClock = true
    }
  }

  // 3. Where.
  const a = areaCheck(inp, settings.areaMiles)
  missing.push(...a.missing)
  Object.assign(facts, a.facts)
  if (a.outcome !== 'unknown') anyKnown = true
  if (a.outcome === 'exception') { reasons.push(a.text); if (a.far) severity = 'high' }
  else if (a.outcome === 'pass') passes.push(a.text)

  const uniq = Array.from(new Set(missing))
  if (reasons.length) {
    const text = reasons.length === 1 ? cap(reasons[0]) : `${cap(reasons[0])}; ${reasons.slice(1).join('; ')}`
    return { kind: 'outside_shift_or_area', outcome: 'exception', severity, evidence: text.endsWith('.') ? text : text + '.', facts, dollarsAtRisk: txn.amount, missing: uniq }
  }
  if (!anyKnown) return { kind: 'outside_shift_or_area', outcome: 'unknown', severity: null, evidence: 'Nothing to compare: no time, no cardholder on the clock, and the station isn\'t placed.', facts, dollarsAtRisk: 0, missing: uniq }
  return { kind: 'outside_shift_or_area', outcome: 'pass', severity: null, evidence: cap(passes.join(', ')) + '.', facts, dollarsAtRisk: 0, missing: uniq }
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** All four checks for one purchase, in CHECK_KINDS order. */
export function runFuelChecks(inp: CheckInput): CheckResult[] {
  const win = checkWindows(inp.txn, inp.settings, inp.hours.tz)
  return [presenceCheck(inp), tankCheck(inp, win), runtimeCheck(inp, win), shiftHoursCheck(inp)]
}

// ── Storage shapes ──────────────────────────────────────────────────────────

export const CHECK_VERSION = 1
export interface StoredCheck { k: CheckKind; o: CheckOutcome; s: Severity | null; e: string; d: number; m: MissingCode[]; f?: Facts }
export interface StoredChecks { v: number; at: string; r: StoredCheck[] }

/** What fuel_transactions.checks holds. */
export function storedChecks(results: CheckResult[], atIso: string): StoredChecks {
  return {
    v: CHECK_VERSION,
    at: atIso,
    r: results.map((x) => ({ k: x.kind, o: x.outcome, s: x.severity, e: x.evidence.slice(0, 600), d: x.dollarsAtRisk, m: x.missing, f: x.facts })),
  }
}

/** Read a stored blob defensively (it came back from the database). */
export function readStoredChecks(raw: unknown): StoredChecks | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { v?: unknown; at?: unknown; r?: unknown }
  if (!Array.isArray(o.r)) return null
  const r: StoredCheck[] = []
  for (const x of o.r as Record<string, unknown>[]) {
    if (!x || !CHECK_KINDS.includes(x.k as CheckKind)) continue
    const out = ['pass', 'exception', 'unknown', 'pending'].includes(String(x.o)) ? (x.o as CheckOutcome) : 'unknown'
    r.push({
      k: x.k as CheckKind, o: out, s: ['high', 'medium', 'low'].includes(String(x.s)) ? (x.s as Severity) : null,
      e: typeof x.e === 'string' ? x.e : '', d: Number(x.d) || 0,
      m: Array.isArray(x.m) ? (x.m as unknown[]).filter((c): c is MissingCode => typeof c === 'string' && c in MISSING_LABEL) : [],
      f: x.f && typeof x.f === 'object' ? (x.f as Facts) : undefined,
    })
  }
  return { v: Number(o.v) || 0, at: typeof o.at === 'string' ? o.at : '', r }
}

/** The exception rows one check run writes. Verdict columns are NOT in here —
 *  a re-check updates evidence in place and never touches a verdict. `clear`
 *  = kinds that now pass (an open row gets cleared_at; its verdict stays). */
export interface ExceptionUpsert {
  transaction_id: string
  company_id: string
  kind: CheckKind
  severity: Severity
  evidence: { text: string; facts: Facts }
  dollars_at_risk: number
  missing: MissingCode[]
  computed_at: string
  cleared_at: null
}
export function exceptionWrites(txnId: string, companyId: string, results: CheckResult[], nowIso: string): { upserts: ExceptionUpsert[]; clear: CheckKind[] } {
  const upserts: ExceptionUpsert[] = []
  const clear: CheckKind[] = []
  for (const x of results) {
    if (x.outcome === 'exception') {
      upserts.push({
        transaction_id: txnId, company_id: companyId, kind: x.kind, severity: x.severity ?? 'medium',
        evidence: { text: x.evidence.slice(0, 600), facts: x.facts }, dollars_at_risk: Math.round(x.dollarsAtRisk * 100) / 100,
        missing: x.missing, computed_at: nowIso, cleared_at: null,
      })
    } else if (x.outcome === 'pass') clear.push(x.kind)
  }
  return { upserts, clear }
}

// ── The pilot's numbers ─────────────────────────────────────────────────────

export interface MetricTxn {
  id: string
  amount: number
  txnDate: string
  hasTime: boolean
  excluded?: boolean
  assetId: string | null
  cardLast4: string | null
  checks: StoredChecks | null
}
export interface MetricException {
  transactionId: string
  kind: CheckKind
  dollarsAtRisk: number
  verdict: Verdict | null
  clearedAt: string | null
}

export interface KindStats { open: number; valid: number; false: number; unsure: number; unclassified: number; fpRate: number | null }
export interface PilotMetrics {
  transactions: number
  dollars: number
  checked: number
  excluded: number
  /** Exceptions on screen: open ones, plus cleared ones that already carry a verdict. */
  exceptions: number
  open: number
  byKind: Record<CheckKind, KindStats>
  valid: number
  falseAlarms: number
  unsure: number
  /** Decided (valid or false) — unsure is asked again, so it doesn't count. */
  classified: number
  unclassified: number
  classifiedPct: number | null
  /** False alarms ÷ classified. */
  falsePositiveRate: number | null
  /** Dollars behind valid exceptions — per purchase the largest, never more than it cost. */
  recoverable: number
  /** Dollars behind open exceptions nobody has decided yet. */
  awaiting: number
  startedOn: string | null
  daysIn: number
  pilotDays: number
  classifyDays: number
  pilotDaysLeft: number
  classifyDaysLeft: number
}

export function pilotMetrics(txns: MetricTxn[], exceptions: MetricException[], opts: { startedOn: string | null; todayKey: string }): PilotMetrics {
  const live = txns.filter((t) => !t.excluded)
  const ids = new Set(live.map((t) => t.id))
  const amountOf = new Map(live.map((t) => [t.id, t.amount]))
  const shown = exceptions.filter((e) => ids.has(e.transactionId) && (!e.clearedAt || e.verdict))
  const byKind = Object.fromEntries(CHECK_KINDS.map((k) => [k, { open: 0, valid: 0, false: 0, unsure: 0, unclassified: 0, fpRate: null }])) as Record<CheckKind, KindStats>
  let valid = 0, falseAlarms = 0, unsure = 0, open = 0
  const recoverBy = new Map<string, number>()
  const awaitBy = new Map<string, number>()
  for (const e of shown) {
    const k = byKind[e.kind]
    if (!e.clearedAt) { open++; k.open++ }
    const cap = Math.min(e.dollarsAtRisk, amountOf.get(e.transactionId) ?? e.dollarsAtRisk)
    if (e.verdict === 'valid') { valid++; k.valid++; recoverBy.set(e.transactionId, Math.max(recoverBy.get(e.transactionId) ?? 0, cap)) }
    else if (e.verdict === 'false') { falseAlarms++; k.false++ }
    else {
      if (e.verdict === 'unsure') { unsure++; k.unsure++ }
      k.unclassified++
      if (!e.clearedAt) awaitBy.set(e.transactionId, Math.max(awaitBy.get(e.transactionId) ?? 0, cap))
    }
  }
  for (const k of CHECK_KINDS) {
    const s = byKind[k]
    s.fpRate = s.valid + s.false ? s.false / (s.valid + s.false) : null
  }
  const classified = valid + falseAlarms
  const sum = (m: Map<string, number>) => Math.round(Array.from(m.values()).reduce((a, b) => a + b, 0) * 100) / 100
  const daysIn = opts.startedOn && opts.startedOn <= opts.todayKey
    ? Math.round((Date.parse(opts.todayKey + 'T12:00:00Z') - Date.parse(opts.startedOn + 'T12:00:00Z')) / 86_400_000) + 1
    : 0
  return {
    transactions: live.length,
    dollars: Math.round(live.reduce((a, t) => a + t.amount, 0) * 100) / 100,
    checked: live.filter((t) => t.checks).length,
    excluded: txns.length - live.length,
    exceptions: shown.length,
    open,
    byKind,
    valid,
    falseAlarms,
    unsure,
    classified,
    unclassified: shown.length - classified,
    classifiedPct: shown.length ? classified / shown.length : null,
    falsePositiveRate: classified ? falseAlarms / classified : null,
    recoverable: sum(recoverBy),
    awaiting: sum(awaitBy),
    startedOn: opts.startedOn,
    daysIn,
    pilotDays: PILOT_DAYS,
    classifyDays: CLASSIFY_DAYS,
    pilotDaysLeft: Math.max(0, PILOT_DAYS - daysIn),
    classifyDaysLeft: Math.max(0, CLASSIFY_DAYS - daysIn),
  }
}

export interface MissingItem {
  code: MissingCode
  /** One plain sentence: what is missing, for which machines or cards. */
  text: string
  /** What adds it. */
  fix: string
  purchases: number
  dollars: number
}

const FIX: Record<MissingCode, string> = {
  no_vehicle: 'Pick the vehicle each card fuels (Cards & tanks, on this page).',
  no_tracker: 'Put a tracker on it, or leave its purchases to the receipts.',
  tracker_silent: 'Check the tracker\'s power and SIM — a silent box proves nothing either way.',
  no_time: 'A fleet-card export or the card\'s instant alerts carry the time of day.',
  merchant_unplaced: 'An export with the station\'s address (fleet cards, Amex) places it exactly.',
  merchant_city_only: 'An export with the station\'s address (fleet cards, Amex) places it exactly.',
  no_tank_size: 'Type each tank size once (Cards & tanks, on this page).',
  no_fuel_level: 'A wired CAN (J1939) unit reads the fuel gauge where a plug-in or battery unit can\'t.',
  gauge_silent: 'The truck\'s computer stopped answering around the purchase — a key-off/on usually restarts it.',
  gallons_estimated: 'A fleet-card export carries the real gallons.',
  no_runtime_signal: 'A battery unit sends no ignition — a wired or OBD unit does.',
  no_clock: 'Have the crew clock in through the app — the shift check needs it.',
  no_cardholder: 'Tie each card to the person carrying it (Receipts → Instant receipt chase).',
  no_zones: 'Draw the sites and the yard on the map.',
  stops_unchecked: 'Re-check later — the station lookup was busy.',
  def_product: 'Nothing to add — DEF has its own tank.',
}

/**
 * The deliverable's third number: what dependable detection still needs,
 * ranked by the dollars it left unchecked. Read from every purchase's stored
 * checks (not only exceptions) — a check that couldn't run is the point.
 */
export function missingTelemetry(txns: MetricTxn[], assets: { id: string; name: string }[]): MissingItem[] {
  const nameOf = new Map(assets.map((a) => [a.id, a.name]))
  const agg = new Map<MissingCode, { txns: Set<string>; dollars: number; assets: Set<string>; cards: Map<string, { n: number; d: number }> }>()
  const live = txns.filter((t) => !t.excluded && t.checks)
  for (const t of live) {
    const codes = new Set<MissingCode>()
    for (const r of t.checks!.r) for (const c of r.m) codes.add(c)
    codes.forEach((c) => {
      if (c === 'def_product') return
      const a = agg.get(c) ?? { txns: new Set<string>(), dollars: 0, assets: new Set<string>(), cards: new Map() }
      if (!a.txns.has(t.id)) { a.txns.add(t.id); a.dollars += t.amount }
      if (t.assetId) a.assets.add(t.assetId)
      if (t.cardLast4) {
        const cd = a.cards.get(t.cardLast4) ?? { n: 0, d: 0 }
        cd.n++; cd.d += t.amount
        a.cards.set(t.cardLast4, cd)
      }
      agg.set(c, a)
    })
  }
  const total = live.length
  const names = (ids: Set<string>) => {
    const list = Array.from(ids).map((id) => nameOf.get(id) ?? 'a vehicle').sort()
    return list.length <= 3 ? joinAnd(list) : `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`
  }
  const items: MissingItem[] = []
  agg.forEach((a, code) => {
    const n = a.txns.size
    const pct = total ? Math.round((n / total) * 100) : 0
    const nA = a.assets.size
    let text: string
    switch (code) {
      case 'no_tank_size': text = `${nA} vehicle${nA === 1 ? ' has' : 's have'} no tank size: ${names(a.assets)}.`; break
      case 'no_fuel_level': text = `${names(a.assets)} ${nA === 1 ? 'sends' : 'send'} no fuel level.`; break
      case 'no_tracker': text = `${names(a.assets)} ${nA === 1 ? 'has' : 'have'} no tracker reporting.`; break
      case 'tracker_silent': text = `Trackers were silent around ${n} purchase${n === 1 ? '' : 's'} (${names(a.assets)}).`; break
      case 'gauge_silent': text = `The fuel gauge was silent around ${n} purchase${n === 1 ? '' : 's'} (${names(a.assets)}).`; break
      case 'no_runtime_signal': text = `${names(a.assets)} ${nA === 1 ? 'sends' : 'send'} no ignition — running is read from movement only.`; break
      case 'no_vehicle': {
        const cards = Array.from(a.cards.entries()).sort((x, y) => y[1].d - x[1].d)
        text = cards.length
          ? `${cards.length === 1 ? 'Card' : 'Cards'} ${joinAnd(cards.slice(0, 3).map(([l4]) => `…${l4}`))}${cards.length > 3 ? ` and ${cards.length - 3} more` : ''} ${cards.length === 1 ? 'has' : 'have'} no vehicle (${n} purchase${n === 1 ? '' : 's'}).`
          : `${n} purchase${n === 1 ? ' has' : 's have'} no card and no vehicle.`
        break
      }
      case 'no_cardholder': {
        const cards = Array.from(a.cards.keys())
        text = cards.length ? `${cards.length === 1 ? 'Card' : 'Cards'} ${joinAnd(cards.slice(0, 3).map((l4) => `…${l4}`))}${cards.length > 3 ? ` and ${cards.length - 3} more` : ''} ${cards.length === 1 ? "isn't" : "aren't"} tied to a person.` : `${n} purchase${n === 1 ? ' has' : 's have'} no cardholder.`
        break
      }
      case 'no_time': text = `${pct}% of purchases have no time of day.`; break
      case 'merchant_unplaced': text = `${n} purchase${n === 1 ? '' : 's'}' station${n === 1 ? '' : 's'} couldn't be placed on the map.`; break
      case 'merchant_city_only': text = `${n} purchase${n === 1 ? '' : 's'} could only be placed to the city.`; break
      case 'gallons_estimated': text = `Gallons were estimated from dollars on ${pct}% of purchases.`; break
      case 'no_clock': text = `Cardholders on ${n} purchase${n === 1 ? '' : 's'} don't use the time clock — the shift check can't run.`; break
      case 'no_zones': text = 'No sites or yards are drawn — the area check has little to compare to.'; break
      case 'stops_unchecked': text = `On ${n} purchase${n === 1 ? '' : 's'} not every stop could be looked up.`; break
      default: text = `${MISSING_LABEL[code]} (${n}).`
    }
    items.push({ code, text, fix: FIX[code], purchases: n, dollars: Math.round(a.dollars * 100) / 100 })
  })
  return items.sort((x, y) => y.dollars - x.dollars || y.purchases - x.purchases)
}
function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

// ── Export ──────────────────────────────────────────────────────────────────

const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v)
  // Opened in Excel: a cell starting with = + - @ or a tab would run as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface ExportRow {
  txnDate: string
  txnAtMs: number | null
  merchant: string
  amount: number
  gallons: number | null
  gallonsEstimated: boolean
  vehicle: string | null
  cardLast4: string | null
  kind: CheckKind
  severity: Severity
  evidence: string
  dollarsAtRisk: number
  missing: MissingCode[]
  cleared: boolean
  verdict: Verdict | null
  verdictNote: string | null
  verdictBy: string | null
  verdictAtMs: number | null
}

/** Every exception and its verdict, one row each — the pilot's working file. */
export function exceptionsCsv(rows: ExportRow[], tz: string): string {
  const head = ['Date', 'Time', 'Merchant', 'Amount', 'Gallons', 'Vehicle', 'Card', 'Exception', 'Severity', 'Evidence',
    '$ at risk', 'Missing', 'Still flagged', 'Verdict', 'Verdict note', 'Verdict by', 'Verdict at']
  const out = [head.map(csvCell).join(',')]
  for (const r of rows) {
    out.push([
      r.txnDate, r.txnAtMs != null ? fmtTime(r.txnAtMs, tz) : '', r.merchant, r.amount.toFixed(2),
      r.gallons == null ? '' : `${r.gallons.toFixed(2)}${r.gallonsEstimated ? ' (est.)' : ''}`,
      r.vehicle ?? '', r.cardLast4 ? `…${r.cardLast4}` : '', KIND_LABEL[r.kind], r.severity, r.evidence,
      r.dollarsAtRisk.toFixed(2), r.missing.map((m) => MISSING_LABEL[m]).join('; '), r.cleared ? 'no — cleared by later evidence' : 'yes',
      r.verdict ? VERDICT_LABEL[r.verdict] : '', r.verdictNote ?? '', r.verdictBy ?? '',
      r.verdictAtMs != null ? `${dayKey(r.verdictAtMs, tz)} ${fmtTime(r.verdictAtMs, tz)}` : '',
    ].map(csvCell).join(','))
  }
  return out.join('\n') + '\n'
}
