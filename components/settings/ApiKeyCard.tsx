'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { confirmSheet, toast } from '@/components/ui/feedback'
import { rotateApiKeyAction } from '@/lib/actions/company-key'

/**
 * Masked tracker API key with reveal + copy + admin rotation. The real key
 * only ever reaches this component for admins of a live company
 * (getCompanySettings gates it); demo mode passes the display-only demo key
 * with an honest label.
 */
export function ApiKeyReveal({ apiKey, demo }: { apiKey: string; demo: boolean }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

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

  const rotate = async () => {
    const ok = await confirmSheet({
      title: 'Rotate API key?',
      message: 'A new key is issued immediately and the old one stops working. Any direct-API integration using it must be updated. Your shipped HammerTrack trackers are unaffected.',
      confirmLabel: 'Rotate key',
      destructive: true,
    })
    if (!ok) return
    startTransition(async () => {
      const res = await rotateApiKeyAction()
      if (res.ok) {
        setShown(false)
        toast(`New key issued (${res.masked}) — copy it above.`, { variant: 'success' })
        router.refresh()
      } else {
        toast(res.error, { variant: 'error' })
      }
    })
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
      {demo ? (
        <p className="text-[11px] text-faint">Demo key — not live. Create an account to get your real tracker key.</p>
      ) : (
        <>
          {/* Honest scoping (updated Aug 22): this key now authenticates the
              direct ingest API and scopes every push to this company. flespi
              devices ride their own token — they never see this key. */}
          <p className="text-[11px] text-faint">
            This key authenticates the direct API ingest endpoints — send it as the{' '}
            <code className="font-mono">x-api-key</code> header and every push lands only on your
            company&apos;s assets. Your shipped HammerTrack trackers are pre-authenticated and
            don&apos;t use this key.
          </p>
          <button
            type="button"
            onClick={rotate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-muted text-xs font-medium px-2.5 py-2 hover:bg-navy-800 hover:text-ink transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
            {pending ? 'Rotating…' : 'Rotate key'}
          </button>
          <p className="text-[11px] text-faint">
            Rotating issues a new key instantly — the old one stops working and any integration
            using it must be updated.
          </p>
        </>
      )}
    </div>
  )
}
