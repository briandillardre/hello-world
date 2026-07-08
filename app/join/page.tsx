'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SocialAuth } from '@/components/auth/SocialAuth'
import { getInviteInfoAction, acceptInviteAction, type InviteInfo } from '@/lib/actions/team'

function JoinInner() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getInviteInfoAction(token).then(setInfo)
    ;(async () => {
      const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
      if (isMock) { setSignedIn(false); return }
      const { createClient } = await import('@/lib/supabase')
      const { data } = await createClient().auth.getUser()
      setSignedIn(!!data.user)
    })()
  }, [token])

  const finish = async () => {
    const res = await acceptInviteAction(token)
    if (!res.ok) { setError(res.error ?? 'Could not join.'); return false }
    router.push('/map'); router.refresh(); return true
  }

  const joinAsCurrent = async () => { setBusy(true); setError(''); await finish(); setBusy(false) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
    if (isMock) { router.push('/map'); return }
    try {
      const { createClient } = await import('@/lib/supabase')
      const supabase = createClient()
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } })
        if (error) { setError(error.message); setBusy(false); return }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) { setError(error.message); setBusy(false); return }
      }
      await finish()
    } catch { setError('Something went wrong. Please try again.') }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-3"><Logo size={34} href="/" /></div>
        </div>

        {info && !info.valid ? (
          <div className="bg-navy-900 border border-navy-800 rounded-2xl p-6 text-center space-y-2">
            <p className="text-2xl">🔗</p>
            <h2 className="text-lg font-semibold text-ink">Invite unavailable</h2>
            <p className="text-sm text-muted">{info.reason}</p>
            <Link href="/login" className="inline-block text-amber font-medium hover:underline text-sm pt-1">Go to sign in</Link>
          </div>
        ) : (
          <div className="bg-navy-900 border border-navy-800 rounded-2xl p-6 space-y-4">
            <div className="text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-teal">You&rsquo;re invited</p>
              <h2 className="text-lg font-semibold text-ink mt-1">
                Join {info?.companyName ?? '…'}{info?.role ? <> as <span className="text-amber">{info.role}</span></> : null}
              </h2>
            </div>
            {error && <div className="bg-alert/15 text-alert text-sm px-3 py-2 rounded-lg border border-alert/30">{error}</div>}

            {signedIn ? (
              <Button className="w-full" onClick={joinAsCurrent} disabled={busy || !info?.valid}>{busy ? 'Joining…' : 'Join with my account'}</Button>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
                </div>
                <Button type="submit" className="w-full" disabled={busy || !info?.valid}>
                  {busy ? 'Joining…' : mode === 'signup' ? 'Create account & join' : 'Sign in & join'}
                </Button>
                {token && <SocialAuth next={`/join?token=${encodeURIComponent(token)}`} />}
                <p className="text-center text-xs text-muted">
                  {mode === 'signup' ? 'Already have an account? ' : 'Need an account? '}
                  <button type="button" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')} className="text-amber font-medium hover:underline">
                    {mode === 'signup' ? 'Sign in' : 'Sign up'}
                  </button>
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function JoinPage() {
  return <Suspense fallback={<div className="min-h-screen bg-navy-950" />}><JoinInner /></Suspense>
}
