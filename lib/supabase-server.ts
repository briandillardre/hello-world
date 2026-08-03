import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Mirrors lib/supabase.ts: the library pins auth cookies to 400 days, so both
// sides shape lifetime from the login form's "stay signed in" choice.
const SESSION_PREF_COOKIE = 'ht_session_pref'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60

export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // In a Server Component render, cookieStore.set throws ("Cookies can
          // only be modified in a Server Action or Route Handler"). Swallow it:
          // getUser() still returns the refreshed session in-memory for this
          // request, which is all the read-only dashboard pages need. (Without
          // this guard the throw bubbles up and the page falls back to an empty
          // company — no fleet, no zones, no timeline.)
          try {
            const pref = cookieStore.get(SESSION_PREF_COOKIE)?.value
            cookiesToSet.forEach(({ name, value, options }) => {
              const o = { ...options }
              if (o.maxAge != null && o.maxAge > 0) {
                if (pref === 'session') {
                  // Browser-session cookie: no Max-Age/Expires at all.
                  delete o.maxAge
                  delete o.expires
                } else {
                  o.maxAge = Math.min(o.maxAge, SESSION_MAX_AGE)
                  delete o.expires
                }
              }
              cookieStore.set(name, value, o)
            })
          } catch {
            /* called from a Server Component — safe to ignore */
          }
        },
      },
    }
  )
}

export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  )
}
