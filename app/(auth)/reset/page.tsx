'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mapAuthError, EXPIRED_LINK_MESSAGE } from '../auth-error'

/** User lands here from the password-reset email link; Supabase establishes a
 *  recovery session on load, so updateUser can set the new password. */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // 'checking' renders the form (no flash for valid links); if no recovery
  // session ever materializes we swap to a branded expired-link card instead
  // of letting a doomed submit surface "Auth session missing!".
  const [link, setLink] = useState<'checking' | 'ok' | 'expired'>('checking')

  useEffect(() => {
    const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
    if (isMock) { setLink('ok'); return }
    let active = true
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    ;(async () => {
      try {
        const { createClient } = await import('@/lib/supabase')
        const supabase = createClient()
        // The recovery token in the URL is exchanged asynchronously on load —
        // listen for the session rather than only sampling once.
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (!active) return
          if (event === 'PASSWORD_RECOVERY' || session) setLink('ok')
        })
        unsubscribe = () => data.subscription.unsubscribe()
        const { data: { session } } = await supabase.auth.getSession()
        if (!active) return
        if (session) { setLink('ok'); return }
        // Give detectSessionInUrl a moment to finish the token exchange
        // before declaring the link dead.
        timer = setTimeout(() => {
          if (active) setLink(s => (s === 'checking' ? 'expired' : s))
        }, 2500)
      } catch {
        // Can't even load the client — leave the form up; submit will explain.
        if (active) setLink('ok')
      }
    })()
    return () => { active = false; unsubscribe?.(); if (timer) clearTimeout(timer) }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true); setError('')
    try {
      const { createClient } = await import('@/lib/supabase')
      const { error } = await createClient().auth.updateUser({ password })
      if (error) {
        const msg = mapAuthError(error)
        // Recovery session evaporated mid-flow → show the branded expired
        // card (with its /forgot link) instead of an inline error.
        if (msg === EXPIRED_LINK_MESSAGE) setLink('expired')
        else setError(msg)
        setLoading(false); return
      }
      setDone(true)
      setTimeout(() => { router.push('/map'); router.refresh() }, 1400)
    } catch (e) { setError(mapAuthError(e)); setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-3"><Logo size={34} href="/" /></div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Set a new password</p>
        </div>
        {done ? (
          <div className="bg-navy-900 border border-navy-800 rounded-2xl p-6 text-center space-y-2">
            <p className="text-2xl">✅</p>
            <h1 className="text-lg font-semibold text-ink">Password updated</h1>
            <p className="text-sm text-muted">Taking you to your map…</p>
          </div>
        ) : link === 'expired' ? (
          <div className="bg-navy-900 border border-navy-800 rounded-2xl p-6 text-center space-y-3">
            <p className="text-2xl">⏳</p>
            <h1 className="text-lg font-semibold text-ink">This reset link is invalid or has expired</h1>
            <p className="text-sm text-muted">Reset links only work once and expire after a while. Request a fresh one and try again.</p>
            <Link href="/forgot" className="inline-block text-amber font-medium hover:underline text-sm">Request a new link</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-navy-900 border border-navy-800 rounded-2xl p-6 space-y-4">
            <h1 className="text-lg font-semibold text-ink">Set a new password</h1>
            {error && <div role="alert" className="bg-alert/15 text-alert text-sm px-3 py-2 rounded-lg border border-alert/30">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" name="new-password" type="password" autoComplete="new-password" className="h-11 sm:h-10" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input id="pw2" name="confirm-password" type="password" autoComplete="new-password" className="h-11 sm:h-10" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full h-11 sm:h-10" disabled={loading}>{loading ? 'Saving…' : 'Update password'}</Button>
            <p className="text-center text-sm text-muted"><Link href="/login" className="text-amber font-medium hover:underline">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
