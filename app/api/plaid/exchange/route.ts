import { NextRequest, NextResponse } from 'next/server'
import { plaidEnabled, exchangePublicToken } from '@/lib/plaid'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Finish Plaid Link: trade the browser's public_token for a durable access
 * token, store the item, and pull its transactions immediately so charges show
 * up right away.
 */
export async function POST(req: NextRequest) {
  if (!plaidEnabled()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 501 })
  let body: { public_token?: string; institution?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  if (!body.public_token) return NextResponse.json({ error: 'public_token required' }, { status: 422 })

  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).maybeSingle()
    const companyId = profile?.company_id ?? user.id

    const { access_token, item_id } = await exchangePublicToken(body.public_token)

    const { data: item, error } = await supabase.from('plaid_items').upsert(
      { company_id: companyId, item_id, access_token, institution: body.institution ?? null },
      { onConflict: 'item_id' }
    ).select('id, company_id, access_token, cursor').single()
    if (error || !item) return NextResponse.json({ error: error?.message ?? 'store failed' }, { status: 500 })

    // Immediate first sync (best-effort) via the service client so RLS-free
    // writes go through; failures just defer to the nightly cron.
    let result = { imported: 0, matched: 0 }
    try {
      const { createServiceClient } = await import('@/lib/supabase-server')
      const { syncPlaidItem } = await import('@/lib/plaid-ingest')
      result = await syncPlaidItem(createServiceClient(), item)
    } catch (err) { console.error('initial plaid sync failed', err) }

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'exchange failed' }, { status: 500 })
  }
}
