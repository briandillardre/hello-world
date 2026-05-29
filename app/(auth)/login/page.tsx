'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Map } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

    if (isMock) {
      router.push('/map')
      return
    }

    const { createClient } = await import('@/lib/supabase')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/map')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Map className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">TrackFlow</h1>
          <p className="text-slate-400 text-sm mt-1">Asset tracking for construction</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 space-y-4 shadow-xl">
          <h2 className="text-lg font-semibold text-slate-900">Sign in</h2>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-slate-500">
            No account?{' '}
            <Link href="/register" className="text-amber-600 font-medium hover:underline">
              Sign up free
            </Link>
          </p>
        </form>

        <p className="text-center text-xs text-slate-500">
          Demo mode active — Supabase not connected.{' '}
          <Link href="/map" className="text-amber-400 hover:underline">
            View demo →
          </Link>
        </p>
      </div>
    </div>
  )
}
