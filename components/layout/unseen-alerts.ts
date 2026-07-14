'use client'

import { useEffect, useState } from 'react'

/**
 * Gmail-style badge count: show the unacknowledged-alert count ONLY while
 * there's something newer than the last time the owner opened /alerts.
 * Opening /alerts stamps ht_alerts_seen_at (AlertList does the write and
 * fires ht:alerts-seen) and the badge zeroes everywhere instantly.
 *
 * Server renders the raw count (it can't see localStorage); the effect
 * corrects to 0 after mount when everything's already been seen.
 */
export function useUnseenAlertCount(alertCount: number, latestAlertAt: string | null): number {
  const [n, setN] = useState(alertCount)
  useEffect(() => {
    const compute = () => {
      try {
        const seen = localStorage.getItem('ht_alerts_seen_at')
        // ISO-8601 compares correctly as strings.
        setN(!latestAlertAt || (seen && seen >= latestAlertAt) ? 0 : alertCount)
      } catch {
        setN(alertCount)
      }
    }
    compute()
    window.addEventListener('ht:alerts-seen', compute)
    return () => window.removeEventListener('ht:alerts-seen', compute)
  }, [alertCount, latestAlertAt])
  return n
}
