'use client'

import { useEffect, useState } from 'react'

/**
 * Gmail-style badge count: show the unacknowledged-alert count ONLY while
 * there's something newer than the last time the owner opened /alerts.
 * Opening /alerts stamps ht_alerts_seen_at (AlertList does the write and
 * fires ht:alerts-seen) and the badge zeroes everywhere instantly.
 *
 * The dashboard layout no longer awaits the alert query before painting —
 * AlertBadgeBridge streams the count in behind a Suspense boundary and
 * publishes it here (ht:alerts-badge); until it lands the badge shows the
 * prop value (0 from the layout), then pops in. The effect also corrects to
 * 0 after mount when everything's already been seen (server can't read
 * localStorage).
 */

// Streamed badge data — survives client-side navigations so the badge never
// flashes back to 0 between routes.
let streamed: { count: number; latest: string | null } | null = null

/** Called by AlertBadgeBridge once the Suspense-streamed alert query lands. */
export function publishAlertBadge(count: number, latest: string | null) {
  streamed = { count, latest }
  window.dispatchEvent(new Event('ht:alerts-badge'))
}

export function useUnseenAlertCount(alertCount: number, latestAlertAt: string | null): number {
  const [n, setN] = useState(alertCount)
  useEffect(() => {
    const compute = () => {
      const count = streamed ? streamed.count : alertCount
      const latest = streamed ? streamed.latest : latestAlertAt
      try {
        const seen = localStorage.getItem('ht_alerts_seen_at')
        // ISO-8601 compares correctly as strings.
        setN(!latest || (seen && seen >= latest) ? 0 : count)
      } catch {
        setN(count)
      }
    }
    compute()
    window.addEventListener('ht:alerts-seen', compute)
    window.addEventListener('ht:alerts-badge', compute)
    return () => {
      window.removeEventListener('ht:alerts-seen', compute)
      window.removeEventListener('ht:alerts-badge', compute)
    }
  }, [alertCount, latestAlertAt])
  return n
}
