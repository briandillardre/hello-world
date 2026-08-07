'use client'

/**
 * Global "something is working" bus — the answer to "if we're waiting on
 * something, ANYWHERE, show a status bar with what's actually happening"
 * (owner ask, Aug 7).
 *
 *   const done = busy('Copying placement — sheet 2 of 5…')
 *   try { await slowThing() } finally { done() }
 *
 * BusyBar (mounted in the dashboard layout) listens and shows a thin amber
 * sweep at the very top of the screen plus the newest job's label. Multiple
 * overlapping jobs stack; the bar stays until the last one finishes. done()
 * is idempotent.
 */
let seq = 0

export function busy(label: string): () => void {
  if (typeof window === 'undefined') return () => {}
  const id = `busy-${++seq}`
  window.dispatchEvent(new CustomEvent('ht:busy', { detail: { id, label } }))
  let finished = false
  return () => {
    if (finished) return
    finished = true
    window.dispatchEvent(new CustomEvent('ht:idle', { detail: { id } }))
  }
}
