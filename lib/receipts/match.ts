/**
 * Receipt ↔ transaction matching — pure, dependency-free, portable.
 *
 * Reusable across apps: feed it a list of card/bank transactions and a list of
 * captured receipts; it scores every receipt as a candidate for each
 * transaction (amount, date proximity, merchant name overlap) and returns the
 * best match with a confidence and human-readable reasons. No DB, no framework,
 * no I/O — just data in, ranked matches out.
 */

export interface MatchTxn {
  id: string
  /** Merchant / vendor as it appears on the statement. */
  merchant?: string | null
  amount: number
  /** ISO date (YYYY-MM-DD or full ISO). */
  date: string
}

export interface MatchReceipt {
  id: string
  vendor?: string | null
  amount?: number | null
  date?: string | null
}

export interface MatchCandidate {
  receiptId: string
  /** 0–100. ≥80 = auto-link safe; 50–79 = suggest; <50 = weak. */
  score: number
  reasons: string[]
}

export interface TxnMatch {
  txnId: string
  best: MatchCandidate | null
  candidates: MatchCandidate[]
}

const dayMs = 86_400_000
const toMs = (d?: string | null) => (d ? Date.parse(d.length <= 10 ? d + 'T00:00:00Z' : d) : NaN)

/** Normalize a merchant string to comparable tokens (drop store #s, punctuation). */
export function merchantTokens(s?: string | null): string[] {
  if (!s) return []
  return s
    .toLowerCase()
    .replace(/#?\d{2,}/g, ' ')                 // store numbers, "#1234"
    .replace(/\b(inc|llc|co|corp|the|store|com)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  const hits = a.filter((t) => setB.has(t)).length
  return hits / Math.min(a.length, b.length) // 0–1
}

export interface MatchOpts {
  /** Amounts within this many dollars count as exact (tax rounding, tips). Default 0.02. */
  amountTolerance?: number
  /** Amounts within this fraction count as close. Default 0.05 (5%). */
  amountFraction?: number
  /** Date window in days for a plausible match. Default 4. */
  dateWindowDays?: number
}

/** Score one receipt against one transaction (0–100). */
export function scoreCandidate(txn: MatchTxn, r: MatchReceipt, opts: MatchOpts = {}): MatchCandidate {
  const amountTol = opts.amountTolerance ?? 0.02
  const amountFrac = opts.amountFraction ?? 0.05
  const dateWindow = opts.dateWindowDays ?? 4
  const reasons: string[] = []
  let score = 0

  // Amount — the strongest signal.
  if (r.amount != null) {
    const diff = Math.abs(r.amount - txn.amount)
    if (diff <= amountTol) { score += 55; reasons.push('exact amount') }
    else if (diff <= Math.max(amountTol, txn.amount * amountFrac)) { score += 34; reasons.push('amount within 5%') }
    else { score -= 25; reasons.push('amount differs') }
  }

  // Date proximity.
  const dt = toMs(txn.date), dr = toMs(r.date)
  if (Number.isFinite(dt) && Number.isFinite(dr)) {
    const days = Math.abs(dt - dr) / dayMs
    if (days < 0.5) { score += 30; reasons.push('same day') }
    else if (days <= dateWindow) { score += Math.round(22 - (days / dateWindow) * 14); reasons.push(`within ${Math.ceil(days)}d`) }
    else { score -= 15; reasons.push('date far off') }
  }

  // Merchant name overlap.
  const overlap = tokenOverlap(merchantTokens(txn.merchant), merchantTokens(r.vendor))
  if (overlap > 0) { score += Math.round(overlap * 20); reasons.push('merchant matches') }

  return { receiptId: r.id, score: Math.max(0, Math.min(100, Math.round(score))), reasons }
}

/** For each transaction, rank all receipts and return the best candidate. */
export function matchExpensesToReceipts(txns: MatchTxn[], receipts: MatchReceipt[], opts: MatchOpts = {}): TxnMatch[] {
  return txns.map((txn) => {
    const candidates = receipts
      .map((r) => scoreCandidate(txn, r, opts))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
    return { txnId: txn.id, best: candidates[0] ?? null, candidates: candidates.slice(0, 3) }
  })
}

/** Confidence buckets for UI/automation. */
export const AUTO_LINK_MIN = 80
export const SUGGEST_MIN = 50
export const matchBucket = (score: number): 'auto' | 'suggest' | 'weak' =>
  score >= AUTO_LINK_MIN ? 'auto' : score >= SUGGEST_MIN ? 'suggest' : 'weak'
