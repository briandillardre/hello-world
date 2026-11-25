/**
 * Supplier invoices (migration 165) — PURE. A quarry / asphalt plant /
 * concrete plant / supplier invoice or ticket, read off its PDF or photo,
 * becomes a draft the contractor checks line by line; filing it writes the
 * cost book's dated prices and, with a site, the job's material cost.
 *
 * Everything here is arithmetic on what the paper says — nothing is guessed:
 * a line the reader could not read stays empty, a material that matches
 * nothing well stays unmatched, and the checks say where the paper and the
 * numbers disagree. Harness: `node scripts/invoice-test.mjs`.
 */
import type { Material, Source } from '@/lib/estimate/engine'

export const INVOICE_UNITS = ['TON', 'CY', 'SY', 'SF', 'LF', 'EA', 'LOAD'] as const
export type InvoiceUnit = (typeof INVOICE_UNITS)[number]

export interface InvoiceLine {
  description: string
  materialId: string | null
  qty: number | null
  unit: InvoiceUnit | null
  /** $ per unit as printed (material only). */
  unitPrice: number | null
  /** The line's extended amount as printed. */
  amount: number | null
  /** Scale ticket / delivery ticket number, when the line is one ticket. */
  ticket: string | null
}

export interface InvoiceDraft {
  vendorName: string
  invoiceNo: string | null
  invoiceOn: string | null
  dueOn: string | null
  freight: number | null
  fuel: number | null
  tax: number | null
  total: number | null
  /** The paper says the price is delivered (FOB job site) — no separate freight. */
  delivered: boolean
  lines: InvoiceLine[]
  placeId: string | null
  zoneId: string | null
}

export const MAX_LINES = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONEY_MAX = 100_000_000

// ── small readers ───────────────────────────────────────────────────────────

const clip = (v: unknown, n: number): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, n)
const round = (v: number, places: number) => { const f = 10 ** places; return Math.round(v * f) / f }
export const cents = (v: number) => Math.round(v * 100) / 100

/** A number from a number or a printed string ("$1,234.50", "(12.00)" = −12). */
export function readNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[$,\s]/g, '')
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1) }
  if (!/^-?\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

function money(v: unknown): number | null {
  const n = readNumber(v)
  return n === null || Math.abs(n) > MONEY_MAX ? null : cents(n)
}

/** YYYY-MM-DD from ISO, M/D/YYYY or M/D/YY; null when it isn't a real day in 2000–2100. */
export function readDay(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  let y: number, m: number, d: number
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3] } else {
    mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
    if (!mt) return null
    m = +mt[1]; d = +mt[2]; y = +mt[3]; if (y < 100) y += 2000
  }
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = Date.UTC(y, m - 1, d)
  const back = new Date(t)
  if (back.getUTCDate() !== d) return null
  return back.toISOString().slice(0, 10)
}

/** The unit a supplier prints, in the cost book's words; null when it can't be read. */
export function normUnit(v: unknown): InvoiceUnit | null {
  const s = (typeof v === 'string' ? v : '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!s) return null
  if (['TON', 'TONS', 'TN', 'TNS', 'T', 'NT', 'NETTON', 'NETTONS'].includes(s)) return 'TON'
  if (['CY', 'CYD', 'CYS', 'YD3', 'YDS3', 'CUYD', 'CUYDS', 'CUBICYARD', 'CUBICYARDS', 'YD', 'YDS', 'YARD', 'YARDS'].includes(s)) return 'CY'
  if (['SY', 'SQYD', 'SQYDS', 'YD2', 'SQUAREYARD', 'SQUAREYARDS'].includes(s)) return 'SY'
  if (['SF', 'SQFT', 'FT2', 'SQUAREFOOT', 'SQUAREFEET'].includes(s)) return 'SF'
  if (['LF', 'FT', 'LNFT', 'LINFT', 'LINEARFOOT', 'LINEARFEET', 'FEET', 'FOOT'].includes(s)) return 'LF'
  if (['EA', 'EACH', 'PC', 'PCS', 'PIECE', 'PIECES', 'UNIT', 'UNITS'].includes(s)) return 'EA'
  if (['LD', 'LDS', 'LOAD', 'LOADS', 'TL', 'TRUCKLOAD', 'TRUCKLOADS'].includes(s)) return 'LOAD'
  if ((INVOICE_UNITS as readonly string[]).includes(s)) return s as InvoiceUnit
  return null
}

// ── cleaning ────────────────────────────────────────────────────────────────

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The due date from the invoice date and its terms (Net 30 by default). */
export function dueFrom(invoiceOn: string | null, termsDays: number | null = 30): string | null {
  const d = readDay(invoiceOn)
  if (!d) return null
  const t = typeof termsDays === 'number' && Number.isFinite(termsDays) && termsDays >= 0 && termsDays <= 365 ? Math.round(termsDays) : 30
  return addDays(d, t)
}

function cleanLine(raw: unknown): InvoiceLine | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const qtyN = readNumber(r.qty)
  const upN = readNumber(r.unitPrice)
  const line: InvoiceLine = {
    description: clip(r.description, 200),
    materialId: typeof r.materialId === 'string' && UUID.test(r.materialId) ? r.materialId.toLowerCase() : null,
    qty: qtyN === null || Math.abs(qtyN) > 10_000_000 ? null : round(qtyN, 4),
    unit: normUnit(r.unit),
    unitPrice: upN === null || Math.abs(upN) > 10_000_000 ? null : round(upN, 4),
    amount: money(r.amount),
    ticket: clip(r.ticket, 40) || null,
  }
  if (!line.description && line.qty === null && line.amount === null && line.unitPrice === null) return null
  return line
}

/**
 * Any object (the reader's reply, a form, a stored row's draft) → a draft
 * within bounds: ≤ 200 lines, money to the cent, days as YYYY-MM-DD, ids that
 * are ids. `termsDays` (when given and no due date) sets the due date.
 */
export function cleanDraft(raw: unknown, opts: { fromModel?: boolean } = {}): InvoiceDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  let lines = (Array.isArray(r.lines) ? r.lines : []).slice(0, MAX_LINES * 2).map(cleanLine).filter((l): l is InvoiceLine => !!l).slice(0, MAX_LINES)
  // The reader's reply never chooses an id — the source, the site and each
  // line's material come only from our own matching or the person's pick.
  if (opts.fromModel) lines = lines.map((l) => ({ ...l, materialId: null }))
  const invoiceOn = readDay(r.invoiceOn)
  const terms = readNumber(r.termsDays)
  const dueOn = readDay(r.dueOn) ?? (terms !== null && invoiceOn ? dueFrom(invoiceOn, terms) : null)
  return {
    vendorName: clip(r.vendorName, 120),
    invoiceNo: clip(r.invoiceNo, 60) || null,
    invoiceOn,
    dueOn,
    freight: money(r.freight),
    fuel: money(r.fuel),
    tax: money(r.tax),
    total: money(r.total),
    delivered: r.delivered === true,
    lines,
    placeId: !opts.fromModel && typeof r.placeId === 'string' && UUID.test(r.placeId) ? r.placeId.toLowerCase() : null,
    zoneId: !opts.fromModel && typeof r.zoneId === 'string' && UUID.test(r.zoneId) ? r.zoneId.toLowerCase() : null,
  }
}

// ── unit costs ──────────────────────────────────────────────────────────────

/** The line's amount: as printed, else qty × unit price. */
export function lineAmount(l: Pick<InvoiceLine, 'qty' | 'unitPrice' | 'amount'>): number | null {
  if (l.amount !== null) return l.amount
  if (l.qty !== null && l.unitPrice !== null) return cents(l.qty * l.unitPrice)
  return null
}

/** The material on the paper: every line's amount (freight, fuel and tax are header money). */
export function materialSubtotal(d: Pick<InvoiceDraft, 'lines'>): number {
  return cents(d.lines.reduce((t, l) => t + Math.max(0, lineAmount(l) ?? 0), 0))
}

/** What the supplier charges per unit at the plant: the printed unit price (else amount ÷ qty). */
export function pickupUnitCost(l: InvoiceLine): number | null {
  if (l.unitPrice !== null) return l.unitPrice
  const a = lineAmount(l)
  return a !== null && l.qty !== null && l.qty > 0 ? round(a / l.qty, 4) : null
}

/**
 * All-in delivered $/unit: the line's amount plus its share of the freight
 * and fuel (shared by amount), over its quantity. Tax is left out — it is
 * not a cost of the stone. Null with no positive quantity.
 */
export function paidUnitCost(l: InvoiceLine, d: Pick<InvoiceDraft, 'lines' | 'freight' | 'fuel'>): number | null {
  const a = lineAmount(l)
  if (a === null || l.qty === null || l.qty <= 0) return null
  const sub = materialSubtotal(d)
  const extras = (d.freight ?? 0) + (d.fuel ?? 0)
  const share = sub > 0 && a > 0 ? (a / sub) * extras : 0
  return round((a + share) / l.qty, 4)
}

// ── checks ──────────────────────────────────────────────────────────────────

export interface InvoiceCheck { line: number | null; text: string }

const usd = (v: number) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Where the paper and the numbers disagree, or something needed is missing. */
export function invoiceChecks(d: InvoiceDraft): InvoiceCheck[] {
  const out: InvoiceCheck[] = []
  if (!d.vendorName) out.push({ line: null, text: 'No vendor name.' })
  if (!d.invoiceOn) out.push({ line: null, text: 'No invoice date — the cost book dates its prices by it.' })
  if (d.invoiceOn && d.dueOn && d.dueOn < d.invoiceOn) out.push({ line: null, text: 'The due date is before the invoice date.' })
  if (!d.lines.length) out.push({ line: null, text: 'No lines.' })
  d.lines.forEach((l, i) => {
    const n = i + 1
    if (l.qty === null) out.push({ line: n, text: `Line ${n}: no quantity.` })
    else if (l.qty <= 0) out.push({ line: n, text: `Line ${n}: the quantity is ${l.qty === 0 ? 'zero' : 'negative'}.` })
    if (!l.unit && (l.qty !== null || l.unitPrice !== null)) out.push({ line: n, text: `Line ${n}: no unit (TON, CY, LOAD…).` })
    if (l.qty !== null && l.unitPrice !== null && l.amount !== null) {
      const ext = l.qty * l.unitPrice
      if (Math.abs(ext - l.amount) > Math.max(0.05, Math.abs(l.amount) * 0.0005)) {
        out.push({ line: n, text: `Line ${n}: ${l.qty} × ${usd(l.unitPrice)} = ${usd(ext)}, but the line says ${usd(l.amount)}.` })
      }
    }
    if (l.amount === null && (l.qty === null || l.unitPrice === null)) out.push({ line: n, text: `Line ${n}: no amount.` })
  })
  if (d.total !== null && d.lines.length) {
    const want = d.total - (d.tax ?? 0) - (d.freight ?? 0) - (d.fuel ?? 0)
    const got = d.lines.reduce((t, l) => t + (lineAmount(l) ?? 0), 0)
    if (Math.abs(want - got) > 1) {
      out.push({ line: null, text: `The lines add to ${usd(got)}; the total less tax, freight and fuel is ${usd(want)} (${usd(got - want)} ${got > want ? 'over' : 'short'}).` })
    }
  }
  return out
}

// ── matching ────────────────────────────────────────────────────────────────

/** Canonical tokens (weight 3) for the names suppliers give the same thing; plain words weigh 1. */
const STOP = new Set(['the', 'of', 'and', 'a', 'per', 'ton', 'tons', 'tn', 'cy', 'yd', 'yds', 'load', 'loads', 'delivered', 'material', 'materials', 'mat', 'fob', 'plant', 'job', 'site', 'ea', 'lf', 'sy', 'sf', 'type', 'mix', 'no', 'qty', 'with', 'w', 'for', 'scale', 'ticket', 'tkt', 'net'])

interface Tokens { canon: Set<string>; words: Set<string> }

export function materialTokens(name: string): Tokens {
  let s = ` ${String(name ?? '').toLowerCase()} `
  const canon = new Set<string>()
  const take = (re: RegExp, ...tok: string[]) => { if (re.test(s)) { tok.forEach((t) => canon.add(t)); s = s.replace(new RegExp(re.source, 'g'), ' ') } }
  // stone sizes: #57, no. 57, number 57, 57 stone, #57s
  const size = (m: string) => canon.add(`n${m.replace(/^0+/, '')}`)
  s = s.replace(/(?:#|\bno\.?\s*|\bnumber\s*)\s*(\d{1,3})m?s?\b/g, (_, d) => { size(d); return ' ' })
  s = s.replace(/\b(\d{1,2})s?\s+(?=(?:washed\s+)?(?:stone|rock|gravel|aggregate|agg)\b)/g, (_, d) => { size(d); return ' ' })
  // asphalt mixes (SCDOT / NCDOT names)
  take(/\b(?:sf|s)\s*-?\s*9\.5\s*[a-d]?\b/, 'asphalt', 'surface')
  take(/\b(?:s)\s*-?\s*12\.5\s*[a-d]?\b/, 'asphalt', 'surface')
  take(/\bi\s*-?\s*19(?:\.0)?\s*[a-d]?\b/, 'asphalt', 'intermediate')
  take(/\bb\s*-?\s*25(?:\.0)?\s*[a-d]?\b/, 'asphalt', 'asphaltbase')
  take(/\b(?:hma|hot\s*mix|bituminous|asphalt|asph|blacktop)\b/, 'asphalt')
  take(/\bsurface\b/, 'surface')
  take(/\bintermediate\b|\binter\b/, 'intermediate')
  // aggregate base
  take(/\babc\b|\bgab\b|\bdga\b|\bcabc\b|crush(?:er|ed)?\s*(?:and|&|n|-)?\s*run|\bcr\s*run\b|graded\s+aggregate\s+base|aggregate\s+base(?:\s+course)?|macadam/, 'abc')
  take(/\bsurge\b/, 'surge')
  take(/\brip\s*-?\s*rap\b/, 'riprap')
  take(/\bscreenings?\b|\bstone\s+dust\b|\bm-?10\b|manufactured\s+sand/, 'screenings')
  take(/\btop\s*soil\b/, 'topsoil')
  take(/\bflowable\s+fill\b|\bcls?m\b/, 'flowable')
  take(/\b(?:select\s+|structural\s+|common\s+)?fill(?:\s+dirt)?\b|\bborrow\b/, 'fill')
  take(/\bsand\b/, 'sand')
  take(/\bready\s*-?\s*mix\b|\bconcrete\b|\bconc\b/, 'concrete')
  s = s.replace(/\b(\d{4})\s*psi\b/g, (_, d) => { canon.add(`p${d}`); canon.add('concrete'); return ' ' })
  const words = new Set(s.split(/[^a-z0-9.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+(\.\d+)?$/.test(w)))
  for (const w of ['stone', 'rock', 'gravel']) if (words.has(w)) { words.delete(w); words.add('stone') }
  return { canon, words }
}

/** Tokens that name different things of one kind: #57 vs #67, surface vs intermediate. */
function conflicts(a: Set<string>, b: Set<string>): boolean {
  const grp = (s: Set<string>, re: RegExp) => Array.from(s).filter((t) => re.test(t))
  for (const re of [/^n\d+$/, /^p\d+$/]) {
    const x = grp(a, re), y = grp(b, re)
    if (x.length && y.length && !x.some((t) => y.includes(t))) return true
  }
  const kinds = ['surface', 'intermediate', 'asphaltbase']
  const ka = kinds.filter((k) => a.has(k)), kb = kinds.filter((k) => b.has(k))
  if (ka.length && kb.length && !ka.some((k) => kb.includes(k))) return true
  const fam = ['abc', 'surge', 'riprap', 'screenings', 'topsoil', 'fill', 'sand', 'concrete', 'flowable']
  const fa = fam.filter((k) => a.has(k)), fb = fam.filter((k) => b.has(k))
  if (fa.length && fb.length && !fa.some((k) => fb.includes(k))) return true
  if (a.has('asphalt') !== b.has('asphalt') && (a.has('asphalt') ? fb.length : fa.length)) return true
  return false
}

function tokenScore(a: Tokens, b: Tokens): number {
  if (conflicts(a.canon, b.canon)) return 0
  const w = (t: Tokens) => t.canon.size * 3 + t.words.size
  let inter = 0
  for (const t of Array.from(a.canon)) if (b.canon.has(t)) inter += 3
  for (const t of Array.from(a.words)) if (b.words.has(t)) inter += 1
  const tot = w(a) + w(b)
  return tot ? (2 * inter) / tot : 0
}

export interface Match { id: string; name: string; score: number }
export const MATERIAL_THRESHOLD = 0.5
export const VENDOR_THRESHOLD = 0.6

/** The cost-book material a printed description most likely is; null under the threshold. */
export function matchMaterial(description: string, materials: Pick<Material, 'id' | 'name'>[]): Match | null {
  const a = materialTokens(description)
  if (!a.canon.size && !a.words.size) return null
  let best: Match | null = null
  for (const m of materials) {
    const score = round(tokenScore(a, materialTokens(m.name)), 3)
    if (score >= MATERIAL_THRESHOLD && (!best || score > best.score)) best = { id: m.id, name: m.name, score }
  }
  return best
}

const CORP = new Set(['inc', 'llc', 'co', 'company', 'corp', 'corporation', 'ltd', 'lp', 'llp', 'the', 'of', 'and', 'dba', 'pllc', 'plc', 'incorporated'])
export function vendorTokens(name: string): Set<string> {
  return new Set(String(name ?? '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w && !CORP.has(w)))
}

/** Two sources scoring within this of each other are a tie: no prefill (pick it by hand). */
export const VENDOR_TIE = 0.05

/**
 * The source (a Place) an invoice's vendor most likely is; null under the
 * threshold, and null when the runner-up is within VENDOR_TIE of it ("Vulcan
 * Materials — Pelham" vs "— Anderson" for "Vulcan Materials") — a wrong
 * source dates the wrong plant's price, so a tie is left to the person.
 */
export function matchVendor(name: string, sources: Pick<Source, 'id' | 'name'>[]): Match | null {
  const a = vendorTokens(name)
  if (!a.size) return null
  let best: Match | null = null
  let second = 0
  for (const s of sources) {
    const b = vendorTokens(s.name)
    if (!b.size) continue
    let inter = 0
    for (const t of Array.from(a)) if (b.has(t)) inter++
    const dice = (2 * inter) / (a.size + b.size)
    const small = Math.min(a.size, b.size)
    const contain = small >= 2 ? (inter / small) * 0.9 : 0
    const score = round(Math.max(dice, contain), 3)
    if (!best || score > best.score) {
      if (best) second = Math.max(second, best.score)
      best = { id: s.id, name: s.name, score }
    } else second = Math.max(second, score)
  }
  if (!best || best.score < VENDOR_THRESHOLD) return null
  return best.score - second < VENDOR_TIE ? null : best
}

// ── what filing writes to the cost book ─────────────────────────────────────

export interface PriceFromInvoice {
  placeId: string
  materialId: string
  price: number
  unit: InvoiceUnit
  basis: 'pickup' | 'delivered'
  fuelPct: number | null
  quotedOn: string
  note: string
}

/**
 * The cost_prices rows an invoice gives: one per material + unit, the
 * quantity-weighted material price (several tickets of #57 → one price).
 * The engine multiplies a price by (1 + fuel %) and adds its own haul for a
 * pickup price, so the stored price is the MATERIAL price, the fuel goes in
 * as fuel %, and the basis is 'delivered' only when the paper says delivered
 * and bills no separate freight. Separate freight is named in the note (its
 * $/unit) — the estimate hauls with your own trucks' numbers.
 * Needs a source, a date and matched lines with a unit and quantity.
 */
export type FuelOn = 'material' | 'freight'

/**
 * What a fuel surcharge rides on, by default: the freight when freight is
 * billed separately (a plant's fuel surcharge is on its trucks), else the
 * material. The review lets the person flip it.
 */
export function fuelDefault(d: Pick<InvoiceDraft, 'freight'>): FuelOn {
  return (d.freight ?? 0) > 0 ? 'freight' : 'material'
}

export function pricesFromInvoice(d: InvoiceDraft, materials: Pick<Material, 'id'>[], opts: { fuelOn?: FuelOn | null } = {}): PriceFromInvoice[] {
  if (!d.placeId || !d.invoiceOn) return []
  const known = new Set(materials.map((m) => m.id))
  const sub = materialSubtotal(d)
  const fuelOn: FuelOn = opts.fuelOn === 'material' || opts.fuelOn === 'freight' ? opts.fuelOn : fuelDefault(d)
  // Fuel on the freight is not a cost of the stone: the estimate hauls with its own numbers.
  const fuelPct = fuelOn === 'material' && d.fuel && d.fuel > 0 && sub > 0 ? Math.min(100, round((d.fuel / sub) * 100, 2)) : null
  const freightSeparate = (d.freight ?? 0) > 0
  const basis: 'pickup' | 'delivered' = !freightSeparate && (d.delivered || d.lines.some((l) => /\bdeliver(ed|y)\b/i.test(l.description))) ? 'delivered' : 'pickup'
  const groups = new Map<string, { materialId: string; unit: InvoiceUnit; qty: number; amount: number }>()
  for (const l of d.lines) {
    if (!l.materialId || !known.has(l.materialId) || !l.unit || l.qty === null || l.qty <= 0) continue
    const unitCost = pickupUnitCost(l)
    if (unitCost === null || unitCost < 0) continue
    const k = `${l.materialId}|${l.unit}`
    const g = groups.get(k) ?? { materialId: l.materialId, unit: l.unit, qty: 0, amount: 0 }
    g.qty += l.qty
    g.amount += unitCost * l.qty
    groups.set(k, g)
  }
  const ref = d.invoiceNo ? `Invoice ${d.invoiceNo}` : 'Invoice'
  return Array.from(groups.values()).map((g) => {
    const price = round(g.amount / g.qty, 4)
    let note = ref
    if (freightSeparate && sub > 0) {
      const freightShare = ((d.freight ?? 0) * (g.amount / sub)) / g.qty
      note += ` · freight billed ${usd(freightShare)}/${g.unit}`
    }
    if (fuelOn === 'freight' && d.fuel && d.fuel > 0 && sub > 0) {
      const fuelShare = (d.fuel * (g.amount / sub)) / g.qty
      note += ` · fuel on freight ${usd(fuelShare)}/${g.unit}`
    }
    return { placeId: d.placeId!, materialId: g.materialId, price, unit: g.unit, basis, fuelPct, quotedOn: d.invoiceOn!, note: note.slice(0, 200) }
  })
}

// ── accounts payable ────────────────────────────────────────────────────────

export interface ApInvoice { id: string; total: number | null; paidAmount: number | null; paidOn: string | null; dueOn: string | null; invoiceOn: string | null }
export type ApBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90p'
export const AP_BUCKETS: { key: ApBucket; label: string }[] = [
  { key: 'current', label: 'Current' }, { key: 'd1_30', label: '1–30 days' }, { key: 'd31_60', label: '31–60' },
  { key: 'd61_90', label: '61–90' }, { key: 'd90p', label: '90+' },
]

/** What is still owed on an invoice (0 when paid in full or no total). */
export function owedOn(i: ApInvoice): number {
  if (i.total === null || i.total <= 0) return 0
  if (i.paidOn && i.paidAmount === null) return 0
  return Math.max(0, cents(i.total - (i.paidAmount ?? 0)))
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)

/**
 * Days past due (negative = days until due); null with no date to count from.
 * No due date on the paper = Net 30 from the invoice date (the common
 * supplier term — never "late on the day it was billed").
 */
export function daysLate(i: Pick<ApInvoice, 'dueOn' | 'invoiceOn'>, today: string): number | null {
  const inv = readDay(i.invoiceOn)
  const due = i.dueOn ?? (inv ? addDays(inv, 30) : null)
  if (!due || !readDay(today)) return null
  return Math.round((dayMs(today) - dayMs(due)) / 86_400_000)
}

export interface ApAging {
  buckets: Record<ApBucket, number>
  counts: Record<ApBucket, number>
  open: number
  openCount: number
  pastDue: number
  /** Owed and due within the next 7 days (not yet late). */
  dueThisWeek: number
}

/** Unpaid invoices bucketed by days past due (the due date, else Net 30 from the invoice date). */
export function apAging(invoices: ApInvoice[], today: string): ApAging {
  const buckets: Record<ApBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 }
  const counts: Record<ApBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 }
  let open = 0, openCount = 0, dueThisWeek = 0
  for (const i of invoices) {
    const owed = owedOn(i)
    if (owed <= 0) continue
    const late = daysLate(i, today)
    const k: ApBucket = late === null || late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90p'
    buckets[k] = cents(buckets[k] + owed)
    counts[k]++
    open = cents(open + owed)
    openCount++
    if (late !== null && late <= 0 && late >= -7) dueThisWeek = cents(dueThisWeek + owed)
  }
  const pastDue = cents(open - buckets.current)
  return { buckets, counts, open, openCount, pastDue, dueThisWeek }
}

/** A blank draft for typing one in. */
export function blankDraft(): InvoiceDraft {
  return { vendorName: '', invoiceNo: null, invoiceOn: null, dueOn: null, freight: null, fuel: null, tax: null, total: null, delivered: false, lines: [], placeId: null, zoneId: null }
}

/** The job_costs `reference` an invoice's charges carry: its number, else a short id. */
export function invoiceRef(id: string, invoiceNo: string | null): string {
  return (invoiceNo ? invoiceNo : `INV-${String(id).replace(/-/g, '').slice(0, 8)}`).slice(0, 60)
}
