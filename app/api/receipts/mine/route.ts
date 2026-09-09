import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * MY open card charges — the ones the chase is nagging ME about. Feeds the
 * in-app bar (ReceiptNagBar) that follows the cardholder onto every screen
 * until every one of them has a photo. RLS scopes the read to the caller's
 * company; the filter scopes it to the caller. The capture token comes back
 * because the bar snaps straight into /api/r/<token> — the same door the
 * magic link uses. NOTE (sec-check, Sep 9): this route hands out only the
 * caller's tokens, but the expenses RLS policy (030) is company-wide for
 * reads AND writes, so a member with the anon key can still read every open
 * charge or close one through PostgREST — the same as before this route
 * existed. Narrowing that policy is tracked (task #59); nothing here may
 * assume it is already narrow.
 */
export async function GET() {
  if (isMock) return NextResponse.json({ charges: [], total: 0 })
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ charges: [], total: 0 })
    const { data, error } = await supabase.from('expenses')
      .select('id, merchant, amount, txn_date, last4, capture_token, nag_level, created_at')
      .eq('cardholder_user_id', user.id)
      .eq('status', 'needs_receipt')
      .eq('source', 'card_alert')
      .order('created_at', { ascending: false })
      .limit(25)
    if (error) return NextResponse.json({ charges: [], total: 0 })
    const charges = (data ?? []).map((e) => ({
      id: e.id as string,
      merchant: (e.merchant as string | null) ?? null,
      amount: Number(e.amount),
      txn_date: e.txn_date as string,
      last4: (e.last4 as string | null) ?? null,
      token: (e.capture_token as string | null) ?? null,
      nag_level: Number(e.nag_level ?? 1),
      created_at: e.created_at as string,
    }))
    return NextResponse.json({ charges, total: charges.reduce((s, c) => s + c.amount, 0) })
  } catch {
    return NextResponse.json({ charges: [], total: 0 })
  }
}

/** The cardholder says there is no receipt for this one (personal swipe,
 *  refund, a vendor that prints nothing). Closes the chase with their reason
 *  on the row; the office sees it in the done pile. Only for MY charges. */
export async function PATCH(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: false, error: 'Demo mode' }, { status: 400 })
  try {
    const body = await req.json().catch(() => null) as { id?: string; action?: string; note?: string } | null
    if (!body?.id || body.action !== 'no_receipt') return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Sign in' }, { status: 401 })
    const note = String(body.note ?? '').trim().slice(0, 240)
    const { data, error } = await supabase.from('expenses')
      .update({ status: 'no_receipt_needed', note: note ? `No receipt (cardholder): ${note}` : 'No receipt (cardholder)' })
      .eq('id', body.id).eq('cardholder_user_id', user.id).eq('status', 'needs_receipt')
      .select('id')
    if (error || !data?.length) return NextResponse.json({ ok: false, error: 'Not your charge, or already closed' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed' }, { status: 500 })
  }
}
