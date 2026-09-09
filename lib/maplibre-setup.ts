/**
 * One-time MapLibre setup that has to happen BEFORE the first map exists.
 *
 * Older Android System WebViews and Samsung Internet (Chromium < 93) lack
 * ES2022 `Object.hasOwn`. app/layout.tsx shims it inline for the page, but
 * MapLibre parses tiles in WEB WORKERS — their own global, no shim — and its
 * line-bucket code calls `Object.hasOwn` (gradient/clipped lines: our speed
 * trails). That is the "Object.hasOwn is not a function @ /map" that kept
 * paging Brian on Sep 8 after the page-side fix. `importScriptInWorkers`
 * hands every worker in the shared pool a shim file; the import is queued
 * ahead of any tile work, so calling it right before `new Map()` is enough.
 *
 * Takes the maplibre module as an argument so the components that load
 * MapLibre lazily (marketing cinema, /track) keep it out of their first bundle.
 */
let armed = false
export function ensureMapLibreWorkerShims(lib: { importScriptInWorkers: (url: string) => Promise<unknown> }): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  try {
    // Absolute URL: the default worker runs from a blob: URL, which cannot
    // resolve a relative importScripts path.
    void lib.importScriptInWorkers(`${window.location.origin}/polyfills/es2022.js`).catch(() => { /* a modern browser needs nothing */ })
  } catch { /* never let setup break a map */ }
}
