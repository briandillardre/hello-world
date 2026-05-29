import { NextRequest, NextResponse } from 'next/server'
import { isQboConfigured, exchangeCodeForTokens } from '@/lib/qbo'

export async function GET(request: NextRequest) {
  const baseUrl = new URL('/accounting', request.url)

  if (!isQboConfigured) {
    baseUrl.searchParams.set('demo', '1')
    return NextResponse.redirect(baseUrl)
  }

  const code = request.nextUrl.searchParams.get('code')
  const realmId = request.nextUrl.searchParams.get('realmId')
  const state = request.nextUrl.searchParams.get('state')
  const savedState = request.cookies.get('qbo_oauth_state')?.value

  if (!code || !realmId) {
    baseUrl.searchParams.set('error', 'missing_code')
    return NextResponse.redirect(baseUrl)
  }
  if (!state || state !== savedState) {
    baseUrl.searchParams.set('error', 'state_mismatch')
    return NextResponse.redirect(baseUrl)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

    if (!isMock) {
      const { createServiceClient } = await import('@/lib/supabase-server')
      const supabase = createServiceClient()
      // NOTE: in a full build, resolve company_id from the authenticated session.
      await supabase.from('qbo_connections').upsert({
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        connected_at: new Date().toISOString(),
      })
    }

    baseUrl.searchParams.set('connected', '1')
    const res = NextResponse.redirect(baseUrl)
    res.cookies.delete('qbo_oauth_state')
    return res
  } catch {
    baseUrl.searchParams.set('error', 'token_exchange_failed')
    return NextResponse.redirect(baseUrl)
  }
}
