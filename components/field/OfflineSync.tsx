'use client'

import { useEffect } from 'react'

/**
 * Boots the offline queue on EVERY dashboard page, not just the ones that
 * happen to import it (/clock, /qr). A foreman who queued a clock-in in a
 * dead zone and later opens /map or /assets still gets the auto-flush —
 * the module's init wires the 'online' listener + owner guard + first flush.
 */
export function OfflineSync() {
  useEffect(() => {
    import('@/lib/offline-queue').then((m) => m.initOfflineQueue()).catch(() => {})
  }, [])
  return null
}
