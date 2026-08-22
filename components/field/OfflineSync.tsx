'use client'

import { useEffect } from 'react'
import { toast } from '@/components/ui/feedback'

/**
 * Boots the offline queue on EVERY dashboard page, not just the ones that
 * happen to import it (/clock, /qr). A foreman who queued a clock-in in a
 * dead zone and later opens /map or /assets still gets the auto-flush —
 * the module's init wires the 'online' listener + owner guard + first flush.
 *
 * It also surfaces server REJECTIONS of replayed entries as a toast on pages
 * without their own queue UI — /clock (ClockCard) and /qr (CheckButtons)
 * render rejections themselves, so those paths are left alone.
 */
export function OfflineSync() {
  useEffect(() => {
    import('@/lib/offline-queue').then((m) => m.initOfflineQueue()).catch(() => {})
    const onFlushed = (e: Event) => {
      const detail = (e as CustomEvent<{ ok: boolean; error?: string }>).detail
      if (!detail || detail.ok) return
      const path = window.location.pathname
      if (path.startsWith('/clock') || path.startsWith('/qr')) return
      toast(detail.error || 'A queued field entry was rejected by the server.', { variant: 'error' })
    }
    window.addEventListener('ht:queue-flushed', onFlushed)
    return () => window.removeEventListener('ht:queue-flushed', onFlushed)
  }, [])
  return null
}
