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

  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(buildAuthorizeUrl(state))
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
