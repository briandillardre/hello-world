import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { generateApiKey } from '@/lib/utils'

/**
 * OAuth redirect target. Supabase sends the user back here with a `code`; we
 * exchange it for a session cookie. A first-time social sign-in has no company
 * yet (email signup creates one in the form), so we provision a company +
 * admin profile here on first login, then send new users to onboarding.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  let next = url.searchParams.get('next') || '/map'
  // Same-site paths only — an absolute, protocol-relative, or backslash
  // `next` ('/\\evil.com' resolves off-domain) would make this an open
  // redirector off the real domain (sec-check, Aug 17 + 18).
  if (!/^\/(?![/\\])/.test(next)) next = '/map'
  if (new URL(next, url.origin).origin !== url.origin) next = '/map'

  if (code) {
    const supabase = createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin))
    }
    const user = data.user
    // Invitees (next → /join) get their company from the invite accept flow, so
    // don't provision one here or we'd orphan a throwaway company.
    if (user && !next.startsWith('/join')) {
      // Bootstrap a company + profile the first time this account signs in.
      const svc = createServiceClient()
      const { data: profile } = await svc.from('profiles').select('id').eq('id', user.id).maybeSingle()
      if (!profile) {
        const name = (user.user_metadata?.name as string) || (user.email?.split('@')[0]) || 'My Company'
        await svc.from('companies').insert({ id: user.id, name, api_key: generateApiKey(), plan: 'starter' })
        await svc.from('profiles').insert({ id: user.id, company_id: user.id, role: 'admin', name, email: user.email })
        if (next === '/map') next = '/welcome' // first-timers → onboarding
      }
    }
  }
  return NextResponse.redirect(new URL(next, url.origin))
}
