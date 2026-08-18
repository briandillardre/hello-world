'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SocialAuth } from '@/components/auth/SocialAuth'
import { generateApiKey } from '@/lib/utils'

// Slugs appended by the /live demo's locked rows (?from=…) → display names.
const FROM_LABELS: Record<string, string> = {
  'command-center': 'Command Center',
  'live-map': 'Live Map',
  'alerts': 'Alerts',
  'time-clock': 'Time clock',
  'daily-logs': 'Daily logs',
  'assets': 'Assets',
  'zones': 'Zones',
  'measurements': 'Measurements',
  'tag-scanner': 'Tag scanner',
  'maintenance': 'Maintenance',
  'reports': 'Reports',
  'accounting': 'Accounting',
  'receipts': 'Receipts',
  'financials': 'Financials',
  'op-model': 'Op model',
}

function RegisterInner() {
  const router = useRouter()
  const from = useSearchParams().get('from')
  const fromLabel = from ? FROM_LABELS[from] ?? null : null
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')

    const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

    if (isMock) {
      router.push('/map')
      return
    }

    const { createClient } = await import('@/lib/supabase')
    const supabase = createClient()

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
    if (authError || !authData.user) {
      setError(authError?.message ?? 'Sign up failed')
      setLoading(false)
      return
    }

    // Confirm-email ON: signUp succeeds but returns no session, so the
    // company/profile inserts would run unauthenticated and silently fail
    // (RLS) — then /welcome would bounce to /login with no explanation.
    // Say exactly what to do next and stop here (same pattern as /join).
    if (!authData.session) {
      setNotice('Almost there — we emailed you a confirmation link. Tap it, then sign in to finish setting up.')
      setLoading(false)
      return
    }

    const apiKey = generateApiKey()
    const { error: companyError } = await supabase.from('companies').insert({
      id: authData.user.id,
      name: companyName,
      api_key: apiKey,
      plan: 'starter',
    })

    const { error: profileError } = await supabase.from('profiles').insert({
      id: authData.user.id,
      company_id: authData.user.id,
      role: 'admin',
      name: email.split('@')[0],
      email,
    })

    if (companyError || profileError) {
      setError('Could not finish setting up your company — please try again or email support@hammertrack.ai')
      setLoading(false)
      return
    }

    // New company → onboarding wizard, not a bare empty map.
    router.push('/welcome')
    router.refresh()
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

        {from && (
          <p className="text-center text-sm text-teal -mt-4">
            {fromLabel
              ? `${fromLabel} is included in your free pilot.`
              : 'Everything you saw in the demo is included in your free pilot.'}
          </p>
        )}

        <form onSubmit={handleSubmit} className="bg-navy-900 border border-navy-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-ink">Create your account</h2>

          {error && (
            <div className="bg-alert/15 text-alert text-sm px-3 py-2 rounded-lg border border-alert/30">
              {error}
            </div>
          )}
          {notice && (
            <div className="bg-teal/10 text-teal text-sm px-3 py-2 rounded-lg border border-teal/30">
              {notice}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="company">Company name</Label>
            <Input
              id="company"
              placeholder="Acme Construction Co."
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
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
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account…' : 'Get started free'}
          </Button>

          <SocialAuth next="/welcome" />

          <p className="text-center text-[11.5px] text-faint mb-2">Free 30-day pilot · no credit card · cancel anytime</p>
          <p className="text-center text-sm text-muted">
            Already have an account?{' '}
            <Link href="/login" className="text-amber font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-navy-950" />}>
      <RegisterInner />
    </Suspense>
  )
}
