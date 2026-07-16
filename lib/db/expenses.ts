import { matchExpensesToReceipts, AUTO_LINK_MIN, type MatchReceipt, type MatchTxn } from '../receipts/match'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface Expense {
  id: string
  company_id: string
  source: string
  merchant: string | null
  amount: number
  txn_date: string
  last4: string | null
  cardholder_user_id: string | null
  cardholder_name: string | null
  category: string | null
  note: string | null
  receipt_id: string | null
  status: 'needs_receipt' | 'matched' | 'no_receipt_needed'
  external_id: string | null
  chased_at: string | null
  created_at: string
}

export async function getExpenses(companyId: string, status?: Expense['status']): Promise<Expense[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    let q = supabase.from('expenses').select('*').eq('company_id', companyId)
    if (status) q = q.eq('status', status)
    const { data, error } = await q.order('txn_date', { ascending: false }).limit(500)
    if (error) return [] // pre-030 DB
    return (data ?? []) as Expense[]
  } catch { return [] }
}

interface ReceiptLite { id: string; vendor: string | null; amount: number | null; txn_date: string | null }

/**
 * Auto-link open charges to captured receipts when the match is confident
 * (score ≥ AUTO_LINK_MIN). One receipt links to at most one charge per pass.
 * Returns how many it linked. Safe to run after any import or receipt add.
 */
export async function autoMatchReceipts(companyId: string): Promise<number> {
  if (isMock) return 0
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()

  const [{ data: openExp }, { data: rcpts }] = await Promise.all([
    supabase.from('expenses').select('id, merchant, amount, txn_date').eq('company_id', companyId).eq('status', 'needs_receipt').is('receipt_id', null),
    supabase.from('receipts').select('id, vendor, amount, txn_date').eq('company_id', companyId).neq('status', 'rejected'),
  ])
  if (!openExp?.length || !rcpts?.length) return 0

  // Receipts already claimed by an expense can't be reused.
  const { data: used } = await supabase.from('expenses').select('receipt_id').eq('company_id', companyId).not('receipt_id', 'is', null)
  const taken = new Set((used ?? []).map((u) => u.receipt_id as string))

  const txns: MatchTxn[] = (openExp as { id: string; merchant: string | null; amount: number; txn_date: string }[])
    .map((e) => ({ id: e.id, merchant: e.merchant, amount: Number(e.amount), date: e.txn_date }))
  const receipts: MatchReceipt[] = (rcpts as ReceiptLite[])
    .filter((r) => !taken.has(r.id) && r.amount != null)
    .map((r) => ({ id: r.id, vendor: r.vendor, amount: r.amount != null ? Number(r.amount) : null, date: r.txn_date }))

  const results = matchExpensesToReceipts(txns, receipts)
  const claimed = new Set<string>()
  let linked = 0
  for (const res of results) {
    if (!res.best || res.best.score < AUTO_LINK_MIN || claimed.has(res.best.receiptId)) continue
    claimed.add(res.best.receiptId)
    await supabase.from('expenses').update({ receipt_id: res.best.receiptId, status: 'matched' }).eq('id', res.txnId).eq('company_id', companyId)
    linked++
  }
  return linked
}
