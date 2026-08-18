'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SocialAuth } from '@/components/auth/SocialAuth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nextPath, setNextPath] = useState('/map')

  // /auth/callback lands here with ?error=… when an OAuth code exchange
  // fails — it was silently dropped before (a failed Google sign-in looked
  // like nothing happened; a real invitee hit this Aug 17). Surface it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // Deep links (QR stickers → /t/…) arrive as ?next=; honor it on success.
    // Same-site paths only — same open-redirect guard as app/auth/callback.
    const next = params.get('next')
    // Same-site only. Backslash matters: browsers treat \ as / so '/\evil.com'
    // would resolve off-domain (sec-check, Aug 18).
    if (next && /^\/(?![/\\])/.test(next)) setNextPath(next)
    const err = params.get('error')
    if (err) {
      // NEVER render the raw param — it's attacker-controllable free text on
      // our real domain (?error=Call+this+number… phishing). Known cases get
      // specific guidance; everything else gets a generic line (sec-check P1).
      console.warn('auth callback error:', err)
      setError(
        /code verifier|invalid request/i.test(err)
          ? 'That sign-in got interrupted (this happens inside the Gmail app’s built-in browser). Open hammertrack.ai in Chrome or Safari and try again.'
          : 'Sign-in didn’t complete. Please try again, or use your email and password.'
      )
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // The auth cookie adapters (lib/supabase + lib/supabase-server) read this
  // pref to shape session lifetime — written on change so the social-login
  // buttons honor the checkbox too, not just the password form.
  useEffect(() => {
    document.cookie = remember
      ? `ht_session_pref=30d; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`
      : 'ht_session_pref=session; Path=/; SameSite=Lax'
  }, [remember])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

    if (isMock) {
      router.push(nextPath)
      return
    }

    const { createClient } = await import('@/lib/supabase')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push(nextPath)
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-3">
            <Logo size={34} href="/" />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Every asset · one live map</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-navy-900 border border-navy-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-ink">Sign in</h2>

          {error && (
            <div className="bg-alert/15 text-alert text-sm px-3 py-2 rounded-lg border border-alert/30">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-navy-700 bg-navy-800 accent-[#ff9e16]"
            />
            <span className="text-sm text-muted">Stay signed in for 30 days</span>
          </label>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>

          <SocialAuth next={nextPath} />

          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot" className="text-faint hover:text-amber hover:underline">
              Forgot password?
            </Link>
            <span className="text-muted">
              No account?{' '}
              <Link href="/register" className="text-amber font-medium hover:underline">
                Sign up free
              </Link>
            </span>
          </div>
        </form>

        <p className="text-center text-xs text-muted">
          <Link href="/pricing" className="text-faint hover:text-amber hover:underline">
            See pricing & how we compare to Tenna →
          </Link>
        </p>
      </div>
    </div>
  )
}
