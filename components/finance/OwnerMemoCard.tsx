'use client'

import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'

interface Memo { month: string; memo: string; composer: 'ai' | 'plain'; updated_at: string }

/**
 * The monthly owner memo on /finance — the "what lever next" read, generated
 * from computed facts (never invented numbers) and refreshed monthly by cron.
 * First view of a month composes it on the spot, so there's a small working
 * state; Refresh recomposes after the numbers move (server enforces a
 * 30-minute floor so the button can't be mashed into API spend).
 */
export function OwnerMemoCard() {
  const [memo, setMemo] = useState<Memo | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    // pending = the server is composing this month's memo right now (first
    // view of the month, or another tab beat us) — keep the composing state
    // and check back rather than hiding the card.
    const load = (attempt: number) => {
      fetch('/api/memo')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled) return
          if (j?.memo?.memo) { setMemo(j.memo as Memo); setState('ready') }
          else if (j?.pending && attempt < 12) { timer = window.setTimeout(() => load(attempt + 1), 20_000) }
          else setState('failed')
        })
        .catch(() => { if (!cancelled) setState('failed') })
    }
    load(0)
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [])

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const r = await fetch('/api/memo', { method: 'POST' })
      const j = r.ok ? await r.json() : null
      if (j?.memo?.memo) setMemo(j.memo as Memo)
    } catch { /* keep what we have */ }
    setRefreshing(false)
  }

  if (state === 'failed') return null // pre-080 database or transient — the page stands on its own

  const monthLabel = memo
    ? new Date(memo.month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : ''

  return (
    <section className="rounded-xl border border-amber/30 bg-navy-900 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber flex-none" />
        <h2 className="font-display font-bold text-sm text-ink">Owner memo{monthLabel ? ` · ${monthLabel}` : ''}</h2>
        {memo && (
          <button
            onClick={refresh}
            disabled={refreshing}
            title="Recompose from the latest numbers (at most every 30 minutes)"
            className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-faint hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        )}
      </div>
      {state === 'loading' ? (
        <p className="text-[12.5px] text-faint mt-2">Reading the month&hellip; first look composes the memo from your tracked numbers.</p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-muted mt-2 whitespace-pre-line">{memo!.memo}</p>
          <p className="text-[10.5px] text-faint mt-3">
            Every number is computed from your tracked data — nothing estimated. Mailed monthly; refreshed here anytime.
          </p>
        </>
      )}
    </section>
  )
}
