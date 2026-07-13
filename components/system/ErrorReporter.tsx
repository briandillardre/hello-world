'use client'

import { useEffect } from 'react'

/**
 * Uncaught-error beacon: anything that would have died silently in the
 * user's console gets POSTed to /api/monitor (which pushes to the owner's
 * phone in production and no-ops in demo mode). Renders nothing.
 *
 * Throttled hard client-side: max 3 reports per page load, each distinct
 * message once — an error inside a render loop must not DDoS ourselves.
 */
export function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>()
    let budget = 3
    const report = (message: string, source: string, stack?: string) => {
      if (budget <= 0 || seen.has(message)) return
      seen.add(message)
      budget--
      try {
        fetch('/api/monitor', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, source, stack }),
          keepalive: true,
        }).catch(() => { /* monitoring never breaks the page */ })
      } catch { /* ditto */ }
    }
    const onError = (e: ErrorEvent) => {
      report(e.message || 'window error', `${e.filename ?? location.pathname}:${e.lineno ?? 0}`, e.error?.stack)
    }
    const onReject = (e: PromiseRejectionEvent) => {
      const r = e.reason
      const msg = r instanceof Error ? r.message : typeof r === 'string' ? r : 'unhandled rejection'
      report(msg, location.pathname, r instanceof Error ? r.stack : undefined)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onReject)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onReject)
    }
  }, [])
  return null
}
