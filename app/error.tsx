'use client'

import { useEffect, useState } from 'react'

/**
 * Route error screen — replaces Next's bare "Application error: a client-side
 * exception has occurred". Two jobs:
 *
 *  1. STALE BUILD. Phones keep the app shell open for days while we deploy
 *     several times a night; the next page they open asks for a chunk from
 *     the build they started on, which no longer exists — a ChunkLoadError,
 *     and that generic screen (Brian, Sep 5: "I can't access assets"). Reload
 *     ONCE automatically: fresh HTML carries the new chunk names. A 30 s
 *     guard keeps a genuinely broken build from reload-looping, and when the
 *     guard (or unavailable storage) stops the reload the copy hands the user
 *     the button instead of promising a reload that is not coming.
 *     A chunk that fails with the RADIO OFF is not a stale build — webpack
 *     raises the same ChunkLoadError on a script timeout — so that case gets
 *     the offline copy and no reload: in the app shell a reload with no
 *     signal lands on WebView's dead "Webpage not available" page.
 *  2. ANYTHING ELSE. Say what broke in plain words, show the message so a
 *     screenshot carries it, and page the monitor (the window 'error' hook
 *     does not see errors a React boundary already caught). The routine
 *     one-time reload across a deploy is NOT paged — every phone that crosses
 *     a nightly deploy would fire it; a reload that could not run is.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`
  const chunk = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Failed to load chunk|css chunk/i.test(text)
  // A navigation whose data fetch died mid-flight (5G hiccup): Android's
  // WebView words it "network error", Chrome "Failed to fetch", Safari
  // "Load failed". Nothing is broken — say so and offer the retry.
  const netText = /network error|Failed to fetch|Load failed|NetworkError/i.test(text)
  // Radio state is read on the client after mount (no hydration mismatch).
  const [net, setNet] = useState<'unknown' | 'on' | 'off'>('unknown')
  // The one automatic reload was stopped (30 s guard / no storage): the
  // build is still missing this chunk after a fresh load — needs a tap.
  const [blocked, setBlocked] = useState(false)

  const stale = chunk && net !== 'off'
  const offline = !stale && (netText || (chunk && net === 'off'))

  useEffect(() => {
    const off = typeof navigator !== 'undefined' && navigator.onLine === false
    setNet(off ? 'off' : 'on')
    const isStale = chunk && !off
    let reloading = false
    if (isStale) {
      try {
        const key = 'ht_chunk_reload_at'
        const last = Number(sessionStorage.getItem(key) ?? 0)
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(key, String(Date.now()))
          reloading = true
        }
      } catch {
        // Storage unavailable (cookies blocked for the site, locked-down
        // WebView): reloads cannot be counted, so fail CLOSED — one tap on
        // Reload beats an unbounded loop on a genuinely broken build.
      }
      if (!reloading) setBlocked(true)
    }
    const isOffline = netText || (chunk && off)
    if (!reloading && !isOffline) {
      try {
        fetch('/api/monitor', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: (isStale ? '[stale build, reload blocked] ' : '[route error] ') + text.slice(0, 260), source: window.location.pathname, stack: error?.stack?.slice(0, 600) }),
          keepalive: true,
        }).catch(() => { /* the monitor is best-effort */ })
      } catch { /* ignore */ }
    }
    if (reloading) window.location.reload()
  }, [chunk, netText, text, error])

  const reloading = stale && !blocked
  const title = reloading ? 'Updating to the newest version…'
    : blocked ? 'This screen needs a reload'
      : offline ? 'Lost the connection for a moment'
        : 'This screen hit a snag'
  const body = reloading ? 'The app was open across an update. Reloading with the new version.'
    : blocked ? 'The app was open across an update and the new version did not load on its own. Tap Reload.'
      : offline ? 'The page could not be fetched over the network. Try again once you have signal.'
        : 'The rest of the app is fine. Reload this screen — if it keeps happening, screenshot this and send it.'

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6 bg-navy-950 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-navy-700 bg-navy-900 p-5 space-y-3">
        <p className="font-display font-bold text-[15px]">{title}</p>
        <p className="text-[13px] text-muted leading-snug">{body}</p>
        {!reloading && !offline && (
          <p className="font-mono text-[11px] text-faint break-words rounded-lg bg-navy-950 p-2">
            {String(error?.message ?? error)}{error?.digest ? ` · ${error.digest}` : ''}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => window.location.reload()} className="flex-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[13px] py-2">Reload</button>
          <button type="button" onClick={reset} className="flex-1 rounded-lg bg-navy-800 border border-navy-700 text-ink text-[13px] py-2">Try again</button>
        </div>
      </div>
    </div>
  )
}
