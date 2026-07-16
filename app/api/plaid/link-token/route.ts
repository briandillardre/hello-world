import { NextResponse } from 'next/server'
import { plaidEnabled, createLinkToken } from '@/lib/plaid'

export const dynamic = 'force-dynamic'

/** Mint a Plaid Link token for the signed-in user to open Plaid Link. */
export async function POST() {
  if (!plaidEnabled()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 501 })
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { link_token } = await createLinkToken(user.id)
    return NextResponse.json({ link_token })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'link token failed' }, { status: 500 })
  }
}
