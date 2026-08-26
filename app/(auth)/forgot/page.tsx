'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mapAuthError } from '../auth-error'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
    if (isMock) { setSent(true); setLoading(false); return }
    try {
      const { createClient } = await import('@/lib/supabase')
      const { error } = await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset`,
      })
      if (error) setError(mapAuthError(error))
      else setSent(true)
    } catch (e) { setError(mapAuthError(e)) }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-3"><Logo size={34} href="/" /></div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Reset your password</p>
        </div>

        {sent ? (
          <div className="bg-navy-900 border border-navy-800 rounded-2xl p-6 space-y-3 text-center">
            <p className="text-2xl">📬</p>
            <h1 className="text-lg font-semibold text-ink">Check your email</h1>
            <p className="text-sm text-muted">If an account exists for <span className="text-ink">{email}</span>, we sent a link to reset your password.</p>
            <Link href="/login" className="inline-block text-amber font-medium hover:underline text-sm">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-navy-900 border border-navy-800 rounded-2xl p-6 space-y-4">
            <h1 className="text-lg font-semibold text-ink">Forgot password</h1>
            {error && <div role="alert" className="bg-alert/15 text-alert text-sm px-3 py-2 rounded-lg border border-alert/30">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" className="h-11 sm:h-10" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full h-11 sm:h-10" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</Button>
            <p className="text-center text-sm text-muted">
              Remembered it?{' '}
              <Link href="/login" className="text-amber font-medium hover:underline">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
