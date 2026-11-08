/**
 * Job cost (migration 155) — pure: the budget by cost type, actuals by cost
 * type, and WIP. The PM Master's rules: the budget is DIRECT cost from the
 * awarded scope (never the sell total), by PCAT L / M / S / E (O for the
 * rest); F (fuel) and R (repairs) are actual-only; the ORIGINAL budget never
 * changes — the CURRENT budget moves only by an approved change order's cost
 * impact. Shared by the job cost page and `scripts/jobcost-test.mjs`.
 */

import { parseDelimited } from '../bulk-import'

export const PCATS = ['L', 'M', 'S', 'E', 'F', 'R', 'O'] as const
export type Pcat = (typeof PCATS)[number]
export const BUDGET_PCATS: Pcat[] = ['L', 'M', 'S', 'E', 'O']
export const PCAT_WORDS: Record<Pcat, string> = {
  L: 'Labor', M: 'Material', S: 'Subcontract', E: 'Equipment & trucking', F: 'Fuel', R: 'Repairs', O: 'Other',
}
export const isPcat = (v: unknown): v is Pcat => typeof v === 'string' && (PCATS as readonly string[]).includes(v)
export const isBudgetPcat = (v: unknown): v is Pcat => isPcat(v) && BUDGET_PCATS.includes(v)

const c = (v: number) => Math.round((Number(v) || 0) * 100)
const d = (cents: number) => Math.round(cents) / 100

/** A receipt's category in words → the cost type it books to. */
export function pcatOfReceipt(category: string | null | undefined): Pcat {
  const s = String(category ?? '').toLowerCase()
  if (/fuel|diesel|gas\b|gasoline|def\b/.test(s)) return 'F'
  if (/repair|part|tire|service|maint/.test(s)) return 'R'
  if (/sub\b|subcontract/.test(s)) return 'S'
  if (/tool|rental|equip/.test(s)) return 'E'
  if (/material|supply|supplies|stone|asphalt|concrete|pipe|rock|gravel|lumber/.test(s)) return 'M'
  return 'O'
}

export interface BudgetLine { id: string; costCode: string | null; description: string; pcat: Pcat; original: number; sort: number }
export interface CostEntry { pcat: Pcat; amount: number }

/**
 * The budget from the won estimate's costs: per section, material → M, sub →
 * S, haul and lowboy → E, and the crew's install cost split between labor and
 * equipment by `laborShare` (a crew's $/hr carries both; 0–1, the estimator
 * says which). Direct cost only — never the markups.
 */
export function budgetFromEstimate(costs: { section: string | null; material: number; haul: number; install: number; sub: number; lowboy: number }[], laborShare: number): { costCode: string; description: string; pcat: Pcat; original: number }[] {
  const share = Math.max(0, Math.min(1, Number(laborShare) || 0))
  const by = new Map<string, Record<Pcat, number>>()
  for (const x of costs) {
    const sec = (x.section ?? 'General').trim() || 'General'
    if (!by.has(sec)) by.set(sec, { L: 0, M: 0, S: 0, E: 0, F: 0, R: 0, O: 0 })
    const r = by.get(sec)!
    r.M += c(x.material); r.S += c(x.sub); r.E += c(x.haul) + c(x.lowboy)
    const inst = c(x.install)
    const lab = Math.round(inst * share)
    r.L += lab; r.E += inst - lab
  }
  const out: { costCode: string; description: string; pcat: Pcat; original: number }[] = []
  for (const [sec, r] of Array.from(by.entries())) {
    for (const p of BUDGET_PCATS) if (r[p] > 0) out.push({ costCode: sec.slice(0, 40), description: `${sec} — ${PCAT_WORDS[p].toLowerCase()}`.slice(0, 200), pcat: p, original: d(r[p]) })
  }
  return out
}

export interface CostRow { pcat: Pcat; original: number; changeOrders: number; current: number; actual: number; remaining: number; pctUsed: number | null }
export interface CostRollup { rows: CostRow[]; total: CostRow; overBudget: Pcat[] }

/**
 * Budget vs actual by cost type. `coImpacts` = approved change orders' cost
 * impact by the type each was booked to (the current budget's only mover).
 */
export function rollup(budget: BudgetLine[], coImpacts: { pcat: Pcat; amount: number }[], actuals: CostEntry[]): CostRollup {
  const acc = new Map<Pcat, { o: number; co: number; a: number }>(PCATS.map((p) => [p, { o: 0, co: 0, a: 0 }]))
  for (const b of budget) acc.get(b.pcat)!.o += c(b.original)
  for (const x of coImpacts) acc.get(x.pcat)!.co += c(x.amount)
  for (const x of actuals) acc.get(x.pcat)!.a += c(x.amount)
  const mk = (p: Pcat, v: { o: number; co: number; a: number }): CostRow => {
    const cur = v.o + v.co
    return { pcat: p, original: d(v.o), changeOrders: d(v.co), current: d(cur), actual: d(v.a), remaining: d(cur - v.a), pctUsed: cur > 0 ? Math.round((v.a / cur) * 1000) / 10 : null }
  }
  const rows = PCATS.map((p) => mk(p, acc.get(p)!)).filter((r) => r.original || r.changeOrders || r.actual || BUDGET_PCATS.includes(r.pcat))
  const sum = Array.from(acc.values()).reduce((t, v) => ({ o: t.o + v.o, co: t.co + v.co, a: t.a + v.a }), { o: 0, co: 0, a: 0 })
  const total = { ...mk('O', sum), pcat: 'O' as Pcat }
  // F and R carry no budget of their own (actual-only) — they never "go over".
  return { rows, total, overBudget: rows.filter((r) => BUDGET_PCATS.includes(r.pcat) && r.current > 0 && r.actual > r.current).map((r) => r.pcat) }
}

export interface Wip {
  contract: number
  estimatedCost: number
  costToDate: number
  pctComplete: number
  earned: number
  billed: number
  /** + overbilled, − underbilled (earned not billed). */
  overUnder: number
  retainageHeld: number
  forecastMargin: number
  marginPct: number | null
}

/**
 * Work in progress, cost to cost: % complete = cost to date ÷ the estimated
 * total cost (the current budget, or what has been spent when that is more);
 * earned revenue = that % of the contract to date; over / under billing =
 * billed − earned. `estimatedCost` can be the PM's own estimate at completion.
 */
export function wip(o: { contract: number; currentBudget: number; costToDate: number; billed: number; retainageHeld: number; estimateAtCompletion?: number | null }): Wip {
  const eac = o.estimateAtCompletion && o.estimateAtCompletion > 0 ? c(o.estimateAtCompletion) : Math.max(c(o.currentBudget), c(o.costToDate))
  const pct = eac > 0 ? Math.min(1, c(o.costToDate) / eac) : 0
  const earned = Math.round(c(o.contract) * pct)
  return {
    contract: d(c(o.contract)), estimatedCost: d(eac), costToDate: d(c(o.costToDate)), pctComplete: Math.round(pct * 1000) / 10,
    earned: d(earned), billed: d(c(o.billed)), overUnder: d(c(o.billed) - earned), retainageHeld: d(c(o.retainageHeld)),
    forecastMargin: d(c(o.contract) - eac), marginPct: o.contract > 0 ? Math.round(((c(o.contract) - eac) / c(o.contract)) * 1000) / 10 : null,
  }
}

/** A pasted cost list (date, type, amount, vendor, reference, description) — what can't be read is skipped with why. */
export function parseCosts(text: string): { rows: { spentOn: string; pcat: Pcat; amount: number; vendor: string | null; reference: string | null; description: string | null }[]; skipped: { line: number; why: string }[] } {
  const rows: ReturnType<typeof parseCosts>['rows'] = []
  const skipped: { line: number; why: string }[] = []
  // The one CSV / TSV reader the bulk import uses: quoted cells ("12,500") read whole.
  const table = parseDelimited(String(text ?? '').slice(0, 200_000))
  for (let i = 0; i < table.length && rows.length < 1000; i++) {
    const cells = table[i]
    if (cells.every((x) => !String(x).trim())) continue
    const [dateTxt, typeTxt, amtTxt, vendor, reference, ...desc] = cells.map((x) => String(x).trim())
    if (i === 0 && /date/i.test(dateTxt ?? '') && /amount/i.test(cells.join(' '))) continue // a header row
    const iso = toIso(dateTxt ?? '')
    if (!iso) { skipped.push({ line: i + 1, why: 'No date it can read.' }); continue }
    const t = (typeTxt ?? '').toUpperCase().slice(0, 1)
    const pcat: Pcat | null = isPcat(t) ? t : null
    if (!pcat) { skipped.push({ line: i + 1, why: 'Type must be L, M, S, E, F, R or O.' }); continue }
    const neg = /^\(.*\)$/.test(amtTxt ?? '')
    const amount = Number(String(amtTxt ?? '').replace(/[()$,\s]/g, ''))
    if (!Number.isFinite(amount) || amtTxt === '' || Math.abs(amount) > 1e9) { skipped.push({ line: i + 1, why: 'No amount.' }); continue }
    rows.push({ spentOn: iso, pcat, amount: d(c(neg ? -amount : amount)), vendor: vendor?.slice(0, 120) || null, reference: reference?.slice(0, 60) || null, description: desc.join(', ').slice(0, 300) || null })
  }
  return { rows, skipped }
}

/** "2026-05-21", "5/21/2026", "05/21/26" → "2026-05-21". */
export function toIso(s: string): string | null {
  const t = s.trim()
  let y: number, m: number, dd: number
  let mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (mm) { y = +mm[1]; m = +mm[2]; dd = +mm[3] } else {
    mm = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
    if (!mm) return null
    m = +mm[1]; dd = +mm[2]; y = +mm[3] < 100 ? 2000 + +mm[3] : +mm[3]
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const dt = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso && y >= 1990 && y <= 2100 ? iso : null
}
