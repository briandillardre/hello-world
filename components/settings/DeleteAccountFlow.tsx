'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestAccountDeletionAction } from '@/lib/actions/account'
import { createClient } from '@/lib/supabase'

/**
 * The actual deletion confirmation — its own screen, reached only through the
 * Settings danger-zone link, and armed only by typing DELETE. Two deliberate
 * steps on two different screens: no scroll-past tap can ever file a request
 * (Brian, Aug 22).
 */
export function DeleteAccountFlow() {
  const router = useRouter()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const armed = typed.trim().toUpperCase() === 'DELETE'

  return (
    <div className="space-y-3">
      <label className="block text-xs text-muted">
        Type <span className="font-mono font-bold text-red-400">DELETE</span> to confirm
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="DELETE"
          className="mt-1.5 w-full rounded-lg bg-navy-950 border border-navy-700 focus:border-red-500/60 outline-none px-3 py-2.5 font-mono text-sm text-ink placeholder:text-faint/50"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!armed || busy}
          onClick={() => start(async () => {
            const r = await requestAccountDeletionAction()
            if (!r.ok) { setError(r.error ?? 'Failed'); return }
            await createClient().auth.signOut().catch(() => {})
            router.push('/login?deleted=1')
          })}
          className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busy ? 'Filing request…' : 'Permanently delete my account'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/settings')}
          className="rounded-lg border border-navy-700 px-4 py-2.5 text-sm font-medium text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
