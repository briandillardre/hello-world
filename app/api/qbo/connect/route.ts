import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { isQboConfigured, buildAuthorizeUrl } from '@/lib/qbo'

// Must never be statically prerendered: the redirect target depends on the
// request origin and the OAuth state must be unique per visitor.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isQboConfigured) {
    // Demo mode: nothing to connect to — bounce back to the accounting page.
    return NextResponse.redirect(new URL('/accounting?demo=1', request.url))
  }

  // ?check=1 — the redirect_uri debugger. Intuit rejects any redirect_uri
  // that isn't a character-exact match on the CURRENT environment's Redirect
  // URIs list, and you can't fix what you can't see. This prints exactly what
  // the app sends so it can be pasted into developer.intuit.com verbatim.
  if (request.nextUrl.searchParams.get('check')) {
    const env = process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
    return NextResponse.json({
      environment: env,
      redirect_uri_sent_to_intuit: process.env.QBO_REDIRECT_URI ?? '(NOT SET)',
      client_id_last6: (process.env.QBO_CLIENT_ID ?? '').slice(-6) || '(NOT SET)',
      fix: `On developer.intuit.com → your app → Keys & credentials → the ${env.toUpperCase()} tab → Redirect URIs: add the redirect_uri_sent_to_intuit value above, exactly, then retry. If the value itself is wrong, edit QBO_REDIRECT_URI in Vercel and REDEPLOY — env edits do nothing until a redeploy.`,
    })
  }

  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(await buildAuthorizeUrl(state))
  // CSRF protection: store state in a short-lived cookie to verify on callback.
  res.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}
