/**
 * What a bookkeeper would point at first in a contractor's QuickBooks —
 * read off the nightly snapshot (lib/books/report.ts). PURE; harness
 * scripts/books-test.mjs. Plain words: no "suspense account", no "accrual".
 *
 * Two kinds of finding: `fix` = wrong until somebody fixes it; `look` = may be
 * fine, worth a minute. Each check names what it saw, so the owner can find it.
 */
import type { BooksAccount, BooksSnapshot, Deposit } from './report'

export type Severity = 'fix' | 'look'
export interface Finding {
  key: string
  severity: Severity
  words: string
  amount?: number
  count?: number
  /** Up to five of the things it saw, in words. */
  examples?: string[]
}

const DAY = 86_400_000
const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const r2 = (n: number) => Math.round(n * 100) / 100

/** Money with nowhere to go. */
const UNCATEGORIZED = /\buncategori[sz]ed\s+(income|expense|expenses|asset|assets)\b|\bask\s+my\s+accountant\b/i
/** Not revenue, whatever account it landed in. */
const NOT_REVENUE = /\b(loans?|sba|ppp|eidl|line of credit|credit line|loc|transfers?|xfer|sale of (equipment|truck|vehicle|trailer|machine)|sold (equipment|truck|vehicle|trailer|machine)|equipment sale|insurance (claim|check|payout|settlement)|claim|refunds?|owner (contribution|investment)|capital contribution)\b/i
/** Owner money that isn't a cost of the business. */
const OWNER_DRAW = /\b(draws?|distributions?|personal|owners?'?s?)\b/i
const OWNER_DRAW_NOT = /\bproperty tax|personal property|owners?'?s? (insurance|policy)\b/i

export const BIG_DEPOSIT = 5000
export const DEPOSIT_WINDOW_DAYS = 60

const isPnlType = (t: string) => /income|expense|cost of goods sold/i.test(t)
const isExpenseType = (t: string) => /expense|cost of goods sold/i.test(t)

/** An account's money: its balance, or — for income / expense accounts, which carry none in QuickBooks — its P&L total. */
function amountOf(a: BooksAccount, s: BooksSnapshot): number | null {
  if (!isPnlType(a.type)) return a.balance
  const name = a.name.toLowerCase()
  const hit = s.pnlAccounts?.find((p) => p.name.toLowerCase() === name || p.name.toLowerCase().endsWith(':' + name))
  return hit ? hit.total : (s.pnlAccounts?.length ? 0 : null)
}

function depositHits(s: BooksSnapshot, today: string) {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - DEPOSIT_WINDOW_DAYS * DAY).toISOString().slice(0, 10)
  const typeOf = new Map<string, string>()
  const typeByName = new Map<string, string>()
  for (const a of s.accounts ?? []) { typeOf.set(a.id, a.type); typeByName.set(a.name.toLowerCase(), a.type) }
  const hits: { d: Deposit; amount: number; why: string }[] = []
  for (const d of s.deposits ?? []) {
    if (!d.date || d.date < since || d.date > today || d.total <= BIG_DEPOSIT) continue
    for (const l of d.lines) {
      if (l.amount <= 0) continue
      const t = (l.accountId && typeOf.get(l.accountId)) || (l.accountName && typeByName.get(l.accountName.toLowerCase())) || ''
      if (t !== 'Income') continue
      const text = [l.memo, l.payee, d.memo].filter(Boolean).join(' · ')
      const m = text.match(NOT_REVENUE)
      if (!m) continue
      hits.push({ d, amount: l.amount, why: m[0].toLowerCase() })
    }
  }
  return hits
}

/** The findings, fixes first, the bigger money first within each. */
export function booksAudit(s: BooksSnapshot | null | undefined, today: string): Finding[] {
  if (!s) return []
  const out: Finding[] = []
  const accounts = (s.accounts ?? []).filter((a) => a.active)

  // 1. Money in Uncategorized / Ask My Accountant.
  const unc = accounts.map((a) => ({ a, v: UNCATEGORIZED.test(a.name) ? amountOf(a, s) : null })).filter((x) => x.v !== null && Math.abs(x.v) >= 1)
  if (unc.length) {
    const total = r2(unc.reduce((t, x) => t + Math.abs(x.v!), 0))
    out.push({
      key: 'uncategorized', severity: 'fix', amount: total, count: unc.length,
      words: `${money(total)} is sitting in ${unc.length === 1 ? `“${unc[0].a.name}”` : `${unc.length} catch-all accounts`} — money QuickBooks couldn’t place. Each one needs a real category, or the profit is a guess.`,
      examples: unc.slice(0, 5).map((x) => `${x.a.name}: ${money(x.v!)}`),
    })
  }

  // 2. Undeposited Funds.
  const und = accounts.filter((a) => /undeposited funds/i.test(a.name) || a.subType === 'UndepositedFunds')
  const undTotal = r2(und.reduce((t, a) => t + a.balance, 0))
  if (undTotal >= 1) {
    out.push({
      key: 'undeposited', severity: undTotal > BIG_DEPOSIT ? 'fix' : 'look', amount: undTotal,
      words: `${money(undTotal)} in customer payments is marked received but never matched to a bank deposit (Undeposited Funds). Usually it’s already in the bank and recorded twice — match each payment to its deposit.`,
    })
  }

  // 3. A bank account below zero.
  const neg = accounts.filter((a) => a.type === 'Bank' && a.balance < 0)
  if (neg.length) {
    const total = r2(neg.reduce((t, a) => t + a.balance, 0))
    out.push({
      key: 'negative_bank', severity: 'fix', amount: total, count: neg.length,
      words: neg.length === 1
        ? `“${neg[0].name}” shows ${money(neg[0].balance)} in QuickBooks. A bank account can’t really be below zero — a deposit is missing, or a payment was entered twice. Reconcile it to the bank statement.`
        : `${neg.length} bank accounts show below zero in QuickBooks. A deposit is missing or a payment was entered twice — reconcile each to its statement.`,
      examples: neg.slice(0, 5).map((a) => `${a.name}: ${money(a.balance)}`),
    })
  }

  // 4. Big deposits booked as sales that read like loans, transfers or sales of equipment.
  const hits = depositHits(s, today)
  if (hits.length) {
    const total = r2(hits.reduce((t, h) => t + h.amount, 0))
    out.push({
      key: 'non_revenue_deposits', severity: 'look', amount: total, count: hits.length,
      words: `${hits.length === 1 ? 'A deposit' : `${hits.length} deposits`} over ${money(BIG_DEPOSIT)} in the last ${DEPOSIT_WINDOW_DAYS} days went to income but ${hits.length === 1 ? 'reads' : 'read'} like a loan, a transfer, an insurance check or the sale of equipment (${money(total)}). That money isn’t sales — if it’s booked as sales, profit and taxes are overstated.`,
      examples: hits.slice(0, 5).map((h) => `${h.d.date} · ${money(h.amount)} · “${h.why}”`),
    })
  }

  // 5. Expense accounts named like an owner draw.
  const draws = accounts
    .filter((a) => isExpenseType(a.type) && OWNER_DRAW.test(a.name) && !OWNER_DRAW_NOT.test(a.name))
    .map((a) => ({ a, v: amountOf(a, s) }))
    .filter((x) => x.v === null || Math.abs(x.v) >= 1)
  if (draws.length) {
    const known = draws.filter((x) => x.v !== null)
    const total = known.length ? r2(known.reduce((t, x) => t + x.v!, 0)) : undefined
    out.push({
      key: 'owner_draws_as_expense', severity: 'look', count: draws.length, ...(total !== undefined ? { amount: total } : {}),
      words: `${draws.length === 1 ? `“${draws[0].a.name}” is` : `${draws.length} accounts named for draws or personal spending are`} set up as a business expense${total !== undefined ? ` (${money(total)} in the last 12 months)` : ''}. Money the owner takes out belongs in equity, not expenses — a buyer or lender adds it back, and the taxes come out different.`,
      examples: draws.slice(0, 5).map((x) => x.v === null ? x.a.name : `${x.a.name}: ${money(x.v)}`),
    })
  }

  // 6. Customers slow to pay.
  if (s.ar && s.ar.total > 0) {
    const share = s.ar.over60 / s.ar.total
    if (share > 0.1) {
      out.push({
        key: 'ar_over_60', severity: 'fix', amount: s.ar.over60,
        words: `${money(s.ar.over60)} of the ${money(s.ar.total)} customers owe is more than 60 days late (${Math.round(share * 100)}% — keep it under 10%). Call on these before they become write-offs.`,
        examples: s.ar.top.filter((t) => t.over60 > 0).slice(0, 5).map((t) => `${t.name}: ${money(t.over60)} over 60 days`),
      })
    } else if (s.ar.pastDue >= 1) {
      out.push({
        key: 'ar_past_due', severity: 'look', amount: s.ar.pastDue,
        words: `${money(s.ar.pastDue)} of what customers owe is past due, none of it badly late yet.`,
      })
    }
  }

  // 7. Supplier bills past due.
  if (s.ap && s.ap.pastDue >= 1) {
    out.push({
      key: 'ap_past_due', severity: 'fix', amount: s.ap.pastDue,
      words: `${money(s.ap.pastDue)} in supplier bills is past due${s.ap.over60 >= 1 ? ` (${money(s.ap.over60)} more than 60 days)` : ''}. Pay them or mark the ones already paid — a late supplier stops delivering.`,
      examples: s.ap.top.filter((t) => t.total > 0).slice(0, 5).map((t) => `${t.name}: ${money(t.total)}`),
    })
  }

  return out.sort((a, b) => (a.severity === b.severity ? Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0) : a.severity === 'fix' ? -1 : 1))
}
