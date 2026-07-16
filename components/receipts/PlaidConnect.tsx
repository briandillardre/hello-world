'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark } from 'lucide-react'

/**
 * "Connect a card/bank" — opens Plaid Link, exchanges the token, and kicks an
 * immediate transaction sync. Loads the Plaid Link script on demand so nothing
 * ships to browsers that never click it. Gracefully tells the user when Plaid
 * isn't configured yet (link-token returns 501).
 */
interface PlaidHandler { open: () => void; exit?: () => void }
interface PlaidGlobal { create: (cfg: Record<string, unknown>) => PlaidHandler }

function loadPlaid(): Promise<PlaidGlobal> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Plaid?: PlaidGlobal }
    if (w.Plaid) return resolve(w.Plaid)
    const s = document.createElement('script')
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
    s.onload = () => (w.Plaid ? resolve(w.Plaid) : reject(new Error('Plaid failed to load')))
    s.onerror = () => reject(new Error('Plaid failed to load'))
    document.body.appendChild(s)
  })
}

export function PlaidConnect({ onMessage }: { onMessage?: (m: string) => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/plaid/link-token', { method: 'POST' })
      if (r.status === 501) { onMessage?.('Bank sync isn\'t set up yet — add your Plaid keys in Vercel to enable it.'); return }
      if (!r.ok) { onMessage?.('Could not start bank connect.'); return }
      const { link_token } = await r.json()
      const Plaid = await loadPlaid()
      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (public_token: unknown, meta: unknown) => {
          const institution = (meta as { institution?: { name?: string } })?.institution?.name
          const res = await fetch('/api/plaid/exchange', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ public_token, institution }),
          })
          const j = await res.json().catch(() => ({}))
          onMessage?.(res.ok ? `Connected${institution ? ` ${institution}` : ''} · imported ${j.imported ?? 0} charge(s).` : (j.error ?? 'Connect failed.'))
          router.refresh()
        },
      })
      handler.open()
    } catch {
      onMessage?.('Could not open bank connect.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={connect} disabled={busy} className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal hover:text-ink px-2 py-1 disabled:opacity-50">
      <Landmark className="h-3.5 w-3.5" /> {busy ? 'Opening…' : 'Connect bank'}
    </button>
  )
}
