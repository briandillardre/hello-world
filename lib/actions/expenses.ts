'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { autoMatchReceipts } from '@/lib/db/expenses'
import { parseStatementCsv } from '@/lib/receipts/import-csv'
import { matchExpensesToReceipts, SUGGEST_MIN, type MatchReceipt } from '@/lib/receipts/match'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Import a pasted / uploaded card statement (CSV). Dedups on re-import, then
 *  auto-links any charge that clearly matches a receipt already on file. */
export async function importChargesAction(text: string): Promise<{ ok: boolean; imported?: number; skipped?: number; matched?: number; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { charges, skipped } = parseStatementCsv(text)
  if (!charges.length) return { ok: false, error: 'No charges found — paste a CSV with Date, Description, and Amount columns.' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const rows = charges.map((c) => ({
      company_id: companyId, source: 'csv', merchant: c.merchant, amount: c.amount, txn_date: c.date,
      external_id: c.externalId, status: 'needs_receipt' as const,
    }))
    // onConflict on (company_id, external_id) — re-importing a statement no-ops.
    const { error } = await supabase.from('expenses').upsert(rows, { onConflict: 'company_id,external_id', ignoreDuplicates: true })
    if (error) return { ok: false, error: error.message }
    const matched = await autoMatchReceipts(companyId)
    revalidatePath('/receipts')
    return { ok: true, imported: charges.length, skipped, matched }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Import failed' }
  }
}

/** Add a single charge by hand (cash, a card charge you know about). */
export async function addExpenseAction(input: { merchant: string; amount: number; txn_date: string; last4?: string; cardholder_name?: string; category?: string }):
  Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!input.merchant.trim() || !(input.amount > 0) || !input.txn_date) return { ok: false, error: 'Merchant, a positive amount, and a date are required.' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('expenses').insert({
      company_id: companyId, source: 'manual', merchant: input.merchant.trim().slice(0, 120),
      amount: input.amount, txn_date: input.txn_date, last4: input.last4?.match(/\d{4}/)?.[0] ?? null,
      cardholder_name: input.cardholder_name?.trim().slice(0, 80) || null, category: input.category ?? null,
      status: 'needs_receipt',
    })
    if (error) return { ok: false, error: error.message }
    await autoMatchReceipts(companyId)
    revalidatePath('/receipts')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Add failed' }
  }
}

/** Link a captured receipt to a charge (manual or accepting a suggestion). */
export async function linkReceiptAction(expenseId: string, receiptId: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('expenses').update({ receipt_id: receiptId, status: 'matched' }).eq('id', expenseId).eq('company_id', companyId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/receipts')
    return { ok: true }
  } catch { return { ok: false, error: 'Link failed' } }
}

/** "No receipt needed" — recurring bills, transfers, etc. Stops the chase. */
export async function markNoReceiptAction(expenseId: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('expenses').update({ status: 'no_receipt_needed', receipt_id: null }).eq('id', expenseId).eq('company_id', companyId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/receipts')
    return { ok: true }
  } catch { return { ok: false, error: 'Update failed' } }
}

/** Suggested receipt matches for open charges (score ≥ SUGGEST threshold), for
 *  the "is this the one?" chips in the UI. */
export async function suggestMatchesAction(): Promise<Record<string, { receiptId: string; score: number; reasons: string[] }[]>> {
  if (isMock) return {}
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const [{ data: openExp }, { data: rcpts }, { data: used }] = await Promise.all([
      supabase.from('expenses').select('id, merchant, amount, txn_date').eq('company_id', companyId).eq('status', 'needs_receipt'),
      supabase.from('receipts').select('id, vendor, amount, txn_date').eq('company_id', companyId).neq('status', 'rejected'),
      supabase.from('expenses').select('receipt_id').eq('company_id', companyId).not('receipt_id', 'is', null),
    ])
    if (!openExp?.length || !rcpts?.length) return {}
    const taken = new Set((used ?? []).map((u) => u.receipt_id as string))
    const receipts: MatchReceipt[] = (rcpts as { id: string; vendor: string | null; amount: number | null; txn_date: string | null }[])
      .filter((r) => !taken.has(r.id) && r.amount != null)
      .map((r) => ({ id: r.id, vendor: r.vendor, amount: Number(r.amount), date: r.txn_date }))
    const txns = (openExp as { id: string; merchant: string | null; amount: number; txn_date: string }[])
      .map((e) => ({ id: e.id, merchant: e.merchant, amount: Number(e.amount), date: e.txn_date }))
    const out: Record<string, { receiptId: string; score: number; reasons: string[] }[]> = {}
    for (const res of matchExpensesToReceipts(txns, receipts)) {
      const good = res.candidates.filter((c) => c.score >= SUGGEST_MIN)
      if (good.length) out[res.txnId] = good
    }
    return out
  } catch { return {} }
}
