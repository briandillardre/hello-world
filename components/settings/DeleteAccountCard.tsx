'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestAccountDeletionAction } from '@/lib/actions/account'
import { createClient } from '@/lib/supabase'

/**
 * In-app account deletion — Apple guideline 5.1.1(v) requires the entry
 * point to live inside the app for any account-based app. Files the request
 * (completed within 30 days per /privacy) and signs the user out.
 */
export function DeleteAccountCard() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()

  return (
    <section className="bg-navy-900 rounded-xl border border-red-500/25 p-4">
      <h2 className="font-display font-bold text-ink text-sm">Delete my account</h2>
      <p className="text-[12.5px] text-faint mt-1">
        Files a deletion request for your account and its data. We complete deletion within
        30 days, as described in the <a href="/privacy" className="text-amber hover:underline">privacy policy</a>.
        This cannot be undone.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
        >
          Delete my account…
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => start(async () => {
              const r = await requestAccountDeletionAction()
              if (!r.ok) { setError(r.error ?? 'Failed'); return }
              await createClient().auth.signOut().catch(() => {})
              router.push('/login?deleted=1')
            })}
            className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            {busy ? 'Filing request…' : 'Yes — permanently delete'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-xs text-faint hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  )
}
