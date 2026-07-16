/**
 * Card/bank statement CSV → normalized charges. Portable, dependency-free.
 *
 * Handles the messy reality of exported statements: quoted fields, varied header
 * names (Date/Transaction Date, Description/Merchant/Name, Amount/Debit), and
 * both sign conventions (charges as positive or negative). Returns only
 * outflows (money spent) as positive amounts — those are what need a receipt.
 */

export interface ParsedCharge {
  merchant: string
  amount: number      // positive dollars spent
  date: string        // YYYY-MM-DD
  /** Stable-ish dedup key from the row, so re-imports don't duplicate. */
  externalId: string
}

export interface ParseResult {
  charges: ParsedCharge[]
  skipped: number     // rows that weren't parseable outflows (credits, headers, junk)
}

/** Split one CSV line respecting double-quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const findCol = (headers: string[], names: string[]) =>
  headers.findIndex((h) => names.some((n) => norm(h) === norm(n) || norm(h).includes(norm(n))))

function parseDate(s: string): string | null {
  const t = s.trim()
  // ISO first.
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  // MM/DD/YYYY or M/D/YY.
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    const [, mo, d, yy] = m
    const y = yy.length === 2 ? '20' + yy : yy
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const t2 = Date.parse(t)
  return Number.isNaN(t2) ? null : new Date(t2).toISOString().slice(0, 10)
}

function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, '')
  if (!cleaned || cleaned === '-') return null
  const n = Number(cleaned.replace(/[()]/g, ''))
  if (!Number.isFinite(n)) return null
  // Parentheses = negative in some exports.
  return /\(.*\)/.test(s) ? -Math.abs(n) : n
}

export function parseStatementCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { charges: [], skipped: 0 }

  const headers = splitCsvLine(lines[0])
  const dateCol = findCol(headers, ['transaction date', 'date', 'posted date'])
  const descCol = findCol(headers, ['description', 'merchant', 'name', 'payee', 'memo'])
  // Prefer a dedicated debit/amount column; fall back to a signed Amount.
  const debitCol = findCol(headers, ['debit', 'withdrawal'])
  const amountCol = findCol(headers, ['amount', 'transaction amount'])

  const charges: ParsedCharge[] = []
  let skipped = 0
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const date = dateCol >= 0 ? parseDate(cells[dateCol] ?? '') : null
    const merchant = (descCol >= 0 ? cells[descCol] : cells.find((c) => /[a-z]{3,}/i.test(c))) ?? ''
    let amount: number | null = null
    if (debitCol >= 0 && cells[debitCol]) amount = parseAmount(cells[debitCol])
    else if (amountCol >= 0) { const a = parseAmount(cells[amountCol] ?? ''); amount = a == null ? null : -a } // signed: charges negative → flip to positive spend

    if (!date || amount == null || !merchant.trim() || amount <= 0) { skipped++; continue }
    charges.push({
      merchant: merchant.trim().slice(0, 120),
      amount: Math.round(amount * 100) / 100,
      date,
      externalId: `${date}|${Math.round(amount * 100)}|${norm(merchant).slice(0, 24)}`,
    })
  }
  return { charges, skipped }
}
