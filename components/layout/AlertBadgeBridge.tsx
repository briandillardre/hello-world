'use client'

import { useEffect } from 'react'
import { publishAlertBadge } from './unseen-alerts'

/**
 * Renders nothing — carries the Suspense-streamed alert badge numbers from
 * the dashboard layout's async AlertBadgeFeed into every bell badge
 * (Sidebar + BottomNav read them via useUnseenAlertCount). This is what lets
 * the layout return without awaiting getAlertEvents: the badge pops in.
 */
export function AlertBadgeBridge({ count, latest }: { count: number; latest: string | null }) {
  useEffect(() => {
    publishAlertBadge(count, latest)
  }, [count, latest])
  return null
}
