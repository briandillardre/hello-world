'use client'

import { useState } from 'react'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'

/**
 * Masked tracker API key with reveal + copy. The real key only ever reaches
 * this component for admins of a live company (getCompanySettings gates it);
 * demo mode passes the display-only demo key with an honest label.
 */
export function ApiKeyReveal({ apiKey, demo }: { apiKey: string; demo: boolean }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (http / permissions) — reveal so it can be
      // selected by hand instead of failing silently.
      setShown(true)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-navy-800 rounded-lg px-3 py-2 font-mono text-xs text-muted break-all select-all border border-navy-800">
          {shown ? apiKey : '••••••••••••••••••••••••'}
        </div>
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="inline-flex items-center gap-1 rounded-lg border border-navy-700 text-muted text-xs font-medium px-2.5 py-2 hover:bg-navy-800 hover:text-ink transition-colors"
        >
          {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {shown ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-lg border border-navy-700 text-muted text-xs font-medium px-2.5 py-2 hover:bg-navy-800 hover:text-ink transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-teal" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {demo && (
        <p className="text-[11px] text-faint">Demo key — not live. Create an account to get your real tracker key.</p>
      )}
    </div>
  )
}
