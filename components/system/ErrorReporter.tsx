'use client'

import { useEffect } from 'react'

/**
 * Uncaught-error beacon: anything that would have died silently in the
 * user's console gets POSTed to /api/monitor (which pushes to the owner's
 * phone in production and no-ops in demo mode). Renders nothing.
 *
 * Throttled hard client-side: max 3 reports per page load, each distinct
 * message once — an error inside a render loop must not DDoS ourselves.
 *
 * Noise filter: browser error beacons are worthless if they page the owner for
 * things nobody can act on. We drop the universally-benign set (ResizeObserver
 * loops, cross-origin "Script error.", browser-extension crashes) AND the
 * classic MapLibre GL lifecycle races — property reads on an undefined internal
 * ('signal', 'bind', 'style', 'transform', 'painter', 'context', 'program')
 * that fire when the map is torn down or its style swapped mid-flight. Our own
 * source never touches those, the map keeps working, and they were paging the
 * owner nightly (Jul 15). A real app-level crash still carries a real message.
 */
const NOISE = [
  /resizeobserver loop/i,
  /^script error\.?$/i,
  /reading '(signal|bind|style|transform|painter|_?context|program|_map|_controls)'/i,
]
function isNoise(message: string, source: string, stack?: string): boolean {
  const m = (message || '').trim()
  if (!m) return true
  if (/(chrome|moz|safari-web)-extension:\/\//.test(`${source} ${stack ?? ''}`)) return true
  return NOISE.some((re) => re.test(m))
}

export function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>()
    let budget = 3
    const report = (message: string, source: string, stack?: string) => {
      if (budget <= 0 || seen.has(message) || isNoise(message, source, stack)) return
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
