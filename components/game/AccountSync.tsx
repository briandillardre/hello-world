'use client'

// Brain Ball — parent account card (Grown-ups report): Google / email
// sign-in via the site's Supabase auth, with kid-profile cloud sync.

import { useEffect, useState } from 'react'
import { Cloud, LogOut } from 'lucide-react'
import {
  cloudEnabled,
  getParentSession,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  syncWithCloud,
  type ParentSession,
} from '@/lib/game/sync'
import type { KidProfile } from '@/lib/game/types'

interface AccountSyncProps {
  profiles: KidProfile[]
  /** called with merged profiles after a successful cloud pull */
  onRestore: (profiles: KidProfile[]) => void
}

export function AccountSync({ profiles, onRestore }: AccountSyncProps) {
  const [session, setSession] = useState<ParentSession | null>(null)
  const [checked, setChecked] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [create, setCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [synced, setSynced] = useState<'idle' | 'syncing' | 'done'>('idle')

  useEffect(() => {
    let alive = true
    getParentSession().then(async (s) => {
      if (!alive) return
      setSession(s)
      setChecked(true)
      if (s) {
        setSynced('syncing')
        // pull → merge → push; returns null on fetch failure so a transient
        // error can never cause a blind overwrite of the cloud backup
        const merged = await syncWithCloud(profiles)
        if (!alive) return
        if (merged) onRestore(merged)
        setSynced(merged ? 'done' : 'idle')
      }
    })
    return () => {
      alive = false
    }
    // run once on mount — sync-on-change is handled by the app shell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cloudEnabled) {
    return (
      <div className="rounded-2xl bg-white border-2 border-slate-200 shadow p-4 mb-4">
        <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
          <Cloud className="w-3.5 h-3.5" /> Parent account
        </p>
        <p className="text-sm text-slate-500 font-semibold">
          Sign-in with Google (and progress sync across devices) switches on once the production database is connected — everything is
          built and waiting. Until then, progress saves safely on this device.
        </p>
      </div>
    )
  }

  if (!checked) return null

  if (session) {
    return (
      <div className="rounded-2xl bg-white border-2 border-green-200 shadow p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Cloud className="w-3.5 h-3.5" /> Parent account
            </p>
            <p className="text-sm font-bold text-slate-700">{session.email}</p>
            <p className="text-xs font-semibold text-green-600">
              {synced === 'syncing' ? 'Syncing…' : '✓ Progress backed up — signs in on any device'}
            </p>
          </div>
          <button
            onClick={async () => {
              await signOut()
              setSession(null)
            }}
            aria-label="Sign out"
            className="flex items-center gap-1 text-xs font-bold text-slate-500 border-2 border-slate-200 rounded-xl px-3 py-2 active:scale-95"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white border-2 border-blue-200 shadow p-4 mb-4">
      <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
        <Cloud className="w-3.5 h-3.5" /> Parent account
      </p>
      <p className="text-xs text-slate-500 font-semibold mb-3">Sign in to back up progress and sync across phones & tablets.</p>
      {error && <p className="text-xs font-bold text-red-500 mb-2">{error}</p>}
      <button
        onClick={async () => {
          setError('')
          const err = await signInWithGoogle()
          if (err) setError(err)
        }}
        className="w-full rounded-xl bg-white border-2 border-slate-300 font-extrabold text-slate-700 px-4 py-2.5 mb-2 flex items-center justify-center gap-2 active:scale-95"
      >
        <GoogleG /> Continue with Google
      </button>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          const err = await signInWithEmail(email, password, create)
          setBusy(false)
          if (err) setError(err)
          else if (create) setError('Check your email to confirm your account!')
          else {
            // restore the cloud backup right after sign-in — before this, the
            // pull only happened on mount (while still signed out)
            setSession(await getParentSession())
            setSynced('syncing')
            const merged = await syncWithCloud(profiles)
            if (merged) onRestore(merged)
            setSynced(merged ? 'done' : 'idle')
          }
        }}
        className="grid gap-2"
      >
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-xl border-2 border-slate-200 px-3 py-2 text-sm font-semibold"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-xl border-2 border-slate-200 px-3 py-2 text-sm font-semibold"
        />
        <button type="submit" disabled={busy} className="rounded-xl bg-blue-600 text-white font-extrabold px-4 py-2.5 active:scale-95 disabled:opacity-50">
          {busy ? '…' : create ? 'Create account' : 'Sign in with email'}
        </button>
      </form>
      <button onClick={() => setCreate((c) => !c)} className="text-xs font-bold text-blue-500 underline mt-2">
        {create ? 'Have an account? Sign in' : 'New here? Create an account'}
      </button>
    </div>
  )
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.9 6.2C12.3 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.4 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.8 2.3-7.5 2.3-6.3 0-11.7-3.9-13.6-9.4l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}
