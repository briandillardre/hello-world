'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Session lifetime is OURS, not the library's: @supabase/ssr pins auth
 * cookies to 400 days on every write, ignoring cookieOptions.maxAge. So we
 * supply our own cookie adapters and shape lifetime from the ht_session_pref
 * cookie (set by the login form's "stay signed in" checkbox):
 *   · '30d' / absent → cookies capped at 30 days (the product promise)
 *   · 'session'      → no Max-Age → signed out when the browser closes
 */
export const SESSION_PREF_COOKIE = 'ht_session_pref'
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60

function readCookies(): { name: string; value: string }[] {
  if (typeof document === 'undefined') return []
  return document.cookie
    .split('; ')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      return { name: pair.slice(0, i), value: decodeURIComponent(pair.slice(i + 1)) }
    })
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => readCookies(),
        setAll(cookiesToSet) {
          const pref = readCookies().find((c) => c.name === SESSION_PREF_COOKIE)?.value
          for (const { name, value, options } of cookiesToSet) {
            const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options?.path ?? '/'}`, 'SameSite=Lax']
            const maxAge = options?.maxAge
            if (maxAge != null && maxAge <= 0) {
              parts.push('Max-Age=0') // deletion — always honor
            } else if (pref !== 'session') {
              parts.push(`Max-Age=${Math.min(maxAge ?? SESSION_MAX_AGE, SESSION_MAX_AGE)}`)
            } // 'session': omit Max-Age → browser-session cookie
            if (typeof location !== 'undefined' && location.protocol === 'https:') parts.push('Secure')
            document.cookie = parts.join('; ')
          }
        },
      },
    }
  )
}

export const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://your-project.supabase.co'
