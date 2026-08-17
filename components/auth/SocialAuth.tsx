'use client'

import { useState } from 'react'

/**
 * Social sign-in buttons (Google, Apple, Microsoft) via Supabase OAuth.
 *
 * Each provider must be enabled in the Supabase dashboard (Authentication →
 * Providers) with its client ID/secret, and this app's URL added to the
 * provider's allowed redirect list. Until a provider is enabled the button
 * still renders; clicking it surfaces Supabase's "provider is not enabled"
 * message rather than doing anything destructive. In demo mode (no Supabase)
 * the buttons are hidden entirely.
 *
 * `next` is where to land after auth completes (defaults to /map). For invite
 * links, pass /join?token=… so the flow returns to accept the invite.
 */

const PROVIDERS = [
  {
    id: 'google' as const,
    label: 'Continue with Google',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
      </svg>
    ),
  },
]

/** Google blocks OAuth inside embedded in-app browsers (Gmail, Facebook,
 *  Instagram WebViews) with a dead-end "403: disallowed_useragent" screen —
 *  a real invitee hit this from a Gmail-opened invite (Aug 17). Detect the
 *  common ones so we can steer people to a real browser instead. */
function inAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /\bwv\b|FBAN|FBAV|Instagram|Line\/|GSA\/|Gmail/i.test(ua) ||
    (/Android/i.test(ua) && /Version\/[\d.]+ Chrome\/[\d.]+ Mobile/i.test(ua) && !/Safari/i.test(ua))
}

/** Raw Supabase provider errors read as gibberish to a contractor — map the
 *  known ones to instructions a person can actually follow. */
function friendly(message: string): string {
  if (/not enabled|unsupported provider/i.test(message)) {
    return 'Google sign-in isn’t switched on yet — use your email and a password above instead.'
  }
  return message
}

export function SocialAuth({ next = '/map' }: { next?: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
  if (isMock) return null

  const signIn = async (provider: 'google') => {
    setBusy(provider); setError('')
    if (inAppBrowser()) {
      setError('Google blocks sign-in inside this app’s built-in browser. Tap ⋮ (or the share button) and choose “Open in Chrome/Safari”, then try again — or use email + password above.')
      setBusy(null)
      return
    }
    try {
      const { createClient } = await import('@/lib/supabase')
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      const { error } = await createClient().auth.signInWithOAuth({ provider, options: { redirectTo } })
      if (error) { setError(friendly(error.message)); setBusy(null) }
      // On success the browser redirects to the provider — no further work here.
    } catch {
      setError('Could not start sign-in. Please try again.')
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-navy-800" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">or</span>
        <span className="h-px flex-1 bg-navy-800" />
      </div>
      {error && (
        <div className="bg-alert/15 text-alert text-sm px-3 py-2 rounded-lg border border-alert/30">{error}</div>
      )}
      {PROVIDERS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => signIn(p.id)}
          disabled={!!busy}
          className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-navy-700 bg-white/[0.03] hover:bg-white/[0.07] text-ink font-semibold text-sm py-2.5 transition-colors disabled:opacity-60"
        >
          {p.icon}
          {busy === p.id ? 'Redirecting…' : p.label}
        </button>
      ))}
    </div>
  )
}
