'use client'

import { useEffect } from 'react'

/**
 * Route error screen — replaces Next's bare "Application error: a client-side
 * exception has occurred". Two jobs:
 *
 *  1. STALE BUILD. Phones keep the app shell open for days while we deploy
 *     several times a night; the next page they open asks for a chunk from
 *     the build they started on, which no longer exists — a ChunkLoadError,
 *     and that generic screen (Brian, Sep 5: "I can't access assets"). Reload
 *     ONCE automatically: fresh HTML carries the new chunk names. A 30 s
 *     guard keeps a genuinely broken build from reload-looping.
 *  2. ANYTHING ELSE. Say what broke in plain words, show the message so a
 *     screenshot carries it, and page the monitor (the window 'error' hook
 *     does not see errors a React boundary already caught).
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`
  const stale = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Failed to load chunk|css chunk/i.test(text)

  useEffect(() => {
    try {
      fetch('/api/monitor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: (stale ? '[stale build → reload] ' : '[route error] ') + text.slice(0, 260), source: window.location.pathname, stack: error?.stack?.slice(0, 600) }),
        keepalive: true,
      }).catch(() => { /* the monitor is best-effort */ })
    } catch { /* ignore */ }
    if (!stale) return
    try {
      const key = 'ht_chunk_reload_at'
      const last = Number(sessionStorage.getItem(key) ?? 0)
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(key, String(Date.now()))
        window.location.reload()
      }
    } catch {
      window.location.reload()
    }
  }, [stale, text, error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6 bg-navy-950 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-navy-700 bg-navy-900 p-5 space-y-3">
        <p className="font-display font-bold text-[15px]">{stale ? 'Updating to the newest version…' : 'This screen hit a snag'}</p>
        <p className="text-[13px] text-muted leading-snug">
          {stale
            ? 'The app was open across an update. Reloading with the new version.'
            : 'The rest of the app is fine. Reload this screen — if it keeps happening, screenshot this and send it.'}
        </p>
        {!stale && (
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
