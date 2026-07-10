'use client'

import { useState } from 'react'
import { Check, ExternalLink, Loader2, Receipt } from 'lucide-react'
import { pushServiceExpenseAction } from '@/lib/actions/qbo'

/** One-tap "send this service cost to QuickBooks as an expense". */
export function ExpenseToQbo({ recordId }: { recordId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const send = async () => {
    setState('busy')
    const r = await pushServiceExpenseAction(recordId)
    if ('error' in r) { setState('error'); setMsg(r.error) }
    else { setState('done'); setUrl(r.url) }
  }

  if (state === 'done') {
    return (
      <a
        href={url ?? '#'}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#34d399] hover:underline flex-shrink-0"
      >
        <Check className="h-3.5 w-3.5" /> In QBO <ExternalLink className="h-3 w-3" />
      </a>
    )
  }

  return (
    <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
      <button
        onClick={send}
        disabled={state === 'busy'}
        title="Record in QuickBooks as an expense"
        className="inline-flex items-center gap-1 rounded-lg border border-navy-700 bg-navy-950 px-2 py-1 text-[11px] font-semibold text-faint hover:text-ink transition-colors disabled:opacity-60"
      >
        {state === 'busy'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Receipt className="h-3.5 w-3.5" />}
        QBO
      </button>
      {state === 'error' && <span className="text-[10px] text-alert max-w-[140px] text-right leading-tight">{msg}</span>}
    </span>
  )
}
