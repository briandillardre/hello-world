/**
 * Pull new Plaid transactions into `expenses`. Server-only. Walks the item's
 * /transactions/sync cursor so we only ever import what's new, inserts outflows
 * (debits) as charges that need a receipt, then auto-matches any that already
 * have one on file.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { syncTransactions, type PlaidTxn } from './plaid'
import { autoMatchReceipts } from './db/expenses'

interface PlaidItemRow { id: string; company_id: string; access_token: string; cursor: string | null }

/** Map a Plaid personal-finance category to our coarse buckets. */
function category(primary?: string): string | null {
  const p = (primary || '').toUpperCase()
  if (p.includes('GAS') || p.includes('FUEL')) return 'fuel'
  if (p.includes('FOOD') || p.includes('RESTAUR')) return 'meals'
  if (p.includes('HOME_IMPROVEMENT') || p.includes('HARDWARE')) return 'materials'
  if (p.includes('AUTO') || p.includes('REPAIR')) return 'repairs'
  return null
}

export async function syncPlaidItem(
  supabase: SupabaseClient,
  item: PlaidItemRow
): Promise<{ imported: number; matched: number }> {
  let cursor = item.cursor
  const outflows: PlaidTxn[] = []
  let guard = 0
  // Drain the cursor (Plaid paginates new/changed transactions).
  while (guard++ < 25) {
    const res = await syncTransactions(item.access_token, cursor)
    for (const t of res.added) {
      // Plaid: amount > 0 = money OUT. Skip credits and still-pending charges
      // (pending ids change when they post — we'd double-import).
      if (t.amount > 0 && !t.pending) outflows.push(t)
    }
    cursor = res.next_cursor
    if (!res.has_more) break
  }

  let imported = 0
  if (outflows.length) {
    const rows = outflows.map((t) => ({
      company_id: item.company_id,
      source: 'plaid',
      merchant: (t.merchant_name || t.name || 'Charge').slice(0, 120),
      amount: Math.round(t.amount * 100) / 100,
      txn_date: t.date,
      category: category(t.personal_finance_category?.primary ?? undefined),
      external_id: t.transaction_id,
      status: 'needs_receipt' as const,
    }))
    const { data, error } = await supabase
      .from('expenses')
      .upsert(rows, { onConflict: 'company_id,external_id', ignoreDuplicates: true })
      .select('id')
    if (!error) imported = data?.length ?? 0
  }

  await supabase.from('plaid_items').update({
    cursor, last_sync: new Date().toISOString(), last_status: `ok: +${imported}`,
  }).eq('id', item.id)

  const matched = imported ? await autoMatchReceipts(item.company_id) : 0
  return { imported, matched }
}
