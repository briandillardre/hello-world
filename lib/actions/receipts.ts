'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ReceiptRow {
  id: string
  url: string
  status: 'pending' | 'approved' | 'rejected'
  vendor: string | null
  amount: number | null
  txn_date: string | null
  category: string | null
  note: string | null
  project_geofence_id: string | null
  qbo_purchase_id: string | null
  created_at: string
}

/**
 * AI extraction: read the receipt photo, fill vendor/amount/date/category.
 * Fills blanks only — a human's manual edit is never overwritten.
 */
export async function extractReceiptAction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: 'Add the AI key in Vercel to enable extraction.' }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: rcpt } = await supabase.from('receipts').select('*').eq('id', id).single()
    if (!rcpt) return { ok: false, error: 'Receipt not found' }

    const imgRes = await fetch(rcpt.url, { signal: AbortSignal.timeout(10_000) })
    if (!imgRes.ok) return { ok: false, error: 'Could not load the photo' }
    const buf = Buffer.from(await imgRes.arrayBuffer())
    if (buf.byteLength > 4.5 * 1024 * 1024) return { ok: false, error: 'Photo too large to read' }
    const mediaType = rcpt.url.endsWith('.png') ? 'image/png' : rcpt.url.endsWith('.webp') ? 'image/webp' : 'image/jpeg'

    const { extractReceiptFields } = await import('@/lib/receipts/extract')
    const fields = await extractReceiptFields({ data: buf, mediaType }, { apiKey })

    // Fill blanks only — never overwrite a human's manual edit.
    const patch: Record<string, unknown> = {}
    if (!rcpt.vendor && fields.vendor) patch.vendor = fields.vendor
    if (rcpt.amount == null && fields.amount != null) patch.amount = fields.amount
    if (!rcpt.txn_date && fields.date) patch.txn_date = fields.date
    if (!rcpt.category && fields.category) patch.category = fields.category
    if (Object.keys(patch).length) await supabase.from('receipts').update(patch).eq('id', id)

    // A freshly-read receipt may complete a missing-receipt charge.
    try {
      const { autoMatchReceipts } = await import('@/lib/db/expenses')
      await autoMatchReceipts(await getCurrentCompanyId())
    } catch { /* expenses table may not exist yet (pre-030) */ }

    revalidatePath('/receipts')
    return { ok: true }
  } catch (err) {
    console.error('Receipt extraction failed', err)
    return { ok: false, error: 'Extraction failed' }
  }
}

/** The human ✓ — posts the Purchase to QuickBooks, then marks approved.
 *  Edits travel with the approval so what you see is what posts. */
export async function approveReceiptAction(
  id: string,
  edits: { vendor?: string; amount?: number; txn_date?: string; category?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  try {
    if (!(await getMyPermissions()).canManageBilling) {
      return { ok: false, error: 'You need the Billing & QBO permission (Team page) to post receipts.' }
    }
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: rcpt } = await supabase.from('receipts').select('*').eq('id', id).single()
    if (!rcpt) return { ok: false, error: 'Receipt not found' }
    if (rcpt.status === 'approved') return { ok: false, error: 'Already posted' }

    const vendor = (edits.vendor ?? rcpt.vendor ?? '').trim()
    const amount = edits.amount ?? (rcpt.amount != null ? Number(rcpt.amount) : null)
    const dateIso = edits.txn_date ?? rcpt.txn_date ?? new Date().toISOString()
    const category = edits.category ?? rcpt.category ?? 'other'
    if (!vendor) return { ok: false, error: 'Vendor is required' }
    if (!(amount != null && amount > 0)) return { ok: false, error: 'A positive amount is required' }

    const companyId = await getCurrentCompanyId()
    const { getLiveConnection, createServiceExpense, attachToPurchase } = await import('@/lib/qbo')
    const conn = await getLiveConnection(companyId)
    if (!conn) return { ok: false, error: 'QuickBooks isn\'t connected (Accounting page).' }

    // The job the receipt was snapped for mirrors a QuickBooks customer (037)
    // — bill the line to it so job costing in the books matches the site.
    let customerId: string | null = null
    let zoneName: string | null = null
    if (rcpt.project_geofence_id) {
      const { data: z } = await supabase.from('geofences').select('name, qbo_customer_id').eq('id', rcpt.project_geofence_id).maybeSingle()
      customerId = (z?.qbo_customer_id as string | null) ?? null
      zoneName = (z?.name as string | null) ?? null
    }
    // The card swipe this receipt closed (099 chase): who, which card, when.
    const { data: charge } = await supabase.from('expenses')
      .select('merchant, last4, txn_date, cardholder_user_id').eq('receipt_id', id).limit(1).maybeSingle()
    let holder: string | null = null
    if (charge?.cardholder_user_id) {
      const { data: who } = await supabase.from('profiles').select('name').eq('id', charge.cardholder_user_id).maybeSingle()
      holder = (who?.name as string | null) ?? null
    }
    const swipe = charge
      ? ` · card …${charge.last4 ?? '????'}${holder ? ` (${holder})` : ''}${charge.merchant ? ` at ${charge.merchant}` : ''} on ${charge.txn_date}`
      : ''
    const memo = `Field receipt · ${category}${zoneName ? ` · job: ${zoneName}` : ''}${swipe}${rcpt.note ? ` · ${rcpt.note}` : ''} · photo: ${rcpt.url}`

    const exp = await createServiceExpense(conn, {
      vendorName: vendor,
      amount,
      dateIso,
      memo,
      lineDescription: `${category}${zoneName ? ` — ${zoneName}` : ''}${swipe ? ` (card …${charge!.last4 ?? '????'})` : ''}`,
      customerId,
      preferCard: !!charge,
      accountLike: category === 'fuel' ? 'Fuel' : category === 'materials' ? 'Material' : category === 'meals' ? 'Meal' : category === 'tools' ? 'Tool' : 'Repair',
    })

    // The photo becomes the paperclip on the transaction. Best-effort: the
    // Purchase is posted either way and the URL is already in the note.
    let attached = false
    try {
      const r = await attachToPurchase(conn, exp.id, { url: rcpt.url, name: `receipt-${vendor}-${dateIso.slice(0, 10)}`, note: memo.slice(0, 200) })
      attached = !!r
    } catch (err) {
      console.error('Receipt attachment skipped', err instanceof Error ? err.message : err)
    }

    await supabase.from('receipts').update({
      status: 'approved', vendor, amount, txn_date: dateIso.slice(0, 10), category, qbo_purchase_id: exp.id,
      ...(attached ? {} : { note: `${rcpt.note ? `${rcpt.note} · ` : ''}QBO attachment did not upload — photo stays at ${rcpt.url}`.slice(0, 500) }),
    }).eq('id', id)
    revalidatePath('/receipts')
    return { ok: true }
  } catch (err) {
    console.error('Receipt approval failed', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Posting failed' }
  }
}

export async function rejectReceiptAction(id: string, note = ''): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    await supabase.from('receipts').update({ status: 'rejected', note: note.slice(0, 300) || null }).eq('id', id)
    revalidatePath('/receipts')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Reject failed' }
  }
}
