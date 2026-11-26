/**
 * The books snapshot (migration 167) and the tolerant readers that turn
 * Intuit's report JSON into it. PURE — no fetch, no database — so the harness
 * (scripts/books-test.mjs) runs every parser against a fixture shaped like
 * Intuit's reports and never calls Intuit.
 *
 * Intuit's report shape: `{ Header, Columns: { Column: [{ ColTitle, ColType,
 * MetaData? }] }, Rows: { Row: [...] } }`. A Row is either a data row
 * (`ColData: [{ value, id? }]`) or a section (`Header`, `Rows`, `Summary`,
 * `group`, `type: 'Section'`). Values are strings: "" for none, "1234.56",
 * sometimes "-1,234.56" or "(1,234.56)". Anything missing reads as nothing —
 * never a number nobody measured.
 */

export interface BooksAccount {
  id: string
  name: string
  type: string
  subType: string
  balance: number
  active: boolean
}

export type AgingKey = 'current' | 'd30' | 'd60' | 'd90' | 'over90'
export const AGING_KEYS: AgingKey[] = ['current', 'd30', 'd60', 'd90', 'over90']

export interface Aging {
  buckets: Record<AgingKey, number>
  total: number
  /** Everything past its due date (total less current). */
  pastDue: number
  /** More than 60 days late (61–90 + 91 and over). */
  over60: number
  /** The biggest names, largest total first (≤ 10). */
  top: { name: string; total: number; over60: number }[]
}

export interface PnlMonth {
  /** 'YYYY-MM' */
  month: string
  income: number
  cogs: number
  expense: number
  net: number
}

export interface DepositLine {
  amount: number
  accountId: string | null
  accountName: string | null
  payee: string | null
  memo: string | null
}

export interface Deposit {
  id: string
  date: string
  total: number
  memo: string | null
  lines: DepositLine[]
}

export interface BooksSnapshot {
  takenAt: string
  accounts: BooksAccount[]
  ar: Aging | null
  ap: Aging | null
  pnl: PnlMonth[]
  /** Each account's total over the P&L window (income / expense accounts carry no balance of their own in QuickBooks). */
  pnlAccounts: { name: string; total: number }[]
  deposits: Deposit[]
  /** Parts that didn't come back (named, so the page can say so). */
  missing: string[]
}

export const LIMITS = { accounts: 600, deposits: 200, linesPerDeposit: 25, lines: 1500, pnlAccounts: 300, text: 140, top: 10 }

// ── Small readers ───────────────────────────────────────────────────────────

/** "1,234.56" · "-12" · "(1,234.56)" · "" → number | null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[$,\s]/g, '')
  if (!/^-?\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round((neg ? -n : n) * 100) / 100
}

export const clip = (s: unknown, n = LIMITS.text): string | null => {
  if (typeof s !== 'string') return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, n) : null
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const r2 = (n: number) => Math.round(n * 100) / 100

interface Col { title: string; start: string | null }
function columns(report: unknown): Col[] {
  const cols = arr(obj(obj(report)?.Columns)?.Column)
  return cols.map((c) => {
    const o = obj(c) ?? {}
    const meta = arr(o.MetaData).map(obj).filter(Boolean) as Record<string, unknown>[]
    const start = meta.find((m) => m.Name === 'StartDate')?.Value
    return { title: String(o.ColTitle ?? ''), start: typeof start === 'string' ? start : null }
  })
}

const cells = (row: Record<string, unknown> | null): { value: string }[] =>
  arr(row?.ColData).map((c) => ({ value: String(obj(c)?.value ?? '') }))

/** Every data row in a report, sections flattened, with the group it sat in. */
export function dataRows(report: unknown): { group: string | null; cells: string[]; summary: boolean }[] {
  const out: { group: string | null; cells: string[]; summary: boolean }[] = []
  const walk = (rows: unknown, group: string | null, depth: number) => {
    if (depth > 12) return
    for (const r of arr(obj(rows)?.Row)) {
      const o = obj(r)
      if (!o) continue
      const g = typeof o.group === 'string' ? o.group : group
      if (o.ColData) out.push({ group: g, cells: cells(o).map((c) => c.value), summary: false })
      if (o.Rows) walk(o.Rows, g, depth + 1)
      const sum = obj(o.Summary)
      if (sum?.ColData) out.push({ group: g, cells: cells(sum).map((c) => c.value), summary: true })
    }
  }
  walk(obj(report)?.Rows, null, 0)
  return out
}

// ── Aging (AgedReceivables / AgedPayables summary) ──────────────────────────

function agingKeyOf(title: string): AgingKey | 'total' | null {
  const t = title.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/^total/.test(t)) return 'total'
  if (/current/.test(t)) return 'current'
  if (/^1\s*-\s*30|^0?1 ?to ?30/.test(t)) return 'd30'
  if (/31\s*-\s*60|31 ?to ?60/.test(t)) return 'd60'
  if (/61\s*-\s*90|61 ?to ?90/.test(t)) return 'd90'
  if (/91|over|older|\+/.test(t)) return 'over90'
  return null
}

const emptyBuckets = (): Record<AgingKey, number> => ({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0 })

/** An aging summary report → bucket totals + the top names. null when it isn't one. */
export function parseAging(report: unknown): Aging | null {
  const cols = columns(report)
  const keys = cols.map((c) => agingKeyOf(c.title))
  if (!keys.some((k) => k && k !== 'total')) return null
  const fromNames = emptyBuckets()
  let grandBuckets: Record<AgingKey, number> | null = null
  const names: { name: string; total: number; over60: number }[] = []
  let grand: number | null = null
  for (const row of dataRows(report)) {
    const first = (row.cells[0] ?? '').trim()
    const b = emptyBuckets()
    let total: number | null = null
    row.cells.forEach((v, i) => {
      const k = keys[i]
      if (!k || i === 0) return
      const n = num(v)
      if (n === null) return
      if (k === 'total') total = n
      else b[k] += n
    })
    const t = total ?? AGING_KEYS.reduce((s, k) => s + b[k], 0)
    if (/^total$/i.test(first) || row.group === 'GrandTotal') {
      // The report's own grand total; the last one wins.
      grand = t; grandBuckets = b
      continue
    }
    if (row.summary || !first) continue // a section subtotal, or a blank line
    AGING_KEYS.forEach((k) => { fromNames[k] += b[k] })
    names.push({ name: first.slice(0, 100), total: r2(t), over60: r2(b.d90 + b.over90) })
  }
  // No TOTAL row came back: the names added up.
  const buckets = grandBuckets ?? fromNames
  AGING_KEYS.forEach((k) => { buckets[k] = r2(buckets[k]) })
  const total = r2(grand ?? AGING_KEYS.reduce((t, k) => t + buckets[k], 0))
  names.sort((a, b) => b.total - a.total)
  return {
    buckets,
    total,
    pastDue: r2(total - buckets.current),
    over60: r2(buckets.d90 + buckets.over90),
    top: names.slice(0, LIMITS.top),
  }
}

// ── Profit and loss by month ────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** A column → 'YYYY-MM': the MetaData StartDate when Intuit sends it, else the title ("Nov 2026", "Nov 1-26, 2026"). */
function monthOf(c: Col): string | null {
  if (c.start && /^\d{4}-\d{2}/.test(c.start)) return c.start.slice(0, 7)
  const m = c.title.toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s.*?(\d{4})\s*$/)
  if (!m) return null
  const i = MONTHS.indexOf(m[1])
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, '0')}`
}

type PnlKey = 'income' | 'cogs' | 'expense' | 'otherIncome' | 'otherExpense' | 'net'
function pnlKeyOf(group: string | null, label: string): PnlKey | null {
  const g = (group ?? '').toLowerCase()
  const l = label.toLowerCase().trim()
  if (g === 'income' || l === 'total income') return 'income'
  if (g === 'cogs' || l === 'total cost of goods sold') return 'cogs'
  if (g === 'expenses' || l === 'total expenses') return 'expense'
  if (g === 'otherincome' || l === 'total other income') return 'otherIncome'
  if (g === 'otherexpenses' || l === 'total other expenses') return 'otherExpense'
  if (g === 'netincome' || l === 'net income') return 'net'
  return null
}

/** ProfitAndLoss summarized by month → income / COGS / expense / net per month, plus each account's window total. */
export function parsePnl(report: unknown): { months: PnlMonth[]; accounts: { name: string; total: number }[] } {
  const cols = columns(report)
  const monthCols = cols.map((c, i) => (i === 0 || /^total$/i.test(c.title.trim()) ? null : monthOf(c)))
  const totalCol = cols.findIndex((c, i) => i > 0 && /^total$/i.test(c.title.trim()))
  const by = new Map<string, Record<PnlKey, number | null>>()
  for (const m of monthCols) if (m && !by.has(m)) by.set(m, { income: null, cogs: null, expense: null, otherIncome: null, otherExpense: null, net: null })
  const accounts: { name: string; total: number }[] = []
  for (const row of dataRows(report)) {
    const label = (row.cells[0] ?? '').trim()
    if (row.summary) {
      const k = pnlKeyOf(row.group, label)
      if (!k) continue
      row.cells.forEach((v, i) => {
        const m = monthCols[i]
        if (!m) return
        const n = num(v)
        const slot = by.get(m)!
        if (n !== null) slot[k] = n
      })
      continue
    }
    if (!label || accounts.length >= LIMITS.pnlAccounts) continue
    // A plain account line: its total over the window.
    const total = totalCol > 0 ? num(row.cells[totalCol]) : row.cells.slice(1).reduce((t, v) => t + (num(v) ?? 0), 0)
    if (total !== null && total !== 0) accounts.push({ name: label.slice(0, 100), total: r2(total) })
  }
  const months: PnlMonth[] = Array.from(by.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, s]) => {
    const income = r2((s.income ?? 0) + (s.otherIncome ?? 0))
    const cogs = r2(s.cogs ?? 0)
    const expense = r2((s.expense ?? 0) + (s.otherExpense ?? 0))
    return { month, income, cogs, expense, net: r2(s.net ?? income - cogs - expense) }
  })
  return { months, accounts }
}

// ── Accounts and deposits (query answers) ───────────────────────────────────

export function parseAccounts(resp: unknown): BooksAccount[] {
  const list = arr(obj(obj(resp)?.QueryResponse)?.Account)
  const out: BooksAccount[] = []
  for (const a of list) {
    const o = obj(a)
    if (!o || out.length >= LIMITS.accounts) continue
    const name = clip(o.FullyQualifiedName ?? o.Name, 100)
    if (!name) continue
    out.push({
      id: String(o.Id ?? ''),
      name,
      type: String(o.AccountType ?? ''),
      subType: String(o.AccountSubType ?? ''),
      balance: num(o.CurrentBalance) ?? 0,
      active: o.Active !== false,
    })
  }
  return out
}

export function parseDeposits(resp: unknown): Deposit[] {
  const list = arr(obj(obj(resp)?.QueryResponse)?.Deposit)
  const out: Deposit[] = []
  let lines = 0
  for (const d of list) {
    const o = obj(d)
    if (!o || out.length >= LIMITS.deposits) continue
    const ls: DepositLine[] = []
    for (const l of arr(o.Line)) {
      const lo = obj(l)
      if (!lo || ls.length >= LIMITS.linesPerDeposit || lines >= LIMITS.lines) continue
      const det = obj(lo.DepositLineDetail)
      const acct = obj(det?.AccountRef)
      const ent = obj(det?.Entity)
      ls.push({
        amount: num(lo.Amount) ?? 0,
        accountId: acct?.value !== undefined ? String(acct.value) : null,
        accountName: clip(acct?.name, 100),
        payee: clip(ent?.name, 100),
        memo: clip(lo.Description),
      })
      lines++
    }
    out.push({
      id: String(o.Id ?? ''),
      date: typeof o.TxnDate === 'string' ? o.TxnDate.slice(0, 10) : '',
      total: num(o.TotalAmt) ?? r2(ls.reduce((t, l) => t + l.amount, 0)),
      memo: clip(o.PrivateNote),
      lines: ls,
    })
  }
  return out
}

/** Cash in the bank: the Bank accounts' balances added up. null with no accounts read. */
export function cashInBank(s: Pick<BooksSnapshot, 'accounts'> | null | undefined): { total: number; accounts: number } | null {
  if (!s || !Array.isArray(s.accounts)) return null
  const banks = s.accounts.filter((a) => a.active && a.type === 'Bank')
  if (!banks.length) return null
  return { total: r2(banks.reduce((t, a) => t + a.balance, 0)), accounts: banks.length }
}
