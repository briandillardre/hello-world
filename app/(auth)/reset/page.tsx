'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** User lands here from the password-reset email link; Supabase establishes a
 *  recovery session on load, so updateUser can set the new password. */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true); setError('')
    try {
      const { createClient } = await import('@/lib/supabase')
      const { error } = await createClient().auth.updateUser({ password })
      if (error) { setError(error.message); setLoading(false); return }
      setDone(true)
      setTimeout(() => { router.push('/map'); router.refresh() }, 1400)
    } catch { setError('Something went wrong. Please try again.'); setLoading(false) }
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
            <h2 className="text-lg font-semibold text-ink">Password updated</h2>
            <p className="text-sm text-muted">Taking you to your map…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-navy-900 border border-navy-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-ink">New password</h2>
            {error && <div className="bg-alert/15 text-alert text-sm px-3 py-2 rounded-lg border border-alert/30">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Saving…' : 'Update password'}</Button>
            <p className="text-center text-sm text-muted"><Link href="/login" className="text-amber font-medium hover:underline">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
